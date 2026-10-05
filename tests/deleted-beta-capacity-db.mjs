// PostgreSQL integration coverage for migration 018: a deleted account gives its beta seat back, is never an
// active trial again, keeps its history, and the capacity limit still binds real accounts. Same PGlite harness
// as tests/stripe-billing-db.mjs (whole migration chain, Supabase role/JWT shim).
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
const U = n => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const seats = async () => (await sql('select prospectos_private.beta_seats_used() n')).rows[0].n;
const ent = async u => (await sql('select plan,status from public.account_entitlements where user_id=$1', [u])).rows[0] ?? null;
const addUser = (id, email) => sql('insert into auth.users(id,email) values ($1,$2)', [id, email]);

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(),
      email_confirmed_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  // Later migrations must not touch accounts or beta capacity: 019 (Discovery register provider) only widens Discovery providers.
  assert.deepEqual(migrations.slice(migrations.indexOf('018_deleted_accounts_release_beta_capacity.sql')), ['018_deleted_accounts_release_beta_capacity.sql', '019_discovery_registry_provider.sql']);
  assert.doesNotMatch((await readFile(new URL('../db/migrations/019_discovery_registry_provider.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.startsWith('--')).join('\n'), /account_entitlements|beta_program|delete_own_account|memberships/i);
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  await sql('update prospectos_private.beta_program set capacity=3');

  const [a, b, c, d, e] = [U(1), U(2), U(3), U(4), U(5)];
  for (const [id, k] of [[a, 'a'], [b, 'b'], [c, 'c'], [d, 'd'], [e, 'e']]) await addUser(id, `${k}@test`);

  await check('ACTIVE_BETA_COUNTS: an activated trial takes a seat', async () => {
    assert.equal(await seats(), 0);
    await as(a, 'select public.activate_trial()');
    assert.deepEqual(await ent(a), { plan: 'BETA', status: 'ACTIVE' });
    assert.equal(await seats(), 1);
  });

  await check('CAPACITY_STILL_BINDS: real accounts fill the beta and the next one is refused', async () => {
    await as(b, 'select public.activate_trial()');
    await as(c, 'select public.activate_trial()');
    assert.equal(await seats(), 3);
    await refused(() => as(d, 'select public.activate_trial()'), /BETA_CAPACITY_REACHED/, 'a 4th trial with capacity 3');
    assert.equal(await ent(d), null);
  });

  // b has history: an organization (no project, so deletion is allowed) and its audit events.
  const orgB = (await as(b, `select public.create_organization('Org B') id`)).rows[0].id;
  const eventsBefore = (await sql('select count(*)::int n from public.events')).rows[0].n;

  await check('DELETION_FREES_SEAT_IMMEDIATELY: delete_own_account marks REVOKED and the seat is back', async () => {
    const r = (await as(b, 'select public.delete_own_account() r')).rows[0].r;
    assert.equal(r.memberships_removed, true);
    assert.deepEqual(await ent(b), { plan: 'BETA', status: 'REVOKED' }, 'row kept, marked REVOKED');
    assert.equal(await seats(), 2);
  });

  await check('DELETED_NOT_ACTIVE_TRIAL: a deleted account never gets a new or running trial back', async () => {
    const r = (await as(b, 'select public.activate_trial() r')).rows[0].r;
    assert.equal(r.status, 'REVOKED', 'activate_trial returns the closed row unchanged');
    assert.equal(await seats(), 2, 'no seat taken back');
  });

  await check('ACTIVATE_AFTER_RELEASE: the freed seat goes to the next real account', async () => {
    await as(d, 'select public.activate_trial()');
    assert.deepEqual(await ent(d), { plan: 'BETA', status: 'ACTIVE' });
    assert.equal(await seats(), 3);
    await refused(() => as(e, 'select public.activate_trial()'), /BETA_CAPACITY_REACHED/, 'a trial beyond capacity after the release');
  });

  await check('ADMIN_REGRANT_RECHECKS_CAPACITY: grant_beta_access cannot hand a seat back to a closed account over capacity', async () => {
    await sql(`update auth.users set email='b-again@test' where id=$1`, [b]);
    await refused(() => sql(`select public.grant_beta_access('b-again@test')`), /BETA_CAPACITY_REACHED/, 're-grant of a REVOKED row with no free seat');
    assert.deepEqual(await ent(b), { plan: 'BETA', status: 'REVOKED' });
  });

  await check('HISTORY_KEPT: events, organization and entitlement row of the deleted account are untouched', async () => {
    assert.equal((await sql('select count(*)::int n from public.events')).rows[0].n, eventsBefore);
    assert.equal((await sql('select count(*)::int n from public.organizations where id=$1', [orgB])).rows[0].n, 1);
    assert.equal((await sql('select count(*)::int n from public.account_entitlements where user_id=$1', [b])).rows[0].n, 1);
    assert.equal((await sql('select count(*)::int n from auth.users where id=$1', [b])).rows[0].n, 1);
  });

  await check('ANALYTICS: beta_used excludes the deleted account, which stays listed as REVOKED', async () => {
    await sql(`insert into auth.users(id,email) values ($1,'admin@test')`, [U(9)]);
    await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'INTERNAL','ACTIVE',now(),now()+interval '100 years')`, [U(9)]);
    const r = (await as(U(9), 'select public.beta_analytics() r')).rows[0].r;
    assert.equal(r.beta_used, 3);
    assert.equal(r.capacity, 3);
    assert.equal(r.users.find(u => u.user_id === b)?.status, 'REVOKED');
  });

  await check('CROSS_TENANT: deletion only touches the caller; nobody reads another entitlement or the seat counter', async () => {
    assert.deepEqual(await ent(a), { plan: 'BETA', status: 'ACTIVE' });
    assert.equal((await as(a, 'select count(*)::int n from public.account_entitlements')).rows[0].n, 1, 'self row only (RLS)');
    assert.equal((await as(a, 'select count(*)::int n from public.account_entitlements where user_id=$1', [d])).rows[0].n, 0);
    await refused(() => as(a, 'select prospectos_private.beta_seats_used()'), /permission denied/, 'beta_seats_used from authenticated');
    await refused(() => as(undefined, 'select public.delete_own_account()'), /permission denied|Authentication required/, 'anon delete_own_account');
    await refused(() => as(a, `update public.account_entitlements set status='REVOKED' where user_id=$1`, [d]), /permission denied/, 'client write on entitlements');
  });

  await check('LEGACY_REPAIR: only server-anonymized, banned, membership-less accounts are revoked; a wrong count aborts', async () => {
    const legacy = U(10), decoyNotBanned = U(11), decoyMember = U(12);
    for (const id of [legacy, decoyNotBanned, decoyMember]) {
      await addUser(id, `deleted+${id}@deleted.invalid`);
      await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'BETA','ACTIVE',now(),now()+interval '7 days')`, [id]);
    }
    await sql(`update auth.users set banned_until=now()+interval '100 years' where id in ($1,$2)`, [legacy, decoyMember]);
    await sql(`select public.create_organization('Kept') from (select set_config('request.jwt.claim.sub',$1,false)) s`, [decoyMember]);
    const repair = await readFile(new URL('../db/repairs/018_revoke_deleted_accounts_entitlements.sql', import.meta.url), 'utf8');
    const seatsBefore = await seats();
    await refused(() => db.exec(repair), /Repair aborted: 1 rows matched, 2 expected/, 'repair with a mismatching expected count');
    assert.equal((await ent(legacy)).status, 'ACTIVE', 'aborted repair changed nothing');
    await db.exec(repair.replace('expected_rows int := 2', 'expected_rows int := 1'));
    assert.equal((await ent(legacy)).status, 'REVOKED');
    assert.equal((await ent(decoyNotBanned)).status, 'ACTIVE', 'email pattern alone is never enough');
    assert.equal((await ent(decoyMember)).status, 'ACTIVE', 'an account with a membership is never touched');
    assert.equal(await seats(), seatsBefore - 1);
  });

  await check('PAID_UNTOUCHED: deleting a non-BETA account leaves its entitlement to its own lifecycle', async () => {
    const paid = U(13);
    await addUser(paid, 'paid@test');
    await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'PAID','ACTIVE',now(),now()+interval '30 days')`, [paid]);
    const before = await seats();
    await as(paid, 'select public.delete_own_account()');
    assert.deepEqual(await ent(paid), { plan: 'PAID', status: 'ACTIVE' }, 'Stripe still ends it at period end');
    assert.equal(await seats(), before, 'a paid plan never held a beta seat');
  });

  await check('MIGRATION_IDEMPOTENT: re-applying 018 changes no row', async () => {
    const before = (await sql('select user_id,status from public.account_entitlements order by user_id')).rows;
    await db.exec(await readFile(new URL('../db/migrations/018_deleted_accounts_release_beta_capacity.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await sql('select user_id,status from public.account_entitlements order by user_id')).rows, before);
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
} finally {
  await db.close();
}
for (const [name, status, detail] of results) console.log(`${status} ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`DELETED_BETA_CAPACITY_DB ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
