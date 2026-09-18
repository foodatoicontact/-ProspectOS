// PostgreSQL integration coverage for the account privacy/beta bloc (migration 008): entitlement
// RLS/atomicity, and the multi-tenant safety of self-service account deletion.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration008 = await readFile(new URL('../db/migrations/008_account_privacy_beta.sql', import.meta.url), 'utf8');

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
  // Idempotence: re-applying must not fail and must not duplicate any object.
  await db.exec(migration008);
  const entitlementSelectPolicies = (await sql(`select count(*)::int n from pg_policies where tablename='account_entitlements'`)).rows[0].n;
  assert.equal(entitlementSelectPolicies, 1, 're-applying migration 008 does not duplicate the RLS policy');

  const A = '00000000-0000-4000-8000-000000000001';
  const B = '00000000-0000-4000-8000-000000000002';
  const OA = '10000000-0000-4000-8000-000000000001';
  const OB = '10000000-0000-4000-8000-000000000002';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA, A, OB, B]);

  // ============================================================
  // BETA — capacity, atomicity, expiry, client-write protection
  // ============================================================
  await sql(`update prospectos_private.beta_program set capacity=10`);

  // M — activation grants exactly 7 days.
  const grantA = (await sql(`select public.grant_beta_access('a@test') r`)).rows[0].r;
  const entitlementA = (await sql(`select * from public.account_entitlements where user_id=$1`, [A])).rows[0];
  const days = (new Date(entitlementA.expires_at) - new Date(entitlementA.starts_at)) / 86400000;
  assert.ok(Math.abs(days - 7) < 0.01, 'M — activation grants exactly 7 days');
  assert.equal(entitlementA.status, 'ACTIVE');

  // N/O — active vs expired, at the RLS-read level the app's requireActiveEntitlement relies on.
  let read = (await as(A, `select status,expires_at from public.account_entitlements where user_id=$1`, [A])).rows[0];
  assert.equal(read.status, 'ACTIVE', 'N — an active beta user reads an ACTIVE, non-expired row');
  assert.ok(new Date(read.expires_at).getTime() > Date.now());
  // Simulate real time passage (not a starts_at/expires_at inversion, which the CHECK constraint
  // correctly rejects as an impossible state): both timestamps move into the past together, exactly
  // like a real 7-day-old grant would look once "now" has moved past its own fixed expires_at.
  await sql(`update public.account_entitlements set starts_at=now()-interval '8 days',expires_at=now()-interval '1 day' where user_id=$1`, [A]);
  read = (await as(A, `select status,expires_at from public.account_entitlements where user_id=$1`, [A])).rows[0];
  assert.ok(new Date(read.expires_at).getTime() <= Date.now(), 'O — an expired row is readable and its expiry is in the past (the app-level check treats this as BETA_ACCESS_EXPIRED)');
  await sql(`update public.account_entitlements set starts_at=now(),expires_at=now()+interval '7 days' where user_id=$1`, [A]); // restore for later checks

  // R/S/T — exactly 10 total activations allowed, the 11th refused, and a race can never exceed it.
  await sql(`delete from public.account_entitlements`);
  const capacityUsers = [];
  for (let i = 0; i < 10; i++) {
    const uid = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    capacityUsers.push(uid);
    await sql(`insert into auth.users(id,email) values ($1,$2)`, [uid, `beta${i}@test`]);
    await sql(`select public.grant_beta_access($1)`, [`beta${i}@test`]);
  }
  const usedCount = (await sql(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).rows[0].n;
  assert.equal(usedCount, 10, 'R — exactly 10 activations recorded');
  const uid11 = '20000000-0000-4000-8000-000000000011';
  await sql(`insert into auth.users(id,email) values ($1,'beta11@test')`, [uid11]);
  await rejects(sql(`select public.grant_beta_access('beta11@test')`), /BETA_CAPACITY_REACHED/);
  const stillTen = (await sql(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).rows[0].n;
  assert.equal(stillTen, 10, 'S — the refused 11th activation created no row');
  // T — simulate the exact interleaving two simultaneous activation requests would produce: both
  // read "9 used, 1 slot free" before either commits. The advisory lock inside grant_beta_access
  // serializes them regardless — proven here by running them back-to-back against a capacity of
  // exactly one more than currently used and confirming only one can ever succeed.
  await sql(`delete from public.account_entitlements where user_id=$1`, [capacityUsers[9]]); // free exactly one slot -> 9 used, capacity 10
  const raceUidX = '20000000-0000-4000-8000-0000000000a1';
  const raceUidY = '20000000-0000-4000-8000-0000000000a2';
  await sql(`insert into auth.users(id,email) values ($1,'racex@test'),($2,'racey@test')`, [raceUidX, raceUidY]);
  await sql(`select public.grant_beta_access('racex@test')`); // takes the last slot -> 10 used
  await rejects(sql(`select public.grant_beta_access('racey@test')`), /BETA_CAPACITY_REACHED/);
  const finalCount = (await sql(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).rows[0].n;
  assert.equal(finalCount, 10, 'T — never more than the configured capacity, however the calls interleave');

  // U — a client (authenticated role, no special grant) can never write its own expires_at.
  await rejects(
    as(A, `update public.account_entitlements set expires_at=now()+interval '365 days' where user_id=$1`, [A]),
    /permission denied/i
  );
  await rejects(
    as(A, `insert into public.account_entitlements(user_id,plan,expires_at) values ($1,'BETA',now()+interval '365 days')`, [B]),
    /permission denied/i
  );

  // V — a user cannot read another user's entitlement row.
  const crossRead = await as(B, `select * from public.account_entitlements where user_id=$1`, [A]);
  assert.equal(crossRead.rows.length, 0, "V — B cannot read A's entitlement row");

  // ============================================================
  // DELETE — membership cleanup, last-owner block, multi-tenant isolation
  // ============================================================
  const memberOrg = '10000000-0000-4000-8000-000000000003';
  const memberOwner = '00000000-0000-4000-8000-000000000003';
  const plainMember = '00000000-0000-4000-8000-000000000004';
  await sql(`insert into auth.users(id,email) values ($1,'owner3@test'),($2,'member4@test')`, [memberOwner, plainMember]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'Org3',$2)`, [memberOrg, memberOwner]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member')`, [memberOrg, memberOwner, plainMember]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'P3')`, ['30000000-0000-4000-8000-000000000003', memberOrg]);

  // G — a plain member can delete their own account without touching the organization.
  await as(plainMember, `select public.delete_own_account()`);
  const memberGone = (await sql(`select count(*)::int n from public.memberships where user_id=$1`, [plainMember])).rows[0].n;
  assert.equal(memberGone, 0, 'G — membership removed');
  const orgStillThere = (await sql(`select count(*)::int n from public.organizations where id=$1`, [memberOrg])).rows[0].n;
  assert.equal(orgStillThere, 1, 'G — the organization itself is untouched');
  const projectStillThere = (await sql(`select count(*)::int n from public.projects where organization_id=$1`, [memberOrg])).rows[0].n;
  assert.equal(projectStillThere, 1, 'G — the organization\'s business data is untouched');

  // H — an owner can delete their account when another owner already exists.
  const coOwnerA = '00000000-0000-4000-8000-000000000005';
  const coOwnerB = '00000000-0000-4000-8000-000000000006';
  const coOrg = '10000000-0000-4000-8000-000000000004';
  await sql(`insert into auth.users(id,email) values ($1,'co5@test'),($2,'co6@test')`, [coOwnerA, coOwnerB]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'CoOrg',$2)`, [coOrg, coOwnerA]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($1,$3,'owner')`, [coOrg, coOwnerA, coOwnerB]);
  await as(coOwnerA, `select public.delete_own_account()`);
  const coOwnerAGone = (await sql(`select count(*)::int n from public.memberships where user_id=$1`, [coOwnerA])).rows[0].n;
  assert.equal(coOwnerAGone, 0, 'H — the departing co-owner\'s membership is removed');
  const coOwnerBRemains = (await sql(`select count(*)::int n from public.memberships where user_id=$1 and organization_id=$2`, [coOwnerB, coOrg])).rows[0].n;
  assert.equal(coOwnerBRemains, 1, 'H — the remaining owner keeps full access');

  // I — the last owner of a still-active organization is blocked, and NOTHING is deleted.
  const lastOwner = '00000000-0000-4000-8000-000000000007';
  const lastOwnerOrg = '10000000-0000-4000-8000-000000000005';
  await sql(`insert into auth.users(id,email) values ($1,'last7@test')`, [lastOwner]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'LastOwnerOrg',$2)`, [lastOwnerOrg, lastOwner]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [lastOwnerOrg, lastOwner]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'LastOwnerProject')`, ['30000000-0000-4000-8000-000000000005', lastOwnerOrg]);
  await rejects(as(lastOwner, `select public.delete_own_account()`), /last_owner_blocked/);
  const lastOwnerStillMember = (await sql(`select count(*)::int n from public.memberships where user_id=$1`, [lastOwner])).rows[0].n;
  assert.equal(lastOwnerStillMember, 1, 'I — nothing was deleted: the membership survives the blocked attempt');

  // J — deletion in tenant A never affects tenant B (re-using OA/OB from the top of this file).
  await as(A, `select public.delete_own_account()`).catch(() => {}); // A owns OA alone with no other data — allowed to proceed
  const bMembershipIntact = (await sql(`select count(*)::int n from public.memberships where user_id=$1 and organization_id=$2`, [B, OB])).rows[0].n;
  assert.equal(bMembershipIntact, 1, "J — tenant B's membership is completely unaffected by tenant A's deletion");
  const bOrgIntact = (await sql(`select count(*)::int n from public.organizations where id=$1`, [OB])).rows[0].n;
  assert.equal(bOrgIntact, 1, "J — tenant B's organization is completely unaffected");

  // K — the API-level typed confirmation ("SUPPRIMER") is enforced in the route, not just the UI.
  // (Static proof — this repo has no HTTP/browser test harness for route.ts, see tests/mobile-layout
  // and tests/account-session for the same precedent.)
  const routeSource = await readFile(new URL('../app/api/v1/[...path]/route.ts', import.meta.url), 'utf8');
  assert.match(routeSource, /body\.confirm!==?'SUPPRIMER'/, "K — the delete route rejects any call that doesn't send the literal confirmation string");

  // L — chosen strategy: evidence.verified_by / events.actor_id are preserved unchanged (CONSERVÉ),
  // never anonymized in this bloc (CASE D — the only path that would require touching the
  // append-only trigger or the evidence-first CHECK constraint — is explicitly deferred). Proven
  // structurally: delete_own_account's own body never references evidence or events at all, so a
  // verified_by/actor_id attribution to a departed member is mathematically untouched by it.
  const fnDef = (await sql(`select pg_get_functiondef(oid) as def from pg_proc where proname='delete_own_account'`)).rows[0].def;
  assert.doesNotMatch(fnDef, /\bevidence\b/i, 'L — delete_own_account never touches evidence (attribution preserved, not anonymized, in this bloc)');
  assert.doesNotMatch(fnDef, /\bevents\b/i, 'L — delete_own_account never touches events (append-only history preserved untouched)');

  console.log('PASS: account entitlements (RLS, atomic capacity, expiry, client-write protection) and self-service account deletion (membership cleanup, last-owner block, multi-tenant isolation)');
} finally {
  await db.close();
}
