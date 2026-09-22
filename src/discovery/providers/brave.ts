import {z} from 'zod';
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider} from '../types.ts';
import {DeduplicationService} from '../deduplication.ts';
import {assessCandidateQuality,type QualityAssessment} from '../candidate-quality.ts';
import {selectDiverseCandidates} from '../candidate-diversity.ts';
import {resolveCanonicalCompany} from '../entity-resolution.ts';
const RawSchema=z.object({title:z.string().min(1),url:z.string().url(),description:z.string().optional()}).passthrough();
// Attached in-memory onto each raw result between searchCompanies and normalizeResult — never
// serialized, never persisted as its own column; it only ever ends up inside Candidate.raw_metadata
// (quality_signal/quality_reasons) and Candidate.confidence, both pre-existing, generic fields.
type QualityTagged={__quality?:QualityAssessment};
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
 url.searchParams.set('q',[input.query,input.location,...input.categories,'site officiel'].join(' '));
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
 const tagged=results.map(r=>Object.assign(r,{__quality:assessCandidateQuality(r,input.location)} satisfies QualityTagged));
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
 const resolution=resolveCanonicalCompany({title,description,sourceUrl:r.url,quality:quality??{confidence:.45,signal:'ambiguous',reasons:[]}});
 const identity={name:resolution.companyName.name,website:resolution.companyDomain.status==='RESOLVED'?resolution.companyDomain.website:null,city:null,address:null,phone:null};
 // Deduplication is domain-based only (never by name alone — a name like "Orange" or "Action" is far
 // too generic to safely merge on): a RESOLVED domain dedupes by that real domain (letting the
 // existing DeduplicationService naturally merge N articles about the same company into one
 // candidate); anything else keeps the per-source-page suffix so two results are never falsely merged.
 const dedupeKey=resolution.companyDomain.status==='RESOLVED'?new DeduplicationService().key(identity):new DeduplicationService().key(identity)+'|'+new URL(r.url).hostname+new URL(r.url).pathname;
 return CandidateSchema.parse({...identity,canonical_url:resolution.companyDomain.status==='RESOLVED'?resolution.companyDomain.canonical_url:null,discovered_source:this.id,source_url:r.url,source_title:r.title.replace(/<[^>]*>/g,'').slice(0,300),discovery_timestamp:new Date().toISOString(),confidence:quality?.confidence??.45,raw_metadata:{
 description,
 company_name_status:resolution.companyName.status,
 company_name_method:resolution.companyName.status==='RESOLVED'?resolution.companyName.method:null,
 company_domain_status:resolution.companyDomain.status,
 company_domain_method:resolution.companyDomain.status==='RESOLVED'?resolution.companyDomain.method:null,
 company_domain_reasons:resolution.companyDomain.reasons,
 quality_signal:quality?.signal??'ambiguous',
 quality_reasons:quality?.reasons??[],
 },deduplication_key:dedupeKey});
 }
}
