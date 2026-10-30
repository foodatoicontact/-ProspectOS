// Migration 038 — Signaux SIRENE: runs, candidates, RLS, the shared Discovery quota and its refund, the strict server
// save (sources and confidence per field, no Google content), immutability, ignore, add-to-project, the register cache
// (register pages only), purge, and the post-migration check. Real PostgreSQL (PGlite) with the full migration chain.
// The candidates are the EXACT stored rows of the module (src/registry-signals: buildSignal → toStoredSignal →
// toCandidateRow) — no second representation.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildSignal,toStoredSignal} from '../src/registry-signals/signal.ts';
import {toCandidateRow} from '../src/registry-signals/row.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg})`)}
const count=async(q,p=[])=>Number((await sql(q,p)).rows[0].n);

const NOW=new Date();const today=NOW.toISOString().slice(0,10);
const est=(o={})=>({siren:'123456789',siret:'12345678900011',denomination:'SAS GOURMET 33',names:['SAS GOURMET 33','LA TABLE DU HAILLAN'],signs:['LA TABLE DU HAILLAN'],
 activite_principale:'56.10A',date_creation:today,date_creation_entreprise:today,adresse:'12 AVENUE DE MAGUDAS 33185 LE HAILLAN',code_postal:'33185',commune:'LE HAILLAN',
 est_siege:true,source_url:'https://annuaire-entreprises.data.gouv.fr/etablissement/12345678900011',registry_url:'https://annuaire-entreprises.data.gouv.fr/entreprise/123456789',...o});
const confirmed={status:'confirme',reason:'NAME_AND_ADDRESS_MATCH',queries:[],failure:null,place:{id:'ChIJ_table_haillan',name:'La Table du Haillan',formattedAddress:null,
 postalCode:'33185',streetNumber:'12',route:'Avenue de Magudas',businessStatus:'OPERATIONAL',rating:4.6,ratingCount:38,website:'https://latable.example',openingHours:['lundi: Fermé'],mapsUrl:'https://maps.google.com/?cid=1'}};
const row=(o={},google=confirmed)=>({...toCandidateRow(toStoredSignal(buildSignal(est(o),google,[],NOW)))});

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('038_registry_signals.sql'),'migration 038 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000');
 for(const u of [A,B])await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days')`,[u]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const project=async(u,o)=>(await as(u,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[o])).rows[0].id;
 const pa=await project(A,oa),pa2=await project(A,oa),pb=await project(B,ob);
 const otherProspect=(await as(A,`insert into public.prospects(organization_id,project_id,name) values($1,$2,'Autre projet') returning id`,[oa,pa2])).rows[0].id;

 const start=async(u,p,o={})=>(await as(u,'select public.start_registry_signal_run($1,$2,$3,$4) r',[p,o.preset??'commerce_ouverture',o.cp??'33185',o.max??20])).rows[0].r;
 const save=async(u,run,items)=>(await service('select public.save_registry_signal_candidates($1,$2,$3::jsonb) r',[u,run,JSON.stringify(items)])).rows[0].r;
 const cand=async(run,siret)=>(await sql('select * from public.registry_signal_candidates where run_id=$1 and siret=$2',[run,siret])).rows[0];
 const usage=async u=>count(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery'`,[u]);
 const complete=(run,status,metrics)=>service('select public.complete_registry_signal_run($1,$2,$3::jsonb,null) r',[run,status,JSON.stringify(metrics)]).then(r=>r.rows[0].r);
 const release=run=>service('select public.release_failed_registry_signal_run($1) r',[run]).then(r=>r.rows[0].r);

 let run;
 await check('START: a member starts a run on their project; one Discovery unit, tied to the run',async()=>{
  const before=await usage(A);run=await start(A,pa);
  assert.equal(run.status,'running');assert.equal(run.preset,'commerce_ouverture');assert.equal(run.postal_code,'33185');assert.equal(await usage(A),before+1);
  assert.equal((await sql('select billable from prospectos_private.discovery_quota_usage where id=$1',[run.quota_usage_id])).rows[0].billable,true);
 });
 await check('START refused: another organization’s project, an invalid postal code or preset, anonymous',async()=>{
  await refused(()=>start(B,pa),/member|permission|denied/i,'B starts on A’s project');
  await refused(()=>start(A,pa,{cp:'3318'}),/Invalid registry signal input/,'4-digit postal code');
  await refused(()=>start(A,pa,{preset:'DROP TABLE'}),/Invalid registry signal input/,'preset');
  await refused(()=>start(A,pa,{max:51}),/Invalid registry signal input/,'max_results');
  await refused(()=>start(undefined,pa),/permission|denied|member/i,'anon');
 });
 await check('SAVE: the module’s stored rows are accepted as is, for the member who launched the run; duplicates by SIRET',async()=>{
  const r=await save(A,run.id,[row(),row({siren:'987654321',siret:'98765432100015',denomination:'COIFF ET VOUS',signs:[],names:['COIFF ET VOUS'],activite_principale:'96.02A'},
   {status:'non_confirme',reason:'ADDRESS_MISMATCH',place:null,queries:[],failure:null})]);
  assert.deepEqual(r,{inserted:2,duplicates:0});
  assert.deepEqual(await save(A,run.id,[row()]),{inserted:0,duplicates:1});
  const c=await cand(run.id,'12345678900011');
  assert.equal(c.status,'NEW');assert.equal(c.google_place_id,'ChIJ_table_haillan');assert.equal(c.google_match_status,'confirme');assert.deepEqual(c.enseignes,['LA TABLE DU HAILLAN']);
  assert.equal(c.confidence.siren,'verifie');assert.equal(c.confidence['google.statut_match'],'estime');
  assert.ok(c.sources.date_creation.every(u=>u.startsWith('https://annuaire-entreprises.data.gouv.fr/')));
  assert.equal(c.sources['google.place_id'][0],'https://www.google.com/maps/place/?q=place_id:ChIJ_table_haillan');
  assert.doesNotMatch(JSON.stringify(c),/latable\.example|lundi|"note"|nb_avis/,'no Google content in the database');
  assert.equal((await cand(run.id,'98765432100015')).google_place_id,null);
 });
 await check('SAVE refused: unknown field, Google content, a register field without source, a non-https source, a doubt with a place ID, another postal code',async()=>{
  const fresh=await start(A,pa);
  await refused(()=>save(A,fresh.id,[{...row(),note:4.6}]),/Unknown candidate field/,'note');
  await refused(()=>save(A,fresh.id,[{...row(),sources:{...row().sources,'google.note':['https://maps.google.com/?cid=1']}}]),/Invalid candidate sources/,'google.note source');
  const noSource={...row().sources};delete noSource.date_creation;
  await refused(()=>save(A,fresh.id,[{...row(),sources:noSource}]),/Invalid candidate sources/,'date_creation without source');
  await refused(()=>save(A,fresh.id,[{...row(),sources:{...row().sources,siren:['http://annuaire-entreprises.data.gouv.fr/entreprise/123456789']}}]),/Invalid candidate sources/,'http');
  await refused(()=>save(A,fresh.id,[{...row(),confidence:{...row().confidence,siren:'certain'}}]),/Invalid candidate confidence/,'confidence word');
  await refused(()=>save(A,fresh.id,[{...row(),google_match_status:'non_confirme'}]),/check constraint|violates/i,'place ID on a doubt');
  await refused(()=>save(A,fresh.id,[{...row(),code_postal:'33700'}]),/Invalid candidate/,'other postal code');
  await refused(()=>save(A,fresh.id,[{...row(),date_creation:'2999-01-01'}]),/Invalid candidate date/,'future');
  await refused(()=>save(B,fresh.id,[row()]),/tenant member/,'B saves into A’s run');
  await refused(()=>as(A,'select public.save_registry_signal_candidates($1,$2,$3::jsonb)',[A,fresh.id,JSON.stringify([row()])]),/permission denied/i,'a member calls the server function');
 });
 await check('RLS: members read their organization’s runs and candidates; nobody writes directly; the cache is unreadable',async()=>{
  assert.equal(Number((await as(A,'select count(*) n from public.registry_signal_candidates where run_id=$1',[run.id])).rows[0].n),2);
  assert.equal(Number((await as(B,'select count(*) n from public.registry_signal_candidates where run_id=$1',[run.id])).rows[0].n),0);
  assert.equal(Number((await as(B,'select count(*) n from public.registry_signal_runs where id=$1',[run.id])).rows[0].n),0);
  await refused(()=>as(A,`update public.registry_signal_candidates set status='ADDED' where run_id=$1`,[run.id]),/permission denied/i,'direct update');
  await refused(()=>as(A,'insert into public.registry_signal_candidates(run_id) values($1)',[run.id]),/permission denied/i,'direct insert');
  await refused(()=>as(A,'select * from public.registry_signal_cache'),/permission denied/i,'member reads the cache');
 });
 await check('IMMUTABLE: found content never changes, even for the server; a decision only through ignore / add',async()=>{
  await refused(()=>service(`update public.registry_signal_candidates set denomination='X' where run_id=$1`,[run.id]),/immutable once found/,'content change');
  await refused(()=>service(`update public.registry_signal_candidates set status='IGNORED' where run_id=$1`,[run.id]),/only through ignore or add/,'status without decision');
 });
 await check('IGNORE: NEW → IGNORED once, by a member; an ignored signal cannot be added',async()=>{
  const c=await cand(run.id,'98765432100015');
  await refused(()=>as(B,'select public.ignore_registry_signal_candidate($1)',[c.id]),/member|permission/i,'B ignores');
  const r=(await as(A,'select public.ignore_registry_signal_candidate($1) r',[c.id])).rows[0].r;assert.equal(r.status,'IGNORED');assert.equal(r.decided_by,A);
  assert.equal((await as(A,'select public.ignore_registry_signal_candidate($1) r',[c.id])).rows[0].r.status,'IGNORED');
  await refused(()=>as(A,'select public.add_registry_signal_candidate_to_project($1)',[c.id]),/CANDIDATE_IGNORED/,'add after ignore');
 });
 await check('ADD: a person’s decision creates the prospect (sign as name, commune as city, no website); idempotent; event logged',async()=>{
  const c=await cand(run.id,'12345678900011');
  await refused(()=>as(A,'select public.add_registry_signal_candidate_to_project($1,null,$2)',[c.id,otherProspect]),/Prospect not found/,'prospect of another project');
  const r=(await as(A,'select public.add_registry_signal_candidate_to_project($1) r',[c.id])).rows[0].r;
  assert.equal(r.created_prospect,true);
  const p=(await sql('select * from public.prospects where id=$1',[r.prospect_id])).rows[0];
  assert.deepEqual([p.name,p.city,p.website,p.status,p.project_id],['LA TABLE DU HAILLAN','Le Haillan',null,'À analyser',pa]);
  assert.equal((await as(A,'select public.add_registry_signal_candidate_to_project($1) r',[c.id])).rows[0].r.already_added,true);
  assert.equal((await cand(run.id,'12345678900011')).status,'ADDED');
  assert.equal(await count(`select count(*) n from public.events where kind='registry_signal.added' and prospect_id=$1`,[r.prospect_id]),1);
  for(const t of ['signals','evidence','prospect_observations'])assert.equal(await count(`select count(*) n from public.${t}`),0,`${t}: nothing but the prospect`);
 });
 await check('REFUND: only a failed run whose register answered nothing, once; never a completed run',async()=>{
  const failed=await start(A,pa);
  assert.equal(await complete(failed.id,'failed',{requests_answered:0}),true);
  assert.equal(await release(failed.id),true);assert.equal(await release(failed.id),false,'once');
  assert.equal((await sql('select billable from prospectos_private.discovery_quota_usage where id=$1',[failed.quota_usage_id])).rows[0].billable,false);
  const answered=await start(A,pa);await complete(answered.id,'failed',{requests_answered:2});assert.equal(await release(answered.id),false);
  assert.equal(await complete(run.id,'completed',{requests_answered:1}),true);assert.equal(await release(run.id),false);
  await refused(()=>save(A,run.id,[row({siret:'12345678900029'})]),/not running/,'save into a closed run');
 });
 await check('CACHE: register pages only, server only, purged when expired',async()=>{
  const key='sirene:'+'a'.repeat(64);
  await service(`insert into public.registry_signal_cache(key,payload,expires_at) values($1,'{"results":[]}',now()-interval '1 minute')`,[key]);
  await refused(()=>service(`insert into public.registry_signal_cache(key,payload,expires_at) values($1,'{}',now()+interval '1 hour')`,['places:'+'b'.repeat(64)]),/check constraint|violates/i,'Google key');
  const purged=(await service('select public.purge_registry_signals() r')).rows[0].r;assert.equal(purged.cache,1);
 });
 await check('POST-MIGRATION CHECK (db/migrations/checks/038) passes',async()=>{
  await db.exec(await readFile(new URL('../db/migrations/checks/038_registry_signals.sql',import.meta.url),'utf8'));
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,d] of results)console.log(`${s} ${n}${d?` — ${d}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS');
console.log(`\n${results.length-failed.length}/${results.length} passed`);
if(failed.length)process.exit(1);
