// PostgreSQL integration coverage for migration 009: the api_usage_events ledger, the internal
// provider_pricing catalog, and the provider_credentials (BYOK) foundation. Discovery's own pipeline,
// scoring, quotas and RLS (migrations 002-008) are untouched and already covered by their own test
// files — this file only exercises what migration 009 actually adds.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const migration002 = await readFile(new URL('../db/migrations/002_discovery.sql', import.meta.url), 'utf8');
const migration008 = await readFile(new URL('../db/migrations/008_account_privacy_beta.sql', import.meta.url), 'utf8');
const migration009 = await readFile(new URL('../db/migrations/009_real_discovery_cost_byok.sql', import.meta.url), 'utf8');

async function sql(text, params = []) { return db.query(text, params); }
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
async function asAdmin(text, params = []) {
  await sql('reset role'); await sql('set role service_role');
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
async function rejects(operation, pattern) {
  await assert.rejects(operation, error => pattern.test(String(error?.message)));
}

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  -- Supabase provisions service_role with BYPASSRLS and broad default privileges on public/private
  -- schemas out of the box; the PGlite harness recreates that provisioning explicitly since it builds a
  -- bare cluster from scratch. Nothing in migration 009 itself grants this — it's the same pre-existing
  -- platform setup already relied upon (and empirically confirmed in production) for anonymizeAuthUser.
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`);
await db.exec(schema);
await db.exec(migration002);
await db.exec(migration008);
await db.exec(migration009);
// Idempotence: re-applying must not fail and must not duplicate any object.
await db.exec(migration009);
// Real Supabase projects grant service_role broad default privileges on every schema at provisioning
// time (empirically confirmed against production in the account-privacy-beta bloc: grant_beta_access
// is executable by service_role despite migration 008 never granting it explicitly) — this bare PGlite
// cluster has to recreate that provisioning explicitly, exactly like the table grants above.
await db.exec(`
  grant select,insert,update,delete on all tables in schema public to service_role;
  grant usage on schema prospectos_private to service_role;
  grant select,insert,update,delete on all tables in schema prospectos_private to service_role;
  grant execute on all functions in schema public to service_role;
  grant execute on all functions in schema prospectos_private to service_role;
`);
const usagePolicies = (await sql(`select count(*)::int n from pg_policies where tablename='api_usage_events'`)).rows[0].n;
assert.equal(usagePolicies, 1, 're-applying migration 009 does not duplicate the RLS policy');
const braveSeedRows = (await sql(`select count(*)::int n from prospectos_private.provider_pricing where version='brave-search-2026-09-18'`)).rows[0].n;
assert.equal(braveSeedRows, 1, 're-applying migration 009 does not duplicate the verified Brave pricing seed row');

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const OA = '10000000-0000-4000-8000-000000000001';
const OB = '10000000-0000-4000-8000-000000000002';
await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'member')`, [OA, A, OB, B]);
const project = (await sql(`insert into public.projects(organization_id,name) values ($1,'P') returning id`, [OA])).rows[0].id;

// ============================================================
// RC hardening review — explicit, exhaustive api_usage_events confirmation:
// RLS enabled; authenticated/anon can each neither INSERT, UPDATE nor DELETE; anon cannot even SELECT;
// tenant isolation and append-only immutability are covered further down (T, and the pricing/Q block).
// ============================================================
const rls = (await sql(`select relrowsecurity from pg_class where oid='public.api_usage_events'::regclass`)).rows[0];
assert.equal(rls.relrowsecurity, true, 'RLS is enabled on api_usage_events');

const dummyId = '20000000-0000-4000-8000-000000000099';
for (const role of [A, undefined]) {
  await rejects(as(role, `insert into public.api_usage_events(organization_id,user_id,provider,operation) values ($1,$2,'brave','search')`, [OA, A]),
    /permission denied/);
  await rejects(as(role, `update public.api_usage_events set estimated_cost_micros=1 where id=$1`, [dummyId]), /permission denied/);
  await rejects(as(role, `delete from public.api_usage_events where id=$1`, [dummyId]), /permission denied/);
}
// anon additionally cannot even read (authenticated members legitimately can, scoped by RLS — see T below).
await rejects(as(undefined, `select 1 from public.api_usage_events`), /permission denied/);

// ============================================================
// M/N — only the service-role path can write usage, and it's then visible to the owning org
// ============================================================
const event1 = (await asAdmin(
  `insert into public.api_usage_events(organization_id,project_id,user_id,provider,operation,request_count,estimated_cost_micros,pricing_version)
   values ($1,$2,$3,'brave','search',1,null,null) returning id,estimated_cost_micros`,
  [OA, project, A]
)).rows[0];
assert.equal(event1.estimated_cost_micros, null, 'M — no pricing configured yet: cost is null, never a guessed number');
const readByMember = (await as(A, `select * from public.api_usage_events where organization_id=$1`, [OA])).rows;
assert.equal(readByMember.length, 1, 'M — the owning organization can read its own usage event');

// T — tenant isolation: organization B cannot read organization A's usage.
const readByOtherTenant = (await as(B, `select * from public.api_usage_events where organization_id=$1`, [OA])).rows;
assert.equal(readByOtherTenant.length, 0, "T — a foreign tenant reads zero rows of another organization's usage, RLS silently filters rather than erroring");

// ============================================================
// O — estimated_cost_micros is always an integer (schema-level, not just convention)
// ============================================================
const costColumn = (await sql(`select data_type from information_schema.columns where table_name='api_usage_events' and column_name='estimated_cost_micros'`)).rows[0];
assert.equal(costColumn.data_type, 'bigint', 'O — estimated_cost_micros is an integer column, never numeric/float');
await rejects(asAdmin(`insert into public.api_usage_events(organization_id,user_id,provider,operation,estimated_cost_micros) values ($1,$2,'brave','search',-1)`, [OA, A]),
  /violates check constraint/);

// ============================================================
// Verified Brave seed (RC hardening review): migration 009 now ships a real, operator-confirmed price
// row (brave/search/request, 5000 micros, version 'brave-search-2026-09-18'). This checks the seed
// itself is correct and live — the P/Q versioning-mechanism test right below deliberately uses a
// different provider/operation combo so it can control its own v1/v2 transition without colliding with
// this real row.
// ============================================================
const braveSeedCost = (await asAdmin(`select public.resolve_provider_cost('brave','search',null,'[{"unit_type":"request","quantity":1}]'::jsonb) r`)).rows[0].r;
assert.equal(braveSeedCost.estimated_cost_micros, 5000, 'verified Brave tariff: $5/1,000 requests = 5000 micros/request');
assert.equal(braveSeedCost.pricing_version, 'brave-search-2026-09-18');
// Smoke-budget scenario (item 7): 3 results from Brave still costs exactly one search request.
const braveSeedCostForSmoke = (await asAdmin(`select public.resolve_provider_cost('brave','search',null,'[{"unit_type":"request","quantity":1}]'::jsonb) r`)).rows[0].r;
assert.equal(braveSeedCostForSmoke.estimated_cost_micros, 5000, 'the smoke-test budget (1 request, up to 3 results) costs exactly 5000 micros — never more, since Brave bills per request, not per result');

// ============================================================
// P/Q — pricing_version is frozen at write time; a later tariff change never rewrites history.
// Uses anthropic/offer_analysis (never seeded with a real price by this bloc — see item 6) purely as a
// mechanism test, fully decoupled from the real Brave row verified above.
// ============================================================
await asAdmin(`insert into prospectos_private.provider_pricing(provider,operation,model,unit_type,price_per_unit_micros,version) values ('anthropic','offer_analysis',null,'input_tokens_1k',250,'test-v1')`);
const costV1 = (await asAdmin(`select public.resolve_provider_cost('anthropic','offer_analysis',null,'[{"unit_type":"input_tokens_1k","quantity":1}]'::jsonb) r`)).rows[0].r;
assert.equal(costV1.estimated_cost_micros, 250, 'Q — cost computed from the active v1 price');
assert.equal(costV1.pricing_version, 'test-v1');
const eventV1 = (await asAdmin(
  `insert into public.api_usage_events(organization_id,user_id,provider,operation,estimated_cost_micros,pricing_version) values ($1,$2,'anthropic','offer_analysis',$3,$4) returning id`,
  [OA, A, costV1.estimated_cost_micros, costV1.pricing_version]
)).rows[0];

// A new tariff is added (never an UPDATE of the old row) — the already-recorded event must not change.
await asAdmin(`update prospectos_private.provider_pricing set effective_to=now() where version='test-v1'`);
await asAdmin(`insert into prospectos_private.provider_pricing(provider,operation,model,unit_type,price_per_unit_micros,version) values ('anthropic','offer_analysis',null,'input_tokens_1k',900,'test-v2')`);
const costV2 = (await asAdmin(`select public.resolve_provider_cost('anthropic','offer_analysis',null,'[{"unit_type":"input_tokens_1k","quantity":1}]'::jsonb) r`)).rows[0].r;
assert.equal(costV2.estimated_cost_micros, 900, 'Q — a new call now prices at v2');
const frozenEvent = (await asAdmin(`select estimated_cost_micros,pricing_version from public.api_usage_events where id=$1`, [eventV1.id])).rows[0];
assert.equal(frozenEvent.estimated_cost_micros, 250, "Q — the historical event keeps its original, frozen cost after a tariff change");
assert.equal(frozenEvent.pricing_version, 'test-v1');
// The real Brave seed itself must also stay completely unaffected by an unrelated provider's tariff change.
const braveStillFrozen = (await asAdmin(`select public.resolve_provider_cost('brave','search',null,'[{"unit_type":"request","quantity":1}]'::jsonb) r`)).rows[0].r;
assert.equal(braveStillFrozen.estimated_cost_micros, 5000, "the verified Brave tariff is unaffected by an unrelated anthropic pricing change");

// Append-only: even service_role cannot rewrite or delete a ledger row (mirrors event_immutable).
await rejects(asAdmin(`update public.api_usage_events set estimated_cost_micros=1 where id=$1`, [eventV1.id]), /append-only/);
await rejects(asAdmin(`delete from public.api_usage_events where id=$1`, [eventV1.id]), /append-only/);

// No pricing configured at all for openai/offer_analysis → null, never a guess (item 6: no Anthropic/
// OpenAI tariff is inserted by this bloc since AI_MODEL is operator-configured and unknown here).
const noPricing = (await asAdmin(`select public.resolve_provider_cost('openai','offer_analysis',null,'[{"unit_type":"output_tokens_1k","quantity":2}]'::jsonb) r`)).rows[0].r;
assert.equal(noPricing, null, 'no fabricated cost when no active pricing row exists for that provider/operation/unit');

// ============================================================
// Item 2 — internal pricing/cost functions are unreachable by anon/authenticated, period.
// ============================================================
await rejects(as(A, `select public.resolve_provider_cost('brave','search',null,'[{"unit_type":"request","quantity":1}]'::jsonb)`), /permission denied/);
await rejects(as(undefined, `select public.resolve_provider_cost('brave','search',null,'[{"unit_type":"request","quantity":1}]'::jsonb)`), /permission denied/);
await rejects(as(A, `select prospectos_private.require_owner($1)`, [OA]), /permission denied/);

console.log('PASS discovery-cost-byok-db: cost ledger — no-client-write, tenant isolation, integer cost, verified Brave tariff, frozen pricing history, append-only, pricing RPCs unreachable by anon/authenticated');

// ============================================================
// BYOK — opaque table, owner-gated mutation, no secret ever returned, tenant isolation
// ============================================================
await rejects(as(A, `select * from public.provider_credentials`), /permission denied/);

// PGlite's own client-side parameter binding wants raw bytes (Buffer/Uint8Array) for a bytea-typed
// parameter — unlike PostgREST/supabase-js, which accepts the `\x`-prefixed hex text form in JSON (see
// src/server/byok.ts's toBytea, which targets that real path, not this raw wire-protocol test harness).
const ciphertext = Buffer.from('super-secret-api-key');
const iv = Buffer.from('123456789012'); // 12 bytes
const tag = Buffer.from('1234567890123456'); // 16 bytes

// Y (part 1) — a plain member (not owner) of organization B cannot save a credential for B.
await rejects(as(B, `select public.save_provider_credential($1,'brave',$2,$3,$4,'abcd')`, [OB, ciphertext, iv, tag]),
  /Organization owner required/);

// W — save never returns the secret, only public metadata.
const saved = (await as(A, `select public.save_provider_credential($1,'brave',$2,$3,$4,'abcd') r`, [OA, ciphertext, iv, tag])).rows[0].r;
assert.deepEqual(Object.keys(saved).sort(), ['created_at', 'key_last4', 'provider', 'updated_at'], 'W — the RPC response never carries encrypted_secret/iv/auth_tag');
assert.equal(saved.key_last4, 'abcd');

// W — list never returns the secret either.
const listed = (await as(A, `select public.list_provider_credentials($1) r`, [OA])).rows[0].r;
assert.equal(listed.length, 1);
assert.deepEqual(Object.keys(listed[0]).sort(), ['created_at', 'key_last4', 'provider', 'updated_at']);

// Y (part 2) — a non-member of organization A cannot list or delete its BYOK credentials at all.
await rejects(as(B, `select public.list_provider_credentials($1)`, [OA]), /Authenticated tenant member required/);
await rejects(as(B, `select public.delete_provider_credential($1,'brave')`, [OA]), /Organization owner required/);

// The legitimate owner can still delete their own, and re-saving after deletion works (upsert path).
await as(A, `select public.delete_provider_credential($1,'brave')`, [OA]);
const afterDelete = (await as(A, `select public.list_provider_credentials($1) r`, [OA])).rows[0].r;
assert.equal(afterDelete.length, 0, "the owner's own delete actually removed the credential");
await as(A, `select public.save_provider_credential($1,'brave',$2,$3,$4,'zzzz')`, [OA, ciphertext, iv, tag]);
const resaved = (await as(A, `select public.list_provider_credentials($1) r`, [OA])).rows[0].r;
assert.equal(resaved.length, 1);
assert.equal(resaved[0].key_last4, 'zzzz', 're-saving the same provider replaces (upserts) rather than duplicating the credential row');

console.log('PASS discovery-cost-byok-db: BYOK — opaque table, owner-gated mutation, no secret ever returned, tenant isolation');
