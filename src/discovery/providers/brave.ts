import {z} from 'zod';
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider} from '../types.ts';
import {DeduplicationService} from '../deduplication.ts';
import {assessCandidateQuality,type QualityAssessment} from '../candidate-quality.ts';
import {selectDiverseCandidates} from '../candidate-diversity.ts';
import {resolveCanonicalCompany} from '../entity-resolution.ts';
import {sourceDomainOf,type QueryContext} from '../source-classification.ts';
import {evaluateCandidateAdmissibility,pageLabel} from '../admissibility.ts';
import {getDomain} from 'tldts';
import {planSearchQueries} from '../query-plan.ts';
import {resolveMarket,type MarketReason} from '../market.ts';
import {diagnoseDiscoveryFailure} from '../failure-diagnostics.ts';
const RawSchema=z.object({title:z.string().min(1),url:z.string().url(),description:z.string().optional()}).passthrough();
// Attached in-memory onto each raw result between searchCompanies and normalizeResult — never
// serialized, never persisted as its own column; it only ever ends up inside Candidate.raw_metadata
// (quality_signal/quality_reasons) and Candidate.confidence, both pre-existing, generic fields.
type QualityTagged={__quality?:QualityAssessment;__context?:QueryContext;__found_by?:string[]};
// Brave bills per request, not per result ($5/1,000 requests — see provider_pricing, unchanged by this
// module): each request asks for the maximum single-call page size (20, Brave's own ceiling), which costs
// exactly the same one request as asking for 3 and gives the quality ranking below an actual pool.
const BRAVE_MAX_PAGE_SIZE=20;
// What one searchCompanies call actually did — read by DiscoveryService for the run metrics and the cost
// ledger. Codes and counts only: never a query, a URL, a key or a provider payload.
export type SearchReport={queries_planned:number;requests_sent:number;requests_failed:number;failure_codes:string[];country:string;country_reason:MarketReason};
type Raw=z.infer<typeof RawSchema>&QualityTagged;
// Canonical form of a result URL, to merge the same page reached by several queries: scheme, "www.",
// fragment, trailing slash and tracking parameters are not part of the page's identity.
function canonicalResultUrl(url:string):string{
 try{const u=new URL(url);for(const k of [...u.searchParams.keys()])if(/^(utm_|gclid$|fbclid$|msclkid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();
  return `${u.hostname.toLowerCase().replace(/^www\./,'')}${u.pathname.replace(/\/+$/,'')||'/'}${u.search}`}catch{return url}
}
const registrableDomain=(url:string):string|null=>{try{return getDomain(new URL(url).hostname)}catch{return null}};
export class BraveProvider implements DiscoveryProvider {
 id='brave';mode='live' as const;private key:string;private request:typeof fetch;lastSearch?:SearchReport;
 constructor(key:string,request:typeof fetch=fetch){if(!key)throw Error('BRAVE_NOT_CONFIGURED');this.key=key;this.request=request}
 // Up to MAX_SEARCH_QUERIES short, complementary queries (query-plan.ts) on the market derived from the
 // zone (market.ts) — never more. Sent one after the other, never in parallel: no burst against the plan's
 // per-second limit, and each call is counted before it is made. A failed query does not fail the search
 // while another one succeeded (its results are simply absent, its failure is reported); a rate limit
 // (HTTP 429) stops the remaining queries instead of spending them. Only when every query failed does the
 // search fail, with the first error.
 async searchCompanies(input:DiscoveryInput){
 const plan=planSearchQueries(input);const market=resolveMarket(input.location,input.optional_filters.country);
 const report:SearchReport={queries_planned:plan.queries.length,requests_sent:0,requests_failed:0,failure_codes:[],country:market.country,country_reason:market.reason};this.lastSearch=report;
 const pools:Array<{query:string;results:Raw[]}>=[];let firstError:unknown;
 for(const query of plan.queries){
  report.requests_sent++;
  try{pools.push({query,results:await this.search(query,market.country)})}
  catch(error){report.requests_failed++;report.failure_codes.push(diagnoseDiscoveryFailure('provider_search',error).cause);firstError??=error;if(error instanceof Error&&error.message==='BRAVE_HTTP_429')break}
 }
 if(!pools.length)throw firstError instanceof Error?firstError:Error('BRAVE_SEARCH_FAILED');
 // Merge BEFORE any ranking or selection: round-robin across queries (no single query owns the ties), one
 // entry per canonical URL, remembering every query that found it (provenance, raw_metadata.search_queries).
 const merged=new Map<string,Raw&{__found_by:string[]}>();
 for(let rank=0;rank<Math.max(...pools.map(p=>p.results.length));rank++)for(const pool of pools){
  const r=pool.results[rank];if(!r)continue;const key=canonicalResultUrl(r.url);const known=merged.get(key);
  if(known){if(!known.__found_by.includes(pool.query))known.__found_by.push(pool.query)}else merged.set(key,Object.assign(r,{__found_by:[pool.query]}));
 }
 // Rank the FULL merged pool by the generic quality heuristic before truncating to what the caller
 // asked for — a stable sort so the merged order among equally-scored results is kept. Deliberately a
 // re-rank, never a drop (see candidate-quality.ts). The user's own full brief is tagged alongside, in
 // memory only: classification, relevance and exclusions are always judged against it, never against a
 // shortened query.
 const context:QueryContext={query:input.query,categories:input.categories,location:input.location};
 const tagged=[...merged.values()].map(r=>Object.assign(r,{__quality:assessCandidateQuality(r,input.location),__context:context} satisfies QualityTagged));
 tagged.sort((a,b)=>(b.__quality?.confidence??0)-(a.__quality?.confidence??0));
 // Several pages of one site found by several queries are one organization at most (merged later in
 // services.ts): the first page of each site comes first, further pages of an already represented site
 // only fill what is left. Reordered, never dropped.
 const seenDomains=new Set<string>();const firstOfSite:typeof tagged=[],repeats:typeof tagged=[];
 for(const r of tagged){const d=registrableDomain(r.url);if(d&&seenDomains.has(d))repeats.push(r);else{if(d)seenDomains.add(d);firstOfSite.push(r)}}
 // Diversity selection runs on the full pool, strictly before truncation (see candidate-diversity.ts).
 return selectDiverseCandidates([...firstOfSite,...repeats],input.max_results);
 }
 // One billed Brave request.
 private async search(q:string,country:string):Promise<Raw[]>{
 const url=new URL('https://api.search.brave.com/res/v1/web/search');
 url.searchParams.set('q',q);
 url.searchParams.set('count',String(BRAVE_MAX_PAGE_SIZE));url.searchParams.set('country',country);url.searchParams.set('search_lang','fr');url.searchParams.set('safesearch','strict');
 const response=await this.request(url,{headers:{Accept:'application/json','X-Subscription-Token':this.key},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok)throw Error(`BRAVE_HTTP_${response.status}`);
 const reader=response.body?.getReader();if(!reader)throw Error('BRAVE_EMPTY_RESPONSE');let total=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1000000)throw Error('BRAVE_RESPONSE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const parsed=z.object({web:z.object({results:z.array(RawSchema)}).optional()}).passthrough().parse(JSON.parse(new TextDecoder().decode(bytes)));
 return (parsed.web?.results??[]).filter(r=>!/(^|\.)linkedin\.com$/.test(new URL(r.url).hostname));
 }
 async fetchCompanyDetails(candidate:Candidate){return candidate} // No private-page fetch; site analysis is separate policy-controlled service.
 normalizeResult(raw:unknown):Candidate {
 const r=RawSchema.parse(raw) as z.infer<typeof RawSchema>&QualityTagged;
 const title=r.title.replace(/<[^>]*>/g,'').slice(0,200);
 const description=(r.description??'').replace(/<[^>]*>/g,'').slice(0,1000);
 const quality=r.__quality;
 // Entity resolution: company NAME and company DOMAIN are resolved independently — a media article
 // can clearly name a real company while citing no verifiable domain at all (e.g. "Grand Frais : 30
 // nouveaux magasins..." on Aufeminin), which is a normal, honest outcome: name RESOLVED, domain
 // UNRESOLVED. Never a domain guessed from the name alone. See entity-resolution.ts.
 const resolution=resolveCanonicalCompany({title,description,sourceUrl:r.url,quality:quality??{confidence:.45,signal:'ambiguous',reasons:[]},context:r.__context});
 // Admissibility gate (admissibility.ts): a page is not a prospect. Only an organization the page
 // explicitly identifies — its own site/job page, or an employer/organization named on a third-party
 // page — that the user's query does not exclude and that is not explicitly outside the requested zone
 // becomes a COMPANY_CANDIDATE. Every other result is kept for transparency as IRRELEVANT (never
 // acceptable, see migration 014) with its reason; its name is only the page's own label.
 const gate=evaluateCandidateAdmissibility({title,description,url:r.url,quality:quality??{confidence:.45,signal:'ambiguous',reasons:[]},context:r.__context,resolution});
 // A resolved organization rejected only for relevance or zone keeps its observed identity (never
 // acceptable either way); an unresolved page keeps only its own label as a name.
 const entity=gate.resolvedEntity;
 const nameMethod=!entity?null:['job_title_employer','own_job_page','labeled_field','title_organization'].includes(entity.method)?entity.method
  :resolution.companyName.status==='RESOLVED'&&resolution.companyName.name===entity.name?resolution.companyName.method:entity.method==='cited_domain'?'domain_label':entity.method==='own_site'?'own_site_title':'explicit_title_pattern';
 const identity={name:entity?.name??pageLabel(title),website:entity?.website??null,city:null,address:null,phone:null};
 // Deduplication is domain-based only (never by name alone — a name like "Orange" or "Action" is far
 // too generic to safely merge on across searches): a real company domain dedupes by that domain;
 // anything else keeps the per-source-page suffix so two results are never falsely merged. Within one
 // search, the same organization reached through several pages is merged in services.ts.
 const dedupeKey=identity.website?new DeduplicationService().key(identity):new DeduplicationService().key(identity)+'|'+new URL(r.url).hostname+new URL(r.url).pathname;
 return CandidateSchema.parse({...identity,canonical_url:entity?.canonicalUrl??null,discovered_source:this.id,source_url:r.url,source_title:r.title.replace(/<[^>]*>/g,'').slice(0,300),discovery_timestamp:new Date().toISOString(),confidence:quality?.confidence??.45,raw_metadata:{
 description,
 company_name_status:entity?'RESOLVED':'UNRESOLVED',
 company_name_method:nameMethod,
 entity_method:entity?.method??null,
 // RESOLVED_HIGH / RESOLVED_MEDIUM / UNRESOLVED — see admissibility.ts. Never an evidence status.
 entity_confidence:entity?.confidence??'UNRESOLVED',
 company_domain_status:entity?.website?'RESOLVED':'UNRESOLVED',
 company_domain_method:entity?.website?(entity.method==='cited_domain'?'domain_in_text':'own_site'):null,
 company_domain_reasons:resolution.companyDomain.reasons,
 // Explicit separation of the organization from the page that surfaced it. company_name/company_domain
 // are null unless the gate admitted a resolved organization; source_class decides whether this result
 // may ever become a prospect (only COMPANY_CANDIDATE — enforced by the database on accept).
 source_class:gate.admissible?'COMPANY_CANDIDATE':'IRRELEVANT',
 source_type:resolution.sourceType,
 page_type:gate.pageType,
 admissibility:{admissible:gate.admissible,reason_code:gate.reasonCode,page_type_reasons:gate.pageTypeReasons},
 location_state:gate.location.state,
 location_target:gate.location.target,
 location_regions:gate.location.regions,
 location_departments:gate.location.departments,
 source_domain:resolution.sourceDomain,
 company_name:entity?.name??null,
 company_domain:entity?.website?sourceDomainOf(entity.website):null,
 classification_reasons:resolution.classificationReasons,
 relevance_terms:resolution.relevanceTerms,
 quality_signal:quality?.signal??'ambiguous',
 quality_reasons:quality?.reasons??[],
 // Which of this Discovery's search queries returned this page (provenance only, never a signal).
 search_queries:r.__found_by??[],
 },deduplication_key:dedupeKey});
 }
}
