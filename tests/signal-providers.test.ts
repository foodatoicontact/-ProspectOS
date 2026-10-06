// Signal Engine S3 — the real providers: the company's own website (official_site) and targeted web search
// (web_search, OFF by default). Plan NO_GO: a fact attached to the wrong company in the homonym tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {OfficialSiteSignalProvider} from '../src/signals/providers/site.ts';
import {WebSearchSignalProvider,homonymRisk,signalQueries,webSearchEnabled} from '../src/signals/providers/web.ts';
import {runSignalScan} from '../src/signals/service.ts';
import type {SignalTarget} from '../src/signals/provider.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const T:SignalTarget={prospect_id:'p1',name:'Kerlan',website:'https://www.kerlan.example',siren:null,city:'Rennes'};
const types=['hiring_role','leadership_change','funding','new_site','certification'] as any;

function site(pages:Record<string,string>){
 const asked:string[]=[];
 const fetcher=async(url:string)=>{asked.push(url);if(!(url in pages))throw Error('HTTP status 404');return {url,html:pages[url]}};
 return {fetcher,asked};
}
const HOME=`<html><body><nav>x</nav>
 <a href="/carrieres">Carrières</a><a href="/actualites">Actualités</a><a href="/blog">Blog</a><a href="/presse">Presse</a>
 <a href="https://other.example/jobs">Jobs ailleurs</a><a href="https://www.linkedin.com/company/kerlan">LinkedIn</a><a href="/contact">Contact</a>
</body></html>`;

test('official site: home + at most 3 same-site signal pages (careers first), never another host, never LinkedIn',async()=>{
 const {fetcher,asked}=site({
  'https://www.kerlan.example/':HOME,
  'https://www.kerlan.example/carrieres':`<ul><li><a href="/j/1">Responsable sécurité H/F - CDI</a></li></ul>`,
  'https://www.kerlan.example/actualites':`<article><h3>Kerlan ouvre une nouvelle agence à Brest</h3><time datetime="2026-09-20">20/09</time></article>
   <article><h3>Kerlan obtient la certification ISO 27001 en 2019</h3><time datetime="2019-05-02">2019</time></article>
   <article><h3>Nos équipes étaient à la fête de fin d’année</h3><time datetime="2026-09-01">1/09</time></article>`,
  'https://www.kerlan.example/blog':`<p>Rien de daté</p>`,
 });
 const p=new OfficialSiteSignalProvider(fetcher,'https://www.kerlan.example/');
 const items=await p.searchSignals({target:T,types,now:NOW});
 assert.deepEqual(asked,['https://www.kerlan.example/','https://www.kerlan.example/carrieres','https://www.kerlan.example/actualites','https://www.kerlan.example/blog']);
 assert.deepEqual(items.map(i=>[i.signal_type,i.title,i.source_type]),[
  ['hiring_role','Responsable sécurité H/F - CDI','official_website'],
  ['new_site','Kerlan ouvre une nouvelle agence à Brest','official_website'],
 ]);
 assert.equal(items[0].source_url,'https://www.kerlan.example/carrieres','the page the fact was read on');
 assert.deepEqual(p.takeRejections(),{TOO_OLD:1,NO_SIGNAL_TYPE:1});
 assert.deepEqual(p.takeRejections(),{},'read once');
 assert.deepEqual(p.lastReport,{pages:4,failed_pages:0});
});

test('official site: an unreadable home page fails the call (nothing learned); an unreadable inner page is only counted',async()=>{
 const down=new OfficialSiteSignalProvider(async()=>{throw Error('Blocked by robots.txt')},'https://www.kerlan.example/');
 await assert.rejects(down.searchSignals({target:T,types,now:NOW}),/robots/);
 assert.match(String(down.lastError),/robots/);
 const {fetcher}=site({'https://www.kerlan.example/':HOME});
 const partial=new OfficialSiteSignalProvider(fetcher,'https://www.kerlan.example/');
 assert.deepEqual(await partial.searchSignals({target:T,types,now:NOW}),[]);
 assert.deepEqual(partial.lastReport,{pages:1,failed_pages:3});
});

test('homonyms (NO_GO): the name alone never attaches a fact; own domain, cited domain or the company’s city does',()=>{
 // Same name, other company, other city, other site: refused.
 assert.equal(homonymRisk(T,'Kerlan recrute un comptable à Lyon','https://jobs.example/kerlan-lyon'),'HOMONYM_RISK');
 // The name inside another word: not this company at all.
 assert.equal(homonymRisk(T,'Kerland lève 3 M€ à Rennes','https://news.example/a'),'NAME_NOT_FOUND');
 assert.equal(homonymRisk(T,'Groupe Kerlanor nomme un DG','https://news.example/b'),'NAME_NOT_FOUND');
 // Tied to THIS company.
 assert.equal(homonymRisk(T,'Kerlan ouvre une agence','https://blog.kerlan.example/ouverture'),null,'its own domain');
 assert.equal(homonymRisk(T,'Kerlan (kerlan.example) lève 3 M€','https://news.example/c'),null,'its domain cited');
 assert.equal(homonymRisk(T,'La société rennaise Kerlan recrute — Rennes','https://jobs.example/k'),null,'its city named');
 // No website and no city: nothing can tie a result to this company.
 assert.equal(homonymRisk({...T,website:null,city:null},'Kerlan recrute','https://jobs.example/k'),'HOMONYM_RISK');
});

function brave(resultsByCall:Array<unknown[]|number>){
 const urls:string[]=[];let i=0;
 const request=(async(url:URL)=>{urls.push(url.toString());const r=resultsByCall[i++];
  if(typeof r==='number')return new Response('{}',{status:r});
  return new Response(JSON.stringify({web:{results:r}}),{status:200,headers:{'content-type':'application/json'}})}) as unknown as typeof fetch;
 return {request,urls};
}

test('web search: two targeted queries, past year, results tied to the company only, snippets as low-confidence sources',async()=>{
 const {request,urls}=brave([
  [{title:'Kerlan recrute un <b>RSSI</b> à Rennes',url:'https://jobs.example/kerlan/rssi',description:'Kerlan, ESN rennaise, recrute un RSSI en CDI.',page_age:'2026-09-28T08:00:00'},
   {title:'Kerlan recrute à Lyon',url:'https://jobs.example/kerlan-lyon',description:'Kerlan Lyon recrute un comptable.'},
   {title:'Kerlan - LinkedIn',url:'https://fr.linkedin.com/company/kerlan',description:'Kerlan recrute à Rennes'}],
  [{title:'Kerlan obtient la certification ISO 27001',url:'https://www.kerlan.example/actualites/iso',description:'Kerlan est certifiée.',age:'il y a 3 jours'},
   {title:'Kerlan : nos valeurs',url:'https://www.kerlan.example/valeurs',description:'Proximité et exigence.'}],
 ]);
 const p=new WebSearchSignalProvider('k',request);
 const items=await p.searchSignals({target:T,types,now:NOW});
 assert.equal(urls.length,2);
 for(const u of urls){const q=new URL(u);assert.equal(q.searchParams.get('freshness'),'py');assert.match(q.searchParams.get('q')!,/^"Kerlan" \(/);assert.doesNotMatch(u,/linkedin/i)}
 assert.deepEqual(items.map(i=>[i.signal_type,i.source_url,i.source_type,i.published_at]),[
  ['hiring_role','https://jobs.example/kerlan/rssi','search_snippet','2026-09-28T00:00:00.000Z'],
  ['certification','https://www.kerlan.example/actualites/iso','search_snippet','2026-10-03T00:00:00.000Z'],
 ]);
 assert.equal(items[0].title,'Kerlan recrute un RSSI à Rennes','tags removed');
 assert.deepEqual(p.takeRejections(),{HOMONYM_RISK:1,SOCIAL_NETWORK:1,NO_SIGNAL_TYPE:1});
 assert.deepEqual(p.lastReport,{requests_sent:2,requests_failed:0});
});

test('web search: a rate limit stops the second query; all queries failed = the call fails; OFF unless exactly "true" + key',async()=>{
 const limited=brave([429]);const p=new WebSearchSignalProvider('k',limited.request);
 await assert.rejects(p.searchSignals({target:T,types,now:NOW}),/BRAVE_HTTP_429/);
 assert.equal(limited.urls.length,1);
 const half=brave([500,[{title:'Kerlan lève 2 M€',url:'https://www.kerlan.example/a',description:'Kerlan lève 2 M€.'}]]);
 assert.equal((await new WebSearchSignalProvider('k',half.request).searchSignals({target:T,types,now:NOW})).length,1,'one query enough');
 assert.equal(webSearchEnabled({}),false);
 assert.equal(webSearchEnabled({SIGNALS_WEB_SEARCH_ENABLED:'true'}),false,'no key');
 assert.equal(webSearchEnabled({SIGNALS_WEB_SEARCH_ENABLED:'1',BRAVE_SEARCH_API_KEY:'k'}),false);
 assert.equal(webSearchEnabled({SIGNALS_WEB_SEARCH_ENABLED:'true',BRAVE_SEARCH_API_KEY:'k'}),true);
 assert.throws(()=>new WebSearchSignalProvider(''),/BRAVE_NOT_CONFIGURED/);
 assert.equal(signalQueries({...T,name:'Ker"lan'}).every(q=>q.startsWith('"Kerlan" ')),true,'quotes in a name cannot break the query');
});

test('scan: provider rejections are reported by code next to the service’s own',async()=>{
 const {fetcher}=site({'https://www.kerlan.example/':`<article><h3>Kerlan obtient la certification ISO 27001</h3><time datetime="2016-01-01">x</time></article>`});
 const saved:any[]=[];
 const {report}=await runSignalScan({targets:[T],providers:[new OfficialSiteSignalProvider(fetcher,'https://www.kerlan.example/')],profile:null,budget:{maxRequests:1,deadlineMs:5000},now:NOW,runId:null,
  repo:{saveSignals:async(_p,_r,l)=>{saved.push(l);return {inserted:l.length,duplicates:0}}}});
 assert.deepEqual(report.rejected,{TOO_OLD:1});assert.equal(saved.length,0);
});

test('guardrails: no LinkedIn fetching, no model, the site provider never builds a URL to another host',async()=>{
 for(const f of ['../src/signals/providers/site.ts','../src/signals/providers/web.ts','../src/signals/extract.ts','../src/signals/api.ts']){
  const src=await readFile(new URL(f,import.meta.url),'utf8');
  assert.doesNotMatch(src,/anthropic|openai/i,f);
  assert.doesNotMatch(src,/https?:\/\/[^'"`\s]*linkedin/i,f);
 }
 const siteSrc=await readFile(new URL('../src/signals/providers/site.ts',import.meta.url),'utf8');
 assert.match(siteSrc,/url\.origin!==origin/,'same origin as the authorized home page only');
});
