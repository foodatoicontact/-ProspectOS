// ZF org canary — Today 2.0 limited to listed organizations (ZERO_FRICTION_TODAY_ORGS) instead of the global switch. The
// server decides from the organization it resolves itself under the caller's RLS (the project's, the recommendation's, the
// account membership's), never from a value the client sends. Out of scope = exactly the flag-OFF behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {zeroFrictionTodayEnabled,zeroFrictionTodayEnabledFor,zeroFrictionTodayGate,zeroFrictionTodayOrgs} from '../src/ux/zero-friction.ts';
import {handleNextBestActions} from '../src/nba/api.ts';
import {handleZfEvent} from '../src/server/ux-events.ts';
import {zfEventRequest} from '../src/ux/zf-session.ts';

const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const CANARY='00000000-0000-4000-8000-0000000000a1',OTHER='00000000-0000-4000-8000-0000000000a2';
const P_CANARY='00000000-0000-4000-8000-0000000000b1',P_OTHER='00000000-0000-4000-8000-0000000000b2',P_HIDDEN='00000000-0000-4000-8000-0000000000b9';
const A_CANARY='00000000-0000-4000-8000-0000000000d1',A_OTHER='00000000-0000-4000-8000-0000000000d2';
const USER='00000000-0000-4000-8000-000000000001',SESSION='00000000-0000-4000-8000-0000000000c1';
const NOW=new Date('2026-10-18T09:00:00Z');
const ENV={ZERO_FRICTION_TODAY_ORGS:CANARY};

test('flag — global OFF + no org / allowed org / other org; global ON for every org',()=>{
 assert.equal(zeroFrictionTodayEnabledFor({},null),false);
 assert.equal(zeroFrictionTodayEnabledFor({},CANARY),false,'no list: OFF');
 assert.equal(zeroFrictionTodayEnabledFor(ENV,null),false,'global OFF + no org');
 assert.equal(zeroFrictionTodayEnabledFor(ENV,undefined),false);
 assert.equal(zeroFrictionTodayEnabledFor(ENV,''),false);
 assert.equal(zeroFrictionTodayEnabledFor(ENV,CANARY),true,'global OFF + allowed org');
 assert.equal(zeroFrictionTodayEnabledFor({...ENV,ZERO_FRICTION_TODAY_ENABLED:'false'},CANARY),true,'explicit false + list: the list decides');
 assert.equal(zeroFrictionTodayEnabledFor(ENV,OTHER),false,'global OFF + other org');
 for(const v of ['true','1'])for(const org of [null,CANARY,OTHER])assert.equal(zeroFrictionTodayEnabledFor({ZERO_FRICTION_TODAY_ENABLED:v},org),true,`global ${v}`);
 assert.equal(zeroFrictionTodayEnabled(ENV),false,'the list never turns the global switch on');
});
test('list parsing — invalid UUIDs ignored silently, whitespace / case / duplicates tolerated',()=>{
 const env={ZERO_FRICTION_TODAY_ORGS:` ${CANARY.toUpperCase()} ,, not-a-uuid,${CANARY},'${OTHER}',${OTHER}x, 00000000-0000-4000-8000-0000000000a3 `};
 assert.deepEqual([...zeroFrictionTodayOrgs(env)],[CANARY,'00000000-0000-4000-8000-0000000000a3']);
 assert.equal(zeroFrictionTodayEnabledFor(env,CANARY),true);
 assert.equal(zeroFrictionTodayEnabledFor(env,` ${CANARY.toUpperCase()} `),true);
 assert.equal(zeroFrictionTodayEnabledFor(env,OTHER),false,'quoted / suffixed entries are not UUIDs');
 assert.equal(zeroFrictionTodayEnabledFor({ZERO_FRICTION_TODAY_ORGS:'*'},OTHER),false,'no wildcard');
 assert.equal(zeroFrictionTodayEnabledFor({ZERO_FRICTION_TODAY_ORGS:'garbage, ,'},CANARY),false);
 assert.equal(zeroFrictionTodayGate({}),false);
 assert.equal(zeroFrictionTodayGate({ZERO_FRICTION_TODAY_ORGS:'garbage'}),false,'only invalid entries: plain OFF');
 assert.equal(zeroFrictionTodayGate({ZERO_FRICTION_TODAY_ENABLED:'true',...ENV}),true);
 const g=zeroFrictionTodayGate(ENV);assert.equal(typeof g,'function');
 assert.equal((g as (o:string)=>boolean)(CANARY),true);assert.equal((g as (o:string)=>boolean)(OTHER),false);
});

// The caller's RLS client: projects and recommendations of both organizations are readable (a member of both), except P_HIDDEN.
function rlsDb(){
 const reads:string[]=[];
 const rows:Record<string,Record<string,string>>={projects:{[P_CANARY]:CANARY,[P_OTHER]:OTHER},nba_actions:{[A_CANARY]:CANARY,[A_OTHER]:OTHER}};
 const db:any={from:(t:string)=>({select:(cols:string)=>({eq:(_k:string,v:string)=>({maybeSingle:async()=>{reads.push(`${t}:${cols}`);
  const org=rows[t]?.[v];return {data:org?{organization_id:org}:null,error:null}}})}),
  insert:()=>{throw Error('no write expected')},update:()=>{throw Error('no write expected')}}),
  rpc:()=>{throw Error('no rpc expected')}};
 return {db,reads};
}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const deps=(enabled:any)=>({enabled,now:()=>NOW,requireEntitlement:async()=>{throw Error('entitlement reached')}});

test('NBA — a direct call outside the canary organization gets the flag-OFF 404, before entitlement or any write',async()=>{
 const gate=zeroFrictionTodayGate(ENV);
 const cases:[string[],string][]=[
  [['projects',P_OTHER,'next-best-actions'],'GET'],[['projects',P_OTHER,'next-best-actions','today'],'GET'],[['projects',P_OTHER,'next-best-actions','home'],'GET'],
  [['projects',P_OTHER,'next-best-actions','compute'],'POST'],[['projects',P_OTHER,'next-best-actions','ensure-fresh'],'POST'],
  [['next-best-actions',A_OTHER,'decision'],'POST'],[['next-best-actions',A_OTHER,'outcome'],'POST'],[['next-best-actions',A_OTHER],'GET'],
  [['projects',P_HIDDEN,'next-best-actions','today'],'GET'],[['projects','not-a-uuid','next-best-actions'],'GET'],[['next-best-actions','x','decision'],'POST']];
 const off=await handleNextBestActions(new Request('https://x.example/api'),['projects',P_OTHER,'next-best-actions'],{},rlsDb().db,json,deps(false));
 const offBody=await off!.text();
 for(const [p,m] of cases){
  const {db}=rlsDb();
  const r=await handleNextBestActions(new Request('https://x.example/api',{method:m}),[...p],{decision:'DONE'},db,json,deps(gate));
  assert.equal(r?.status,404,p.join('/'));assert.equal(await r!.text(),offBody,`${p.join('/')}: same body as flag OFF`);
 }
 const {db,reads}=rlsDb();
 await handleNextBestActions(new Request('https://x.example/api'),['next-best-actions',A_OTHER],{},db,json,deps(gate));
 assert.deepEqual(reads,['nba_actions:organization_id'],'a recommendation is scoped by its own organization');
});
test('NBA — inside the canary organization the request goes through to the real handler (entitlement reached)',async()=>{
 const gate=zeroFrictionTodayGate(ENV);
 for(const p of [['projects',P_CANARY,'next-best-actions','compute'],['next-best-actions',A_CANARY,'decision']]){
  const {db,reads}=rlsDb();
  let status:number|undefined;
  try{status=(await handleNextBestActions(new Request('https://x.example/api',{method:'POST'}),p,{decision:'DONE'},db,json,deps(gate)))?.status}catch{status=-1}
  assert.notEqual(status,404,`${p.join('/')}: in scope, not refused`);
  assert.equal(reads[0],`${p[0]==='projects'?'projects':'nba_actions'}:organization_id`);
 }
 // Global ON / NEXT_BEST_ACTION_ENABLED: a plain boolean, no scope read at all.
 const {db,reads}=rlsDb();
 const r=await handleNextBestActions(new Request('https://x.example/api',{method:'POST'}),['next-best-actions',A_OTHER,'decision'],{decision:'SEND'},db,json,deps(true));
 assert.equal(r?.status,400,'global ON: validation, any org');assert.deepEqual(reads,[]);
});
test('NBA — in-scope project is not refused (status is never the out-of-scope 404)',async()=>{
 const gate=zeroFrictionTodayGate(ENV);const {db}=rlsDb();
 const r=await handleNextBestActions(new Request('https://x.example/api',{method:'POST'}),['next-best-actions',A_CANARY,'decision'],{decision:'SEND'},db,json,deps(gate));
 assert.equal(r?.status,400,'reached body validation: in scope');
});

function writer(){
 const calls:{op:string;row?:any}[]=[];
 const admin:any={from:(t:string)=>({
  select:()=>{const q:any={eq:()=>q,is:()=>q,limit:async()=>{calls.push({op:`select:${t}`});return {data:[],error:null}}};return q},
  insert:async(row:any)=>{calls.push({op:`insert:${t}`,row});return {error:null}}})};
 return {admin,calls};
}
const zfBody=(project:string)=>zfEventRequest('ZF_TODAY_VIEWED',1200,0,SESSION,project)!.body;
test('ZF events — recorded for the canary organization, refused and not recorded for another one',async()=>{
 const gate=zeroFrictionTodayGate(ENV);
 const inScope=writer();
 assert.equal(await handleZfEvent(zfBody(P_CANARY),rlsDb().db,{id:USER},{admin:()=>inScope.admin,env:{},enabled:gate,log:()=>{}}),'recorded');
 assert.equal(inScope.calls.find(c=>c.op==='insert:events')?.row.organization_id,CANARY);
 const out=writer();
 assert.equal(await handleZfEvent(zfBody(P_OTHER),rlsDb().db,{id:USER},{admin:()=>out.admin,env:{},enabled:gate,log:()=>{}}),'flag_off');
 assert.deepEqual(out.calls,[],'nothing read or written with the writer');
 const off=writer();
 assert.equal(await handleZfEvent(zfBody(P_CANARY),rlsDb().db,{id:USER},{admin:()=>off.admin,env:{},enabled:false,log:()=>{}}),'flag_off');
 assert.deepEqual(off.calls,[]);
 assert.equal(await handleZfEvent(zfBody(P_HIDDEN),rlsDb().db,{id:USER},{admin:()=>writer().admin,env:{},enabled:gate,log:()=>{}}),'invalid','unreadable project');
 assert.equal(await handleZfEvent({...zfBody(P_OTHER),organization_id:CANARY},rlsDb().db,{id:USER},{admin:()=>writer().admin,env:{},enabled:gate,log:()=>{}}),'invalid',
  'a client-sent organization is rejected by the closed body, never trusted');
});
test('route — the three server uses read the org gate; the account flag follows the membership organization; the client never decides',async()=>{
 const route=await read('app/api/v1/[...path]/route.ts');
 assert.match(route,/import \{zeroFrictionTodayEnabledFor,zeroFrictionTodayGate\} from '\.\.\/\.\.\/\.\.\/\.\.\/src\/ux\/zero-friction';/);
 assert.match(route,/enabled:nextBestActionEnabled\(process\.env\)\|\|zeroFrictionTodayGate\(process\.env\)/,'NBA');
 assert.match(route,/handleZfEvent\(body,db,user,\{[^}]*enabled:zeroFrictionTodayGate\(process\.env\)/,'ZF events');
 assert.match(route,/zero_friction_today_enabled:zeroFrictionTodayEnabledFor\(process\.env,membership\?\.organization_id\?\?null\)/,'account');
 assert.doesNotMatch(route,/zeroFrictionTodayEnabled\(process\.env\)/,'no global-only use left');
 assert.doesNotMatch(route,/ZERO_FRICTION_TODAY_ORGS|@[a-z0-9-]+\.[a-z]{2,}['"]/i,'no hardcoded org list or email in the route');
 const page=await read('app/page.tsx');
 assert.match(page,/zero_friction_today_enabled/,'the client only reads what the server answered');
 assert.doesNotMatch(page,/ZERO_FRICTION_TODAY_ORGS/);
 const src=await read('src/ux/zero-friction.ts');
 assert.doesNotMatch(src,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|@/i,'no hardcoded id or email');
});
