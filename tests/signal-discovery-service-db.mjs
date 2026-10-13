// Signal-first Discovery V1 — P3 end to end on real PostgreSQL (PGlite, full migration chain): the service
// (src/signal-discovery/service.ts) with the fixture provider, against the migration-030 functions called exactly as the
// Supabase repository calls them (start as the member, the rest as the server role). Failure semantics A–E observed on
// the quota ledger itself; add → PENDING_REVIEW; nothing verified, no evidence, no observation, FIT and INTENT unchanged.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {runSignalDiscovery} from '../src/signal-discovery/service.ts';
import {FixtureSignalSearchProvider} from '../src/signal-discovery/provider.ts';
import {scoreIntent} from '../src/domain/intent.ts';
import {DEFAULT_CRITERIA,scoreProspect} from '../src/domain/core.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
const count=async(q,p=[])=>Number((await sql(q,p)).rows[0].n);
const F=JSON.parse(await readFile(new URL('./fixtures/signal-discovery/6xpos-chr-occitanie.json',import.meta.url),'utf8'));
const ALL=Object.values(F.hits);
// The fixtures are dated around 2026-10-13: the P1 pipeline runs at that date.
const P1_NOW=new Date('2026-10-13T10:00:00Z');

// The repository, as src/signal-discovery/repository.ts calls the database: same functions, same arguments, same roles.
function pgRepo(user,o={}){
 return {
  async start(i,provider){return (await as(user,'select public.start_signal_discovery($1,$2,$3,$4::jsonb,$5,$6) r',[i.project_id,i.query,i.location,JSON.stringify(i.signal_types),provider,i.max_results])).rows[0].r},
  async saveCandidates(run,rows){if(o.failSave)throw Error('DATABASE_REQUEST_FAILED');return (await service('select public.save_signal_discovery_candidates($1,$2,$3::jsonb) r',[user,run,JSON.stringify(rows)])).rows[0].r},
  async complete(run,status,metrics,error){return (await service('select public.complete_signal_discovery_run($1,$2,$3::jsonb,$4) r',[run,status,JSON.stringify(metrics),error])).rows[0].r},
  async release(run){return (await service('select public.release_failed_signal_discovery($1) r',[run])).rows[0].r},
 };
}

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 for(const f of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const A='00000000-0000-4000-8000-0000000000a1';
 await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,'a@t',now())`,[A]);
 await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000');
 await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days')`,[A]);
 const oa=(await as(A,`select public.create_organization('Org') id`)).rows[0].id;
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'6XPOS') returning id`,[oa])).rows[0].id;
 const input={project_id:pa,query:'restaurant',location:'Occitanie',categories:['restauration rapide','snack','coffee shop','café','fast-food','brasserie','boulangerie'],signal_types:['new_site','expansion'],max_results:20};
 // Billed like a Brave run (the fixture provider is free by design): the provider reports itself as 'brave' here so
 // the unit is billable and the refund visible on the ledger. No network: its answers are scripted.
 const billedProvider=(hits,script)=>Object.assign(new FixtureSignalSearchProvider(hits,script),{id:'brave'});
 const go=(provider,o)=>runSignalDiscovery(input,{repo:pgRepo(A,o),provider,now:()=>P1_NOW});
 const unit=async run=>(await sql('select u.billable from prospectos_private.discovery_quota_usage u join public.signal_discovery_runs r on r.quota_usage_id=u.id where r.id=$1',[run])).rows[0].billable;
 const runRow=async id=>(await sql('select status,error_code,metrics from public.signal_discovery_runs where id=$1',[id])).rows[0];
 const down=c=>Error(c);

 let okRun;
 await check('RUN completed: metrics stored (sent, answered, results, saved); candidates saved field for field; unit billed',async()=>{
  okRun=await go(billedProvider(ALL));
  assert.equal(okRun.status,'completed');
  const r=await runRow(okRun.run_id);assert.equal(r.status,'completed');
  assert.deepEqual([r.metrics.requests_sent,r.metrics.requests_answered,r.metrics.requests_failed],[3,3,0]);
  assert.equal(r.metrics.saved,okRun.metrics.candidates+okRun.metrics.out_of_icp);
  assert.equal(await count('select count(*) n from public.signal_discovery_candidates where run_id=$1',[okRun.run_id]),r.metrics.saved);
  assert.equal(await unit(okRun.run_id),true);
  assert.equal(await count(`select count(*) n from public.signal_discovery_candidates where run_id=$1 and (source_type<>'search_snippet' or observed_on_page)`,[okRun.run_id]),0);
  const n=(await sql(`select entity_name,event_date_text,event_tense,location_text,review_tier from public.signal_discovery_candidates where run_id=$1 and source_url=$2`,[okRun.run_id,F.hits.future_opening_resolved.url])).rows[0];
  assert.deepEqual(n,{entity_name:'Napolino',event_date_text:'décembre 2026',event_tense:'FUTURE',location_text:'Toulouse',review_tier:1});
 });
 await check('A — 3 requests fail: failed PROVIDER_UNAVAILABLE, answered 0, unit refunded on the ledger',async()=>{
  const r=await go(billedProvider([],[down('BRAVE_HTTP_503'),down('BRAVE_TIMEOUT'),down('BRAVE_NETWORK_ERROR')]));
  assert.deepEqual([r.status,r.error_code,r.refunded],['failed','PROVIDER_UNAVAILABLE',true]);
  const row=await runRow(r.run_id);assert.deepEqual([row.status,row.error_code,row.metrics.requests_sent,row.metrics.requests_answered],['failed','PROVIDER_UNAVAILABLE',3,0]);
  assert.equal(await unit(r.run_id),false);
 });
 await check('B — 1 answer + 2 errors: completed, answered 1, unit billed',async()=>{
  const r=await go(billedProvider([],[[F.hits.future_opening_resolved],down('BRAVE_HTTP_500'),down('BRAVE_TIMEOUT')]));
  assert.deepEqual([r.status,r.refunded,(await runRow(r.run_id)).metrics.requests_answered],['completed',false,1]);assert.equal(await unit(r.run_id),true);
 });
 await check('C — valid answers, zero results: completed, unit billed',async()=>{
  const r=await go(billedProvider([],[[],[],[]]));
  assert.deepEqual([r.status,r.refunded,r.metrics.results_received],['completed',false,0]);assert.equal(await unit(r.run_id),true);
 });
 await check('D — valid answers, zero candidate after extraction: completed, unit billed',async()=>{
  const r=await go(billedProvider(['editorial_fast_food_guide','opening_inscriptions','expansion_range'].map(id=>F.hits[id])));
  assert.deepEqual([r.status,r.refunded,r.metrics.candidates,r.metrics.out_of_icp],['completed',false,0,0]);assert.equal(await unit(r.run_id),true);
  assert.equal(await count('select count(*) n from public.signal_discovery_candidates where run_id=$1',[r.run_id]),0);
 });
 await check('E — storage failure after answers: failed PERSISTENCE_FAILED (never completed), unit billed, refund refused even if asked',async()=>{
  const r=await go(billedProvider(ALL),{failSave:true});
  assert.deepEqual([r.status,r.error_code,r.refunded],['failed','PERSISTENCE_FAILED',false]);
  assert.deepEqual([(await runRow(r.run_id)).status,(await runRow(r.run_id)).error_code],['failed','PERSISTENCE_FAILED']);
  assert.equal(await unit(r.run_id),true);
  assert.equal((await service('select public.release_failed_signal_discovery($1) r',[r.run_id])).rows[0].r,false,'the database refuses it too: requests were answered');
 });
 await check('FIXTURE run (provider fixture): free unit, still a real run',async()=>{
  const r=await go(new FixtureSignalSearchProvider(ALL));assert.equal(r.status,'completed');assert.equal(await unit(r.run_id),false);
 });
 await check('ADD → PENDING_REVIEW signal; INTENT verified unchanged before review_signal; FIT unchanged; no evidence, no observation',async()=>{
  const c=(await sql('select id from public.signal_discovery_candidates where run_id=$1 and source_url=$2',[okRun.run_id,F.hits.future_opening_resolved.url])).rows[0];
  const added=(await as(A,'select public.add_signal_candidate_to_project($1,null,null,null) r',[c.id])).rows[0].r;
  const signals=(await sql('select * from public.signals where prospect_id=$1',[added.prospect_id])).rows;
  assert.deepEqual(signals.map(s=>[s.status,s.provider,s.source_type,s.event_date]),[['PENDING_REVIEW','discovery_recycled','search_snippet',null]]);
  const asIntent=s=>({id:s.id,signal_type:s.signal_type,status:s.status,title:s.title,excerpt:s.excerpt,source_url:s.source_url,source_domain:s.source_domain,confidence:Number(s.confidence),
   event_date:s.event_date,published_at:s.published_at?new Date(s.published_at).toISOString():null,observed_at:new Date(s.observed_at).toISOString(),matched_terms:s.matched_terms});
  const now=new Date();
  assert.equal(scoreIntent(signals.map(asIntent),null,now).score,0,'verified INTENT stays 0 while PENDING_REVIEW');
  const evidence=(await sql('select * from public.evidence where prospect_id=$1',[added.prospect_id])).rows;
  assert.deepEqual(evidence,[]);assert.equal(scoreProspect(DEFAULT_CRITERIA,evidence,now).score,scoreProspect(DEFAULT_CRITERIA,[],now).score,'FIT unchanged');
  assert.equal(await count('select count(*) n from public.evidence'),0);assert.equal(await count('select count(*) n from public.prospect_observations'),0);
  // Only a person's review makes it count.
  await as(A,`select public.review_signal($1,'verify',null)`,[signals[0].id]);
  const after=(await sql('select * from public.signals where prospect_id=$1',[added.prospect_id])).rows.map(asIntent);
  assert.equal(after[0].status,'VERIFIED');assert.equal(scoreIntent(after,null,now).lines.length,1);
 });
 await check('IGNORE through the 030 function: NEW → IGNORED, nothing else created',async()=>{
  const c=(await sql(`select id from public.signal_discovery_candidates where run_id=$1 and status='NEW' limit 1`,[okRun.run_id])).rows[0];
  const before=[await count('select count(*) n from public.prospects'),await count('select count(*) n from public.signals')];
  assert.equal((await as(A,'select public.ignore_signal_candidate($1) r',[c.id])).rows[0].r.status,'IGNORED');
  assert.deepEqual([await count('select count(*) n from public.prospects'),await count('select count(*) n from public.signals')],before);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}finally{await db.close()}
for(const [n,s,d] of results)console.log(`${s}  ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');console.log(`\nSIGNAL DISCOVERY SERVICE DB: ${results.length-failed.length}/${results.length} checks passed`);if(failed.length)process.exit(1);
