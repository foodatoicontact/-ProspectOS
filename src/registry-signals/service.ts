// Signaux SIRENE — one search, end to end: recent establishments from the register (sirene.ts), then for each one the
// Google lookup and the prudent match (places.ts, match.ts), then one signal per establishment (signal.ts). Pure
// orchestration with injected sources: no database here (repository.ts / api.ts store the signals as NEW candidates
// for a person to review — nothing is ever sent, nothing becomes a prospect by itself).
import type {Preset} from './presets.ts';
import {searchRecentEstablishments,type SireneDeps,type SireneReport} from './sirene.ts';
import {lookupPlace,type PlacesDeps} from './places.ts';
import {buildSignal,toStoredSignal,type RegistrySignal} from './signal.ts';
import {toCandidateRow,type RegistrySignalsRepository} from './row.ts';

export const MAX_RESULTS_CEILING=50;
export type RunInput={preset:Preset;postalCode:string;maxResults:number;now:Date};
export type RunDeps={sirene:SireneDeps;places:PlacesDeps|null;log?:(line:Record<string,unknown>)=>void};
export type RunReport={sirene:SireneReport;found:number;returned:number;places:{queried:number;requests:number;retried:number;confirme:number;non_confirme:number;absent:number;
 failures:Record<string,number>}|null};

export async function runRegistrySignals(input:RunInput,deps:RunDeps):Promise<{signals:RegistrySignal[];report:RunReport}>{
 if(!Number.isInteger(input.maxResults)||input.maxResults<1||input.maxResults>MAX_RESULTS_CEILING)throw Error('INVALID_MAX_RESULTS');
 const {establishments,report:sirene}=await searchRecentEstablishments(input.preset,input.postalCode,input.now,deps.sirene);
 // Most recent first (sirene.ts order); only what will be shown is looked up on Google.
 const selected=establishments.slice(0,input.maxResults);
 const places=deps.places?{queried:0,requests:0,retried:0,confirme:0,non_confirme:0,absent:0,failures:{} as Record<string,number>}:null;
 const sentBefore=deps.places?.limiter.stats.sent??0,retriedBefore=deps.places?.limiter.stats.retried??0;
 const signals:RegistrySignal[]=[];
 for(const e of selected){
  let lookup=null;
  if(deps.places&&places){
   lookup=await lookupPlace({names:e.names,address:e.adresse,postalCode:e.code_postal,commune:e.commune},[...e.signs,e.denomination],deps.places);
   places.queried++;
   if(lookup.failure)places.failures[lookup.failure]=(places.failures[lookup.failure]??0)+1;
   else places[lookup.status]++;
   // The key or the API refused: every next call would fail the same way. Stop asking; the rest stay unqueried.
   if(lookup.failure==='PLACES_HTTP_403'||lookup.failure==='PLACES_HTTP_401'){signals.push(buildSignal(e,lookup,input.preset.name_keywords,input.now));break}
  }
  signals.push(buildSignal(e,lookup,input.preset.name_keywords,input.now));
 }
 // Establishments left unqueried after a refused key keep their register data, with no Google verdict.
 for(const e of selected.slice(signals.length))signals.push(buildSignal(e,null,input.preset.name_keywords,input.now));
 if(places&&deps.places){places.requests=deps.places.limiter.stats.sent-sentBefore;places.retried=deps.places.limiter.stats.retried-retriedBefore}
 const report:RunReport={sirene,found:establishments.length,returned:signals.length,places};
 deps.log?.({component:'registry_signals',event:'run',preset:input.preset.key,postal_code:input.postalCode,found:report.found,returned:report.returned,
  places:places?{queried:places.queried,confirme:places.confirme,non_confirme:places.non_confirme,absent:places.absent,failures:places.failures,requests:places.requests}:null});
 return {signals,report};
}

// ── A stored run (API): the database decides first, then the sources, then the NEW candidates, then the run is closed.

const SAVE_CHUNK=25;
export type StoredRunResult={run_id:string;status:'completed'|'failed';error_code:string|null;refunded:boolean;metrics:Record<string,unknown>;signals:RegistrySignal[]};
const safeCode=(e:unknown)=>{const m=e instanceof Error?e.message:'';return /^[A-Z0-9_]{1,60}$/.test(m)?m:'REGISTRY_SIGNALS_FAILED'};

export async function runAndStoreRegistrySignals(input:RunInput&{projectId:string},deps:RunDeps&{repo:RegistrySignalsRepository}):Promise<StoredRunResult>{
 // 1. Membership, plan, hourly limit and the Discovery unit: refused here, nothing is requested.
 const run=await deps.repo.start(input.projectId,input.preset.key,input.postalCode,input.maxResults);
 const metrics:Record<string,unknown>={requests_answered:0};let signals:RegistrySignal[]=[];
 const finish=async(status:'completed'|'failed',errorCode:string|null):Promise<StoredRunResult>=>{
  let closed=false;try{closed=await deps.repo.complete(run.id,status,metrics,errorCode)}catch{/* reported below */}
  // The refund contract: failed AND the register answered no request.
  let refunded=false;
  if(status==='failed'&&metrics.requests_answered===0&&closed){try{refunded=await deps.repo.release(run.id)}catch{refunded=false}}
  if(!closed){status='failed';errorCode=errorCode??'RUN_CLOSE_FAILED'}
  deps.log?.({component:'registry_signals',event:'run_closed',run_id:run.id,status,error_code:errorCode,refunded,closed});
  return {run_id:run.id,status,error_code:errorCode,refunded,metrics,signals:status==='completed'?signals:[]};
 };
 let out;
 try{out=await runRegistrySignals(input,deps)}
 catch(e){return finish('failed',safeCode(e))}
 signals=out.signals;
 // Register pages read from the network (cached pages cost nothing and answer nothing).
 metrics.requests_answered=out.report.sirene.pages-out.report.sirene.cache_hits;
 Object.assign(metrics,{found:out.report.found,returned:out.report.returned,saved:0,duplicates:0,
  sirene:{pages:out.report.sirene.pages,total_results:out.report.sirene.total_results,examined:out.report.sirene.examined,excluded:out.report.sirene.excluded,
   requests:out.report.sirene.requests,retried:out.report.sirene.retried,cache_hits:out.report.sirene.cache_hits,failure:out.report.sirene.failure},
  places:out.report.places});
 // 2. Saved through the server path, in their stored form (no Google content). A storage failure after the register
 // answered is a FAILED run, never a "completed" one, and its unit is not given back.
 const rows=out.signals.map(s=>toCandidateRow(toStoredSignal(s)));
 try{
  for(let i=0;i<rows.length;i+=SAVE_CHUNK){const r=await deps.repo.saveCandidates(run.id,rows.slice(i,i+SAVE_CHUNK));
   metrics.saved=(metrics.saved as number)+r.inserted;metrics.duplicates=(metrics.duplicates as number)+r.duplicates}
 }catch{return finish('failed','PERSISTENCE_FAILED')}
 return finish('completed',null);
}
