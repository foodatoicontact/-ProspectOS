// Migration 033 — USER_DECLARED evidence on real PostgreSQL (PGlite) with the full migration chain. Existing rows are
// written BEFORE 033 and compared after it (unchanged); then the declaration shape, the author stamped from the session
// (never the client), the unchanged VERIFIED rules, RLS / tenant isolation and the re-created guard (outreach part kept).
// Fictitious companies, .example domains. Run: node tests/user-declared-evidence-db.mjs
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function owner(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user]);return sql(text,params)}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg})`)}

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 // Migrations after 033, each reviewed: none changes how evidence is written (034 one-off legacy TEST billing release;
 // 035 Self-Outreach, its own tables only; 036 only re-checks cited evidence when a message is approved or copied;
 // 037 Self-Outreach booking link and meetings, its own tables and functions only, no evidence write).
 const i033=files.indexOf('033_user_declared_evidence.sql');
 assert.deepEqual(files.slice(i033+1),['034_release_legacy_test_billing.sql','035_self_outreach.sql','036_outreach_evidence_revalidation.sql','037_outreach_booking_meetings.sql','038_registry_signals.sql'],'033 precedes only reviewed migrations');
 assert.doesNotMatch((await readFile(new URL('../db/migrations/038_registry_signals.sql',import.meta.url),'utf8')).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n'),/(insert into|update|delete from) public\.(evidence|prospect_observations|signals)|on public\.(evidence|prospect_observations)/i,'038 (Signaux SIRENE) never writes evidence, observations or signals');
 assert.doesNotMatch((await readFile(new URL('../db/migrations/037_outreach_booking_meetings.sql',import.meta.url),'utf8')).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n'),/(insert into|update|delete from) public\.(evidence|prospect_observations)|on public\.(evidence|prospect_observations)/i,'037 never writes evidence');
 for(const f of files.slice(0,i033+1))await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));

 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const prospect=async(u,o,p,name)=>(await as(u,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,$3,$4) returning id`,[o,p,name,`https://${name.toLowerCase()}.example`])).rows[0].id;
 const pr=await prospect(A,oa,pa,'Kantina'),prB=await prospect(B,ob,pb,'Other');

 // Existing evidence of every pre-033 status, written before 033.
 await as(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt) values
  ($1,$2,'target_fit',true,'VERIFIED','https://presse.example/a','Restaurant ouvert à Toulouse.'),
  ($1,$2,'need_fit',false,'CONTRADICTED','https://presse.example/b','Aucune commande directe.'),
  ($1,$2,'local_decision',true,'NOT_VERIFIED','https://presse.example/c','Indépendant.'),
  ($1,$2,'contactability',true,'INFERRED_UNCONFIRMED',null,null)`,[oa,pr]);
 const snapshot=async()=>(await sql(`select to_jsonb(e)-'declared_by'-'note' j from public.evidence e order by id`)).rows.map(r=>JSON.stringify(r.j));
 const before=await snapshot();

 await db.exec(await readFile(new URL('../db/migrations/033_user_declared_evidence.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/migrations/checks/033_user_declared_evidence.sql',import.meta.url),'utf8'));
 const ins=(u,o={})=>as(u,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,note,declared_by,verified_by)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[o.org??oa,o.prospect??pr,o.criterion??'local_decision',o.value===undefined?true:o.value,o.status??'USER_DECLARED',
  o.source_url??null,o.excerpt??null,o.note??null,o.declared_by??null,o.verified_by??null]).then(r=>r.rows[0]);

 await check('MIGRATION: applies on the full chain, its check passes, existing evidence rows are unchanged (new columns null)',async()=>{
  assert.deepEqual(await snapshot(),before);
  const r=(await sql(`select count(*)::int n from public.evidence where declared_by is not null or note is not null`)).rows[0];assert.equal(r.n,0);
  const cols=(await sql(`select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='evidence' and column_name in ('declared_by','note') order by 1`)).rows;
  assert.deepEqual(cols,[{column_name:'declared_by',is_nullable:'YES'},{column_name:'note',is_nullable:'YES'}]);
 });
 await check('MIGRATION: exactly one status check remains, and it is the named one with USER_DECLARED',async()=>{
  const named=(await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.evidence'::regclass and conname='evidence_status_check'`)).rows[0].d;
  assert.match(named,/USER_DECLARED/);
  const n=(await sql(`select count(*)::int n from pg_constraint where conrelid='public.evidence'::regclass and contype='c' and pg_get_constraintdef(oid) like '%INFERRED_UNCONFIRMED%' and pg_get_constraintdef(oid) not like '%verified_by%'`)).rows[0].n;
  assert.equal(n,1);
 });
 await check('MIGRATION: re-applicable — running 033 and its check again changes no row and keeps one status check',async()=>{
  const before2=await snapshot();
  for(let i=0;i<2;i++){await db.exec(await readFile(new URL('../db/migrations/033_user_declared_evidence.sql',import.meta.url),'utf8'));
   await db.exec(await readFile(new URL('../db/migrations/checks/033_user_declared_evidence.sql',import.meta.url),'utf8'))}
  assert.deepEqual(await snapshot(),before2);
 });
 await check('USER_DECLARED true and false without any URL are accepted; the author is the session, never the client',async()=>{
  const t=await ins(A,{value:true,note:'Le gérant me l’a dit au salon.',declared_by:B,verified_by:B});
  assert.deepEqual([t.status,t.value,t.source_url,t.excerpt,t.declared_by,t.verified_by,t.note],['USER_DECLARED',true,null,null,A,null,'Le gérant me l’a dit au salon.']);
  const f=await ins(A,{criterion:'need_fit',value:false});assert.deepEqual([f.value,f.declared_by],[false,A]);
  // Changing the value later re-stamps the person who changed it.
  const u=(await as(A,`update public.evidence set value=false,declared_by=$2 where id=$1 returning declared_by`,[t.id,B])).rows[0];assert.equal(u.declared_by,A);
 });
 await check('USER_DECLARED shape: a value is required; no source, no excerpt, never a borrowed or internal URL',async()=>{
  await refused(()=>ins(A,{value:null}),/evidence_user_declared_shape/,'declaration without a value');
  for(const url of ['https://kantina.example','https://prospectos.example/declared'])await refused(()=>ins(A,{source_url:url}),/evidence_user_declared_shape/,`declaration with ${url}`);
  await refused(()=>ins(A,{source_url:'prospectos://declared'}),/check constraint/,'internal scheme');
  await refused(()=>ins(A,{excerpt:'Le gérant le dit.'}),/evidence_user_declared_shape/,'declaration with an excerpt');
  await refused(()=>ins(A,{note:'x'.repeat(281)}),/evidence_note_only_declared/,'note over 280');
  await refused(()=>ins(A,{note:'   '}),/evidence_note_only_declared/,'blank note');
 });
 await check('USER_DECLARED needs an authenticated person; anonymous callers cannot write evidence at all',async()=>{
  await refused(()=>owner('',`insert into public.evidence(organization_id,prospect_id,criterion,value,status) values($1,$2,'need_fit',true,'USER_DECLARED')`,[oa,pr]),/Human authentication required/,'no session');
  await refused(()=>ins(undefined),/permission denied/i,'anon');
 });
 await check('VERIFIED without a real source is still refused; note / declared_by never ride on another status',async()=>{
  await refused(()=>ins(A,{status:'VERIFIED',value:true}),/check constraint/,'VERIFIED without source');
  await refused(()=>ins(A,{status:'VERIFIED',source_url:'https://presse.example/x'}),/check constraint/,'VERIFIED without excerpt');
  await refused(()=>ins(A,{status:'NOT_VERIFIED',source_url:'https://presse.example/x',excerpt:'x',note:'n'}),/evidence_note_only_declared/,'note on NOT_VERIFIED');
  const nv=await ins(A,{status:'NOT_VERIFIED',source_url:'https://presse.example/x',excerpt:'x',declared_by:A});assert.equal(nv.declared_by,null,'declared_by is cleared off a declaration');
  const v=await ins(A,{status:'VERIFIED',source_url:'https://presse.example/y',excerpt:'Indépendant, une seule adresse.'});assert.deepEqual([v.verified_by,v.declared_by],[A,null]);
 });
 await check('a declaration becomes VERIFIED only with a real source; then it carries the verifier, not the declarer',async()=>{
  const d=await ins(A,{criterion:'contactability'});
  await refused(()=>as(A,`update public.evidence set status='VERIFIED' where id=$1`,[d.id]),/check constraint/,'verify a declaration without a source');
  const v=(await as(A,`update public.evidence set status='VERIFIED',source_url='https://kantina.example/contact',excerpt='Contact : bonjour@kantina.example' where id=$1 returning *`,[d.id])).rows[0];
  assert.deepEqual([v.status,v.verified_by,v.declared_by],['VERIFIED',A,null]);
 });
 await check('RLS: another organization can neither declare on nor read these declarations; tenant stays immutable',async()=>{
  await refused(()=>ins(B,{org:oa,prospect:pr}),/row-level security|violates/i,'B declares on A');
  assert.equal((await as(B,`select count(*)::int n from public.evidence where status='USER_DECLARED'`)).rows[0].n,0);
  assert.ok((await as(A,`select count(*)::int n from public.evidence where status='USER_DECLARED'`)).rows[0].n>=1);
  const mine=await ins(B,{org:ob,prospect:prB,criterion:'need_fit'});assert.equal(mine.declared_by,B);
  await refused(()=>as(B,`update public.evidence set organization_id=$2 where id=$1`,[mine.id,oa]),/immutable|row-level security|violates/i,'tenant change');
  const pol=(await sql(`select count(*)::int n from pg_policies where tablename='evidence'`)).rows[0].n;assert.ok(pol>=1,'evidence policies still present');
 });
 await check('GUARD: one function for evidence and outreach; the outreach immutability rule is still in it',async()=>{
  const src=(await sql(`select prosrc from pg_proc where oid='prospectos_private.guard_record()'::regprocedure`)).rows[0].prosrc;
  assert.match(src,/old\.status in \('USED','DISCARDED'\)/);assert.match(src,/new\.declared_by := auth\.uid\(\)/);
  const trg=(await sql(`select tgrelid::regclass::text t from pg_trigger where tgfoid='prospectos_private.guard_record()'::regprocedure order by 1`)).rows.map(r=>r.t);
  for(const t of ['evidence','outreach','prospects'])assert.ok(trg.includes(t),t);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,m] of results)console.log(`${s.padEnd(4)}  ${n}${m?`  — ${m}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;
console.log(`\nUSER_DECLARED DB (033): ${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
