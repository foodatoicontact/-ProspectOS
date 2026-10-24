// Migration 036 — evidence provenance at the moment of use, on real PostgreSQL (PGlite) with the full migration chain.
// A message quotes evidence that was VERIFIED when it was generated (the factual template only ever uses verified
// proofs). If a person later sends the observation back to review or contradicts it — or the evidence status changes
// or the row disappears — the message may still be edited, discarded or regenerated, but never approved
// (DRAFT → APPROVED) nor copied (APPROVED → USED): every transition into APPROVED or USED re-checks each cited evidence
// (still there, same prospect and tenant, VERIFIED). A refusal leaves the row exactly as it was.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let err=null;try{await op()}catch(e){err=e}if(err===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(String(err.message)))throw Error(`refused for the wrong reason (${err.message}) — ${what}`);return err}
const NOT_VERIFIED=/outreach_source_not_verified/;
const ICP=[{key:'need_fit',label:'Répond aux marchés publics',weight:60},{key:'target_fit',label:'PME BTP',weight:40}];
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 const target=files.find(f=>f.startsWith('036_'));
 const before=files.filter(f=>!target||f<target),after=target?files.filter(f=>f>=target):[];
 for(const f of before)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const oa=(await as(A,`select public.create_organization('Org A') id`)).rows[0].id;await as(B,`select public.create_organization('Org B') id`);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 await sql(`insert into public.icps(project_id,organization_id,criteria) values($1,$2,$3::jsonb)`,[pa,oa,JSON.stringify(ICP)]);
 // One prospect per scenario: a prospect has at most one live DRAFT (migration 007).
 let k=0;const fresh=async()=>(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,$3,'https://x.example') returning id`,[oa,pa,`Prospect ${++k}`])).rows[0].id;

 // The product path: an analysis proposes an observation, a person confirms it (its evidence becomes VERIFIED).
 let n=0;
 const confirmedObservation=async(p,criterion='need_fit')=>{n++;
  await as(A,'select public.save_discovery_observations($1,$2::jsonb)',[p,JSON.stringify([{criterion,observation_type:`ICP_SIGNAL:${criterion}:${n}`,claim:`Fait ${n}`,value:true,status:'OBSERVED',
   source_url:`https://x.example/page-${n}`,source_title:'Page',source_excerpt:`Nous répondons aux appels d’offres publics (${n}).`,source_type:'official_website',confidence:0.9,
   collected_at:'2026-10-20T09:00:00Z',expires_at:'2027-10-20T09:00:00Z',content_hash:`hash-${n}`}])]);
  const o=(await sql(`select id,evidence_id from public.prospect_observations where prospect_id=$1 and observation_type=$2`,[p,`ICP_SIGNAL:${criterion}:${n}`])).rows[0];
  await review(o.id,'confirm');
  assert.equal((await sql('select status from public.evidence where id=$1',[o.evidence_id])).rows[0].status,'VERIFIED','the confirmed evidence is VERIFIED');
  return {obs:o.id,ev:o.evidence_id}};
 const review=(id,d)=>as(A,'select public.review_discovery_observation($1,$2)',[id,d]);
 // A hand-added proof the person verified (POST /evidence with status VERIFIED).
 const verifiedEvidence=async p=>(await as(A,`insert into public.evidence(prospect_id,organization_id,criterion,value,status,source_url,excerpt,observed_at)
  values($1,$2,'target_fit',true,'VERIFIED','https://x.example/entreprise','35 collaborateurs.',now()) returning id`,[p,oa])).rows[0].id;
 const message=async(p,evs=[])=>(await as(A,`insert into public.outreach(organization_id,prospect_id,content,evidence_ids,provider)
  values($1,$2,'Bonjour, message généré.',$3::jsonb,'rule_based_v1') returning *`,[oa,p,JSON.stringify(evs)])).rows[0];
 const row=async id=>(await sql('select * from public.outreach where id=$1',[id])).rows[0];
 const setStatus=(id,status,u=A)=>as(u,'update public.outreach set status=$2 where id=$1',[id,status]);
 const events=async id=>(await sql(`select count(*)::int n from public.events where payload->>'record_id'=$1`,[id])).rows[0].n;
 const refusedUnchanged=async(id,op,what)=>{const r0=await row(id),e0=await events(id);await refused(op,NOT_VERIFIED,what);assert.deepEqual(await row(id),r0,`${what}: the message is unchanged`);assert.equal(await events(id),e0,`${what}: no event recorded`)};

 await check('MIGRATION 036 present and applied on top of every earlier migration',async()=>{assert.ok(target,'a 036_* migration exists');for(const f of after)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'))});
 await check('IDEMPOTENT: re-applying 036 changes nothing (one trigger, one function)',async()=>{
  for(const f of after)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
  assert.equal((await sql(`select count(*)::int n from pg_trigger where tgname='outreach_provenance_guard' and not tgisinternal`)).rows[0].n,1);
  assert.equal((await sql(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='prospectos_private' and p.proname='guard_outreach_provenance'`)).rows[0].n,1);
 });

 // ——— the reported path: observation reviewed again after the message was generated ———
 await check('OBSERVATION CONTRADICTED after generation: DRAFT → APPROVED refused, message unchanged',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);
  await review(obs,'contradict');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message quoting a contradicted proof');
 });
 await check('OBSERVATION SENT BACK TO REVIEW (unverify): DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);
  await review(obs,'unverify');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message quoting a proof back in review');
 });
 await check('APPROVED message, OBSERVATION CONTRADICTED afterwards: APPROVED → USED (Copy) refused, still APPROVED',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);
  await setStatus(m.id,'APPROVED');await review(obs,'contradict');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'USED'),'copying an approved message quoting a contradicted proof');
  assert.equal((await row(m.id)).status,'APPROVED');
 });
 await check('APPROVING WITH A NEW TEXT in the same statement is refused atomically (text kept)',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);
  await review(obs,'contradict');
  await refusedUnchanged(m.id,()=>as(A,`update public.outreach set status='APPROVED',content='Texte retouché puis approuvé.' where id=$1`,[m.id]),'approve + edit in one update');
 });

 // ——— other ways an evidence stops being VERIFIED ———
 await check('EVIDENCE STATUS CHANGED directly by a member: DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),ev=await verifiedEvidence(p);const m=await message(p,[ev]);
  await as(A,`update public.evidence set status='NOT_VERIFIED' where id=$1`,[ev]);
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message quoting an evidence set back to NOT_VERIFIED');
 });
 await check('EVIDENCE NOT VERIFIED at creation (manual insert, outside the template): DRAFT → APPROVED refused',async()=>{
  const p=await fresh();const ev=(await as(A,`insert into public.evidence(prospect_id,organization_id,criterion,value,status,source_url,excerpt,observed_at)
   values($1,$2,'need_fit',true,'NOT_VERIFIED','https://x.example/contact','Réponse aux consultations publiques.',now()) returning id`,[p,oa])).rows[0].id;
  const m=await message(p,[ev]);
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message quoting a never-verified proof');
 });
 await check('EVIDENCE no longer on this prospect (data drift, simulated): DRAFT → APPROVED refused',async()=>{
  const p=await fresh(),other=await fresh(),ev=await verifiedEvidence(p);const m=await message(p,[ev]);
  await sql(`set session_replication_role=replica`);try{await sql('update public.evidence set prospect_id=$2 where id=$1',[ev,other])}finally{await sql(`set session_replication_role=origin`)}
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving a message whose proof now belongs to another prospect');
 });
 await check('MIXED: one verified proof does not cover an invalidated one (every cited evidence is checked)',async()=>{
  const p=await fresh(),ok=await verifiedEvidence(p),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ok,ev]);
  await review(obs,'contradict');
  await refusedUnchanged(m.id,()=>setStatus(m.id,'APPROVED'),'approving with one contradicted proof among valid ones');
 });

 // ——— ways out stay open, nothing is repaired automatically ———
 await check('WAYS OUT: a DRAFT quoting an invalidated proof can still be edited (SAVE) and DISCARDED',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);await review(obs,'contradict');
  await as(A,`update public.outreach set content='Version retouchée.' where id=$1`,[m.id]);assert.equal((await row(m.id)).content,'Version retouchée.');
  await setStatus(m.id,'DISCARDED');assert.equal((await row(m.id)).status,'DISCARDED');
  assert.equal((await sql('select status from public.evidence where id=$1',[ev])).rows[0].status,'CONTRADICTED','the proof is left as the person set it');
 });
 await check('HUMAN RE-VERIFICATION: once a person confirms the observation again, the message can be approved and copied',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);
  await review(obs,'unverify');await refused(()=>setStatus(m.id,'APPROVED'),NOT_VERIFIED,'approval while in review');
  await review(obs,'confirm');await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');assert.equal((await row(m.id)).status,'USED');
 });

 // ——— non-regression ———
 await check('NON-REGRESSION: verified proofs → DRAFT → APPROVED → USED; both texts kept',async()=>{
  const p=await fresh(),{ev}=await confirmedObservation(p),ev2=await verifiedEvidence(p);const m=await message(p,[ev,ev2]);
  await as(A,`update public.outreach set content='Retouche humaine.' where id=$1`,[m.id]);
  await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');
  const r=await row(m.id);assert.equal(r.status,'USED');assert.equal(r.generated_content,'Bonjour, message généré.');assert.equal(r.content,'Retouche humaine.');
 });
 await check('NON-REGRESSION: a message citing no evidence (generic template) moves freely',async()=>{
  const m=await message(await fresh());await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');assert.equal((await row(m.id)).status,'USED');
 });
 await check('NON-REGRESSION: a proof invalidated after USED changes nothing on the used message (history is kept)',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);await setStatus(m.id,'APPROVED');await setStatus(m.id,'USED');
  const r0=await row(m.id);await review(obs,'contradict');assert.deepEqual(await row(m.id),r0);
 });
 await check('NON-REGRESSION: discarding a message whose proof was invalidated is never blocked',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);await setStatus(m.id,'APPROVED');
  await review(obs,'contradict');await setStatus(m.id,'DISCARDED');assert.equal((await row(m.id)).status,'DISCARDED');
 });
 await check('TENANT: another tenant still cannot approve the message (no row touched)',async()=>{
  const p=await fresh(),{ev}=await confirmedObservation(p);const m=await message(p,[ev]);
  const r=await as(B,`update public.outreach set status='APPROVED' where id=$1 returning id`,[m.id]);assert.equal(r.rows.length,0);assert.equal((await row(m.id)).status,'DRAFT');
 });
 await check('ERROR SHAPE: SQLSTATE P0001, token outreach_source_not_verified, detail evidence',async()=>{
  const p=await fresh(),{obs,ev}=await confirmedObservation(p);const m=await message(p,[ev]);await review(obs,'contradict');
  const e=await refused(()=>setStatus(m.id,'APPROVED'),NOT_VERIFIED,'approval');assert.equal(e.code,'P0001');assert.equal(e.detail,'evidence');
 });
 await check('STRUCTURE: function stays security invoker, empty search_path, not callable by clients',async()=>{
  const f=(await sql(`select p.prosecdef,p.proconfig from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='prospectos_private' and p.proname='guard_outreach_provenance'`)).rows[0];
  assert.equal(f.prosecdef,false);assert.deepEqual(f.proconfig,['search_path=""']);
  for(const role of ['anon','authenticated'])assert.equal((await sql(`select has_function_privilege($1,'prospectos_private.guard_outreach_provenance()','EXECUTE') x`,[role])).rows[0].x,false,role);
 });
}finally{
 for(const [name,s,m] of results)console.log(`${s.padEnd(4)}  ${name}${m?` — ${m}`:''}`);
 const failed=results.filter(r=>r[1]!=='PASS').length;
 console.log(`\nOUTREACH EVIDENCE PROVENANCE DB: ${results.length-failed}/${results.length} checks passed`);
 await db.close();if(failed)process.exitCode=1;
}
