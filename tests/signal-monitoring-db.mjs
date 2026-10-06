// Migration 026 — Signal Engine S9: monitoring queue on real PostgreSQL (PGlite) with the full migration chain. Plan cap,
// claiming (one run per prospect per day, leases, retries), pauses without a user, the shared save core.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg})`)}
const h=t=>createHash('sha256').update(t).digest('hex');
const sig=(o={})=>({provider:'web_search',signal_type:'hiring_role',title:'ACME recrute un RSSI',excerpt:'ACME recrute un Responsable de la sécurité des systèmes d’information (RSSI) en CDI à Lyon.',
 source_url:'https://www.welcometothejungle.com/fr/companies/acme/jobs/rssi',source_type:'job_board',published_at:'2026-10-02T09:00:00Z',observed_at:'2026-10-05T09:00:00Z',
 matched_terms:['RSSI'],content_hash:h('rssi'),event_key:'hiring_role:rssi',...o});
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('026_signal_monitoring.sql'),'migration 026 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await db.exec(`alter table auth.users add column if not exists last_sign_in_at timestamptz;alter table auth.users add column if not exists created_at timestamptz not null default now();`);

 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2),C=U(3);
 for(const [u,e] of [[A,'a@t'],[B,'b@t'],[C,'c@t']])await sql(`insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values($1,$2,now(),now())`,[u,e]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const prospect=async(u,o,p,n)=>(await as(u,`insert into public.prospects(organization_id,project_id,name) values($1,$2,$3) returning id`,[o,p,n])).rows[0].id;
 const pr=[];for(let i=0;i<12;i++)pr.push(await prospect(A,oa,pa,`P${i}`));
 const prB=await prospect(B,ob,pb,'B0');
 const plan=(u,p,seats=null)=>sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,seats) values($1,$2,'ACTIVE',now(),now()+interval '30 days',$3)
  on conflict(user_id) do update set plan=excluded.plan,status='ACTIVE',expires_at=excluded.expires_at,seats=excluded.seats`,[u,p,seats]);
 const monitor=(u,p,on=true)=>as(u,'select public.set_prospect_monitoring($1,$2) r',[p,on]).then(r=>r.rows[0].r);
 const claim=n=>service('select * from public.claim_signal_monitors($1)',[n]).then(r=>r.rows);
 const sig=(o={})=>({provider:'bodacc',signal_type:'leadership_change',title:'Modifications diverses — P0',excerpt:'Modifications diverses — nomination du président.',source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:B1',
  source_type:'legal_announcement',published_at:'2026-09-30T00:00:00Z',observed_at:new Date().toISOString(),matched_terms:[],content_hash:h('b1'),event_key:'leadership_change:b1',...o});

 await check('CAP: trial 0, Solo 10, Pro 50; Enterprise daily; the cap is per organization; stopping frees a slot',async()=>{
  await plan(A,'BETA');await refused(()=>monitor(A,pr[0]),/monitoring_limit_reached/,'a trial monitoring');
  await plan(A,'PAID');for(let i=0;i<10;i++)assert.equal((await monitor(A,pr[i])).monitored,true);
  await refused(()=>monitor(A,pr[10]),/monitoring_limit_reached/,'an 11th prospect on Solo');
  assert.equal((await monitor(A,pr[0])).monitored,true,'re-enabling an already monitored prospect is not a new slot');
  assert.deepEqual(await monitor(A,pr[9],false),{monitored:false});assert.equal((await monitor(A,pr[10])).monitored,true);
  await plan(A,'ENTERPRISE');const e=await monitor(A,pr[11]);assert.equal(e.frequency_days,1);assert.equal(e.cap,500);
  await plan(A,'PAID');
  assert.equal((await as(A,'select count(*)::int n from public.monitored_prospects')).rows[0].n,11);
  assert.equal((await as(A,`select count(*)::int n from public.events where kind='monitoring.started'`)).rows[0].n,13);
 });
 await check('TENANT and DIRECT WRITES: another organization cannot monitor nor read; members never write the table',async()=>{
  await plan(B,'PRO');
  await refused(()=>monitor(B,pr[0]),/member/i,'monitoring another tenant’s prospect');
  assert.equal((await as(B,'select count(*)::int n from public.monitored_prospects')).rows[0].n,0);
  await refused(()=>as(A,`update public.monitored_prospects set frequency_days=1`),/permission denied/,'a direct update');
  await refused(()=>as(A,`delete from public.monitored_prospects`),/permission denied/,'a direct delete');
  await refused(()=>as(A,'select * from public.claim_signal_monitors(5)'),/permission denied/,'a member claiming');
  await refused(()=>as(A,'select public.save_monitor_signals($1,$2::jsonb)',[U(99),'[]']),/permission denied/,'a member saving as the cron');
 });
 await check('CLAIM: due monitors only, one run per prospect per day with a lease; next run moved by the frequency',async()=>{
  const first=await claim(50);assert.equal(first.length,11);
  assert.ok(first.every(r=>r.created_by===A&&r.organization_id===oa));
  assert.equal((await claim(50)).length,0,'nothing due any more');
  await sql(`update public.monitored_prospects set next_run_at=now()-interval '1 minute' where prospect_id=$1`,[pr[1]]);
  assert.equal((await claim(50)).length,0,'the same day never creates a second run for a prospect');
  const run=(await sql(`select * from public.signal_runs where prospect_ids[1]=$1`,[pr[1]])).rows[0];
  assert.equal(run.status,'running');assert.equal(run.trigger,'monitor');assert.ok(run.lease_until>new Date());assert.equal(run.attempts,1);
  const next=(await sql(`select next_run_at from public.monitored_prospects where prospect_id=$1`,[pr[2]])).rows[0].next_run_at;
  assert.ok(next>new Date(Date.now()+6*86400000),'Solo: weekly');
 });
 await check('SAVE: the cron saves as the member who asked, on its running run only; signals stay PENDING_REVIEW',async()=>{
  const run=(await sql(`select id from public.signal_runs where prospect_ids[1]=$1`,[pr[0]])).rows[0].id;
  const r=(await service('select public.save_monitor_signals($1,$2::jsonb) r',[run,JSON.stringify([sig()])])).rows[0].r;assert.deepEqual(r,{inserted:1,duplicates:0});
  const s=(await sql(`select * from public.signals where prospect_id=$1`,[pr[0]])).rows[0];
  assert.equal(s.status,'PENDING_REVIEW');assert.equal(s.signal_run_id,run);assert.equal(Number(s.confidence),1);
  assert.equal((await sql(`select actor_id from public.events where kind='signals.saved' and prospect_id=$1`,[pr[0]])).rows[0].actor_id,A);
  assert.equal((await service('select public.complete_signal_run($1,$2,$3::jsonb,null) ok',[run,'completed','{"inserted":1}'])).rows[0].ok,true);
  await refused(()=>service('select public.save_monitor_signals($1,$2::jsonb)',[run,JSON.stringify([sig({content_hash:h('b2'),event_key:'k2'})])]),/Signal run not found/,'saving on a closed run');
  assert.equal((await service('select public.complete_signal_run($1,$2,$3::jsonb,null) ok',[run,'completed','{}'])).rows[0].ok,false,'closed once');
  await refused(()=>service('select public.complete_signal_run($1,$2,$3::jsonb,null)',[run,'done','{}']),/Invalid run result/,'an unknown status');
 });
 await check('MEMBER PATH unchanged: save_signals still requires membership and saves as the caller',async()=>{
  assert.deepEqual((await as(A,'select public.save_signals($1,null,$2::jsonb) r',[pr[3],JSON.stringify([sig({content_hash:h('m1'),event_key:'m1'})])])).rows[0].r,{inserted:1,duplicates:0});
  await refused(()=>as(B,'select public.save_signals($1,null,$2::jsonb)',[pr[3],JSON.stringify([sig({content_hash:h('m2'),event_key:'m2'})])]),/member/i,'another tenant');
 });
 await check('LEASE: an expired run is taken again (up to 3 attempts), then failed — never lost, never duplicated',async()=>{
  const run=(await sql(`select id from public.signal_runs where prospect_ids[1]=$1`,[pr[4]])).rows[0].id;
  await sql(`update public.signal_runs set lease_until=now()-interval '1 minute' where id=$1`,[run]);
  const again=await claim(50);assert.deepEqual(again.map(r=>r.run_id),[run]);
  assert.equal((await sql('select attempts from public.signal_runs where id=$1',[run])).rows[0].attempts,2);
  await sql(`update public.signal_runs set lease_until=now()-interval '1 minute',attempts=3 where id=$1`,[run]);
  assert.equal((await claim(50)).length,0);
  assert.deepEqual((await sql('select status,error_code from public.signal_runs where id=$1',[run])).rows[0],{status:'failed',error_code:'LEASE_EXPIRED'});
 });
 await check('PAUSE: no cost without a user — asker inactive 30 days or gone; back after a sign-in',async()=>{
  await sql(`update public.monitored_prospects set next_run_at=now()-interval '1 minute'`);
  await sql(`update public.signal_runs set idempotency_key=idempotency_key||':old'`);
  await sql(`update auth.users set last_sign_in_at=now()-interval '40 days' where id=$1`,[A]);
  assert.equal((await claim(50)).length,0,'the inactive asker’s monitors are paused, not run');
  assert.equal((await sql(`select count(*)::int n from public.monitored_prospects where paused_reason='inactive'`)).rows[0].n,11);
  await sql(`update auth.users set last_sign_in_at=now() where id=$1`,[A]);
  assert.equal((await claim(50)).length,11,'resumed on its own after a sign-in');
  // A member who asked, then left the organization.
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,[oa,C]);
  await plan(C,'PAID');
  await sql(`update public.monitored_prospects set created_by=$1,next_run_at=now()-interval '1 minute' where prospect_id=$2`,[C,pr[5]]);
  await sql(`update public.signal_runs set idempotency_key=idempotency_key||':x'`);
  await sql(`delete from public.memberships where user_id=$1`,[C]);
  const r=await claim(50);assert.equal(r.some(x=>x.prospect_id===pr[5]),false);
  assert.equal((await sql(`select paused_reason from public.monitored_prospects where prospect_id=$1`,[pr[5]])).rows[0].paused_reason,'member_left');
 });
 await check('NEVER EVIDENCE: monitoring writes no evidence row',async()=>{
  assert.equal((await sql('select count(*)::int n from public.evidence')).rows[0].n,0);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
