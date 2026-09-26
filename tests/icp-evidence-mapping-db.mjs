// ICP evidence mapping — real PostgreSQL (PGlite) with the full production migration chain, no new
// migration. Proves that the proposals the extraction produces go through the EXISTING RPCs
// (save_discovery_observations / review_discovery_observation) and the EXISTING scoring engine:
// proposals are stored INFERRED_UNCONFIRMED and score 0, only a human review makes them VERIFIED, a new
// analysis never touches a reviewed row nor duplicates a proposal, and tenants stay isolated.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ObservationService } from '../src/discovery/observations.ts';
import { prioritizeObservations } from '../src/discovery/services.ts';
import { toStorageSafeObservation } from '../src/discovery/repository.ts';
import { scoreProspect } from '../src/domain/core.ts';

const db = new PGlite();
const sql = (text, params = []) => db.query(text, params);
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).split('\n')[0]]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
}

// The Padel Tolosa ICP of the regression (weights sum to 100) — plain data, no rule in the code knows it.
const ICP = [
  { key: 'infra', label: 'Infrastructure sportive physique réservable', weight: 30 },
  { key: 'slot', label: 'Réservation par créneau / à l’heure', weight: 25 },
  { key: 'multi', label: 'Capacité multi-terrains / multi-espaces', weight: 20 },
  { key: 'hours', label: 'Amplitude horaire étendue', weight: 10 },
  { key: 'groups', label: 'Offres groupes / entreprises / événements', weight: 15 },
];
const page = extra => `<html><head><title>Padel Tolosa</title></head><body><h1>Padel Tolosa</h1>${extra}<p>4 Terrains indoor + 1 terrain de badminton</p><p>Créneaux de 1h30 disponibles tous les jours de 7h30 à 00h.</p><p>Tél : 05 61 00 00 00</p></body></html>`;
const URL_A = 'https://padel.fixture.example/';
const extract = html => prioritizeObservations(new ObservationService().extract(html, URL_A, ICP, 'official_website')).map(toStorageSafeObservation);

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const oa = await org(A), ob = await org(B);
  const project = async (user, o) => (await as(user, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [o])).rows[0].id;
  const pa = await project(A, oa), pb = await project(B, ob);
  for (const [p, o] of [[pa, oa], [pb, ob]]) await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [p, o, JSON.stringify(ICP)]);
  const prA = (await as(A, `insert into public.prospects(organization_id,project_id,name,website,status) values($1,$2,'Padel Tolosa',$3,'À analyser') returning id`, [oa, pa, URL_A])).rows[0].id;

  const save = (user, prospectId, observations) => as(user, 'select public.save_discovery_observations($1,$2::jsonb) r', [prospectId, JSON.stringify(observations)]);
  const review = (user, id, decision) => as(user, 'select public.review_discovery_observation($1,$2) r', [id, decision]);
  const observations = async () => (await as(A, 'select * from public.prospect_observations where prospect_id=$1 order by observation_type,collected_at', [prA])).rows;
  const evidence = async () => (await as(A, 'select * from public.evidence where prospect_id=$1', [prA])).rows
    .map(e => ({ ...e, observed_at: new Date(e.observed_at).toISOString() }));
  const score = async () => scoreProspect(ICP, await evidence()).score;
  const signal = async key => (await observations()).find(o => o.observation_type === `ICP_SIGNAL:${key}`);

  await check('1_PROPOSAL: the multi-terrain sentence is stored as a proposal for "Capacité multi-terrains / multi-espaces"', async () => {
    await save(A, prA, extract(page('')));
    const o = await signal('multi');
    assert.ok(o, 'a proposal row exists');
    assert.equal(o.criterion, 'multi'); assert.equal(o.status, 'INFERRED'); assert.equal(o.value, true);
    assert.equal(o.review_status, 'NOT_VERIFIED');
    assert.equal(o.source_excerpt, '4 Terrains indoor + 1 terrain de badminton');
    const e = (await evidence()).find(x => x.id === o.evidence_id);
    assert.equal(e.status, 'INFERRED_UNCONFIRMED'); assert.equal(e.verified_by, null);
  });
  await check('8_MULTI_CRITERIA: the schedule sentence is proposed for two criteria, as two separate rows with two separate evidences, none verified', async () => {
    const hours = await signal('hours'), slot = await signal('slot');
    assert.ok(hours && slot);
    assert.equal(hours.source_excerpt, slot.source_excerpt);
    assert.notEqual(hours.evidence_id, slot.evidence_id);
    for (const o of [hours, slot]) assert.equal(o.review_status, 'NOT_VERIFIED');
    assert.ok((await evidence()).every(e => e.status !== 'VERIFIED' && e.verified_by === null), 'no evidence is VERIFIED after an analysis');
  });
  await check('2_3_4_SCORE_BEFORE_REVIEW: proposals (INFERRED_UNCONFIRMED) and OBSERVED unverified rows give 0 point', async () => {
    assert.equal(await score(), 0);
  });
  await check('7_AMBIGUOUS: criteria with no explicit signal stay without proposal (infra, groups)', async () => {
    assert.equal(await signal('infra'), undefined);
    assert.equal(await signal('groups'), undefined);
    // No evidence at all for them: nothing to confirm, nothing that could ever be scored.
    assert.ok((await evidence()).every(e => e.criterion !== 'infra' && e.criterion !== 'groups'));
  });
  await check('5_HUMAN_VALIDATION: confirming the multi-terrain proposal makes its evidence VERIFIED by that human, score = 20', async () => {
    const o = await signal('multi');
    await review(A, o.id, 'confirm');
    const e = (await evidence()).find(x => x.id === o.evidence_id);
    assert.equal(e.status, 'VERIFIED'); assert.equal(e.verified_by, A);
    assert.equal((await signal('multi')).review_status, 'VERIFIED');
    assert.equal(await score(), 20);
  });
  await check('6_HUMAN_REJECTION: contradicting the hours proposal gives no point', async () => {
    const hours = await signal('hours');
    await review(A, hours.id, 'contradict');
    const e = (await evidence()).find(x => x.id === hours.evidence_id);
    assert.equal(e.status, 'CONTRADICTED'); assert.equal(e.verified_by, A);
    assert.equal(await score(), 20);
  });
  await check('12_VERIFIED_PROTECTED: a new analysis (same page, then a modified page) never downgrades nor rewrites a reviewed row', async () => {
    const before = await signal('multi'); const beforeEvidence = (await evidence()).find(x => x.id === before.evidence_id);
    await save(A, prA, extract(page('')));
    await save(A, prA, extract(page('<p>Nouveau : bar et vestiaires rénovés.</p>')));
    const after = await signal('multi'); const afterEvidence = (await evidence()).find(x => x.id === after.evidence_id);
    assert.equal(after.id, before.id);
    assert.equal(after.review_status, 'VERIFIED');
    assert.deepEqual(afterEvidence, beforeEvidence);
    assert.equal((await signal('hours')).review_status, 'CONTRADICTED');
    assert.equal(await score(), 20);
  });
  await check('12_ADVERSARIAL_PAYLOAD: a crafted re-save of the verified proposal (value false, other claim, confidence 1) changes nothing', async () => {
    const before = await signal('multi');
    const forged = extract(page('')).find(o => o.observation_type === 'ICP_SIGNAL:multi');
    await save(A, prA, [{ ...forged, value: false, status: 'OBSERVED', claim: 'forged', confidence: 1 }]);
    const after = await signal('multi');
    assert.equal(after.value, true); assert.equal(after.claim, before.claim); assert.equal(after.confidence, before.confidence);
    assert.equal(await score(), 20);
  });
  await check('13_NO_DUPLICATES: re-analyses keep exactly one proposal row per criterion and sentence', async () => {
    const rows = await observations();
    for (const key of ['multi', 'hours', 'slot']) assert.equal(rows.filter(o => o.observation_type === `ICP_SIGNAL:${key}`).length, 1, key);
    const ev = await evidence();
    assert.equal(new Set(ev.map(e => e.id)).size, ev.length);
    assert.equal(ev.filter(e => e.criterion === 'multi').length, 1);
  });
  await check('13_UNVERIFIED_UPDATED_IN_PLACE: an unreviewed proposal is updated in place, never duplicated, on re-analysis', async () => {
    const before = await signal('slot');
    await save(A, prA, extract(page('<p>Encore un autre paragraphe.</p>')));
    const after = await signal('slot');
    assert.equal(after.id, before.id); assert.equal(after.evidence_id, before.evidence_id);
    assert.equal((await evidence()).find(x => x.id === after.evidence_id).status, 'INFERRED_UNCONFIRMED');
  });
  await check('14_TENANT_ISOLATION: another organization cannot read, review or write A\'s proposals', async () => {
    assert.equal((await as(B, 'select * from public.prospect_observations where prospect_id=$1', [prA])).rows.length, 0);
    assert.equal((await as(B, 'select * from public.evidence where prospect_id=$1', [prA])).rows.length, 0);
    const slot = await signal('slot');
    await refused(() => review(B, slot.id, 'confirm'), /not found|member|permission/i, 'a review by another tenant');
    await refused(() => save(B, prA, extract(page(''))), /member|permission/i, 'a save by another tenant');
    await refused(() => as(undefined, 'select public.review_discovery_observation($1,$2)', [slot.id, 'confirm']), /permission denied/i, 'an anonymous review');
    assert.equal((await signal('slot')).review_status, 'NOT_VERIFIED');
  });
  await check('14_NO_DIRECT_VERIFY: a member cannot mark evidence VERIFIED without an authenticated identity (evidence_guard unchanged)', async () => {
    const slot = await signal('slot');
    await sql("select set_config('request.jwt.claim.sub', '', false)");
    await refused(() => sql(`update public.evidence set status='VERIFIED' where id=$1`, [slot.evidence_id]), /Human authentication required/i, 'a VERIFIED without auth.uid()');
  });
  await check('15_SCORE_BOUNDED: confirming every proposal yields exactly the sum of their ICP weights, never more than 100', async () => {
    await review(A, (await signal('slot')).id, 'confirm');
    await review(A, (await signal('hours')).id, 'confirm');
    const s = scoreProspect(ICP, await evidence());
    assert.equal(s.score, 20 + 25 + 10);
    assert.ok(s.score <= 100);
  });
  // ---- Blocker regression: the real production keys (default keys, labels rewritten by the user) ----
  const PROD_ICP = [
    { key: 'target_fit', label: 'Infrastructure sportive physique réservable', weight: 30 },
    { key: 'need_fit', label: 'Réservation par créneau / à l’heure', weight: 25 },
    { key: 'commercial_signal', label: 'Capacité multi-terrains / multi-espaces', weight: 20 },
    { key: 'contactability', label: 'Amplitude horaire étendue', weight: 10 },
    { key: 'criterion_27f71a18-bb19-41f8-a113-b80762f9d61e', label: 'Offres groupes / entreprises / événements', weight: 15 },
  ];
  const pa2 = await project(A, oa);
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [pa2, oa, JSON.stringify(PROD_ICP)]);
  const prP = (await as(A, `insert into public.prospects(organization_id,project_id,name,website,status) values($1,$2,'Padel Tolosa',$3,'À analyser') returning id`, [oa, pa2, URL_A])).rows[0].id;
  const prodPage = page('<p>Tél : 06 73 61 05 45</p>');
  const prodExtract = () => prioritizeObservations(new ObservationService().extract(prodPage, URL_A, PROD_ICP, 'official_website')).map(toStorageSafeObservation);
  const rowsP = async () => (await as(A, 'select o.*, e.status evidence_status from public.prospect_observations o left join public.evidence e on e.id=o.evidence_id where o.prospect_id=$1', [prP])).rows;

  await check('BLOCKER_LEGACY_PHONE_CLEANED: a legacy PHONE_RAW attached to "contactability" is detached (evidence removed) by the next analysis', async () => {
    const legacyPhone = prodExtract().find(o => o.observation_type === 'PHONE_RAW');
    // Exactly what the previous engine stored in production: phone -> contactability, value true.
    await save(A, prP, [{ ...legacyPhone, criterion: 'contactability', value: true, claim: 'Numéro de téléphone professionnel public documenté', confidence: 0.8 }]);
    const before = (await rowsP()).find(o => o.observation_type === 'PHONE_RAW');
    assert.equal(before.criterion, 'contactability'); assert.ok(before.evidence_id);
    await save(A, prP, prodExtract());
    const rows = await rowsP();
    const phones = rows.filter(o => o.observation_type === 'PHONE_RAW');
    assert.equal(phones.length, 1);
    assert.equal(phones[0].criterion, null); assert.equal(phones[0].value, null); assert.equal(phones[0].evidence_id, null);
    assert.equal((await as(A, 'select count(*)::int n from public.evidence where id=$1', [before.evidence_id])).rows[0].n, 0);
  });
  await check('BLOCKER_NO_CROSS_ASSOCIATION: multi-terrain -> commercial_signal only; schedule -> contactability (hours) + need_fit (slots) only', async () => {
    const rows = (await rowsP()).filter(o => o.criterion);
    const by = x => rows.filter(o => o.source_excerpt === x).map(o => o.criterion).sort();
    assert.deepEqual(by('4 Terrains indoor + 1 terrain de badminton'), ['commercial_signal']);
    assert.deepEqual(by('Créneaux de 1h30 disponibles tous les jours de 7h30 à 00h.'), ['contactability', 'need_fit']);
    assert.ok(rows.filter(o => o.status !== 'UNKNOWN').every(o => o.observation_type.startsWith('ICP_SIGNAL:') && o.evidence_status === 'INFERRED_UNCONFIRMED'));
    const ev = (await as(A, 'select * from public.evidence where prospect_id=$1', [prP])).rows.map(e => ({ ...e, observed_at: new Date(e.observed_at).toISOString() }));
    assert.equal(scoreProspect(PROD_ICP, ev).score, 0);
  });
} finally {
  await db.close();
}

const width = Math.max(...results.map(r => r[0].length));
for (const [name, status, detail] of results) console.log(`${status}  ${name.padEnd(width)}  ${detail}`);
const failed = results.filter(r => r[1] !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
