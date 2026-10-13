// Signal-first Discovery V1 — Brave Search adapter. Same request limits as the existing Brave calls
// (src/discovery/providers/brave.ts, src/signals/providers/web.ts): 12 s, 1 MB, no redirect, strict safe search,
// country + search_lang, plus the 180-day `freshness` range from the plan. One call = one billed request.
// The key travels only in the X-Subscription-Token header: never in a URL, an error message or a log.
// What is kept from a result: title, URL, snippet (tags and entities removed), the engine's own page date. Nothing
// else of the provider's payload is returned (nor persisted downstream). Social networks are dropped.
import {z} from 'zod';
import type {SearchHit} from './extract.ts';
import type {SignalSearchProvider,SignalSearchRequest} from './provider.ts';

const BRAVE_ENDPOINT='https://api.search.brave.com/res/v1/web/search';
export const BRAVE_TIMEOUT_MS=12000;
export const BRAVE_MAX_BYTES=1000000;
const ResultSchema=z.object({title:z.string().min(1),url:z.string().url(),description:z.string().optional(),page_age:z.string().optional()}).passthrough();
const ResponseSchema=z.object({web:z.object({results:z.array(z.unknown())}).optional()}).passthrough();
// Hosts never used as a source: private social content or profile pages (no LinkedIn scraping, no social posts).
const SOCIAL=/(^|\.)(linkedin\.com|facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|threads\.net|pinterest\.[a-z.]+|snapchat\.com|youtube\.com)$/i;

const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"};
export const cleanText=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/&(#?x?[0-9a-z]+);/gi,(m,e:string)=>ENTITIES[e.toLowerCase()]??m).replace(/\s+/g,' ').trim();

export class BraveSignalSearchProvider implements SignalSearchProvider{
 id='brave' as const;metered=true;
 private readonly key:string;private readonly request:typeof fetch;
 constructor(key:string,request:typeof fetch=fetch){if(!key)throw Error('BRAVE_NOT_CONFIGURED');this.key=key;this.request=request}
 async search(r:SignalSearchRequest):Promise<SearchHit[]>{
  const url=new URL(BRAVE_ENDPOINT);
  url.searchParams.set('q',r.q);url.searchParams.set('count',String(Math.min(20,Math.max(1,r.count))));
  url.searchParams.set('country',r.country);url.searchParams.set('search_lang',r.search_lang);
  url.searchParams.set('safesearch','strict');url.searchParams.set('freshness',r.freshness);
  let response:Response;
  try{response=await this.request(url,{headers:{Accept:'application/json','X-Subscription-Token':this.key},signal:AbortSignal.timeout(BRAVE_TIMEOUT_MS),redirect:'error'})}
  catch(e){throw Error(e instanceof Error&&(e.name==='TimeoutError'||e.name==='AbortError')?'BRAVE_TIMEOUT':'BRAVE_NETWORK_ERROR')}
  if(!response.ok)throw Error(`BRAVE_HTTP_${response.status}`);
  const text=await readBounded(response);
  let parsed:z.infer<typeof ResponseSchema>;
  try{parsed=ResponseSchema.parse(JSON.parse(text))}catch{throw Error('BRAVE_INVALID_RESPONSE')}
  const hits:SearchHit[]=[];
  for(const raw of parsed.web?.results??[]){
   const res=ResultSchema.safeParse(raw);if(!res.success)continue;
   let host='';try{const u=new URL(res.data.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)continue;host=u.hostname}catch{continue}
   if(SOCIAL.test(host))continue;
   hits.push({title:cleanText(res.data.title).slice(0,300),description:cleanText(res.data.description??'').slice(0,1000),url:res.data.url,page_age:res.data.page_age??null});
  }
  return hits;
 }
}
async function readBounded(response:Response):Promise<string>{
 const reader=response.body?.getReader();if(!reader)throw Error('BRAVE_INVALID_RESPONSE');
 let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>BRAVE_MAX_BYTES)throw Error('BRAVE_RESPONSE_TOO_LARGE');chunks.push(value)}}
 catch(e){throw Error(e instanceof Error&&e.message==='BRAVE_RESPONSE_TOO_LARGE'?e.message:'BRAVE_NETWORK_ERROR')}
 finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length}
 return new TextDecoder().decode(bytes);
}
