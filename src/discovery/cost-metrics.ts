import type {SupabaseClient} from '@supabase/supabase-js';
// Section 8 of the bloc: what a real Discovery run actually cost, computed exclusively from data that
// already exists (the cost ledger, discovery_results, prospect_observations, evidence, prospects) —
// never a fabricated figure. Read entirely through the caller's own RLS-scoped client: tenant isolation
// is inherited from the existing per-table policies, nothing here needs its own membership check.
//
// LLM cost is deliberately NOT included in a run's total: analyzeOffer (the only LLM call in the
// product) analyzes a PROJECT's offer text, not a specific Discovery run — attributing it to whichever
// run happens to be open would double-count it the moment a project has more than one run. It remains
// visible as its own project-level api_usage_events rows (operation='offer_analysis'), just not folded
// into a run's provider_cost/total_estimated_cost here.
//
// pages_fetched/pages_rejected/pages_failed are NOT tracked at run granularity in this bloc:
// CompanyAnalysisService.analyze_company (src/discovery/services.ts) returns its own pages/failed_pages
// counters per call but never persists them against a discovery_run_id — adding that would mean
// touching the analyze pipeline itself, which this bloc's brief explicitly says not to redo. They are
// reported as `null` (never a guessed number) with an explicit `unavailable` note.
const nullSafeDivide=(numerator:number,denominator:number):number|null=>denominator>0?Math.round(numerator/denominator):null;

export interface RunCostMetrics {
 discovery_run_id:string;provider:string;
 search_requests:number;search_results_received:number;unique_domains:number;
 pages_fetched:null;pages_rejected:null;pages_failed:null;
 observations_created:number;observations_reviewed:number;evidence_verified:number;
 prospects_created:number;prospects_qualified:number;
 provider_cost_micros:number|null;llm_cost_micros:null;total_estimated_cost_micros:number|null;
 cost_per_result_micros:number|null;cost_per_prospect_micros:number|null;
 cost_per_verified_evidence_micros:number|null;cost_per_qualified_prospect_micros:number|null;
 cost_unavailable_reason:string|null;
 note:string;
}

async function select<T>(db:SupabaseClient,query:PromiseLike<{data:T|null;error:unknown}>):Promise<T> {
 const {data,error}=await query;if(error)throw Error('DATABASE_REQUEST_FAILED');return data as T;
}

export async function computeRunCostMetrics(db:SupabaseClient,runId:string):Promise<RunCostMetrics> {
 const run=await select<{id:string;provider:string;result_count:number}>(db,db.from('discovery_runs').select('id,provider,result_count').eq('id',runId).single());
 const results=await select<Array<{id:string;website:string|null;source_url:string;prospect_id:string|null;status:string}>>(db,db.from('discovery_results').select('id,website,source_url,prospect_id,status').eq('discovery_run_id',runId));
 const usage=await select<Array<{request_count:number;estimated_cost_micros:number|null}>>(db,db.from('api_usage_events').select('request_count,estimated_cost_micros').eq('discovery_run_id',runId).eq('operation','search'));

 const domainOf=(url:string|null)=>{if(!url)return null;try{return new URL(url).hostname}catch{return null}};
 const uniqueDomains=new Set(results.map(r=>domainOf(r.website)??domainOf(r.source_url)).filter((d):d is string=>!!d));
 const acceptedProspectIds=[...new Set(results.filter(r=>r.status==='accepted'&&r.prospect_id).map(r=>r.prospect_id as string))];

 let observationsCreated=0,observationsReviewed=0,evidenceVerified=0,prospectsQualified=0;
 if(acceptedProspectIds.length){
  const observations=await select<Array<{review_status:string}>>(db,db.from('prospect_observations').select('review_status').in('prospect_id',acceptedProspectIds));
  observationsCreated=observations.length;observationsReviewed=observations.filter(o=>o.review_status!=='NOT_VERIFIED').length;
  const evidence=await select<Array<{status:string}>>(db,db.from('evidence').select('status').in('prospect_id',acceptedProspectIds));
  evidenceVerified=evidence.filter(e=>e.status==='VERIFIED').length;
  const prospects=await select<Array<{status:string}>>(db,db.from('prospects').select('status').in('id',acceptedProspectIds));
  prospectsQualified=prospects.filter(p=>p.status==='Qualifié').length;
 }

 const searchRequests=usage.reduce((s,u)=>s+u.request_count,0);
 // Any priced event missing a cost (no pricing configured yet) makes the whole run's provider_cost
 // unavailable rather than silently under-reporting a partial total — same "no false precision" rule
 // as a single event (see src/server/pricing.ts).
 const anyUnpriced=usage.some(u=>u.estimated_cost_micros===null)&&usage.length>0;
 const providerCostMicros=usage.length&&!anyUnpriced?usage.reduce((s,u)=>s+(u.estimated_cost_micros??0),0):usage.length?null:0;
 const totalCostMicros=providerCostMicros;

 return {
  discovery_run_id:run.id,provider:run.provider,
  search_requests:searchRequests,search_results_received:run.result_count,unique_domains:uniqueDomains.size,
  pages_fetched:null,pages_rejected:null,pages_failed:null,
  observations_created:observationsCreated,observations_reviewed:observationsReviewed,evidence_verified:evidenceVerified,
  prospects_created:acceptedProspectIds.length,prospects_qualified:prospectsQualified,
  provider_cost_micros:providerCostMicros,llm_cost_micros:null,total_estimated_cost_micros:totalCostMicros,
  cost_per_result_micros:totalCostMicros!==null?nullSafeDivide(totalCostMicros,run.result_count):null,
  cost_per_prospect_micros:totalCostMicros!==null?nullSafeDivide(totalCostMicros,acceptedProspectIds.length):null,
  cost_per_verified_evidence_micros:totalCostMicros!==null?nullSafeDivide(totalCostMicros,evidenceVerified):null,
  cost_per_qualified_prospect_micros:totalCostMicros!==null?nullSafeDivide(totalCostMicros,prospectsQualified):null,
  cost_unavailable_reason:run.provider==='fixture'?'TEST : aucun coût réel, aucune mesure applicable.':anyUnpriced?'Tarif non configuré pour un ou plusieurs appels (prospectos_private.provider_pricing) : coût réel non calculable, jamais estimé.':null,
  note:'pages_fetched/pages_rejected/pages_failed non mesurés par run dans cette version. Coût LLM (analyse d’offre) suivi séparément au niveau du projet, jamais mélangé au coût d’un run pour éviter un double comptage.',
 };
}
