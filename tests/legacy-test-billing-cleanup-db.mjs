// Migration 034 (one-off release of the Stripe TEST billing link of one Production account) against real PostgreSQL
// (PGlite) with the full migration chain. Pins: no-op when nothing of that account exists; the exact legacy state →
// that one billing row deleted and that one PAID/ACTIVE entitlement EXPIRED (dates kept, no right granted back); any
// partial or different state → raise and nothing changes; other accounts (even on the same TEST price) never touched;
// re-applying is a no-op; the file creates no function, trigger, policy or audit object.
// Run with: node tests/legacy-test-billing-cleanup-db.mjs
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const U = 'e1c92fcc-e6ee-4129-ad82-dbe02c509239', OTHER = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const C = 'cus_VNDxtnO2ieMnfv', S = 'sub_1UMTb0K2DvPVYtXoDXb65GMW', P = 'price_1UKOiSK2DvPVYtXoQTSy3db6';
const START = '2026-10-03T14:07:24Z', END = '2026-11-03T14:07:24Z';
const db = new PGlite();
const sql = (text, params = []) => db.query(text, params);
const FILE = await readFile(new URL('../db/migrations/034_release_legacy_test_billing.sql', import.meta.url), 'utf8');
const code = FILE.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).split('\n')[0]]); }
}
const billing = async () => (await sql('select user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan,subscription_status from prospectos_private.billing_accounts order by user_id')).rows;
const ent = async u => (await sql('select plan,status,starts_at,expires_at from public.account_entitlements where user_id=$1', [u])).rows[0] ?? null;
const snapshot = async () => JSON.stringify([await billing(), await ent(U), await ent(OTHER), (await sql('select count(*)::int n from prospectos_private.stripe_webhook_events')).rows[0].n]);
async function reset() {
  await sql('delete from prospectos_private.billing_accounts');
  await sql('delete from public.account_entitlements where user_id in ($1,$2)', [U, OTHER]);
}
async function setEnt(u, plan, status = 'ACTIVE') {
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values($1,$2,$3,$4,$5)
    on conflict (user_id) do update set plan=excluded.plan,status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at`, [u, plan, status, START, END]);
}
async function setBilling(u, { customer = C, subscription = S, price = P, plan = 'PAID', status = 'active' } = {}) {
  await sql(`insert into prospectos_private.billing_accounts(user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan,subscription_status,current_period_start,current_period_end,cancel_at_period_end)
    values($1,$2,$3,$4,$5,$6,$7,$8,true)`, [u, customer, subscription, price, plan, status, START, END]);
}
async function legacy() { await setBilling(U); await setEnt(U, 'PAID'); }
async function refusedUnchanged(what) {
  const before = await snapshot();
  let error = null;
  try { await db.exec(FILE); } catch (e) { error = String(e?.message); }
  if (error === null) throw new Error(`BYPASS: ${what} was cleaned`);
  assert.match(error, /release_legacy_test_billing/, `refused for the wrong reason (${error})`);
  assert.equal(await snapshot(), before, 'the whole migration rolled back');
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
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  assert.deepEqual(migrations.slice(migrations.indexOf('034_release_legacy_test_billing.sql')), ['034_release_legacy_test_billing.sql', '035_self_outreach.sql'], '034 is followed only by 035 (Self-Outreach: its own tables, no billing or entitlement row)');

  await check('FILE: one DO block, no persistent object, no audit or Stripe event write', async () => {
    assert.match(code, /^do \$\$/m);
    assert.doesNotMatch(code, /create\s+(or\s+replace\s+)?(function|procedure|trigger|policy|table|view|role)|alter\s+|drop\s+|disable|grant\s|revoke\s/i);
    assert.doesNotMatch(code, /public\.events|append_event|stripe_webhook_events|insert\s+into/i);
    assert.equal([...code.matchAll(/delete\s+from\s+([\w.]+)/gi)].map(m => m[1]).join(','), 'prospectos_private.billing_accounts');
    assert.equal([...code.matchAll(/update\s+([\w.]+)\s+set/gi)].map(m => m[1]).join(','), 'public.account_entitlements');
    for (const id of [U, C, S, P]) assert.equal(code.split(id).length - 1, 1, `${id} declared once`);
    assert.match(code, /set status='EXPIRED',updated_at=now\(\)\n  where user_id=v_user and plan='PAID' and status='ACTIVE';/);
  });

  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  await sql('insert into auth.users(id,email) values($1,$2),($3,$4)', [U, 'demo@example.test', OTHER, 'other@example.test']);

  await check('NO_OP: the full chain on a database without that account changes nothing', async () => {
    await reset();
    const before = await snapshot();
    await db.exec(FILE);
    assert.equal(await snapshot(), before);
  });

  await check('NO_OP: the account with an entitlement other than PAID/ACTIVE and no billing row', async () => {
    await reset(); await setEnt(U, 'PAID', 'EXPIRED');
    const before = await snapshot();
    await db.exec(FILE);
    assert.equal(await snapshot(), before);
  });

  await check('CLEANUP: exact legacy state → its billing row deleted, its entitlement EXPIRED, nothing else', async () => {
    await reset(); await legacy();
    await setBilling(OTHER, { customer: 'cus_otherLive1', subscription: 'sub_otherLive1' }); await setEnt(OTHER, 'PAID');
    const webhooks = (await sql('select count(*)::int n from prospectos_private.stripe_webhook_events')).rows[0].n;
    await db.exec(FILE);
    assert.deepEqual((await billing()).map(r => r.user_id), [OTHER], 'only the target row is gone');
    const e = await ent(U);
    assert.equal(e.plan, 'PAID'); assert.equal(e.status, 'EXPIRED', 'no trial or other right granted back');
    assert.equal(new Date(e.starts_at).toISOString(), new Date(START).toISOString()); assert.equal(new Date(e.expires_at).toISOString(), new Date(END).toISOString());
    assert.equal((await ent(OTHER)).status, 'ACTIVE', 'another account on the same TEST price is untouched');
    assert.equal((await sql('select count(*)::int n from prospectos_private.stripe_webhook_events')).rows[0].n, webhooks);
  });

  await check('IDEMPOTENT: re-applying after the cleanup is a no-op', async () => {
    const before = await snapshot();
    await db.exec(FILE);
    assert.equal(await snapshot(), before);
  });

  await check('PARTIAL: PAID/ACTIVE entitlement without its billing row → raise', async () => {
    await reset(); await setEnt(U, 'PAID');
    await refusedUnchanged('an entitlement without billing row');
  });
  await check('PARTIAL: the account linked to another customer → raise', async () => {
    await reset(); await setBilling(U, { customer: 'cus_differentOne' }); await setEnt(U, 'PAID');
    await refusedUnchanged('another customer');
  });
  await check('PARTIAL: the TEST customer linked to another user → raise', async () => {
    await reset(); await setBilling(OTHER); await setEnt(U, 'PAID');
    await refusedUnchanged('the customer on another user');
  });
  await check('PARTIAL: another subscription or price → raise', async () => {
    await reset(); await setBilling(U, { subscription: 'sub_differentOne' }); await setEnt(U, 'PAID');
    await refusedUnchanged('another subscription');
    await reset(); await setBilling(U, { price: 'price_differentOne' }); await setEnt(U, 'PAID');
    await refusedUnchanged('another price');
  });
  await check('PARTIAL: subscription no longer active → raise', async () => {
    await reset(); await setBilling(U, { status: 'canceled' }); await setEnt(U, 'PAID');
    await refusedUnchanged('a canceled subscription');
  });
  await check('PARTIAL: entitlement missing, EXPIRED, or a manual plan → raise', async () => {
    await reset(); await setBilling(U);
    await refusedUnchanged('no entitlement');
    await setEnt(U, 'PAID', 'EXPIRED');
    await refusedUnchanged('an EXPIRED entitlement');
    await setEnt(U, 'INTERNAL');
    await refusedUnchanged('an INTERNAL entitlement');
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
