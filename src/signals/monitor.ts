import type {SupabaseClient} from '@supabase/supabase-js';
import {timingSafeEqual,createHash} from 'node:crypto';
import {runSignalScan,type ScanReport} from './service.ts';
import type {SignalProvider,SignalTarget} from './provider.ts';
import {OfficialSiteSignalProvider,type SiteFetcher} from './providers/site.ts';
import {BodaccSignalProvider,sirenOf} from './providers/bodacc.ts';
import {IntentProfileSchema} from './types.ts';
import {resolveAnalysisAuthorization,type AcceptedDiscoveryResult,type AnalysisAuthorization} from '../discovery/analysis-authorization.ts';
import type {AnalysisAudit} from '../discovery/website-analysis.ts';
// Signal Engine S9 — the monitoring worker behind /api/cron/signals. Claims due monitors (migration 026: SKIP LOCKED,
// one run per prospect per day, lease), reads the company's own website when the server's authorization allows it
// (same rule and audit as "Analyser le site", in the name of the member who asked) and its BODACC announcements by
// the register's SIREN, saves what it found PENDING_REVIEW through save_monitor_signals, and closes each run with its
// counts. Every query names the run's organization explicitly: the privileged client never reads across tenants.
export type MonitorDeps={
 admin:SupabaseClient;now:()=>Date;clock?:()=>number;
 budgetMs:number;batch:number;
 staticAllowlist:string[];dynamicEnabled:boolean;bodaccEnabled:boolean;
 sitePageFetcher:(policy:Extract<AnalysisAuthorization,{ok:true}>['fetchPolicy'])=>SiteFetcher;
 bodaccProvider:()=>BodaccSignalProvider;
 audit:(userId:string)=>AnalysisAudit;
 log?:(event:Record<string,string|number|null>)=>void;
};
type Claimed={run_id:string;prospect_id:string;organization_id:string;created_by:string};
export type MonitorSummary={claimed:number;completed:number;partial:number;failed:number;inserted:number;out_of_time:boolean};

// Constant-time comparison of the cron secret (hash first, so lengths never leak).
export function cronAuthorized(header:string|null,secret:string|undefined):'ok'|'unauthorized'|'not_configured'{
 if(!secret||secret.length<16)return 'not_configured';
 const given=(header??'').startsWith('Bearer ')?(header??'').slice(7):'';
 const a=createHash('sha256').update(given).digest(),b=createHash('sha256').update(secret).digest();
 return given&&timingSafeEqual(a,b)?'ok':'unauthorized';
}

async function one(d:MonitorDeps,c:Claimed):Promise<{status:'completed'|'partial'|'failed';report:ScanReport|null;code:string|null}>{
 const {data:p,error}=await d.admin.from('prospects').select('id,name,website,city,project_id,organization_id').eq('id',c.prospect_id).eq('organization_id',c.organization_id).single();
 if(error||!p)return {status:'failed',report:null,code:'PROSPECT_NOT_FOUND'};
 const {data:accepted}=await d.admin.from('discovery_results').select('status,provider,source_class,website,source_url,raw_payload').eq('prospect_id',p.id).eq('organization_id',c.organization_id).eq('status','accepted');
 const acc=(accepted??[]) as AcceptedDiscoveryResult[];
 const {data:prof}=await d.admin.from('intent_profiles').select('profile').eq('project_id',p.project_id).eq('organization_id',c.organization_id);
 const parsed=IntentProfileSchema.safeParse(prof?.[0]?.profile);const profile=parsed.success?parsed.data:null;
 const siren=d.bodaccEnabled?sirenOf(acc):null;
 const providers:SignalProvider[]=[];
 let site:OfficialSiteSignalProvider|null=null;let auditId:string|null=null;const audit=d.audit(c.created_by);
 if(p.website&&!acc.every(r=>r.provider==='fixture')){
  const auth=resolveAnalysisAuthorization({prospectWebsite:p.website,acceptedResults:acc,staticAllowlist:d.staticAllowlist,dynamicEnabled:d.dynamicEnabled});
  if(auth.ok){
   try{auditId=await audit.record({userId:c.created_by,prospectId:p.id,host:/^[a-z0-9.-]{1,253}$/.test(auth.host)?auth.host:null,mode:auth.mode,outcome:'STARTED'})}catch{auditId=null}
   // No audit, no fetch.
   if(auditId){site=new OfficialSiteSignalProvider(d.sitePageFetcher(auth.fetchPolicy),auth.url);providers.push(site)}
  }
 }
 if(siren)providers.push(d.bodaccProvider());
 if(!providers.length)return {status:'completed',report:null,code:'NO_SOURCE'};
 const target:SignalTarget={prospect_id:p.id,name:p.name,website:p.website||null,siren,city:p.city||null};
 const repo={saveSignals:async(_p:string,runId:string|null,list:unknown[])=>{
  const {data,error:e}=await d.admin.rpc('save_monitor_signals',{p_run_id:runId,p_signals:list});if(e)throw Error('SAVE_FAILED');
  return {inserted:Number(data?.inserted??0),duplicates:Number(data?.duplicates??0)};
 }};
 const {report}=await runSignalScan({targets:[target],providers,profile,budget:{maxRequests:providers.length,deadlineMs:20000},now:d.now(),runId:c.run_id,repo:repo as never});
 if(site&&auditId){try{await audit.complete(auditId,c.created_by,site.lastError?'ANALYSIS_FAILED':'ANALYZED',site.lastError?0:site.lastReport.pages,site.lastError?null:site.lastReport.failed_pages)}catch{/* best-effort */}}
 const status=report.requests_failed===0?'completed':report.requests_failed<report.requests_sent?'partial':'failed';
 return {status,report,code:status==='failed'?'PROVIDERS_FAILED':null};
}

export async function runMonitorBatch(d:MonitorDeps):Promise<MonitorSummary>{
 const clock=d.clock??(()=>Date.now());const started=clock();
 const s:MonitorSummary={claimed:0,completed:0,partial:0,failed:0,inserted:0,out_of_time:false};
 while(clock()-started<d.budgetMs){
  const {data,error}=await d.admin.rpc('claim_signal_monitors',{p_limit:d.batch});
  if(error)throw Error('CLAIM_FAILED');
  const claimed=(data??[]) as Claimed[];if(!claimed.length)break;
  s.claimed+=claimed.length;
  for(const c of claimed){
   // A run left unfinished keeps its lease and is taken again by a later cron (never lost, never doubled).
   if(clock()-started>=d.budgetMs){s.out_of_time=true;break}
   let r;try{r=await one(d,c)}catch{r={status:'failed' as const,report:null,code:'RUN_FAILED'}}
   s[r.status]++;s.inserted+=r.report?.inserted??0;
   const metrics=r.report?{requests_sent:r.report.requests_sent,requests_failed:r.report.requests_failed,candidates:r.report.candidates,inserted:r.report.inserted,duplicates:r.report.duplicates,rejected:r.report.rejected}:{};
   await d.admin.rpc('complete_signal_run',{p_run_id:c.run_id,p_status:r.status,p_metrics:metrics,p_error:r.code});
   d.log?.({component:'signals_monitor',run:c.run_id,status:r.status,inserted:r.report?.inserted??0,code:r.code});
  }
  if(s.out_of_time||claimed.length<d.batch)break;
 }
 return s;
}
