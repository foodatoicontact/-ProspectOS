import {load} from 'cheerio';
import {DiscoveryInputSchema,ObservationSchema,type DiscoveryInput,type DiscoveryProvider,type Candidate,type Observation,type DiscoveryResult,type DiscoveryRun} from './types.ts';
import {DeduplicationService,type Identity} from './deduplication.ts';
import {ObservationService,EvidenceProposalService} from './observations.ts';
export interface DiscoveryRepository {
 start(input:DiscoveryInput,provider:string):Promise<DiscoveryRun>;
 existing(projectId:string):Promise<Identity[]>;
 saveResults(run:DiscoveryRun,candidates:Array<{candidate:Candidate;dedupe:ReturnType<DeduplicationService['match']>}>):Promise<DiscoveryResult[]>;
 finish(runId:string,resultCount:number,metrics:Record<string,unknown>,error?:string):Promise<void>;
 prospect(id:string):Promise<{id:string;website:string|null;organization_id:string;project_id:string}>;
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
export class CompanyAnalysisService {
 repo:DiscoveryRepository;fetchPage:PageFetcher;log:SafeLogger;
 constructor(repo:DiscoveryRepository,fetchPage:PageFetcher,log:SafeLogger=noop){this.repo=repo;this.fetchPage=fetchPage;this.log=log}
 async analyze_company(prospectId:string,sourceType:Observation['source_type']='official_website'){
 const p=await this.repo.prospect(prospectId);if(!p.website)throw Error('OFFICIAL_WEBSITE_REQUIRED');await this.repo.consumeAnalysis(prospectId);const start=Date.now();
 try{const page=await this.fetchPage(p.website);const pages=[page];const links=new Set<string>();const $=load(page.html);
 $('a[href]').each((_,element)=>{try{const href=$(element).attr('href')!;const url=new URL(href,page.url);url.hash='';if(url.origin===new URL(page.url).origin&&url.href!==page.url&&/menu|contact|carte|command|order|livraison/i.test(url.pathname+' '+$(element).text()))links.add(url.href)}catch{/* Invalid links are not fetched. */}});
 let failedPages=0;for(const url of [...links].slice(0,2)){try{pages.push(await this.fetchPage(url))}catch{failedPages++}}
 const observations=pages.flatMap(item=>new ObservationService().extract(item.html,item.url,sourceType)).map(o=>ObservationSchema.parse(o)).slice(0,40);const proposed=new EvidenceProposalService().propose(observations);const saved=await this.repo.saveObservations(prospectId,observations);this.log({provider:'http_html',duration_ms:Date.now()-start,pages:pages.length,failed_pages:failedPages,proposed_evidence:proposed.length,ai_tokens:0,ai_cost_estimate:0});return {observations:saved,pages_analyzed:pages.length,failed_pages:failedPages,proposals:proposed.length,ai_tokens:0,ai_cost_estimate:0};
 }catch{this.log({provider:'http_html',duration_ms:Date.now()-start,pages:0,error:'ANALYSIS_FAILED'});throw Error('ANALYSIS_FAILED')}
 }
}
