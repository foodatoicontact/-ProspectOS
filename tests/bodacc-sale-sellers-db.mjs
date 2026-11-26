// Migration 058 — les cédants dans les reprises (owner decision, 26 nov. 2026), on real PostgreSQL (PGlite), full chain.
// The collection stores a sale's seller (a company's SIREN, or only the fact that it is a natural person); the backfill sets
// a seller once and never overwrites it; nothing of a natural person can be stored; the sellers are enriched like any
// company; and the search « Entreprises ayant cédé un fonds » returns companies only — never a sole trader, never a company
// that objects to prospecting, never a merger, a contribution or a cancelled notice — by NAF code, departments and period,
// to the server only. WITHOUT_058=1: the checks must fail.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
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
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).replace(/\n/g, ' ').slice(0, 400)]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
}
const url = id => `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${id}`;
const ev = (id, o = {}) => ({ source_id: id, kind: 'VENTE_FONDS', siren: o.buyer ?? '111111118', name: 'ACHETEUR', published_on: o.day ?? '2026-11-20',
  department: o.dep ?? '75', commune: 'Paris', postal_code: '75011', activity: o.activity ?? 'Restaurant', source_url: url(id), sale_rule: 'category_purchase', ...o.extra });

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_058 && f.startsWith('058_')));
  assert.ok(process.env.WITHOUT_058 || migrations.includes('058_bodacc_sale_sellers.sql'), 'migration 058 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const ingest = events => asService(`select public.ingest_public_events('bodacc',$1,$2,0,0,'{}'::jsonb,'[]'::jsonb) r`, [today, JSON.stringify(events)]);
  const row = async id => (await sql('select seller_kind,seller_siren from public.public_events where source_id=$1', [id])).rows[0];

  await check('INGEST: a company seller is stored with its SIREN, a natural person as « PP » alone, an unknown seller as « UNKNOWN »', async () => {
    await ingest([
      ev('A1', { day: daysAgo(10), extra: { seller_kind: 'PM', seller_siren: '552100554' } }),
      ev('A2', { day: daysAgo(12), extra: { seller_kind: 'PP', seller_siren: '999999999' } }),
      ev('A3', { day: daysAgo(14), extra: { seller_kind: 'UNKNOWN' } }),
      ev('A4', { day: daysAgo(15) }),
    ]);
    assert.deepEqual(await row('A1'), { seller_kind: 'PM', seller_siren: '552100554' });
    assert.deepEqual(await row('A2'), { seller_kind: 'PP', seller_siren: null }, 'a natural person’s number is never stored, even if sent');
    assert.deepEqual(await row('A3'), { seller_kind: 'UNKNOWN', seller_siren: null });
    assert.deepEqual(await row('A4'), { seller_kind: null, seller_siren: null }, 'not read yet');
  });

  await check('CHECK: the table itself refuses a SIREN without « PM », a « PM » without SIREN, a seller on a creation', async () => {
    await refused(() => sql(`update public.public_events set seller_siren='552100554' where source_id='A2'`), /check constraint/i, 'a SIREN on a natural person');
    await refused(() => sql(`update public.public_events set seller_siren=null where source_id='A1'`), /check constraint/i, 'a company without its SIREN');
    await ingest([{ ...ev('C1'), kind: 'CREATION', sale_rule: undefined }]);
    await refused(() => sql(`update public.public_events set seller_kind='UNKNOWN' where source_id='C1'`), /check constraint/i, 'a seller on a creation');
  });

  await check('BACKFILL: a seller is set once, never overwritten; malformed rows are refused; server only', async () => {
    const r = (await asService(`select public.set_public_event_sellers($1) r`, [JSON.stringify([
      { source_id: 'A4', seller_kind: 'PM', seller_siren: '732829320' }, { source_id: 'A1', seller_kind: 'PP' }])])).rows[0].r;
    assert.equal(r.updated, 1);
    assert.deepEqual(await row('A4'), { seller_kind: 'PM', seller_siren: '732829320' });
    assert.deepEqual(await row('A1'), { seller_kind: 'PM', seller_siren: '552100554' }, 'never overwritten');
    await refused(() => asService(`select public.set_public_event_sellers($1)`, [JSON.stringify([{ source_id: 'A3', seller_kind: 'PP', seller_siren: '552100554' }])]), /Invalid sellers/, 'a natural person with a number');
    await refused(() => asService(`select public.set_public_event_sellers($1)`, [JSON.stringify([{ source_id: 'A3', seller_kind: 'PM' }])]), /Invalid sellers/, 'a company without SIREN');
    await refused(() => as('00000000-0000-4000-8000-000000000001', `select public.set_public_event_sellers('[]')`), /permission denied/i, 'a browser');
  });

  await check('ENRICH: the sellers are enriched in every department, like any company', async () => {
    await ingest([ev('B1', { dep: '13', day: daysAgo(5), extra: { seller_kind: 'PM', seller_siren: '444444442' } })]);
    const s = (await asService(`select * from public.sirens_to_enrich(array['75'],array['VENTE_FONDS'],$1,100) s`, [daysAgo(60)])).rows.map(r => r.s);
    assert.ok(s.includes('552100554') && s.includes('444444442'), 'the sellers, in Paris and in the Bouches-du-Rhône');
    assert.ok(s.includes('111111118'), 'the buyers as before');
    assert.ok(!s.includes('999999999'));
  });

  const cache = (siren, o = {}) => sql(`insert into public.company_cache(siren,name,naf,legal_form,active,individual,opposition,department,commune,expires_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '30 days')`, [siren, o.individual ? null : (o.name ?? `SOC ${siren}`), o.naf ?? '56.10A', o.individual ? '1000' : '5710',
    o.active ?? true, !!o.individual, !!o.opposition, o.dep ?? '75', 'Paris']);
  await check('SEARCH: companies only, of the NAF codes asked, in the departments and period; one row per seller, its latest sale', async () => {
    await cache('552100554'); await cache('732829320', { naf: '47.11B' }); await cache('444444442');
    await ingest([
      ev('D1', { day: daysAgo(3), extra: { seller_kind: 'PM', seller_siren: '552100554' } }),          // a second sale of the same seller
      ev('D2', { day: daysAgo(4), extra: { seller_kind: 'PM', seller_siren: '123456782' } }),          // a sole trader in the register
      ev('D3', { day: daysAgo(6), extra: { seller_kind: 'PM', seller_siren: '987654324' } }),          // objects to prospecting
      ev('D4', { day: daysAgo(200), extra: { seller_kind: 'PM', seller_siren: '350000002' } }),        // too old
      ev('D5', { day: daysAgo(7), extra: { seller_kind: 'PM', seller_siren: '780000007' } }),          // not in the register yet
      { ...ev('F1', { day: daysAgo(2), extra: { seller_kind: 'PM', seller_siren: '360000001' } }), kind: 'FUSION', sale_rule: 'text_merger' },
      ev('X1', { day: daysAgo(2), extra: { seller_kind: 'PM', seller_siren: '370000000' } }),          // cancelled below
    ]);
    await cache('123456782', { individual: true }); await cache('987654324', { opposition: true }); await cache('350000002'); await cache('360000001'); await cache('370000000');
    await sql(`update public.public_events set status='ANNULEE',status_source_id='X2',status_url=$1 where source_id='X1'`, [url('X2')]);
    const search = (deps, naf, days = 90) => asService(`select public.sale_sellers($1,$2,$3,50) r`, [deps, daysAgo(days), naf]).then(r => r.rows[0].r);
    const r = await search(['75'], ['56']);
    assert.deepEqual(r.map(x => x.siren), ['552100554'], 'restauration in Paris: one company, once');
    assert.equal(r[0].sale.notice_id, 'D1', 'its latest sale');
    assert.equal(r[0].name, 'SOC 552100554'); assert.equal(r[0].naf, '56.10A');
    assert.deepEqual(Object.keys(r[0]).sort(), ['active', 'commune', 'department', 'naf', 'name', 'sale', 'siren']);
    assert.deepEqual((await search(['75'], [])).map(x => x.siren).sort(), ['552100554', '732829320'], 'every activity');
    assert.deepEqual((await search(['75'], ['47.11'])).map(x => x.siren), ['732829320']);
    assert.deepEqual((await search(['13'], ['56'])).map(x => x.siren), ['444444442']);
    assert.ok((await search(['75'], ['56'], 365)).some(x => x.siren === '350000002'), 'a longer period');
    await refused(() => asService(`select public.sale_sellers(array['75'],$1,array['abc'],10)`, [daysAgo(30)]), /Invalid seller search/, 'a malformed NAF code');
    await refused(() => asService(`select public.sale_sellers(array[]::text[],$1,null,10)`, [daysAgo(30)]), /Invalid seller search/, 'no department');
    await refused(() => asService(`select public.sale_sellers(array['75'],$1,null,10)`, [daysAgo(500)]), /Invalid seller search/, 'more than 400 days');
    await refused(() => as('00000000-0000-4000-8000-000000000001', `select public.sale_sellers(array['75'],current_date-30,null,10)`), /permission denied/i, 'a signed-in browser');
    await refused(() => as(undefined, `select public.sale_sellers(array['75'],current_date-30,null,10)`), /permission denied/i, 'anon');
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
