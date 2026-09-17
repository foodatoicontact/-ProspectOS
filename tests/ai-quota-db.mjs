// PGlite regression suite for the AI-offer-analysis quota guard (migration 005). Never touches
// production — a fresh in-memory Postgres instance per run, loading schema.sql + migrations 002-005 in
// order. Covers Q1-Q7, Q10 and the DB-level red-team scenarios from BLOC 3A/PR1; Q8/Q9/fail-closed are
// covered separately in tests/ai-guard.test.ts (pure logic, no DB needed for those).
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration002 = await readFile(new URL('../db/migrations/002_discovery.sql', import.meta.url), 'utf8');
const migration003 = await readFile(new URL('../db/migrations/003_discovery_generic_criteria.sql', import.meta.url), 'utf8');
const migration004 = await readFile(new URL('../db/migrations/004_fix_observation_evidence_upsert.sql', import.meta.url), 'utf8');
const migration005 = await readFile(new URL('../db/migrations/005_ai_offer_quota.sql', import.meta.url), 'utf8');

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
async function consumeAiOfferQuota(user, projectId) {
  return as(user, `select public.consume_ai_offer_quota($1)`, [projectId]);
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
  await db.exec(migration002);
  await db.exec(migration003);
  await db.exec(migration004);
  await db.exec(migration005);

  const A = '00000000-0000-4000-8000-000000000001';
  const B = '00000000-0000-4000-8000-000000000002';
  const OA = '10000000-0000-4000-8000-000000000001';
  const OB = '10000000-0000-4000-8000-000000000002';
  const PA = '20000000-0000-4000-8000-000000000001';
  const PB = '20000000-0000-4000-8000-000000000002';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA, A, OB, B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS A'),($3,$4,'Test SaaS B')`, [PA, OA, PB, OB]);

  // Deterministic, fast test: lower the shared singleton quota row instead of waiting on real hours.
  // discovery_quota_settings is a private, superuser-only table (revoked from anon/authenticated) —
  // this direct UPDATE mirrors how the row is seeded once by an operator, not a path reachable by users.
  await sql(`update prospectos_private.discovery_quota_settings set ai_offer_per_hour=2`);

  // === Q1 — under quota: allowed ===
  await consumeAiOfferQuota(A, PA);
  console.log('PASS Q1 — call under quota is allowed');

  // === Q2 — quota exactly reached: the call that fills the last slot is still allowed ===
  await consumeAiOfferQuota(A, PA);
  console.log('PASS Q2 — call that exactly reaches the cap (2/2) is allowed');

  // === Q3 — over quota: the next call is refused with quota_exceeded (mapped to HTTP 429 by the route,
  // via the same checked()/catch mapping already proven for the 'discovery' and 'analysis' actions) ===
  await rejects(consumeAiOfferQuota(A, PA), /quota_exceeded/);
  console.log('PASS Q3 — call over quota is refused (quota_exceeded)');

  // === Replay red-team: repeating the exact same call again does not bypass the cap — quota
  // consumption has no idempotency key, unlike save_discovery_observations' content_hash dedup ===
  await rejects(consumeAiOfferQuota(A, PA), /quota_exceeded/);
  console.log('PASS replay — repeating the identical call after the cap still fails');

  // === Q4 — boundary correctness for the "last available slot" (necessary condition for the
  // concurrency guarantee; PGlite is single-connection so true parallel racing cannot be reproduced
  // here — the atomicity itself comes from pg_advisory_xact_lock in consume_discovery_quota, unchanged
  // from the already-audited 'discovery'/'analysis' code path and merely extended to a 3rd action) ===
  const PC = '20000000-0000-4000-8000-000000000003';
  const OC = '10000000-0000-4000-8000-000000000003';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'C',$2)`, [OC, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OC, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS C')`, [PC, OC]);
  await sql(`update prospectos_private.discovery_quota_settings set ai_offer_per_hour=1`);
  await consumeAiOfferQuota(A, PC);
  await rejects(consumeAiOfferQuota(A, PC), /quota_exceeded/);
  await sql(`update prospectos_private.discovery_quota_settings set ai_offer_per_hour=2`);
  console.log('PASS Q4 — the call that fills the single available slot succeeds, the very next one does not (boundary correctness underlying the concurrency guarantee)');

  // === Q5 — organization isolation: org B's quota is untouched by org A's exhausted quota ===
  await consumeAiOfferQuota(B, PB);
  await consumeAiOfferQuota(B, PB);
  await rejects(consumeAiOfferQuota(B, PB), /quota_exceeded/);
  console.log('PASS Q5 — organization B consumes its own independent quota, unaffected by organization A');

  // === Q6 — a non-member of the project's organization cannot consume its quota ===
  const usageBeforeQ6 = Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='ai_offer'`, [OB])).rows[0].n);
  await rejects(consumeAiOfferQuota(A, PB), /tenant member/i);
  const usageAfterQ6 = Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='ai_offer'`, [OB])).rows[0].n);
  assert.equal(usageAfterQ6, usageBeforeQ6, 'Q6: a rejected non-member attempt must not consume any quota');
  console.log('PASS Q6 — non-member is rejected and consumes nothing');

  // === Q7 — a falsified/foreign project_id grants no bypass: there is no organization_id parameter to
  // forge at all, tenant is always resolved server-side from the project row (same shape as the
  // already-audited consume_analysis_quota) ===
  await rejects(consumeAiOfferQuota(B, PA), /tenant member/i);
  console.log('PASS Q7 — a project_id belonging to a foreign organization grants no quota access, whoever calls it');

  // === Red-team: the settings row itself cannot be pushed to zero/negative (defense against an
  // accidental or malicious "disable the quota" write) ===
  await rejects(sql(`update prospectos_private.discovery_quota_settings set ai_offer_per_hour=0`), /ai_offer_per_hour/);
  await rejects(sql(`update prospectos_private.discovery_quota_settings set ai_offer_per_hour=-1`), /ai_offer_per_hour/);
  await sql(`update prospectos_private.discovery_quota_settings set ai_offer_per_hour=2`);
  console.log('PASS red-team — ai_offer_per_hour cannot be set to zero or negative (CHECK constraint)');

  // === Q10 — no regression on the pre-existing 'discovery'/'analysis' quota actions after extending
  // consume_discovery_quota's CASE statement with a third branch ===
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [A]);
  await sql(`select prospectos_private.consume_discovery_quota($1,'discovery')`, [OA]);
  await sql(`select prospectos_private.consume_discovery_quota($1,'analysis')`, [OA]);
  console.log('PASS Q10 — pre-existing discovery/analysis quota actions still work after migration 005');

  // === Migration idempotence: applying 005 twice must not error ===
  await db.exec(migration005);
  console.log('PASS migration 005 is idempotent (applied twice, no error)');

  console.log('PASS: AI offer quota guard (migration 005) — Q1-Q7, Q10, red-team, idempotence');
} finally {
  await db.close();
}
