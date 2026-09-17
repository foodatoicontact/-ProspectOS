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

  // === Section 7 — orphan check: every evidence row must be referenced by some prospect_observations.evidence_id ===
  const orphans = (await sql(`
    select e.id, e.prospect_id, e.criterion from public.evidence e
    where not exists (select 1 from public.prospect_observations o where o.evidence_id = e.id)
  `)).rows;
  assert.equal(orphans.length, 0, `Expected 0 orphaned evidence rows, found ${orphans.length}: ${JSON.stringify(orphans)}`);
  console.log('PASS ORPHAN CHECK — 0 evidence rows exist without a prospect_observations.evidence_id referencing them');

  console.log('PASS: migration 004 upsert/evidence-link fix — all scenarios A-L + orphan check');
} finally {
  await db.close();
}
