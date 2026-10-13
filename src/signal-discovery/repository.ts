// Signal-first Discovery V1 — the Supabase side of the service (migration 030). The run is started with the
// MEMBER's client (auth.uid(): membership, plan, hourly limit, the Discovery unit). Candidates, run closing and refund
// go through the server's privileged client to the service-role-only functions, which re-check the member themselves.
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import type {CandidateRow} from './record.ts';
import type {RunMetrics,SignalDiscoveryInput,SignalDiscoveryRepository,StartedRun} from './service.ts';

export class SupabaseSignalDiscoveryRepository implements SignalDiscoveryRepository{
 private readonly db:SupabaseClient;private readonly writer:SupabaseClient;private readonly userId:string;
 constructor(db:SupabaseClient,writer:SupabaseClient,userId:string){this.db=db;this.writer=writer;this.userId=userId}
 async start(input:SignalDiscoveryInput,provider:'brave'|'fixture'):Promise<StartedRun>{
  return checked(this.db.rpc('start_signal_discovery',{p_project_id:input.project_id,p_query:input.query,p_location:input.location,
   p_signal_types:input.signal_types,p_provider:provider,p_max_results:input.max_results}));
 }
 async saveCandidates(runId:string,rows:CandidateRow[]){
  return checked(this.writer.rpc('save_signal_discovery_candidates',{p_user_id:this.userId,p_run_id:runId,p_items:rows}));
 }
 async complete(runId:string,status:'completed'|'failed',metrics:RunMetrics,errorCode:string|null){
  return checked(this.writer.rpc('complete_signal_discovery_run',{p_run_id:runId,p_status:status,p_metrics:metrics,p_error:errorCode}));
 }
 async release(runId:string){
  return checked(this.writer.rpc('release_failed_signal_discovery',{p_run_id:runId}));
 }
}
