// Signal-first Discovery V1 — one run, end to end:
//   start (database: membership, project, plan + hourly limits, ONE Discovery unit) → P1 plan (≤3 queries)
//   → provider requests, counted → P1 extraction, entity resolution, ICP pre-filter, grouping, review order
//   → save the candidates (database, server path) → close the run with its metrics → refund only when the source
//   answered no request.
// This file only orchestrates: every rule about events, dates, entities and order lives in plan.ts, extract.ts,
// entity.ts and rank.ts; the row format in record.ts. Nothing here creates a prospect, a signal, evidence or an
// observation, and nothing reads or changes FIT or INTENT.
import {planSignalQueries,MAX_SIGNAL_QUERIES} from './plan.ts';
import {rankSignalCandidates,type IcpTarget} from './rank.ts';
import {toCandidateRow,type CandidateRow} from './record.ts';
import type {SearchHit} from './extract.ts';
import type {SignalSearchProvider} from './provider.ts';

export type SignalDiscoveryInput={project_id:string;query:string;location:string;categories:string[];signal_types:Array<'new_site'|'expansion'>;max_results:number};
export type StartedRun={id:string;organization_id:string;project_id:string};
// The database side (migration 030). start runs as the member; the other calls are the server's privileged path.
export interface SignalDiscoveryRepository{
 start(input:SignalDiscoveryInput,provider:SignalSearchProvider['id']):Promise<StartedRun>;
 saveCandidates(runId:string,rows:CandidateRow[]):Promise<{inserted:number;duplicates:number}>;
 complete(runId:string,status:'completed'|'failed',metrics:RunMetrics,errorCode:string|null):Promise<boolean>;
 release(runId:string):Promise<boolean>;
}
export type RunMetrics={
 queries_planned:number;
 // A request is SENT when the provider is called (one call = one request). It is ANSWERED when the call returned a
 // valid answer — zero results included. An exception (network, timeout, HTTP error, invalid or oversized body) is
 // sent but not answered.
 requests_sent:number;requests_answered:number;requests_failed:number;failure_codes:string[];
 results_received:number;candidates:number;out_of_icp:number;saved:number;duplicates:number;merged:number;truncated:number;
 rejected:Record<string,number>;out_of_time:boolean;
};
export type SignalDiscoveryResult={run_id:string;status:'completed'|'failed';error_code:string|null;refunded:boolean;metrics:RunMetrics};
export type ServiceDeps={
 repo:SignalDiscoveryRepository;provider:SignalSearchProvider;now:()=>Date;
 // Records the real requests sent to a billed source (api_usage_events). Best-effort, never blocks the run.
 meter?:(run:StartedRun,requestCount:number)=>Promise<void>;
 log?:(line:Record<string,unknown>)=>void;
 clock?:()=>number;deadlineMs?:number;country?:string;searchLang?:string;
};
export const SEARCH_DEADLINE_MS=40000;
const SAVE_CHUNK=100;
// Codes only — never a key, a URL, a query or a provider payload.
const safeCode=(e:unknown)=>{const m=e instanceof Error?e.message:'';return /^[A-Z0-9_]{1,60}$/.test(m)?m:'PROVIDER_ERROR'};

export async function runSignalDiscovery(input:SignalDiscoveryInput,deps:ServiceDeps):Promise<SignalDiscoveryResult>{
 const clock=deps.clock??(()=>Date.now());const deadline=deps.deadlineMs??SEARCH_DEADLINE_MS;
 const log=deps.log??(()=>{});
 // 1. The database decides first: no run, no unit, no request when the member, the plan or the hourly limit refuse.
 const run=await deps.repo.start(input,deps.provider.id);
 const now=deps.now();const started=clock();
 const subjects=[input.query,...input.categories];
 const plan=planSignalQueries({subjects,location:input.location,signal_types:input.signal_types,max_results:input.max_results,now});
 const m:RunMetrics={queries_planned:plan.queries.length,requests_sent:0,requests_answered:0,requests_failed:0,failure_codes:[],results_received:0,
  candidates:0,out_of_icp:0,saved:0,duplicates:0,merged:0,truncated:0,rejected:{},out_of_time:false};
 const hits:SearchHit[]=[];
 // 2. At most 3 requests, one after the other; a rate limit stops the remaining ones instead of spending them.
 for(const q of plan.queries.slice(0,MAX_SIGNAL_QUERIES)){
  if(clock()-started>=deadline){m.out_of_time=true;break}
  m.requests_sent++;
  try{
   const found=await deps.provider.search({q:q.q,freshness:plan.freshness,country:deps.country??'FR',search_lang:deps.searchLang??'fr',count:20});
   m.requests_answered++;m.results_received+=found.length;hits.push(...found);
  }catch(e){
   m.requests_failed++;const code=safeCode(e);m.failure_codes.push(code);
   if(code==='BRAVE_HTTP_429')break;
  }
 }
 if(deps.provider.metered&&m.requests_sent>0&&deps.meter){try{await deps.meter(run,m.requests_sent)}catch{/* the cost ledger is best-effort */}}
 const finish=async(status:'completed'|'failed',errorCode:string|null):Promise<SignalDiscoveryResult>=>{
  let closed=false;try{closed=await deps.repo.complete(run.id,status,m,errorCode)}catch{/* reported below */}
  // 3. The refund contract: failed AND no request answered. Never for zero results, filtered or out-of-ICP results.
  let refunded=false;
  if(status==='failed'&&m.requests_answered===0&&closed){try{refunded=await deps.repo.release(run.id)}catch{refunded=false}}
  // A run the database could not close is never reported as completed.
  if(!closed){status='failed';errorCode=errorCode??'RUN_CLOSE_FAILED'}
  log({component:'signal-discovery',run_id:run.id,provider:deps.provider.id,status,error_code:errorCode,requests_sent:m.requests_sent,
   requests_answered:m.requests_answered,results:m.results_received,candidates:m.candidates,saved:m.saved,refunded,closed});
  return {run_id:run.id,status,error_code:errorCode,refunded,metrics:m};
 };
 if(m.requests_answered===0)return finish('failed','PROVIDER_UNAVAILABLE');
 // 4. P1, unchanged: events, entities, ICP pre-filter, grouping, review order.
 const outcome=rankSignalCandidates(hits,{target:{activity_terms:subjects,location:input.location} satisfies IcpTarget,now,max_results:plan.max_results});
 m.rejected=outcome.rejected as Record<string,number>;m.merged=outcome.merged;m.truncated=outcome.truncated;
 m.candidates=outcome.review.length;m.out_of_icp=outcome.out_of_icp.length;
 const rows=[...outcome.review,...outcome.out_of_icp].map(toCandidateRow);
 // 5. Saved through the server path. A storage failure after an answered request is a FAILED run, never a
 // "completed" one, and its unit is not given back (the source did answer).
 try{
  for(let i=0;i<rows.length;i+=SAVE_CHUNK){const r=await deps.repo.saveCandidates(run.id,rows.slice(i,i+SAVE_CHUNK));m.saved+=r.inserted;m.duplicates+=r.duplicates}
 }catch{return finish('failed','PERSISTENCE_FAILED')}
 return finish('completed',null);
}
