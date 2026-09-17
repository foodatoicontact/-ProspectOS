// PostgreSQL integration coverage for the incremental discovery migration.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ObservationService } from '../src/discovery/observations.ts';
import { FIXTURE_HTML } from '../src/discovery/providers/fixture.ts';
import { FOODATOI_CRITERIA, scoreProspect } from '../src/domain/core.ts';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../db/migrations/002_discovery.sql', import.meta.url), 'utf8');
const migrationGeneric = await readFile(new URL('../db/migrations/003_discovery_generic_criteria.sql', import.meta.url), 'utf8');

async function sql(text, params = []) { return db.query(text, params); }
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
async function rejects(operation, pattern) {
  await assert.rejects(operation, error => pattern.test(String(error?.message)));
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(schema);
  await db.exec(migration);
  await db.exec(migrationGeneric);

  const A = '00000000-0000-4000-8000-000000000001';
  const B = '00000000-0000-4000-8000-000000000002';
  const OA = '10000000-0000-4000-8000-000000000001';
  const OB = '10000000-0000-4000-8000-000000000002';
  const PA = '20000000-0000-4000-8000-000000000001';
  const PB = '20000000-0000-4000-8000-000000000002';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA,A,OB,B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA,A,OB,B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'A project'),($3,$4,'B project')`, [PA,OA,PB,OB]);
  // A's ICP is Foodatoi's own criteria — the generic engine must keep serving it from this real ICP, not a hardcoded fallback.
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [PA,OA,JSON.stringify(FOODATOI_CRITERIA)]);

  const runA = (await as(A, `select public.start_discovery($1,'restaurants','Toulouse','["food"]','fixture',2,'{}') run`, [PA])).rows[0].run;
  const runB = (await as(B, `select public.start_discovery($1,'restaurants','Albi','[]','fixture',2,'{}') run`, [PB])).rows[0].run;
  assert.equal(runA.organization_id, OA);
  assert.equal(runA.filters_json.max_results, 2);
  assert.equal((await as(A, 'select * from public.discovery_runs order by id')).rows.length, 1);
  assert.equal((await as(B, 'select * from public.discovery_runs order by id')).rows.length, 1);
  await rejects(as(A, `select public.start_discovery($1,'restaurants','Albi','[]','fixture',1,'{}')`, [PB]), /tenant member/i);
  await rejects(as(undefined, `select public.start_discovery($1,'restaurants','Albi','[]','fixture',1,'{}')`, [PA]), /permission denied/i);

  const resultId = '30000000-0000-4000-8000-000000000001';
  const payload = {name:'Café Test',website:'https://cafe.example',city:'Toulouse'};
  await as(A, `insert into public.discovery_results
    (id,organization_id,project_id,discovery_run_id,company_name,website,phone,city,source_url,source_title,provider,raw_payload,normalized_payload,dedupe_key,dedupe_status)
    values($1,$2,$3,$4,'Café Test','https://cafe.example','05 61 00 00 00','Toulouse','https://directory.example/cafe','Listing','fixture','{}',$5,'domain:cafe.example|toulouse','unique')`,
    [resultId,OA,PA,runA.id,JSON.stringify(payload)]);
  await rejects(as(A, `insert into public.discovery_results
    (organization_id,project_id,discovery_run_id,company_name,source_url,provider,dedupe_key,dedupe_status)
    values($1,$2,$3,'Bad','https://example.test','fixture','bad','unique')`, [OA,PA,runB.id]), /foreign key/i);

  const accepted = (await as(A, `select public.accept_discovery_result($1,false) prospect`, [resultId])).rows[0].prospect;
  assert.equal(accepted.website, 'https://cafe.example');
  assert.equal(accepted.city, 'Toulouse');
  assert.equal(accepted.status, 'À analyser');
  const acceptedAgain = (await as(A, `select public.accept_discovery_result($1,false) prospect`, [resultId])).rows[0].prospect;
  assert.equal(acceptedAgain.id, accepted.id);
  assert.equal(Number((await sql(`select count(*) n from public.prospects where id=$1`,[accepted.id])).rows[0].n), 1);
  const channel = (await sql(`select * from public.channels where prospect_id=$1`,[accepted.id])).rows[0];
  assert.equal(channel.kind, 'phone'); assert.equal(channel.verified, false);
  await rejects(as(B, `select public.accept_discovery_result($1,false)`, [resultId]), /tenant member/i);

  const now = new Date().toISOString(), expires = new Date(Date.now()+86400000).toISOString();
  const observations = [
    {criterion:'food',observation_type:'FOOD_ACTIVITY',claim:'Restaurant mentionné',value:true,status:'OBSERVED',source_url:'https://cafe.example/menu',source_title:'Menu',source_excerpt:'Notre restaurant sert des burgers.',source_type:'official_website',confidence:.85,collected_at:now,expires_at:expires,content_hash:'hash-food'},
    {criterion:'audience',observation_type:'SOCIAL_SIGNALS',claim:'Information absente',value:null,status:'UNKNOWN',source_url:'https://cafe.example/menu',source_title:'Menu',source_excerpt:'',source_type:'official_website',confidence:0,collected_at:now,expires_at:expires,content_hash:'hash-unknown'}
  ];
  const saved = (await as(A, `select public.save_discovery_observations($1,$2::jsonb) rows`,[accepted.id,JSON.stringify(observations)])).rows[0].rows;
  assert.equal(saved.length,2);
  assert.equal(saved[0].review_status,'NOT_VERIFIED'); assert.ok(saved[0].evidence_id);
  assert.equal(saved[1].evidence_id,null); assert.equal(saved[1].confidence,0);
  let evidence = (await sql(`select * from public.evidence where id=$1`,[saved[0].evidence_id])).rows[0];
  assert.equal(evidence.status,'NOT_VERIFIED'); assert.equal(evidence.verified_by,null);

  const repeated = (await as(A, `select public.save_discovery_observations($1,$2::jsonb) rows`,[accepted.id,JSON.stringify(observations)])).rows[0].rows;
  assert.equal(repeated[0].id,saved[0].id); assert.equal(repeated[0].evidence_id,saved[0].evidence_id);
  assert.equal(Number((await sql(`select count(*) n from public.prospect_observations where prospect_id=$1`,[accepted.id])).rows[0].n),2);
  assert.equal(Number((await sql(`select count(*) n from public.evidence where prospect_id=$1`,[accepted.id])).rows[0].n),1);
  const extracted = new ObservationService().extract(FIXTURE_HTML,'https://analysis.fixture.example',FOODATOI_CRITERIA,'test_fixture',new Date(now));
  const phoneRaw = extracted.find(row=>row.observation_type==='PHONE_RAW');
  assert.ok(phoneRaw); assert.equal(phoneRaw.criterion,null); assert.equal(phoneRaw.value,null);
  extracted.push({...phoneRaw,observation_type:'OTHER_DELIVERY_PLATFORM',claim:'Autre plateforme contextuelle',source_excerpt:'Just Eat',content_hash:'hash-other-platform'});
  const extractedSaved = (await as(A, `select public.save_discovery_observations($1,$2::jsonb) rows`,[accepted.id,JSON.stringify(extracted)])).rows[0].rows;
  assert.equal(extractedSaved.length,extracted.length);
  for (const type of ['PHONE_RAW','OTHER_DELIVERY_PLATFORM']) {
    const contextual = extractedSaved.find(row=>row.observation_type===type);
    assert.ok(contextual); assert.equal(contextual.evidence_id,null); assert.equal(contextual.review_status,'NOT_VERIFIED');
  }
  const invalid = [{...observations[0],observation_type:'BAD_EXCERPT',source_excerpt:'',content_hash:'bad'}];
  await rejects(as(A,`select public.save_discovery_observations($1,$2::jsonb)`,[accepted.id,JSON.stringify(invalid)]),/Evidence fields required/i);
  await rejects(as(B,`select public.save_discovery_observations($1,$2::jsonb)`,[accepted.id,JSON.stringify(observations)]),/tenant member/i);
  await rejects(as(A,`select public.review_discovery_observation($1,'confirm')`,[saved[1].id]),/cannot be confirmed/i);
  const prospectB = '40000000-0000-4000-8000-000000000002';
  const evidenceB = '50000000-0000-4000-8000-000000000002';
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[B]);
  await sql(`insert into public.prospects(id,organization_id,project_id,name) values($1,$2,$3,'B prospect')`,[prospectB,OB,PB]);
  await sql(`insert into public.evidence(id,organization_id,prospect_id,criterion,value,status,source_url,excerpt)
    values($1,$2,$3,'food',true,'NOT_VERIFIED','https://b.example','B')`,[evidenceB,OB,prospectB]);
  await rejects(sql(`insert into public.prospect_observations
    (organization_id,prospect_id,criterion,observation_type,claim,value,status,source_url,source_title,source_excerpt,source_type,confidence,collected_at,expires_at,content_hash,evidence_id)
    values($1,$2,'food','CROSS','cross',true,'OBSERVED','https://cafe.example','x','x','test_fixture',1,now(),now()+interval '1 day','cross',$3)`,
    [OA,accepted.id,evidenceB]),/foreign key/i);

  await as(A,`select public.review_discovery_observation($1,'confirm')`,[saved[0].id]);
  evidence=(await sql(`select * from public.evidence where id=$1`,[saved[0].evidence_id])).rows[0];
  assert.equal(evidence.status,'VERIFIED'); assert.equal(evidence.verified_by,A);
  assert.equal(scoreProspect(FOODATOI_CRITERIA,[evidence],new Date()).score,15);
  await as(A,`select public.review_discovery_observation($1,'contradict')`,[saved[0].id]);
  evidence=(await sql(`select * from public.evidence where id=$1`,[saved[0].evidence_id])).rows[0];
  assert.equal(evidence.status,'CONTRADICTED');
  assert.equal(scoreProspect(FOODATOI_CRITERIA,[evidence],new Date()).score,0);
  await as(A,`select public.review_discovery_observation($1,'unverify')`,[saved[0].id]);
  evidence=(await sql(`select * from public.evidence where id=$1`,[saved[0].evidence_id])).rows[0];
  assert.equal(evidence.status,'NOT_VERIFIED'); assert.equal(evidence.verified_by,null);
  assert.deepEqual((await sql(`select kind from public.events where kind like 'observation.%' order by created_at`)).rows.map(x=>x.kind),['observation.confirm','observation.contradict','observation.unverify']);

  await sql(`update prospectos_private.discovery_quota_settings set runs_per_hour=1,analyses_per_hour=1`);
  await sql(`delete from prospectos_private.discovery_quota_usage`);
  await as(A,`select public.start_discovery($1,'pizza','Toulouse','[]','fixture',1,'{}')`,[PA]);
  await rejects(as(A,`select public.start_discovery($1,'pizza','Toulouse','[]','fixture',1,'{}')`,[PA]),/quota_exceeded/i);
  await as(A,`select public.consume_analysis_quota($1)`,[accepted.id]);
  await rejects(as(A,`select public.consume_analysis_quota($1)`,[accepted.id]),/quota_exceeded/i);
  await rejects(as(B,`select public.consume_analysis_quota($1)`,[accepted.id]),/tenant member/i);
  await rejects(as(undefined,`select public.review_discovery_observation($1,'confirm')`,[saved[0].id]),/permission denied/i);

  // --- Generic multi-sector ICP: B gets its own, non-restaurant, ICP — no vertical leaks across projects ---
  const SAAS_CRITERIA = [
    {key:'target_fit',label:'Correspond à la cible définie',weight:25},
    {key:'need_fit',label:'Besoin correspondant à l’offre',weight:30},
    {key:'commercial_signal',label:'Signal commercial observable',weight:25},
    {key:'contactability',label:'Canal de contact professionnel documenté',weight:20}
  ];
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[B]);
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [PB,OB,JSON.stringify(SAAS_CRITERIA)]);
  const prospectSaas = '40000000-0000-4000-8000-000000000003';
  await sql(`insert into public.prospects(id,organization_id,project_id,name) values ($1,$2,$3,'SaaS prospect')`, [prospectSaas,OB,PB]);
  const saasObservation = [{criterion:'commercial_signal',observation_type:'GENERIC_KEYWORD_MATCH',claim:'Mention en lien avec le critère',value:true,status:'OBSERVED',source_url:'https://saas.example',source_title:'Accueil',source_excerpt:'Nous documentons un signal commercial observable ici.',source_type:'official_website',confidence:.5,collected_at:now,expires_at:expires,content_hash:'hash-saas-ok'}];
  const savedSaas = (await as(B, `select public.save_discovery_observations($1,$2::jsonb) rows`,[prospectSaas,JSON.stringify(saasObservation)])).rows[0].rows;
  assert.equal(savedSaas.length,1); assert.ok(savedSaas[0].evidence_id);
  // A criterion foreign to this ICP (Foodatoi's own 'food') is rejected outright — never silently accepted.
  const foreignObservation = [{criterion:'food',observation_type:'FOOD_ACTIVITY',claim:'x',value:true,status:'OBSERVED',source_url:'https://saas.example',source_title:'Accueil',source_excerpt:'x',source_type:'official_website',confidence:.5,collected_at:now,expires_at:expires,content_hash:'hash-saas-foreign'}];
  await rejects(as(B,`select public.save_discovery_observations($1,$2::jsonb)`,[prospectSaas,JSON.stringify(foreignObservation)]),/Evidence fields required/i);

  // --- A project with no ICP row at all gets zero usable criteria — never a Foodatoi fallback ---
  const orphanProjectId = '20000000-0000-4000-8000-000000000009';
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Orphan project')`, [orphanProjectId,OB]);
  const orphanProspect = '40000000-0000-4000-8000-000000000004';
  await sql(`insert into public.prospects(id,organization_id,project_id,name) values ($1,$2,$3,'Orphan prospect')`, [orphanProspect,OB,orphanProjectId]);
  await rejects(as(B,`select public.save_discovery_observations($1,$2::jsonb)`,[orphanProspect,JSON.stringify([{...foreignObservation[0],content_hash:'hash-orphan-food'}])]),/Evidence fields required/i);
  // Criterion-less contextual observations (e.g. a raw phone number) still work without any ICP.
  const contextualOnly = [{criterion:null,observation_type:'PHONE_RAW',claim:'Numéro public présent',value:null,status:'OBSERVED',source_url:'https://saas.example',source_title:'Accueil',source_excerpt:'0500000009',source_type:'official_website',confidence:.9,collected_at:now,expires_at:expires,content_hash:'hash-orphan-phone'}];
  const orphanSaved = (await as(B,`select public.save_discovery_observations($1,$2::jsonb) rows`,[orphanProspect,JSON.stringify(contextualOnly)])).rows[0].rows;
  assert.equal(orphanSaved.length,1); assert.equal(orphanSaved[0].evidence_id,null);

  console.log('PASS: discovery lifecycle, scoring, tenant isolation, FK integrity, idempotency, validation, quotas, RPC grants, and generic multi-sector ICP handling');
} finally {
  await db.close();
}
