import {z} from 'zod';
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider} from '../types.ts';
import {DeduplicationService} from '../deduplication.ts';
import {assessCandidateQuality,type QualityAssessment} from '../candidate-quality.ts';
import {selectDiverseCandidates} from '../candidate-diversity.ts';
import {resolveCanonicalCompany} from '../entity-resolution.ts';
import {sourceDomainOf,stripExclusionClauses,type QueryContext} from '../source-classification.ts';
import {evaluateCandidateAdmissibility,pageLabel} from '../admissibility.ts';
const RawSchema=z.object({title:z.string().min(1),url:z.string().url(),description:z.string().optional()}).passthrough();
// Attached in-memory onto each raw result between searchCompanies and normalizeResult — never
// serialized, never persisted as its own column; it only ever ends up inside Candidate.raw_metadata
// (quality_signal/quality_reasons) and Candidate.confidence, both pre-existing, generic fields.
type QualityTagged={__quality?:QualityAssessment;__context?:QueryContext};
// Brave bills per request, not per result ($5/1,000 requests — see provider_pricing, unchanged by this
// module): requesting the maximum single-call page size (20, Brave's own ceiling) costs exactly the
// same one request as asking for 3, but gives the quality ranking below an actual pool to rank instead
// of just re-ordering the 3 results the caller happened to ask for. Still exactly one HTTP call per
// user action — no pagination, no retry, no second request.
const BRAVE_MAX_PAGE_SIZE=20;
export class BraveProvider implements DiscoveryProvider {
 id='brave';mode='live' as const;private key:string;private request:typeof fetch;
 constructor(key:string,request:typeof fetch=fetch){if(!key)throw Error('BRAVE_NOT_CONFIGURED');this.key=key;this.request=request}
 async searchCompanies(input:DiscoveryInput){
 const url=new URL('https://api.search.brave.com/res/v1/web/search');
 // "site officiel" is a generic, vertical-agnostic entity-seeking phrase — never a sector/brand/city
 // term — that biases Brave toward an individual establishment's own site rather than editorial
 // content written to rank for the same broad commercial-intent keywords (guides, "top N" listicles,
 // marketplaces). Works identically for a restaurant, a cabinet comptable, or a SaaS company.
 // An exclusion clause ("Exclure organismes de formation et pages DEJEPS") is an instruction for the
 // admissibility gate, not search terms: sent as-is it would pull in exactly the pages it excludes.
 url.searchParams.set('q',[stripExclusionClauses(input.query),input.location,...input.categories,'site officiel'].join(' '));
 url.searchParams.set('count',String(BRAVE_MAX_PAGE_SIZE));url.searchParams.set('country',input.optional_filters.country??'FR');url.searchParams.set('search_lang','fr');url.searchParams.set('safesearch','strict');
 const response=await this.request(url,{headers:{Accept:'application/json','X-Subscription-Token':this.key},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok)throw Error(`BRAVE_HTTP_${response.status}`);
 const reader=response.body?.getReader();if(!reader)throw Error('BRAVE_EMPTY_RESPONSE');let total=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1000000)throw Error('BRAVE_RESPONSE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const parsed=z.object({web:z.object({results:z.array(RawSchema)}).optional()}).passthrough().parse(JSON.parse(new TextDecoder().decode(bytes)));
 const results=(parsed.web?.results??[]).filter(r=>!/(^|\.)linkedin\.com$/.test(new URL(r.url).hostname));
 // Rank the FULL fetched pool by the generic quality heuristic before truncating to what the caller
 // asked for — a stable sort so Brave's own relative ordering among equally-scored results is kept.
 // Deliberately a re-rank, never a drop: every fetched result is still returned, just reordered, so a
 // heuristic false positive never silently hides a possibly-real business (see candidate-quality.ts).
 // The user's own query is tagged alongside, in memory only, so classification can tell a query echoed
 // back by a job board ("Freelance Media : 100 emplois") from a real organization name.
 const context:QueryContext={query:input.query,categories:input.categories,location:input.location};
 const tagged=results.map(r=>Object.assign(r,{__quality:assessCandidateQuality(r,input.location),__context:context} satisfies QualityTagged));
 tagged.sort((a,b)=>(b.__quality?.confidence??0)-(a.__quality?.confidence??0));
 // Diversity selection runs on the FULL quality-sorted pool, strictly before truncation: it can only
 // ever substitute a near-duplicate for a genuinely distinct candidate already present lower in the
 // same pool — never a reason to fetch more or call Brave again (see candidate-diversity.ts).
 return selectDiverseCandidates(tagged,input.max_results);
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
 const nameMethod=!entity?null:entity.method==='job_title_employer'||entity.method==='own_job_page'?entity.method
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
 },deduplication_key:dedupeKey});
 }
}
