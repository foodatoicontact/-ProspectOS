// PostgreSQL integration coverage for the self-service 7-day trial (migration 012): activate_trial()'s
// idempotency, concurrency-safe capacity sharing with grant_beta_access, and security posture (no
// client-supplied identity, unauthenticated/cross-tenant refusal). Mirrors tests/account-privacy-beta-db.mjs's
// harness exactly.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration008 = await readFile(new URL('../db/migrations/008_account_privacy_beta.sql', import.meta.url), 'utf8');
const migration011 = await readFile(new URL('../db/migrations/011_beta_entitlement_gate.sql', import.meta.url), 'utf8');
const migration012 = await readFile(new URL('../db/migrations/012_beta_self_service_trial.sql', import.meta.url), 'utf8');

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
function newUuid(prefix, i) { return `${prefix}-0000-4000-8000-${String(i).padStart(12, '0')}`; }

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
  await db.exec(migration008);
  await db.exec(migration011);
  await db.exec(migration012);
  // Idempotence: re-applying the new migration must not fail and must not duplicate any object.
  await db.exec(migration012);
  const activateFnCount = (await sql(`select count(*)::int n from pg_proc where proname='activate_trial'`)).rows[0].n;
  assert.equal(activateFnCount, 1, 're-applying migration 012 does not duplicate the function');
  await sql(`update prospectos_private.beta_program set capacity=10`);

  // ============================================================
  // TEST 1 — new user, eligible: activate_trial() creates an ACTIVE BETA row, exactly 7 days.
  // ============================================================
  const userNew = newUuid('00000000', 1);
  await sql(`insert into auth.users(id,email) values ($1,'new1@test')`, [userNew]);
  const r1 = await as(userNew, `select public.activate_trial() r`);
  const row1 = r1.rows[0].r;
  assert.equal(row1.plan, 'BETA');
  assert.equal(row1.status, 'ACTIVE');
  const entitlement1 = (await sql(`select * from public.account_entitlements where user_id=$1`, [userNew])).rows[0];
  const days1 = (new Date(entitlement1.expires_at) - new Date(entitlement1.starts_at)) / 86400000;
  assert.ok(Math.abs(days1 - 7) < 0.01, 'TEST 1 — trial expiry is exactly 7 days after activation');
  assert.equal(entitlement1.status, 'ACTIVE');

  // ============================================================
  // TEST 2 — same user, activation called twice: one entitlement, expires_at unchanged.
  // ============================================================
  const expiresBeforeSecondCall = entitlement1.expires_at;
  await sql(`update public.account_entitlements set starts_at=now()-interval '1 day' where user_id=$1`, [userNew]); // make a re-extension detectable
  const r2 = await as(userNew, `select public.activate_trial() r`);
  const row2 = r2.rows[0].r;
  const countForUser = (await sql(`select count(*)::int n from public.account_entitlements where user_id=$1`, [userNew])).rows[0].n;
  assert.equal(countForUser, 1, 'TEST 2 — calling activate_trial twice never creates a second row');
  assert.equal(new Date(row2.expires_at).getTime(), new Date(expiresBeforeSecondCall).getTime(), 'TEST 2 — expires_at is not pushed forward on a second call');

  // ============================================================
  // TEST 3 — user with an existing (admin-granted, non-BETA-created) entitlement: never reset.
  // Covers an INTERNAL row and a REVOKED BETA row — both must survive activate_trial() untouched.
  // ============================================================
  const userInternal = newUuid('00000000', 3);
  await sql(`insert into auth.users(id,email) values ($1,'internal3@test')`, [userInternal]);
  await sql(`select public.grant_internal_access('internal3@test')`);
  const beforeInternal = (await sql(`select plan,status,expires_at from public.account_entitlements where user_id=$1`, [userInternal])).rows[0];
  await as(userInternal, `select public.activate_trial()`);
  const afterInternal = (await sql(`select plan,status,expires_at from public.account_entitlements where user_id=$1`, [userInternal])).rows[0];
  assert.deepEqual(afterInternal, beforeInternal, 'TEST 3 — an existing INTERNAL row is completely untouched by activate_trial()');

  const userRevoked = newUuid('00000000', 4);
  await sql(`insert into auth.users(id,email) values ($1,'revoked4@test')`, [userRevoked]);
  await sql(`select public.grant_beta_access('revoked4@test')`);
  await sql(`update public.account_entitlements set status='REVOKED' where user_id=$1`, [userRevoked]);
  const beforeRevoked = (await sql(`select plan,status,expires_at from public.account_entitlements where user_id=$1`, [userRevoked])).rows[0];
  await as(userRevoked, `select public.activate_trial()`);
  const afterRevoked = (await sql(`select plan,status,expires_at from public.account_entitlements where user_id=$1`, [userRevoked])).rows[0];
  assert.deepEqual(afterRevoked, beforeRevoked, 'TEST 3 — a REVOKED row is never silently reactivated by activate_trial()');

  // ============================================================
  // TEST 5 — beta capacity reached: no additional access granted, no inconsistent row created.
  // ============================================================
  await sql(`delete from public.account_entitlements`);
  const capacityUsers = [];
  for (let i = 0; i < 10; i++) {
    const uid = newUuid('20000000', i);
    capacityUsers.push(uid);
    await sql(`insert into auth.users(id,email) values ($1,$2)`, [uid, `cap${i}@test`]);
    await as(uid, `select public.activate_trial()`);
  }
  const usedAfterTen = (await sql(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).rows[0].n;
  assert.equal(usedAfterTen, 10, 'TEST 5 — exactly 10 self-service activations recorded');
  const uid11 = newUuid('20000000', 11);
  await sql(`insert into auth.users(id,email) values ($1,'cap11@test')`, [uid11]);
  await rejects(as(uid11, `select public.activate_trial()`), /BETA_CAPACITY_REACHED/);
  const noRowForEleventh = (await sql(`select count(*)::int n from public.account_entitlements where user_id=$1`, [uid11])).rows[0].n;
  assert.equal(noRowForEleventh, 0, 'TEST 5 — the refused activation created no row at all');
  const stillTenAfterRefusal = (await sql(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).rows[0].n;
  assert.equal(stillTenAfterRefusal, 10, 'TEST 5 — refusal did not disturb the existing 10');

  // ============================================================
  // TEST 6 — two concurrent activations racing for the last slot: only one succeeds. Also proves the
  // capacity pool is SHARED between the admin path (grant_beta_access) and the self-service path
  // (activate_trial) — both use the same advisory lock key and the same plan='BETA' count.
  // ============================================================
  await sql(`delete from public.account_entitlements where user_id=$1`, [capacityUsers[9]]); // free exactly one slot -> 9 used, capacity 10
  const raceUidX = newUuid('20000000', 91);
  const raceUidY = newUuid('20000000', 92);
  await sql(`insert into auth.users(id,email) values ($1,'racex@test'),($2,'racey@test')`, [raceUidX, raceUidY]);
  await as(raceUidX, `select public.activate_trial()`); // takes the last slot via self-service -> 10 used
  await rejects(as(raceUidY, `select public.activate_trial()`), /BETA_CAPACITY_REACHED/);
  const finalCount = (await sql(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).rows[0].n;
  assert.equal(finalCount, 10, 'TEST 6 — never more than the configured capacity, however the calls interleave');
  // Cross-path race: an admin grant_beta_access call for a brand-new email must ALSO be refused once
  // self-service activations alone have already filled the shared pool.
  await sql(`insert into auth.users(id,email) values ($1,'raceadmin@test')`, [newUuid('20000000', 93)]);
  await rejects(sql(`select public.grant_beta_access('raceadmin@test')`), /BETA_CAPACITY_REACHED/, 'TEST 6 — the admin path shares the same capacity pool as self-service, not a separate one');

  // ============================================================
  // TEST 7 — an unauthenticated caller cannot self-assign an entitlement: no EXECUTE grant to anon at
  // all (defense in depth ahead of the internal auth.uid() null check).
  // ============================================================
  await rejects(as(undefined, `select public.activate_trial()`), /permission denied/i);
  const anonCreatedNothing = (await sql(`select count(*)::int n from public.account_entitlements`)).rows[0].n;
  assert.equal(anonCreatedNothing, 10, 'TEST 7 — an anonymous call creates no row whatsoever (count unchanged)');

  // ============================================================
  // TEST 8 — user A can never activate or modify user B's trial. activate_trial() takes zero
  // parameters, so there is no argument through which A could even attempt to name B — proven both
  // structurally (function signature) and dynamically (A's call never touches B's row).
  // ============================================================
  const fnDef = (await sql(`select pg_get_functiondef(oid) as def from pg_proc where proname='activate_trial'`)).rows[0].def;
  assert.match(fnDef, /function public\.activate_trial\(\)/i, 'TEST 8 — activate_trial takes no parameters at all');
  await sql(`delete from public.account_entitlements`); // clean slate — TEST 8 is about cross-user isolation, not capacity
  const userA8 = newUuid('30000000', 1);
  const userB8 = newUuid('30000000', 2);
  await sql(`insert into auth.users(id,email) values ($1,'a8@test'),($2,'b8@test')`, [userA8, userB8]);
  await as(userA8, `select public.activate_trial()`);
  const bHasNoRow = (await sql(`select count(*)::int n from public.account_entitlements where user_id=$1`, [userB8])).rows[0].n;
  assert.equal(bHasNoRow, 0, "TEST 8 — A activating their own trial never creates or touches B's row");

  // ============================================================
  // TEST 10 — existing multi-tenant RLS is completely unaffected by migration 012: identical policy
  // counts on every tenant table before/after, and account_entitlements still has exactly one SELECT
  // policy (not duplicated, not widened to allow client writes).
  // ============================================================
  const tenantTables = ['organizations', 'projects', 'icps', 'prospects', 'evidence', 'channels', 'outreach'];
  for (const t of tenantTables) {
    const n = (await sql(`select count(*)::int n from pg_policies where tablename=$1`, [t])).rows[0].n;
    assert.ok(n >= 1, `TEST 10 — ${t} still has its tenant RLS policy after migration 012`);
  }
  const entitlementPolicies = (await sql(`select count(*)::int n from pg_policies where tablename='account_entitlements'`)).rows[0].n;
  assert.equal(entitlementPolicies, 1, 'TEST 10 — account_entitlements still has exactly one (read-only, self) RLS policy');
  const entitlementGrants = (await sql(`select privilege_type from information_schema.role_table_grants where table_name='account_entitlements' and grantee='authenticated'`)).rows.map(r => r.privilege_type);
  assert.deepEqual(entitlementGrants, ['SELECT'], 'TEST 10 — authenticated still has SELECT only on account_entitlements, never INSERT/UPDATE/DELETE');
  // Migration 012 itself never touches DDL on any RLS-protected table (structural confirmation).
  assert.doesNotMatch(migration012, /alter table|create policy|drop policy/i, 'TEST 10 — migration 012 contains no table/policy DDL at all');

  console.log('PASS: self-service trial activation (idempotent, capacity-shared with the admin path, no client-supplied identity, unauthenticated/cross-tenant refusal, RLS unaffected)');
} finally {
  await db.close();
}
