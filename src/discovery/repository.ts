import type {SupabaseClient} from '@supabase/supabase-js';
import type {DiscoveryRepository} from './services.ts';
import type {Candidate,DiscoveryInput,DiscoveryResult,DiscoveryRun,Observation} from './types.ts';
import type {DeduplicationService} from './deduplication.ts';
import {projectCriteria as resolveProjectCriteria} from '../domain/relations.ts';
// The original Postgres error (message/code) is kept as .cause for server-side logging only — the
// thrown message itself is unchanged, so existing error-code routing and the user-facing text stay
// exactly as before. Never exposed to the client: routes only ever return the generic mapped message.
export async function checked(query:PromiseLike<any>){const {data,error}=await query;if(error){if(error.message?.includes('quota_exceeded'))throw Error('QUOTA_EXCEEDED');if(error.message?.includes('max_results'))throw Error('MAX_RESULTS_EXCEEDED');throw Error('DATABASE_REQUEST_FAILED',{cause:error})}return data}
// save_discovery_observations requires: UNKNOWN => value null; any other status with a non-null
// criterion => a concrete boolean value (it creates/updates an Evidence row from it). A generic,
// non-conclusive lexical candidate (status INFERRED, value null — see strategies/generic.ts) has no
// boolean to give it, so persisting it unchanged would be rejected by that check. It is stored as a
// criterion-less contextual observation instead (its claim already names the criterion by label) —
// never silently dropped, never given a fabricated value, and never mistaken for "no information
// found" (UNKNOWN, which always has an empty excerpt).
export function toStorageSafeObservation(o:Observation):Observation{return o.status!=='UNKNOWN'&&o.criterion!==null&&o.value===null?{...o,criterion:null}:o}
export class SupabaseDiscoveryRepository implements DiscoveryRepository {
 db:SupabaseClient;
 constructor(db:SupabaseClient){this.db=db}
 async start(input:DiscoveryInput,provider:string){return checked(this.db.rpc('start_discovery',{p_project_id:input.project_id,p_query:input.query,p_location:input.location,p_categories:input.categories,p_provider:provider,p_max_results:input.max_results,p_filters:input.optional_filters}))}
 async existing(projectId:string){const rows=await checked(this.db.from('prospects').select('id,name,website,city,channels(kind,value)').eq('project_id',projectId));return rows.map((p:any)=>({...p,phone:p.channels?.find((c:any)=>c.kind==='phone')?.value??null,address:null}))}
 async saveResults(run:DiscoveryRun,rows:Array<{candidate:Candidate;dedupe:ReturnType<DeduplicationService['match']>}>):Promise<DiscoveryResult[]>{
 const full=await checked(this.db.from('discovery_runs').select('*').eq('id',run.id).single());if(!rows.length)return [];
 return checked(this.db.from('discovery_results').insert(rows.map(({candidate:c,dedupe:d})=>({organization_id:full.organization_id,project_id:full.project_id,discovery_run_id:run.id,company_name:c.name,website:c.website,phone:c.phone,address:c.address,city:c.city,source_url:c.source_url,source_title:c.source_title,provider:c.discovered_source,raw_payload:c.raw_metadata,normalized_payload:c,dedupe_key:c.deduplication_key,dedupe_status:d.status,duplicate_of:d.duplicate_of,reason:d.reason}))).select('*'));
 }
 async finish(id:string,count:number,metrics:Record<string,unknown>,error?:string){await checked(this.db.from('discovery_runs').update({status:error?'failed':'completed',result_count:count,completed_at:new Date().toISOString(),metrics,error_message:error??null}).eq('id',id))}
 async prospect(id:string){return checked(this.db.from('prospects').select('id,website,organization_id,project_id').eq('id',id).single())}
 async projectCriteria(projectId:string){const project=await checked(this.db.from('projects').select('*,icps(*)').eq('id',projectId).single());return resolveProjectCriteria(project.icps)}
 async consumeAnalysis(id:string){await checked(this.db.rpc('consume_analysis_quota',{p_prospect_id:id}))}
 async saveObservations(id:string,observations:Observation[]){return checked(this.db.rpc('save_discovery_observations',{p_prospect_id:id,p_observations:observations.map(toStorageSafeObservation)}))}
}
