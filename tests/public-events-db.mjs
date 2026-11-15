// Migration 045 — national collection of public events, on real PostgreSQL (PGlite) with the full migration chain: each
// announcement is stored once, only the server writes and reads, the enrichment follows the departments asked and skips
// fresh records, a sole trader's name is never kept, old announcements are purged.
// WITHOUT_045=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_045 && f.startsWith('045_')));
  assert.ok(process.env.WITHOUT_045 || migrations.includes('045_public_events.sql'), 'migration 045 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test.fr')`, [A]);
  const ev = (id, siren, kind, dep, day) => ({ source_id: id, kind, siren, name: `SOCIETE ${id}`, published_on: day, department: dep, commune: 'Meaux', postal_code: '77100', activity: 'Entreposage', source_url: `https://www.bodacc.fr/annonce/${id}` });
  const today = (await sql(`select current_date::text d`)).rows[0].d;
  await check('INGEST: stored once (replay-safe), the run is recorded; server only', async () => {
    const events = [ev('A1', '900000001', 'CREATION', '77', today), ev('A2', '900000002', 'TRANSFERT_SIEGE', '75', today), ev('A3', '900000003', 'VENTE_FONDS', '13', today)];
    const r1 = (await asService(`select public.ingest_public_events('bodacc',current_date,$1,5,2) r`, [JSON.stringify(events)])).rows[0].r;
    assert.equal(r1.inserted, 3);
    const r2 = (await asService(`select public.ingest_public_events('bodacc',current_date,$1,5,2) r`, [JSON.stringify(events)])).rows[0].r;
    assert.equal(r2.inserted, 0, 'a replay stores nothing twice');
    assert.equal((await sql(`select count(*)::int n from public.public_events`)).rows[0].n, 3);
    assert.deepEqual((await sql(`select fetched,inserted,skipped_persons from public.public_event_runs order by id`)).rows.map(r => [r.fetched, r.inserted, r.skipped_persons]), [[5, 3, 2], [5, 0, 2]]);
    await refused(() => as(A, `select public.ingest_public_events('bodacc',current_date,'[]',0,0)`), /permission denied/i, 'a signed-in user ingesting');
    await refused(() => asService(`select public.ingest_public_events('bodacc',current_date,$1,1,0)`, [JSON.stringify([{ ...ev('B1', '123', 'CREATION', '77', today) }])]), /check constraint|violates/i, 'a malformed SIREN');
    await refused(() => asService(`select public.ingest_public_events('bodacc',current_date,$1,1,0)`, [JSON.stringify([{ ...ev('B2', '900000009', 'RADIATION', '77', today) }])]), /check constraint|violates/i, 'an unknown kind');
  });
  await check('NO_BROWSER_ACCESS: no browser role reads or writes the collection', async () => {
    for (const t of ['public_events', 'company_cache', 'public_event_runs']) {
      await refused(() => as(A, `select * from public.${t}`), /permission denied/i, `authenticated reading ${t}`);
      await refused(() => as(undefined, `select * from public.${t}`), /permission denied/i, `anon reading ${t}`);
    }
    await refused(() => as(A, `select public.upsert_company_cache('[]')`), /permission denied/i, 'a user writing the cache');
    await refused(() => as(A, `select * from public.sirens_to_enrich(null,null,current_date,10)`), /permission denied/i, 'a user listing SIRENs');
  });
  await check('ENRICH: only the departments and kinds asked, only missing or expired records; a sole trader keeps no name', async () => {
    const list = async (deps) => (await asService(`select * from public.sirens_to_enrich($1,null,current_date-30,100) s`, [deps])).rows.map(r => r.s).sort();
    assert.deepEqual(await list(['75', '77']), ['900000001', '900000002']);
    await asService(`select public.upsert_company_cache($1)`, [JSON.stringify([
      { siren: '900000001', name: 'SOCIETE A1', naf: '52.10B', legal_form: '5710', employee_band: '12', active: true, individual: false, opposition: false, department: '77', commune: 'Meaux' },
      { siren: '900000002', name: 'Jean DUPONT', naf: '70.22Z', legal_form: '1000', employee_band: 'NN', active: true, individual: true, opposition: false, department: '75', commune: 'Paris' }])]);
    assert.deepEqual(await list(['75', '77']), [], 'fresh records are not fetched again');
    assert.equal((await sql(`select name from public.company_cache where siren='900000002'`)).rows[0].name, null, 'no personal name kept');
    await sql(`update public.company_cache set expires_at=now()-interval '1 day' where siren='900000001'`);
    assert.deepEqual(await list(['77']), ['900000001'], 'an expired record is fetched again');
  });
  await check('PURGE: old announcements go; a recent cutoff is refused', async () => {
    await refused(() => asService(`select public.purge_public_events(current_date-5)`), /Invalid purge date/, 'a purge of last week');
    await sql(`update public.public_events set published_on=current_date-400 where source_id='A3'`);
    assert.equal((await asService(`select public.purge_public_events(current_date-365) n`)).rows[0].n, 1);
    assert.equal((await sql(`select count(*)::int n from public.public_events`)).rows[0].n, 2);
  });
  await check('NOTHING_ELSE: no existing table, policy or function is touched', async () => {
    const m = (await readFile(new URL('../db/migrations/045_public_events.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table|on) public\.(?!(public_events|company_cache|public_event_runs)\b)\w+/i);
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
