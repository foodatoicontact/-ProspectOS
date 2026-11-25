// Migration 054 — weekly watch on the BODACC sale sort, on real PostgreSQL (PGlite) with the full migration chain: a run
// stores its rule counts (ids and numbers only, validated), the five-argument call of 045 still works, the counts are summed
// per week for the check, and only the server calls either function. Owner decision, 25 nov. 2026.
// WITHOUT_054=1 runs the checks without the migration: they must fail.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = (text, params = []) => db.query(text, params);
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
async function asService(text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', '', false)");
  await sql('set role service_role');
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
const ATTEST = 'J\'atteste l\'exactitude de ce relevé';
// A small but real PDF (the proposal made by `npm run devis` in practice) and its SHA-256 computed here, independently.
const pdfBytes = text => Buffer.from(`%PDF-1.4\n% proposition ${text}\n${'x'.repeat(200)}\n%%EOF\n`, 'latin1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const item = (siren, name) => ({ siren, name, city: 'Meaux', source_label: 'BODACC — création', source_url: `https://www.bodacc.fr/annonce/${siren}` });

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
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_054 && f.startsWith('054_')));
  assert.ok(process.env.WITHOUT_054 || migrations.includes('054_bodacc_sale_rule_counts.sql'), 'migration 054 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test.fr')`, [A]);
  const ingest = (day, rules) => asService(`select public.ingest_public_events('bodacc',$1::date,'[]',10,0,$2::jsonb) r`, [day, JSON.stringify(rules)]);
  await check('RUN_COUNTS: a vente run stores its rule counts; the five-argument call of 045 still works and stores none', async () => {
    await ingest('2026-11-20', { category_purchase: 5, text_merger: 4, no_rule: 1 });
    await asService(`select public.ingest_public_events('bodacc','2026-11-20'::date,'[]',3,0) r`);
    assert.deepEqual((await sql(`select sale_rules from public.public_event_runs order by id`)).rows.map(r => r.sale_rules), [{ category_purchase: 5, text_merger: 4, no_rule: 1 }, {}]);
  });
  await check('VALIDATED: only an object of rule ids and whole counts; nothing that could carry a text', async () => {
    for (const [bad, what] of [[['x'], 'an array'], [{ category_purchase: 'Jean DUPONT' }, 'a text value'], [{ 'Jean DUPONT': 1 }, 'a text key'],
      [{ category_purchase: -1 }, 'a negative count'], [{ category_purchase: 1.5 }, 'a fraction'], [{ category_purchase: 100001 }, 'an absurd count'],
      [Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`r${'_'.repeat(i)}`, 1])), 'too many keys']])
      await refused(() => ingest('2026-11-20', bad), /Invalid sale rules/, what);
  });
  await check('WEEKS: summed per week of 7 days before the day asked, newest first, a replayed day counted once', async () => {
    await sql(`delete from public.public_event_runs`);
    await ingest('2026-11-23', { category_purchase: 2 });          // week starting 2026-11-18 (until 2026-11-25)
    await ingest('2026-11-23', { category_purchase: 3, no_rule: 1 }); // replay of the same day: this run counts, not the first
    await ingest('2026-11-18', { text_merger: 4 });
    await ingest('2026-11-17', { category_purchase: 7 });           // previous week
    await ingest('2026-11-25', { category_purchase: 99 });          // the day asked itself: not yet a complete day
    const weeks = (await asService(`select public.bodacc_sale_rule_weeks('2026-11-25'::date,5) w`)).rows[0].w;
    assert.deepEqual(weeks, [{ week_start: '2026-11-18', runs: 2, rules: { category_purchase: 3, no_rule: 1, text_merger: 4 } }, { week_start: '2026-11-11', runs: 1, rules: { category_purchase: 7 } }]);
  });
  await check('SERVER_ONLY: no browser role calls either function or reads the counts', async () => {
    await refused(() => as(A, `select public.bodacc_sale_rule_weeks(current_date,5)`), /permission denied/i, 'a signed-in user reading the weeks');
    await refused(() => as(undefined, `select public.bodacc_sale_rule_weeks(current_date,5)`), /permission denied/i, 'anon reading the weeks');
    await refused(() => as(A, `select public.ingest_public_events('bodacc',current_date,'[]',0,0,'{}'::jsonb)`), /permission denied/i, 'a signed-in user ingesting');
    await refused(() => as(A, `select sale_rules from public.public_event_runs`), /permission denied/i, 'a signed-in user reading the runs');
  });
  await check('NOTHING_ELSE: only its own run table and the collection functions', async () => {
    const m = (await readFile(new URL('../db/migrations/054_bodacc_sale_rule_counts.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table|on) public\.(?!(public_event_runs|public_events)\b)\w+/i);
    assert.doesNotMatch(m, /create policy|alter policy|drop policy|grant [^;]* to (anon|authenticated)/i);
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
} finally {
  await db.close();
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
