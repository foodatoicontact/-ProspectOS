// Migration 029 — O1/O2 provenance at the moment of use, on real PostgreSQL (PGlite) with the full migration chain.
// A message may cite only public content and signals that are VERIFIED when it is generated (027, at insert). If a
// person later rejects, resets or deletes such a source — or a signal stops being VERIFIED or is purged — the message
// may still be edited, discarded or regenerated, but never approved (DRAFT → APPROVED) nor copied (APPROVED → USED):
// every transition into APPROVED or USED re-checks each cited source (still there, same prospect and tenant, VERIFIED).
// A refusal leaves the row exactly as it was; nothing is re-verified, regenerated or rewritten automatically.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let err=null;try{await op()}catch(e){err=e}if(err===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(String(err.message)))throw Error(`refused for the wrong reason (${err.message}) — ${what}`);return err}
const h=t=>createHash('sha256').update(t).digest('hex');
const NOT_VERIFIED=/outreach_source_not_verified/;
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 const target=files.find(f=>f.startsWith('029_'));
 const before=files.filter(f=>!target||f<target),after=target?files.filter(f=>f>=target):[];
 for(const f of before)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2),A2=U(3);
 for(const [u,e] of [[A,'a@t'],[B,'b@t'],[A2,'a2@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const oa=(await as(A,`select public.create_organization('Org A') id`)).rows[0].id,ob=(await as(B,`select public.create_organization('Org B') id`)).rows[0].id;
 await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,[oa,A2]);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 // One prospect per scenario: a prospect has at most one live DRAFT (migration 007).
 let k=0;const fresh=async()=>(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,$3,'https://x.example') returning id`,[oa,pa,`Prospect ${++k}`])).rows[0].id;

 // Sources, all VERIFIED by a person before any message cites them.
 const reviewPc=(id,d)=>as(A,'select public.review_public_content($1,$2)',[id,d]);
 const verifiedPc=async(p,content)=>{const id=(await as(A,'select public.save_public_content($1,$2::jsonb) r',[p,JSON.stringify({source_url:'https://www.example.com/post',content})])).rows[0].r.id;await reviewPc(id,'verify');return id};
 let n=0;
 const verifiedSignal=async p=>{n++;await as(A,'select public.save_signals($1,null,$2::jsonb)',[p,JSON.stringify([{provider:'user_provided',signal_type:'hiring_role',title:`Recrutement ${n}`,excerpt:`L’entreprise recrute un profil ${n}.`,source_url:`https://jobs.example/${n}`,source_type:'user_provided',observed_at:'2026-10-05T09:00:00Z',content_hash:h(`signal-${n}`),event_key:`hiring_role:${n}`}])]);
  const id=(await sql('select id from public.signals where content_hash=$1',[h(`signal-${n}`)])).rows[0].id;await as(A,'select public.review_signal($1,$2)',[id,'verify']);return id};
 const reviewSignal=(id,d)=>as(A,'select public.review_signal($1,$2)',[id,d]);
 const message=async(p,o={})=>(await as(A,`insert into public.outreach(organization_id,prospect_id,content,public_content_ids,signal_ids,provider)
  values($1,$2,'Bonjour, message généré.',$3::jsonb,$4::jsonb,'rule_based_v1') returning *`,[oa,p,JSON.stringify(o.pcs??[]),JSON.stringify(o.sigs??[])])).rows[0];
 const row=async id=>(await sql('select * from public.outreach where id=$1',[id])).rows[0];
 const setStatus=(id,status,u=A)=>as(u,'update public.outreach set status=$2 where id=$1',[id,status]);
 const events=async id=>(await sql(`select count(*)::int n from public.events where payload->>'record_id'=$1`,[id])).rows[0].n;
 // A refused transition must leave every column of the message, and its audit trail, exactly as they were.
 const refusedUnchanged=async(id,op,what)=>{const r0=await row(id),e0=await events(id);await refused(op,NOT_VERIFIED,what);assert.deepEqual(await row(id),r0,`${what}: the message is unchanged`);assert.equal(await events(id),e0,`${what}: no event recorded`)};

 await check('MIGRATION 029 present and applied on top of 001–028',async()=>{assert.ok(target,'a 029_* migration exists');for(const f of after)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'))});
 await check('IDEMPOTENT: re-applying 029 changes nothing (one trigger, one function)',async()=>{
  for(const f of after)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
  assert.equal((await sql(`select count(*)::int n from pg_trigger where tgname='outreach_provenance_guard' and not tgisinternal`)).rows[0].n,1);
  assert.equal((await sql(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='prospectos_private' and p.proname='guard_outreach_provenance'`)).rows[0].n,1);
 });

 // ——— public content ———
 await check('PUBLIC CONTENT REJECTED after generation: DRAFT → APPROVED refused, message unchanged',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Nous ouvrons un atelier à Vannes.');const m=await message(p,{pcs:[pc]});
  await reviewPc(pc,'reject');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose public content was rejected');
 });
 await check('PUBLIC CONTENT REJECTED: approving with a new text in the same statement is refused atomically (text kept)',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Notre usine de Lorient passe en 3x8.');const m=await message(p,{pcs:[pc]});
  await reviewPc(pc,'reject');
  await refusedUnchanged(m.id,()=>as(A,`update public.outreach set status='APPROVED',content='Texte retouché puis approuvé.' where id=$1`,[m.id]),'approve + edit in one update');
 });
 await check('PUBLIC CONTENT RESET to review (no longer VERIFIED): DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Nouveau site à Quimper.');const m=await message(p,{pcs:[pc]});
  await reviewPc(pc,'reset');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving after the content went back to review');
 });
 await check('PUBLIC CONTENT DELETED after generation: DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Publication supprimée ensuite.');const m=await message(p,{pcs:[pc]});
  await as(A,'select public.delete_public_content($1)',[pc]);
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose public content was deleted');
 });
 await check('PUBLIC CONTENT no longer on this prospect (data drift, simulated): DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),other=await fresh(),pc=await verifiedPc(p,'Contenu rattaché ensuite à un autre prospect.');const m=await message(p,{pcs:[pc]});
  // Public content is immutable through every supported path (027); only a raw maintenance write could move it.
  await sql(`set session_replication_role=replica`);try{await sql('update public.prospect_public_content set prospect_id=$2 where id=$1',[pc,other])}finally{await sql(`set session_replication_role=origin`)}
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose public content now belongs to another prospect');
 });
 await check('APPROVED message, PUBLIC CONTENT REJECTED afterwards: APPROVED → USED (Copy) refused, still APPROVED',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Inauguration prévue en mai.');const m=await message(p,{pcs:[pc]});
  await setStatus(m.id,'APPROVED');assert.equal((await row(m.id)).status,'APPROVED');
  await reviewPc(pc,'reject');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'USED'),'copying an approved message whose public content was rejected');
  assert.equal((await row(m.id)).status,'APPROVED');
 });
 await check('APPROVED message, PUBLIC CONTENT DELETED afterwards: APPROVED → USED refused',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Annonce retirée.');const m=await message(p,{pcs:[pc]});
  await setStatus(m.id,'APPROVED');await as(A,'select public.delete_public_content($1)',[pc]);
  await refusedUnchanged(m.id,()=>setStatus(m.id,'USED'),'copying an approved message whose public content was deleted');
 });

 // ——— signals ———
 await check('SIGNAL REJECTED after generation: DRAFT → APPROVED refused, message unchanged',async()=>{
  const p=await fresh(),s=await verifiedSignal(p);const m=await message(p,{sigs:[s]});
  await reviewSignal(s,'reject');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose signal was rejected');
 });
 await check('SIGNAL no longer VERIFIED (reset to review): DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),s=await verifiedSignal(p);const m=await message(p,{sigs:[s]});
  await reviewSignal(s,'reset');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose signal went back to review');
 });
 await check('SIGNAL rejected then purged (deleted): DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),s=await verifiedSignal(p);const m=await message(p,{sigs:[s]});
  await reviewSignal(s,'reject');await sql(`update public.signals set purge_after=now()-interval '1 day' where id=$1`,[s]);await sql('select public.purge_signals()');
  assert.equal((await sql('select count(*)::int n from public.signals where id=$1',[s])).rows[0].n,0,'the signal is gone');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose signal was purged');
 });
 await check('APPROVED message, SIGNAL REJECTED afterwards: APPROVED → USED refused, still APPROVED',async()=>{
  const p=await fresh(),s=await verifiedSignal(p);const m=await message(p,{sigs:[s]});
  await setStatus(m.id,'APPROVED');await reviewSignal(s,'reject');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'USED'),'copying an approved message whose signal was rejected');
  assert.equal((await row(m.id)).status,'APPROVED');
 });
 await check('MIXED: one valid source does not cover an invalid one (every cited source is checked)',async()=>{
  const p=await fresh(),ok=await verifiedPc(p,'Source toujours valide.'),bad=await verifiedPc(p,'Source rejetée ensuite.'),s=await verifiedSignal(p);
  const m=await message(p,{pcs:[ok,bad],sigs:[s]});await reviewPc(bad,'reject');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving with one rejected source among valid ones');
 });

 // ——— no automatic repair, and the ways out stay open ———
 await check('NO AUTO-REPAIR: after a refusal the source stays REJECTED and no message is created or regenerated',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Rejet définitif.');const m=await message(p,{pcs:[pc]});await reviewPc(pc,'reject');
  const count=async()=>(await sql('select count(*)::int n from public.outreach where prospect_id=$1',[p])).rows[0].n;const c0=await count();
  await refused(()=>setStatus(m.id,'APPROVED'),NOT_VERIFIED,'approval');
  assert.equal((await sql('select status from public.prospect_public_content where id=$1',[pc])).rows[0].status,'REJECTED');
  assert.equal(await count(),c0,'no new message');assert.equal((await row(m.id)).status,'DRAFT');
 });
 await check('WAYS OUT: a DRAFT citing an invalid source can still be edited (SAVE) and DISCARDED',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Source qui sera rejetée.');const m=await message(p,{pcs:[pc]});await reviewPc(pc,'reject');
  await as(A,`update public.outreach set content='Version retouchée.' where id=$1`,[m.id]);assert.equal((await row(m.id)).content,'Version retouchée.');
  await setStatus(m.id,'DISCARDED');assert.equal((await row(m.id)).status,'DISCARDED');
 });
 await check('HUMAN RE-VERIFICATION: once a person verifies the source again, the message can be approved and copied',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Rejeté puis revérifié par une personne.');const m=await message(p,{pcs:[pc]});
  await reviewPc(pc,'reject');await refused(()=>setStatus(m.id,'APPROVED'),NOT_VERIFIED,'approval while rejected');
  await reviewPc(pc,'verify');await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');assert.equal((await row(m.id)).status,'USED');
 });

 // ——— non-regression ———
 await check('NON-REGRESSION: valid sources → DRAFT → APPROVED → USED; both texts kept',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Toujours vérifié.'),s=await verifiedSignal(p);const m=await message(p,{pcs:[pc],sigs:[s]});
  await as(A,`update public.outreach set content='Retouche humaine.' where id=$1`,[m.id]);
  await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');
  const r=await row(m.id);assert.equal(r.status,'USED');assert.equal(r.generated_content,'Bonjour, message généré.');assert.equal(r.content,'Retouche humaine.');
 });
 await check('NON-REGRESSION: a message citing no public content or signal (generic, evidence-only, legacy) moves freely',async()=>{
  const m=await message(await fresh());await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');assert.equal((await row(m.id)).status,'USED');
  const legacy=(await sql(`insert into public.outreach(organization_id,prospect_id,content,status) values($1,$2,'Ancien message','APPROVED') returning id`,[oa,await fresh()])).rows[0].id;
  await setStatus(legacy,'USED');assert.equal((await row(legacy)).status,'USED');
 });
 await check('NON-REGRESSION: a source invalidated after USED changes nothing on the used message (history is kept)',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Utilisé puis rejeté.');const m=await message(p,{pcs:[pc]});await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');
  const r0=await row(m.id);await reviewPc(pc,'reject');assert.deepEqual(await row(m.id),r0);
 });
 await check('TENANT: another tenant still cannot approve the message (no row touched)',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Contenu de A.');const m=await message(p,{pcs:[pc]});
  const r=await as(B,`update public.outreach set status='APPROVED' where id=$1 returning id`,[m.id]);assert.equal(r.rows.length,0);assert.equal((await row(m.id)).status,'DRAFT');
 });
 await check('ERROR SHAPE: SQLSTATE P0001 and the stable token outreach_source_not_verified (mapped by the API)',async()=>{
  const p=await fresh(),pc=await verifiedPc(p,'Forme de l’erreur.');const m=await message(p,{pcs:[pc]});await reviewPc(pc,'reject');
  const e=await refused(()=>setStatus(m.id,'APPROVED'),NOT_VERIFIED,'approval');assert.equal(e.code,'P0001');
 });
 await check('STRUCTURE: BEFORE UPDATE OF status trigger limited to transitions into APPROVED/USED; security invoker, empty search_path, not callable',async()=>{
  const t=(await sql(`select pg_get_triggerdef(oid) d,tgenabled e from pg_trigger where tgname='outreach_provenance_guard'`)).rows[0];
  assert.ok(t,'the trigger exists');
  assert.match(t.d,/BEFORE UPDATE OF status ON public\.outreach FOR EACH ROW WHEN/);assert.match(t.d,/'APPROVED'/);assert.match(t.d,/'USED'/);assert.match(t.d,/IS DISTINCT FROM old\.status/);assert.equal(t.e,'O');
  const f=(await sql(`select p.prosecdef,p.proconfig from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='prospectos_private' and p.proname='guard_outreach_provenance'`)).rows[0];
  assert.equal(f.prosecdef,false);assert.deepEqual(f.proconfig,['search_path=""']);
  for(const role of ['anon','authenticated'])assert.equal((await sql(`select has_function_privilege($1,'prospectos_private.guard_outreach_provenance()','EXECUTE') x`,[role])).rows[0].x,false,role);
 });
}finally{
 for(const [name,s,m] of results)console.log(`${s.padEnd(4)}  ${name}${m?` — ${m}`:''}`);
 const failed=results.filter(r=>r[1]!=='PASS').length;
 console.log(`\nOUTREACH PROVENANCE DB: ${results.length-failed}/${results.length} checks passed`);
 await db.close();if(failed)process.exitCode=1;
}
