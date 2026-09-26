import {load} from 'cheerio';
import type {Criterion} from '../domain/core.ts';
import {DiscoveryInputSchema,ObservationSchema,type DiscoveryInput,type DiscoveryProvider,type Candidate,type Observation,type DiscoveryResult,type DiscoveryRun,type ProviderSearchReport} from './types.ts';
import {DeduplicationService,type Identity} from './deduplication.ts';
import {ObservationService,EvidenceProposalService} from './observations.ts';
import {diagnoseDiscoveryFailure,type DiscoveryStage} from './failure-diagnostics.ts';
import {mergeSameEntityCandidates,sameCanonicalOrganization} from './admissibility.ts';
export interface DiscoveryRepository {
 start(input:DiscoveryInput,provider:string):Promise<DiscoveryRun>;
 existing(projectId:string):Promise<Identity[]>;
 saveResults(run:DiscoveryRun,candidates:Array<{candidate:Candidate;dedupe:ReturnType<DeduplicationService['match']>}>):Promise<DiscoveryResult[]>;
 finish(runId:string,resultCount:number,metrics:Record<string,unknown>,error?:string):Promise<void>;
 prospect(id:string):Promise<{id:string;website:string|null;organization_id:string;project_id:string}>;
 projectCriteria(projectId:string):Promise<Criterion[]>;
 consumeAnalysis(id:string):Promise<void>;
 saveObservations(id:string,observations:Observation[]):Promise<unknown[]>;
}
export type PageFetcher=(url:string)=>Promise<{url:string;html:string}>;
export type SafeLogger=(event:Record<string,string|number|null>)=>void;
const noop:SafeLogger=()=>{};
// Records the provider requests a run actually sent (the cost ledger) — called at most once per run, as
// soon as the search step is over, whether it succeeded, partly failed or failed: a request that was
// sent is never left unmetered, and N requests are never recorded as one.
export type SearchMeter=(run:DiscoveryRun,requestCount:number)=>Promise<void>;
// Run metrics describing the search step: counts, codes and the market only — never a query or a URL.
function searchMetrics(report:ProviderSearchReport|undefined):Record<string,string|number|null>{
 return report?{search_queries_planned:report.queries_planned,search_requests:report.requests_sent,search_requests_failed:report.requests_failed,search_failure_codes:report.failure_codes.join(',')||null,search_country:report.country,search_country_reason:report.country_reason}:{};
}
export class DiscoveryService {
 repo:DiscoveryRepository;provider:DiscoveryProvider;dedupe:DeduplicationService;log:SafeLogger;meter?:SearchMeter;
 constructor(repo:DiscoveryRepository,provider:DiscoveryProvider,log:SafeLogger=noop,meter?:SearchMeter){this.repo=repo;this.provider=provider;this.dedupe=new DeduplicationService();this.log=log;this.meter=meter}
 // Read through a method: the provider sets it during the awaited search, which flow analysis cannot see.
 lastSearch():ProviderSearchReport|undefined{return this.provider.lastSearch}
 async find_prospects(raw:unknown){
 const input=DiscoveryInputSchema.parse(raw);this.provider.lastSearch=undefined;const run=await this.repo.start(input,this.provider.id);const start=Date.now();
 let metered=false;const meterSearch=async()=>{const sent=this.lastSearch()?.requests_sent??0;if(metered||!this.meter||sent<1)return;metered=true;try{await this.meter(run,sent)}catch{/* Cost-ledger visibility is best-effort (see usage.ts). */}};
 // Tracks which step was running, for the server-side failure diagnosis only (see failure-diagnostics.ts).
 let stage:DiscoveryStage='existing';
 try{const known=await this.repo.existing(input.project_id);stage='provider_search';const rawResults=await this.provider.searchCompanies(input);await meterSearch();
 const search=this.lastSearch();
 // Partial search failure: some queries failed, at least one succeeded — the run continues on the results
 // actually received (nothing is retried or invented) and the failure stays observable (log + run metrics).
 if(search&&search.requests_failed>0)this.log({provider:this.provider.id,event:'search_partial_failure',search_requests:search.requests_sent,search_requests_failed:search.requests_failed,search_failure_codes:search.failure_codes.join(',')});const candidates:Array<{candidate:Candidate;dedupe:ReturnType<DeduplicationService['match']>}>=[];const seen:Identity[]=[];let normalizationRejected=0;
 const normalized:Candidate[]=[];
 for(const raw of rawResults.slice(0,input.max_results)){stage='normalize';
 // A result that cannot be normalized is dropped on its own — never repaired, never guessed — and
 // counted; the other results of the same single search are kept. The log carries codes only.
 try{normalized.push(this.provider.normalizeResult(raw))}catch(error){normalizationRejected++;this.log({provider:this.provider.id,event:'normalization_rejected',...diagnoseDiscoveryFailure('normalize',error)})}}
 // The same organization reached through several pages of this search becomes one candidate with
 // several sources (admissibility.ts) — never one prospect per page.
 const {kept,merged:entitiesMerged}=mergeSameEntityCandidates(normalized);
 for(const candidate of kept){
 stage='dedupe';const dedupe=this.dedupe.match(candidate,known);
 // Resolution first, project dedup second: a resolved organization already in the project by name is
 // flagged for review (never silently merged, never dropped) even without a shared website/phone.
 if(dedupe.status==='unique'&&candidate.raw_metadata.source_class==='COMPANY_CANDIDATE'){const same=known.find(k=>sameCanonicalOrganization(k.name,candidate.name));if(same){dedupe.status='merge_review_required';dedupe.duplicate_of=same.id??null;dedupe.reason='Organisation déjà présente dans ce projet (même nom canonique) : revue nécessaire'}}const within=this.dedupe.match(candidate,seen);if(dedupe.status==='unique'&&within.status!=='unique'){dedupe.status='merge_review_required';dedupe.reason='Résultat similaire dans cette recherche : revue nécessaire'}candidates.push({candidate,dedupe});seen.push(candidate)}
 stage='save';const results=await this.repo.saveResults(run,candidates);const metrics={provider:this.provider.id,duration_ms:Date.now()-start,...searchMetrics(search),results:results.length,normalization_rejected:normalizationRejected,entities_merged:entitiesMerged,ai_tokens:0,ai_cost_estimate:0};stage='finish';await this.repo.finish(run.id,results.length,metrics);this.log(metrics);return {...run,status:'completed',provider_mode:this.provider.mode,results,result_count:results.length};
 }catch(error){await meterSearch();await this.repo.finish(run.id,0,{duration_ms:Date.now()-start,...searchMetrics(this.lastSearch())},'DISCOVERY_FAILED');this.log({provider:this.provider.id,duration_ms:Date.now()-start,error:'DISCOVERY_FAILED',...searchMetrics(this.lastSearch()),...diagnoseDiscoveryFailure(stage,error)});throw Error('DISCOVERY_FAILED')}
 }
}
// Depth 1, same origin, at most MAX_EXTRA_PAGES pages besides the first one (3 in total, unchanged). The
// link words used to be restaurant-only (menu, carte, commande, livraison); they are kept, and the generic
// pages any organization publishes are added — the number of pages fetched is not.
const MAX_EXTRA_PAGES=2;
const RELEVANT_INTERNAL_LINK=/contact|about|a-propos|apropos|qui-sommes-nous|produits?|products?|services?|solutions?|catalogue|menu|carte|command|order|livraison/i;
// What one analysis saves (the RPC accepts at most 40 rows): every observation that carries information
// first — proposals and observed facts of every page — then ONE "absent from the analyzed pages" row per
// criterion that no page informed. The bound can therefore never drop a proposal of page 2 behind the
// UNKNOWN rows of page 1, and a criterion is never listed as missing once per page.
export function prioritizeObservations(all:Observation[]):Observation[]{
 const informative=all.filter(o=>o.status!=='UNKNOWN');const informed=new Set(informative.map(o=>o.criterion));
 const unknown=all.filter(o=>{if(o.status!=='UNKNOWN'||informed.has(o.criterion))return false;informed.add(o.criterion);return true});
 return [...informative,...unknown].slice(0,40);
}
export class CompanyAnalysisService {
 repo:DiscoveryRepository;fetchPage:PageFetcher;log:SafeLogger;
 constructor(repo:DiscoveryRepository,fetchPage:PageFetcher,log:SafeLogger=noop){this.repo=repo;this.fetchPage=fetchPage;this.log=log}
 // options.url: the destination the server authorized (analysis-authorization.ts) — for a Discovery-derived
 // authorization, the accepted result's own website rather than the member-editable prospects.website.
 // Never a URL from the request.
 async analyze_company(prospectId:string,sourceType:Observation['source_type']='official_website',options:{url?:string}={}){
 const p=await this.repo.prospect(prospectId);if(!p.website)throw Error('OFFICIAL_WEBSITE_REQUIRED');const target=options.url??p.website;
 const criteria=await this.repo.projectCriteria(p.project_id);
 await this.repo.consumeAnalysis(prospectId);const start=Date.now();
 try{const page=await this.fetchPage(target);const pages=[page];const links=new Set<string>();const $=load(page.html);
 $('a[href]').each((_,element)=>{try{const href=$(element).attr('href')!;const url=new URL(href,page.url);url.hash='';if(url.origin===new URL(page.url).origin&&url.href!==page.url&&RELEVANT_INTERNAL_LINK.test(url.pathname+' '+$(element).text()))links.add(url.href)}catch{/* Invalid links are not fetched. */}});
 let failedPages=0;for(const url of [...links].slice(0,MAX_EXTRA_PAGES)){try{pages.push(await this.fetchPage(url))}catch{failedPages++}}
 const observations=prioritizeObservations(pages.flatMap(item=>new ObservationService().extract(item.html,item.url,criteria,sourceType)).map(o=>ObservationSchema.parse(o)));const proposed=new EvidenceProposalService().propose(observations,criteria);const saved=await this.repo.saveObservations(prospectId,observations);this.log({provider:'http_html',duration_ms:Date.now()-start,pages:pages.length,failed_pages:failedPages,proposed_evidence:proposed.length,ai_tokens:0,ai_cost_estimate:0});return {observations:saved,pages_analyzed:pages.length,failed_pages:failedPages,proposals:proposed.length,ai_tokens:0,ai_cost_estimate:0};
 // The original cause (never sent to the client — the route always returns the generic mapped
 // message) is logged here so a real failure stays diagnosable from server logs alone.
 // A robots.txt refusal of the site itself is reported as such; every other failure (network, SSRF policy,
 // redirect, size, content type, timeout) stays the generic ANALYSIS_FAILED — no address or host detail
 // ever reaches the client.
 }catch(cause){const originalCause=cause instanceof Error?cause.cause:undefined;const original=originalCause instanceof Error?originalCause.message:cause instanceof Error?cause.message:String(cause);const code=original==='Blocked by robots.txt'?'ROBOTS_DENIED':'ANALYSIS_FAILED';this.log({provider:'http_html',duration_ms:Date.now()-start,pages:0,error:code,cause:original});throw Error(code)}
 }
}
