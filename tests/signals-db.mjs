// Migration 024 — Signal Engine S1: signals, signal runs and intent profiles on real PostgreSQL (PGlite) with the full
// migration chain. A signal is a dated, sourced public fact, reviewed by a person, never evidence.
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
 assert.ok(files.includes('024_signals.sql'),'migration 024 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const prA=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'ACME','https://acme.example') returning id`,[oa,pa])).rows[0].id;
 const prB=(await as(B,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Other','https://other.example') returning id`,[ob,pb])).rows[0].id;
 const save=(u,p,list,run=null)=>as(u,'select public.save_signals($1,$2,$3::jsonb) r',[p,run,JSON.stringify(list)]).then(r=>r.rows[0].r);
 const review=(u,id,d,reason=null)=>as(u,'select public.review_signal($1,$2,$3) r',[id,d,reason]).then(r=>r.rows[0].r);

 await check('SAVE: a sourced, dated signal is saved PENDING_REVIEW; domain, date basis and confidence come from the database',async()=>{
  assert.deepEqual(await save(A,prA,[sig()]),{inserted:1,duplicates:0});
  const s=(await as(A,'select * from public.signals where prospect_id=$1',[prA])).rows[0];
  assert.equal(s.status,'PENDING_REVIEW');assert.equal(s.source_domain,'www.welcometothejungle.com');assert.equal(s.date_basis,'published');
  assert.equal(Number(s.confidence),0.8,'job board');assert.equal(s.project_id,pa);assert.ok(s.purge_after,'unreviewed signals expire');
  assert.equal((await as(A,`select count(*)::int n from public.events where prospect_id=$1 and kind='signals.saved'`,[prA])).rows[0].n,1);
 });
 await check('STRICT: no client-chosen status, confidence or unknown field; closed types; a URL and an excerpt are required',async()=>{
  await refused(()=>save(A,prA,[{...sig({content_hash:h('x1'),event_key:'k1'}),status:'VERIFIED'}]),/Unknown signal field/,'a client-set status');
  await refused(()=>save(A,prA,[{...sig({content_hash:h('x2'),event_key:'k2'}),confidence:1}]),/Unknown signal field/,'a client-set confidence');
  await refused(()=>save(A,prA,[sig({content_hash:h('x3'),event_key:'k3',signal_type:'mood'})]),/check|violates/i,'an invented type');
  await refused(()=>save(A,prA,[sig({content_hash:h('x4'),event_key:'k4',excerpt:'   '})]),/check|violates/i,'an empty excerpt');
  await refused(()=>save(A,prA,[sig({content_hash:h('x5'),event_key:'k5',source_url:'javascript:alert(1)'})]),/check|violates/i,'a non-http source');
  await refused(()=>save(A,prA,[sig({content_hash:h('x6'),event_key:'k6',observed_at:'2099-01-01T00:00:00Z'})]),/Invalid signal date/,'an observation in the future');
  await refused(()=>save(A,prA,[]),/Invalid signals/,'an empty batch');
 });
 await check('DEDUP: same URL + excerpt skipped; the same event from another source skipped; never overwritten',async()=>{
  assert.deepEqual(await save(A,prA,[sig()]),{inserted:0,duplicates:1});
  assert.deepEqual(await save(A,prA,[sig({source_url:'https://acme.example/carrieres/rssi',source_type:'official_website',content_hash:h('rssi-site')})]),{inserted:0,duplicates:1});
  assert.equal((await as(A,'select count(*)::int n from public.signals where prospect_id=$1',[prA])).rows[0].n,1);
 });
 await check('CONFIDENCE by rule: official 1.0, news 0.8, snippet 0.6, user 0.7, ×0.7 without a date of its own',async()=>{
  await save(A,prA,[
   sig({source_type:'official_website',provider:'official_site',content_hash:h('c1'),event_key:'leadership_change:cto',signal_type:'leadership_change',event_date:'2026-09-20'}),
   sig({source_type:'search_snippet',content_hash:h('c2'),event_key:'funding:serie-a',signal_type:'funding',published_at:null}),
   sig({source_type:'user_provided',provider:'user_provided',content_hash:h('c3'),event_key:'event:salon',signal_type:'event'}),
  ]);
  const c=Object.fromEntries((await as(A,'select event_key,confidence,date_basis from public.signals where prospect_id=$1',[prA])).rows.map(r=>[r.event_key,[Number(r.confidence),r.date_basis]]));
  assert.deepEqual(c['leadership_change:cto'],[1,'event']);assert.deepEqual(c['funding:serie-a'],[0.42,'observed_only']);assert.deepEqual(c['event:salon'],[0.7,'published']);
 });
 await check('REVIEW: verify keeps the signal (no purge date), reject sets a reason and a 30-day purge, reset goes back to review',async()=>{
  const id=(await as(A,`select id from public.signals where event_key='hiring_role:rssi'`)).rows[0].id;
  const v=await review(A,id,'verify');assert.equal(v.status,'VERIFIED');assert.equal(v.reviewed_by,A);assert.equal(v.purge_after,null);
  const r=await review(A,id,'reject','Offre pourvue');assert.equal(r.status,'REJECTED');assert.equal(r.rejection_reason,'Offre pourvue');assert.ok(r.purge_after);
  const z=await review(A,id,'reset');assert.equal(z.status,'PENDING_REVIEW');assert.equal(z.reviewed_by,null);
  await refused(()=>review(A,id,'approve'),/Invalid review decision/,'an unknown decision');
  assert.equal((await as(A,`select count(*)::int n from public.events where kind like 'signal.%'`)).rows[0].n,3);
 });
 await check('NEVER EVIDENCE: saving and verifying signals creates or changes no evidence row',async()=>{
  assert.equal((await sql('select count(*)::int n from public.evidence')).rows[0].n,0);
 });
 await check('TENANT: another organization can neither read, save, review nor profile this prospect’s signals',async()=>{
  assert.equal((await as(B,'select count(*)::int n from public.signals')).rows[0].n,0);
  await refused(()=>save(B,prA,[sig({content_hash:h('b1'),event_key:'b1'})]),/member/i,'saving on another tenant');
  const id=(await as(A,`select id from public.signals limit 1`)).rows[0].id;
  await refused(()=>review(B,id,'verify'),/member/i,'reviewing another tenant’s signal');
  await refused(()=>as(B,'select public.save_intent_profile($1,$2::jsonb)',[pa,'{"types":{"funding":30}}']),/member/i,'profiling another tenant’s project');
  await refused(()=>as(undefined,'select * from public.signals'),/permission denied/,'anon reading');
 });
 await check('NO DIRECT WRITE: members cannot insert, update or delete signals, runs or profiles; observed fields are immutable',async()=>{
  await refused(()=>as(A,`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,confidence,content_hash,event_key) values($1,$2,$3,'web_search','funding','t','e','https://x.example','news',now(),1,$4,'k')`,[oa,pa,prA,h('d')]),/permission denied/,'a direct insert');
  await refused(()=>as(A,`update public.signals set status='VERIFIED'`),/permission denied/,'a direct update');
  await refused(()=>as(A,`delete from public.signals`),/permission denied/,'a direct delete');
  await refused(()=>sql(`update public.signals set excerpt='autre chose'`),/immutable/,'rewriting an observed excerpt, even as owner');
 });
 await check('RUN: a run of another project or prospect cannot be attached',async()=>{
  const run=(await sql(`insert into public.signal_runs(organization_id,project_id,trigger,prospect_ids) values($1,$2,'manual',array[$3]::uuid[]) returning id`,[ob,pb,prB])).rows[0].id;
  await refused(()=>save(A,prA,[sig({content_hash:h('r1'),event_key:'r1'})],run),/Signal run not found/,'a foreign run');
  const own=(await sql(`insert into public.signal_runs(organization_id,project_id,trigger,prospect_ids) values($1,$2,'manual',array[$3]::uuid[]) returning id`,[oa,pa,prA])).rows[0].id;
  assert.deepEqual(await save(A,prA,[sig({content_hash:h('r2'),event_key:'new_site:lyon',signal_type:'new_site'})],own),{inserted:1,duplicates:0});
  assert.equal((await as(A,'select count(*)::int n from public.signal_runs')).rows[0].n,1,'members read their own runs only');
 });
 await check('PROFILE: closed types, weights 0–50 integers, at most 30 terms; members read it',async()=>{
  const r=(await as(A,'select public.save_intent_profile($1,$2::jsonb) r',[pa,'{"types":{"hiring_role":25,"funding":30},"terms":["RSSI","cybersécurité"]}'])).rows[0].r;
  assert.deepEqual(r.profile,{types:{hiring_role:25,funding:30},terms:['RSSI','cybersécurité']});
  for(const bad of ['{"types":{"mood":10}}','{"types":{"funding":60}}','{"types":{"funding":2.5}}','{"types":{},"terms":["x"]}','{"types":{},"extra":1}'])
   await refused(()=>as(A,'select public.save_intent_profile($1,$2::jsonb)',[pa,bad]),/Invalid intent profile/,bad);
  assert.equal((await as(A,'select count(*)::int n from public.intent_profiles')).rows[0].n,1);
 });
 await check('PURGE (server only): expired unreviewed and rejected signals go, verified ones stay',async()=>{
  const keep=(await as(A,`select id from public.signals where event_key='leadership_change:cto'`)).rows[0].id;await review(A,keep,'verify');
  await sql(`alter table public.signals disable trigger signal_guard`);
  await sql(`update public.signals set purge_after=now()-interval '1 day' where status<>'VERIFIED'`);
  await sql(`alter table public.signals enable trigger signal_guard`);
  await refused(()=>as(A,'select public.purge_signals()'),/permission denied/,'a member purging');
  const n=(await service('select public.purge_signals() n')).rows[0].n;assert.ok(n>=1);
  assert.deepEqual((await sql('select status from public.signals')).rows.map(r=>r.status),['VERIFIED']);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\n${results.length-failed.length}/${results.length} PASS`);if(failed.length)process.exit(1);
