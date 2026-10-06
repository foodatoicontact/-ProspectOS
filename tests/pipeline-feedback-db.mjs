// Migration 025 — Signal Engine S7/S8: RDV status, outreach.signal_ids and contact snapshots, on real PostgreSQL (PGlite)
// with the full migration chain. A snapshot freezes why a prospect was contacted; it is never evidence.
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
 assert.ok(files.includes('025_pipeline_feedback.sql'),'migration 025 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const prA=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'ACME','https://acme.example') returning id`,[oa,pa])).rows[0].id;
 const prB=(await as(B,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Other','https://other.example') returning id`,[ob,pb])).rows[0].id;

 const save=(u,p,list)=>as(u,'select public.save_signals($1,null,$2::jsonb) r',[p,JSON.stringify(list)]).then(r=>r.rows[0].r);
 await save(A,prA,[sig()]);
 const sid=(await as(A,'select id from public.signals where prospect_id=$1',[prA])).rows[0].id;
 await as(A,`select public.review_signal($1,'verify')`,[sid]);
 const ev=(await as(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at,verified_by) values($1,$2,'need_fit',true,'VERIFIED','https://acme.example','x',now(),$3) returning id`,[oa,prA,A])).rows[0].id;
 const snap=(o={})=>({fit_score:55,fit_estimated:70,intent_score:18,intent_estimated:30,signals:[{id:sid,type:'hiring_role',source_type:'job_board',age_days:4}],evidence_ids:[ev],...o});
 const record=(u,p,o,trigger,s)=>as(u,'select public.record_contact_snapshot($1,$2,$3,$4::jsonb) r',[p,o,trigger,JSON.stringify(s)]).then(r=>r.rows[0].r);

 await check('RDV: a new pipeline status between Intéressé and Gagné; an unknown status is still refused',async()=>{
  await as(A,`update public.prospects set status='RDV' where id=$1`,[prA]);
  await refused(()=>as(A,`update public.prospects set status='Rendez-vous' where id=$1`,[prA]),/check|violates/i,'an unknown status');
  await as(A,`update public.prospects set status='Contacté' where id=$1`,[prA]);
 });
 await check('OUTREACH: signal_ids stored next to evidence_ids, an array of at most 20',async()=>{
  const o=(await as(A,`insert into public.outreach(organization_id,prospect_id,content,evidence_ids,signal_ids) values($1,$2,'Bonjour',$3::jsonb,$4::jsonb) returning signal_ids`,[oa,prA,JSON.stringify([ev]),JSON.stringify([sid])])).rows[0];
  assert.deepEqual(o.signal_ids,[sid]);
  await refused(()=>as(A,`insert into public.outreach(organization_id,prospect_id,content,signal_ids) values($1,$2,'x','{}'::jsonb)`,[oa,prA]),/check|violates/i,'a non-array');
  assert.deepEqual((await as(A,`insert into public.outreach(organization_id,prospect_id,content,status) values($1,$2,'y','DISCARDED') returning signal_ids`,[oa,prA])).rows[0].signal_ids,[],'defaults to none');
 });
 await check('SNAPSHOT: frozen once per contact (7 days), with an audit event; members read it; nobody rewrites it',async()=>{
  const o=(await as(A,`select id from public.outreach where prospect_id=$1 limit 1`,[prA])).rows[0].id;
  const r=await record(A,prA,o,'outreach_used',snap());assert.equal(r.created,true);
  const again=await record(A,prA,null,'status_contacted',snap({intent_score:90}));assert.deepEqual(again,{created:false,id:r.id},'the same contact is not frozen twice');
  const row=(await as(A,'select * from public.contact_snapshots')).rows;assert.equal(row.length,1);
  assert.equal(row[0].intent_score,18);assert.equal(row[0].created_by,A);assert.equal(row[0].project_id,pa);assert.equal(row[0].trigger,'outreach_used');
  assert.equal((await as(A,`select count(*)::int n from public.events where kind='contact.snapshot'`)).rows[0].n,1);
  await refused(()=>as(A,`update public.contact_snapshots set intent_score=100`),/permission denied/,'rewriting a snapshot');
  await refused(()=>as(A,`delete from public.contact_snapshots`),/permission denied/,'deleting a snapshot');
  await refused(()=>as(A,`insert into public.contact_snapshots(organization_id,project_id,prospect_id,trigger,intent_score,intent_estimated) values($1,$2,$3,'status_contacted',0,0)`,[oa,pa,prA]),/permission denied/,'a direct insert');
 });
 await check('STRICT: cited signals and evidence must be this prospect’s own; closed keys and triggers; scores 0–100',async()=>{
  const prA2=(await as(A,`insert into public.prospects(organization_id,project_id,name) values($1,$2,'BETA') returning id`,[oa,pa])).rows[0].id;
  await refused(()=>record(A,prA2,null,'status_contacted',snap()),/Invalid snapshot signal/,'another prospect’s signal');
  await refused(()=>record(A,prA2,null,'status_contacted',snap({signals:[],evidence_ids:[ev]})),/Invalid snapshot evidence/,'another prospect’s evidence');
  await refused(()=>record(A,prA2,null,'status_contacted',snap({signals:[],evidence_ids:[],extra:1})),/Invalid snapshot/,'an unknown key');
  await refused(()=>record(A,prA2,null,'sent',snap({signals:[],evidence_ids:[]})),/Invalid snapshot/,'an unknown trigger');
  await refused(()=>record(A,prA2,null,'status_contacted',snap({signals:[],evidence_ids:[],intent_score:150})),/check|violates/i,'a score above 100');
  await refused(()=>record(A,prA2,null,'status_contacted',snap({signals:[{id:sid,type:'funding',source_type:'job_board',age_days:1}],evidence_ids:[]})),/Invalid snapshot signal/,'a signal type that is not the stored one');
  const ok=await record(A,prA2,null,'status_contacted',snap({signals:[],evidence_ids:[],fit_score:null,fit_estimated:null}));assert.equal(ok.created,true,'unscored is allowed');
 });
 await check('TENANT: another organization can neither record nor read snapshots',async()=>{
  await refused(()=>record(B,prA,null,'status_contacted',snap({signals:[],evidence_ids:[]})),/member/i,'recording on another tenant');
  assert.equal((await as(B,'select count(*)::int n from public.contact_snapshots')).rows[0].n,0);
  await refused(()=>record(A,prB,null,'status_contacted',snap({signals:[],evidence_ids:[]})),/member/i,'citing another tenant’s prospect');
  await refused(()=>as(undefined,'select * from public.contact_snapshots'),/permission denied/,'anon reading');
 });
 await check('NEVER EVIDENCE: snapshots write no evidence row',async()=>{
  assert.equal((await sql('select count(*)::int n from public.evidence')).rows[0].n,1,'only the one this test inserted');
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
