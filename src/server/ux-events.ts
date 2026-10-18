// UX A/B instrumentation, server side only, in the existing append-only public.events table (no migration).
// - organization_id and prospect_id come from a row the route read with the user's own RLS client; user_id is the
//   session's user. The x-prospectos-ux label is only a label, never read by any check.
// - actor_id stays NULL on purpose: beta_analytics' last_business_activity_at is max(events.created_at) where
//   actor_id = the user (migrations 013/018). A UX event is not business activity; the user id is kept in payload.user_id.
// - Closed payload, no text: no message, prompt, source, key or credential. Production writes nothing. Best-effort: a
//   failure never breaks the user's request.
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {uxAbEnabledFromEnv,UX_EXPERIMENT} from '../ux/variant.ts';

export const UX_KINDS=['prospect_detail_viewed','outreach_generated','outreach_edited','outreach_approved','outreach_copied'] as const;
export type UxKind=typeof UX_KINDS[number];
export const UX_KIND_BY_ACTION:Record<string,UxKind>={SAVE:'outreach_edited',APPROVED:'outreach_approved',USED:'outreach_copied'};
export const UX_VIEW_DEDUPE_MINUTES=30;
const ANGLE_TYPES=new Set(['public_content_pinned','signal','public_content','evidence','generic']);
const PROVIDERS=new Set(['rule_based_v1','ai_composer_v1','rule_based_fallback_v1']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UxEventInput={
 admin:SupabaseClient|null;env:{VERCEL_ENV?:string;NODE_ENV?:string};now:()=>Date;
 kind:string;ux:{variant:string;assignment:string}|null;userId:string;
 row:{organization_id:string;prospect_id:string};
 outreach?:{id:string;angle_type?:string|null;provider?:string|null};
};
export async function recordUxEvent(i:UxEventInput):Promise<'recorded'|'skipped'|'deduped'|'failed'>{
 if(!uxAbEnabledFromEnv(i.env)||!(UX_KINDS as readonly string[]).includes(i.kind))return 'skipped';
 if(!i.ux||(i.ux.variant!=='A'&&i.ux.variant!=='B')||(i.ux.assignment!=='hashed'&&i.ux.assignment!=='forced'))return 'skipped';
 if(![i.userId,i.row?.organization_id,i.row?.prospect_id].every(v=>typeof v==='string'&&UUID.test(v)))return 'skipped';
 if(i.outreach&&!UUID.test(String(i.outreach.id)))return 'skipped';
 const payload:Record<string,unknown>={schema:1,experiment:UX_EXPERIMENT,variant:i.ux.variant,assignment:i.ux.assignment,user_id:i.userId};
 if(i.outreach){
  payload.outreach_id=i.outreach.id;
  if(i.outreach.angle_type&&ANGLE_TYPES.has(i.outreach.angle_type))payload.angle_type=i.outreach.angle_type;
  if(i.outreach.provider&&PROVIDERS.has(i.outreach.provider))payload.provider=i.outreach.provider;
 }
 try{
  if(!i.admin)return 'failed';
  const kind=`ux.${i.kind}`;
  if(i.kind==='prospect_detail_viewed'){
   const since=new Date(i.now().getTime()-UX_VIEW_DEDUPE_MINUTES*60000).toISOString();
   const {data,error}=await i.admin.from('events').select('id').eq('kind',kind).eq('prospect_id',i.row.prospect_id).is('actor_id',null)
    .eq('payload->>user_id',i.userId).eq('payload->>variant',i.ux.variant).gte('created_at',since).limit(1);
   if(error)return 'failed';
   if(data&&data.length)return 'deduped';
  }
  const {error}=await i.admin.from('events').insert({organization_id:i.row.organization_id,prospect_id:i.row.prospect_id,actor_id:null,kind,payload});
  return error?'failed':'recorded';
 }catch{return 'failed'}
}

// Zero-Friction ZF1 measurement (docs/ZERO_FRICTION.md). Same table, same rules: no actor (not business activity),
// closed numeric payload, no text, nothing written in Production. One event per kind per client session; the client
// counts only trusted user clicks/submits (never renders, loads, polling or automatic recomputations).
// UI-3: ZF_WHY_OPENED = level 2 ("Voir pourquoi"); ZF_ADVANCED_DETAILS_OPENED stays level 3 only.
export const ZF_KINDS=['ZF_SESSION_STARTED','ZF_TODAY_VIEWED','ZF_FIRST_RECOMMENDATION_VISIBLE','ZF_FIRST_MEANINGFUL_ACTION','ZF_ADVANCED_DETAILS_OPENED','ZF_WHY_OPENED'] as const;
export type ZfKind=typeof ZF_KINDS[number];
export type ZfEventInput={admin:SupabaseClient|null;env:{VERCEL_ENV?:string;NODE_ENV?:string;UX_AB_ENABLED?:string};enabled:boolean;userId:string;organizationId:string;
 // UI-3: the project the event belongs to, kept distinct from the organization (row column) in the payload.
 projectId?:string;
 kind:string;sessionId:string;elapsedMs:number;interactions:number};
export function zfPayload(i:Pick<ZfEventInput,'kind'|'sessionId'|'elapsedMs'|'interactions'|'userId'|'projectId'>):Record<string,unknown>|null{
 if(!(ZF_KINDS as readonly string[]).includes(i.kind)||!UUID.test(i.sessionId)||!UUID.test(i.userId))return null;
 if(!Number.isInteger(i.elapsedMs)||i.elapsedMs<0||i.elapsedMs>86400000||!Number.isInteger(i.interactions)||i.interactions<0||i.interactions>10000)return null;
 if(i.projectId!==undefined&&!UUID.test(i.projectId))return null;
 return {schema:1,experiment:'zero_friction_today',session_id:i.sessionId,elapsed_ms:i.elapsedMs,interactions:i.interactions,user_id:i.userId,
  ...(i.projectId?{project_id:i.projectId}:{})};
}
// Why a ZF event was not written — logged (no personal data) so a silent 202 can never hide a broken measurement again.
export type ZfOutcome='recorded'|'duplicate'|'flag_off'|'production'|'invalid'|'no_writer'|'failed';
// ZF1.1 (interactive canary): the gate is the ZF flag itself, set only on the Preview that runs the experiment, and an
// explicit Production never writes. It no longer depends on VERCEL_ENV being visible at runtime: on this project the
// Preview function does not see VERCEL_ENV (/api/public/ux-config answers "unknown"), so the former UX A/B gate
// (uxAbEnabledFromEnv) skipped every ZF event while the route still answered 202.
export function zfWritesAllowed(enabled:boolean,env:{VERCEL_ENV?:string}):'ok'|'flag_off'|'production'{
 if(!enabled)return 'flag_off';
 return env.VERCEL_ENV==='production'?'production':'ok';
}
export async function recordZfEvent(i:ZfEventInput):Promise<ZfOutcome>{
 const gate=zfWritesAllowed(i.enabled,i.env);if(gate!=='ok')return gate;
 if(!UUID.test(i.organizationId))return 'invalid';
 const payload=zfPayload(i);if(!payload)return 'invalid';
 try{
  if(!i.admin)return 'no_writer';
  const kind=`ux.${i.kind.toLowerCase()}`;
  const {data,error}=await i.admin.from('events').select('id').eq('kind',kind).is('actor_id',null).eq('payload->>session_id',i.sessionId).limit(1);
  if(error)return 'failed';
  if(data&&data.length)return 'duplicate';
  const r=await i.admin.from('events').insert({organization_id:i.organizationId,prospect_id:null,actor_id:null,kind,payload});
  return r.error?'failed':'recorded';
 }catch{return 'failed'}
}

// POST /zf-events (app/api/v1/[...path]/route.ts). The body is exactly what the browser's ZfSession sends (zfEventRequest,
// src/ux/zf-session.ts); the organization comes from a project the user can read with its own RLS client, the user from
// the session. Always answered 202 (measurement never fails the page); the outcome is logged, never returned.
export const ZfEventBody=z.object({kind:z.enum(ZF_KINDS),project_id:z.string().uuid(),session_id:z.string().uuid(),
 elapsed_ms:z.number().int().min(0),interactions:z.number().int().min(0)}).strict();
// enabled: a boolean, or (ZF org canary) a test of the project's organization resolved here under the caller's RLS.
export async function handleZfEvent(body:unknown,db:SupabaseClient,user:{id:string},deps:{admin:()=>SupabaseClient|null;env:ZfEventInput['env'];enabled:boolean|((organizationId:string)=>boolean);
 log:(line:Record<string,unknown>)=>void}):Promise<ZfOutcome>{
 const parsed=ZfEventBody.safeParse(body);
 const outcome:ZfOutcome=!parsed.success?'invalid':await (async()=>{
  const b=parsed.data;
  const {data:proj}=await db.from('projects').select('organization_id').eq('id',b.project_id).maybeSingle();
  if(!proj)return 'invalid';
  const enabled=typeof deps.enabled==='function'?deps.enabled(proj.organization_id):deps.enabled;
  return recordZfEvent({admin:deps.admin(),env:deps.env,enabled,userId:user.id,organizationId:proj.organization_id,projectId:b.project_id,kind:b.kind,
   sessionId:b.session_id,elapsedMs:b.elapsed_ms,interactions:b.interactions});
 })();
 deps.log({component:'zf-events',kind:parsed.success?parsed.data.kind:null,outcome});
 return outcome;
}
