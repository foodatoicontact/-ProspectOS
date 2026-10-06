import {load} from 'cheerio';
import type {SignalProvider,SignalSearchInput,RawSignal} from '../provider.ts';
import {classifySignal,extractPageItems,signalPageKind,parseDay} from '../extract.ts';
// Signal Engine S3 — the company's own website (provider official_site). Reads the authorized home page, then at most
// MAX_PAGES same-site pages whose link points to news, press or careers, and keeps the dated items they carry: job ads
// (JSON-LD JobPosting, or ads listed on a careers page) and news items (JSON-LD articles, headings next to a
// <time datetime>). The fetcher it receives is already bound to the server's authorization (analysis-authorization.ts)
// and to every SSRF / robots.txt / size / time check of safe-fetch.ts: this module never chooses a host.
export type SiteFetcher=(url:string)=>Promise<{url:string;html:string}>;
const MAX_PAGES=3;
// Older than the longest decay of any signal type: never a reason to contact now, not worth keeping.
const MAX_AGE_DAYS=365;

export class OfficialSiteSignalProvider implements SignalProvider{
 id='official_site' as const;mode='live' as const;
 lastReport={pages:0,failed_pages:0};lastError:unknown=null;
 private rejected:Record<string,number>={};
 private fetchPage:SiteFetcher;private homeUrl:string;
 constructor(fetchPage:SiteFetcher,homeUrl:string){this.fetchPage=fetchPage;this.homeUrl=homeUrl}
 supports(){return true}
 takeRejections(){const r=this.rejected;this.rejected={};return r}
 private reject(code:string){this.rejected[code]=(this.rejected[code]??0)+1}
 async searchSignals({now}:SignalSearchInput):Promise<RawSignal[]>{
  this.lastReport={pages:0,failed_pages:0};this.lastError=null;
  let home;
  try{home=await this.fetchPage(this.homeUrl)}catch(error){this.lastError=error;throw error}
  this.lastReport.pages=1;
  const origin=new URL(home.url).origin;
  const links=new Map<string,'news'|'careers'>();
  const $=load(home.html.slice(0,500000));
  $('a[href]').each((_,el)=>{
   try{
    const url=new URL($(el).attr('href')!,home.url);url.hash='';
    if(url.origin!==origin||url.href===home.url||links.has(url.href))return;
    const kind=signalPageKind(url.href,$(el).text());if(kind)links.set(url.href,kind);
   }catch{/* An invalid link is never fetched. */}
  });
  // Careers first (job ads are the most frequent signal), then news; each kind at most twice, MAX_PAGES in all.
  const ordered=[...links].sort((a,b)=>a[1]===b[1]?0:a[1]==='careers'?-1:1);
  const picked:Array<[string,'news'|'careers']>=[];const perKind={news:0,careers:0};
  for(const [url,kind] of ordered){if(picked.length>=MAX_PAGES)break;if(perKind[kind]>=2)continue;perKind[kind]++;picked.push([url,kind])}
  const pages:Array<{url:string;html:string;careers:boolean}>=[{url:home.url,html:home.html,careers:false}];
  for(const [url,kind] of picked){
   try{const page=await this.fetchPage(url);pages.push({url:page.url,html:page.html,careers:kind==='careers'});this.lastReport.pages++}
   catch{this.lastReport.failed_pages++}
  }
  const out:RawSignal[]=[];
  const oldest=new Date(now.getTime()-MAX_AGE_DAYS*86400000).toISOString().slice(0,10);
  for(const page of pages){
   for(const item of extractPageItems(page.html,{careersPage:page.careers,now})){
    const day=item.published_at?parseDay(item.published_at,now):null;
    if(day&&day<oldest){this.reject('TOO_OLD');continue}
    const type=item.kind==='job'?'hiring_role':classifySignal(`${item.title} ${item.excerpt}`);
    if(!type){this.reject('NO_SIGNAL_TYPE');continue}
    out.push({signal_type:type,title:item.title,excerpt:item.excerpt,source_url:page.url,source_type:'official_website',
     published_at:item.published_at,event_date:item.event_date,metadata:{extraction:item.source,page_kind:page.careers?'careers':page.url===home.url?'home':'news'}});
   }
  }
  return out;
 }
}
