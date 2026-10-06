// Migration 020 — public.trial_available(): on real PostgreSQL (PGlite) with the full migration chain.
// Anyone (anon) gets ONE boolean: is a free-trial seat still open. Never a count, never a row; same seat rule as
// activate_trial (beta_seats_used, REVOKED rows give their seat back), so it flips exactly when the trial closes.
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
 assert.ok(files.includes('020_public_trial_availability.sql'));
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const available=async role=>(await as(role,null,'select public.trial_available() v')).rows[0].v;
 await sql('update prospectos_private.beta_program set capacity=2');
 const users=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
 for(const u of users)await sql(`insert into auth.users(id,email) values($1::uuid,$2)`,[u,u+'@t']);
 await check('OPEN: seats left → true, for anon and authenticated',async()=>{assert.equal(await available('anon'),true);assert.equal(await available('authenticated'),true)});
 await check('FULL: as many BETA seats as the capacity → false',async()=>{
  for(const u of users.slice(0,2))await as('authenticated',u,'select public.activate_trial()');
  assert.equal(await available('anon'),false);
 });
 await check('SAME RULE AS activate_trial: when false, a new account is refused the trial',async()=>{
  let err='';try{await as('authenticated',users[2],'select public.activate_trial()')}catch(e){err=String(e.message)}
  assert.match(err,/BETA_CAPACITY_REACHED/);
 });
 await check('REVOKED gives the seat back → true again',async()=>{
  await sql(`update public.account_entitlements set status='REVOKED' where user_id=$1`,[users[0]]);
  assert.equal(await available('anon'),true);
 });
 await check('NO LEAK: a boolean only, and anon still cannot read seats or capacity',async()=>{
  const r=await as('anon',null,'select public.trial_available() v');assert.equal(typeof r.rows[0].v,'boolean');assert.equal(r.fields.length,1);
  let denied=false;try{await as('anon',null,'select prospectos_private.beta_seats_used()')}catch{denied=true}assert.ok(denied,'beta_seats_used stays private');
  denied=false;try{await as('anon',null,'select capacity from prospectos_private.beta_program')}catch{denied=true}assert.ok(denied,'capacity stays private');
 });
 await check('IDEMPOTENT: re-applying 020 changes nothing',async()=>{
  await db.exec(await readFile(new URL('../db/migrations/020_public_trial_availability.sql',import.meta.url),'utf8'));assert.equal(await available('anon'),true);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}finally{await db.close()}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
