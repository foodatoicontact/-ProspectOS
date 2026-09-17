import {z} from 'zod';
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider} from '../types.ts';
import {DeduplicationService} from '../deduplication.ts';
const RawSchema=z.object({title:z.string().min(1),url:z.string().url(),description:z.string().optional()}).passthrough();
export class BraveProvider implements DiscoveryProvider {
 id='brave';mode='live' as const;private key:string;private request:typeof fetch;
 constructor(key:string,request:typeof fetch=fetch){if(!key)throw Error('BRAVE_NOT_CONFIGURED');this.key=key;this.request=request}
 async searchCompanies(input:DiscoveryInput){
 const url=new URL('https://api.search.brave.com/res/v1/web/search');url.searchParams.set('q',[input.query,input.location,...input.categories].join(' '));url.searchParams.set('count',String(Math.min(input.max_results,20)));url.searchParams.set('country',input.optional_filters.country??'FR');url.searchParams.set('search_lang','fr');url.searchParams.set('safesearch','strict');
 const response=await this.request(url,{headers:{Accept:'application/json','X-Subscription-Token':this.key},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok)throw Error(`BRAVE_HTTP_${response.status}`);
 const reader=response.body?.getReader();if(!reader)throw Error('BRAVE_EMPTY_RESPONSE');let total=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1000000)throw Error('BRAVE_RESPONSE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const parsed=z.object({web:z.object({results:z.array(RawSchema)}).optional()}).passthrough().parse(JSON.parse(new TextDecoder().decode(bytes)));
 return (parsed.web?.results??[]).filter(r=>!/(^|\.)linkedin\.com$/.test(new URL(r.url).hostname)).slice(0,input.max_results);
 }
 async fetchCompanyDetails(candidate:Candidate){return candidate} // No private-page fetch; site analysis is separate policy-controlled service.
 normalizeResult(raw:unknown):Candidate {
 const r=RawSchema.parse(raw);const title=r.title.replace(/<[^>]*>/g,'').slice(0,200);const identity={name:title,website:null,city:null,address:null,phone:null};
 // A search hit may be a directory or chain page; never label it an official website automatically.
 return CandidateSchema.parse({...identity,canonical_url:null,discovered_source:this.id,source_url:r.url,source_title:r.title.replace(/<[^>]*>/g,'').slice(0,300),discovery_timestamp:new Date().toISOString(),confidence:.45,raw_metadata:{description:(r.description??'').replace(/<[^>]*>/g,'').slice(0,1000),official_website_status:'NOT_VERIFIED'},deduplication_key:new DeduplicationService().key(identity)+'|'+new URL(r.url).hostname+new URL(r.url).pathname});
 }
}
