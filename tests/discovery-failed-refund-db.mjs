// Migration 021 — a Discovery run that got NO answer from its source is not billed (decision 2026-10-05).
// Each discovery quota unit is now tied to its run (discovery_run_id, set by start_discovery in the same
// transaction), and release_failed_discovery(run) — server only — gives back THAT run's unit, and only if the run
// is failed. The row stays in the usage log (hourly anti-abuse limits unchanged); only billable becomes false.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(role,user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${role}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('021_discovery_failed_run_not_billed.sql'));
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b1';
 await sql(`insert into auth.users(id,email) values($1,'a@t'),($2,'b@t')`,[A,B]);
 await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000');
 for(const u of [A,B])await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days')`,[u]);
 const ctx={};
 for(const [k,u] of Object.entries({A,B})){const o=(await as('authenticated',u,`select public.create_organization('Org') id`)).rows[0].id;const p=(await as('authenticated',u,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[o])).rows[0].id;ctx[k]={u,o,p}}
 const start=async(c,provider='registry')=>(await as('authenticated',c.u,`select public.start_discovery($1,'industriel','Auvergne-Rhône-Alpes','["industriel"]',$2,20,'{}'::jsonb) run`,[c.p,provider])).rows[0].run;
 const unit=async run=>(await sql('select billable from prospectos_private.discovery_quota_usage where discovery_run_id=$1',[run])).rows;
 const billed=async u=>Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery' and billable`,[u])).rows[0].n);
 const fail=run=>sql(`update public.discovery_runs set status='failed',error_message='DISCOVERY_FAILED' where id=$1`,[run]);
 const release=async run=>(await as('service_role',null,'select public.release_failed_discovery($1) ok',[run])).rows[0].ok;

 let r1,r2;
 await check('LINKED: each launch’s quota unit carries its run id',async()=>{
  r1=await start(ctx.A);r2=await start(ctx.A);
  assert.deepEqual(await unit(r1.id),[{billable:true}]);assert.deepEqual(await unit(r2.id),[{billable:true}]);
 });
 await check('FAILED → RELEASED: that run’s unit only, the other launch stays billed; the usage row is kept',async()=>{
  await fail(r1.id);assert.equal(await release(r1.id),true);
  assert.deepEqual(await unit(r1.id),[{billable:false}]);assert.deepEqual(await unit(r2.id),[{billable:true}]);
  assert.equal(await billed(A),1);
 });
 await check('ONCE: releasing the same run again changes nothing',async()=>{assert.equal(await release(r1.id),false);assert.equal(await billed(A),1)});
 await check('A COMPLETED (even partial) RUN IS NEVER RELEASED',async()=>{
  await sql(`update public.discovery_runs set status='completed' where id=$1`,[r2.id]);assert.equal(await release(r2.id),false);assert.deepEqual(await unit(r2.id),[{billable:true}]);
 });
 await check('A RUNNING RUN IS NEVER RELEASED',async()=>{const r=await start(ctx.A);assert.equal(await release(r.id),false);assert.deepEqual(await unit(r.id),[{billable:true}])});
 await check('SERVER ONLY: a member (or anon) cannot release, even their own failed run',async()=>{
  const r=await start(ctx.A);await fail(r.id);
  for(const role of ['authenticated','anon']){let denied=false;try{await as(role,A,'select public.release_failed_discovery($1)',[r.id])}catch{denied=true}assert.ok(denied,role)}
  assert.deepEqual(await unit(r.id),[{billable:true}]);
 });
 await check('TENANTS: B’s failed run releases B’s unit, never A’s',async()=>{
  const before=await billed(A);const rb=await start(ctx.B);await fail(rb.id);assert.equal(await release(rb.id),true);
  assert.equal(await billed(A),before);assert.deepEqual(await unit(rb.id),[{billable:false}]);
 });
 await check('FIXTURE: free launches stay free and are still linked',async()=>{const r=await start(ctx.A,'fixture');assert.deepEqual(await unit(r.id),[{billable:false}])});
 await check('UNKNOWN RUN: false, nothing touched',async()=>{assert.equal(await release('00000000-0000-4000-8000-00000000dead'),false)});
 await check('IDEMPOTENT: re-applying 021 keeps links and behaviour',async()=>{
  await db.exec(await readFile(new URL('../db/migrations/021_discovery_failed_run_not_billed.sql',import.meta.url),'utf8'));
  const r=await start(ctx.A);assert.deepEqual(await unit(r.id),[{billable:true}]);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}finally{await db.close()}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
