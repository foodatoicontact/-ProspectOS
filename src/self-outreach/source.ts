// Everything one candidate is built from, read through the given client (the member's under RLS for the API, the
// server's for the follow-up job): the project (offer, ICP), the company and its evidence, its signals, the intent
// profile — then the Next Best Action engine computes the scores (src/nba/engine.ts), unchanged.
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {projectCriteria} from '../domain/relations.ts';
import {attachEvidenceSources} from '../server/evidence-sources.ts';
import {intentProfileOf,signalRow} from '../signals/context.ts';
import {buildOpportunity,classifySignal,icpZoneOf,NBA_DEFAULT_CONFIG,type NbaSignal,type Opportunity,type ClassifiedSignal} from '../nba/engine.ts';
export const SIGNAL_COLUMNS='id,prospect_id,provider,signal_type,status,title,excerpt,source_url,source_domain,source_type,confidence,event_date,published_at,observed_at,matched_terms,event_key,raw_metadata';
export type CandidateSource={project:{id:string;organization_id:string;offer:string};prospect:{id:string;name:string;project_id:string;status:string};
 evidence:any[];signals:NbaSignal[];signal:NbaSignal;classified:ClassifiedSignal|null;opportunity:Opportunity};
export async function loadCandidateSource(db:SupabaseClient,prospectId:string,signalId:string,now:Date):Promise<CandidateSource|null>{
 const p=await checked(db.from('prospects').select('id,name,project_id,organization_id,status,evidence(*)').eq('id',prospectId).single());
 const [withSources]=await attachEvidenceSources(db,[p]);
 const project=await checked(db.from('projects').select('id,organization_id,offer,icps(*)').eq('id',p.project_id).single());
 const rows=await checked(db.from('signals').select(SIGNAL_COLUMNS).eq('prospect_id',p.id).in('status',['VERIFIED','PENDING_REVIEW']).limit(200));
 const signals:NbaSignal[]=(rows??[]).map((r:any)=>({...signalRow(r),provider:r.provider,event_key:r.event_key,raw_metadata:r.raw_metadata??null}));
 const signal=signals.find(s=>s.id===signalId);if(!signal)return null;
 const criteria=projectCriteria(project.icps);
 const opportunity=buildOpportunity({prospect:{id:p.id,project_id:p.project_id,name:p.name,status:p.status},criteria,evidence:withSources.evidence??[],
  signals,publicContent:[],profile:await intentProfileOf(db,p.project_id),now});
 const classified=classifySignal(signal,now,NBA_DEFAULT_CONFIG,icpZoneOf(criteria));
 return {project:{id:project.id,organization_id:project.organization_id,offer:project.offer??''},prospect:{id:p.id,name:p.name,project_id:p.project_id,status:p.status},
  evidence:withSources.evidence??[],signals,signal,classified,opportunity};
}
