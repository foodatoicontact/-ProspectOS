// Migration 046 — référentiel des listes, on real PostgreSQL (PGlite) with the full migration chain: a list keeps its
// companies in order with their sourced events; a sole trader or an objecting company is never stored; only the server
// imports, only the administrator reads; lists are deleted after 3 years.
// WITHOUT_046=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_046 && f.startsWith('046_')));
  assert.ok(process.env.WITHOUT_046 || migrations.includes('046_prospect_lists.sql'), 'migration 046 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const K = '00000000-0000-4000-8000-0000000000ad', A = '00000000-0000-4000-8000-0000000000a1';
  await sql(`insert into auth.users(id,email) values ($1,'admin@test.fr'),($2,'a@test.fr')`, [K, A]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '1 year',now())`, [K]);
  const company = (o = {}) => ({ name: 'EXEMPLE SAS', naf: '55.10Z', legal_form: '5710', employee_band: '12', active: true, individual: false, opposition: false, department: '93', commune: 'Les Lilas', ...o });
  const event = (id, kind = 'VENTE_FONDS', source = 'bodacc') => ({ source, source_id: id, kind, published_on: '2026-11-10', name: 'EXEMPLE SAS', department: '93', commune: 'Les Lilas', postal_code: '93260', activity: 'Hôtellerie', source_url: `https://www.bodacc.fr/annonce/${id}` });
  const list = { code: 'hotels-idf-2026-11', title: 'Hôtels et restaurants repris', purpose: 'Reprises de fonds', zone: 'Île-de-France', client_label: 'Exemple Hôtellerie', produced_on: '2026-11-13',
    items: [
      { siren: '900000001', company: company(), event: event('A1') },
      { siren: '900000002', company: company({ individual: true, name: 'Jean DUPONT' }), event: event('A2') },
      { siren: '900000003', company: company({ opposition: true }), event: event('A3') },
      { siren: '900000004', company: company({ name: 'ENTREPOT EXEMPLE' }), event: event('G1', 'INSPECTION_ICPE', 'georisques') },
      { siren: '900000005', company: company({ name: 'RESTO EXEMPLE' }), event: event('A5', 'PROCEDURE_COLLECTIVE') }] };
  await check('IMPORT: companies only — a sole trader or an objecting company is left out and counted; idempotent', async () => {
    const r = (await asService(`select public.import_prospect_list($1) r`, [JSON.stringify(list)])).rows[0].r;
    assert.deepEqual([r.items, r.excluded, r.already], [3, 2, false]);
    const items = (await sql(`select position,siren,event_source,event_source_id from public.prospect_list_items order by position`)).rows;
    assert.deepEqual(items.map(i => [i.position, i.siren]), [[1, '900000001'], [2, '900000004'], [3, '900000005']], 'the list order, without the excluded ones');
    assert.equal((await sql(`select count(*)::int n from public.company_cache where siren in ('900000002','900000003')`)).rows[0].n, 0, 'nothing stored about them');
    assert.equal((await sql(`select count(*)::int n from public.public_events where source_id in ('A2','A3')`)).rows[0].n, 0);
    assert.ok(!JSON.stringify((await sql(`select * from public.company_cache`)).rows).includes('DUPONT'), 'no natural person');
    const again = (await asService(`select public.import_prospect_list($1) r`, [JSON.stringify(list)])).rows[0].r;
    assert.equal(again.already, true); assert.equal((await sql(`select count(*)::int n from public.prospect_list_items`)).rows[0].n, 3);
    const kinds = (await sql(`select source,kind from public.public_events order by source_id`)).rows.map(r => `${r.source}:${r.kind}`);
    assert.deepEqual(kinds, ['bodacc:VENTE_FONDS', 'bodacc:PROCEDURE_COLLECTIVE', 'georisques:INSPECTION_ICPE']);
    assert.equal((await sql(`select keep_until::text k from public.prospect_lists`)).rows[0].k, '2029-11-13', 'kept 3 years');
  });
  await check('ACCESS: only the server imports; only the administrator reads the lists; no browser access to the tables', async () => {
    await refused(() => as(A, `select public.import_prospect_list($1)`, [JSON.stringify({ ...list, code: 'autre-liste' })]), /permission denied/i, 'a user importing');
    await refused(() => as(A, `select public.admin_prospect_lists()`), /Admin access required/, 'a user reading the lists');
    assert.equal((await as(K, `select public.admin_prospect_lists() r`)).rows[0].r[0].items, 3);
    for (const t of ['prospect_lists', 'prospect_list_items']) {
      await refused(() => as(A, `select * from public.${t}`), /permission denied/i, `a user reading ${t}`);
      await refused(() => as(K, `select * from public.${t}`), /permission denied/i, `the administrator reading ${t} directly`);
    }
    await refused(() => as(undefined, `select public.admin_prospect_lists()`), /permission denied/i, 'anon');
  });
  await check('RETENTION: a list past its retention date is deleted with its items', async () => {
    await sql(`update public.prospect_lists set keep_until=current_date-1`);
    assert.equal((await asService(`select public.purge_prospect_lists() n`)).rows[0].n, 1);
    assert.equal((await sql(`select count(*)::int n from public.prospect_list_items`)).rows[0].n, 0);
  });
  await check('NOTHING_ELSE: only public_events checks are widened; no other existing object is touched', async () => {
    const m = (await readFile(new URL('../db/migrations/046_prospect_lists.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table|on) public\.(?!(public_events|company_cache|prospect_lists|prospect_list_items)\b)\w+/i);
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
