import {load} from 'cheerio';
import type {Criterion} from '../domain/core.ts';
import {DiscoveryInputSchema,ObservationSchema,type DiscoveryInput,type DiscoveryProvider,type Candidate,type Observation,type DiscoveryResult,type DiscoveryRun,type ProviderSearchReport} from './types.ts';
import {DeduplicationService,type Identity} from './deduplication.ts';
import {ObservationService,EvidenceProposalService} from './observations.ts';
import {diagnoseDiscoveryFailure,type DiscoveryStage} from './failure-diagnostics.ts';
import {mergeSameEntityCandidates,sameCanonicalOrganization} from './admissibility.ts';
import {pageIntentsFor,internalLinkScore} from './strategies/icp-intents.ts';
import {noveltyCounts,noveltyRates,type ProjectMemory,type Novelty} from './novelty.ts';
import {ProjectNovelty} from './novelty-engine.ts';
import {buildSearchVariants,desiredNewResults,searchUntilNewTarget,type SearchUntilNewResult} from './search-until-new.ts';
export interface DiscoveryRepository {
 start(input:DiscoveryInput,provider:string):Promise<DiscoveryRun>;
 existing(projectId:string):Promise<Identity[]>;
 // Project Discovery memory (novelty.ts): the project's earlier results and runs, one batch read under RLS.
 // Optional — without it (or if it fails) results carry no novelty label rather than a wrong "new".
 memory?(projectId:string,excludeRunId:string):Promise<Omit<ProjectMemory,'prospects'>>;
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
// Search-Until-New run metrics: counts, durations and the stop reason only — never a query (like searchMetrics).
function deepSearchMetrics(deep:SearchUntilNewResult<Candidate>,desired:number,unique:number){
 return {provider_calls:deep.providerCalls,search_passes:deep.passes.length,provider_results_total:deep.passes.reduce((n,p)=>n+p.results,0),unique_candidates_total:unique,desired_new_results:desired,new_results_found:deep.newFound,stop_reason:deep.stopReason,
  pass_durations_ms:deep.passes.map(p=>p.duration_ms),pass_results:deep.passes.map(p=>p.results),pass_new_results:deep.passes.map(p=>p.new_after),pass_kinds:deep.passes.map(p=>p.query_kind)};
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
 try{const known=await this.repo.existing(input.project_id);
 // What this project already saw (its prospects, its earlier runs): read once, matched in memory. A memory
 // read failure never fails the search — the results are simply not labelled.
 let novelty:ProjectNovelty|null=null,memoryTruncated=false,memory:ProjectMemory|null=null;
 if(this.repo.memory){try{const m=await this.repo.memory(input.project_id,run.id);memoryTruncated=!!m.truncated;memory={...m,prospects:known.filter((k):k is typeof k&{id:string}=>!!k.id).map(k=>({id:k.id,name:k.name,website:k.website,phone:k.phone,city:k.city}))};novelty=new ProjectNovelty(memory,input.location)}catch{novelty=null;memory=null}}
 const mode=input.optional_filters.search_mode??'all';
 stage='provider_search';let normalizationRejected=0;
 const normalizeAll=(raws:unknown[])=>{const out:Candidate[]=[];for(const raw of raws.slice(0,input.max_results)){stage='normalize';
 // A result that cannot be normalized is dropped on its own — never repaired, never guessed — and
 // counted; the other results of the same single search are kept. The log carries codes only.
 try{out.push(this.provider.normalizeResult(raw))}catch(error){normalizationRejected++;this.log({provider:this.provider.id,event:'normalization_rejected',...diagnoseDiscoveryFailure('normalize',error)})}}return out};
 // Search-Until-New (search-until-new.ts): only on the user's explicit choice, only with the project memory
 // (it cannot tell a new actor otherwise) and a provider able to send one request per variant. Same
 // budget as a normal run: at most 3 provider requests. Otherwise the normal search runs unchanged.
 let deep:SearchUntilNewResult<Candidate>|null=null,desired=0,uniqueTotal=0,deepMerged=0,fallback:string|null=null;const normalized:Candidate[]=[];
 if(mode==='search_new'&&this.provider.searchVariant&&memory){const mem=memory;desired=desiredNewResults(input.optional_filters.desired_new_results,input.max_results);
  const newCount=(all:Candidate[])=>{const engine=new ProjectNovelty(mem,input.location);return mergeSameEntityCandidates(all).kept.filter(c=>engine.classify(c).status==='NEW').length};
  deep=await searchUntilNewTarget<Candidate>({variants:buildSearchVariants(input),desiredNewResults:desired,maxProviderCalls:input.optional_filters.max_provider_calls,startedAt:start,
   runPass:async variant=>{stage='provider_search';return normalizeAll(await this.provider.searchVariant!(input,variant.query))},countNew:newCount});
  // Every pass merged (the same actor met twice is one candidate), new actors first, capped at max_results.
  const merged=mergeSameEntityCandidates(deep.candidates);deepMerged=merged.merged;uniqueTotal=merged.kept.length;
  const engine=new ProjectNovelty(mem,input.location);const isNew=merged.kept.map(c=>engine.classify(c).status==='NEW');
  normalized.push(...[...merged.kept.filter((_,i)=>isNew[i]),...merged.kept.filter((_,i)=>!isNew[i])].slice(0,input.max_results));
 }else{if(mode==='search_new')fallback=memory?'provider_unsupported':'novelty_unavailable';normalized.push(...normalizeAll(await this.provider.searchCompanies(input)))}
 await meterSearch();
 const search=this.lastSearch();
 // Partial search failure: some queries failed, at least one succeeded — the run continues on the results
 // actually received (nothing is retried or invented) and the failure stays observable (log + run metrics).
 if(search&&search.requests_failed>0)this.log({provider:this.provider.id,event:'search_partial_failure',search_requests:search.requests_sent,search_requests_failed:search.requests_failed,search_failure_codes:search.failure_codes.join(',')});const candidates:Array<{candidate:Candidate;dedupe:ReturnType<DeduplicationService['match']>}>=[];const seen:Identity[]=[];
 // The same organization reached through several pages of this search becomes one candidate with
 // several sources (admissibility.ts) — never one prospect per page.
 const {kept,merged:entitiesMerged}=mergeSameEntityCandidates(normalized);
 for(const candidate of kept){
 stage='dedupe';const dedupe=this.dedupe.match(candidate,known);
 // Resolution first, project dedup second: a resolved organization already in the project by name is
 // flagged for review (never silently merged, never dropped) even without a shared website/phone.
 if(dedupe.status==='unique'&&candidate.raw_metadata.source_class==='COMPANY_CANDIDATE'){const same=known.find(k=>sameCanonicalOrganization(k.name,candidate.name));if(same){dedupe.status='merge_review_required';dedupe.duplicate_of=same.id??null;dedupe.reason='Organisation déjà présente dans ce projet (même nom canonique) : revue nécessaire'}}const within=this.dedupe.match(candidate,seen);if(dedupe.status==='unique'&&within.status!=='unique'){dedupe.status='merge_review_required';dedupe.reason='Résultat similaire dans cette recherche : revue nécessaire'}const labelled=novelty?{...candidate,raw_metadata:{...candidate.raw_metadata,novelty:novelty.classify(candidate,{duplicateOf:dedupe.status==='duplicate_candidate'?dedupe.duplicate_of:null})}}:candidate;candidates.push({candidate:labelled,dedupe});seen.push(candidate)}
 stage='save';const results=await this.repo.saveResults(run,candidates);const counts=novelty?noveltyCounts(candidates.map(c=>c.candidate.raw_metadata.novelty as Novelty),entitiesMerged+deepMerged):null;const metrics={provider:this.provider.id,duration_ms:Date.now()-start,...searchMetrics(search),results:results.length,normalization_rejected:normalizationRejected,entities_merged:entitiesMerged+deepMerged,ai_tokens:0,ai_cost_estimate:0,search_mode:mode,...(fallback?{search_mode_fallback:fallback}:{}),...(deep?deepSearchMetrics(deep,desired,uniqueTotal):{}),...(counts?{...counts,...noveltyRates(counts)}:{novelty_unavailable:1}),...(memoryTruncated?{novelty_memory_truncated:1}:{})};stage='finish';await this.repo.finish(run.id,results.length,metrics);this.log(Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v])) as Record<string,string|number|null>);return {...run,status:'completed',provider_mode:this.provider.mode,results,result_count:results.length};
 }catch(error){await meterSearch();await this.repo.finish(run.id,0,{duration_ms:Date.now()-start,...searchMetrics(this.lastSearch())},'DISCOVERY_FAILED');this.log({provider:this.provider.id,duration_ms:Date.now()-start,error:'DISCOVERY_FAILED',...searchMetrics(this.lastSearch()),...diagnoseDiscoveryFailure(stage,error)});throw Error('DISCOVERY_FAILED')}
 }
}
// Depth 1, same origin, at most MAX_EXTRA_PAGES pages besides the first one (3 in total, unchanged). The
// link words used to be restaurant-only (menu, carte, commande, livraison); they are kept, and the generic
// pages any organization publishes are added — the number of pages fetched is not.
export const MAX_EXTRA_PAGES=2;
const COVERED_CONFIDENCE=.5;
const RELEVANT_INTERNAL_LINK=/contact|about|a-propos|apropos|qui-sommes-nous|produits?|products?|services?|solutions?|catalogue|menu|carte|command|order|livraison/i;
// Which internal pages to read with that fixed budget: the ones naming what the ICP asks for and the first
// page did not already show (pricing, schedule, activities, booking, events… — icp-intents.ts), before the
// generic pages above; ties keep the page's own link order. Only the ORDER changes: same origin, same
// fetcher (robots.txt, SSRF policy, redirects, size and time limits), same number of pages.
export function selectInternalPages(links:Array<{url:string;text:string}>,criteria:Criterion[],covered:Set<string>):string[]{
 const intents=pageIntentsFor(criteria.filter(c=>!covered.has(c.key)));
 return links.map((l,order)=>{const path=new URL(l.url).pathname;return {url:l.url,order,score:internalLinkScore(`${path} ${l.text}`,intents,RELEVANT_INTERNAL_LINK.test(`${path} ${l.text}`))}})
  .filter(l=>l.score>0).sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,MAX_EXTRA_PAGES).map(l=>l.url);
}
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
 try{const page=await this.fetchPage(target);const pages=[page];const links=new Map<string,string>();const $=load(page.html);
 $('a[href]').each((_,element)=>{try{const href=$(element).attr('href')!;const url=new URL(href,page.url);url.hash='';if(url.origin===new URL(page.url).origin&&url.href!==page.url)links.set(url.href,`${links.get(url.href)??''} ${$(element).text()}`.trim())}catch{/* Invalid links are not fetched. */}});
 const extractor=new ObservationService();const firstObservations=extractor.extract(page.html,page.url,criteria,sourceType);
 // A weak proposal (a menu heading such as "Tarifs & planning") does not make the page behind it useless.
 const covered=new Set(firstObservations.filter(o=>o.criterion&&o.value===true&&o.confidence>=COVERED_CONFIDENCE).map(o=>o.criterion!));
 let failedPages=0;for(const url of selectInternalPages([...links].map(([url,text])=>({url,text})),criteria,covered)){try{pages.push(await this.fetchPage(url))}catch{failedPages++}}
 const observations=prioritizeObservations([...firstObservations,...pages.slice(1).flatMap(item=>extractor.extract(item.html,item.url,criteria,sourceType))].map(o=>ObservationSchema.parse(o)));const proposed=new EvidenceProposalService().propose(observations,criteria);const saved=await this.repo.saveObservations(prospectId,observations);this.log({provider:'http_html',duration_ms:Date.now()-start,pages:pages.length,failed_pages:failedPages,proposed_evidence:proposed.length,ai_tokens:0,ai_cost_estimate:0});return {observations:saved,pages_analyzed:pages.length,failed_pages:failedPages,proposals:proposed.length,ai_tokens:0,ai_cost_estimate:0};
 // The original cause (never sent to the client — the route always returns the generic mapped
 // message) is logged here so a real failure stays diagnosable from server logs alone.
 // A robots.txt refusal of the site itself is reported as such; every other failure (network, SSRF policy,
 // redirect, size, content type, timeout) stays the generic ANALYSIS_FAILED — no address or host detail
 // ever reaches the client.
 }catch(cause){const originalCause=cause instanceof Error?cause.cause:undefined;const original=originalCause instanceof Error?originalCause.message:cause instanceof Error?cause.message:String(cause);const code=original==='Blocked by robots.txt'?'ROBOTS_DENIED':'ANALYSIS_FAILED';this.log({provider:'http_html',duration_ms:Date.now()-start,pages:0,error:code,cause:original});throw Error(code)}
 }
}
