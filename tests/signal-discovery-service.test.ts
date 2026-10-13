// Signal-first Discovery V1 — P3: service, providers (fixture, Brave adapter), API, feature flag, metrics, refund
// semantics, metering, logs. No network: Brave is exercised with a mocked fetch only; the database with a fake client
// (the real migration-030 functions are exercised end to end in tests/signal-discovery-service-db.mjs).
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {runSignalDiscovery,type SignalDiscoveryRepository,type RunMetrics,type SignalDiscoveryInput} from '../src/signal-discovery/service.ts';
import {FixtureSignalSearchProvider,DEMO_HITS} from '../src/signal-discovery/provider.ts';
import {BraveSignalSearchProvider,cleanText,BRAVE_MAX_BYTES} from '../src/signal-discovery/brave.ts';
import {handleSignalDiscovery,signalDiscoveryEnabled,isSignalDiscoveryPath,type SignalDiscoveryDeps} from '../src/signal-discovery/api.ts';
import {toCandidateRow,CANDIDATE_ROW_FIELDS} from '../src/signal-discovery/record.ts';
import {planSignalQueries} from '../src/signal-discovery/plan.ts';
import {rankSignalCandidates,buildCandidate} from '../src/signal-discovery/rank.ts';
import {contentHash} from '../src/signals/service.ts';
import type {SearchHit} from '../src/signal-discovery/extract.ts';

const NOW=new Date('2026-10-13T10:00:00Z');
const F=JSON.parse(await readFile(new URL('./fixtures/signal-discovery/6xpos-chr-occitanie.json',import.meta.url),'utf8')) as {project:any;hits:Record<string,SearchHit>};
const ALL=Object.values(F.hits);
const PROJ='22222222-2222-4222-8222-222222222222',RUN='44444444-4444-4444-8444-444444444444',CAND='55555555-5555-4555-8555-555555555555',PR='66666666-6666-4666-8666-666666666666';
const INPUT:SignalDiscoveryInput={project_id:PROJ,query:'restaurant',location:'Occitanie',categories:['restauration rapide','snack','coffee shop','café','fast-food','brasserie','boulangerie'],signal_types:['new_site','expansion'],max_results:20};
const json=(v:unknown,status=200)=>Response.json(v,{status});

class MemoryRepo implements SignalDiscoveryRepository{
 log:string[]=[];rows:any[]=[];closed:{status:string;metrics:RunMetrics;error:string|null}|null=null;released=0;failSave=false;
 async start(_i:SignalDiscoveryInput,provider:string){this.log.push(`start:${provider}`);return {id:RUN,organization_id:'org',project_id:PROJ}}
 async saveCandidates(_r:string,rows:any[]){this.log.push('save');if(this.failSave)throw Error('DATABASE_REQUEST_FAILED');this.rows.push(...rows);return {inserted:rows.length,duplicates:0}}
 async complete(_r:string,status:'completed'|'failed',metrics:RunMetrics,error:string|null){this.log.push(`complete:${status}`);this.closed={status,metrics,error};return true}
 async release(){this.log.push('release');this.released++;return true}
}
const run=async(provider:any,repo=new MemoryRepo(),extra:any={})=>{const meters:number[]=[];const logs:any[]=[];
 const r=await runSignalDiscovery(INPUT,{repo,provider,now:()=>NOW,meter:async(_run,n)=>{meters.push(n)},log:l=>logs.push(l),...extra});return {r,repo,meters,logs}};

// ------------------------------------------------------------
// Feature flag
// ------------------------------------------------------------
test('flag — absent, empty, false, 0 (and anything but true / 1) ⇒ off',()=>{
 assert.equal(signalDiscoveryEnabled({}),false);
 for(const v of ['','  ','false','FALSE','0','no','off','yes','enabled','truee'])assert.equal(signalDiscoveryEnabled({SIGNAL_DISCOVERY_ENABLED:v}),false,JSON.stringify(v));
 for(const v of ['true','TRUE',' true ','1'])assert.equal(signalDiscoveryEnabled({SIGNAL_DISCOVERY_ENABLED:v}),true,JSON.stringify(v));
 assert.ok(isSignalDiscoveryPath(['projects',PROJ,'signal-discovery'])&&isSignalDiscoveryPath(['signal-discovery-runs',RUN])&&isSignalDiscoveryPath(['signal-discovery-candidates',CAND,'add']));
 for(const p of [['projects',PROJ,'discovery'],['discovery-runs',RUN],['prospects',PR,'signals'],['projects',PROJ,'intent-profile']])assert.equal(isSignalDiscoveryPath(p),false,p.join('/'));
});

// A fake user client: records every rpc and table read; answers like the 030 functions.
function fakeDb(o:{rpcError?:Record<string,string>}={}){
 const calls:Array<[string,any]>=[];const reads:string[]=[];
 const builder=(table:string)=>{const q:any={};for(const m of ['select','eq','order','limit','in'])q[m]=()=>q;q.single=()=>q;
  q.then=(ok:any,ko:any)=>{reads.push(table);return Promise.resolve({data:table==='signal_discovery_candidates'?[{icp_match:'OUT',review_tier:1},{icp_match:'IN',review_tier:3}]:[],error:null}).then(ok,ko)};return q};
 const db:any={from:builder,rpc:(name:string,args:any)=>{calls.push([name,args]);const err=o.rpcError?.[name];if(err)return Promise.resolve({data:null,error:{message:err}});
  const data=name==='start_signal_discovery'?{id:RUN,organization_id:'org',project_id:args.p_project_id}:name==='save_signal_discovery_candidates'?{inserted:args.p_items.length,duplicates:0}
   :name==='complete_signal_discovery_run'||name==='release_failed_signal_discovery'?true:name==='add_signal_candidate_to_project'?{candidate_id:args.p_candidate_id,prospect_id:PR,signal_id:'sig',created_prospect:true}
   :name==='ignore_signal_candidate'?{id:args.p_candidate_id,status:'IGNORED'}:null;
  return Promise.resolve({data,error:null})}};
 return {db,calls,reads};
}
function deps(o:Partial<SignalDiscoveryDeps>={},provider:any=new FixtureSignalSearchProvider(ALL)){
 const log:any[]=[];const writer=fakeDb();
 const d:SignalDiscoveryDeps={enabled:true,userId:'u1',now:()=>NOW,requireEntitlement:async()=>{log.push('entitlement')},writer:()=>writer.db,
  provider:()=>provider,meter:async(_r,n)=>{log.push(['meter',n])},log:l=>log.push(l),...o};
 return {d,log,writer};
}
const req=(method:string,body?:unknown)=>new Request('http://x/api/v1/x',{method,...(body?{body:JSON.stringify(body)}:{})});
const call=async(path:string[],method:string,body:unknown,d:SignalDiscoveryDeps,db=fakeDb())=>({res:await handleSignalDiscovery(req(method),path,body,db.db,json,d),db});

test('1–2 — flag absent or false: every Signal-first route answers 404; no entitlement read, no run, no rpc, no read',async()=>{
 for(const enabled of [signalDiscoveryEnabled({}),signalDiscoveryEnabled({SIGNAL_DISCOVERY_ENABLED:'false'}),signalDiscoveryEnabled({SIGNAL_DISCOVERY_ENABLED:'0'})]){
  for(const [path,method] of [[['projects',PROJ,'signal-discovery'],'POST'],[['projects',PROJ,'signal-discovery'],'GET'],[['signal-discovery-runs',RUN,'candidates'],'GET'],[['signal-discovery-candidates',CAND,'add'],'POST'],[['signal-discovery-candidates',CAND,'ignore'],'POST']] as const){
   const {d,log,writer}=deps({enabled});
   const {res,db}=await call([...path],method,{query:'restaurant',location:'Occitanie'},d);
   assert.equal(res?.status,404,path.join('/'));
   assert.deepEqual([db.calls,db.reads,writer.calls,log],[[],[],[],[]],'nothing at all happened');
  }
 }
});
test('35 — the flag never touches ENTITY: non-Signal paths are not handled (null), whatever the flag',async()=>{
 for(const enabled of [true,false])for(const path of [['projects',PROJ,'discovery'],['discovery-runs',RUN,'results'],['discovery-results',CAND,'accept'],['prospects',PR,'signals']]){
  const {d}=deps({enabled});const {res,db}=await call(path,'POST',{},d);assert.equal(res,null,path.join('/'));assert.equal(db.calls.length,0);
 }
});
test('3, 7 — flag true: a run goes through entitlement → start (1 unit, in the database) → fixture provider → save → complete',async()=>{
 const {d,log,writer}=deps();
 const {res,db}=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',categories:['restauration rapide','snack','coffee shop'],provider:'fixture'},d);
 assert.equal(res?.status,201);const body=await res!.json();
 assert.equal(body.status,'completed');assert.equal(body.refunded,false);
 assert.equal(log[0],'entitlement');
 assert.deepEqual(db.calls.map(c=>c[0]),['start_signal_discovery'],'started with the MEMBER client');
 assert.equal(db.calls[0]![1].p_provider,'fixture');
 assert.deepEqual(writer.calls.map(c=>c[0]),['save_signal_discovery_candidates','complete_signal_discovery_run'],'saved and closed with the SERVER client');
 assert.ok(!log.some(l=>Array.isArray(l)&&l[0]==='meter'),'fixture is never metered');
});
test('4 — unauthenticated: the router checks the session before any Signal-first route (401)',async()=>{
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 const h=route.indexOf('async function handler(');
 assert.ok(route.indexOf('const {db,user}=await authenticatedDb(request);',h)<route.indexOf('handleSignalDiscovery(request',h));
});
test('5–6 — non-member (database refusal) and inactive entitlement: refused, nothing searched',async()=>{
 const provider=new FixtureSignalSearchProvider(ALL);
 const nm=deps({},provider);const db=fakeDb({rpcError:{start_signal_discovery:'Authenticated tenant member required'}});
 const a=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',provider:'fixture'},nm.d,db);
 assert.equal(a.res?.status,400);assert.equal((await a.res!.json()).code,'DATABASE_REQUEST_FAILED');assert.equal(provider.calls.length,0);assert.equal(nm.writer.calls.length,0);
 for(const [code,status] of [['ENTITLEMENT_REQUIRED',403],['BETA_ACCESS_EXPIRED',402]] as const){
  const e=deps({requireEntitlement:async()=>{throw Error(code)}},provider);
  const r=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',provider:'fixture'},e.d);
  assert.equal(r.res?.status,status);assert.equal((await r.res!.json()).code,code);assert.equal(r.db.calls.length,0,'no start, no unit');assert.equal(provider.calls.length,0);
 }
 for(const [msg,code,status] of [['plan_limit_reached','PLAN_LIMIT_REACHED',429],['quota_exceeded','QUOTA_EXCEEDED',429],['max_results_exceeded','MAX_RESULTS_EXCEEDED',400]] as const){
  const r=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',provider:'fixture'},deps({},provider).d,fakeDb({rpcError:{start_signal_discovery:msg}}));
  assert.equal(r.res?.status,status);assert.equal((await r.res!.json()).code,code);
 }
 assert.equal(provider.calls.length,0);
});
test('API input — strict body; Brave without a key refused before any unit; invalid ids refused',async()=>{
 for(const body of [{location:'Occitanie'},{query:'restaurant',location:'Occitanie',signal_types:['funding']},{query:'restaurant',location:'Occitanie',max_results:51},{query:'restaurant',location:'Occitanie',provider:'registry'},{query:'restaurant',location:'Occitanie',extra:1}]){
  const r=await call(['projects',PROJ,'signal-discovery'],'POST',body,deps().d);assert.equal(r.res?.status,400,JSON.stringify(body));assert.equal(r.db.calls.length,0);
 }
 const nokey=deps({provider:()=>new BraveSignalSearchProvider('')});
 const r=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie'},nokey.d);
 assert.equal(r.res?.status,503);assert.equal((await r.res!.json()).code,'BRAVE_NOT_CONFIGURED');assert.equal(r.db.calls.length,0,'no unit consumed');
 const cfg=deps({writer:()=>{throw Error('CONFIGURATION_REQUIRED')}});
 const c=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',provider:'fixture'},cfg.d);
 assert.equal(c.res?.status,503);assert.equal(c.db.calls.length,0);
 assert.equal((await call(['projects','nope','signal-discovery'],'POST',{query:'restaurant',location:'Occitanie'},deps().d)).res?.status,400);
});

// ------------------------------------------------------------
// Service: plan, requests, P1 pipeline, mapping
// ------------------------------------------------------------
test('8–9 — the P1 plan is used as is: the queries sent are exactly planSignalQueries’, at most 3, with its freshness, FR / fr',async()=>{
 const provider=new FixtureSignalSearchProvider(ALL);await run(provider);
 const plan=planSignalQueries({subjects:[INPUT.query,...INPUT.categories],location:INPUT.location,signal_types:INPUT.signal_types,max_results:INPUT.max_results,now:NOW});
 assert.deepEqual(provider.calls.map(c=>c.q),plan.queries.map(q=>q.q));assert.ok(provider.calls.length<=3);
 for(const c of provider.calls)assert.deepEqual([c.freshness,c.country,c.search_lang],[plan.freshness,'FR','fr']);
 const src=await readFile(new URL('../src/signal-discovery/service.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/LEXICON|ESTABLISHMENT|ouverture|RegExp\(/,'no second extraction logic in the service');
});
test('10–13 — results go through P1: same candidates as rankSignalCandidates; false positives rejected; same event grouped',async()=>{
 const {repo,r}=await run(new FixtureSignalSearchProvider(ALL));
 // Three answered calls returning the same pool: P1 dedupes the repeated URLs and groups the same event.
 const expected=rankSignalCandidates([...ALL,...ALL,...ALL],{target:{activity_terms:[INPUT.query,...INPUT.categories],location:INPUT.location},now:NOW,max_results:20});
 assert.deepEqual(repo.rows,[...expected.review,...expected.out_of_icp].map(toCandidateRow));
 const urls=repo.rows.map(x=>x.source_url);
 for(const id of ['editorial_fast_food_guide','opening_inscriptions','opening_ticketing','opening_hours','expansion_range','expansion_audience'])assert.ok(!urls.includes(F.hits[id]!.url),id);
 assert.ok(r.metrics.rejected.NON_ESTABLISHMENT_OPENING&&r.metrics.rejected.NOT_PHYSICAL_EXPANSION);
 const napolino=repo.rows.filter(x=>x.entity_name==='Napolino'&&x.location_text==='Toulouse');
 assert.equal(napolino.length,1);assert.equal((napolino[0]!.other_sources as unknown[]).length,2);
});
test('14 — mapping P1 → database: exactly the 030 fields, values copied, nothing recomputed',async()=>{
 const migration=await readFile(new URL('../db/migrations/030_signal_discovery.sql',import.meta.url),'utf8');
 const allowed=JSON.parse('['+/allowed text\[\]:=array\[([^\]]+)\]/.exec(migration.slice(migration.indexOf('save_signal_discovery_candidates')))![1]!.replace(/'/g,'"')+']');
 assert.deepEqual([...CANDIDATE_ROW_FIELDS].sort(),[...allowed].sort(),'the mapping and the database list the same fields');
 for(const id of ['future_opening_resolved','event_place_not_headquarters','hosting_netlify','past_exact_day_event']){
  const c=(buildCandidate(F.hits[id]!,{activity_terms:F.project.activity_terms,location:'Occitanie'},NOW) as any).candidate;const row=toCandidateRow(c);
  assert.deepEqual(Object.keys(row).sort(),[...CANDIDATE_ROW_FIELDS].sort());
  assert.deepEqual([row.excerpt,row.source_url,row.signal_type,row.event_key,row.entity_name,row.published_at,row.review_tier,row.icp_match],[c.excerpt,c.source_url,c.signal_type,c.event_key,c.entity_name,c.published_at,c.review_tier,c.icp_match]);
  assert.deepEqual([row.event_date_text,row.event_year,row.event_month,row.event_day,row.event_granularity],[c.event_date?.text??null,c.event_date?.year??null,c.event_date?.month??null,c.event_date?.day??null,c.event_date?.granularity??null]);
  assert.deepEqual([row.event_month_from,row.event_month_to],c.event_date?.months??[null,null]);
  assert.deepEqual([row.location_text,row.location_departments,row.location_basis],[c.location?.text??null,c.location?.departments??[],c.location?.basis??null]);
  assert.equal(row.content_hash,contentHash(c.excerpt));
  assert.equal(row.trigger_text,c.trigger);assert.equal(row.entity_method,c.entity_name_method);
 }
});
test('15–16 — every saved row is a search snippet, never observed on the page',async()=>{
 const {repo}=await run(new FixtureSignalSearchProvider(ALL));
 assert.ok(repo.rows.length>0);
 for(const row of repo.rows){assert.equal(row.source_type,'search_snippet');assert.equal(row.observed_on_page,false)}
});

// ------------------------------------------------------------
// 17–22: metrics and failure semantics (cases A–E)
// ------------------------------------------------------------
const down=(code='BRAVE_HTTP_503')=>Error(code);
test('17–18 / A — 3 requests fail: sent 3, answered 0 → failed PROVIDER_UNAVAILABLE, refund asked',async()=>{
 const {r,repo,meters}=await run(new FixtureSignalSearchProvider([],[down(),down('BRAVE_TIMEOUT'),down('BRAVE_INVALID_RESPONSE')]));
 assert.deepEqual([r.metrics.requests_sent,r.metrics.requests_answered,r.metrics.requests_failed],[3,0,3]);
 assert.deepEqual(r.metrics.failure_codes,['BRAVE_HTTP_503','BRAVE_TIMEOUT','BRAVE_INVALID_RESPONSE']);
 assert.deepEqual([r.status,r.error_code,r.refunded],['failed','PROVIDER_UNAVAILABLE',true]);
 assert.deepEqual(repo.log,['start:fixture','complete:failed','release']);assert.deepEqual(repo.closed?.metrics.requests_answered,0);
 assert.deepEqual(meters,[],'a fixture provider is never metered');
});
test('B — 1 valid answer + 2 errors: sent 3, answered 1 → completed, no refund',async()=>{
 const {r,repo}=await run(new FixtureSignalSearchProvider([],[[F.hits.future_opening_resolved!],down(),down()]));
 assert.deepEqual([r.metrics.requests_sent,r.metrics.requests_answered,r.status,r.refunded,repo.released],[3,1,'completed',false,0]);
});
test('B′ — 1 valid answer + 2 errors with a storage failure: failed, still no refund (the source answered)',async()=>{
 const repo=new MemoryRepo();repo.failSave=true;
 const {r}=await run(new FixtureSignalSearchProvider([],[[F.hits.future_opening_resolved!],down(),down()]),repo);
 assert.deepEqual([r.status,r.error_code,r.refunded,repo.released],['failed','PERSISTENCE_FAILED',false,0]);
});
test('C — valid answers with zero results: completed, no refund',async()=>{
 const {r,repo}=await run(new FixtureSignalSearchProvider([],[[],[],[]]));
 assert.deepEqual([r.metrics.requests_sent,r.metrics.requests_answered,r.metrics.results_received,r.status,r.refunded,repo.released],[3,3,0,'completed',false,0]);
 assert.deepEqual(repo.log,['start:fixture','complete:completed'],'nothing to save');
});
test('D — valid answers, zero candidate after extraction (guide, registrations, range): completed, no refund',async()=>{
 const noise=['editorial_fast_food_guide','opening_inscriptions','expansion_range'].map(id=>F.hits[id]!);
 const {r,repo}=await run(new FixtureSignalSearchProvider(noise));
 assert.deepEqual([r.metrics.results_received>0,r.metrics.candidates,r.metrics.out_of_icp,r.status,r.refunded,repo.released],[true,0,0,'completed',false,0]);
});
test('E — storage failure after an answered request: failed PERSISTENCE_FAILED, never completed, no refund',async()=>{
 const repo=new MemoryRepo();repo.failSave=true;
 const {r}=await run(new FixtureSignalSearchProvider(ALL),repo);
 assert.deepEqual([r.status,r.error_code,r.refunded,repo.closed?.status,repo.released],['failed','PERSISTENCE_FAILED',false,'failed',0]);
});
test('a rate limit (HTTP 429) stops the remaining requests instead of spending them; a run that cannot be closed is never "completed"',async()=>{
 const {r}=await run(new FixtureSignalSearchProvider([],[down('BRAVE_HTTP_429'),[],[]]));
 assert.deepEqual([r.metrics.requests_sent,r.metrics.requests_answered,r.status,r.refunded],[1,0,'failed',true]);
 const repo=new MemoryRepo();repo.complete=async()=>false;
 const x=await run(new FixtureSignalSearchProvider(ALL),repo);
 assert.deepEqual([x.r.status,x.r.error_code,x.r.refunded],['failed','RUN_CLOSE_FAILED',false]);
});
test('time budget: no request starts after the deadline',async()=>{
 let t=0;const provider=new FixtureSignalSearchProvider(ALL);
 const {r}=await run(provider,new MemoryRepo(),{clock:()=>(t+=25000),deadlineMs:40000});
 assert.ok(r.metrics.requests_sent<3);assert.equal(r.metrics.out_of_time,true);
});

// ------------------------------------------------------------
// Brave adapter (mocked fetch only)
// ------------------------------------------------------------
const KEY='brave-test-key-0000-not-real';
const braveBody=(results:unknown[])=>JSON.stringify({web:{results},query:{original:'x'},mixed:{}});
const okFetch=(text:string,status=200)=>async(_url:any,_init:any)=>new Response(text,{status});
test('Brave — request: endpoint, q, count, FR, fr, strict, freshness, key only in the header, 12 s timeout, no redirect',async()=>{
 const seen:any[]=[];
 const p=new BraveSignalSearchProvider(KEY,(async(url:any,init:any)=>{seen.push([String(url),init]);return new Response(braveBody([]))}) as any);
 assert.deepEqual(await p.search({q:'restaurant "nouvelle ouverture" Occitanie',freshness:'2026-04-16to2026-10-13',country:'FR',search_lang:'fr',count:20}),[]);
 const [url,init]=seen[0];const u=new URL(url);
 assert.equal(u.origin+u.pathname,'https://api.search.brave.com/res/v1/web/search');
 assert.deepEqual(Object.fromEntries(u.searchParams),{q:'restaurant "nouvelle ouverture" Occitanie',count:'20',country:'FR',search_lang:'fr',safesearch:'strict',freshness:'2026-04-16to2026-10-13'});
 assert.ok(!url.includes(KEY));assert.equal(init.headers['X-Subscription-Token'],KEY);assert.equal(init.redirect,'error');assert.ok(init.signal);
 assert.equal(p.metered,true);
});
test('Brave — normalization: tags and entities removed, page_age kept, social networks and bad URLs dropped, payload not kept',async()=>{
 const p=new BraveSignalSearchProvider(KEY,okFetch(braveBody([
  {title:'<strong>Napolino</strong> ouvrira à Toulouse',url:'https://www.depeche-exemple.fr/a',description:'L&#39;enseigne <strong>Napolino</strong> ouvrira &amp; recrute',page_age:'2026-10-01T08:00:00',profile:{name:'x'},extra_snippets:['y']},
  {title:'Profil',url:'https://www.linkedin.com/company/napolino',description:'x'},{title:'Post',url:'https://www.facebook.com/napolino/posts/1',description:'x'},
  {title:'Ftp',url:'ftp://exemple.fr/x',description:'x'},{title:'',url:'https://exemple.fr/'},{nope:true},
 ])) as any);
 const hits=await p.search({q:'q',freshness:'f',country:'FR',search_lang:'fr',count:20});
 assert.deepEqual(hits,[{title:'Napolino ouvrira à Toulouse',description:'L\'enseigne Napolino ouvrira & recrute',url:'https://www.depeche-exemple.fr/a',page_age:'2026-10-01T08:00:00'}]);
 assert.equal(cleanText('a <b>b</b> &amp;&nbsp;c'),'a b & c');
});
test('Brave — "answered" contract: 2xx with a valid body (even empty) answers; HTTP error, network, timeout, invalid or oversized body throw',async()=>{
 const s={q:'q',freshness:'f',country:'FR',search_lang:'fr',count:20};
 assert.deepEqual(await new BraveSignalSearchProvider(KEY,okFetch('{}') as any).search(s),[],'no web block = zero results, answered');
 for(const [f,code] of [
  [okFetch('{}',503),'BRAVE_HTTP_503'],[okFetch('{}',429),'BRAVE_HTTP_429'],[okFetch('not json'),'BRAVE_INVALID_RESPONSE'],[okFetch('{"web":{"results":"x"}}'),'BRAVE_INVALID_RESPONSE'],
  [okFetch('x'.repeat(BRAVE_MAX_BYTES+10)),'BRAVE_RESPONSE_TOO_LARGE'],
  [async()=>{throw new TypeError('fetch failed')},'BRAVE_NETWORK_ERROR'],[async()=>{throw Object.assign(Error('t'),{name:'TimeoutError'})},'BRAVE_TIMEOUT'],
 ] as const)await assert.rejects(new BraveSignalSearchProvider(KEY,f as any).search(s),new RegExp(`^Error: ${code}$`),code);
 assert.throws(()=>new BraveSignalSearchProvider(''),/BRAVE_NOT_CONFIGURED/);
});
test('Brave through the service: answered/sent counted from real adapter outcomes',async()=>{
 let n=0;const p=new BraveSignalSearchProvider(KEY,(async()=>{n++;return n===2?new Response('{}',{status:500}):new Response(braveBody([{title:F.hits.future_opening_resolved!.title,url:F.hits.future_opening_resolved!.url,description:F.hits.future_opening_resolved!.description,page_age:'2026-10-01T08:00:00Z'}]))}) as any);
 const {r,meters}=await run(p);
 assert.deepEqual([r.metrics.requests_sent,r.metrics.requests_answered,r.metrics.requests_failed,r.status],[3,2,1,'completed']);
 assert.deepEqual(meters,[3],'23 — Brave usage metered once, with the exact number of requests sent (failed ones included)');
});

// ------------------------------------------------------------
// 23–24: metering, secrets in logs and errors
// ------------------------------------------------------------
test('23 — metering: brave only, once per run, requests sent (not results); fixture and zero-request runs never metered',async()=>{
 const {d,log}=deps({},new BraveSignalSearchProvider(KEY,okFetch(braveBody([])) as any));
 await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie'},d);
 assert.deepEqual(log.filter(l=>Array.isArray(l)&&l[0]==='meter'),[['meter',3]]);
 const f=deps();await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',provider:'fixture'},f.d);
 assert.equal(f.log.filter(l=>Array.isArray(l)&&l[0]==='meter').length,0);
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/meter:\(run,requestCount\)=>recordApiUsage\(\{organizationId:run\.organization_id,projectId:run\.project_id,userId:user\.id,provider:'brave',operation:'search',requestCount\}\)/);
});
test('24 — no key, token or snippet in logs, errors or answers',async()=>{
 const spies=['log','info','warn','error'].map(m=>mock.method(console,m as any,()=>{}));
 try{
  const failing=new BraveSignalSearchProvider(KEY,(async()=>{throw Error(`connect ECONNREFUSED with token ${KEY}`)}) as any);
  const {d,log}=deps({},failing);
  const {res}=await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie'},d);
  const answer=await res!.text();
  const everything=JSON.stringify(log)+answer+JSON.stringify(spies.flatMap(s=>s.mock.calls.map(c=>c.arguments)));
  assert.doesNotMatch(everything,new RegExp(KEY));assert.doesNotMatch(everything,/X-Subscription-Token|Authorization|ECONNREFUSED/i);
  assert.match(answer,/PROVIDER_UNAVAILABLE/);assert.match(answer,/BRAVE_NETWORK_ERROR/);
  const ok=deps({},new FixtureSignalSearchProvider(ALL));await call(['projects',PROJ,'signal-discovery'],'POST',{query:'restaurant',location:'Occitanie',provider:'fixture'},ok.d);
  const line=ok.log.find(l=>l&&l.component==='signal-discovery');
  assert.deepEqual(Object.keys(line).sort(),['candidates','closed','component','error_code','provider','refunded','requests_answered','requests_sent','results','run_id','saved','status']);
  assert.doesNotMatch(JSON.stringify(ok.log),/Napolino|ouvrira|https?:/,'no snippet, title or URL in logs');
 }finally{spies.forEach(s=>s.mock.restore())}
});

// ------------------------------------------------------------
// 25–32: add / ignore through the P2 functions only; nothing verified, no evidence, no FIT or INTENT change
// ------------------------------------------------------------
test('25–27 — add and ignore call the 030 functions with the member client (PENDING_REVIEW decided by the database)',async()=>{
 const {d,writer}=deps();
 const a=await call(['signal-discovery-candidates',CAND,'add'],'POST',{name:'Terroir Club'},d);
 assert.equal(a.res?.status,201);assert.deepEqual(a.db.calls,[['add_signal_candidate_to_project',{p_candidate_id:CAND,p_name:'Terroir Club',p_website:null,p_existing_prospect_id:null}]]);
 const e=await call(['signal-discovery-candidates',CAND,'add'],'POST',{prospect_id:PR},d);
 assert.deepEqual(e.db.calls[0]![1],{p_candidate_id:CAND,p_name:null,p_website:null,p_existing_prospect_id:PR});
 const i=await call(['signal-discovery-candidates',CAND,'ignore'],'POST',{},d);
 assert.equal(i.res?.status,200);assert.deepEqual(i.db.calls,[['ignore_signal_candidate',{p_candidate_id:CAND}]]);
 assert.equal(writer.calls.length,0,'never the privileged client for a person’s decision');
 for(const body of [{prospect_id:PR,name:'X'},{website:'javascript:alert(1)'},{status:'VERIFIED'},{name:''}]){
  const r=await call(['signal-discovery-candidates',CAND,'add'],'POST',body,d);assert.equal(r.res?.status,400,JSON.stringify(body));assert.equal(r.db.calls.length,0);
 }
 for(const [msg,code,status] of [['ENTITY_NAME_REQUIRED','ENTITY_NAME_REQUIRED',400],['CANDIDATE_IGNORED','CANDIDATE_IGNORED',409],['Prospect not found','PROSPECT_NOT_FOUND',404],['Signal discovery candidate not found','CANDIDATE_NOT_FOUND',404]] as const){
  const r=await call(['signal-discovery-candidates',CAND,'add'],'POST',{},d,fakeDb({rpcError:{add_signal_candidate_to_project:msg}}));
  assert.equal(r.res?.status,status);assert.equal((await r.res!.json()).code,code);
 }
 // Reading candidates or runs is never a run: no rpc at all.
 const g=await call(['signal-discovery-runs',RUN,'candidates'],'GET',{},d);
 assert.deepEqual(g.db.calls,[]);assert.deepEqual((await g.res!.json()).map((x:any)=>x.icp_match),['IN','OUT'],'IN first, OUT of ICP last');
});
test('28–32 — no Signal-first code path can verify, write evidence or observations, or read FIT / INTENT',async()=>{
 const dir=new URL('../src/signal-discovery/',import.meta.url);
 for(const f of await readdir(dir)){
  const code=(await readFile(new URL(f,dir),'utf8')).split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code,/review_signal|'VERIFIED'|"VERIFIED"|reviewed_by/,`${f}: no verification`);
  assert.doesNotMatch(code,/from\('(evidence|prospect_observations|signals|prospects)'\)|save_discovery_observations|save_signals\b|scoreProspect|scoreIntent|domain\/core|domain\/intent/,`${f}: no evidence, observation, direct signal write, FIT or INTENT`);
 }
 const api=await readFile(new URL('api.ts',dir),'utf8');
 assert.deepEqual([...new Set(api.match(/rpc\('[a-z_]+'/g))].sort(),["rpc('add_signal_candidate_to_project'","rpc('ignore_signal_candidate'"]);
 const repo=await readFile(new URL('repository.ts',dir),'utf8');
 assert.deepEqual([...new Set(repo.match(/rpc\('[a-z_]+'/g))].sort(),["rpc('complete_signal_discovery_run'","rpc('release_failed_signal_discovery'","rpc('save_signal_discovery_candidates'","rpc('start_signal_discovery'"]);
});

// ------------------------------------------------------------
// 33–35: ENTITY and Registry untouched
// ------------------------------------------------------------
test('33–34 — ENTITY / Registry: their modules never reference Signal-first; the router hands them the request first, unchanged',async()=>{
 for(const f of ['../src/discovery/api.ts','../src/discovery/services.ts','../src/discovery/observations.ts','../src/discovery/providers/index.ts','../src/discovery/providers/brave.ts','../src/discovery/providers/registry.ts','../src/discovery/types.ts','../src/signals/api.ts'])
  assert.doesNotMatch(await readFile(new URL(f,import.meta.url),'utf8'),/signal-discovery|signal_discovery|SIGNAL_DISCOVERY/,f);
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 const h=route.indexOf('async function handler(');
 assert.ok(route.indexOf('handleDiscovery(request,path,body,db,user)',h)<route.indexOf('handleSignalDiscovery(request',h),'ENTITY first');
 assert.equal((route.match(/SIGNAL_DISCOVERY_ENABLED|signalDiscoveryEnabled\(process\.env\)/g)??[]).length,1,'the flag is read once, for Signal-first only');
 assert.equal((route.match(/handleDiscovery\(request,path,body,db,user\)/g)??[]).length,1);
});
test('fixture provider default answers: fictitious, no real brand',()=>{
 for(const h of DEMO_HITS)assert.match(new URL(h.url).hostname,/-exemple\.fr$/);
});
