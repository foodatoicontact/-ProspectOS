// PostgreSQL integration coverage for the Beta Analytics admin dashboard (migration 013):
// public.beta_analytics() — admin-only authorization (reusing account_entitlements.plan='INTERNAL',
// never a new role/table), no partial data leak to a non-admin caller, and correct per-user facts
// (organization/project/discovery/prospect counts, real last-business-activity from the append-only
// `events` table) across users at every funnel stage, including the "no organization at all" and
// "organization but no project yet" edge cases the brief explicitly calls out.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration002 = await readFile(new URL('../db/migrations/002_discovery.sql', import.meta.url), 'utf8');
const migration008 = await readFile(new URL('../db/migrations/008_account_privacy_beta.sql', import.meta.url), 'utf8');
const migration011 = await readFile(new URL('../db/migrations/011_beta_entitlement_gate.sql', import.meta.url), 'utf8');
const migration013 = await readFile(new URL('../db/migrations/013_beta_analytics_admin.sql', import.meta.url), 'utf8');

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
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(schema);
  await db.exec(migration002);
  await db.exec(migration008);
  await db.exec(migration011);
  await db.exec(migration013);
  // Idempotence: re-applying the new migration must not fail and must not duplicate the function.
  await db.exec(migration013);
  const analyticsFnCount = (await sql(`select count(*)::int n from pg_proc where proname='beta_analytics'`)).rows[0].n;
  assert.equal(analyticsFnCount, 1, 're-applying migration 013 does not duplicate the function');
  await sql(`update prospectos_private.beta_program set capacity=10`);

  // ============================================================
  // Fixtures — one user at each funnel stage, plus the admin caller.
  // ============================================================
  const admin = newUuid('00000000', 1);
  const betaNoOrg = newUuid('00000000', 2);        // TRIAL_ACTIVE: BETA plan, no organization at all.
  const orgNoProject = newUuid('00000000', 3);     // ORGANIZATION_CREATED: has an org, zero projects.
  const projectNoDiscovery = newUuid('00000000', 4); // PROJECT_CREATED: has a project, never ran discovery.
  const discoveryNoProspect = newUuid('00000000', 5); // DISCOVERY_STARTED: ran discovery, zero prospects.
  const fullActivity = newUuid('00000000', 6);     // PROSPECTS_CREATED: has a real, timestamped business event.
  const signedUpOnly = newUuid('00000000', 7);     // SIGNED_UP: auth.users row only, no entitlement at all.

  await sql(`insert into auth.users(id,email,last_sign_in_at) values
    ($1,'admin@test',now()),($2,'betanoorg@test',now()),($3,'orgnoproject@test',null),
    ($4,'projectnodiscovery@test',now()),($5,'discoverynoprospect@test',now()),
    ($6,'fullactivity@test',now()),($7,'signeduponly@test',null)`,
    [admin, betaNoOrg, orgNoProject, projectNoDiscovery, discoveryNoProspect, fullActivity, signedUpOnly]);

  await sql(`select public.grant_internal_access('admin@test')`);
  await sql(`select public.grant_beta_access('betanoorg@test')`);
  await sql(`select public.grant_beta_access('orgnoproject@test')`);
  await sql(`select public.grant_beta_access('projectnodiscovery@test')`);
  await sql(`select public.grant_beta_access('discoverynoprospect@test')`);
  await sql(`select public.grant_beta_access('fullactivity@test')`);
  // signedUpOnly deliberately gets no entitlement row at all.

  const orgA = newUuid('10000000', 1);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'Org A',$2)`, [orgA, orgNoProject]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [orgA, orgNoProject]);

  const orgB = newUuid('10000000', 2);
  const projectB = newUuid('20000000', 1);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'Org B',$2)`, [orgB, projectNoDiscovery]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [orgB, projectNoDiscovery]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Project B')`, [projectB, orgB]);

  const orgC = newUuid('10000000', 3);
  const projectC = newUuid('20000000', 2);
  const discoveryC = newUuid('30000000', 1);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'Org C',$2)`, [orgC, discoveryNoProspect]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [orgC, discoveryNoProspect]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Project C')`, [projectC, orgC]);
  await sql(`insert into public.discovery_runs(id,organization_id,project_id,query,location,provider,status) values ($1,$2,$3,'restaurants','Toulouse','fixture','completed')`, [discoveryC, orgC, projectC]);

  const orgD = newUuid('10000000', 4);
  const projectD = newUuid('20000000', 3);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'Org D',$2)`, [orgD, fullActivity]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [orgD, fullActivity]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Project D')`, [projectD, orgD]);
  // Inserted as the authenticated member so the real append_event trigger fires (the only source this
  // dashboard trusts for "last business activity" — never auth.users.last_sign_in_at).
  const prospectD = (await as(fullActivity, `insert into public.prospects(organization_id,project_id,name,website) values ($1,$2,'Le Test','https://example.test') returning id`, [orgD, projectD])).rows[0].id;
  const businessEventAt = (await sql(`select created_at from public.events where prospect_id=$1`, [prospectD])).rows[0].created_at;
  assert.ok(businessEventAt, 'fixture sanity: the prospect insert produced a real append-only event');

  // ============================================================
  // TEST 1 — admin-authorized access: an INTERNAL/ACTIVE caller gets the full report.
  // ============================================================
  const report = (await as(admin, `select public.beta_analytics() r`)).rows[0].r;
  assert.equal(report.capacity, 10, 'TEST 1 — capacity comes from prospectos_private.beta_program, not hardcoded');
  assert.equal(report.beta_used, 5, 'TEST 1 — beta_used counts exactly the 5 BETA-plan fixtures, never the INTERNAL admin');
  assert.equal(report.users.length, 6, 'TEST 1 — one row per non-INTERNAL user (5 BETA + 1 no-entitlement signup), admin excluded');

  // ============================================================
  // TEST 2 — BETA-user refusal: a normal, fully active BETA member gets 403-mapped 'Admin access
  // required' and the call raises before any row is ever produced (no partial leak of their own or
  // anyone else's data).
  // ============================================================
  await rejects(as(betaNoOrg, `select public.beta_analytics()`), /Admin access required/);

  // ============================================================
  // TEST 3 — no-entitlement-user refusal: a signed-up user with zero rows in account_entitlements is
  // refused exactly like a BETA user — having no plan at all is never treated as implicit admin.
  // ============================================================
  await rejects(as(signedUpOnly, `select public.beta_analytics()`), /Admin access required/);

  // ============================================================
  // TEST 4 — unauthenticated caller: no EXECUTE grant to anon at all (defense in depth ahead of the
  // internal auth.uid() null check).
  // ============================================================
  await rejects(as(undefined, `select public.beta_analytics()`), /permission denied/i);

  // ============================================================
  // TEST 5 — no cross-tenant leak on the admin path itself: the report is genuinely cross-organization
  // (that is the point of an admin dashboard), but it must never include the INTERNAL admin's own row,
  // and every user's organization_id must be their OWN, never another user's.
  // ============================================================
  const byId = Object.fromEntries(report.users.map(u => [u.user_id, u]));
  assert.ok(!byId[admin], 'TEST 5 — the INTERNAL admin never appears in their own report');
  assert.equal(byId[orgNoProject].organization_id, orgA, "TEST 5 — each user's organization_id is their own, never mixed up");
  assert.equal(byId[projectNoDiscovery].organization_id, orgB);
  assert.equal(byId[discoveryNoProspect].organization_id, orgC);
  assert.equal(byId[fullActivity].organization_id, orgD);

  // ============================================================
  // TEST 6 — user without any organization: organization_id null, every downstream count zero, no
  // fabricated data.
  // ============================================================
  const uBeta = byId[betaNoOrg];
  assert.equal(uBeta.organization_id, null, 'TEST 6 — no organization at all is represented as null, never a guess');
  assert.equal(uBeta.project_count, 0);
  assert.equal(uBeta.discovery_run_count, 0);
  assert.equal(uBeta.prospect_count, 0);
  assert.equal(uBeta.last_business_activity_at, null);

  // ============================================================
  // TEST 7 — user with an organization but zero projects: organization_id set, project_count 0.
  // ============================================================
  const uOrg = byId[orgNoProject];
  assert.equal(uOrg.organization_id, orgA);
  assert.equal(uOrg.project_count, 0, 'TEST 7 — having an organization never implies having a project');
  assert.equal(uOrg.first_project_at, null);

  // ============================================================
  // Project-created and discovery-started users are represented at exactly their own stage, no further.
  // ============================================================
  const uProject = byId[projectNoDiscovery];
  assert.equal(uProject.project_count, 1);
  assert.equal(uProject.discovery_run_count, 0, 'a project alone never implies a discovery run');
  assert.equal(uProject.prospect_count, 0);

  const uDiscovery = byId[discoveryNoProspect];
  assert.equal(uDiscovery.project_count, 1);
  assert.equal(uDiscovery.discovery_run_count, 1);
  assert.equal(uDiscovery.prospect_count, 0, 'a discovery run alone never implies an accepted prospect');

  // ============================================================
  // TEST 8 — user with real activity: the append-only events table is the only source of
  // last_business_activity_at (exact timestamp match), never a fallback to last_sign_in_at.
  // ============================================================
  const uActive = byId[fullActivity];
  assert.equal(uActive.prospect_count, 1);
  assert.equal(new Date(uActive.last_business_activity_at).getTime(), new Date(businessEventAt).getTime(), 'TEST 8 — last_business_activity_at is exactly the real events.created_at, not derived or approximated');

  // ============================================================
  // TEST 9 — a signed-up user with literally no entitlement row is represented with plan/status null,
  // never coerced into a fake BETA/EXPIRED row.
  // ============================================================
  const uSignedUp = byId[signedUpOnly];
  assert.equal(uSignedUp.plan, null);
  assert.equal(uSignedUp.status, null);
  assert.equal(uSignedUp.organization_id, null);

  // ============================================================
  // TEST 10 — migration 013 is genuinely additive: it never touches RLS/table DDL on any existing
  // table, and existing tenant policies are completely unaffected.
  // ============================================================
  assert.doesNotMatch(migration013, /alter table|create policy|drop policy|create table/i, 'TEST 10 — migration 013 contains no table/policy DDL at all');
  const tenantTables = ['organizations', 'projects', 'icps', 'prospects', 'evidence', 'channels', 'outreach', 'discovery_runs'];
  for (const t of tenantTables) {
    const n = (await sql(`select count(*)::int n from pg_policies where tablename=$1`, [t])).rows[0].n;
    assert.ok(n >= 1, `TEST 10 — ${t} still has its tenant RLS policy after migration 013`);
  }
  const entitlementGrants = (await sql(`select privilege_type from information_schema.role_table_grants where table_name='account_entitlements' and grantee='authenticated'`)).rows.map(r => r.privilege_type);
  assert.deepEqual(entitlementGrants, ['SELECT'], 'TEST 10 — authenticated still has SELECT only on account_entitlements, never INSERT/UPDATE/DELETE');

  console.log('PASS: beta analytics admin dashboard (INTERNAL-only, no partial leak on refusal, correct per-user facts at every funnel stage, RLS unaffected)');
} finally {
  await db.close();
}
