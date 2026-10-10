// Migration 028 — AI outreach units and cost on real PostgreSQL (PGlite) with the full migration chain. One AI attempt
// = one unit, reserved before the provider call by reserve_ai_outreach (member, active plan, plan limit configured by
// the operator, per-hour limit), closed once by finish_ai_outreach with its outcome (AI_VALID | FALLBACK) and the
// message it produced. No configured limit = no AI attempt (the rule-based message stays available). Cost ledger:
// operation outreach_generation, priced with the provider's existing per-token prices.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg}) — ${what}`)}
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 // Supabase provisions service_role with broad default privileges (see tests/discovery-cost-byok-db.mjs): recreated here.
 await db.exec(`grant select,insert,update,delete on all tables in schema public to service_role;grant usage on schema prospectos_private to service_role;
  grant select,insert,update,delete on all tables in schema prospectos_private to service_role;grant execute on all functions in schema public to service_role;`);
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2),C=U(3);
 for(const [u,e] of [[A,'a@t'],[B,'b@t'],[C,'c@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const oa=(await as(A,`select public.create_organization('Org A') id`)).rows[0].id,ob=(await as(B,`select public.create_organization('Org B') id`)).rows[0].id;
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 const prA=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'KERLAN','https://kerlan.example') returning id`,[oa,pa])).rows[0].id;
 // A is on a paid plan for the current period; C has no entitlement at all.
 await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'PAID','ACTIVE',now()-interval '1 day',now()+interval '29 days')`,[A]);
 await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'PAID','ACTIVE',now()-interval '1 day',now()+interval '29 days')`,[B]);
 const reserve=(u,p)=>as(u,'select public.reserve_ai_outreach($1) id',[p]).then(r=>r.rows[0].id);
 const finish=(u,id,outcome,reason=null,outreach=null)=>as(u,'select public.finish_ai_outreach($1,$2,$3,$4) r',[id,outcome,reason,outreach]).then(r=>r.rows[0].r);

 await check('MIGRATION 028 present and applied; idempotent',async()=>{
  const m=files.find(f=>f.startsWith('028_'));assert.ok(m,'a 028_* migration exists');
  await db.exec(await readFile(new URL(`../db/migrations/${m}`,import.meta.url),'utf8'));
 });
 // The mechanism without limits: the seeded rows are removed here, then one is set by hand.
 await sql('delete from prospectos_private.ai_outreach_limits');
 await check('NOT CONFIGURED: no plan limit for AI outreach → no unit, explicit refusal (the rule-based message stays available)',async()=>{
  await refused(()=>reserve(A,prA),/ai_outreach_not_configured/,'an AI attempt without a configured limit');
  assert.equal((await sql('select count(*)::int n from prospectos_private.ai_outreach_usage')).rows[0].n,0);
 });
 await sql(`insert into prospectos_private.ai_outreach_limits(plan,period_limit,per_hour) values('PAID',2,5)`);
 let u1;
 await check('RESERVE: one attempt = one unit for the caller, on the prospect’s organization; a non-member or anon is refused',async()=>{
  u1=await reserve(A,prA);
  const r=(await sql('select * from prospectos_private.ai_outreach_usage where id=$1',[u1])).rows[0];
  assert.equal(r.user_id,A);assert.equal(r.subject_id,A);assert.equal(r.organization_id,oa);assert.equal(r.prospect_id,prA);assert.equal(r.outcome,null);
  await refused(()=>reserve(B,prA),/member/i,'another tenant');
  await refused(()=>as(undefined,'select public.reserve_ai_outreach($1)',[prA]),/permission denied/i,'anon');
 });
 await check('FINISH: closed once by its own author with AI_VALID or FALLBACK (+reason) and the message it produced',async()=>{
  const o=(await as(A,`insert into public.outreach(organization_id,prospect_id,content,provider) values($1,$2,'Bonjour','ai_composer_v1') returning id`,[oa,prA])).rows[0].id;
  await refused(()=>finish(B,u1,'AI_VALID',null,o),/not found/i,'another user closing it');
  await refused(()=>finish(A,u1,'MAYBE'),/Invalid/i,'an unknown outcome');
  assert.equal((await finish(A,u1,'AI_VALID',null,o)).outcome,'AI_VALID');
  await refused(()=>finish(A,u1,'FALLBACK','AI_ERROR'),/already/i,'closing it twice');
  assert.equal((await sql('select outreach_id from prospectos_private.ai_outreach_usage where id=$1',[u1])).rows[0].outreach_id,o);
 });
 await check('PLAN LIMIT: units counted per plan subject over the period; a fallback still counts (it was an attempt); limit reached → refused',async()=>{
  const u2=await reserve(A,prA);await finish(A,u2,'FALLBACK','UNSUPPORTED_NUMBER');
  await refused(()=>reserve(A,prA),/ai_outreach_limit_reached/,'a third attempt over a limit of 2');
  assert.equal((await sql('select count(*)::int n from prospectos_private.ai_outreach_usage where subject_id=$1',[A])).rows[0].n,2);
 });
 await check('NO PLAN: a user without an active entitlement gets no AI unit',async()=>{
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,[oa,C]);
  await refused(()=>reserve(C,prA),/ai_outreach_not_available|plan/i,'no entitlement');
 });
 await check('HOURLY LIMIT: per user, independent of the plan period',async()=>{
  await sql(`update prospectos_private.ai_outreach_limits set period_limit=100,per_hour=3 where plan='PAID'`);
  await reserve(A,prA);
  await refused(()=>reserve(A,prA),/quota_exceeded/,'over the per-hour limit');
 });
 await check('PRIVATE: units and limits are never readable or writable by clients',async()=>{
  await refused(()=>as(A,'select * from prospectos_private.ai_outreach_usage'),/permission denied/i,'reading units');
  await refused(()=>as(A,`insert into prospectos_private.ai_outreach_limits(plan,period_limit,per_hour) values('PRO',999,999)`),/permission denied/i,'setting a limit');
 });
 await check('COST LEDGER: outreach_generation is a valid operation, priced with the provider’s existing per-token prices; offer_analysis unchanged',async()=>{
  const c=(await service(`select public.resolve_provider_cost('anthropic','outreach_generation','claude-sonnet-5','[{"unit_type":"input_tokens_1k","quantity":1},{"unit_type":"output_tokens_1k","quantity":1}]'::jsonb) r`)).rows[0].r;
  const o=(await service(`select public.resolve_provider_cost('anthropic','offer_analysis','claude-sonnet-5','[{"unit_type":"input_tokens_1k","quantity":1},{"unit_type":"output_tokens_1k","quantity":1}]'::jsonb) r`)).rows[0].r;
  assert.equal(c.estimated_cost_micros,o.estimated_cost_micros,'same model, same per-token price');assert.equal(c.estimated_cost_micros,12000);
  await service(`insert into public.api_usage_events(organization_id,project_id,user_id,provider,operation,model,input_tokens,output_tokens) values($1,$2,$3,'anthropic','outreach_generation','claude-sonnet-5',100,50)`,[oa,pa,A]);
  await refused(()=>service(`select public.resolve_provider_cost('anthropic','outreach_magic','claude-sonnet-5','[]'::jsonb)`),/Invalid provider\/operation/,'an unknown operation');
 });
}finally{
 for(const [n,s,m] of results)console.log(`${s.padEnd(4)}  ${n}${m?` — ${m}`:''}`);
 const failed=results.filter(r=>r[1]!=='PASS').length;
 console.log(`\nOUTREACH AI DB: ${results.length-failed}/${results.length} checks passed`);
 await db.close();if(failed)process.exitCode=1;
}
