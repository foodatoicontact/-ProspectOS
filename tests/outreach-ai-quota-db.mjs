// AI outreach quotas (migration 028): the validated limits for every real plan id, the per-user hourly limit, the
// counter in get_commercial_usage (separate from Discovery / site analysis / AI offer analysis, on the plan subject so
// a team member sees the team pool), an exhausted quota adding no unit, and the existing counters unchanged.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg}) — ${what}`)}
const hash=t=>createHash('sha256').update(t).digest('hex');
const EXPECTED={BETA:[25,10],PAID:[150,20],PRO:[500,30],TEAM:[1000,30],ENTERPRISE:[3000,60],INTERNAL:[10000,120]};
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const users={BETA:U(1),PAID:U(2),PRO:U(3),TEAM:U(4),ENTERPRISE:U(5),INTERNAL:U(6)};const M=U(7);
 for(const [k,u] of [...Object.entries(users),['m',M]])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,`${k}@t`]);
 const ctx={};
 for(const [plan,u] of Object.entries(users)){
  const org=(await as(u,`select public.create_organization('Org') id`)).rows[0].id;const proj=(await as(u,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[org])).rows[0].id;
  const prospect=(await as(u,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'KERLAN','https://kerlan.example') returning id`,[org,proj])).rows[0].id;
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,seats) values($1,$2,'ACTIVE',now()-interval '1 day',now()+interval '29 days',$3)`,[u,plan,plan==='TEAM'?3:null]);
  ctx[plan]={u,org,proj,prospect};
 }
 const reserve=(u,p)=>as(u,'select public.reserve_ai_outreach($1) id',[p]).then(r=>r.rows[0].id);
 const usage=u=>as(u,'select public.get_commercial_usage() u').then(r=>r.rows[0].u);
 const units=subject=>sql('select count(*)::int n from prospectos_private.ai_outreach_usage where subject_id=$1',[subject]).then(r=>r.rows[0].n);
 // Units older than one hour inside the period (they count for the period, not for the hourly limit).
 const backfill=(c,n)=>sql(`insert into prospectos_private.ai_outreach_usage(organization_id,prospect_id,user_id,subject_id,outcome,finished_at,created_at)
  select $1,$2,$3,$3,'FALLBACK',now()-interval '2 hours',now()-interval '2 hours' from generate_series(1,$4)`,[c.org,c.prospect,c.u,n]);

 await check('REAL PLAN IDS: the limits cover exactly the plans account_entitlements accepts, with the validated values',async()=>{
  const def=(await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conname='account_entitlements_plan_check'`)).rows[0].d;
  const plans=[...def.matchAll(/'([A-Z]+)'/g)].map(m=>m[1]).sort();
  assert.deepEqual(plans,Object.keys(EXPECTED).sort());
  const rows=(await sql('select plan,period_limit,per_hour from prospectos_private.ai_outreach_limits order by plan')).rows;
  assert.deepEqual(Object.fromEntries(rows.map(r=>[r.plan,[r.period_limit,r.per_hour]])),EXPECTED);
 });
 await check('HOURLY: BETA reserves 10 attempts in an hour, the 11th is refused (and adds no unit)',async()=>{
  for(let i=0;i<10;i++)await reserve(users.BETA,ctx.BETA.prospect);
  await refused(()=>reserve(users.BETA,ctx.BETA.prospect),/quota_exceeded/,'an 11th attempt within the hour');
  assert.equal(await units(users.BETA),10);
 });
 await check('PERIOD: BETA at 25 units in the period → refused, no new unit; the counter reads 25 / 25',async()=>{
  await backfill(ctx.BETA,15);
  await refused(()=>reserve(users.BETA,ctx.BETA.prospect),/ai_outreach_limit_reached/,'a 26th attempt');
  assert.equal(await units(users.BETA),25);
  const u=await usage(users.BETA);assert.equal(u.ai_outreach_used,25);assert.equal(u.ai_outreach_limit,25);
 });
 for(const plan of ['PAID','PRO','ENTERPRISE'])await check(`PERIOD: ${plan} limit ${EXPECTED[plan][0]} and hourly ${EXPECTED[plan][1]}`,async()=>{
  const c=ctx[plan];await backfill(c,EXPECTED[plan][0]-1);
  await reserve(c.u,c.prospect);
  await refused(()=>reserve(c.u,c.prospect),/ai_outreach_limit_reached/,`over ${EXPECTED[plan][0]}`);
  const u=await usage(c.u);assert.equal(u.ai_outreach_used,EXPECTED[plan][0]);assert.equal(u.ai_outreach_limit,EXPECTED[plan][0]);
 });
 await check('INTERNAL: 10000 per period, 120 per hour (no counter shown, as for the other INTERNAL quotas)',async()=>{
  const c=ctx.INTERNAL;await backfill(c,9999);await reserve(c.u,c.prospect);
  await refused(()=>reserve(c.u,c.prospect),/ai_outreach_limit_reached/,'over 10000');
  assert.deepEqual(await usage(c.u),{plan:'INTERNAL',status:'ACTIVE'});
 });
 await check('TEAM: a member draws on the team pool (1000, hourly 30 per user) and sees the same AI outreach counter as the owner',async()=>{
  const c=ctx.TEAM;
  await as(c.u,'select public.create_team_invitation($1,$2)',['m@t',hash('tok')]);await as(M,'select public.accept_team_invitation($1)',[hash('tok')]);
  await reserve(M,c.prospect);await reserve(c.u,c.prospect);
  const owner=await usage(c.u),member=await usage(M);
  assert.equal(member.ai_outreach_used,2);assert.equal(member.ai_outreach_limit,1000);assert.equal(owner.ai_outreach_used,2);assert.equal(owner.ai_outreach_limit,1000);
  assert.equal((await sql('select subject_id from prospectos_private.ai_outreach_usage where user_id=$1',[M])).rows[0].subject_id,c.u,'billed on the owner’s plan');
 });
 await check('NO REGRESSION: the existing counters keep their values and limits; AI outreach is a separate pair of fields',async()=>{
  const u=await usage(users.PAID);
  for(const k of ['discovery_used','discovery_limit','analysis_used','analysis_limit','ai_offer_used','ai_offer_limit'])assert.equal(typeof u[k],'number',k);
  assert.equal(u.discovery_used,0);assert.equal(u.analysis_used,0);assert.equal(u.ai_offer_used,0,'AI outreach units never count as AI offer analyses');
  assert.deepEqual(Object.keys(u).filter(k=>k.startsWith('ai_outreach')).sort(),['ai_outreach_limit','ai_outreach_used']);
 });
}finally{
 for(const [n,s,m] of results)console.log(`${s.padEnd(4)}  ${n}${m?` — ${m}`:''}`);
 const failed=results.filter(r=>r[1]!=='PASS').length;
 console.log(`\nOUTREACH AI QUOTA DB: ${results.length-failed}/${results.length} checks passed`);
 await db.close();if(failed)process.exitCode=1;
}
