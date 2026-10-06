// Signal Engine API (src/signals/api.ts): manual signal, review, intent profile, INTENT read, and the official-site
// scan — same authorization, audit and plan unit as "Analyser le site", unit given back when nothing was read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleSignals,type SignalDeps} from '../src/signals/api.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const P='11111111-1111-4111-8111-111111111111',PROJ='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333';
const json=(v:unknown,status=200)=>Response.json(v,{status});
type Tables={prospect?:any;accepted?:any[];signals?:any[];profile?:any};
function fakeDb(t:Tables){
 const rpc:Array<[string,any]>=[];const reads:string[]=[];
 const builder=(table:string)=>{
  const q:any={_single:false};
  for(const m of ['select','eq','order','limit','in'])q[m]=()=>q;
  q.single=()=>{q._single=true;return q};
  q.then=(ok:any,ko:any)=>{reads.push(table);let data:any=null;
   if(table==='prospects')data=t.prospect??null;
   if(table==='discovery_results')data=t.accepted??[];
   if(table==='signals')data=t.signals??[];
   if(table==='intent_profiles')data=t.profile?[{profile:t.profile}]:[];
   const error=table==='prospects'&&!data?{message:'not found'}:null;
   return Promise.resolve({data,error}).then(ok,ko)};
  return q;
 };
 const db={from:builder,rpc:(name:string,args:any)=>{rpc.push([name,args]);
  const data=name==='save_signals'?{inserted:args.p_signals.length,duplicates:0}:name==='review_signal'?{id:args.p_signal_id,status:'VERIFIED'}:name==='save_intent_profile'?{project_id:args.p_project_id}:null;
  return Promise.resolve({data,error:null})}} as any;
 return {db,rpc,reads};
}
function deps(o:Partial<SignalDeps>={}){
 const log:any[]=[];
 const d:SignalDeps={userId:'u1',now:()=>NOW,staticAllowlist:[],dynamicEnabled:true,
  audit:()=>({record:async(e:any)=>{log.push(['record',e.outcome,e.mode,e.userId]);return 'a1'},complete:async(_id:string,u:string,outcome:string,pages:any,failed:any)=>{log.push(['complete',outcome,pages,failed,u])}}),
  sitePageFetcher:()=>async(url:string)=>{log.push(['fetch',url]);throw Error('unexpected')},
  requireEntitlement:async()=>{log.push(['entitlement'])},refundAnalysis:async()=>{log.push(['refund'])},...o};
 return {d,log};
}
const req=(method:string)=>new Request('https://app.example/api/v1/x',{method});
const PROSPECT={id:P,name:'Kerlan',website:'https://www.kerlan.example/',city:'Rennes',project_id:PROJ,organization_id:'o1'};
const ACCEPTED_OWN_SITE=[{status:'accepted',provider:'brave',source_class:'COMPANY_CANDIDATE',website:'https://www.kerlan.example/',source_url:'https://www.kerlan.example/',raw_payload:{company_domain_method:'own_site'}}];

test('routes it does not own are left to the rest of the API',async()=>{
 const {db}=fakeDb({});const {d}=deps();
 assert.equal(await handleSignals(req('GET'),['prospects',P],{},db,json,d),null);
 assert.equal(await handleSignals(req('POST'),['prospects',P,'analyze'],{},db,json,d),null);
 assert.equal((await handleSignals(req('GET'),['prospects','nope','signals'],{},db,json,d))!.status,400);
});

test('manual signal: strict body, PENDING_REVIEW through save_signals as user_provided — never a status, a confidence or a fetch',async()=>{
 const {db,rpc}=fakeDb({prospect:PROSPECT,profile:{types:{hiring_role:25},terms:['RSSI']}});const {d,log}=deps();
 const ok=await handleSignals(req('POST'),['prospects',P,'signals'],{signal_type:'hiring_role',excerpt:'Kerlan recrute un RSSI à Rennes.',source_url:'https://www.linkedin.com/posts/kerlan-123',published_at:'2026-10-01T09:00:00Z'},db,json,d);
 assert.equal(ok!.status,201);
 const [name,args]=rpc[0];assert.equal(name,'save_signals');assert.equal(args.p_run_id,null);
 const c=args.p_signals[0];
 assert.equal(c.provider,'user_provided');assert.equal(c.source_type,'user_provided');assert.deepEqual(c.matched_terms,['RSSI']);
 assert.equal('status' in c,false);assert.equal('confidence' in c,false);
 assert.equal(log.some(l=>l[0]==='fetch'),false,'a LinkedIn link is stored as the user’s source, never read');
 for(const bad of [{signal_type:'hiring_role',excerpt:'x',source_url:'javascript:alert(1)'},{signal_type:'mood',excerpt:'x',source_url:'https://a.example'},
  {signal_type:'hiring_role',excerpt:' ',source_url:'https://a.example'},{signal_type:'hiring_role',excerpt:'x',source_url:'https://a.example',status:'VERIFIED'},
  {signal_type:'hiring_role',excerpt:'x',source_url:'https://a.example',confidence:1}]){
  assert.equal((await handleSignals(req('POST'),['prospects',P,'signals'],bad as any,db,json,d))!.status,400,JSON.stringify(bad));
 }
 const future=await handleSignals(req('POST'),['prospects',P,'signals'],{signal_type:'funding',excerpt:'x',source_url:'https://a.example',event_date:'2027-01-01'},db,json,d);
 assert.equal(future!.status,400);assert.equal((await future!.json()).code,'FUTURE_DATE');
 assert.equal(rpc.length,1);
});

test('review and intent profile: validated here, decided by the database RPCs',async()=>{
 const {db,rpc}=fakeDb({});const {d}=deps();
 assert.equal((await handleSignals(req('POST'),['signals',S,'review'],{decision:'verify'},db,json,d))!.status,200);
 assert.equal((await handleSignals(req('POST'),['signals',S,'review'],{decision:'approve'},db,json,d))!.status,400);
 assert.equal((await handleSignals(req('POST'),['signals',S,'review'],{decision:'reject',reason:'x'.repeat(301)},db,json,d))!.status,400);
 assert.equal((await handleSignals(req('POST'),['projects',PROJ,'intent-profile'],{types:{funding:30},terms:['RSSI']},db,json,d))!.status,200);
 assert.equal((await handleSignals(req('POST'),['projects',PROJ,'intent-profile'],{types:{funding:80}},db,json,d))!.status,400);
 assert.equal((await handleSignals(req('POST'),['projects',PROJ,'intent-profile'],{types:{mood:10}},db,json,d))!.status,400);
 assert.deepEqual(rpc.map(r=>r[0]),['review_signal','save_intent_profile']);
 assert.deepEqual(rpc[0][1],{p_signal_id:S,p_decision:'verify',p_reason:null});
});

test('GET signals: the list and the INTENT recomputed now (verified and estimated), with the project profile',async()=>{
 const row=(o:any)=>({id:'s',signal_type:'hiring_role',status:'VERIFIED',title:'Kerlan recrute un RSSI',excerpt:'Kerlan recrute un RSSI.',source_url:'https://jobs.example/r',source_domain:'jobs.example',
  confidence:'0.80',event_date:null,published_at:'2026-10-02T00:00:00Z',observed_at:'2026-10-05T00:00:00Z',matched_terms:['RSSI'],...o});
 const {db}=fakeDb({prospect:PROSPECT,signals:[row({}),row({id:'p',status:'PENDING_REVIEW',signal_type:'funding'})],profile:{types:{hiring_role:25,funding:30},terms:['RSSI']}});
 const r=await (await handleSignals(req('GET'),['prospects',P,'signals'],{},db,json,deps().d))!.json();
 assert.equal(r.signals.length,2);assert.ok(r.intent.score>0);assert.ok(r.intent.estimated.score>r.intent.score);assert.equal(r.intent.pending.count,1);
 assert.deepEqual(r.profile,{types:{hiring_role:25,funding:30},terms:['RSSI']});
});

test('scan refusals: entitlement first; no website, refused authorization, no audit writer — no fetch, no plan unit',async()=>{
 const noSite=fakeDb({prospect:{...PROSPECT,website:null}});const a=deps();
 const r1=await handleSignals(req('POST'),['prospects',P,'signal-scan'],{},noSite.db,json,a.d);
 assert.equal(r1!.status,422);assert.equal((await r1!.json()).code,'NO_OFFICIAL_WEBSITE');assert.deepEqual(a.log,[['entitlement']]);
 const policy=fakeDb({prospect:PROSPECT,accepted:[]});const b=deps();
 const r2=await handleSignals(req('POST'),['prospects',P,'signal-scan'],{},policy.db,json,b.d);
 assert.equal((await r2!.json()).code,'SOURCE_POLICY_REQUIRED');assert.equal(policy.rpc.length,0,'no quota consumed');
 assert.deepEqual(b.log,[['entitlement'],['record','SOURCE_POLICY_REQUIRED',null,'u1']],'the refusal is audited, nothing fetched');
 const noAudit=fakeDb({prospect:PROSPECT,accepted:ACCEPTED_OWN_SITE});const c=deps({audit:()=>null});
 const r3=await handleSignals(req('POST'),['prospects',P,'signal-scan'],{},noAudit.db,json,c.d);
 assert.equal(r3!.status,503);assert.equal(noAudit.rpc.length,0);assert.equal(c.log.some(l=>l[0]==='fetch'),false);
 const denied=deps({requireEntitlement:async()=>{throw Error('ENTITLEMENT_REQUIRED')}});
 await assert.rejects(handleSignals(req('POST'),['prospects',P,'signal-scan'],{},fakeDb({prospect:PROSPECT}).db,json,denied.d),/ENTITLEMENT_REQUIRED/);
});

test('scan: audited STARTED → quota → read the authorized site only → ANALYZED with pages; signals saved PENDING_REVIEW',async()=>{
 const {db,rpc}=fakeDb({prospect:PROSPECT,accepted:ACCEPTED_OWN_SITE});
 const pages:Record<string,string>={'https://www.kerlan.example/':'<a href="/carrieres">Carrières</a>','https://www.kerlan.example/carrieres':'<ul><li><a href="/j">Responsable sécurité H/F - CDI</a></li></ul>'};
 let policySeen:any=null;
 const {d,log}=deps({sitePageFetcher:policy=>{policySeen=policy;return async url=>{log.push(['fetch',url]);return {url,html:pages[url]}}}});
 const r=await handleSignals(req('POST'),['prospects',P,'signal-scan'],{},db,json,d);
 const body=await r!.json();
 assert.equal(r!.status,200);assert.equal(body.report.inserted,1);assert.equal(body.pages,2);
 assert.deepEqual(policySeen,{allowedHosts:['kerlan.example'],registrableDomain:'kerlan.example',forbidHttpsDowngrade:true});
 assert.deepEqual(rpc.map(x=>x[0]),['consume_analysis_quota','save_signals']);
 assert.equal(rpc[1][1].p_signals[0].provider,'official_site');
 assert.deepEqual(log.filter(l=>l[0]!=='fetch'),[['entitlement'],['record','STARTED','dynamic_discovery','u1'],['complete','ANALYZED',2,0,'u1']]);
});

test('scan: home page unreadable → precise code, audit closed, plan unit given back',async()=>{
 const {db,rpc}=fakeDb({prospect:PROSPECT,accepted:ACCEPTED_OWN_SITE});
 const {d,log}=deps({sitePageFetcher:()=>async()=>{throw Error('Blocked by robots.txt')}});
 const r=await handleSignals(req('POST'),['prospects',P,'signal-scan'],{},db,json,d);
 assert.equal(r!.status,422);assert.equal((await r!.json()).code,'ROBOTS_DENIED');
 assert.deepEqual(rpc.map(x=>x[0]),['consume_analysis_quota']);
 assert.deepEqual(log.slice(-2),[['complete','ROBOTS_DENIED',0,null,'u1'],['refund']]);
});

test('scan: a fixture prospect gets TEST signals without any network',async()=>{
 const {db,rpc}=fakeDb({prospect:{...PROSPECT,website:'https://kerlan.fixture.example'},accepted:[{status:'accepted',provider:'fixture'}]});
 const {d,log}=deps();
 const r=await (await handleSignals(req('POST'),['prospects',P,'signal-scan'],{},db,json,d))!.json();
 assert.ok(r.report.inserted>0);assert.equal(log.some(l=>l[0]==='fetch'||l[0]==='record'),false);
 assert.ok(rpc[1][1].p_signals.every((s:any)=>s.source_type==='test_fixture'));
});

test('wiring: the API route hands signals to handleSignals with the analysis audit, policy fetcher and refund',async()=>{
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/handleSignals\(request,path,body,db,json,\{/);
 assert.match(route,/createSupabaseAnalysisAudit\(createAdminClient\(\),user\.id\)/);
 assert.match(route,/releaseCommercialUse\(createAdminClient\(\),user\.id,'analysis'\)/);
 assert.ok(route.indexOf('handleSignals(')<route.indexOf("if(resource==='projects'){"),'before the projects routes (GET /projects would answer first)');
 const api=await readFile(new URL('../src/signals/api.ts',import.meta.url),'utf8');
 assert.doesNotMatch(api,/WebSearchSignalProvider/,'web search is not wired before its quota and Brave terms are settled');
});
