import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {safeLink} from '../domain/core.ts';
import {DEFAULT_STYLE_PROFILE,validateStyleProfile,styleOf} from './style.ts';
// O1/O2 API. Every route runs as the user (RLS); writes go through the migration-027 functions, which check
// membership, force the owner / reviewer to auth.uid() and keep public content PENDING_REVIEW until a person reviews it.
// Nothing here fetches a page: public content is what the user pastes, with its URL kept as a reference (a LinkedIn
// URL included — ProspectOS never reads LinkedIn).
//
//  GET  /outreach-style?organization_id=     the caller's own style profile (or the default, not saved)
//  PUT  /outreach-style                      {organization_id, profile} save the caller's own profile
//  GET  /prospects/:id/public-content        the prospect's public content (all statuses)
//  POST /prospects/:id/public-content        {source_url, content, author?, published_at?} → PENDING_REVIEW
//  POST /public-content/:id/review           {decision: verify | reject | reset}
//  POST /public-content/:id/pin              {pinned: boolean} (VERIFIED only, one per prospect)
//  DELETE /public-content/:id
type Json=(value:unknown,status?:number)=>Response;
export type OutreachDeps={requireEntitlement:()=>Promise<void>};
const uuid=z.string().uuid();
const PublicContentSchema=z.object({source_url:z.string().max(2048),content:z.string().trim().min(1).max(4000),author:z.string().trim().min(1).max(200).nullable().optional(),
 published_at:z.string().datetime({offset:true}).nullable().optional()}).strict();
const ReviewSchema=z.object({decision:z.enum(['verify','reject','reset'])}).strict();
const PinSchema=z.object({pinned:z.boolean()}).strict();
export const PUBLIC_CONTENT_COLUMNS='id,prospect_id,source_type,source_url,source_domain,author,content,published_at,observed_at,provider,status,pinned,reviewed_by,reviewed_at,created_at';
export async function handleOutreachIntelligence(request:Request,path:string[],body:Record<string,unknown>,db:SupabaseClient,json:Json,deps:OutreachDeps):Promise<Response|null>{
 const [resource,id,action]=path;const method=request.method;
 if(resource==='outreach-style'){
  if(method==='GET'){
   const org=new URL(request.url).searchParams.get('organization_id');if(!uuid.safeParse(org).success)return json({error:'Identifiant invalide'},400);
   const rows=await checked(db.from('outreach_style_profiles').select('*').eq('organization_id',org).limit(1));
   const row=(rows??[])[0]??null;return json({profile:row?styleOf(row):DEFAULT_STYLE_PROFILE,id:row?.id??null,saved:!!row});
  }
  if(method==='PUT'){
   if(!uuid.safeParse(body.organization_id).success)return json({error:'Identifiant invalide'},400);
   const v=validateStyleProfile(body.profile);if(!v.ok)return json({error:'Profil de style invalide'},400);
   return json(await checked(db.rpc('save_outreach_style_profile',{p_organization_id:body.organization_id,p_profile:v.profile})));
  }
  return null;
 }
 if(resource==='prospects'&&action==='public-content'){
  if(!uuid.safeParse(id).success)return json({error:'Identifiant invalide'},400);
  if(method==='GET')return json(await checked(db.from('prospect_public_content').select(PUBLIC_CONTENT_COLUMNS).eq('prospect_id',id).order('created_at',{ascending:false}).limit(100)));
  if(method==='POST'){
   await deps.requireEntitlement();
   const parsed=PublicContentSchema.safeParse(body);if(!parsed.success||!safeLink(parsed.data.source_url))return json({error:'Contenu public invalide : URL source et texte requis'},400);
   return json(await checked(db.rpc('save_public_content',{p_prospect_id:id,p_item:parsed.data})),201);
  }
  return null;
 }
 if(resource==='public-content'){
  if(!uuid.safeParse(id).success)return json({error:'Identifiant invalide'},400);
  if(method==='DELETE'&&!action)return json({deleted:await checked(db.rpc('delete_public_content',{p_id:id}))});
  if(method!=='POST')return null;
  if(action==='review'){const p=ReviewSchema.safeParse(body);if(!p.success)return json({error:'Décision invalide'},400);return json(await checked(db.rpc('review_public_content',{p_id:id,p_decision:p.data.decision})))}
  if(action==='pin'){const p=PinSchema.safeParse(body);if(!p.success)return json({error:'Épinglage invalide'},400);return json(await checked(db.rpc('pin_public_content',{p_id:id,p_pinned:p.data.pinned})))}
  return null;
 }
 return null;
}
