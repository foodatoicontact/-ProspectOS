// PostgreSQL integration coverage for the incremental discovery migration.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ObservationService } from '../src/discovery/observations.ts';
import { FIXTURE_HTML, GENERIC_FIXTURE_COMPANIES, createCompositePageFetcher } from '../src/discovery/providers/fixture.ts';
import { CompanyAnalysisService } from '../src/discovery/services.ts';
import { toStorageSafeObservation } from '../src/discovery/repository.ts';
import { FOODATOI_CRITERIA, scoreProspect, safeLink } from '../src/domain/core.ts';

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

  // --- Contradict never grants any positive point, even for a criterion that had a real, non-null value ---
  await as(B,`select public.review_discovery_observation($1,'contradict')`,[savedSaas[0].id]);
  const contradictedEvidence = (await sql(`select * from public.evidence where id=$1`,[savedSaas[0].evidence_id])).rows[0];
  assert.equal(contradictedEvidence.status,'CONTRADICTED');
  assert.equal(scoreProspect(SAAS_CRITERIA,[{criterion:contradictedEvidence.criterion,value:contradictedEvidence.value,status:contradictedEvidence.status,source_url:contradictedEvidence.source_url,excerpt:contradictedEvidence.excerpt,observed_at:contradictedEvidence.observed_at,verified_by:contradictedEvidence.verified_by}],new Date()).score,0,'a contradicted observation never grants a positive point');

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

  // --- Regression: "Analyser le site" on a fixture-accepted Test SaaS prospect (production bug) ---
  // A generic keyword candidate (status INFERRED, value null — see strategies/generic.ts) is a
  // non-conclusive proposal with no boolean to give it. save_discovery_observations rejects ANY
  // non-UNKNOWN observation carrying a real criterion but a null value ("Evidence fields required" —
  // proven raw below): it is only designed for UNKNOWN (criterion + null value) or a criterion-less
  // contextual note (null criterion + null value). CompanyAnalysisService.analyze_company()'s catch
  // block turned that rejection into the generic ANALYSIS_FAILED ("Analyse impossible") shown in
  // production. A previous JS-level test (tests/fixture-analysis.test.ts) used a MemoryRepo whose
  // saveObservations() just stores the array in memory — it never runs this SQL validation, so it
  // could not have caught this. This block runs the real save_discovery_observations RPC, exactly as
  // production does, plus the exact CompanyAnalysisService/createCompositePageFetcher wiring used by
  // src/discovery/api.ts's "analyze" route (the real handler behind the "Analyser le site" button).
  const alpha = GENERIC_FIXTURE_COMPANIES.find(c => c.name.includes('Alpha'));
  const alphaProspectId = '40000000-0000-4000-8000-000000000005';
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[B]);
  await sql(`insert into public.prospects(id,organization_id,project_id,name,website,status) values ($1,$2,$3,$4,$5,'À analyser')`,[alphaProspectId,OB,PB,alpha.name,alpha.website]);

  // Alpha's own homepage no longer produces an ambiguous null-value candidate for its phone number
  // (contactability now resolves deterministically — see below), so a small crafted excerpt is used
  // here purely to keep proving the general contract: a raw, unprocessed GENERIC_KEYWORD_MATCH
  // candidate (a real criterion, a null value) is still rejected outright by the SQL function, which
  // is exactly why toStorageSafeObservation exists and why the real analyze_company path below always
  // goes through it.
  const genericCandidateHtml='<html><body><p>Nous suivons un signal commercial observable chaque trimestre.</p></body></html>';
  const rawExtraction=new ObservationService().extract(genericCandidateHtml,alpha.website,SAAS_CRITERIA,'test_fixture',new Date(now));
  assert.ok(rawExtraction.some(o=>o.observation_type==='GENERIC_KEYWORD_MATCH'&&o.status==='INFERRED'&&o.value===null&&o.criterion!==null));
  await rejects(as(B,`select public.save_discovery_observations($1,$2::jsonb)`,[alphaProspectId,JSON.stringify(rawExtraction)]),/Evidence fields required/i);

  function realRepoFor(actingUser){return {
   async prospect(id){return (await sql(`select id,website,organization_id,project_id from public.prospects where id=$1`,[id])).rows[0]},
   async projectCriteria(projectId){return (await sql(`select criteria from public.icps where project_id=$1`,[projectId])).rows[0]?.criteria??[]},
   async consumeAnalysis(id){await as(actingUser,`select public.consume_analysis_quota($1)`,[id])},
   async saveObservations(id,observations){return (await as(actingUser,`select public.save_discovery_observations($1,$2::jsonb) rows`,[id,JSON.stringify(observations.map(toStorageSafeObservation))])).rows[0].rows}
  }}
  let realNetworkCalls=0;
  const realFetcher=async url=>{realNetworkCalls++;throw Error('UNEXPECTED_REAL_FETCH: '+url)};
  const analyzeResult=await new CompanyAnalysisService(realRepoFor(B),createCompositePageFetcher(realFetcher)).analyze_company(alphaProspectId,'test_fixture');
  assert.equal(realNetworkCalls,0,'zero real network calls for a fixture prospect');
  assert.ok(analyzeResult.pages_analyzed>=1);
  const alphaObservations=(await sql(`select * from public.prospect_observations where prospect_id=$1`,[alphaProspectId])).rows;
  assert.ok(alphaObservations.length>0,'observations were actually persisted');
  assert.ok(alphaObservations.every(o=>o.review_status!=='VERIFIED'));
  // Whichever GENERIC_KEYWORD_MATCH (non-conclusive lexical guess) or UNKNOWN (absence-of-proof) rows
  // exist among these, none is ever linked to an evidence row — only a real, deterministic value can
  // be (the SQL-level contract for a null-value GENERIC_KEYWORD_MATCH is proven directly above).
  assert.ok(alphaObservations.filter(o=>o.observation_type==='GENERIC_KEYWORD_MATCH').every(o=>o.evidence_id===null));
  assert.ok(alphaObservations.filter(o=>o.status==='UNKNOWN').every(o=>o.evidence_id===null));
  let alphaEvidence=(await sql(`select * from public.evidence where prospect_id=$1`,[alphaProspectId])).rows;
  assert.ok(alphaEvidence.every(e=>e.status!=='VERIFIED'),'analyze_company never creates VERIFIED evidence on its own');
  assert.equal(scoreProspect(SAAS_CRITERIA,alphaEvidence.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at})),new Date()).score,0,'score stays 0 before any human review');

  // --- The real, non-hardcoded rule: the PHONE_RAW extracted from Alpha's own fixture page (via the
  // exact analyze_company/ObservationService pipeline above, not a hand-crafted observation) is what
  // proposed contactability as a candidate evidence — see strategies/contact-channel.ts.
  const contactObservations=alphaObservations.filter(o=>o.criterion==='contactability');
  assert.ok(contactObservations.length>0,'the real PHONE_RAW extraction proposed contactability on its own');
  const contactObservation=contactObservations[0];
  assert.equal(contactObservation.observation_type,'PHONE_RAW');
  assert.equal(contactObservation.value,true);
  assert.equal(contactObservation.status,'OBSERVED');
  assert.equal(contactObservation.review_status,'NOT_VERIFIED');
  assert.ok(contactObservation.evidence_id,'a real, non-null candidate did create an evidence row');

  await as(B,`select public.review_discovery_observation($1,'confirm')`,[contactObservation.id]);
  const confirmedEvidence=(await sql(`select * from public.evidence where id=$1`,[contactObservation.evidence_id])).rows[0];
  assert.equal(confirmedEvidence.status,'VERIFIED');
  assert.equal(confirmedEvidence.verified_by,B);
  const alphaEvidenceAfterConfirm=(await sql(`select * from public.evidence where prospect_id=$1`,[alphaProspectId])).rows;
  const finalScore=scoreProspect(SAAS_CRITERIA,alphaEvidenceAfterConfirm.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at,verified_by:e.verified_by})),new Date());
  assert.equal(finalScore.score,20,'contactability weight (20) now counts once the real PHONE_RAW-derived evidence is confirmed');
  assert.equal(finalScore.breakdown.find(b=>b.key==='contactability').state,'TRUE');

  // --- Generalization to commercial_signal: same discipline, a different self-contained, cross-sector
  // concept (an explicit, named commercial/growth event — see strategies/commercial-signal.ts). Nova
  // Assistance's fixture page states a genuine, concrete recruiting event, never a bare mention of the
  // company, its phone number, or its website.
  const nova = GENERIC_FIXTURE_COMPANIES.find(c => c.name.includes('Nova'));
  const novaProspectId = '40000000-0000-4000-8000-000000000006';
  await sql(`insert into public.prospects(id,organization_id,project_id,name,website,status) values ($1,$2,$3,$4,$5,'À analyser')`,[novaProspectId,OB,PB,nova.name,nova.website]);
  // The analysis quota was deliberately dropped to 1/hour earlier in this file to test quota
  // enforcement itself; lift it back so this unrelated second analyze_company call is not rejected.
  await sql(`update prospectos_private.discovery_quota_settings set analyses_per_hour=100`);
  const novaAnalyzeResult=await new CompanyAnalysisService(realRepoFor(B),createCompositePageFetcher(realFetcher)).analyze_company(novaProspectId,'test_fixture');
  assert.equal(realNetworkCalls,0,'zero real network calls for Nova, still a fixture prospect');
  assert.ok(novaAnalyzeResult.pages_analyzed>=1);
  const novaObservations=(await sql(`select * from public.prospect_observations where prospect_id=$1`,[novaProspectId])).rows;
  assert.ok(novaObservations.every(o=>o.review_status!=='VERIFIED'));

  // SAAS_CRITERIA's target_fit/need_fit carry no `rules` at all — so, exactly as before user-authored
  // rules existed, they must stay UNKNOWN, or at most a non-conclusive INFERRED candidate — never
  // OBSERVED with a real value, and never linked to an evidence row (see the dedicated rules-based
  // scenario further below for the case where rules ARE configured).
  for (const key of ['target_fit','need_fit']) {
    const rows = novaObservations.filter(o=>o.criterion===key);
    assert.ok(rows.every(o=>o.status!=='OBSERVED'), `${key} never resolves to OBSERVED without a deterministic rule`);
    assert.ok(rows.every(o=>o.evidence_id===null), `${key} never creates an evidence row on its own`);
  }

  const signalObservations=novaObservations.filter(o=>o.criterion==='commercial_signal'&&o.status==='OBSERVED');
  assert.ok(signalObservations.length>0,"the real recruiting phrase on Nova's page proposed commercial_signal on its own");
  const signalObservation=signalObservations[0];
  assert.equal(signalObservation.observation_type,'RECRUITING_SIGNAL');
  assert.equal(signalObservation.value,true);
  assert.equal(signalObservation.review_status,'NOT_VERIFIED');
  assert.ok(signalObservation.evidence_id);
  // A phone number never grants commercial_signal, and the recruiting rule never grants contactability.
  assert.ok(!novaObservations.some(o=>o.observation_type==='PHONE_RAW'&&o.criterion==='commercial_signal'));
  assert.ok(!novaObservations.some(o=>o.criterion==='contactability'&&o.observation_type!=='PHONE_RAW'));

  let novaEvidence=(await sql(`select * from public.evidence where prospect_id=$1`,[novaProspectId])).rows;
  assert.ok(novaEvidence.every(e=>e.status!=='VERIFIED'),'analyze_company never creates VERIFIED evidence on its own');
  assert.equal(scoreProspect(SAAS_CRITERIA,novaEvidence.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at})),new Date()).score,0,'score stays 0 before any human review');

  await as(B,`select public.review_discovery_observation($1,'confirm')`,[signalObservation.id]);
  const confirmedSignalEvidence=(await sql(`select * from public.evidence where id=$1`,[signalObservation.evidence_id])).rows[0];
  assert.equal(confirmedSignalEvidence.status,'VERIFIED');
  assert.equal(confirmedSignalEvidence.verified_by,B);
  const novaEvidenceAfterConfirm=(await sql(`select * from public.evidence where prospect_id=$1`,[novaProspectId])).rows;
  const novaFinalScore=scoreProspect(SAAS_CRITERIA,novaEvidenceAfterConfirm.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at,verified_by:e.verified_by})),new Date());
  const commercialSignalWeight=SAAS_CRITERIA.find(c=>c.key==='commercial_signal').weight; // never hardcoded
  assert.equal(novaFinalScore.score,commercialSignalWeight,'commercial_signal weight now counts once the real recruiting-derived evidence is confirmed');
  assert.equal(novaFinalScore.breakdown.find(b=>b.key==='commercial_signal').state,'TRUE');

  // --- Generalization to target_fit / need_fit: the user's OWN explicit rules, deterministic literal
  // matching only (see strategies/target-fit.ts, strategies/need-fit.ts). A dedicated project keeps
  // this scenario isolated from PB's rules-less SAAS_CRITERIA prospects above. The page text is a
  // small, self-contained HTML fixture local to this test (not the shared GENERIC_FIXTURE_COMPANIES
  // dataset), so the shared fixtures stay generic and untouched by this specific rule configuration.
  const rulesProjectId='20000000-0000-4000-8000-000000000010';
  const rulesProspectId='40000000-0000-4000-8000-000000000007';
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Rules project')`,[rulesProjectId,OB]);
  const RULES_CRITERIA=[
   {key:'target_fit',label:'Correspond à la cible définie',weight:30,rules:{type:'target_fit',config:{categories:['restaurant'],locations:['Toulouse'],match:'all_defined'}}},
   {key:'need_fit',label:'Besoin correspondant à l’offre',weight:40,rules:{type:'need_fit',config:{signals:['fort volume de réservations']}}},
   {key:'commercial_signal',label:'Signal commercial observable',weight:30},
  ];
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`,[rulesProjectId,OB,JSON.stringify(RULES_CRITERIA)]);
  await sql(`insert into public.prospects(id,organization_id,project_id,name,website,status) values ($1,$2,$3,'Le Bon Repas','https://lebonrepas.example/','À analyser')`,[rulesProspectId,OB,rulesProjectId]);
  const RULES_HTML='<html><head><title>Le Bon Repas</title></head><body><h1>Le Bon Repas</h1><p>Restaurant situé à Toulouse, reconnu pour sa cuisine traditionnelle.</p><p>Nous constatons un fort volume de réservations chaque week-end.</p></body></html>';
  const rulesAnalyzeResult=await new CompanyAnalysisService(realRepoFor(B),async url=>({url,html:RULES_HTML})).analyze_company(rulesProspectId,'official_website');
  assert.ok(rulesAnalyzeResult.pages_analyzed>=1);
  const rulesObservations=(await sql(`select * from public.prospect_observations where prospect_id=$1`,[rulesProspectId])).rows;
  assert.ok(rulesObservations.every(o=>o.review_status!=='VERIFIED'));
  assert.ok(rulesObservations.filter(o=>o.status==='UNKNOWN'||o.status==='INFERRED').every(o=>o.evidence_id===null),'UNKNOWN/INFERRED observations are never linked to an evidence row');

  const targetFitObservations=rulesObservations.filter(o=>o.criterion==='target_fit'&&o.status==='OBSERVED');
  assert.equal(targetFitObservations.length,1,'exactly one deterministic target_fit proposal — no redundant GENERIC_KEYWORD_MATCH guess');
  const targetFitObservation=targetFitObservations[0];
  assert.equal(targetFitObservation.observation_type,'TARGET_FIT_RULE_MATCH');
  assert.equal(targetFitObservation.value,true);
  assert.ok(targetFitObservation.evidence_id);

  const needFitObservations=rulesObservations.filter(o=>o.criterion==='need_fit'&&o.status==='OBSERVED');
  assert.equal(needFitObservations.length,1,'exactly one deterministic need_fit proposal');
  const needFitObservation=needFitObservations[0];
  assert.equal(needFitObservation.observation_type,'NEED_FIT_SIGNAL_MATCH');
  assert.equal(needFitObservation.value,true);
  assert.ok(needFitObservation.evidence_id);
  assert.match(needFitObservation.claim,/fort volume de réservations/,'the claim explains exactly which user-defined signal matched');

  // commercial_signal has no rules on this criterion here, and the page names no explicit event —
  // it must stay without a positive value, exactly like any criterion without a deterministic rule.
  assert.ok(!rulesObservations.some(o=>o.criterion==='commercial_signal'&&o.status==='OBSERVED'&&o.value===true));

  let rulesEvidence=(await sql(`select * from public.evidence where prospect_id=$1`,[rulesProspectId])).rows;
  assert.ok(rulesEvidence.every(e=>e.status!=='VERIFIED'),'analyze_company never creates VERIFIED evidence on its own');
  assert.equal(scoreProspect(RULES_CRITERIA,rulesEvidence.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at})),new Date()).score,0,'score stays 0 before any human review');

  // Confirm target_fit first: score becomes exactly its own configured weight.
  await as(B,`select public.review_discovery_observation($1,'confirm')`,[targetFitObservation.id]);
  const targetFitEvidence=(await sql(`select * from public.evidence where id=$1`,[targetFitObservation.evidence_id])).rows[0];
  assert.equal(targetFitEvidence.status,'VERIFIED');
  assert.equal(targetFitEvidence.verified_by,B,'verified_by is the authenticated human, never automatic');
  const rulesEvidenceAfterFirst=(await sql(`select * from public.evidence where prospect_id=$1`,[rulesProspectId])).rows;
  const targetFitWeight=RULES_CRITERIA.find(c=>c.key==='target_fit').weight; // never hardcoded
  assert.equal(scoreProspect(RULES_CRITERIA,rulesEvidenceAfterFirst.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at,verified_by:e.verified_by})),new Date()).score,targetFitWeight,'score equals exactly the confirmed criterion’s own weight');

  // Confirm need_fit second: score becomes the exact sum of both confirmed weights.
  await as(B,`select public.review_discovery_observation($1,'confirm')`,[needFitObservation.id]);
  const needFitEvidence=(await sql(`select * from public.evidence where id=$1`,[needFitObservation.evidence_id])).rows[0];
  assert.equal(needFitEvidence.status,'VERIFIED');
  assert.equal(needFitEvidence.verified_by,B);
  const rulesEvidenceAfterBoth=(await sql(`select * from public.evidence where prospect_id=$1`,[rulesProspectId])).rows;
  const needFitWeight=RULES_CRITERIA.find(c=>c.key==='need_fit').weight;
  const rulesFinalScore=scoreProspect(RULES_CRITERIA,rulesEvidenceAfterBoth.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at,verified_by:e.verified_by})),new Date());
  assert.equal(rulesFinalScore.score,targetFitWeight+needFitWeight,'score equals the exact sum of both confirmed weights');
  assert.equal(rulesFinalScore.breakdown.find(b=>b.key==='target_fit').state,'TRUE');
  assert.equal(rulesFinalScore.breakdown.find(b=>b.key==='need_fit').state,'TRUE');

  // Isolation: this new project's target_fit/need_fit evidence never leaks into project PB, whose own
  // SAAS_CRITERIA prospects (Alpha, Nova, prospectSaas) carry no rules on those same criterion keys.
  assert.equal(Number((await sql(`select count(*) n from public.evidence e join public.prospects p on p.id=e.prospect_id where p.project_id=$1 and e.criterion in ('target_fit','need_fit')`,[PB])).rows[0].n),0,'the rules-bearing criteria never leak evidence into an unrelated project');

  // --- M1 fix: a malformed `rules` object written directly to icps.criteria — exactly as a direct
  // PostgREST/SQL write bypassing this application's own Zod validation would produce — must never
  // crash analyze_company. It must behave as "no exploitable rule": zero evidence, score 0.
  const malformedProjectId='20000000-0000-4000-8000-000000000011';
  const malformedProspectId='40000000-0000-4000-8000-000000000008';
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Malformed rules project')`,[malformedProjectId,OB]);
  const MALFORMED_CRITERIA=[
   {key:'target_fit',label:'Correspond à la cible définie',weight:50,rules:{type:'target_fit',config:{categories:'PME',match:'invalid'}}},
   {key:'need_fit',label:'Besoin correspondant à l’offre',weight:50,rules:{type:'need_fit',config:{signals:null}}},
  ];
  // Inserted via a raw SQL statement — never through the app's own icps POST handler/Zod schema — to
  // faithfully simulate a row written outside this application.
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`,[malformedProjectId,OB,JSON.stringify(MALFORMED_CRITERIA)]);
  await sql(`insert into public.prospects(id,organization_id,project_id,name,website,status) values ($1,$2,$3,'Malformed Rules Co','https://malformed-rules.example/','À analyser')`,[malformedProspectId,OB,malformedProjectId]);
  const malformedHtml='<html><body><p>Restaurant reconnu à Toulouse, PME locale, fort volume de réservations.</p></body></html>';
  const malformedAnalyzeResult=await new CompanyAnalysisService(realRepoFor(B),async url=>({url,html:malformedHtml})).analyze_company(malformedProspectId,'official_website');
  assert.ok(malformedAnalyzeResult.pages_analyzed>=1,'analyze_company completes normally — it does not throw ANALYSIS_FAILED');
  const malformedObservations=(await sql(`select * from public.prospect_observations where prospect_id=$1`,[malformedProspectId])).rows;
  assert.ok(malformedObservations.every(o=>o.criterion!=='target_fit'||o.status!=='OBSERVED'),'the malformed target_fit rule never resolves to OBSERVED');
  assert.ok(malformedObservations.every(o=>o.criterion!=='need_fit'||o.status!=='OBSERVED'),'the malformed need_fit rule never resolves to OBSERVED');
  assert.ok(malformedObservations.filter(o=>['target_fit','need_fit'].includes(o.criterion)).every(o=>o.evidence_id===null),'no evidence created from the malformed rules');
  const malformedEvidence=(await sql(`select * from public.evidence where prospect_id=$1`,[malformedProspectId])).rows;
  assert.equal(malformedEvidence.length,0,'zero evidence rows created at all for this prospect');
  assert.equal(scoreProspect(MALFORMED_CRITERIA,malformedEvidence.map(e=>({criterion:e.criterion,value:e.value,status:e.status,source_url:e.source_url,excerpt:e.excerpt,observed_at:e.observed_at})),new Date()).score,0,'score stays 0');

  console.log('PASS: discovery lifecycle, scoring, tenant isolation, FK integrity, idempotency, validation, quotas, RPC grants, generic multi-sector ICP handling, and fixture analyze regression');
} finally {
  await db.close();
}
