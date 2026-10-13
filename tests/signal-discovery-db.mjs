// Migration 030 — Signal-first Discovery V1, P2: runs, candidates, RLS, the shared Discovery quota and its refund, the
// add-to-project path (new or existing prospect + one PENDING_REVIEW signal through save_signals_core), ignore, purge.
// Real PostgreSQL (PGlite) with the full migration chain. The candidates are the EXACT output of the P1 pure pipeline
// (src/signal-discovery/*) on the 6XPOS fixtures, mapped field by field — no second representation.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildCandidate} from '../src/signal-discovery/rank.ts';
import {toCandidateRow} from '../src/signal-discovery/record.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg})`)}
const count=async(q,p=[])=>Number((await sql(q,p)).rows[0].n);

const NOW=new Date();
const F=JSON.parse(await readFile(new URL('./fixtures/signal-discovery/6xpos-chr-occitanie.json',import.meta.url),'utf8'));
const TARGET={activity_terms:F.project.activity_terms,location:F.project.location};
// The fixtures are dated around 2026-10-13: the P1 pipeline runs at that date, the database at its own clock.
const P1_NOW=new Date('2026-10-13T10:00:00Z');
function p1(id){const r=buildCandidate(F.hits[id],TARGET,P1_NOW);assert.ok(r.ok,`${id}: ${r.reason}`);return r.candidate}
// The mapping is the service's own (src/signal-discovery/record.ts, moved there in P3).
const row=(id,o={})=>({...toCandidateRow(p1(id)),...o});

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('030_signal_discovery.sql'),'migration 030 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2),C=U(3),A2=U(4);
 for(const [u,e] of [[A,'a@t'],[B,'b@t'],[C,'c@t'],[A2,'a2@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000');
 for(const u of [A,B,C,A2])await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days')`,[u]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const project=async(u,o)=>(await as(u,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[o])).rows[0].id;
 const pa=await project(A,oa),pa2=await project(A,oa),pb=await project(B,ob);
 const prospect=async(u,o,p,name)=>(await as(u,`insert into public.prospects(organization_id,project_id,name) values($1,$2,$3) returning id`,[o,p,name])).rows[0].id;
 const prA=await prospect(A,oa,pa,'Napolino'),prA2=await prospect(A,oa,pa2,'Autre projet'),prB=await prospect(B,ob,pb,'Chez B');

 const start=async(u,p,o={})=>(await as(u,`select public.start_signal_discovery($1,$2,$3,$4::jsonb,$5,$6) r`,
  [p,o.query??'restaurant','Occitanie',JSON.stringify(o.types??['new_site','expansion']),o.provider??'brave',o.max??20])).rows[0].r;
 const save=async(u,run,items)=>(await service('select public.save_signal_discovery_candidates($1,$2,$3::jsonb) r',[u,run,JSON.stringify(items)])).rows[0].r;
 const cand=async(run,key)=>(await sql('select * from public.signal_discovery_candidates where run_id=$1 and event_key=$2',[run,key])).rows[0];
 const add=async(u,id,name=null,site=null,existing=null)=>(await as(u,'select public.add_signal_candidate_to_project($1,$2,$3,$4) r',[id,name,site,existing])).rows[0].r;
 const ignore=async(u,id)=>(await as(u,'select public.ignore_signal_candidate($1) r',[id])).rows[0].r;
 const billed=async u=>count(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery' and billable`,[u]);
 const usage=async u=>count(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery'`,[u]);
 const complete=(run,status,metrics)=>service('select public.complete_signal_discovery_run($1,$2,$3::jsonb,null) r',[run,status,JSON.stringify(metrics)]).then(r=>r.rows[0].r);
 const release=run=>service('select public.release_failed_signal_discovery($1) r',[run]).then(r=>r.rows[0].r);

 let run;
 await check('1 START: a member starts a run on their project; the run is running, typed, tied to its quota unit',async()=>{
  const before=await usage(A);
  run=await start(A,pa);
  assert.equal(run.status,'running');assert.deepEqual(run.signal_types,['expansion','new_site']);assert.equal(run.created_by,A);assert.equal(run.provider,'brave');
  assert.equal(await usage(A),before+1);
  const u=(await sql('select id,billable from prospectos_private.discovery_quota_usage where id=$1',[run.quota_usage_id])).rows[0];
  assert.ok(u,'quota_usage_id points at the unit');assert.equal(u.billable,true);
 });
 await check('START creates no prospect, no signal, no evidence, no observation, no candidate',async()=>{
  assert.equal(await count('select count(*) n from public.prospects where project_id=$1',[pa]),1);
  for(const t of ['signals','evidence','prospect_observations','signal_discovery_candidates'])assert.equal(await count(`select count(*) n from public.${t}`),0,t);
 });
 await check('START input: only new_site / expansion, provider brave|fixture, max_results 1–50, query and zone sized',async()=>{
  await refused(()=>start(A,pa,{types:['funding']}),/Invalid signal discovery input/,'another signal type');
  await refused(()=>start(A,pa,{types:[]}),/Invalid signal discovery input/,'no type');
  await refused(()=>start(A,pa,{provider:'registry'}),/Invalid signal discovery input/,'registry provider');
  await refused(()=>start(A,pa,{max:51}),/Invalid signal discovery input/,'max_results over 50');
  await refused(()=>start(A,pa,{query:'x'}),/Invalid signal discovery input/,'one-letter query');
 });
 await check('2 NON-MEMBER refused (and anon): nothing consumed',async()=>{
  const before=await usage(C);
  await refused(()=>start(C,pa),/member/i,'a non-member');
  await refused(()=>as(undefined,`select public.start_signal_discovery($1,'restaurant','Occitanie','["new_site"]','brave',20)`,[pa]),/permission denied|member/i,'anon');
  assert.equal(await usage(C),before);
 });
 await check('3 WRONG TENANT refused: B cannot start on A’s project; unknown project refused',async()=>{
  await refused(()=>start(B,pa),/member/i,'B on A’s project');
  await refused(()=>start(A,'00000000-0000-4000-8000-00000000dead'),/Project not found/,'unknown project');
 });
 await check('4 ONE RUN = ONE DISCOVERY UNIT, in the same pool as company Discovery; a fixture run is free',async()=>{
  const b=await billed(A);await start(A,pa);assert.equal(await billed(A),b+1);
  await as(A,`select public.start_discovery($1,'industriel','Occitanie','["industriel"]','registry',20,'{}'::jsonb)`,[pa]);assert.equal(await billed(A),b+2,'entity runs count in the same pool');
  const f=await start(A,pa,{provider:'fixture'});assert.equal(await billed(A),b+2);
  assert.equal((await sql('select billable from prospectos_private.discovery_quota_usage where id=$1',[f.quota_usage_id])).rows[0].billable,false);
 });
 await check('4b PLAN LIMIT: a trial account at its Discovery limit cannot start a Signal run (plan_limit_reached)',async()=>{
  await sql('update prospectos_private.discovery_quota_settings set trial_discovery_limit=$1',[await billed(A)]);
  await refused(()=>start(A,pa),/plan_limit_reached/,'over the plan limit');
  await sql('update prospectos_private.discovery_quota_settings set trial_discovery_limit=20000');
 });
 await check('5 HOURLY LIMIT shared with company Discovery (quota_exceeded), nothing created',async()=>{
  const n=await count(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='discovery' and used_at>now()-interval '1 hour'`,[oa]);
  await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=$1',[n]);
  const runs=await count('select count(*) n from public.signal_discovery_runs');
  await refused(()=>start(A,pa),/quota_exceeded/,'over the hourly limit');
  await refused(()=>as(A,`select public.start_discovery($1,'industriel','Occitanie','["industriel"]','registry',20,'{}'::jsonb)`,[pa]),/quota_exceeded/,'entity run over the same limit');
  assert.equal(await count('select count(*) n from public.signal_discovery_runs'),runs);
  await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000');
 });
 await check('6 REFUND: a failed run with requests_answered = 0 gives back its own unit; the usage row stays',async()=>{
  const r=await start(A,pa);const b=await billed(A);
  assert.equal(await complete(r.id,'failed',{requests_sent:3,requests_answered:0}),true);
  assert.equal(await release(r.id),true);assert.equal(await billed(A),b-1);
  assert.equal(await count('select count(*) n from prospectos_private.discovery_quota_usage where id=$1',[r.quota_usage_id]),1);
 });
 await check('7 NO DOUBLE REFUND, and never for an answered, completed, running or metric-less run',async()=>{
  const r=await start(A,pa);await complete(r.id,'failed',{requests_sent:1,requests_answered:0});
  assert.equal(await release(r.id),true);assert.equal(await release(r.id),false,'second call');
  const answered=await start(A,pa);await complete(answered.id,'failed',{requests_sent:3,requests_answered:1});assert.equal(await release(answered.id),false,'an answered request');
  const done=await start(A,pa);await complete(done.id,'completed',{requests_sent:1,requests_answered:0});assert.equal(await release(done.id),false,'completed');
  const running=await start(A,pa);assert.equal(await release(running.id),false,'running');
  const nometric=await start(A,pa);await complete(nometric.id,'failed',{});assert.equal(await release(nometric.id),false,'no requests_answered recorded');
  assert.equal(await complete(done.id,'failed',{requests_answered:0}),false,'a closed run cannot be reopened as failed');
  for(const id of [answered.id,done.id,running.id,nometric.id])
   assert.equal((await sql('select u.billable from prospectos_private.discovery_quota_usage u join public.signal_discovery_runs r on r.quota_usage_id=u.id where r.id=$1',[id])).rows[0].billable,true);
  await refused(()=>as(A,'select public.release_failed_signal_discovery($1)',[r.id]),/permission denied/,'a member refunding');
  await refused(()=>as(A,`select public.complete_signal_discovery_run($1,'failed','{"requests_answered":0}',null)`,[running.id]),/permission denied/,'a member closing a run');
 });

 const KEYS={};
 await check('8 SAVE (server path): P1 candidates are stored field for field; duplicates by event_key skipped',async()=>{
  const ids=['future_opening_resolved','own_site_resolved_domain','recent_expansion_resolved','another_company_in_article','hosting_netlify','event_place_not_headquarters','published_known_event_unknown','past_exact_day_event','event_without_date'];
  const items=ids.map(id=>row(id));ids.forEach((id,i)=>KEYS[id]=items[i].event_key);
  assert.deepEqual(await save(A,run.id,items),{inserted:ids.length,duplicates:0});
  assert.deepEqual(await save(A,run.id,[items[0]]),{inserted:0,duplicates:1});
  const c=await cand(run.id,KEYS.future_opening_resolved);
  assert.deepEqual([c.status,c.entity_name,c.signal_type,c.event_date_text,c.event_year,c.event_month,c.event_granularity,c.event_tense,c.location_text,c.source_type,c.observed_on_page,c.review_tier,c.icp_match],
   ['NEW','Napolino','new_site','décembre 2026',2026,12,'MONTH','FUTURE','Toulouse','search_snippet',false,1,'IN']);
  assert.deepEqual(c.location_departments,['31']);assert.ok(c.purge_after>new Date(Date.now()+179*86400000));
  const k=await cand(run.id,KEYS.event_place_not_headquarters);
  assert.deepEqual([k.event_granularity,k.event_month_from,k.event_month_to,k.event_month],['PERIOD',3,6,null]);
  const n=await cand(run.id,KEYS.hosting_netlify);
  assert.deepEqual([n.entity_name,n.entity_name_status,n.entity_domain,n.hosting_platform,n.source_domain],[null,'UNRESOLVED',null,'netlify.app','terroirclub.netlify.app']);
 });
 await check('SAVE strict: unknown field, other type, observed_on_page, other source type, foreign domain, impossible date, bad shapes',async()=>{
  const base=row('future_opening_resolved',{event_key:'strict'});
  await refused(()=>save(A,run.id,[{...base,status:'ADDED'}]),/Unknown candidate field/,'a client status');
  await refused(()=>save(A,run.id,[{...base,prospect_id:prA}]),/Unknown candidate field/,'a prospect link');
  await refused(()=>save(A,run.id,[{...base,signal_type:'funding'}]),/Invalid candidate/,'another type');
  await refused(()=>save(A,run.id,[{...base,observed_on_page:true}]),/Invalid candidate/,'observed on page');
  await refused(()=>save(A,run.id,[{...base,source_type:'news'}]),/Invalid candidate/,'another source type');
  await refused(()=>save(A,run.id,[{...base,source_domain:'autre.fr'}]),/Invalid candidate/,'a domain that is not the URL’s');
  await refused(()=>save(A,run.id,[{...base,source_url:'javascript:alert(1)',source_domain:null}]),/check|violates/i,'a non-http URL');
  await refused(()=>save(A,run.id,[{...base,event_granularity:'DAY',event_year:2026,event_month:2,event_day:30,event_date_text:'30 février 2026'}]),/Invalid candidate date/,'30 February');
  await refused(()=>save(A,run.id,[{...base,event_granularity:'PERIOD',event_month:null,event_month_from:6,event_month_to:3}]),/check|violates/i,'a reversed period');
  await refused(()=>save(A,run.id,[{...base,event_granularity:null}]),/check|violates/i,'a date text without a granularity');
  await refused(()=>save(A,run.id,[{...base,entity_name:null}]),/check|violates/i,'RESOLVED without a name');
  await refused(()=>save(A,run.id,[{...base,entity_domain:'napolino.fr',entity_domain_status:'RESOLVED',entity_domain_method:'own_site',hosting_platform:'netlify.app'}]),/check|violates/i,'a domain on a hosting platform');
  await refused(()=>save(A,run.id,[{...base,excerpt:'x'.repeat(501)}]),/check|violates/i,'an oversized excerpt');
  await refused(()=>save(A,run.id,[{...base,published_at:'2099-01-01T00:00:00Z'}]),/Invalid candidate date/,'a publication in the future');
  await refused(()=>save(A,run.id,[]),/Invalid signal discovery candidates/,'an empty batch');
  assert.equal(await count(`select count(*) n from public.signal_discovery_candidates where event_key='strict'`),0);
 });
 await check('SAVE scope: only for the member who launched the run, only into a running run of that tenant',async()=>{
  const item=row('future_opening_resolved',{event_key:'scope'});
  await refused(()=>save(B,run.id,[item]),/member required/,'another tenant’s user');
  await refused(()=>save(A2,run.id,[item]),/member required/,'a user who did not launch the run');
  const closed=await start(A,pa);await complete(closed.id,'completed',{requests_answered:1});
  await refused(()=>save(A,closed.id,[item]),/not running/,'a closed run');
  await refused(()=>save(A,'00000000-0000-4000-8000-00000000dead',[item]),/run not found/,'an unknown run');
  const r=await start(A,pa,{types:['expansion']});
  await refused(()=>save(A,r.id,[item]),/Invalid candidate/,'a new_site candidate in an expansion-only run');
 });
 await check('9 DIRECT WRITES refused for members and anon: insert, update, delete on runs and candidates; save RPC not callable',async()=>{
  const c=await cand(run.id,KEYS.future_opening_resolved);
  for(const u of [A,undefined]){
   await refused(()=>as(u,`update public.signal_discovery_candidates set status='ADDED',prospect_id=$2 where id=$1`,[c.id,prA]),/permission denied/,'update NEW→ADDED');
   await refused(()=>as(u,`delete from public.signal_discovery_candidates where id=$1`,[c.id]),/permission denied/,'delete');
   await refused(()=>as(u,`insert into public.signal_discovery_candidates(run_id) values($1)`,[run.id]),/permission denied/,'insert');
   await refused(()=>as(u,`update public.signal_discovery_runs set status='completed' where id=$1`,[run.id]),/permission denied/,'run update');
   await refused(()=>as(u,`insert into public.signal_discovery_runs(organization_id) values($1)`,[oa]),/permission denied/,'run insert');
  }
  await refused(()=>as(A,'select public.save_signal_discovery_candidates($1,$2,$3::jsonb)',[A,run.id,'[]']),/permission denied/,'a member calling save');
  assert.equal((await cand(run.id,KEYS.future_opening_resolved)).status,'NEW');
 });
 await check('31 IMMUTABLE: even the server cannot rewrite excerpt, URL, type, dates, place, resolution or event_key; nor jump NEW→ADDED',async()=>{
  const c=await cand(run.id,KEYS.future_opening_resolved);
  for(const set of [`excerpt='autre'`,`source_url='https://autre.fr/'`,`signal_type='expansion'`,`event_year=2030`,`published_at=now()`,`location_text='Lyon'`,
   `entity_name='Autre'`,`entity_domain_status='RESOLVED'`,`event_key='k'`,`review_tier=5`,`icp_match='OUT'`,`observed_on_page=true`])
   await refused(()=>sql(`update public.signal_discovery_candidates set ${set} where id=$1`,[c.id]),/immutable|check|violates/i,set);
  // service_role has no table privilege at all; the database owner itself is stopped by the guard.
  await refused(()=>service(`update public.signal_discovery_candidates set excerpt='x' where id=$1`,[c.id]),/permission denied/,'the server role writing directly');
  await refused(()=>sql(`update public.signal_discovery_candidates set status='ADDED',prospect_id=$2,decided_by=$3,decided_at=now(),purge_after=null where id=$1`,[c.id,prA,A]),/only through ignore or add/,'a raw NEW→ADDED');
  await refused(()=>sql(`update public.signal_discovery_candidates set status='IGNORED',decided_by=$2,decided_at=now() where id=$1`,[c.id,A]),/only through ignore or add/,'a raw NEW→IGNORED');
 });
 await check('10–11 A NEW candidate changes neither FIT inputs nor INTENT: no evidence, no signal, no observation, prospect untouched',async()=>{
  for(const t of ['signals','evidence','prospect_observations'])assert.equal(await count(`select count(*) n from public.${t}`),0,t);
  const p=(await sql('select status,website,updated_at from public.prospects where id=$1',[prA])).rows[0];
  assert.deepEqual([p.status,p.website],['À analyser',null]);
 });

 let added;
 await check('14 ADD resolved → a new prospect "À analyser" + one signal; candidate ADDED',async()=>{
  const c=await cand(run.id,KEYS.own_site_resolved_domain);
  added=await add(A,c.id);
  assert.equal(added.created_prospect,true);assert.equal(added.signal_inserted,true);
  const p=(await sql('select * from public.prospects where id=$1',[added.prospect_id])).rows[0];
  assert.deepEqual([p.name,p.status,p.project_id,p.organization_id,p.city],['Napolino','À analyser',pa,oa,null]);
  assert.equal(p.website,'https://napolino-exemple.fr','the resolved own-site domain, observed — never made from the name');
  const after=await cand(run.id,KEYS.own_site_resolved_domain);
  assert.deepEqual([after.status,after.prospect_id,after.signal_id,after.decided_by,after.purge_after],['ADDED',added.prospect_id,added.signal_id,A,null]);
  assert.equal(await count(`select count(*) n from public.events where kind='signal_discovery.added' and prospect_id=$1`,[added.prospect_id]),1);
 });
 await check('22–23 SIGNAL: PENDING_REVIEW, provider discovery_recycled, source_type search_snippet, P1 excerpt and hash',async()=>{
  const s=(await sql('select * from public.signals where id=$1',[added.signal_id])).rows[0];
  const c=await cand(run.id,KEYS.own_site_resolved_domain);
  assert.deepEqual([s.status,s.provider,s.source_type,s.signal_type,s.excerpt,s.content_hash,s.event_key,s.reviewed_by],
   ['PENDING_REVIEW','discovery_recycled','search_snippet','new_site',c.excerpt,c.content_hash,c.event_key,null]);
  assert.equal(s.raw_metadata.observed_on_page,false);assert.equal(s.raw_metadata.origin,'signal_discovery');assert.equal(s.raw_metadata.candidate_id,c.id);
 });
 await check('27–29 FUTURE EVENT: signals.event_date NULL, announced date in raw_metadata, publication kept apart (date_basis published)',async()=>{
  const s=(await sql('select * from public.signals where id=$1',[added.signal_id])).rows[0];
  assert.equal(s.event_date,null);assert.equal(s.date_basis,'published');
  assert.equal(new Date(s.published_at).toISOString(),'2026-09-28T00:00:00.000Z');
  assert.deepEqual(s.raw_metadata.announced_event,{text:'janvier 2027',year:2027,month:1,day:null,granularity:'MONTH',months:null,tense:'FUTURE'});
  // Unknown event date: the publication is never copied into event_date.
  const u=await add(A,(await cand(run.id,KEYS.published_known_event_unknown)).id);
  const su=(await sql('select event_date,published_at,date_basis,raw_metadata from public.signals where id=$1',[u.signal_id])).rows[0];
  assert.equal(su.event_date,null);assert.equal(su.date_basis,'published');assert.equal(su.raw_metadata.announced_event,null);
  // A PAST event written with its exact day keeps that day — and only that one.
  const past=await add(A,(await cand(run.id,KEYS.past_exact_day_event)).id);
  const sp=(await sql(`select to_char(event_date,'YYYY-MM-DD') d,date_basis,published_at from public.signals where id=$1`,[past.signal_id])).rows[0];
  assert.deepEqual([sp.d,sp.date_basis],['2026-09-25','event']);assert.equal(new Date(sp.published_at).toISOString(),'2026-09-26T00:00:00.000Z');
 });
 await check('15 UNRESOLVED without a human name → ENTITY_NAME_REQUIRED, nothing created',async()=>{
  const c=await cand(run.id,KEYS.hosting_netlify);const before=await count('select count(*) n from public.prospects');
  await refused(()=>add(A,c.id),/ENTITY_NAME_REQUIRED/,'no name');
  await refused(()=>add(A,c.id,'   '),/ENTITY_NAME_REQUIRED/,'a blank name');
  assert.equal(await count('select count(*) n from public.prospects'),before);assert.equal((await cand(run.id,KEYS.hosting_netlify)).status,'NEW');
 });
 await check('16–18 UNRESOLVED + human name → added; no website given → none (never "netlify", never from the name)',async()=>{
  const c=await cand(run.id,KEYS.hosting_netlify);
  const r=await add(A,c.id,'Terroir Club');
  const p=(await sql('select name,website from public.prospects where id=$1',[r.prospect_id])).rows[0];
  assert.deepEqual([p.name,p.website],['Terroir Club',null]);
  const d=await cand(run.id,KEYS.another_company_in_article);
  const r2=await add(A,d.id,'Groupe Napolino','https://www.napolino-groupe.fr/');
  assert.equal((await sql('select website from public.prospects where id=$1',[r2.prospect_id])).rows[0].website,'https://www.napolino-groupe.fr/','the person’s own entry');
  const ewd=(await cand(run.id,KEYS.event_without_date)).id;await refused(()=>add(A,ewd,null,'javascript:alert(1)'),/Invalid website/,'a non-http website');
  assert.equal(await count(`select count(*) n from public.prospects where website ilike '%netlify%' or website ilike '%vercel%'`),0);
 });
 await check('19 EXISTING PROSPECT of the same project: the signal is attached there, no new prospect',async()=>{
  const c=await cand(run.id,KEYS.future_opening_resolved);const before=await count('select count(*) n from public.prospects');
  const r=await add(A,c.id,null,null,prA);
  assert.deepEqual([r.prospect_id,r.created_prospect],[prA,false]);assert.equal(await count('select count(*) n from public.prospects'),before);
  assert.equal((await sql('select prospect_id,status from public.signals where id=$1',[r.signal_id])).rows[0].prospect_id,prA);
  assert.equal((await cand(run.id,KEYS.future_opening_resolved)).prospect_id,prA);
  // Idempotent: adding again returns the same link.
  const again=await add(A,c.id);assert.deepEqual([again.already_added,again.prospect_id,again.signal_id],[true,prA,r.signal_id]);
 });
 await check('20–21 EXISTING PROSPECT of another organization or another project → refused, nothing changed',async()=>{
  const c=await cand(run.id,KEYS.recent_expansion_resolved);
  await refused(()=>add(A,c.id,null,null,prB),/Prospect not found/,'a prospect of B');
  await refused(()=>add(A,c.id,null,null,prA2),/Prospect not found/,'a prospect of another project');
  await refused(()=>add(A,c.id,'Nom',null,prA),/Invalid add input/,'a name with an existing prospect');
  assert.equal((await cand(run.id,KEYS.recent_expansion_resolved)).status,'NEW');
  assert.equal(await count('select count(*) n from public.signals where prospect_id in ($1,$2)',[prB,prA2]),0);
 });
 await check('12 IGNORE: NEW → IGNORED only; no prospect, signal, evidence or event created',async()=>{
  const c=await cand(run.id,KEYS.recent_expansion_resolved);
  const before=await Promise.all(['prospects','signals','evidence','prospect_observations'].map(t=>count(`select count(*) n from public.${t}`)));
  const r=await ignore(A,c.id);assert.deepEqual([r.status,r.decided_by,r.prospect_id,r.signal_id],['IGNORED',A,null,null]);
  assert.deepEqual(await Promise.all(['prospects','signals','evidence','prospect_observations'].map(t=>count(`select count(*) n from public.${t}`))),before);
  assert.equal((await ignore(A,c.id)).status,'IGNORED','a second ignore changes nothing');
 });
 await check('13 IGNORED is terminal: it cannot be added; an ADDED candidate cannot be ignored',async()=>{
  await refused(async()=>add(A,(await cand(run.id,KEYS.recent_expansion_resolved)).id,'Café Mira'),/CANDIDATE_IGNORED/,'adding an ignored candidate');
  await refused(async()=>ignore(A,(await cand(run.id,KEYS.own_site_resolved_domain)).id),/CANDIDATE_ALREADY_ADDED/,'ignoring an added candidate');
 });
 await check('30 ATOMIC: if the signal cannot be saved, no prospect is created and the candidate stays NEW',async()=>{
  const c=await cand(run.id,KEYS.event_without_date);const before=await count('select count(*) n from public.prospects');
  await db.exec(`create function public.fail_signal_insert() returns trigger language plpgsql as $$ begin raise exception 'signal store down'; end $$;
   create trigger fail_signal_insert before insert on public.signals for each row execute function public.fail_signal_insert();`);
  try{await refused(()=>add(A,c.id),/signal store down/,'a failing signal insert')}
  finally{await db.exec('drop trigger fail_signal_insert on public.signals; drop function public.fail_signal_insert();')}
  assert.equal(await count('select count(*) n from public.prospects'),before);
  const after=await cand(run.id,KEYS.event_without_date);assert.deepEqual([after.status,after.prospect_id,after.signal_id],['NEW',null,null]);
  assert.equal((await add(A,c.id)).created_prospect,true,'works once the store is back');
 });
 await check('24 NO PATH TO VERIFIED: every signal from Signal Discovery is PENDING_REVIEW; 030 never names VERIFIED; review_signal stays the only way',async()=>{
  assert.equal(await count(`select count(*) n from public.signals where provider='discovery_recycled' and status<>'PENDING_REVIEW'`),0);
  const migration=await readFile(new URL('../db/migrations/030_signal_discovery.sql',import.meta.url),'utf8');
  assert.doesNotMatch(migration.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n'),/VERIFIED|review_signal|reviewed_by/,'no code path sets a review status');
  // The existing human path still works on these signals.
  const v=(await as(A,`select public.review_signal($1,'verify',null) r`,[added.signal_id])).rows[0].r;
  assert.equal(v.status,'VERIFIED');assert.equal(v.reviewed_by,A);
  assert.equal((await cand(run.id,KEYS.own_site_resolved_domain)).status,'ADDED','the review does not touch the candidate');
 });
 await check('25–26 NO EVIDENCE, NO OBSERVATION created by any Signal Discovery path',async()=>{
  assert.equal(await count('select count(*) n from public.evidence'),0);assert.equal(await count('select count(*) n from public.prospect_observations'),0);
 });
 await check('11b UNVERIFIED does not count: only the human-verified signal is VERIFIED among discovery_recycled ones',async()=>{
  assert.equal(await count(`select count(*) n from public.signals where provider='discovery_recycled' and status='VERIFIED'`),1);
 });

 await check('33 RLS: A reads only A’s runs and candidates; B reads only B’s; anon nothing',async()=>{
  const rb=await start(B,pb);await save(B,rb.id,[row('future_opening_resolved')]);
  const seenA=(await as(A,'select organization_id from public.signal_discovery_candidates')).rows;assert.ok(seenA.length>0&&seenA.every(r=>r.organization_id===oa));
  assert.ok((await as(A,'select organization_id from public.signal_discovery_runs')).rows.every(r=>r.organization_id===oa));
  const seenB=(await as(B,'select organization_id,run_id from public.signal_discovery_candidates')).rows;assert.deepEqual(seenB.map(r=>[r.organization_id,r.run_id]),[[ob,rb.id]]);
  assert.deepEqual((await as(B,'select id from public.signal_discovery_runs')).rows.map(r=>r.id),[rb.id]);
  await refused(()=>as(undefined,'select count(*) from public.signal_discovery_candidates'),/permission denied/,'anon read');
  assert.equal((await as(C,'select count(*)::int n from public.signal_discovery_candidates')).rows[0].n,0,'a user without organization');
 });
 await check('33b CROSS-TENANT: A can neither ignore nor add B’s candidate; B’s candidate cannot reach A’s prospect',async()=>{
  const cb=(await sql('select id from public.signal_discovery_candidates where organization_id=$1 limit 1',[ob])).rows[0].id;
  await refused(()=>ignore(A,cb),/member/i,'A ignoring B’s candidate');
  await refused(()=>add(A,cb,'X'),/member/i,'A adding B’s candidate');
  await refused(()=>add(A,cb,null,null,prA),/member/i,'A attaching B’s candidate to A’s prospect');
  await refused(()=>add(B,cb,null,null,prA),/Prospect not found/,'B attaching its candidate to A’s prospect');
  assert.equal((await sql('select status from public.signal_discovery_candidates where id=$1',[cb])).rows[0].status,'NEW');
  const ca=(await cand(run.id,KEYS.event_place_not_headquarters)).id;
  await refused(()=>add(B,ca,'X'),/member/i,'B adding A’s candidate');
 });

 await check('32 PURGE: expired NEW / IGNORED candidates removed; ADDED kept; prospects, signals, evidence, outreach untouched',async()=>{
  const before={p:await count('select count(*) n from public.prospects'),s:await count('select count(*) n from public.signals'),e:await count('select count(*) n from public.evidence'),o:await count('select count(*) n from public.outreach')};
  // Ageing is done as the database owner (the trigger only guards the observed content and the decisions).
  await sql(`alter table public.signal_discovery_candidates disable trigger signal_discovery_candidate_guard`);
  await sql(`update public.signal_discovery_candidates set purge_after=now()-interval '1 day' where status in ('NEW','IGNORED')`);
  await sql(`alter table public.signal_discovery_candidates enable trigger signal_discovery_candidate_guard`);
  const added=await count(`select count(*) n from public.signal_discovery_candidates where status='ADDED'`);
  const r=(await service('select public.purge_signal_discovery() r')).rows[0].r;
  assert.ok(r.candidates>0);
  assert.equal(await count(`select count(*) n from public.signal_discovery_candidates where status in ('NEW','IGNORED')`),0);
  assert.equal(await count(`select count(*) n from public.signal_discovery_candidates where status='ADDED'`),added);
  assert.deepEqual({p:await count('select count(*) n from public.prospects'),s:await count('select count(*) n from public.signals'),e:await count('select count(*) n from public.evidence'),o:await count('select count(*) n from public.outreach')},before);
  await refused(()=>as(A,'select public.purge_signal_discovery()'),/permission denied/,'a member purging');
 });
 await check('PURGE of signals (024) still works with linked candidates: the link is cleared, the candidate stays ADDED',async()=>{
  const c=(await sql(`select id,signal_id from public.signal_discovery_candidates where status='ADDED' and signal_id is not null and signal_id<>$1 limit 1`,[added.signal_id])).rows[0];
  await sql(`update public.signals set purge_after=now()-interval '1 day' where id=$1`,[c.signal_id]);
  assert.ok((await service('select public.purge_signals() n')).rows[0].n>=1);
  const after=(await sql('select status,signal_id,prospect_id from public.signal_discovery_candidates where id=$1',[c.id])).rows[0];
  assert.deepEqual([after.status,after.signal_id],['ADDED',null]);assert.ok(after.prospect_id);
 });
 await check('STRUCTURE: security definer + empty search_path on every 030 function; client grants exactly as designed',async()=>{
  const fns={'public.start_signal_discovery(uuid,text,text,jsonb,text,integer)':'authenticated','public.ignore_signal_candidate(uuid)':'authenticated',
   'public.add_signal_candidate_to_project(uuid,text,text,uuid)':'authenticated','public.save_signal_discovery_candidates(uuid,uuid,jsonb)':'service_role',
   'public.complete_signal_discovery_run(uuid,text,jsonb,text)':'service_role','public.release_failed_signal_discovery(uuid)':'service_role','public.purge_signal_discovery()':'service_role'};
  for(const [sig,who] of Object.entries(fns)){
   const f=(await sql(`select prosecdef,proconfig,has_function_privilege('anon',$1::regprocedure,'EXECUTE') anon,has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') auth,
    has_function_privilege('service_role',$1::regprocedure,'EXECUTE') svc from pg_proc where oid=$1::regprocedure`,[sig])).rows[0];
   assert.equal(f.prosecdef,true,sig);assert.deepEqual(f.proconfig,['search_path=""'],sig);assert.equal(f.anon,false,sig);
   assert.equal(f.auth,who==='authenticated',sig);if(who==='service_role')assert.equal(f.svc,true,sig);
  }
  assert.equal((await sql(`select has_function_privilege('authenticated','prospectos_private.guard_signal_discovery_candidate()','EXECUTE') x`)).rows[0].x,false);
 });
 await check('IDEMPOTENT: re-applying 030 keeps data and behaviour',async()=>{
  const n=await count('select count(*) n from public.signal_discovery_candidates');
  await db.exec(await readFile(new URL('../db/migrations/030_signal_discovery.sql',import.meta.url),'utf8'));
  assert.equal(await count('select count(*) n from public.signal_discovery_candidates'),n);
  const r=await start(A,pa);assert.equal(r.status,'running');
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}finally{await db.close()}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\nSIGNAL DISCOVERY DB: ${results.length-failed.length}/${results.length} checks passed`);if(failed.length)process.exit(1);
