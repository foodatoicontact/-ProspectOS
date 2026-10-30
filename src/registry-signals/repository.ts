// Signaux SIRENE — the Supabase side (migration 038). The run is started with the MEMBER's client (membership, plan,
// hourly limit, one Discovery unit); candidates, run closing, refund and the register cache go through the server's
// privileged client to the service-role-only functions and table, which re-check the member themselves.
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import type {ResponseCache} from './cache.ts';
import type {CandidateRow,RegistrySignalsRepository,StartedRun} from './row.ts';
export {CANDIDATE_ROW_FIELDS,toCandidateRow} from './row.ts';

export class SupabaseRegistrySignalsRepository implements RegistrySignalsRepository{
 private readonly db:SupabaseClient;private readonly writer:SupabaseClient;private readonly userId:string;
 constructor(db:SupabaseClient,writer:SupabaseClient,userId:string){this.db=db;this.writer=writer;this.userId=userId}
 async start(projectId:string,preset:string,postalCode:string,maxResults:number):Promise<StartedRun>{
  return checked(this.db.rpc('start_registry_signal_run',{p_project_id:projectId,p_preset:preset,p_postal_code:postalCode,p_max_results:maxResults}));
 }
 async saveCandidates(runId:string,rows:CandidateRow[]){
  return checked(this.writer.rpc('save_registry_signal_candidates',{p_user_id:this.userId,p_run_id:runId,p_items:rows}));
 }
 async complete(runId:string,status:'completed'|'failed',metrics:Record<string,unknown>,errorCode:string|null):Promise<boolean>{
  return !!(await checked(this.writer.rpc('complete_registry_signal_run',{p_run_id:runId,p_status:status,p_metrics:metrics,p_error:errorCode})));
 }
 async release(runId:string):Promise<boolean>{return !!(await checked(this.writer.rpc('release_failed_registry_signal_run',{p_run_id:runId})))}
}

// The register cache in the database (shared by every server instance). Best effort: a cache that fails never fails
// a search, it only stops saving requests. Register pages only: the table refuses any key but 'sirene:<sha256>'.
export class SupabaseResponseCache implements ResponseCache{
 private readonly writer:SupabaseClient;private readonly now:()=>Date;private readonly log?:(line:Record<string,unknown>)=>void;
 constructor(writer:SupabaseClient,now:()=>Date=()=>new Date(),log?:(line:Record<string,unknown>)=>void){this.writer=writer;this.now=now;this.log=log}
 async get(key:string){
  if(!key.startsWith('sirene:'))return undefined;
  const {data,error}=await this.writer.from('registry_signal_cache').select('payload').eq('key',key).gt('expires_at',this.now().toISOString()).maybeSingle();
  if(error){this.log?.({component:'registry_signals',event:'cache_read_failed'});return undefined}
  return data?.payload??undefined;
 }
 async set(key:string,value:unknown,ttlSeconds:number){
  if(!key.startsWith('sirene:')||ttlSeconds<=0)return;
  const {error}=await this.writer.from('registry_signal_cache').upsert({key,payload:value,expires_at:new Date(+this.now()+ttlSeconds*1000).toISOString()});
  if(error)this.log?.({component:'registry_signals',event:'cache_write_failed'});
 }
}
