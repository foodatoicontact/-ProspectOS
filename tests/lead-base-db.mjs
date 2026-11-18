// Migration 049 — base entreprises de la veille, on real PostgreSQL (PGlite) with the full migration chain: one company
// base by SIREN, client profiles, a sorted pool, reservations EXCLUSIVE PER TRADE (owner decision, 18 nov. 2026), the
// delivery that reserves, the release, and one company's whole history. Administrator only.
// WITHOUT_049=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_049 && f.startsWith('049_')));
  assert.ok(process.env.WITHOUT_049 || migrations.includes('049_lead_base.sql'), 'migration 049 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const K = '00000000-0000-4000-8000-0000000000ad', S = '00000000-0000-4000-8000-0000000000a1', G = '00000000-0000-4000-8000-0000000000b1', H = '00000000-0000-4000-8000-0000000000c1';
  await sql(`insert into auth.users(id,email) values ($1,'admin@test.fr'),($2,'detec@test.fr'),($3,'concurrent@test.fr'),($4,'capston@test.fr')`, [K, S, G, H]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const [o1, o2, o3] = [await org(S), await org(G), await org(H)];
  const pdf = Buffer.from(`%PDF-1.4\n% proposition\n${'x'.repeat(200)}\n%%EOF\n`, 'latin1');
  const sha = createHash('sha256').update(pdf).digest('hex');
  const contract = async (orgId, user, label) => {
    const c = (await as(K, `select public.propose_dedicated_watch($1,$2,9900,17900,15,'2026-11-16','2026-01-01','proposition.pdf',$3) r`, [orgId, label, pdf.toString('base64')])).rows[0].r;
    await as(user, `select public.accept_dedicated_proposal($1,$2)`, [c.id, sha]);
    return c.id;
  };
  const [c1, c2, c3] = [await contract(o1, S, 'Veille Détec'), await contract(o2, G, 'Veille concurrent'), await contract(o3, H, 'Veille Capston')];
  const item = siren => ({ siren, name: `Société ${siren}`, city: 'Pantin', source_label: 'BODACC — vente de fonds', source_url: `https://www.bodacc.fr/annonce/${siren}` });
  const deliver = (contractId, sirens) => as(K, `select public.create_dedicated_delivery($1,'IDF',$2)`, [contractId, JSON.stringify(sirens.map(item))]);
  // Companies: A sale (93), B creation (93), C opposed, D sole trader, E outside the zone (13), F not enriched yet, R restaurant (NAF 56).
  const today = new Date().toISOString().slice(0, 10);
  const companies = [['900000001', 'VENTE_FONDS', '93', { naf: '55.10Z' }], ['900000002', 'CREATION', '93', { naf: '55.10Z' }], ['900000003', 'VENTE_FONDS', '93', { opposition: true }],
    ['900000004', 'CREATION', '93', { individual: true }], ['900000005', 'VENTE_FONDS', '13', {}], ['900000006', 'TRANSFERT_SIEGE', '93', null], ['900000007', 'TRANSFERT_SIEGE', '93', { naf: '56.10A' }]];
  for (const [siren, kind, dep, c] of companies) {
    await sql(`insert into public.public_events(source,source_id,kind,siren,published_on,department,commune,source_url) values('bodacc',$1,$2,$1,$3,$4,'Pantin','https://www.bodacc.fr/annonce/'||$1)`, [siren, kind, today, dep]);
    if (c) await sql(`insert into public.company_cache(siren,name,naf,legal_form,employee_band,active,individual,opposition,department,commune,expires_at)
      values($1,$2,$3,'5710','11',true,$4,$5,$6,'Pantin',now()+interval '30 days')`, [siren, c.individual ? null : `SOCIETE ${siren}`, c.naf ?? '43.21A', !!c.individual, !!c.opposition, dep]);
  }
  const profile = (contractId, trade, naf = []) => as(K, `select public.admin_set_lead_profile($1,$2,$3,$4,$5,$6) r`, [contractId, trade, trade, ['93', '75'], ['VENTE_FONDS', 'TRANSFERT_SIEGE', 'ETABLISSEMENT', 'CREATION'], naf]).then(x => x.rows[0].r);
  const pool = contractId => as(K, `select public.admin_lead_pool($1,60,100) r`, [contractId]).then(x => x.rows[0].r);
  const sirens = p => p.leads.map(l => l.siren);

  await check('ADMIN ONLY: a client cannot set a profile, read a pool, reserve, read a company, nor read the tables', async () => {
    await refused(() => as(S, `select public.admin_set_lead_profile($1,'x','x',array['93'],array['CREATION'],'{}')`, [c1]), /Admin access required/, 'a client setting a profile');
    await refused(() => as(S, `select public.admin_company('900000001')`), /Admin access required/, 'a client reading a company');
    await refused(() => as(undefined, `select public.admin_lead_pool($1,60,10)`, [c1]), /permission denied/i, 'an anonymous pool');
    await refused(() => as(S, `select * from public.lead_assignments`), /permission denied/i, 'reading the reservations');
    await refused(() => as(S, `select * from public.lead_profiles`), /permission denied/i, 'reading the profiles');
  });
  await check('POOL: business sales and moves first, then creations; never opposed, never a sole trader, never outside the zone', async () => {
    await profile(c1, 'securite-incendie');
    const p = await pool(c1);
    assert.deepEqual(sirens(p), ['900000001', '900000007', '900000002']);
    assert.equal(p.waiting_enrichment, 1, 'a company without its record is counted, not proposed');
    assert.equal(p.leads[0].kind, 'VENTE_FONDS'); assert.equal(p.leads[0].name, 'SOCIETE 900000001');
    await refused(() => pool(c2), /lead_profile_missing/, 'a pool without profile');
  });
  await check('NAF: a profile limited to NAF 55 (hotels) only receives hotels', async () => {
    await profile(c3, 'referencement-ia', ['55']);
    assert.deepEqual(sirens(await pool(c3)), ['900000001', '900000002']);
  });
  await check('EXCLUSIVE PER TRADE: a lead reserved for Détec leaves the pool of its competitor, not of another trade', async () => {
    await profile(c2, 'securite-incendie');
    assert.deepEqual((await as(K, `select public.admin_assign_leads($1,$2) r`, [c1, ['900000001']])).rows[0].r, { reserved: 1, held_by_another_client: [] });
    assert.deepEqual(sirens(await pool(c2)), ['900000007', '900000002'], 'the competitor no longer sees it');
    assert.ok(sirens(await pool(c3)).includes('900000001'), 'another trade still sees it');
    assert.equal((await pool(c1)).leads.find(l => l.siren === '900000001').reserved, true);
    assert.deepEqual((await as(K, `select public.admin_assign_leads($1,$2) r`, [c2, ['900000001', '900000002']])).rows[0].r, { reserved: 1, held_by_another_client: ['900000001'] });
  });
  await check('DELIVERY: delivering a lead reserved for a competitor is refused; delivering its own turns the reservation into a delivery', async () => {
    await refused(() => deliver(c2, ['900000001']), /lead_reserved_for_other_client/, 'a delivery of a lead held by a competitor');
    await deliver(c1, ['900000001']);
    const a = (await sql(`select source,dedicated_item_id is not null linked from public.lead_assignments where siren='900000001' and released_at is null`)).rows;
    assert.deepEqual(a, [{ source: 'DELIVERY', linked: true }]);
    assert.ok(!sirens(await pool(c1)).includes('900000001'), 'a delivered company leaves the client\'s pool');
  });
  await check('PROFILE AFTER DELIVERIES: setting a profile reserves what the client already received', async () => {
    const C4 = '00000000-0000-4000-8000-0000000000d1';
    await sql(`insert into auth.users(id,email) values ($1,'d@test.fr')`, [C4]);
    const c4 = await contract(await org(C4), C4, 'Veille tardive');
    await deliver(c4, ['900000005']);
    const r = await profile(c4, 'nettoyage');
    assert.equal(r.reserved_from_deliveries, 1);
    await refused(() => as(K, `select public.admin_set_lead_profile($1,'autre-metier','x',array['93'],array['CREATION'],'{}')`, [c4]), /lead_trade_locked/, 'changing the trade of a client that holds leads');
  });
  await check('RELEASE: a released lead goes back to the pool of its trade', async () => {
    const id = (await sql(`select id from public.lead_assignments where siren='900000002' and contract_id=$1 and released_at is null`, [c2])).rows[0].id;
    await as(K, `select public.admin_release_lead($1)`, [id]);
    assert.ok(sirens(await pool(c1)).includes('900000002'));
    await refused(() => as(K, `select public.admin_release_lead($1)`, [id]), /lead_assignment_not_found/, 'releasing twice');
  });
  await check('COMPANY: one SIREN, its whole history — record, events, lists, reservations and the client\'s status', async () => {
    const c = (await as(K, `select public.admin_company('900000001') r`)).rows[0].r;
    assert.equal(c.company.name, 'SOCIETE 900000001');
    assert.equal(c.events.length, 1);
    const live = c.assignments.filter(a => !a.released_at).map(a => [a.client, a.source, a.status]);
    assert.deepEqual(live.sort(), [['Veille Détec', 'DELIVERY', 'A_CONTACTER']]);
  });
  await check('NOTHING_ELSE: own tables, admin functions and one insert trigger on dedicated_items only', async () => {
    const m = (await readFile(new URL('../db/migrations/049_lead_base.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table) public\.(?!(lead_profiles|lead_assignments)\b)\w+/i);
    assert.deepEqual([...m.matchAll(/create trigger (\w+) (?:after|before) (\w+) on public\.(\w+)/gi)].map(x => x.slice(1)), [['dedicated_items_reserve_lead', 'insert', 'dedicated_items']]);
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
