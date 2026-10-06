import {z} from 'zod';
import {getDomain} from 'tldts';
import type {SignalProvider,SignalSearchInput,RawSignal,SignalTarget} from '../provider.ts';
import {classifySignal,mentionsCompany,parseDay,fold} from '../extract.ts';
// Signal Engine S3 — targeted web search (provider web_search, Brave Search API). Two short queries per company, past
// year only; only the result's URL, title and snippet are kept (source type search_snippet: the third-party page is
// never fetched). OFF unless SIGNALS_WEB_SEARCH_ENABLED is exactly "true" (see webSearchEnabled): Brave's terms on
// storing results must be checked by the operator first (docs/SIGNAL_ENGINE_V1_PLAN.md §17).
//
// Homonyms (the plan's NO_GO): a result counts only if it names the company by whole words AND something ties it to
// THIS company — the result is on the company's own domain, the text cites that domain, or it names the company's city.
// A name alone never attaches a fact to a company.
const ResultSchema=z.object({title:z.string().min(1),url:z.string().url(),description:z.string().optional(),page_age:z.string().optional(),age:z.string().optional()}).passthrough();
const SOCIAL=/(^|\.)(linkedin|facebook|instagram|tiktok|x|twitter)\.com$/;
const strip=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
const registrable=(url:string|null)=>{if(!url)return null;try{return getDomain(new URL(url).hostname)}catch{return null}};
export const webSearchEnabled=(env:Record<string,string|undefined>)=>env.SIGNALS_WEB_SEARCH_ENABLED==='true'&&!!env.BRAVE_SEARCH_API_KEY;

export function signalQueries(target:SignalTarget):string[]{
 const name=`"${target.name.replace(/"/g,'').trim()}"`;
 return [`${name} (recrute OR recrutement OR nomination OR nommé OR "nouveau directeur")`,
  `${name} (levée OR rachat OR acquisition OR partenariat OR ouverture OR lancement OR certification)`];
}
// Why a result is not attached to this company, or null when it is.
export function homonymRisk(target:SignalTarget,text:string,url:string):'NAME_NOT_FOUND'|'HOMONYM_RISK'|null{
 if(!mentionsCompany(text,target.name))return 'NAME_NOT_FOUND';
 const own=registrable(target.website);
 if(own&&registrable(url)===own)return null;
 if(own&&fold(text).includes(own))return null;
 if(target.city&&target.city.trim().length>=2&&mentionsCompany(text,target.city))return null;
 return 'HOMONYM_RISK';
}

export class WebSearchSignalProvider implements SignalProvider{
 id='web_search' as const;mode='live' as const;
 lastReport={requests_sent:0,requests_failed:0};
 private rejected:Record<string,number>={};
 private key:string;private request:typeof fetch;
 constructor(key:string,request:typeof fetch=fetch){if(!key)throw Error('BRAVE_NOT_CONFIGURED');this.key=key;this.request=request}
 supports(target:SignalTarget){return target.name.trim().length>=2}
 takeRejections(){const r=this.rejected;this.rejected={};return r}
 private reject(code:string){this.rejected[code]=(this.rejected[code]??0)+1}
 async searchSignals({target,now}:SignalSearchInput):Promise<RawSignal[]>{
  const out:RawSignal[]=[];const seen=new Set<string>();let ok=0;let firstError:unknown=null;
  for(const q of signalQueries(target)){
   this.lastReport.requests_sent++;
   let results;
   try{results=await this.search(q);ok++}catch(error){this.lastReport.requests_failed++;firstError??=error;if(error instanceof Error&&error.message==='BRAVE_HTTP_429')break;continue}
   for(const r of results){
    let host:string;try{host=new URL(r.url).hostname.toLowerCase()}catch{continue}
    if(SOCIAL.test(host)){this.reject('SOCIAL_NETWORK');continue}
    if(seen.has(r.url))continue;seen.add(r.url);
    const title=strip(r.title).slice(0,300);const snippet=strip(r.description??'').slice(0,500);
    const text=`${title} ${snippet}`;
    const risk=homonymRisk(target,text,r.url);if(risk){this.reject(risk);continue}
    const type=classifySignal(text);if(!type){this.reject('NO_SIGNAL_TYPE');continue}
    const day=parseDay(r.page_age??null,now)??parseDay(r.age??null,now);
    out.push({signal_type:type,title,excerpt:snippet||title,source_url:r.url,source_type:'search_snippet',
     published_at:day?`${day}T00:00:00.000Z`:null,event_date:null,metadata:{search:'brave'}});
   }
  }
  if(!ok&&firstError)throw firstError instanceof Error?firstError:Error('BRAVE_SEARCH_FAILED');
  return out;
 }
 // One billed Brave request (same limits as Discovery's: 12 s, 1 MB, no redirect, strict safe search).
 private async search(q:string){
  const url=new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q',q);url.searchParams.set('count','10');url.searchParams.set('country','FR');url.searchParams.set('search_lang','fr');
  url.searchParams.set('safesearch','strict');url.searchParams.set('freshness','py');
  const response=await this.request(url,{headers:{Accept:'application/json','X-Subscription-Token':this.key},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok)throw Error(`BRAVE_HTTP_${response.status}`);
  const text=await response.text();if(text.length>1000000)throw Error('BRAVE_RESPONSE_TOO_LARGE');
  const parsed=z.object({web:z.object({results:z.array(ResultSchema)}).optional()}).passthrough().parse(JSON.parse(text));
  return parsed.web?.results??[];
 }
}
