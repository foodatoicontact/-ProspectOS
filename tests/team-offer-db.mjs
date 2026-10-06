// Migration 023 — ProspectOS Équipe: Pro is a single account, a team buys TEAM seats (2 to 5, one graduated Stripe
// price, quantity = seats). Checked on real PostgreSQL (PGlite) with the full migration chain, as PostgREST and the
// server-only webhook path would call it.
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
 assert.ok(files.includes('023_team_offer.sql'),'migration 023 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000, pro_discovery_limit=2');
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const T=U(1),M=[U(2),U(3),U(4)],PRO=U(7),PM=U(8),X=U(9);
 for(const [u,e] of [[T,'team@t'],[M[0],'m1@t'],[M[1],'m2@t'],[M[2],'m3@t'],[PRO,'pro@t'],[PM,'pm@t'],[X,'x@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1::uuid,$2,now())`,[u,e]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const project=async(u,o)=>(await as(u,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[o])).rows[0].id;
 const team=await org(T);const p1=await project(T,team);
 const proOrg=await org(PRO);const pp=await project(PRO,proOrg);
 for(const u of [...M,PM,X])await org(u);
 const invite=(u,email,token)=>as(u,'select public.create_team_invitation($1,$2) r',[email,hash(token)]).then(r=>r.rows[0].r);
 const accept=(u,token)=>as(u,'select public.accept_team_invitation($1) r',[hash(token)]).then(r=>r.rows[0].r);
 const start=(u,proj)=>as(u,`select public.start_discovery($1,'Industriel','Lyon','["industriel"]','registry',20,'{}'::jsonb) run`,[proj]).then(r=>r.rows[0].run);
 const ent=u=>sql('select plan,status,seats from public.account_entitlements where user_id=$1',[u]).then(r=>r.rows[0]);
 // The webhook path (service_role), exactly as src/server/billing/store.ts calls it.
 let seq=0;const P0="now()-interval '1 day'",P1="now()+interval '29 days'";
 const apply=(customer,plan,seats,{status='active',paid=true,start=P0,end=P1,sub='sub_t',price='price_team'}={})=>service(
  `select public.apply_stripe_subscription_state($1,'customer.subscription.updated',$2,$3,$4,$5,$6,${start},${end},false,$7,$8) r`,
  [`evt_${++seq}`,customer,sub,price,plan,status,paid,seats]).then(r=>r.rows[0].r);
 await service(`select public.link_stripe_customer($1,'cus_team')`,[T]);
 await service(`select public.link_stripe_customer($1,'cus_pro')`,[PRO]);

 await check('SCHEMA: a TEAM entitlement always carries its seats',async()=>{
  await refused(()=>sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'TEAM','ACTIVE',now(),now()+interval '1 day')`,[X]),/team_seats_check/,'a TEAM row without seats');
 });
 await check('STRIPE: a TEAM subscription of 3 seats grants TEAM with 3 seats; the member sees the seats, never a Stripe id',async()=>{
  assert.equal((await apply('cus_team','TEAM',3)).outcome,'granted');
  assert.deepEqual(await ent(T),{plan:'TEAM',status:'ACTIVE',seats:3});
  const b=(await as(T,'select public.get_billing_status() b')).rows[0].b;
  assert.equal(b.plan,'TEAM');assert.equal(b.seats,3);assert.equal(JSON.stringify(b).includes('cus_'),false);assert.equal(JSON.stringify(b).includes('price_'),false);
 });
 await check('STRIPE: a quantity outside 2–5 grants nothing (invalid_seats), whatever the price says',async()=>{
  await service(`select public.link_stripe_customer($1,'cus_x')`,[X]);
  assert.equal((await apply('cus_x','TEAM',6,{sub:'sub_x'})).outcome,'invalid_seats');
  assert.equal((await apply('cus_x','TEAM',1,{sub:'sub_x'})).outcome,'invalid_seats');
  assert.equal((await apply('cus_x','TEAM',null,{sub:'sub_x'})).outcome,'invalid_seats');
  assert.equal(await ent(X),undefined,'no entitlement created');
 });
 await check('STRIPE: an 11-argument call (deployed code before 023) still works',async()=>{
  const r=(await service(`select public.apply_stripe_subscription_state('evt_legacy','invoice.paid','cus_pro','sub_p','price_pro','PRO','active',now()-interval '1 day',now()+interval '29 days',false,true) r`)).rows[0].r;
  assert.equal(r.outcome,'granted');assert.deepEqual(await ent(PRO),{plan:'PRO',status:'ACTIVE',seats:null});
 });
 await check('PRO is one account now: a Pro owner cannot invite',async()=>{
  await refused(()=>invite(PRO,'pm@t','tok-pm'),/team_plan_required/,'a Pro owner inviting');
 });
 await check('SEATS = paid seats: owner + 2 invitations on 3 seats, the 4th account is refused',async()=>{
  await invite(T,'m1@t','tok-1');await invite(T,'m2@t','tok-2');
  await refused(()=>invite(T,'m3@t','tok-3'),/team_full/,'a 4th account on 3 paid seats');
  await accept(M[0],'tok-1');await accept(M[1],'tok-2');
  const t=(await as(T,'select public.list_team() t')).rows[0].t;assert.equal(t.max_seats,3);assert.equal(t.members.length,3);assert.equal(t.plan_active,true);
 });
 await check('POOL: the team gets the Pro volumes × paid seats, shared by every member',async()=>{
  const u=(await as(M[0],'select public.get_commercial_usage() u')).rows[0].u;
  assert.equal(u.plan,'TEAM');assert.equal(u.seats,3);assert.equal(u.team,true);assert.equal(u.discovery_limit,6);
  for(const who of [T,M[0],M[1],T,M[0],M[1]])await start(who,p1);
  await refused(()=>start(T,p1),/plan_limit_reached/,'a 7th search on 3 seats × 2');
 });
 await check('MORE SEATS mid-period: a quantity change is applied at once (not "unchanged") and frees an invitation',async()=>{
  assert.equal((await apply('cus_team','TEAM',4)).outcome,'granted');
  assert.equal((await ent(T)).seats,4);
  assert.equal((await as(M[0],'select public.get_commercial_usage() u')).rows[0].u.discovery_limit,8);
  await invite(T,'m3@t','tok-3');
 });
 await check('FEWER SEATS: nobody is removed, but no new invitation until the team is back under its seats',async()=>{
  await accept(M[2],'tok-3');
  assert.equal((await apply('cus_team','TEAM',2)).outcome,'granted');
  assert.equal((await sql('select count(*)::int n from public.memberships where organization_id=$1',[team])).rows[0].n,4,'all 4 accounts kept');
  await refused(()=>invite(T,'x@t','tok-x'),/team_full/,'inviting above the paid seats');
 });
 await check('REPLAY: the same Stripe event twice has one effect',async()=>{
  const args=['evt_replay','customer.subscription.updated','cus_team','sub_t','price_team','TEAM','active',true,5];
  const q=`select public.apply_stripe_subscription_state($1,$2,$3,$4,$5,$6,$7,now()-interval '1 day',now()+interval '29 days',false,$8,$9) r`;
  assert.equal((await service(q,args)).rows[0].r.outcome,'granted');assert.equal((await service(q,args)).rows[0].r.outcome,'duplicate');
 });
 await check('END: a cancelled TEAM subscription ends access; members are read-only, data still readable',async()=>{
  assert.equal((await apply('cus_team','TEAM',5,{status:'canceled'})).outcome,'access_ended');
  assert.equal((await ent(T)).status,'EXPIRED');
  await refused(()=>start(M[0],p1),/plan_limit_reached/,'a member searching after the end');
  assert.equal((await as(M[0],'select count(*)::int n from public.projects where id=$1',[p1])).rows[0].n,1);
  assert.equal((await as(T,'select public.list_team() t')).rows[0].t.plan_active,false);
 });
 await check('PRO single account keeps the Pro volumes',async()=>{
  await start(PRO,pp);await start(PRO,pp);
  await refused(()=>start(PRO,pp),/plan_limit_reached/,'a 3rd search on a Pro limit of 2');
  const u=(await as(PRO,'select public.get_commercial_usage() u')).rows[0].u;assert.equal(u.plan,'PRO');assert.equal(u.seats,undefined);assert.equal(u.team,undefined);
 });
 await check('PRIVATE: members cannot call the webhook function nor the seat helper',async()=>{
  await refused(()=>as(T,`select public.apply_stripe_subscription_state('evt_z','x','cus_team','sub_t','price_team','TEAM','active',now(),now()+interval '30 days',false,true,5)`),/permission denied/,'granting oneself TEAM');
  await refused(()=>as(T,'select prospectos_private.team_seat_cap($1)',[T]),/permission denied/,'the private seat helper');
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
