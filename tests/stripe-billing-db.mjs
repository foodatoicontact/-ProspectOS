// Stripe Billing (migration 017) end to end against real PostgreSQL (PGlite) with the full migration chain:
// a signed webhook → handleStripeWebhook (the production code) → the SERVER-ONLY SQL functions, executed as
// service_role exactly like the admin client → entitlements, periods and quotas read back as a member.
// Stripe itself is a fake returning the subscription the test describes; no network, no key.
// Run with: node --experimental-strip-types tests/stripe-billing-db.mjs
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { handleStripeWebhook } from '../src/server/billing/webhook.ts';
import { startCheckout } from '../src/server/billing/checkout.ts';
import { billingConfig } from '../src/server/billing/config.ts';
import { signPayload } from '../src/server/billing/signature.ts';

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

// Fake configuration: identifiers built at runtime, never a real key.
const WHSEC = ['whsec', 'dbfake000'].join('_');
const config = billingConfig({ STRIPE_SECRET_KEY: ['sk', 'test', 'dbfake000'].join('_'), STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PRICE_BETA: 'price_beta49', STRIPE_PRICE_PRO: 'price_pro99', BILLING_ENABLED: 'true', VERCEL_ENV: 'preview' });
const store = {
  getAccount: async u => (await asService('select public.get_billing_account($1) a', [u])).rows[0].a ?? null,
  linkCustomer: async (u, c) => (await asService('select public.link_stripe_customer($1,$2) c', [u, c])).rows[0].c,
  applyState: async s => (await asService('select public.apply_stripe_subscription_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r',
    [s.eventId, s.eventType, s.customerId, s.subscriptionId, s.priceId, s.plan, s.status, s.periodStart, s.periodEnd, s.cancelAtPeriodEnd, s.paid])).rows[0].r,
};
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const PRICE = { price_beta49: 4900, price_pro99: 9900, price_unknown: 4900 };
const subscription = ({ id = 'sub_1', customer, price = 'price_beta49', status = 'active', start, end, cancel = false, invoice = 'paid' }) => ({
  id, customer, status, cancel_at_period_end: cancel, livemode: false,
  items: { data: [{ price: { id: price, unit_amount: PRICE[price], currency: 'eur', recurring: { interval: 'month' } }, current_period_start: start, current_period_end: end }] },
  latest_invoice: { id: 'in_1', status: invoice },
});
let seq = 0;
// Delivers one signed event; Stripe answers `sub` when the server re-reads the subscription.
async function deliver(type, sub, { id = `evt_${++seq}`, secret = WHSEC, object } = {}) {
  const obj = object ?? (type.startsWith('invoice.') ? { subscription: sub.id } : type === 'checkout.session.completed' ? { mode: 'subscription', subscription: sub.id } : { id: sub.id });
  const raw = JSON.stringify({ id, type, livemode: false, data: { object: obj } });
  const t = nowS();
  const stripe = { retrieveSubscription: async () => sub };
  return handleStripeWebhook(raw, `t=${t},v1=${signPayload(raw, secret, t)}`, { config, stripe, store });
}
const iso = s => new Date(s * 1000).toISOString();

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
  // 017 is this bloc's migration; 018 (deleted accounts release their beta seat) only re-creates account/trial functions.
  // 019 (Discovery register provider) only widens the Discovery provider checks and start_discovery: no billing object.
  assert.deepEqual(migrations.slice(migrations.indexOf('017_stripe_billing.sql')), ['017_stripe_billing.sql', '018_deleted_accounts_release_beta_capacity.sql', '019_discovery_registry_provider.sql', '020_public_trial_availability.sql', '021_discovery_failed_run_not_billed.sql', '022_team_pro.sql', '023_team_offer.sql', '024_signals.sql', '025_pipeline_feedback.sql', '026_signal_monitoring.sql']);
  // 024 (Signal Engine) has no billing object: no entitlement, no Stripe state.
  assert.doesNotMatch((await readFile(new URL('../db/migrations/024_signals.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n'), /stripe|billing|entitlement/i);
  // 025 (pipeline feedback) has no billing object either.
  assert.doesNotMatch((await readFile(new URL('../db/migrations/025_pipeline_feedback.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n'), /stripe|billing|entitlement/i);
  // 026 (monitoring) READS the caller's effective plan to cap monitoring; it never writes an entitlement nor any Stripe state.
  const m026 = (await readFile(new URL('../db/migrations/026_signal_monitoring.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(m026, /stripe|billing|(insert into|update|delete from) public\.account_entitlements/i);
  assert.deepEqual([...new Set(m026.match(/\w*entitlement\w*/gi))].sort(), ['get_effective_entitlement', 'p_entitlement']);
  // 023 (Équipe offer) extends this bloc's own billing functions with the TEAM plan and its seats: tests/team-offer-db.mjs.
  assert.doesNotMatch((await readFile(new URL('../db/migrations/019_discovery_registry_provider.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.startsWith('--')).join('\n'), /stripe|billing|subscription|entitlement|beta_program/i);
  // 022 (Pro team) reads entitlements to bill a team on its owner's plan; it never writes an entitlement nor a billing object.
  const m022 = (await readFile(new URL('../db/migrations/022_team_pro.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.startsWith('--')).join('\n');
  assert.doesNotMatch(m022, /stripe|billing_|subscription|(insert into|update|delete from) public\.account_entitlements/i);
  // 021 (failed run not billed) touches Discovery units only: no billing object, no entitlement.
  assert.doesNotMatch((await readFile(new URL('../db/migrations/021_discovery_failed_run_not_billed.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.startsWith('--')).join('\n'), /stripe|billing|subscription|entitlement/i);
  // 020 (public trial availability) only READS the beta seats: no billing object, no write anywhere.
  assert.doesNotMatch((await readFile(new URL('../db/migrations/020_public_trial_availability.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.startsWith('--')).join('\n'), /stripe|billing|subscription|insert |update |delete |alter |drop table/i);
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=100000, analyses_per_hour=100000, analyses_per_user_per_hour=100000, ai_offer_per_hour=100000');

  const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  const users = { trial: U(1), pro: U(2), legacy: U(3), internal: U(4), gone: U(5), ent: U(6), other: U(7), fresh: U(8) };
  for (const [k, id] of Object.entries(users)) await sql('insert into auth.users(id,email) values ($1,$2)', [id, `${k}@test`]);
  const ctx = {};
  for (const [k, u] of Object.entries(users)) {
    const org = (await as(u, `select public.create_organization('Org') id`)).rows[0].id;
    const project = (await as(u, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [org])).rows[0].id;
    const prospect = (await as(u, `insert into public.prospects(organization_id,project_id,name,website,status) values($1,$2,'Studio','https://studio.example','À analyser') returning id`, [org, project])).rows[0].id;
    ctx[k] = { user: u, org, project, prospect };
  }
  // Existing production-like entitlements: a 7-day trial ('BETA'), a manual paid one ('PAID'), INTERNAL.
  const entitle = (u, plan, start, end, status = 'ACTIVE') => sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,$2,$3,$4,$5)
    on conflict (user_id) do update set plan=excluded.plan,status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at`, [u, plan, status, iso(start), iso(end)]);
  const n0 = nowS();
  for (const k of ['trial', 'pro', 'gone', 'other']) await entitle(users[k], 'BETA', n0 - 2 * DAY, n0 + 5 * DAY);
  await entitle(users.legacy, 'PAID', n0 - 10 * DAY, n0 + 20 * DAY);
  await entitle(users.internal, 'INTERNAL', n0 - DAY, n0 + 3650 * DAY);
  const ent = u => sql('select plan,status,starts_at,expires_at,updated_at from public.account_entitlements where user_id=$1', [u]).then(r => r.rows[0]);
  const usage = u => as(u, 'select public.get_commercial_usage() u').then(r => r.rows[0].u);
  const billing = u => as(u, 'select public.get_billing_status() b').then(r => r.rows[0].b);
  const discover = c => as(c.user, `select public.start_discovery($1,'studios sport','Lyon','[]','brave',20,'{}'::jsonb) run`, [c.project]);
  const analyze = c => as(c.user, 'select public.consume_analysis_quota($1)', [c.prospect]);
  const prefill = (c, action, n, at = 'now()') => sql(`insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id,used_at) select $1,$2,$3,${at} from generate_series(1,$4)`, [c.org, action, c.user, n]);
  const events = () => sql('select count(*)::int n from prospectos_private.stripe_webhook_events').then(r => r.rows[0].n);
  // Customers are linked the way checkout links them (service_role, link_stripe_customer).
  for (const [k, c] of [['trial', 'cus_trial'], ['pro', 'cus_pro'], ['internal', 'cus_internal'], ['gone', 'cus_gone'], ['other', 'cus_other']]) await store.linkCustomer(users[k], c);
  const P0 = n0 - DAY, P1 = n0 + 29 * DAY, P2 = n0 + 59 * DAY;

  // ---------------------------------------------------------------- privileges
  await check('PRIVATE: members cannot read billing tables nor call server-only functions; anon cannot read a status', async () => {
    for (const t of ['billing_accounts', 'stripe_webhook_events', 'enterprise_limits'])
      await refused(() => as(users.trial, `select * from prospectos_private.${t}`), /permission denied/, `reading ${t}`);
    await refused(() => as(users.trial, `select public.link_stripe_customer($1,'cus_evil')`, [users.trial]), /permission denied/, 'link_stripe_customer as a member');
    await refused(() => as(users.trial, 'select public.get_billing_account($1)', [users.pro]), /permission denied/, 'get_billing_account as a member');
    await refused(() => as(users.trial, `select public.apply_stripe_subscription_state('evt_x','invoice.paid','cus_trial','sub_x','price_pro99','PRO','active',now(),now()+interval '30 days',false,true)`), /permission denied/, 'granting oneself PRO');
    await refused(() => as(users.trial, `select public.grant_enterprise_access('trial@test',now(),now()+interval '1 year',9999,9999,9999)`), /permission denied/, 'granting oneself ENTERPRISE');
    await refused(() => asService(`select public.grant_enterprise_access('trial@test',now(),now()+interval '1 year',9999,9999,9999)`), /permission denied/, 'ENTERPRISE through the app server');
    await refused(() => as(users.trial, `update public.account_entitlements set plan='PRO' where user_id=$1`, [users.trial]), /permission denied/, 'writing one\'s own plan');
    await refused(() => as(undefined, 'select public.get_billing_status()'), /permission denied|Authentication required/, 'anon status');
    const b = await billing(users.trial);
    // 023 adds the paid seats of an Équipe subscription (null otherwise): still no Stripe identifier.
    assert.deepEqual(Object.keys(b).sort(), ['cancel_at_period_end', 'current_period_end', 'has_customer', 'plan', 'seats', 'status']);
    assert.doesNotMatch(JSON.stringify(b), /cus_|sub_|price_/, 'no Stripe identifier reaches the browser');
    assert.deepEqual(await billing(users.legacy), { has_customer: false });
  });

  // ---------------------------------------------------------------- I, V: checkout completed ≠ paid
  await check('I, V: checkout.session.completed with an unconfirmed payment links the subscription, the trial stays a trial', async () => {
    const r = await deliver('checkout.session.completed', subscription({ id: 'sub_t', customer: 'cus_trial', status: 'incomplete', start: P0, end: P1, invoice: 'open' }));
    assert.equal(r.status, 200); assert.equal(r.body.outcome, 'status_synced');
    const e = await ent(users.trial); assert.equal(e.plan, 'BETA'); assert.equal(e.status, 'ACTIVE');
    assert.equal((await usage(users.trial)).discovery_limit, 20, 'still the 20 / 50 / 5 trial');
    assert.equal((await billing(users.trial)).status, 'incomplete');
  });

  // ---------------------------------------------------------------- J, K, X, Z: invoice.paid
  await check('J, K, X, Z: invoice.paid → BETA (db PAID) over the Stripe period, 100 / 250 / 25, counters restart at the period start', async () => {
    await prefill(ctx.trial, 'discovery', 7, `to_timestamp(${P0 - 3600})`); // used during the trial, before the paid period
    await prefill(ctx.trial, 'discovery', 2); // inside the paid period
    const r = await deliver('invoice.paid', subscription({ id: 'sub_t', customer: 'cus_trial', start: P0, end: P1 }));
    assert.equal(r.body.outcome, 'granted');
    const e = await ent(users.trial);
    assert.equal(e.plan, 'PAID'); assert.equal(e.status, 'ACTIVE');
    assert.equal(e.starts_at.toISOString(), iso(P0)); assert.equal(e.expires_at.toISOString(), iso(P1));
    const u = await usage(users.trial);
    assert.deepEqual([u.discovery_limit, u.analysis_limit, u.ai_offer_limit], [100, 250, 25]);
    assert.equal(u.discovery_used, 2, 'only the uses of the current Stripe period count');
    assert.equal(u.period_end, iso(P1).replace('.000Z', '+00:00'));
  });
  await check('Trial → paid keeps the organization, projects and prospects; activate_trial never downgrades the paid plan', async () => {
    assert.equal((await as(users.trial, 'select count(*)::int n from public.prospects')).rows[0].n, 1);
    assert.equal((await as(users.trial, 'select count(*)::int n from public.projects')).rows[0].n, 1);
    const again = (await as(users.trial, 'select public.activate_trial() r')).rows[0].r;
    assert.equal(again.plan, 'PAID');
  });

  // ---------------------------------------------------------------- O, AD: idempotence
  await check('O: the same event delivered again has no effect at all (no second period change, no second reset)', async () => {
    const sub = subscription({ id: 'sub_t', customer: 'cus_trial', start: P0, end: P1 });
    const first = await deliver('invoice.paid', sub, { id: 'evt_replay' });
    const before = await ent(users.trial); const count = await events();
    const replay = await deliver('invoice.paid', sub, { id: 'evt_replay' });
    assert.equal(first.body.outcome, 'unchanged'); assert.equal(replay.body.outcome, 'duplicate');
    assert.deepEqual(await ent(users.trial), before); assert.equal(await events(), count);
  });
  await check('AD: two deliveries of one event at the same moment → applied once, the other is a duplicate', async () => {
    const args = ['evt_simultaneous', 'invoice.paid', 'cus_other', 'sub_o', 'price_pro99', 'PRO', 'active', iso(P0), iso(P1), false, true];
    const q = 'select public.apply_stripe_subscription_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r';
    const [a, b] = await Promise.all([sql(q, args), sql(q, args)]);
    assert.deepEqual([a.rows[0].r.outcome, b.rows[0].r.outcome].sort(), ['duplicate', 'granted']);
    assert.equal((await sql(`select count(*)::int n from prospectos_private.stripe_webhook_events where event_id='evt_simultaneous'`)).rows[0].n, 1);
    assert.equal((await sql(`select count(*)::int n from prospectos_private.billing_accounts where user_id=$1`, [users.other])).rows[0].n, 1, 'one billing row, one customer');
  });

  // ---------------------------------------------------------------- L, Y: PRO
  await check('L, Y: PRO price → PRO, 300 / 750 / 75, enforced by the database', async () => {
    const r = await deliver('invoice.paid', subscription({ id: 'sub_p', customer: 'cus_pro', price: 'price_pro99', start: P0, end: P1 }));
    assert.equal(r.body.outcome, 'granted'); assert.equal((await ent(users.pro)).plan, 'PRO');
    const u = await usage(users.pro); assert.deepEqual([u.discovery_limit, u.analysis_limit, u.ai_offer_limit], [300, 750, 75]);
    await prefill(ctx.pro, 'discovery', 299); await discover(ctx.pro);
    await refused(() => discover(ctx.pro), /plan_limit_reached/, 'the 301st Discovery of the period');
    await prefill(ctx.pro, 'analysis', 750);
    await refused(() => analyze(ctx.pro), /plan_limit_reached/, 'the 751st analysis');
  });

  // ---------------------------------------------------------------- M
  await check('M: an unknown price, even active and paid, grants nothing (logged outcome unknown_price)', async () => {
    const before = await ent(users.fresh);
    await store.linkCustomer(users.fresh, 'cus_fresh');
    const r = await deliver('invoice.paid', subscription({ id: 'sub_f', customer: 'cus_fresh', price: 'price_unknown', start: P0, end: P1 }));
    assert.equal(r.body.outcome, 'unknown_price'); assert.deepEqual(await ent(users.fresh), before);
    assert.equal(before, undefined, 'still no entitlement: the application gate keeps refusing paid actions');
  });

  // ---------------------------------------------------------------- N
  await check('N: a forged event (wrong signature) changes nothing in the database', async () => {
    const count = await events(); const before = await ent(users.fresh);
    const r = await deliver('invoice.paid', subscription({ id: 'sub_f', customer: 'cus_fresh', price: 'price_pro99', start: P0, end: P1 }), { secret: 'whsec_attacker' });
    assert.equal(r.status, 400); assert.equal(await events(), count); assert.deepEqual(await ent(users.fresh), before);
  });

  // ---------------------------------------------------------------- P, T: past_due / payment failed
  await check('P, T: invoice.payment_failed / past_due → status synced, warning available, nothing extended, nothing deleted', async () => {
    const renewal = subscription({ id: 'sub_p', customer: 'cus_pro', price: 'price_pro99', status: 'past_due', start: P1, end: P2, invoice: 'open' });
    const r = await deliver('invoice.payment_failed', renewal);
    assert.equal(r.body.outcome, 'status_synced');
    const e = await ent(users.pro); assert.equal(e.status, 'ACTIVE'); assert.equal(e.expires_at.toISOString(), iso(P1), 'access runs to the end of the PAID period only');
    assert.equal((await billing(users.pro)).status, 'past_due');
    assert.equal((await as(users.pro, 'select count(*)::int n from public.prospects')).rows[0].n, 1);
    const r2 = await deliver('customer.subscription.updated', renewal);
    assert.equal(r2.body.outcome, 'status_synced');
  });
  await check('Z: renewal paid → the window moves to the new Stripe period and the counters restart; an older state never moves it back', async () => {
    const r = await deliver('invoice.paid', subscription({ id: 'sub_p', customer: 'cus_pro', price: 'price_pro99', start: P1, end: P2 }));
    assert.equal(r.body.outcome, 'granted');
    const e = await ent(users.pro); assert.equal(e.starts_at.toISOString(), iso(P1)); assert.equal(e.expires_at.toISOString(), iso(P2));
    const stale = await deliver('customer.subscription.updated', subscription({ id: 'sub_p', customer: 'cus_pro', price: 'price_pro99', start: P0, end: P1 }));
    assert.equal(stale.body.outcome, 'unchanged'); assert.equal((await ent(users.pro)).expires_at.toISOString(), iso(P2));
    await sql('update public.account_entitlements set starts_at=$2, expires_at=$3 where user_id=$1', [users.pro, iso(P0), iso(P1)]); // back to the current period for the next checks
    await sql(`update prospectos_private.billing_accounts set current_period_start=$2,current_period_end=$3,subscription_status='active' where user_id=$1`, [users.pro, iso(P0), iso(P1)]);
  });

  // ---------------------------------------------------------------- Q, R, S
  await check('Q: cancel_at_period_end → access kept until the period end, shown to the member', async () => {
    const r = await deliver('customer.subscription.updated', subscription({ id: 'sub_t', customer: 'cus_trial', start: P0, end: P1, cancel: true }));
    assert.ok(['unchanged', 'status_synced'].includes(r.body.outcome));
    const e = await ent(users.trial); assert.equal(e.status, 'ACTIVE'); assert.equal(e.expires_at.toISOString(), iso(P1));
    const b = await billing(users.trial); assert.equal(b.cancel_at_period_end, true);
    await discover(ctx.trial);
  });
  await check('R, S: subscription deleted → paid actions refused, every business row kept, account still readable', async () => {
    const r = await deliver('customer.subscription.deleted', subscription({ id: 'sub_t', customer: 'cus_trial', status: 'canceled', start: P0, end: P1, cancel: true }));
    assert.equal(r.body.outcome, 'access_ended');
    assert.equal((await ent(users.trial)).status, 'EXPIRED');
    await refused(() => discover(ctx.trial), /plan_limit_reached/, 'a Discovery after the end of the subscription');
    await refused(() => analyze(ctx.trial), /plan_limit_reached/, 'an analysis after the end of the subscription');
    for (const t of ['organizations', 'projects', 'prospects']) assert.equal((await as(users.trial, `select count(*)::int n from public.${t}`)).rows[0].n, 1, t);
    assert.equal((await usage(users.trial)).active, false);
    assert.equal((await billing(users.trial)).status, 'canceled');
  });
  await check('Resubscribing after a cancellation (new subscription, same customer) grants again; the old subscription cannot undo it', async () => {
    const r = await deliver('invoice.paid', subscription({ id: 'sub_t2', customer: 'cus_trial', price: 'price_pro99', start: P0 + 3600, end: P1 + 3600 }));
    assert.equal(r.body.outcome, 'granted'); assert.equal((await ent(users.trial)).plan, 'PRO');
    const old = await deliver('customer.subscription.deleted', subscription({ id: 'sub_t', customer: 'cus_trial', status: 'canceled', start: P0, end: P1 }));
    assert.equal(old.body.outcome, 'stale_subscription'); assert.equal((await ent(users.trial)).status, 'ACTIVE');
  });
  await check('unpaid (retries exhausted) ends paid access like a cancellation', async () => {
    const r = await deliver('customer.subscription.updated', subscription({ id: 'sub_o', customer: 'cus_other', price: 'price_pro99', status: 'unpaid', start: P0, end: P1, invoice: 'open' }));
    assert.equal(r.body.outcome, 'access_ended'); assert.equal((await ent(users.other)).status, 'EXPIRED');
  });

  // ---------------------------------------------------------------- AB, manual plans, unknown customer
  await check('AB: a legacy manually-activated PAID account keeps 100 / 250 / 25 and is never touched by a foreign event', async () => {
    const u = await usage(users.legacy); assert.deepEqual([u.plan, u.discovery_limit, u.analysis_limit, u.ai_offer_limit], ['PAID', 100, 250, 25]);
    const before = await ent(users.legacy);
    const r = await deliver('invoice.paid', subscription({ id: 'sub_x', customer: 'cus_unlinked', price: 'price_pro99', start: P0, end: P1 }));
    assert.equal(r.body.outcome, 'unknown_customer'); assert.deepEqual(await ent(users.legacy), before);
  });
  await check('INTERNAL is never changed by Stripe', async () => {
    const r = await deliver('invoice.paid', subscription({ id: 'sub_i', customer: 'cus_internal', price: 'price_beta49', start: P0, end: P1 }));
    assert.equal(r.body.outcome, 'manual_plan_kept'); assert.equal((await ent(users.internal)).plan, 'INTERNAL');
  });
  await check('ENTERPRISE: operator-only activation with contract dates and custom limits; without limits nothing is consumable', async () => {
    const g = (await sql(`select public.grant_enterprise_access('ent@test',now()-interval '1 day',now()+interval '1 year',3,1000,10) r`)).rows[0].r;
    assert.equal(g.plan, 'ENTERPRISE');
    const u = await usage(users.ent); assert.deepEqual([u.plan, u.discovery_limit, u.analysis_limit, u.ai_offer_limit], ['ENTERPRISE', 3, 1000, 10]);
    await discover(ctx.ent); await discover(ctx.ent); await discover(ctx.ent);
    await refused(() => discover(ctx.ent), /plan_limit_reached/, 'beyond the contractual Discovery limit');
    await sql('delete from prospectos_private.enterprise_limits where user_id=$1', [users.ent]);
    await refused(() => analyze(ctx.ent), /plan_limit_reached/, 'ENTERPRISE without configured limits');
    await refused(() => sql(`select public.grant_enterprise_access('ent@test',now(),now()-interval '1 day',1,1,1)`), /Invalid contract dates/, 'contract ending before it starts');
  });

  // ---------------------------------------------------------------- AE: one customer per user
  await check('AE: two racing checkouts store ONE customer per user; a customer can never be linked to two users', async () => {
    const created = new Map();
    const stripe = {
      retrievePrice: async id => ({ id, active: true, currency: 'eur', unit_amount: PRICE[id], livemode: false, recurring: { interval: 'month', interval_count: 1 }, type: 'recurring' }),
      createCustomer: async (_p, key) => { if (!created.has(key)) created.set(key, { id: `cus_race${created.size}` }); return created.get(key); },
      createCheckoutSession: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
      createPortalSession: async () => ({ url: 'https://billing.stripe.com/p/1' }),
      retrieveSubscription: async () => { throw new Error('unused'); },
    };
    await sql('insert into auth.users(id,email) values ($1,$2)', [U(9), 'race@test']);
    const start = () => startCheckout({ userId: U(9), email: 'race@test', body: { plan: 'BETA' }, origin: 'https://preview.example.test' }, { config, stripe, store });
    const [a, b] = [await start(), await start()];
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal((await sql('select count(*)::int n from prospectos_private.billing_accounts where user_id=$1', [U(9)])).rows[0].n, 1);
    assert.equal(await store.linkCustomer(U(9), 'cus_otherrace'), 'cus_race0', 'the first stored customer wins');
    await refused(() => store.linkCustomer(users.ent, 'cus_race0'), /duplicate key|unique/, 'one customer for two users');
  });

  // ---------------------------------------------------------------- AF: deletion
  await check('AF: account deletion is refused while a subscription still bills; allowed once cancelled at period end; no dangling reference', async () => {
    await deliver('invoice.paid', subscription({ id: 'sub_g', customer: 'cus_gone', start: P0, end: P1 }));
    await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [ctx.gone.org, users.legacy]); // not the last owner: only the billing rule decides
    await refused(() => as(users.gone, 'select public.delete_own_account()'), /active_subscription_blocked/, 'deleting an account whose subscription keeps billing');
    assert.equal((await sql('select count(*)::int n from public.memberships where user_id=$1', [users.gone])).rows[0].n, 1, 'a refused deletion removes nothing');
    await deliver('customer.subscription.updated', subscription({ id: 'sub_g', customer: 'cus_gone', start: P0, end: P1, cancel: true }));
    assert.deepEqual((await as(users.gone, 'select public.delete_own_account() r')).rows[0].r, { memberships_removed: true });
    const orphans = await sql('select count(*)::int n from prospectos_private.billing_accounts b left join auth.users u on u.id=b.user_id where u.id is null');
    assert.equal(orphans.rows[0].n, 0, 'every billing row still points to an existing (anonymized) auth user');
    // The final Stripe event at period end still resolves cleanly.
    const end = await deliver('customer.subscription.deleted', subscription({ id: 'sub_g', customer: 'cus_gone', status: 'canceled', start: P0, end: P1, cancel: true }));
    assert.equal(end.body.outcome, 'access_ended');
  });

  // ---------------------------------------------------------------- invariants
  await check('Invalid states are refused by the database itself (plan, status, ids, period)', async () => {
    const q = (a) => asService('select public.apply_stripe_subscription_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', a);
    const ok = ['evt_bad1', 'invoice.paid', 'cus_pro', 'sub_p', 'price_pro99', 'PRO', 'active', iso(P0), iso(P1), false, true];
    for (const [i, v] of [[5, 'INTERNAL'], [5, 'ENTERPRISE'], [6, 'bogus'], [2, 'cus_'], [3, 'sub x'], [0, 'evt_bad;drop'], [8, iso(P0 - 10)]]) {
      const a = [...ok]; a[i] = v;
      await refused(() => q(a), /Invalid billing state/, `value ${v}`);
    }
  });
  await check('MIGRATION_IDEMPOTENT: re-applying 017 keeps every row and function', async () => {
    const before = [await ent(users.pro), await events()];
    await db.exec(await readFile(new URL('../db/migrations/017_stripe_billing.sql', import.meta.url), 'utf8'));
    assert.deepEqual([await ent(users.pro), await events()], before);
    assert.equal((await usage(users.pro)).discovery_limit, 300);
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
