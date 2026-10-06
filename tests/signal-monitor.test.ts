// Signal Engine S9 — the monitoring worker and its cron route (src/signals/monitor.ts, app/api/cron/signals).
// Plan GO: missing or wrong secret = no work; every query names the run's organization; runs are always closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runMonitorBatch,cronAuthorized,type MonitorDeps} from '../src/signals/monitor.ts';

const NOW=new Date('2026-10-06T05:17:00Z');
const SECRET='s3cr3t-0123456789abcdef';
test('cron secret: not configured (or too short) = 503 path, wrong or missing = 401, exact Bearer = ok',()=>{
 assert.equal(cronAuthorized('Bearer x',undefined),'not_configured');
 assert.equal(cronAuthorized('Bearer short','short'),'not_configured');
 assert.equal(cronAuthorized(null,SECRET),'unauthorized');
 assert.equal(cronAuthorized(SECRET,SECRET),'unauthorized','the Bearer scheme is required');
 assert.equal(cronAuthorized(`Bearer ${SECRET}x`,SECRET),'unauthorized');
 assert.equal(cronAuthorized(`Bearer ${SECRET}`,SECRET),'ok');
});

type Row=Record<string,any>;
function fakeAdmin(tables:{prospects:Row[];discovery_results?:Row[];intent_profiles?:Row[]},batches:Row[][]){
 const rpc:Array<[string,any]>=[];const filters:Array<[string,string,unknown][]>=[];
 const from=(table:string)=>{const f:[string,string,unknown][]=[];filters.push(f);const q:any={};
  q.select=()=>q;q.eq=(c:string,v:unknown)=>{f.push([table,c,v]);return q};
  const rows=()=>((tables as any)[table]??[]).filter((r:Row)=>f.every(([,c,v])=>r[c]===v));
  q.single=()=>Promise.resolve({data:rows()[0]??null,error:rows()[0]?null:{message:'none'}});
  q.then=(ok:any,ko:any)=>Promise.resolve({data:rows(),error:null}).then(ok,ko);return q};
 let i=0;
 const admin={from,rpc:(name:string,args:any)=>{rpc.push([name,args]);
  if(name==='claim_signal_monitors')return Promise.resolve({data:batches[i++]??[],error:null});
  if(name==='save_monitor_signals')return Promise.resolve({data:{inserted:args.p_signals.length,duplicates:0},error:null});
  return Promise.resolve({data:true,error:null})}} as any;
 return {admin,rpc,filters};
}
const ORG='o1',USER='u1';
const run=(n:number,prospect:string)=>({run_id:`r${n}`,prospect_id:prospect,organization_id:ORG,created_by:USER});
const bodaccItem={signal_type:'leadership_change',title:'Modifications diverses — KERLAN',excerpt:'Modifications diverses — nomination du président.',source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:B1',
 source_type:'legal_announcement',published_at:'2026-09-30T00:00:00.000Z',event_date:null,metadata:{}};
function deps(admin:any,o:Partial<MonitorDeps>={}){
 const log:any[]=[];
 const d:MonitorDeps={admin,now:()=>NOW,budgetMs:45000,batch:5,staticAllowlist:[],dynamicEnabled:true,bodaccEnabled:true,
  sitePageFetcher:()=>async(url)=>{log.push(['fetch',url]);return {url,html:'<a href="/carrieres">Carrières</a>'}},
  bodaccProvider:()=>({id:'bodacc',mode:'live',lastReport:{requests_sent:0,collective_procedures:0},supports:(t:any)=>!!t.siren,takeRejections:()=>({}),searchSignals:async()=>{log.push(['bodacc']);return [bodaccItem]}}) as any,
  audit:(userId)=>({record:async(e:any)=>{log.push(['audit',e.outcome,userId]);return 'a1'},complete:async(_i:string,u:string,outcome:string)=>{log.push(['audit-close',outcome,u])}}),...o};
 return {d,log};
}
const REGISTRY_P={id:'p1',name:'KERLAN',website:null,city:'Rennes',project_id:'pr1',organization_id:ORG};
const SITE_P={id:'p2',name:'Aria',website:'https://www.aria.example/',city:'Lyon',project_id:'pr1',organization_id:ORG};
const tables={prospects:[REGISTRY_P,SITE_P],
 discovery_results:[{prospect_id:'p1',organization_id:ORG,status:'accepted',provider:'registry',raw_payload:{siren:'893196019'}},
  {prospect_id:'p2',organization_id:ORG,status:'accepted',provider:'brave',source_class:'COMPANY_CANDIDATE',website:'https://www.aria.example/',source_url:'https://www.aria.example/',raw_payload:{company_domain_method:'own_site'}}]};

test('batch: BODACC by SIREN for a register prospect; the authorized website (audited as the asker) for a discovered one; runs closed',async()=>{
 const {admin,rpc,filters}=fakeAdmin(tables,[[run(1,'p1'),run(2,'p2')]]);const {d,log}=deps(admin);
 const s=await runMonitorBatch(d);
 assert.deepEqual(s,{claimed:2,completed:2,partial:0,failed:0,inserted:1,out_of_time:false});
 assert.deepEqual(rpc.map(r=>r[0]),['claim_signal_monitors','save_monitor_signals','complete_signal_run','complete_signal_run']);
 assert.equal(rpc[1][1].p_run_id,'r1');assert.equal(rpc[1][1].p_signals[0].provider,'bodacc');
 assert.deepEqual(rpc[2][1].p_status,'completed');
 assert.deepEqual(log.filter(l=>l[0]!=='fetch'),[['bodacc'],['audit','STARTED',USER],['audit-close','ANALYZED',USER]]);
 assert.ok(log.some(l=>l[0]==='fetch'&&l[1]==='https://www.aria.example/'));
 for(const f of filters)if(f.length&&f[0][0]!=='never')assert.ok(f.some(([,c,v])=>c==='organization_id'&&v===ORG),`every read names the organization: ${JSON.stringify(f)}`);
});

test('failures: an unreadable source makes the run "failed" with a code, never an exception; a missing prospect too',async()=>{
 const {admin,rpc}=fakeAdmin(tables,[[run(1,'p1'),run(3,'gone')]]);
 const {d}=deps(admin,{bodaccProvider:()=>({id:'bodacc',mode:'live',lastReport:{requests_sent:0,collective_procedures:0},supports:()=>true,takeRejections:()=>({}),searchSignals:async()=>{throw Error('BODACC_HTTP_503')}}) as any});
 const s=await runMonitorBatch(d);
 assert.equal(s.failed,2);
 assert.deepEqual(rpc.filter(r=>r[0]==='complete_signal_run').map(r=>[r[1].p_run_id,r[1].p_status,r[1].p_error]),[['r1','failed','PROVIDERS_FAILED'],['r3','failed','PROSPECT_NOT_FOUND']]);
});

test('budget: claims in batches until empty; out of time leaves the rest leased for the next cron',async()=>{
 const full=[1,2,3,4,5].map(n=>run(n,'p1'));
 const a=fakeAdmin(tables,[full,[run(6,'p1')]]);const r1=await runMonitorBatch(deps(a.admin).d);
 assert.equal(r1.claimed,6);assert.equal(a.rpc.filter(r=>r[0]==='claim_signal_monitors').length,2);
 let t=0;const b=fakeAdmin(tables,[full]);
 const r2=await runMonitorBatch({...deps(b.admin).d,budgetMs:1000,clock:()=>{t+=400;return t}});
 assert.equal(r2.out_of_time,true);assert.ok(b.rpc.filter(r=>r[0]==='complete_signal_run').length<5);
});

test('no source (no authorized site, no SIREN, BODACC off): the run is closed as done, nothing fetched',async()=>{
 const {admin,rpc}=fakeAdmin({prospects:[{...REGISTRY_P}],discovery_results:[]},[[run(1,'p1')]]);const {d,log}=deps(admin,{bodaccEnabled:false});
 await runMonitorBatch(d);
 assert.deepEqual(rpc.filter(r=>r[0]==='complete_signal_run').map(r=>[r[1].p_status,r[1].p_error]),[['completed','NO_SOURCE']]);
 assert.deepEqual(log,[]);
});

test('route and schedule: GET only, only the Authorization header is read; daily Vercel cron; no LinkedIn, no model',async()=>{
 const route=await readFile(new URL('../app/api/cron/signals/route.ts',import.meta.url),'utf8');
 assert.match(route,/export async function GET\(request:Request\)/);
 assert.doesNotMatch(route,/export async function (POST|PATCH|PUT|DELETE)|request\.(json|text)\(|searchParams/);
 assert.match(route,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(vercel.crons,[{path:'/api/cron/signals',schedule:'17 5 * * *'}]);
 const src=await readFile(new URL('../src/signals/monitor.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/linkedin|anthropic|openai/i);
});
