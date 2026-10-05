// Migration 022 — ProspectOS Pro team: up to 5 accounts on one shared workspace, one pooled quota, and a search a
// teammate already ran (same source and criteria, < 7 days) reused without any external call or quota.
// Checked on real PostgreSQL (PGlite) with the full migration chain, as PostgREST would call it.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg})`)}
const hash=t=>createHash('sha256').update(t).digest('hex');
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('022_team_pro.sql'));
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000, pro_discovery_limit=3');
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const O=U(1),M=[U(2),U(3),U(4),U(5),U(6)],X=U(9),P=U(10),UNCONF=U(11);
 const users=[[O,'owner@t'],...M.map((u,i)=>[u,`m${i+1}@t`]),[X,'x@t'],[P,'paid@t']];
 for(const [u,e] of users)await sql(`insert into auth.users(id,email,email_confirmed_at) values($1::uuid,$2,now())`,[u,e]);
 await sql(`insert into auth.users(id,email,email_confirmed_at) values($1::uuid,'unconfirmed@t',null)`,[UNCONF]);
 const ent=(u,plan,days=30)=>sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,$2,'ACTIVE',now()-interval '1 day',now()+($3||' days')::interval) on conflict(user_id) do update set plan=excluded.plan,status='ACTIVE',starts_at=excluded.starts_at,expires_at=excluded.expires_at`,[u,plan,String(days)]);
 await ent(O,'PRO');await ent(P,'PAID');
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const project=async(u,o)=>(await as(u,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[o])).rows[0].id;
 const team=await org(O);const p1=await project(O,team);
 for(const u of [...M,X,P,UNCONF])await org(u);
 const invite=(u,email,token)=>as(u,'select public.create_team_invitation($1,$2) r',[email,hash(token)]).then(r=>r.rows[0].r);
 const accept=(u,token)=>as(u,'select public.accept_team_invitation($1) r',[hash(token)]).then(r=>r.rows[0].r);
 const start=(u,proj,provider='registry',filters='{}')=>as(u,`select public.start_discovery($1,'Industriel','Auvergne-Rhône-Alpes','["industriel","agroalimentaire"]',$2,20,$3::jsonb) run`,[proj,provider,filters]).then(r=>r.rows[0].run);

 await check('PLAN: only an active Pro (or Entreprise/Internal) owner can invite',async()=>{
  const po=(await as(P,`select organization_id from public.memberships`)).rows[0].organization_id;
  await refused(()=>invite(P,'someone@t','tok-paid'),/team_plan_required/,'a Solo owner inviting');
 });
 await check('INVITE: the Pro owner invites by e-mail; only a token hash is stored, nobody can read it',async()=>{
  const r=await invite(O,'M1@T','tok-m1');assert.equal(r.email,'m1@t');assert.ok(r.expires_at);
  await refused(()=>as(O,'select token_hash from prospectos_private.team_invitations'),/permission|denied/i,'reading invitations directly');
 });
 await check('ACCEPT: the link alone is not enough — the confirmed e-mail must match',async()=>{
  await refused(()=>accept(X,'tok-m1'),/invitation_email_mismatch/,'another account using the link');
  await invite(O,'unconfirmed@t','tok-unconf');
  await refused(()=>accept(UNCONF,'tok-unconf'),/email_not_confirmed/,'an unconfirmed e-mail');
  await refused(()=>accept(M[0],'wrong-token'),/invitation_invalid/,'an unknown token');
 });
 await check('JOIN: the invited account becomes a member and sees the shared workspace',async()=>{
  const r=await accept(M[0],'tok-m1');assert.equal(r.organization_id,team);
  assert.equal((await as(M[0],'select count(*)::int n from public.projects where id=$1',[p1])).rows[0].n,1);
  assert.equal((await sql(`select role from public.memberships where organization_id=$1 and user_id=$2`,[team,M[0]])).rows[0].role,'member');
  assert.equal((await sql('select count(*)::int n from public.account_entitlements where user_id=$1',[M[0]])).rows[0].n,0,'joining a team never takes a free-trial seat');
 });
 await check('ONCE: an accepted link cannot be reused',async()=>{await refused(()=>accept(M[0],'tok-m1'),/invitation_invalid/,'accepting twice')});
 await check('SEATS: 5 accounts at most, pending invitations included',async()=>{
  await as(O,`select public.revoke_team_invitation((select id from public.list_team_invitations() where email='unconfirmed@t'))`);
  for(const [i,u] of M.slice(1,4).entries()){await invite(O,`m${i+2}@t`,`tok-m${i+2}`)}
  await refused(()=>invite(O,'m5@t','tok-m5'),/team_full/,'a 6th account');
  for(const [i,u] of M.slice(1,4).entries())await accept(u,`tok-m${i+2}`);
  assert.equal((await sql('select count(*)::int n from public.memberships where organization_id=$1',[team])).rows[0].n,5);
 });
 await check('NO ESCALATION: a member cannot invite, remove, revoke, nor insert a membership',async()=>{
  await refused(()=>invite(M[0],'m5@t','tok-x'),/team_owner_required/,'a member inviting');
  await refused(()=>as(M[0],'select public.remove_team_member($1)',[M[1]]),/team_owner_required/,'a member removing');
  await refused(()=>as(M[0],`insert into public.memberships(organization_id,user_id,role) values($1,$2,'owner')`,[team,X]),/permission|denied|policy/i,'a direct membership insert');
 });
 await check('POOL: one Pro quota for the whole team, under a lock (never above the limit)',async()=>{
  await start(O,p1);await start(M[0],p1);await start(M[1],p1);
  await refused(()=>start(M[2],p1),/plan_limit_reached/,'a 4th search on a pool of 3');
  await refused(()=>start(O,p1),/plan_limit_reached/,'the owner over the pool too');
  const usage=(await as(M[0],'select public.get_commercial_usage() u')).rows[0].u;
  assert.equal(usage.team,true);assert.equal(usage.plan,'PRO');assert.equal(usage.discovery_used,3);assert.equal(usage.discovery_limit,3);
 });
 await check('READ-ONLY when the owner’s Pro ends: no search counted on the team, data still readable',async()=>{
  await sql('update prospectos_private.discovery_quota_settings set pro_discovery_limit=300');
  await sql(`update public.account_entitlements set expires_at=now()-interval '1 minute' where user_id=$1`,[O]);
  await refused(()=>start(M[0],p1),/plan_limit_reached/,'a member searching after the Pro ended');
  assert.equal((await as(M[0],'select count(*)::int n from public.projects where id=$1',[p1])).rows[0].n,1);
  await ent(O,'PRO');
 });
 await check('TEAM VIEW: members listed for everyone in the team; invitations for the owner only',async()=>{
  const t=(await as(M[0],'select public.list_team() t')).rows[0].t;
  assert.equal(t.members.length,5);assert.equal(t.is_owner,false);assert.equal(t.max_seats,5);
  assert.ok(t.members.every(m=>m.email&&m.role));
  await refused(()=>as(M[0],'select * from public.list_team_invitations()'),/team_owner_required/,'a member reading invitations');
 });
 await check('REMOVE / LEAVE: a removed or leaving member no longer sees the workspace',async()=>{
  await as(O,'select public.remove_team_member($1)',[M[3]]);
  assert.equal((await as(M[3],'select count(*)::int n from public.projects where id=$1',[p1])).rows[0].n,0);
  await as(M[2],'select public.leave_team()');
  assert.equal((await as(M[2],'select count(*)::int n from public.projects where id=$1',[p1])).rows[0].n,0);
  await refused(()=>as(O,'select public.remove_team_member($1)',[O]),/team_member_required/,'the owner removing themself');
 });
 // ——— reuse within 7 days ———
 const p2=await project(M[0],team);
 const complete=(run,extra={})=>sql(`update public.discovery_runs set status='completed',result_count=5,completed_at=now(),metrics=$2::jsonb where id=$1`,[run,JSON.stringify({search_requests:3,search_requests_failed:0,...extra})]);
 const find=(u,proj,{query='industriel',categories='["agroalimentaire","Industriel"]',provider='registry',filters='{}'}={})=>as(u,`select public.find_reusable_discovery($1,$2,'auvergne-rhône-alpes ',$3::jsonb,$4,20,$5::jsonb) r`,[proj,query,categories,provider,filters]).then(r=>r.rows[0].r);
 let source;
 await check('REUSE: a teammate’s identical search (case, spaces, category order aside) is found, with who and when',async()=>{
  source=await start(O,p1);await complete(source.id);
  const r=await find(M[0],p2);assert.equal(r.run_id,source.id);assert.equal(r.by_email,'owner@t');assert.ok(r.started_at);
 });
 await check('REUSE: other criteria, source, headcount or a partial/old run are never reused',async()=>{
  assert.equal(await find(M[0],p2,{query:'agroalimentaire'}),null);
  assert.equal(await find(M[0],p2,{provider:'brave'}),null);
  assert.equal(await find(M[0],p2,{filters:'{"employee_range":{"min":200,"max":2000}}'}),null);
  assert.equal(await find(M[0],p2,{filters:'{"search_mode":"search_new"}'}),null,'“search new” always searches');
  const partial=await start(O,p1);await complete(partial.id,{search_requests_failed:1});
  await sql(`update public.discovery_runs set started_at=now()-interval '8 days' where id=$1`,[source.id]);
  assert.equal(await find(M[0],p2),null,'older than 7 days, or partial');
  await sql(`update public.discovery_runs set started_at=now()-interval '1 day' where id=$1`,[source.id]);
 });
 await check('REUSE: another organization’s identical search is invisible',async()=>{
  const xo=(await as(X,'select organization_id from public.memberships')).rows[0].organization_id;const xp=await project(X,xo);
  assert.equal(await find(X,xp),null);
 });
 await check('REUSE START: a run is created without any billable unit (hourly log only), tied to its source',async()=>{
  const before=Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and billable`,[team])).rows[0].n);
  const run=(await as(M[0],`select public.start_reused_discovery($1,$2,'industriel','auvergne-rhône-alpes ','["agroalimentaire","Industriel"]','registry',20,'{}'::jsonb) run`,[p2,source.id])).rows[0].run;
  assert.equal(run.provider,'registry');assert.equal(run.status,'running');assert.equal(run.filters_json.reused_from_run_id,source.id);
  const after=Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and billable`,[team])).rows[0].n);
  assert.equal(after,before,'no quota consumed');
  assert.equal((await sql(`select billable from prospectos_private.discovery_quota_usage where discovery_run_id=$1`,[run.id])).rows[0].billable,false);
 });
 await check('REUSE START is re-checked server-side: a non-matching or foreign source is refused',async()=>{
  await refused(()=>as(M[0],`select public.start_reused_discovery($1,$2,'agroalimentaire','auvergne-rhône-alpes','[]','registry',20,'{}'::jsonb)`,[p2,source.id]),/reuse_not_allowed/,'reusing for other criteria');
  await refused(()=>as(X,`select public.start_reused_discovery($1,$2,'industriel','auvergne-rhône-alpes','["agroalimentaire","Industriel"]','registry',20,'{}'::jsonb)`,[p2,source.id]),/member|permission|denied/i,'an outsider');
 });
 await check('LEGACY MEMBER: a member row without an accepted invitation keeps its own plan (previous behaviour)',async()=>{
  const xo=(await as(X,'select organization_id from public.memberships')).rows[0].organization_id;
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,[xo,P]);
  const xp=(await as(X,`select id from public.projects where organization_id=$1 limit 1`,[xo])).rows[0].id;
  const run=await start(P,xp);assert.equal(run.status,'running','billed on its own Solo plan, not read-only');
  assert.equal((await as(P,'select public.get_commercial_usage() u')).rows[0].u.team,undefined,'not a team');
  await refused(()=>as(P,'select public.leave_team()'),/team_member_required/,'leaving a team it never joined');
 });
 await check('IDEMPOTENT: re-applying 022 keeps the team and its behaviour',async()=>{
  await db.exec(await readFile(new URL('../db/migrations/022_team_pro.sql',import.meta.url),'utf8'));
  assert.equal((await as(M[0],'select public.list_team() t')).rows[0].t.members.length,3);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}finally{await db.close()}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
