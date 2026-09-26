// V2 P0-a — semantic ICP proposals against the REAL storage and review RPCs (PGlite, full migration chain):
// save_discovery_observations stores an intent proposal as INFERRED_UNCONFIRMED evidence and an intent note
// as a criterion-less context row; review_discovery_observation is the only way to VERIFIED; the existing
// scoring engine gives the exact points; a new analysis never downgrades a reviewed row. No migration added.
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

// An ICP written with the user's own words and opaque keys (weights sum to 100).
const ICP = [
  { key: 'c_courses', label: 'Cours ou séances proposés', weight: 40 },
  { key: 'c_schedule', label: 'Planning / activité régulière', weight: 20 },
  { key: 'c_booking', label: 'Réservation ou inscription en ligne', weight: 20 },
  { key: 'c_events', label: 'Tournois / événementiel', weight: 20 },
];
const URL_A = 'https://studio.fixture.example/';
const page = lines => `<html><head><title>Studio</title></head><body>${lines.map(l => `<p>${l}</p>`).join('')}</body></html>`;
const extract = lines => prioritizeObservations(new ObservationService().extract(page(lines), URL_A, ICP, 'official_website')).map(toStorageSafeObservation);
const FIRST = ['Prenez votre premier cours', 'Planning des cours : lundi 18h30, jeudi 19h.', 'Pas de réservation en ligne : venez sur place.', 'Retour sur notre tournoi 2022.'];

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
  await sql(`insert into auth.users(id,email) values ($1,'a@test')`, [A]);
  const org = (await as(A, `select public.create_organization('Org') id`)).rows[0].id;
  const project = (await as(A, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [org])).rows[0].id;
  await sql(`insert into public.icps(project_id,organization_id,criteria) values ($1,$2,$3::jsonb)`, [project, org, JSON.stringify(ICP)]);
  const prospect = (await as(A, `insert into public.prospects(organization_id,project_id,name,website,status) values($1,$2,'Studio',$3,'À analyser') returning id`, [org, project, URL_A])).rows[0].id;

  const save = observations => as(A, 'select public.save_discovery_observations($1,$2::jsonb) r', [prospect, JSON.stringify(observations)]);
  const review = (id, decision) => as(A, 'select public.review_discovery_observation($1,$2) r', [id, decision]);
  const observations = async () => (await as(A, 'select * from public.prospect_observations where prospect_id=$1', [prospect])).rows;
  const evidence = async () => (await as(A, 'select * from public.evidence where prospect_id=$1', [prospect])).rows.map(e => ({ ...e, observed_at: new Date(e.observed_at).toISOString() }));
  const signal = async key => (await observations()).find(o => o.observation_type === `ICP_SIGNAL:${key}`);
  const score = async () => scoreProspect(ICP, await evidence()).score;

  await check('STORED: intent proposals become INFERRED_UNCONFIRMED evidence, 0 point, nothing VERIFIED', async () => {
    await save(extract(FIRST));
    for (const key of ['c_courses', 'c_schedule']) {
      const o = await signal(key);
      assert.ok(o, key); assert.equal(o.status, 'INFERRED'); assert.equal(o.value, true); assert.equal(o.review_status, 'NOT_VERIFIED');
      const e = (await evidence()).find(x => x.id === o.evidence_id);
      assert.equal(e.status, 'INFERRED_UNCONFIRMED'); assert.equal(e.verified_by, null);
    }
    assert.equal(await signal('c_booking'), undefined, 'a negated booking is never a proposal');
    assert.equal(await signal('c_events'), undefined, 'a past tournament is never a proposal');
    assert.ok((await evidence()).every(e => e.status !== 'VERIFIED'));
    assert.equal(await score(), 0);
  });
  await check('NOTES: negative / insufficient notes are stored as context rows — no criterion, no evidence, no value', async () => {
    const notes = (await observations()).filter(o => o.observation_type.startsWith('ICP_INTENT_'));
    assert.deepEqual(notes.map(n => n.observation_type).sort(), ['ICP_INTENT_INSUFFICIENT', 'ICP_INTENT_NEGATIVE']);
    for (const n of notes) { assert.equal(n.criterion, null); assert.equal(n.evidence_id, null); assert.equal(n.value, null); assert.match(n.claim, /0 point/); }
    assert.ok((await evidence()).every(e => e.criterion !== 'c_booking' && e.criterion !== 'c_events'));
  });
  await check('HUMAN: confirming the courses proposal makes it VERIFIED by that human; the existing engine gives exactly 40', async () => {
    const o = await signal('c_courses');
    await review(o.id, 'confirm');
    const e = (await evidence()).find(x => x.id === o.evidence_id);
    assert.equal(e.status, 'VERIFIED'); assert.equal(e.verified_by, A);
    assert.equal(await score(), 40);
  });
  await check('12_REANALYSIS: new analyses (same page, then a page where the sentence is gone and a negation appeared) never downgrade the VERIFIED row', async () => {
    const before = await signal('c_courses'); const beforeEvidence = (await evidence()).find(x => x.id === before.evidence_id);
    await save(extract(FIRST));
    await save(extract(['Aucun cours cet été.', 'Planning des cours : lundi 18h30, jeudi 19h.']));
    const rows = (await observations()).filter(o => o.observation_type === 'ICP_SIGNAL:c_courses');
    const after = rows.find(o => o.id === before.id); const afterEvidence = (await evidence()).find(x => x.id === after.evidence_id);
    assert.equal(after.review_status, 'VERIFIED');
    assert.deepEqual(afterEvidence, beforeEvidence);
    // The new page's own sentence is a NEW proposal, still to review — it never replaces the verified one.
    const fresh = rows.filter(o => o.id !== before.id);
    assert.equal(fresh.length, 1); assert.equal(fresh[0].review_status, 'NOT_VERIFIED');
    assert.equal((await evidence()).find(x => x.id === fresh[0].evidence_id).status, 'INFERRED_UNCONFIRMED');
    assert.equal(await score(), 40);
    assert.equal((await signal('c_schedule')).review_status, 'NOT_VERIFIED', 'the unreviewed proposal stays a proposal');
  });
} finally {
  await db.close();
}

const width = Math.max(...results.map(r => r[0].length));
for (const [name, status, detail] of results) console.log(`${status}  ${name.padEnd(width)}  ${detail}`);
const failed = results.filter(r => r[1] !== 'PASS');
console.log(`\nSEMANTIC ICP DB: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
