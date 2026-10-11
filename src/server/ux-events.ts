// UX A/B instrumentation, server side only, in the existing append-only public.events table (no migration).
// - organization_id and prospect_id come from a row the route read with the user's own RLS client; user_id is the
//   session's user. The x-prospectos-ux label is only a label, never read by any check.
// - actor_id stays NULL on purpose: beta_analytics' last_business_activity_at is max(events.created_at) where
//   actor_id = the user (migrations 013/018). A UX event is not business activity; the user id is kept in payload.user_id.
// - Closed payload, no text: no message, prompt, source, key or credential. Production writes nothing. Best-effort: a
//   failure never breaks the user's request.
import type {SupabaseClient} from '@supabase/supabase-js';
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
