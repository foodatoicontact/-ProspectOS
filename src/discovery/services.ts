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
 // Returns how many of `amount` candidate prospects the organization's commercial entitlement
 // actually grants this period — 0..amount, never more. The caller must cap what it persists to this.
 consumeProspects(projectId:string,amount:number):Promise<number>;
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
 // Commercial PROSPECT entitlement: a Discovery run may never persist more candidates than the
 // organization's remaining monthly allowance — capped here, deterministically, before anything is
 // written, never as an after-the-fact cleanup. 0 candidates needs no RPC round trip at all.
 const granted=candidates.length?await this.repo.consumeProspects(input.project_id,candidates.length):0;
 const capped=candidates.slice(0,granted);
 const results=await this.repo.saveResults(run,capped);const metrics={provider:this.provider.id,duration_ms:Date.now()-start,results:results.length,ai_tokens:0,ai_cost_estimate:0};await this.repo.finish(run.id,results.length,metrics);this.log(metrics);return {...run,status:'completed',provider_mode:this.provider.mode,results,result_count:results.length,prospects_capped:candidates.length-capped.length};
 }catch{await this.repo.finish(run.id,0,{duration_ms:Date.now()-start},'DISCOVERY_FAILED');this.log({provider:this.provider.id,duration_ms:Date.now()-start,error:'DISCOVERY_FAILED'});throw Error('DISCOVERY_FAILED')}
 }
}
export class CompanyAnalysisService {
 repo:DiscoveryRepository;fetchPage:PageFetcher;log:SafeLogger;
 constructor(repo:DiscoveryRepository,fetchPage:PageFetcher,log:SafeLogger=noop){this.repo=repo;this.fetchPage=fetchPage;this.log=log}
 async analyze_company(prospectId:string,sourceType:Observation['source_type']='official_website'){
 const p=await this.repo.prospect(prospectId);if(!p.website)throw Error('OFFICIAL_WEBSITE_REQUIRED');
 const criteria=await this.repo.projectCriteria(p.project_id);
 await this.repo.consumeAnalysis(prospectId);const start=Date.now();
 try{const page=await this.fetchPage(p.website);const pages=[page];const links=new Set<string>();const $=load(page.html);
 $('a[href]').each((_,element)=>{try{const href=$(element).attr('href')!;const url=new URL(href,page.url);url.hash='';if(url.origin===new URL(page.url).origin&&url.href!==page.url&&/menu|contact|carte|command|order|livraison/i.test(url.pathname+' '+$(element).text()))links.add(url.href)}catch{/* Invalid links are not fetched. */}});
 let failedPages=0;for(const url of [...links].slice(0,2)){try{pages.push(await this.fetchPage(url))}catch{failedPages++}}
 const observations=pages.flatMap(item=>new ObservationService().extract(item.html,item.url,criteria,sourceType)).map(o=>ObservationSchema.parse(o)).slice(0,40);const proposed=new EvidenceProposalService().propose(observations,criteria);const saved=await this.repo.saveObservations(prospectId,observations);this.log({provider:'http_html',duration_ms:Date.now()-start,pages:pages.length,failed_pages:failedPages,proposed_evidence:proposed.length,ai_tokens:0,ai_cost_estimate:0});return {observations:saved,pages_analyzed:pages.length,failed_pages:failedPages,proposals:proposed.length,ai_tokens:0,ai_cost_estimate:0};
 // The original cause (never sent to the client — the route always returns the generic mapped
 // message) is logged here so a real failure stays diagnosable from server logs alone.
 }catch(cause){const originalCause=cause instanceof Error?cause.cause:undefined;const original=originalCause instanceof Error?originalCause.message:cause instanceof Error?cause.message:String(cause);this.log({provider:'http_html',duration_ms:Date.now()-start,pages:0,error:'ANALYSIS_FAILED',cause:original});throw Error('ANALYSIS_FAILED')}
 }
}
