// PGlite regression suite dedicated to migration 004 (save_discovery_observations upsert/evidence-link
// fix). Never touches production — a fresh in-memory Postgres instance per run, loading
// schema.sql + migrations 002, 003, 004 in order (004 replaces the function defined in 002/003).
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { scoreProspect } from '../src/domain/core.ts';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration002 = await readFile(new URL('../db/migrations/002_discovery.sql', import.meta.url), 'utf8');
const migration003 = await readFile(new URL('../db/migrations/003_discovery_generic_criteria.sql', import.meta.url), 'utf8');
const migration004 = await readFile(new URL('../db/migrations/004_fix_observation_evidence_upsert.sql', import.meta.url), 'utf8');

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
async function save(user, prospectId, observations) {
  return (await as(user, `select public.save_discovery_observations($1,$2::jsonb) rows`, [prospectId, JSON.stringify(observations)])).rows[0].rows;
}
function obsPayload(overrides) {
  const now = new Date(), expires = new Date(+now + 90 * 86400000);
  return {
    criterion: null, observation_type: 'PHONE_RAW', claim: 'x', value: null, status: 'OBSERVED',
    source_url: 'https://vendor.fixture.example/', source_title: 'TEST — Vendor', source_excerpt: 'x',
    source_type: 'test_fixture', confidence: 0.8, collected_at: now.toISOString(), expires_at: expires.toISOString(),
    content_hash: 'hash-default', ...overrides,
  };
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
  await db.exec(migration002);
  await db.exec(migration003);
  await db.exec(migration004);

  const A = '00000000-0000-4000-8000-000000000001';
  const B = '00000000-0000-4000-8000-000000000002';
  const OA = '10000000-0000-4000-8000-000000000001';
  const OB = '10000000-0000-4000-8000-000000000002';
  const PA = '20000000-0000-4000-8000-000000000001';
  const PB = '20000000-0000-4000-8000-000000000002';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA, A, OB, B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS A'),($3,$4,'Test SaaS B')`, [PA, OA, PB, OB]);

  const CRITERIA = [
    { key: 'target_fit', label: 'Correspond à la cible définie', weight: 25, rules: { type: 'target_fit', config: { categories: ['restaurant'], match: 'any_defined' } } },
    { key: 'need_fit', label: 'Besoin correspondant à l’offre', weight: 25, rules: { type: 'need_fit', config: { signals: ['fort volume de réservations'] } } },
    { key: 'commercial_signal', label: 'Signal commercial observable', weight: 25 },
    { key: 'contactability', label: 'Canal de contact professionnel documenté', weight: 25 },
  ];
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [PA, OA, JSON.stringify(CRITERIA)]);
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [PB, OB, JSON.stringify(CRITERIA)]);

  async function newProspect(id, org, project) {
    const actor = org === OA ? A : B;
    await sql("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await sql(`insert into public.prospects(id,organization_id,project_id,name,website,status) values ($1,$2,$3,'TEST — Vendor',$4,'À analyser')`,
      [id, org, project, 'https://vendor.fixture.example/']);
  }

  // === TEST A — historical contextual PHONE_RAW enriched into contactability ===
  const pA = '40000000-0000-4000-8000-000000000001';
  await newProspect(pA, OA, PA);
  const oldStyle = obsPayload({ content_hash: 'hash-a', observation_type: 'PHONE_RAW', source_excerpt: '05 00 00 00 11', claim: 'Numéro public présent ; usage commercial non déduit' });
  const savedOld = await save(A, pA, [oldStyle]);
  assert.equal(savedOld[0].criterion, null); assert.equal(savedOld[0].evidence_id, null, 'TEST A precondition: historical row is contextual, no evidence');

  const enriched = obsPayload({ content_hash: 'hash-a', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 11', claim: 'Numéro de téléphone professionnel public documenté' });
  const savedNew = await save(A, pA, [enriched]);
  assert.equal(savedNew[0].id, savedOld[0].id, 'TEST A: same observation row (same dedup key), not a duplicate');
  assert.equal(savedNew[0].criterion, 'contactability', 'TEST A: observation is enriched with the new criterion');
  assert.equal(savedNew[0].value, true);
  assert.ok(savedNew[0].evidence_id, 'TEST A: observation now links to an evidence row');
  const evidenceA = (await sql(`select * from public.evidence where id=$1`, [savedNew[0].evidence_id])).rows[0];
  assert.equal(evidenceA.criterion, 'contactability'); assert.equal(evidenceA.value, true); assert.equal(evidenceA.status, 'NOT_VERIFIED');
  console.log('PASS A — historical contextual observation enriched, evidence created and linked');

  // === TEST B — re-analysis with the exact same enriched payload is idempotent ===
  const savedAgain = await save(A, pA, [enriched]);
  assert.equal(savedAgain[0].id, savedNew[0].id);
  assert.equal(savedAgain[0].evidence_id, savedNew[0].evidence_id, 'TEST B: same evidence_id reused, not a new one');
  assert.equal(Number((await sql(`select count(*) n from public.prospect_observations where prospect_id=$1`, [pA])).rows[0].n), 1, 'TEST B: still exactly 1 observation row');
  assert.equal(Number((await sql(`select count(*) n from public.evidence where prospect_id=$1`, [pA])).rows[0].n), 1, 'TEST B: still exactly 1 evidence row');
  console.log('PASS B — identical re-analysis is idempotent, no duplicate observation or evidence');

  // === TEST C — a human-verified evidence is never downgraded/rewritten by a later automatic analysis ===
  await as(A, `select public.review_discovery_observation($1,'confirm')`, [savedAgain[0].id]);
  let evidenceC = (await sql(`select * from public.evidence where id=$1`, [savedAgain[0].evidence_id])).rows[0];
  assert.equal(evidenceC.status, 'VERIFIED'); assert.equal(evidenceC.verified_by, A);
  // A later automatic re-analysis submits slightly different (but still automated) data for the exact
  // same dedup key — this must never reach the now-human-owned row.
  const laterAutomaticPayload = obsPayload({ content_hash: 'hash-a', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, claim: 'DIFFERENT CLAIM — must never overwrite the confirmed row', confidence: 0.4 });
  const savedAfterConfirm = await save(A, pA, [laterAutomaticPayload]);
  assert.equal(savedAfterConfirm[0].id, savedAgain[0].id);
  assert.equal(savedAfterConfirm[0].claim, enriched.claim, 'TEST C: observation claim frozen — the new automated claim never overwrote it');
  assert.equal(savedAfterConfirm[0].review_status, 'VERIFIED', 'TEST C: review_status stays VERIFIED');
  const evidenceCAfter = (await sql(`select * from public.evidence where id=$1`, [savedAfterConfirm[0].evidence_id])).rows[0];
  assert.equal(evidenceCAfter.status, 'VERIFIED'); assert.equal(evidenceCAfter.verified_by, A, 'TEST C: verified_by unchanged');
  assert.equal(evidenceCAfter.value, true);
  console.log('PASS C — VERIFIED evidence and its observation are frozen against later automatic analyses');

  // === TEST D — an existing NOT_VERIFIED evidence with the same criterion/value is reused, no duplicate ===
  const pD = '40000000-0000-4000-8000-000000000002';
  await newProspect(pD, OA, PA);
  const dPayload = obsPayload({ content_hash: 'hash-d', observation_type: 'RECRUITING_SIGNAL', criterion: 'commercial_signal', value: true, source_excerpt: 'Nous recrutons.', claim: 'Recrutement actif' });
  const savedD1 = await save(A, pD, [dPayload]);
  const savedD2 = await save(A, pD, [dPayload]);
  assert.equal(savedD2[0].id, savedD1[0].id);
  assert.equal(savedD2[0].evidence_id, savedD1[0].evidence_id, 'TEST D: same evidence reused for identical criterion/value');
  assert.equal(Number((await sql(`select count(*) n from public.evidence where prospect_id=$1`, [pD])).rows[0].n), 1, 'TEST D: no duplicate evidence');
  console.log('PASS D — identical NOT_VERIFIED re-save reuses the existing evidence, no duplicate');

  // === TEST E — automatic criterion/value changes on an unreviewed observation: reuse in place, no orphan ===
  const pE = '40000000-0000-4000-8000-000000000003';
  await newProspect(pE, OA, PA);
  const eFirst = obsPayload({ content_hash: 'hash-e', observation_type: 'RULE_MATCH', criterion: 'commercial_signal', value: true, source_excerpt: 'signal initial' });
  const savedE1 = await save(A, pE, [eFirst]);
  const firstEvidenceId = savedE1[0].evidence_id;
  assert.ok(firstEvidenceId);
  // A later analysis (e.g. after a rule-attribution change) now attaches the SAME observation slot to
  // a different criterion — still purely automated, never human-reviewed.
  const eSecond = obsPayload({ content_hash: 'hash-e', observation_type: 'RULE_MATCH', criterion: 'target_fit', value: true, source_excerpt: 'signal révisé' });
  const savedE2 = await save(A, pE, [eSecond]);
  assert.equal(savedE2[0].id, savedE1[0].id, 'TEST E: same observation row');
  assert.equal(savedE2[0].criterion, 'target_fit', 'TEST E: observation criterion updated');
  assert.equal(savedE2[0].evidence_id, firstEvidenceId, 'TEST E: the SAME evidence row is reused in place, not replaced');
  const evidenceE = (await sql(`select * from public.evidence where id=$1`, [firstEvidenceId])).rows[0];
  assert.equal(evidenceE.criterion, 'target_fit', 'TEST E: evidence criterion refreshed to match the latest automated read');
  assert.equal(Number((await sql(`select count(*) n from public.evidence where prospect_id=$1`, [pE])).rows[0].n), 1, 'TEST E: no orphan — exactly one evidence row for this prospect');
  console.log('PASS E — automatic criterion/value change on an unreviewed observation reuses evidence in place, no orphan');

  // === TEST F — UNKNOWN/contextual observations never create evidence; a criterion becoming null again deletes the stale evidence ===
  const pF = '40000000-0000-4000-8000-000000000004';
  await newProspect(pF, OA, PA);
  const unknownPayload = obsPayload({ content_hash: 'hash-f1', observation_type: 'UNKNOWN_SLOT', criterion: 'target_fit', value: null, status: 'UNKNOWN', source_excerpt: '' });
  const savedUnknown = await save(A, pF, [unknownPayload]);
  assert.equal(savedUnknown[0].evidence_id, null, 'TEST F: UNKNOWN never creates evidence');

  const fEnriched = obsPayload({ content_hash: 'hash-f2', observation_type: 'RULE_MATCH', criterion: 'commercial_signal', value: true, source_excerpt: 'signal' });
  const savedF1 = await save(A, pF, [fEnriched]);
  const staleEvidenceId = savedF1[0].evidence_id;
  assert.ok(staleEvidenceId);
  const fBackToContextual = obsPayload({ content_hash: 'hash-f2', observation_type: 'RULE_MATCH', criterion: null, value: null, source_excerpt: 'plus de signal explicite' });
  const savedF2 = await save(A, pF, [fBackToContextual]);
  assert.equal(savedF2[0].id, savedF1[0].id);
  assert.equal(savedF2[0].criterion, null); assert.equal(savedF2[0].evidence_id, null, 'TEST F: evidence_id cleared when criterion becomes null');
  assert.equal(Number((await sql(`select count(*) n from public.evidence where id=$1`, [staleEvidenceId])).rows[0].n), 0, 'TEST F: the stale NOT_VERIFIED evidence is deleted, not left orphaned');
  console.log('PASS F — UNKNOWN never creates evidence; a criterion reverting to null deletes the stale unreviewed evidence');

  // === TEST G — commercial_signal historical enrichment ===
  const pG = '40000000-0000-4000-8000-000000000005';
  await newProspect(pG, OA, PA);
  const gOld = obsPayload({ content_hash: 'hash-g', observation_type: 'RECRUITING_SIGNAL', criterion: null, value: null, source_excerpt: 'Nous recrutons.', claim: 'Contexte' });
  await save(A, pG, [gOld]);
  const gNew = obsPayload({ content_hash: 'hash-g', observation_type: 'RECRUITING_SIGNAL', criterion: 'commercial_signal', value: true, source_excerpt: 'Nous recrutons.', claim: 'Recrutement actif explicitement annoncé' });
  const savedG = await save(A, pG, [gNew]);
  assert.equal(savedG[0].criterion, 'commercial_signal'); assert.equal(savedG[0].value, true); assert.ok(savedG[0].evidence_id);
  console.log('PASS G — commercial_signal historical observation correctly enriched');

  // === TEST H — target_fit historical enrichment ===
  const pH = '40000000-0000-4000-8000-000000000006';
  await newProspect(pH, OA, PA);
  const hOld = obsPayload({ content_hash: 'hash-h', observation_type: 'TARGET_FIT_RULE_MATCH', criterion: null, value: null, source_excerpt: 'Restaurant à Toulouse.' });
  await save(A, pH, [hOld]);
  const hNew = obsPayload({ content_hash: 'hash-h', observation_type: 'TARGET_FIT_RULE_MATCH', criterion: 'target_fit', value: true, source_excerpt: 'Restaurant à Toulouse.', claim: 'Règle ICP explicite satisfaite' });
  const savedH = await save(A, pH, [hNew]);
  assert.equal(savedH[0].criterion, 'target_fit'); assert.equal(savedH[0].value, true); assert.ok(savedH[0].evidence_id);
  console.log('PASS H — target_fit historical observation correctly enriched');

  // === TEST I — need_fit historical enrichment ===
  const pI = '40000000-0000-4000-8000-000000000007';
  await newProspect(pI, OA, PA);
  const iOld = obsPayload({ content_hash: 'hash-i', observation_type: 'NEED_FIT_SIGNAL_MATCH', criterion: null, value: null, source_excerpt: 'fort volume de réservations' });
  await save(A, pI, [iOld]);
  const iNew = obsPayload({ content_hash: 'hash-i', observation_type: 'NEED_FIT_SIGNAL_MATCH', criterion: 'need_fit', value: true, source_excerpt: 'fort volume de réservations', claim: "Signal de besoin défini par l'utilisateur explicitement observé" });
  const savedI = await save(A, pI, [iNew]);
  assert.equal(savedI[0].criterion, 'need_fit'); assert.equal(savedI[0].value, true); assert.ok(savedI[0].evidence_id);
  console.log('PASS I — need_fit historical observation correctly enriched');

  // === TEST J — two tenants, coincidentally identical content_hash, zero cross-contamination ===
  const pJa = '40000000-0000-4000-8000-000000000008';
  const pJb = '40000000-0000-4000-8000-000000000009';
  await newProspect(pJa, OA, PA);
  await newProspect(pJb, OB, PB);
  const jPayload = obsPayload({ content_hash: 'hash-j-shared', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 99' });
  const savedJa = await save(A, pJa, [jPayload]);
  const savedJb = await save(B, pJb, [jPayload]);
  assert.notEqual(savedJa[0].id, savedJb[0].id); assert.notEqual(savedJa[0].evidence_id, savedJb[0].evidence_id);
  assert.equal(Number((await sql(`select count(*) n from public.prospect_observations where prospect_id=$1`, [pJa])).rows[0].n), 1);
  assert.equal(Number((await sql(`select count(*) n from public.prospect_observations where prospect_id=$1`, [pJb])).rows[0].n), 1);
  await rejects(as(B, `select public.review_discovery_observation($1,'confirm')`, [savedJa[0].id]), /tenant member/i);
  await rejects(as(A, `select public.review_discovery_observation($1,'confirm')`, [savedJb[0].id]), /tenant member/i);
  console.log('PASS J — identical content_hash across two tenants never cross-contaminates observations, evidence, or review rights');

  // === TEST K / L — score is 0 before human review, and exactly the ICP weight after confirmation ===
  const pKL = '40000000-0000-4000-8000-000000000010';
  await newProspect(pKL, OA, PA);
  const klOld = obsPayload({ content_hash: 'hash-kl', observation_type: 'PHONE_RAW', criterion: null, value: null, source_excerpt: '05 00 00 00 11' });
  await save(A, pKL, [klOld]);
  const klEnriched = obsPayload({ content_hash: 'hash-kl', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 11' });
  const savedKL = await save(A, pKL, [klEnriched]);
  let evidenceKL = (await sql(`select * from public.evidence where prospect_id=$1`, [pKL])).rows;
  const scoreBefore = scoreProspect(CRITERIA, evidenceKL.map(e => ({ criterion: e.criterion, value: e.value, status: e.status, source_url: e.source_url, excerpt: e.excerpt, observed_at: e.observed_at })), new Date());
  assert.equal(scoreBefore.score, 0, 'TEST K: score is 0 before human review');
  console.log('PASS K — score stays 0 before human review');

  await as(A, `select public.review_discovery_observation($1,'confirm')`, [savedKL[0].id]);
  evidenceKL = (await sql(`select * from public.evidence where prospect_id=$1`, [pKL])).rows;
  const scoreAfter = scoreProspect(CRITERIA, evidenceKL.map(e => ({ criterion: e.criterion, value: e.value, status: e.status, source_url: e.source_url, excerpt: e.excerpt, observed_at: e.observed_at, verified_by: e.verified_by })), new Date());
  const contactabilityWeight = CRITERIA.find(c => c.key === 'contactability').weight; // never hardcoded
  assert.equal(scoreAfter.score, contactabilityWeight, 'TEST L: score equals exactly the ICP weight after confirmation');
  console.log('PASS L — score equals exactly the confirmed criterion\'s ICP weight');

  // === TEST M1 — review_status desynced (NOT_VERIFIED) from a real VERIFIED evidence.status: a later
  // automatic re-analysis with a criterion present must NOT downgrade the evidence or wipe verified_by ===
  const pM1 = '40000000-0000-4000-8000-000000000011';
  await newProspect(pM1, OA, PA);
  const m1First = obsPayload({ content_hash: 'hash-m1', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 22', claim: 'initial' });
  const savedM1 = await save(A, pM1, [m1First]);
  const m1EvidenceId = savedM1[0].evidence_id;
  assert.ok(m1EvidenceId, 'TEST M1 precondition: evidence linked');
  // Simulate the desync: a direct authenticated UPDATE on evidence (bypassing review_discovery_observation)
  // marks it VERIFIED — evidence_guard forces a real verified_by — while review_status stays NOT_VERIFIED.
  await as(A, `update public.evidence set status='VERIFIED' where id=$1`, [m1EvidenceId]);
  let m1Before = (await sql(`select * from public.evidence where id=$1`, [m1EvidenceId])).rows[0];
  assert.equal(m1Before.status, 'VERIFIED'); assert.ok(m1Before.verified_by, 'TEST M1 precondition: verified_by set by evidence_guard');
  assert.equal((await sql(`select review_status from public.prospect_observations where id=$1`, [savedM1[0].id])).rows[0].review_status, 'NOT_VERIFIED', 'TEST M1 precondition: review_status desynced (still NOT_VERIFIED)');
  const m1Reanalysis = obsPayload({ content_hash: 'hash-m1', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 22', claim: 'REANALYSIS — must never overwrite' });
  const savedM1After = await save(A, pM1, [m1Reanalysis]);
  assert.equal(savedM1After[0].claim, m1First.claim, 'TEST M1: observation frozen, new automated claim never applied');
  let m1After = (await sql(`select * from public.evidence where id=$1`, [m1EvidenceId])).rows[0];
  assert.equal(m1After.status, 'VERIFIED', 'TEST M1: evidence still VERIFIED despite stale review_status');
  assert.equal(m1After.verified_by, m1Before.verified_by, 'TEST M1: verified_by unchanged');
  console.log('PASS M1 — desynced VERIFIED evidence (criterion present on re-analysis) is never downgraded');

  // === TEST M2 — same desync, but the new payload has NO criterion: must NOT delete the VERIFIED evidence ===
  const pM2 = '40000000-0000-4000-8000-000000000012';
  await newProspect(pM2, OA, PA);
  const m2First = obsPayload({ content_hash: 'hash-m2', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 33', claim: 'initial' });
  const savedM2 = await save(A, pM2, [m2First]);
  const m2EvidenceId = savedM2[0].evidence_id;
  await as(A, `update public.evidence set status='VERIFIED' where id=$1`, [m2EvidenceId]);
  const m2Reanalysis = obsPayload({ content_hash: 'hash-m2', observation_type: 'PHONE_RAW', criterion: null, value: null, claim: 'no longer mapped to a criterion' });
  const savedM2After = await save(A, pM2, [m2Reanalysis]);
  assert.equal(savedM2After[0].evidence_id, m2EvidenceId, 'TEST M2: observation still points at the VERIFIED evidence, not cleared');
  const m2Evidence = (await sql(`select * from public.evidence where id=$1`, [m2EvidenceId])).rows[0];
  assert.ok(m2Evidence, 'TEST M2: the VERIFIED evidence row was NOT deleted');
  assert.equal(m2Evidence.status, 'VERIFIED'); assert.ok(m2Evidence.verified_by, 'TEST M2: verified_by unchanged');
  console.log('PASS M2 — desynced VERIFIED evidence is never deleted, even when the re-analysis drops the criterion');

  // === TEST M3 — same two scenarios with evidence.status = CONTRADICTED ===
  const pM3 = '40000000-0000-4000-8000-000000000013';
  await newProspect(pM3, OA, PA);
  const m3First = obsPayload({ content_hash: 'hash-m3', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 44', claim: 'initial' });
  const savedM3 = await save(A, pM3, [m3First]);
  const m3EvidenceId = savedM3[0].evidence_id;
  await as(A, `update public.evidence set status='CONTRADICTED' where id=$1`, [m3EvidenceId]);
  const m3Reanalysis = obsPayload({ content_hash: 'hash-m3', observation_type: 'PHONE_RAW', criterion: null, value: null, claim: 'no longer mapped' });
  const savedM3After = await save(A, pM3, [m3Reanalysis]);
  assert.equal(savedM3After[0].evidence_id, m3EvidenceId, 'TEST M3: observation still points at the CONTRADICTED evidence');
  const m3Evidence = (await sql(`select * from public.evidence where id=$1`, [m3EvidenceId])).rows[0];
  assert.ok(m3Evidence, 'TEST M3: the CONTRADICTED evidence row was NOT deleted');
  assert.equal(m3Evidence.status, 'CONTRADICTED');
  console.log('PASS M3 — desynced CONTRADICTED evidence is never mutated nor deleted');

  // === TEST M4 — normal case (both signals NOT_VERIFIED): automatic UPDATE/reuse must still work ===
  const pM4 = '40000000-0000-4000-8000-000000000014';
  await newProspect(pM4, OA, PA);
  const m4First = obsPayload({ content_hash: 'hash-m4', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 55', claim: 'initial' });
  const savedM4 = await save(A, pM4, [m4First]);
  const m4EvidenceId = savedM4[0].evidence_id;
  const m4Reanalysis = obsPayload({ content_hash: 'hash-m4', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 55', claim: 'updated claim' });
  const savedM4After = await save(A, pM4, [m4Reanalysis]);
  assert.equal(savedM4After[0].evidence_id, m4EvidenceId, 'TEST M4: same evidence reused, not replaced');
  assert.equal(savedM4After[0].claim, 'updated claim', 'TEST M4: automatic update still applies when nothing is desynced');
  assert.equal(Number((await sql(`select count(*) n from public.evidence where prospect_id=$1`, [pM4])).rows[0].n), 1, 'TEST M4: no duplicate evidence');
  console.log('PASS M4 — normal NOT_VERIFIED/NOT_VERIFIED case remains fully mutable, automatic behavior unchanged');

  // === TEST M5 — the desync fix does not reintroduce the historical orphaned-evidence bug ===
  const pM5 = '40000000-0000-4000-8000-000000000015';
  await newProspect(pM5, OA, PA);
  const m5Old = obsPayload({ content_hash: 'hash-m5', observation_type: 'PHONE_RAW', criterion: null, value: null, source_excerpt: '05 00 00 00 66', claim: 'context' });
  await save(A, pM5, [m5Old]);
  const m5New = obsPayload({ content_hash: 'hash-m5', observation_type: 'PHONE_RAW', criterion: 'contactability', value: true, source_excerpt: '05 00 00 00 66', claim: 'enriched' });
  const savedM5 = await save(A, pM5, [m5New]);
  assert.ok(savedM5[0].evidence_id, 'TEST M5: evidence linked on enrichment');
  const m5Orphans = (await sql(`
    select e.id from public.evidence e where e.prospect_id=$1
    and not exists (select 1 from public.prospect_observations o where o.evidence_id = e.id)
  `, [pM5])).rows;
  assert.equal(m5Orphans.length, 0, 'TEST M5: no orphaned evidence introduced by the desync fix');
  console.log('PASS M5 — desync fix does not reintroduce the historical orphaned-evidence bug');

  // === TEST M6 — idempotence: repeating the M1/M4 analyses again changes nothing further ===
  const savedM1Repeat = await save(A, pM1, [m1Reanalysis]);
  assert.equal(savedM1Repeat[0].evidence_id, m1EvidenceId);
  const m1Repeat = (await sql(`select status,verified_by from public.evidence where id=$1`, [m1EvidenceId])).rows[0];
  assert.equal(m1Repeat.status, 'VERIFIED'); assert.equal(m1Repeat.verified_by, m1Before.verified_by);
  const savedM4Repeat = await save(A, pM4, [m4Reanalysis]);
  assert.equal(savedM4Repeat[0].evidence_id, m4EvidenceId);
  assert.equal(Number((await sql(`select count(*) n from public.evidence where prospect_id=$1`, [pM4])).rows[0].n), 1, 'TEST M6: still exactly 1 evidence row after repetition');
  console.log('PASS M6 — repeating desynced and normal analyses stays idempotent');

  // === Section 7 — orphan check: every evidence row must be referenced by some prospect_observations.evidence_id ===
  const orphans = (await sql(`
    select e.id, e.prospect_id, e.criterion from public.evidence e
    where not exists (select 1 from public.prospect_observations o where o.evidence_id = e.id)
  `)).rows;
  assert.equal(orphans.length, 0, `Expected 0 orphaned evidence rows, found ${orphans.length}: ${JSON.stringify(orphans)}`);
  console.log('PASS ORPHAN CHECK — 0 evidence rows exist without a prospect_observations.evidence_id referencing them');

  console.log('PASS: migration 004 upsert/evidence-link fix — all scenarios A-L + M1-M6 desync fix + orphan check');
} finally {
  await db.close();
}
