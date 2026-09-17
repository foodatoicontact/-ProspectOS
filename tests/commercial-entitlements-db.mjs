// PGlite regression suite for the commercial metering/plans/entitlements engine (migration 006).
// Never touches production — a fresh in-memory Postgres instance per run, loading
// schema.sql + migrations 002-006 in order. Covers C1-C20 from BLOC COMMERCIAL/PR2.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const m002 = await readFile(new URL('../db/migrations/002_discovery.sql', import.meta.url), 'utf8');
const m003 = await readFile(new URL('../db/migrations/003_discovery_generic_criteria.sql', import.meta.url), 'utf8');
const m004 = await readFile(new URL('../db/migrations/004_fix_observation_evidence_upsert.sql', import.meta.url), 'utf8');
const m005 = await readFile(new URL('../db/migrations/005_ai_offer_quota.sql', import.meta.url), 'utf8');
const m006 = await readFile(new URL('../db/migrations/006_commercial_entitlements.sql', import.meta.url), 'utf8');

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
async function usage(user, projectId) {
  return (await as(user, `select public.get_commercial_usage($1) u`, [projectId])).rows[0].u;
}
async function discovery(user, projectId, hash) {
  return as(user, `select public.start_discovery_metered($1,'restaurants','Toulouse','["food"]','fixture',2,'{}') r`, [projectId]);
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
  await db.exec(m002);
  await db.exec(m003);
  await db.exec(m004);
  await db.exec(m005);
  await db.exec(m006);

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

  // === C1 — FREE resolved correctly for a brand-new organization ===
  const u1 = await usage(A, PA);
  assert.equal(u1.plan, 'free');
  console.log('PASS C1 — FREE resolved correctly for a new organization');

  // === C2 — exact FREE limits ===
  assert.equal(u1.usage.discoveries.limit, 3);
  assert.equal(u1.usage.prospects.limit, 25);
  assert.equal(u1.usage.ai_operations.limit, 5);
  assert.equal(u1.seats.limit, 1);
  console.log('PASS C2 — exact FREE limits (3/25/5, seats=1)');

  // === C3 — Discovery consumption +1 ===
  await discovery(A, PA);
  const u3 = await usage(A, PA);
  assert.equal(u3.usage.discoveries.used, 1);
  assert.equal(u3.usage.discoveries.remaining, 2);
  console.log('PASS C3 — Discovery consumption increments used by exactly 1');

  // === C4 — refusal once the limit is reached ===
  await discovery(A, PA); // used=2
  await discovery(A, PA); // used=3 (FREE limit reached)
  await rejects(discovery(A, PA), /commercial_entitlement_exceeded/);
  const u4 = await usage(A, PA);
  assert.equal(u4.usage.discoveries.used, 3, 'C4: the refused 4th attempt must not have incremented usage');
  console.log('PASS C4 — refusal exactly at the limit, refused attempt does not consume');

  // === C5 — boundary correctness for the last available credit (PGlite is single-connection; true
  // concurrent-connection racing cannot be reproduced here — see tests/ai-quota-db.mjs Q4 for the same
  // documented limitation. The underlying atomicity comes from pg_advisory_xact_lock in
  // consume_commercial_entitlement, the same proven mechanism as the technical quotas.) ===
  const PC = '20000000-0000-4000-8000-000000000003';
  const OC = '10000000-0000-4000-8000-000000000003';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'C',$2)`, [OC, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OC, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS C')`, [PC, OC]);
  await sql(`update public.organization_subscriptions set updated_at=updated_at`); // no-op, org C not yet resolved
  await discovery(A, PC); await discovery(A, PC); await discovery(A, PC); // exhaust FREE's 3
  await rejects(discovery(A, PC), /commercial_entitlement_exceeded/);
  console.log('PASS C5 — the call that fills the last available credit succeeds, the very next one does not');

  // === C6 — prospect amount > remaining: CAPPED, not rejected (documented strategy) ===
  const PD = '20000000-0000-4000-8000-000000000004';
  const OD = '10000000-0000-4000-8000-000000000004';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'D',$2)`, [OD, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OD, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS D')`, [PD, OD]);
  const firstBatch = (await as(A, `select public.consume_prospect_entitlement($1,20) g`, [PD])).rows[0].g; // FREE limit 25 -> grants 20
  assert.equal(firstBatch, 20);
  const secondBatch = (await as(A, `select public.consume_prospect_entitlement($1,10) g`, [PD])).rows[0].g; // only 5 remain -> capped to 5, not rejected
  assert.equal(secondBatch, 5, 'C6: requesting more than remaining must be CAPPED to what remains, never rejected outright');
  const uD = await usage(A, PD);
  assert.equal(uD.usage.prospects.used, 25);
  assert.equal(uD.usage.prospects.remaining, 0);
  console.log('PASS C6 — prospect amount exceeding remaining is capped deterministically, never rejected wholesale');

  // === C7 — no cross-tenant consumption ===
  const uBBefore = await usage(B, PB);
  await discovery(A, PA).catch(() => {}); // A already exhausted above; irrelevant to B either way
  const uBAfter = await usage(B, PB);
  assert.deepEqual(uBAfter.usage, uBBefore.usage, 'C7: organization A activity must never affect organization B usage');
  console.log('PASS C7 — no cross-tenant consumption');

  // === C8 — non-member refused, and refusal consumes nothing ===
  const usageBeforeC8 = await usage(A, PA);
  await rejects(discovery(B, PA), /tenant member/i);
  const usageAfterC8 = await usage(A, PA);
  assert.deepEqual(usageAfterC8.usage, usageBeforeC8.usage, 'C8: a rejected non-member attempt must not consume anything');
  console.log('PASS C8 — non-member is refused and consumes nothing');

  // === C9 — anon refused ===
  const grantsCheck = await sql(`
    select has_function_privilege('anon','public.start_discovery_metered(uuid,text,text,jsonb,text,integer,jsonb)','EXECUTE') as discovery_anon,
           has_function_privilege('anon','public.consume_ai_operation(uuid)','EXECUTE') as ai_anon,
           has_function_privilege('anon','public.consume_prospect_entitlement(uuid,int)','EXECUTE') as prospect_anon,
           has_function_privilege('anon','public.get_commercial_usage(uuid)','EXECUTE') as usage_anon,
           has_function_privilege('authenticated','prospectos_private.consume_commercial_entitlement(uuid,text,int)','EXECUTE') as private_authenticated
  `);
  const g = grantsCheck.rows[0];
  assert.equal(g.discovery_anon, false); assert.equal(g.ai_anon, false); assert.equal(g.prospect_anon, false); assert.equal(g.usage_anon, false);
  assert.equal(g.private_authenticated, false, 'C9/PRIVATE_RPC_BLOCKED: authenticated must never call the private primitive directly');
  await sql('set role anon');
  await rejects(sql(`select public.get_commercial_usage($1)`, [PA]), /permission denied/i);
  await sql('reset role');
  console.log('PASS C9 — anon cannot execute any commercial RPC (grants + live call both confirm)');

  // === C10 — direct table mutation refused ===
  await rejects(as(A, `update public.organization_subscriptions set plan_code='business' where organization_id=$1`, [OA]), /permission denied/i);
  await rejects(as(A, `insert into prospectos_private.commercial_usage(organization_id,subscription_id,metric,amount) values ($1,gen_random_uuid(),'discovery',1)`, [OA]), /permission denied/i);
  await rejects(as(A, `delete from prospectos_private.commercial_usage where organization_id=$1`, [OA]), /permission denied/i);
  console.log('PASS C10 — direct PostgREST-style table writes on subscriptions/usage are refused');

  // === C11 — invalid metric refused ===
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [A]);
  await rejects(sql(`select prospectos_private.consume_commercial_entitlement($1,'bogus_metric',1)`, [OA]), /Invalid metric/);
  console.log('PASS C11 — an arbitrary/invalid metric is refused');

  // === C12 — amount <= 0 refused ===
  await rejects(sql(`select prospectos_private.consume_commercial_entitlement($1,'discovery',0)`, [OA]), /Invalid amount/);
  await rejects(sql(`select prospectos_private.consume_commercial_entitlement($1,'discovery',-5)`, [OA]), /Invalid amount/);
  console.log('PASS C12 — amount 0 or negative is refused');

  // === C13 — a new period does not inherit the previous period's usage ===
  const PE = '20000000-0000-4000-8000-000000000005';
  const OE = '10000000-0000-4000-8000-000000000005';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'E',$2)`, [OE, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OE, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS E')`, [PE, OE]);
  await discovery(A, PE); await discovery(A, PE); await discovery(A, PE); // exhaust FREE's 3 this period
  await rejects(discovery(A, PE), /commercial_entitlement_exceeded/);
  // Simulate the period having already ended 2 months ago (operator/testing-only direct update — never
  // reachable by a client): both the subscription's period boundaries AND the usage rows' timestamps
  // are backdated together, exactly as if this usage genuinely happened in that older period. Moving
  // only the period boundaries would be pointless here — resolve_active_subscription always rolls
  // forward to whichever period contains "now", so it would just reconverge on the same bucket the
  // freshly-recorded usage already sits in.
  await sql(`update public.organization_subscriptions set current_period_start=current_period_start - interval '2 months', current_period_end=current_period_end - interval '2 months' where organization_id=$1`, [OE]);
  await sql(`update prospectos_private.commercial_usage set used_at=used_at - interval '2 months' where organization_id=$1`, [OE]);
  const uEafterRollover = await usage(A, PE);
  assert.equal(uEafterRollover.usage.discoveries.used, 0, 'C13: a fresh period must start at 0 even though old usage rows still exist');
  await discovery(A, PE); // must succeed again now that the period rolled over
  const uEafterNewUsage = await usage(A, PE);
  assert.equal(uEafterNewUsage.usage.discoveries.used, 1);
  const totalUsageRowsE = Number((await sql(`select count(*) n from prospectos_private.commercial_usage where organization_id=$1 and metric='discovery'`, [OE])).rows[0].n);
  assert.equal(totalUsageRowsE, 4, 'C13: old usage rows are never deleted (3 from the old period + 1 new)');
  console.log('PASS C13 — new period starts at 0 without deleting/losing prior usage history');

  // === C14 — plan SOLO resolves new limits ===
  await sql(`update public.organization_subscriptions set plan_code='solo' where organization_id=$1`, [OE]); // simulates a future Stripe webhook write, not a client call
  const uESolo = await usage(A, PE);
  assert.equal(uESolo.plan, 'solo');
  assert.equal(uESolo.usage.discoveries.limit, 20);
  assert.equal(uESolo.usage.prospects.limit, 250);
  assert.equal(uESolo.usage.ai_operations.limit, 50);
  console.log('PASS C14 — plan change to SOLO resolves SOLO limits');

  // === C15 — FREE -> SOLO changes limits without losing/corrupting usage history ===
  assert.equal(uESolo.usage.discoveries.used, 1, 'C15: the 1 discovery already used this period is still counted after the plan change');
  assert.equal(uESolo.usage.discoveries.remaining, 19, 'C15: remaining reflects the NEW SOLO ceiling minus the carried-over usage, not a fresh reset');
  const totalUsageRowsEAfterUpgrade = Number((await sql(`select count(*) n from prospectos_private.commercial_usage where organization_id=$1`, [OE])).rows[0].n);
  assert.equal(totalUsageRowsEAfterUpgrade, 4, 'C15: no usage row was deleted or rewritten by the plan change');
  console.log('PASS C15 — FREE→SOLO upgrade preserves usage history, only raises the ceiling');

  // === C16 — double guard: commercial OK + technical OK -> success ===
  const PF = '20000000-0000-4000-8000-000000000006';
  const OF = '10000000-0000-4000-8000-000000000006';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'F',$2)`, [OF, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OF, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS F')`, [PF, OF]);
  await discovery(A, PF);
  const uF = await usage(A, PF);
  const technicalF = Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='discovery'`, [OF])).rows[0].n);
  assert.equal(uF.usage.discoveries.used, 1);
  assert.equal(technicalF, 1);
  console.log('PASS C16 — double guard succeeds: both commercial and technical usage recorded exactly once');

  // === C17 — commercial KO -> zero technical consumption ===
  const PG_ = '20000000-0000-4000-8000-000000000007';
  const OG = '10000000-0000-4000-8000-000000000007';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'G',$2)`, [OG, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OG, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS G')`, [PG_, OG]);
  await discovery(A, PG_); await discovery(A, PG_); await discovery(A, PG_); // exhaust FREE commercial limit (3)
  const technicalBeforeC17 = Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='discovery'`, [OG])).rows[0].n);
  await rejects(discovery(A, PG_), /commercial_entitlement_exceeded/);
  const technicalAfterC17 = Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='discovery'`, [OG])).rows[0].n);
  assert.equal(technicalAfterC17, technicalBeforeC17, 'C17: a commercial refusal must never reach/consume the technical quota');
  console.log('PASS C17 — commercial refusal consumes zero technical quota');

  // === C18 — technical KO -> zero commercial consumption (atomic rollback) ===
  const PH = '20000000-0000-4000-8000-000000000008';
  const OH = '10000000-0000-4000-8000-000000000008';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'H',$2)`, [OH, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OH, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS H')`, [PH, OH]);
  await sql(`update prospectos_private.discovery_quota_settings set runs_per_hour=1`); // lower technical cap below the FREE commercial cap (3), test-only
  await discovery(A, PH); // consumes both: commercial=1, technical=1/1 (now technically exhausted)
  const commercialBeforeC18 = (await usage(A, PH)).usage.discoveries.used;
  await rejects(discovery(A, PH), /quota_exceeded/); // technical refuses (commercial still has 2 of 3 left)
  const commercialAfterC18 = (await usage(A, PH)).usage.discoveries.used;
  assert.equal(commercialAfterC18, commercialBeforeC18, 'C18: a technical refusal must roll back the commercial consumption atomically, not leave it spent');
  await sql(`update prospectos_private.discovery_quota_settings set runs_per_hour=10`); // restore default
  console.log('PASS C18 — technical refusal atomically rolls back the commercial consumption (no partially-consumed state)');

  // === C19 — discovery/prospect usage-ledger amounts are always exactly what was granted ===
  const PI = '20000000-0000-4000-8000-000000000009';
  const OI = '10000000-0000-4000-8000-000000000009';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'I',$2)`, [OI, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OI, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS I')`, [PI, OI]);
  await discovery(A, PI);
  const grant1 = (await as(A, `select public.consume_prospect_entitlement($1,10) g`, [PI])).rows[0].g;
  const grant2 = (await as(A, `select public.consume_prospect_entitlement($1,30) g`, [PI])).rows[0].g; // only 15 remain of 25
  assert.equal(grant1, 10); assert.equal(grant2, 15);
  const ledgerSum = Number((await sql(`select coalesce(sum(amount),0) n from prospectos_private.commercial_usage where organization_id=$1 and metric='prospect'`, [OI])).rows[0].n);
  assert.equal(ledgerSum, 25, 'C19: the usage ledger must sum to exactly what was granted, never the raw requested amounts (10+30=40)');
  console.log('PASS C19 — usage ledger amounts always match granted units exactly, never the raw requested amounts');

  // === C20 — no idempotency key: documented, not fabricated ===
  // Neither start_discovery_metered nor consume_ai_operation take any client-supplied idempotency/
  // request key, and none is derived server-side. A client retry (e.g. after a network timeout on an
  // already-successful call) is therefore indistinguishable from a genuinely new request and IS counted
  // again. This mirrors the pre-existing behavior of the technical quotas (unchanged by this PR) — not
  // a regression introduced here. Documented in docs/COMMERCIAL_METERING.md rather than papered over.
  const PJ = '20000000-0000-4000-8000-00000000000a';
  const OJ = '10000000-0000-4000-8000-00000000000a';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'J',$2)`, [OJ, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OJ, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS J')`, [PJ, OJ]);
  await discovery(A, PJ);
  await discovery(A, PJ); // identical "replay" of the same logical request — no idempotency key exists to deduplicate it
  const uJ = await usage(A, PJ);
  assert.equal(uJ.usage.discoveries.used, 2, 'C20: without an idempotency key, an identical replay is counted twice — documented, not silently fixed');
  console.log('PASS C20 — no idempotency key exists for these operations (documented limitation, replay is double-counted as expected)');

  // === Red-team: old direct technical endpoints are closed to authenticated, live call (not just a
  // grant-table check) — proves the "forgotten endpoint" bypass is actually closed, not just declared ===
  await rejects(as(A, `select public.start_discovery($1,'restaurants','Toulouse','[]','fixture',1,'{}')`, [PA]), /permission denied/i);
  await rejects(as(A, `select public.consume_ai_offer_quota($1)`, [PA]), /permission denied/i);
  console.log('PASS red-team — authenticated cannot call the old technical RPCs directly anymore (live call, not just grants)');

  // === Red-team: an absurdly large amount is still safely capped to remaining, never overflows or
  // grants more than the plan allows ===
  const PK = '20000000-0000-4000-8000-00000000000b';
  const OK_ = '10000000-0000-4000-8000-00000000000b';
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'K',$2)`, [OK_, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [OK_, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Test SaaS K')`, [PK, OK_]);
  const hugeGrant = (await as(A, `select public.consume_prospect_entitlement($1,2000000000) g`, [PK])).rows[0].g;
  assert.equal(hugeGrant, 25, 'red-team: a huge requested amount must still be capped to the FREE limit (25), never overflow or over-grant');
  console.log('PASS red-team — an absurd requested amount is capped to the plan limit, no overflow');

  console.log('PASS: commercial metering/plans/entitlements engine (migration 006) — C1-C20');
} finally {
  await db.close();
}

// Idempotence: migration 006 must be re-applicable against a schema that already has it, without
// touching any of the C1-C20 state above (separate fresh instance, mirrors tests/ai-quota-db.mjs).
{
  const db2 = new PGlite();
  try {
    await db2.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    `);
    await db2.exec(schema); await db2.exec(m002); await db2.exec(m003); await db2.exec(m004); await db2.exec(m005); await db2.exec(m006);
    console.log('First apply of migration 006: OK');
    await db2.exec(m006);
    console.log('Second apply of migration 006: OK (idempotent, no error)');
  } finally {
    await db2.close();
  }
}
