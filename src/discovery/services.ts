import {load} from 'cheerio';
import type {Criterion} from '../domain/core.ts';
import {DiscoveryInputSchema,ObservationSchema,type DiscoveryInput,type DiscoveryProvider,type Candidate,type Observation,type DiscoveryResult,type DiscoveryRun} from './types.ts';
import {DeduplicationService,type Identity} from './deduplication.ts';
import {ObservationService,EvidenceProposalService} from './observations.ts';
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
export class DiscoveryService {
 repo:DiscoveryRepository;provider:DiscoveryProvider;dedupe:DeduplicationService;log:SafeLogger;
 constructor(repo:DiscoveryRepository,provider:DiscoveryProvider,log:SafeLogger=noop){this.repo=repo;this.provider=provider;this.dedupe=new DeduplicationService();this.log=log}
 async find_prospects(raw:unknown){
 const input=DiscoveryInputSchema.parse(raw);const run=await this.repo.start(input,this.provider.id);const start=Date.now();
 try{const known=await this.repo.existing(input.project_id);const rawResults=await this.provider.searchCompanies(input);const candidates:Array<{candidate:Candidate;dedupe:ReturnType<DeduplicationService['match']>}>=[];const seen:Identity[]=[];
 for(const raw of rawResults.slice(0,input.max_results)){const candidate=this.provider.normalizeResult(raw);const dedupe=this.dedupe.match(candidate,known);const within=this.dedupe.match(candidate,seen);if(dedupe.status==='unique'&&within.status!=='unique'){dedupe.status='merge_review_required';dedupe.reason='Résultat similaire dans cette recherche : revue nécessaire'}candidates.push({candidate,dedupe});seen.push(candidate)}
 const results=await this.repo.saveResults(run,candidates);const metrics={provider:this.provider.id,duration_ms:Date.now()-start,results:results.length,ai_tokens:0,ai_cost_estimate:0};await this.repo.finish(run.id,results.length,metrics);this.log(metrics);return {...run,status:'completed',provider_mode:this.provider.mode,results,result_count:results.length};
 }catch{await this.repo.finish(run.id,0,{duration_ms:Date.now()-start},'DISCOVERY_FAILED');this.log({provider:this.provider.id,duration_ms:Date.now()-start,error:'DISCOVERY_FAILED'});throw Error('DISCOVERY_FAILED')}
 }
}
// Safely reads a diagnostic field off an unknown .cause value. supabase-js resolves {data,error}
// rather than rejecting (see repository.ts), so the real Postgres/PostgREST error is always a plain
// object — an `instanceof Error` check on it fails and silently discards it. This reads the field
// whether the cause is that plain object, a DatabaseFailureCause, an Error, or anything else.
export function causeField(cause:unknown,key:string):string|number|null{
 if(cause&&typeof cause==='object'&&key in cause){const value=(cause as Record<string,unknown>)[key];if(typeof value==='string'||typeof value==='number')return value;if(value===null||value===undefined)return null}
 return null;
}
export class CompanyAnalysisService {
 repo:DiscoveryRepository;fetchPage:PageFetcher;log:SafeLogger;
 constructor(repo:DiscoveryRepository,fetchPage:PageFetcher,log:SafeLogger=noop){this.repo=repo;this.fetchPage=fetchPage;this.log=log}
 async analyze_company(prospectId:string,sourceType:Observation['source_type']='official_website'){
 const p=await this.repo.prospect(prospectId);if(!p.website)throw Error('OFFICIAL_WEBSITE_REQUIRED');
 const criteria=await this.repo.projectCriteria(p.project_id);
 await this.repo.consumeAnalysis(prospectId);const start=Date.now();
 let observations:Observation[]=[];
 try{const page=await this.fetchPage(p.website);const pages=[page];const links=new Set<string>();const $=load(page.html);
 $('a[href]').each((_,element)=>{try{const href=$(element).attr('href')!;const url=new URL(href,page.url);url.hash='';if(url.origin===new URL(page.url).origin&&url.href!==page.url&&/menu|contact|carte|command|order|livraison/i.test(url.pathname+' '+$(element).text()))links.add(url.href)}catch{/* Invalid links are not fetched. */}});
 let failedPages=0;for(const url of [...links].slice(0,2)){try{pages.push(await this.fetchPage(url))}catch{failedPages++}}
 observations=pages.flatMap(item=>new ObservationService().extract(item.html,item.url,criteria,sourceType)).map(o=>ObservationSchema.parse(o)).slice(0,40);const proposed=new EvidenceProposalService().propose(observations,criteria);const saved=await this.repo.saveObservations(prospectId,observations);this.log({provider:'http_html',duration_ms:Date.now()-start,pages:pages.length,failed_pages:failedPages,proposed_evidence:proposed.length,ai_tokens:0,ai_cost_estimate:0});return {observations:saved,pages_analyzed:pages.length,failed_pages:failedPages,proposals:proposed.length,ai_tokens:0,ai_cost_estimate:0};
 // Diagnostics only, never sent to the client — the route always returns the generic ANALYSIS_FAILED
 // mapped message regardless of what's logged here. `cause` is read defensively (see causeField):
 // it may be a DatabaseFailureCause (operation/code/message/details/hint — see repository.ts's
 // checked()), a plain PostgREST-shaped object, an Error, or nothing at all if the failure never
 // touched the database (e.g. the fetch itself, or HTML/observation parsing). No excerpt, URL,
 // or observation content is logged — only shape/count metadata safe to keep in server logs.
 }catch(cause){
 const dbCause=cause instanceof Error?cause.cause:undefined;
 const observationTypes=[...new Set(observations.map(o=>o.observation_type))];
 const statuses=[...new Set(observations.map(o=>o.status))];
 const sourceTypes=[...new Set(observations.map(o=>o.source_type))];
 this.log({
  provider:'http_html',duration_ms:Date.now()-start,pages:0,error:'ANALYSIS_FAILED',
  db_operation:causeField(dbCause,'operation'),db_code:causeField(dbCause,'code'),db_message:causeField(dbCause,'message'),db_details:causeField(dbCause,'details'),db_hint:causeField(dbCause,'hint'),
  observation_count:observations.length,observation_types:observationTypes.join(',')||null,statuses:statuses.join(',')||null,source_types:sourceTypes.join(',')||null,
  has_null_criterion:observations.some(o=>o.criterion===null)?1:0,has_null_value:observations.some(o=>o.value===null)?1:0,
 });
 throw Error('ANALYSIS_FAILED')
 }
 }
}
