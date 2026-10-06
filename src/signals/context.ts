import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {IntentProfileSchema,type IntentProfile} from './types.ts';
import type {IntentSignal} from '../domain/intent.ts';
import {projectCriteria} from '../domain/relations.ts';
import {attachEvidenceSources} from '../server/evidence-sources.ts';
import {contactSnapshot} from '../domain/feedback.ts';
// What the server knows about one prospect for INTENT, "why now" and the contact snapshot — read as the user (RLS).
export type SignalRow=IntentSignal&{source_type:string};
export const signalRow=(r:Record<string,any>):SignalRow=>({id:r.id,signal_type:r.signal_type,status:r.status,title:r.title,excerpt:r.excerpt,source_url:r.source_url,
 source_domain:r.source_domain??null,source_type:r.source_type,confidence:Number(r.confidence),event_date:r.event_date??null,published_at:r.published_at??null,observed_at:r.observed_at,matched_terms:r.matched_terms??[]});

export async function intentProfileOf(db:SupabaseClient,projectId:string):Promise<IntentProfile|null>{
 const rows=await checked(db.from('intent_profiles').select('profile').eq('project_id',projectId));
 const parsed=IntentProfileSchema.safeParse(rows?.[0]?.profile);return parsed.success?parsed.data:null;
}
export async function verifiedSignalsOf(db:SupabaseClient,prospectId:string):Promise<SignalRow[]>{
 const rows=await checked(db.from('signals').select('id,signal_type,status,title,excerpt,source_url,source_domain,source_type,confidence,event_date,published_at,observed_at,matched_terms')
  .eq('prospect_id',prospectId).eq('status','VERIFIED').limit(200));
 return (rows??[]).map(signalRow);
}

// Freezes "why we contacted them" (migration 025). Best-effort by design: a snapshot that cannot be written never
// blocks the action that triggered it (marking a message used, moving the prospect to "Contacté").
export async function recordContactSnapshot(db:SupabaseClient,prospectId:string,outreachId:string|null,trigger:'outreach_used'|'status_contacted',now=new Date()):Promise<boolean>{
 try{
  const p=await checked(db.from('prospects').select('id,project_id,evidence(*)').eq('id',prospectId).single());
  const [withSources]=await attachEvidenceSources(db,[p]);
  const project=await checked(db.from('projects').select('id,icps(*)').eq('id',p.project_id).single());
  const snapshot=contactSnapshot({criteria:projectCriteria(project.icps),evidence:withSources.evidence??[],signals:await verifiedSignalsOf(db,prospectId),profile:await intentProfileOf(db,p.project_id),now});
  const {error}=await db.rpc('record_contact_snapshot',{p_prospect_id:prospectId,p_outreach_id:outreachId,p_trigger:trigger,p_snapshot:snapshot});
  return !error;
 }catch{return false}
}
