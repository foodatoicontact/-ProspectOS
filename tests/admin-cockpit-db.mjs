// Migration 056 — cockpit administrateur, socle (owner decision, 26 nov. 2026), on real PostgreSQL (PGlite) with the full
// migration chain. Every source of the feed writes its event through the existing paths (an organization created, a Stripe
// state applied by apply_stripe_subscription_state, a trial whose end has passed, a form stored by the server, a partner
// application and creation, a payable statement, a failed collection job); a replay never makes a second row; the feed is
// append-only for every role; only the administrator reads it — the RLS test: a client account and an anonymous visitor
// read nothing, call nothing, write nothing; the push queue is claimed, retried and closed by the server only.
// WITHOUT_056=1 runs the checks without the migration: they must fail.
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
async function asService(text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', '', false)");
  await sql('set role service_role');
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).replace(/\n/g, ' ').slice(0, 400)]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
}
const SIRET_A = '99900000100019';
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const count = async (where = 'true', params = []) => Number((await sql(`select count(*) n from public.admin_events where ${where}`, params)).rows[0].n);

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  // Before the chain: an organization and a trial already over, to check the backfill of the migration.
  const OLD = uid(0x01);
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_056 && f.startsWith('056_')));
  assert.ok(process.env.WITHOUT_056 || migrations.includes('056_admin_cockpit.sql'), 'migration 056 present');
  for (const f of migrations) {
    if (f.startsWith('056_')) {
      await sql(`insert into auth.users(id,email) values($1,'ancien@exemple.test')`, [OLD]);
      await as(OLD, `select public.create_organization('Ancien client')`);
      await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'BETA','ACTIVE',now()-interval '9 days',now()-interval '2 days',now())`, [OLD]);
    }
    await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  }
  await sql('grant usage on schema prospectos_private to service_role');

  const K = uid(0xad), C = uid(0xc1), D = uid(0xd1), PA = uid(0xa1);
  const user = (id, email) => sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`, [id, email]);
  await user(K, 'admin@prospectos.test'); await user(C, 'client@exemple.test'); await user(D, 'autre@exemple.test'); await user(PA, 'agence@partenaire-a.test');
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);

  await check('BACKFILL: the organizations and the trials already over are in the feed, none of them queued for push', async () => {
    assert.equal(await count(`kind='SIGNUP'`), 1);
    assert.equal(await count(`kind='TRIAL_ENDED' and user_id=$1`, [OLD]), 1);
    assert.equal(Number((await sql('select count(*) n from prospectos_private.admin_push_queue')).rows[0].n), 0);
  });

  let orgC;
  await check('SIGNUP: an organization created by a new account is in the feed, with a reference to it and no copy of its name', async () => {
    orgC = (await as(C, `select public.create_organization('Agence Client') id`)).rows[0].id;
    const e = (await sql(`select * from public.admin_events where kind='SIGNUP' and organization_id=$1`, [orgC])).rows[0];
    assert.equal(e.source_table, 'organizations'); assert.equal(e.source_id, orgC); assert.equal(e.user_id, C);
    assert.deepEqual(e.detail, {});
    await as(D, `select public.create_organization('Autre')`);
  });

  const apply = (evt, type, status, plan, paid, cancelAtEnd = false) => asService(
    `select public.apply_stripe_subscription_state($1,$2,'cus_C1','sub_C1',$3,$4,$5,now()-interval '1 day',now()+interval '29 days',$6,$7,null) r`,
    [evt, type, plan ? 'price_X' : null, plan, status, cancelAtEnd, paid]);
  await check('STRIPE: invoice.paid, plan change, payment failure and cancellation each make one event, a replayed event none', async () => {
    await sql(`insert into prospectos_private.billing_accounts(user_id,stripe_customer_id) values($1,'cus_C1')`, [C]);
    await apply('evt_1', 'invoice.paid', 'active', 'PAID', true);
    assert.equal(await count(`kind='INVOICE_PAID' and organization_id=$1`, [orgC]), 1);
    assert.equal(await count(`kind='PLAN_CHANGED' and detail->>'to'='PAID' and detail->>'from' is null`), 1, 'the first subscription');
    await apply('evt_1', 'invoice.paid', 'active', 'PAID', true);
    assert.equal(await count(`kind='INVOICE_PAID'`), 1, 'a replayed Stripe event adds nothing');
    await apply('evt_2', 'customer.subscription.updated', 'active', 'PRO', true);
    assert.equal(await count(`kind='PLAN_CHANGED' and detail->>'from'='PAID' and detail->>'to'='PRO'`), 1);
    await apply('evt_3', 'invoice.payment_failed', 'past_due', 'PRO', false);
    const f = (await sql(`select * from public.admin_events where kind='PAYMENT_FAILED'`)).rows[0];
    assert.equal(f.source_table, 'stripe_webhook_events'); assert.equal(f.source_id, 'evt_3'); assert.equal(f.detail.status, 'past_due');
    await apply('evt_4', 'customer.subscription.updated', 'active', 'PRO', true, true);
    assert.equal(await count(`kind='CANCELLATION' and (detail->>'at_period_end')::boolean`), 1, 'set to end at the period end');
    await apply('evt_5', 'customer.subscription.deleted', 'canceled', 'PRO', false, true);
    assert.equal(await count(`kind='CANCELLATION'`), 2, 'and then ended');
    assert.equal(await count(`kind in ('INVOICE_PAID','PAYMENT_FAILED','PLAN_CHANGED','CANCELLATION') and organization_id is distinct from $1`, [orgC]), 0);
    const queued = (await sql(`select e.kind from prospectos_private.admin_push_queue q join public.admin_events e on e.id=q.event_id order by e.id`)).rows.map(r => r.kind);
    assert.deepEqual(queued, ['PAYMENT_FAILED', 'CANCELLATION', 'CANCELLATION'], 'only the kinds the owner asked for are pushed');
  });

  await check('TRIAL_ENDED: the daily sweep records a trial once its end date has passed, once', async () => {
    await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'BETA','ACTIVE',now()-interval '8 days',now()-interval '1 hour',now())`, [D]);
    assert.equal((await asService('select public.sweep_admin_events() r')).rows[0].r.trials_ended, 1);
    assert.equal((await asService('select public.sweep_admin_events() r')).rows[0].r.trials_ended, 0, 'idempotent');
    await refused(() => as(K, 'select public.sweep_admin_events()'), /permission denied/i, 'a sweep from a browser');
  });

  let watchId;
  await check('FORMS: stored by the server only (kind, consent time), each one in the feed; a watch request is queued for push', async () => {
    watchId = (await asService(`select public.submit_contact_request('WATCH','Expertise comptable','Reprises','31','Contact@Cabinet.test','Cabinet X','') r`)).rows[0].r.id;
    await asService(`select public.submit_contact_request('PROSPECTS','Sites web','Restaurants','69','a@b.test','','')`);
    const c = (await sql('select email,consent_at from public.contact_requests where id=$1', [watchId])).rows[0];
    assert.equal(c.email, 'contact@cabinet.test'); assert.ok(c.consent_at);
    assert.equal(await count(`kind='WATCH_REQUEST' and source_table='contact_requests' and source_id=$1`, [watchId]), 1);
    assert.equal(await count(`kind='PROSPECT_REQUEST'`), 1);
    assert.equal(Number((await sql(`select count(*) n from prospectos_private.admin_push_queue q join public.admin_events e on e.id=q.event_id where e.kind='WATCH_REQUEST'`)).rows[0].n), 1);
    assert.equal(Number((await sql(`select count(*) n from prospectos_private.admin_push_queue q join public.admin_events e on e.id=q.event_id where e.kind='PROSPECT_REQUEST'`)).rows[0].n), 0);
    await refused(() => asService(`select public.submit_contact_request('OTHER','x y z','','31','a@b.test','','')`), /contact_kind_invalid/, 'an unknown kind');
    await refused(() => asService(`select public.submit_contact_request('WATCH','xyz','','ZZ','a@b.test','','')`), /check constraint|violates/i, 'a malformed department');
    await refused(() => as(undefined, `select public.submit_contact_request('WATCH','xyz','','31','a@b.test','','')`), /permission denied/i, 'a form stored by an anonymous browser');
    await refused(() => as(C, `insert into public.contact_requests(kind,activity,department,email,consent_at) values('WATCH','xyz','31','a@b.test',now())`), /permission denied/i, 'a direct insert');
  });

  await check('PARTNERS: an application, a partner created and a payable statement are in the feed; the commission is queued for push', async () => {
    await asService(`select public.submit_partner_application('Alice Martin','Agence Exemple',$1,'agence@partenaire-a.test','Je recommande des outils à mes clients.')`, [SIRET_A]);
    assert.equal(await count(`kind='PARTNER_APPLIED' and source_table='partner_applications'`), 1);
    const A = (await as(K, `select public.create_partner('Alice Martin','Agence Exemple',$1,'agence@partenaire-a.test','AGENCEA',30) r`, [SIRET_A])).rows[0].r.id;
    assert.equal(await count(`kind='PARTNER_CREATED'`), 1);
    await sql(`insert into public.partner_statements(partner_id,month,referred_count,paying_clients,payments_count,month_commissions_cents,balance_cents,threshold_cents,payable) values($1,'2026-10-01',1,1,1,6000,6000,5000,true),($1,'2026-09-01',1,1,1,1000,1000,5000,false)`, [A]);
    assert.equal(await count(`kind='COMMISSION_DUE'`), 1, 'payable statements only');
  });

  await check('COLLECTION: a failed job is recorded once per job and day; codes only', async () => {
    assert.equal((await asService(`select public.record_collect_failure('collect','COLLECT_FAILED') r`)).rows[0].r.recorded, true);
    assert.equal((await asService(`select public.record_collect_failure('collect','COLLECT_FAILED') r`)).rows[0].r.recorded, false);
    assert.equal((await asService(`select public.record_collect_failure('enrich-1','ENRICH_FAILED') r`)).rows[0].r.recorded, true);
    await refused(() => asService(`select public.record_collect_failure('collect','une phrase libre')`), /collect_failure_invalid/, 'free text in the feed');
    await refused(() => as(K, `select public.record_collect_failure('collect','X_Y')`), /permission denied/i, 'a failure recorded from a browser');
  });

  await check('APPEND-ONLY: no role, the owner included, updates, deletes or truncates the feed', async () => {
    await refused(() => sql(`update public.admin_events set kind='SIGNUP'`), /append-only/, 'the owner updating the feed');
    await refused(() => sql(`delete from public.admin_events`), /append-only/, 'the owner deleting the feed');
    await refused(() => sql(`truncate public.admin_events`), /append-only|foreign key/, 'the owner truncating the feed');
    await refused(() => asService(`delete from public.admin_events`), /append-only|permission denied/i, 'the server deleting the feed');
  });

  await check('RLS: a client account and an anonymous visitor read nothing, call nothing, write nothing of the cockpit', async () => {
    assert.equal((await as(C, 'select count(*)::int n from public.admin_events')).rows[0].n, 0, 'a client reads no event, not even its own');
    assert.equal((await as(C, 'select count(*)::int n from public.contact_requests')).rows[0].n, 0, 'a client reads no request');
    await refused(() => as(undefined, 'select count(*) from public.admin_events'), /permission denied/i, 'anon reading the feed');
    await refused(() => as(undefined, 'select count(*) from public.contact_requests'), /permission denied/i, 'anon reading the requests');
    await refused(() => as(C, `select public.admin_feed(null,null,null,null,50)`), /Admin access required/, 'a client calling the feed');
    await refused(() => as(undefined, `select public.admin_feed(null,null,null,null,50)`), /permission denied/i, 'anon calling the feed');
    await refused(() => as(C, `insert into public.admin_events(kind,occurred_at,source_table,source_id,dedupe_key) values('SIGNUP',now(),'cron','x','xyz')`), /permission denied/i, 'a client writing an event');
    await refused(() => as(C, 'select count(*) from prospectos_private.admin_push_queue'), /permission denied/i, 'a client reading the push queue');
    await refused(() => as(C, 'select public.claim_admin_push(10)'), /permission denied/i, 'a client claiming pushes');
    await refused(() => as(K, 'select public.claim_admin_push(10)'), /permission denied/i, 'even the administrator: the queue is the server’s');
    await refused(() => as(C, 'select prospectos_private.admin_emit($1,now(),null,null,$2,$3,$4,$5,true)', ['SIGNUP', 'cron', 'x', '{}', 'k-forged']), /permission denied/i, 'a client calling the writer');
    // The administrator, and only them.
    assert.ok((await as(K, 'select count(*)::int n from public.admin_events')).rows[0].n > 10);
    assert.equal((await as(K, 'select count(*)::int n from public.contact_requests')).rows[0].n, 2);
  });

  await check('FEED: filtered by kinds and Paris dates, newest first, by pages; each row resolved from its source', async () => {
    const all = (await as(K, `select public.admin_feed(null,null,null,null,200) r`)).rows[0].r;
    assert.equal(all.has_more, false);
    const ids = all.events.map(e => e.id); assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    const w = all.events.find(e => e.kind === 'WATCH_REQUEST');
    assert.equal(w.source.activity, 'Expertise comptable'); assert.equal(w.source.department, '31'); assert.equal(w.source.company, 'Cabinet X');
    assert.equal(w.source.email, undefined, 'the e-mail is not in the feed');
    const pay = all.events.find(e => e.kind === 'INVOICE_PAID'); assert.equal(pay.organization, 'Agence Client');
    const due = all.events.find(e => e.kind === 'COMMISSION_DUE'); assert.equal(due.source.company, 'Agence Exemple'); assert.equal(Number(due.source.balance_cents), 6000);
    const only = (await as(K, `select public.admin_feed(array['CANCELLATION','PAYMENT_FAILED'],null,null,null,50) r`)).rows[0].r.events;
    assert.deepEqual([...new Set(only.map(e => e.kind))].sort(), ['CANCELLATION', 'PAYMENT_FAILED']);
    const page1 = (await as(K, `select public.admin_feed(null,null,null,null,3) r`)).rows[0].r;
    assert.equal(page1.events.length, 3); assert.equal(page1.has_more, true);
    const page2 = (await as(K, `select public.admin_feed(null,null,null,$1,3) r`, [page1.events[2].id])).rows[0].r;
    assert.ok(page2.events.every(e => e.id < page1.events[2].id));
    const past = (await as(K, `select public.admin_feed(null,'2020-01-01','2020-12-31',null,50) r`)).rows[0].r.events;
    assert.equal(past.length, 0);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    assert.ok((await as(K, `select public.admin_feed(null,$1,$1,null,200) r`, [today])).rows[0].r.events.length > 5);
  });

  await check('PUSH: claimed by the server, sent or retried up to 5 attempts, then FAILED; a claim is held 5 minutes', async () => {
    const first = (await asService('select public.claim_admin_push(2) r')).rows[0].r;
    assert.equal(first.length, 2); assert.deepEqual(Object.keys(first[0]).sort(), ['id', 'kind', 'occurred_at'], 'no source, no name, no detail');
    assert.equal((await asService('select public.claim_admin_push(50) r')).rows[0].r.length, 3, 'the claimed ones are held');
    await asService('select public.finish_admin_push($1,true)', [first[0].id]);
    await asService('select public.finish_admin_push($1,false)', [first[1].id]);
    assert.equal((await sql('select state from prospectos_private.admin_push_queue where event_id=$1', [first[0].id])).rows[0].state, 'SENT');
    const again = (await asService('select public.claim_admin_push(50) r')).rows[0].r.map(r => r.id);
    assert.ok(again.includes(first[1].id), 'a failed one is claimed again');
    for (let i = 0; i < 4; i++) { await asService('select public.finish_admin_push($1,false)', [first[1].id]); await sql('update prospectos_private.admin_push_queue set claimed_at=null where event_id=$1 and state=$2', [first[1].id, 'PENDING']); await asService('select public.claim_admin_push(50)'); }
    await asService('select public.finish_admin_push($1,false)', [first[1].id]);
    const q = (await sql('select state,attempts from prospectos_private.admin_push_queue where event_id=$1', [first[1].id])).rows[0];
    assert.equal(q.state, 'FAILED'); assert.equal(q.attempts, 5);
  });

  await check('RETENTION: a request is deleted 12 months after it was sent; its event stays, its source reads as gone', async () => {
    await sql(`update public.contact_requests set created_at=now()-interval '13 months' where id=$1`, [watchId]);
    const r = (await asService('select public.run_retention() r')).rows[0].r;
    assert.equal(r.contact_requests, 1); assert.ok('partner_applications' in r && 'signals' in r, 'the other purges still run');
    const w = (await as(K, `select public.admin_feed(array['WATCH_REQUEST'],null,null,null,50) r`)).rows[0].r.events[0];
    assert.equal(w.source, null);
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
