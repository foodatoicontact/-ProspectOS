// Migration 052 — programme partenaires, on real PostgreSQL (PGlite) with the full migration chain: the administrator alone
// creates partners; the code given at sign-up (by a ?ref= link or typed) attributes the account's FIRST organization once,
// an unknown code is ignored, a suspended partner / self-referral / existing organization is refused; referred_by is locked
// except for the journaled administrator change; invoice.paid makes one line per invoice (30 % of the amount HT paid), never
// two on a replay, nothing after 12 months; a refund makes a negative line; the ledger refuses UPDATE/DELETE/TRUNCATE;
// the monthly statement carries the balance (payable from 50 €), paid once by the administrator; a partner sees only their
// own figures, with anonymous client references. Fictitious data only. WITHOUT_052=1 runs the checks without the migration:
// they must fail.
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
// Valid SIRETs (Luhn key), fictitious companies.
const SIRET_A = '99900000100019', SIRET_B = '99900000200017';
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_052 && f.startsWith('052_')));
  assert.ok(process.env.WITHOUT_052 || migrations.includes('052_partner_program.sql'), 'migration 052 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  await sql('grant usage on schema prospectos_private to service_role');

  const K = uid(0xad);                       // the administrator (INTERNAL)
  const PA = uid(0xa1), PB = uid(0xb1);     // partner A and partner B, each with an account
  const C1 = uid(0xc1), C2 = uid(0xc2), C3 = uid(0xc3), C4 = uid(0xc4), C5 = uid(0xc5), C6 = uid(0xc6), C8 = uid(0xc8);
  const user = (id, email, code) => sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)`,
    [id, email, JSON.stringify(code === undefined ? {} : { partner_code: code, terms_version: 'x' })]);
  await user(K, 'admin@prospectos.test'); await user(PA, 'agence@partenaire-a.test'); await user(PB, 'conseil@partenaire-b.test');
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  const org = async u => (await as(u, `select public.create_organization('Org') id`)).rows[0].id;
  const referral = async o => (await sql('select referred_by,referred_at from public.organizations where id=$1', [o])).rows[0];
  const create = (u, code, siret = SIRET_A, email = 'agence@partenaire-a.test') =>
    as(u, `select public.create_partner('Alice Martin','Agence Exemple',$1,$2,$3,30) r`, [siret, email, code]);

  let A, B;
  await check('PARTNERS: created by the administrator only; SIRET (Luhn) and code (A–Z 0–9, 3–20) checked; code unique', async () => {
    await refused(() => create(C1, 'AGENCEA'), /Admin access required/, 'a non-administrator creating a partner');
    await refused(() => create(undefined, 'AGENCEA'), /permission denied/i, 'anon creating a partner');
    await refused(() => create(K, 'AGENCEA', '99900000100010'), /partner_siret_invalid/, 'a SIRET with a wrong key');
    await refused(() => create(K, 'AB'), /partner_code_invalid/, 'a 2-character code');
    await refused(() => create(K, 'AGENCE-A'), /partner_code_invalid/, 'a code with a dash');
    A = (await create(K, 'agencea')).rows[0].r.id;
    assert.equal((await sql('select code,rate_percent::text r,status from public.partners where id=$1', [A])).rows[0].code, 'AGENCEA', 'stored upper-case');
    assert.equal((await sql('select rate_percent::float r from public.partners where id=$1', [A])).rows[0].r, 30);
    await refused(() => create(K, 'AGENCEA', SIRET_B, 'autre@x.test'), /partner_code_taken/, 'a duplicate code');
    B = (await as(K, `select public.create_partner('Bruno Petit','Conseil Exemple',$1,'conseil@partenaire-b.test','CONSEILB',30) r`, [SIRET_B])).rows[0].r.id;
    await refused(() => as(K, `insert into public.partners(name,company,siret,email,code,created_by) values('x','xx',$1,'y@z.test','DIRECT',$2)`, [SIRET_A, K]), /permission denied/i, 'a direct insert');
  });

  let o1, o2;
  await check('ATTRIBUTION: by link or typed (both stored as the sign-up code): the first organization is attributed once, case-insensitive', async () => {
    await user(C1, 'client1@exemple.test', 'AGENCEA');        // the code pre-filled from ?ref=AGENCEA
    await user(C2, 'client2@exemple.test', ' conseilb ');     // the code typed by hand, with spaces and in lower case
    o1 = await org(C1); o2 = await org(C2);
    const r1 = await referral(o1), r2 = await referral(o2);
    assert.equal(r1.referred_by, A); assert.ok(r1.referred_at);
    assert.equal(r2.referred_by, B);
    assert.equal(Number((await sql(`select count(*) n from public.partner_journal where kind='ATTRIBUTED'`)).rows[0].n), 2);
  });
  await check('ATTRIBUTION: an unknown code is ignored without blocking the sign-up; no code, nothing', async () => {
    await user(C3, 'client3@exemple.test', 'INCONNU99'); await user(C8, 'client8@exemple.test');
    const o3 = await org(C3), o8 = await org(C8);
    assert.equal((await referral(o3)).referred_by, null); assert.equal((await referral(o8)).referred_by, null);
  });
  await check('ATTRIBUTION refused (journaled): self-referral by e-mail or account, suspended partner, an account that already had an organization', async () => {
    await user(C4, 'Agence@Partenaire-A.test', 'AGENCEA');     // the partner's own e-mail, another case
    assert.equal((await referral(await org(C4))).referred_by, null);
    assert.equal((await referral(await org(PB))).referred_by, null, 'nothing without a code');
    await sql(`update auth.users set raw_user_meta_data='{"partner_code":"CONSEILB"}' where id=$1`, [PB]);
    assert.equal((await referral(await org(PB))).referred_by, null, 'the partner’s own account, second organization');
    await as(K, `select public.set_partner_status($1,'SUSPENDED')`, [B]);
    await user(C5, 'client5@exemple.test', 'CONSEILB');
    assert.equal((await referral(await org(C5))).referred_by, null, 'suspended');
    await as(K, `select public.set_partner_status($1,'ACTIVE')`, [B]);
    await user(C6, 'client6@exemple.test');
    await org(C6);
    await sql(`update auth.users set raw_user_meta_data='{"partner_code":"AGENCEA"}' where id=$1`, [C6]);
    assert.equal((await referral(await org(C6))).referred_by, null, 'an account that already had an organization');
    const reasons = (await sql(`select detail->>'reason' r from public.partner_journal where kind='ATTRIBUTION_REFUSED' order by id`)).rows.map(r => r.r);
    assert.deepEqual(reasons, ['self_referral', 'self_referral', 'partner_suspended', 'existing_organization']);
  });
  await check('LOCK: referred_by / referred_at never change, even for the table owner — except the administrator’s journaled change', async () => {
    await refused(() => sql('update public.organizations set referred_by=null,referred_at=null where id=$1', [o1]), /organization_referral_locked/, 'the owner role clearing a referral');
    await refused(() => as(C1, 'update public.organizations set referred_by=null where id=$1', [o1]), /permission denied/i, 'the client clearing its referral');
    await refused(() => as(C1, `select public.set_organization_referral($1,null,'je préfère')`, [o1]), /Admin access required/, 'the client calling the admin change');
    await refused(() => as(K, `select public.set_organization_referral($1,$2,'')`, [o2, A]), /partner_reason_required/, 'a change without a reason');
    await as(K, `select public.set_organization_referral($1,$2,'Erreur de code à l''inscription, mail du 20/11')`, [o2, A]);
    assert.equal((await referral(o2)).referred_by, A);
    const j = (await sql(`select detail from public.partner_journal where kind='REFERRAL_CHANGED'`)).rows[0].detail;
    assert.equal(j.from, B); assert.equal(j.to, A); assert.match(j.reason, /Erreur de code/);
    await as(K, `select public.set_organization_referral($1,$2,'Retour à l''attribution d''origine')`, [o2, B]);
  });

  // The clients signed up in the past (the fixtures below are dated): set as the database itself would have at that time.
  await sql(`select set_config('prospectos.partner_referral_change','on',false)`);
  await sql('update public.organizations set referred_at=$2 where id=$1', [o1, '2026-08-01T00:00:00Z']);
  await sql('update public.organizations set referred_at=$2 where id=$1', [o2, '2025-09-01T00:00:00Z']);
  await sql(`select set_config('prospectos.partner_referral_change','',false)`);
  // Billing link (migration 017): one Stripe customer per user.
  await sql(`insert into prospectos_private.billing_accounts(user_id,stripe_customer_id) values($1,'cus_C1'),($2,'cus_C2'),($3,'cus_C3')`, [C1, C2, C3]);
  const invoice = (evt, inv, cus, paidAt, paid, ht) => asService(`select public.record_partner_invoice($1,$2,$3,$4,$5,$6,'eur') r`, [evt, inv, cus, paidAt, paid, ht]);
  const outcome = async p => (await p).rows[0].r.outcome;
  await check('COMMISSION: invoice.paid → one line = amount HT paid × 30 %, with the Stripe invoice reference', async () => {
    const r = (await invoice('evt_1', 'in_1', 'cus_C1', '2026-09-03T10:00:00Z', 9900, 9900)).rows[0].r;
    assert.deepEqual([r.outcome, r.amount_cents], ['recorded', 2970]);
    const row = (await sql(`select partner_id,stripe_invoice_id,amount_cents::int a,paid_amount_ht_cents::int ht from public.partner_commissions where stripe_invoice_id='in_1'`)).rows[0];
    assert.deepEqual([row.partner_id, row.stripe_invoice_id, row.a, row.ht], [A, 'in_1', 2970, 9900]);
    assert.equal((await invoice('evt_2', 'in_2', 'cus_C1', '2026-10-03T10:00:00Z', 11880, 9900)).rows[0].r.amount_cents, 2970, 'tax excluded: 30 % of 99,00 € HT');
    assert.equal(await outcome(invoice('evt_3', 'in_3', 'cus_C3', '2026-10-03T10:00:00Z', 9900, 9900)), 'not_referred');
    assert.equal(await outcome(invoice('evt_4', 'in_4', 'cus_UNKNOWN', '2026-10-03T10:00:00Z', 9900, 9900)), 'unknown_customer');
    assert.equal(await outcome(invoice('evt_0', 'in_0', 'cus_C1', '2026-07-15T10:00:00Z', 9900, 9900)), 'before_referral', 'paid before the attribution: no line');
  });
  await check('IDEMPOTENT: a replayed webhook (same event, or another event for the same invoice) never creates a second line', async () => {
    assert.equal(await outcome(invoice('evt_1', 'in_1', 'cus_C1', '2026-09-03T10:00:00Z', 9900, 9900)), 'duplicate');
    assert.equal(await outcome(invoice('evt_1bis', 'in_1', 'cus_C1', '2026-09-03T10:00:00Z', 9900, 9900)), 'duplicate');
    assert.equal(Number((await sql(`select count(*) n from public.partner_commissions where stripe_invoice_id='in_1'`)).rows[0].n), 1);
  });
  await check('12 MONTHS: nothing once 12 months have passed since the client’s first payment', async () => {
    assert.equal(await outcome(invoice('evt_5', 'in_5', 'cus_C2', '2025-09-10T09:00:00Z', 9900, 9900)), 'recorded', 'the first payment');
    assert.equal((await sql(`select first_paid_at from public.partner_first_payments where organization_id=$1`, [o2])).rows[0].first_paid_at.toISOString(), '2025-09-10T09:00:00.000Z');
    assert.equal(await outcome(invoice('evt_6', 'in_6', 'cus_C2', '2026-09-10T08:59:59Z', 9900, 9900)), 'recorded', 'last second of month 12');
    assert.equal(await outcome(invoice('evt_7', 'in_7', 'cus_C2', '2026-09-10T09:00:00Z', 9900, 9900)), 'outside_window');
    assert.equal(await outcome(invoice('evt_8', 'in_8', 'cus_C2', '2026-10-10T09:00:00Z', 9900, 9900)), 'outside_window');
  });
  await check('REFUND: charge.refunded → a negative line of the same amount; replayed → nothing more; partial refunds add up', async () => {
    const refund = (evt, ch, inv, total) => asService(`select public.record_partner_refund($1,$2,$3,$4) r`, [evt, ch, inv, total]);
    const r = (await refund('evt_r1', 'ch_2', 'in_2', 11880)).rows[0].r;
    assert.deepEqual([r.outcome, r.amount_cents], ['recorded', -2970]);
    assert.equal((await refund('evt_r1', 'ch_2', 'in_2', 11880)).rows[0].r.outcome, 'duplicate');
    assert.equal((await refund('evt_r2', 'ch_2', 'in_2', 11880)).rows[0].r.outcome, 'duplicate', 'another event, same cumulative amount');
    assert.equal((await refund('evt_r3', 'ch_6', 'in_6', 4950)).rows[0].r.amount_cents, -1485, 'half refunded');
    assert.equal((await refund('evt_r4', 'ch_6', 'in_6', 9900)).rows[0].r.amount_cents, -1485, 'the rest');
    assert.equal((await refund('evt_r5', 'ch_3', 'in_3', 9900)).rows[0].r.outcome, 'no_commission');
    assert.equal(Number((await sql(`select sum(amount_cents) s from public.partner_commissions where stripe_invoice_id in ('in_2','in_6')`)).rows[0].s), 0);
  });
  await check('SERVER ONLY: no browser session may record a commission, a refund or a statement', async () => {
    await refused(() => as(C1, `select public.record_partner_invoice('evt_x','in_x','cus_C1',now(),100,100,'eur')`), /permission denied/i, 'a client recording a commission');
    await refused(() => as(K, `select public.record_partner_refund('evt_y','ch_1','in_1',9900)`), /permission denied/i, 'the administrator recording a refund');
    await refused(() => as(K, `select public.generate_partner_statements('2026-09-01')`), /permission denied/i, 'a statement from a browser');
  });
  await check('APPEND-ONLY: the ledger, the journal and the statements refuse UPDATE, DELETE and TRUNCATE, the owner included; no direct insert', async () => {
    await refused(() => sql(`update public.partner_commissions set amount_cents=99999 where stripe_invoice_id='in_1'`), /append-only/, 'an UPDATE of a commission');
    await refused(() => sql(`delete from public.partner_commissions where stripe_invoice_id='in_2'`), /append-only/, 'a DELETE of a commission');
    await refused(() => sql(`truncate public.partner_commissions`), /append-only/, 'a TRUNCATE of the ledger');
    await refused(() => sql(`delete from public.partner_journal`), /append-only/, 'a DELETE of the journal');
    await refused(() => as(K, `insert into public.partner_commissions(partner_id,organization_id,kind,stripe_invoice_id,stripe_event_id,paid_amount_cents,paid_amount_ht_cents,rate_percent,amount_cents,occurred_at) values($1,$2,'COMMISSION','in_z','evt_z',1,1,30,1,now())`, [A, o1]), /permission denied/i, 'a direct insert by the administrator');
  });

  let sept, oct;
  await check('STATEMENT: on the 1st, per partner — clients brought, payments, month’s commissions, cumulative balance; below 50 € carried over', async () => {
    const g = (await asService(`select public.generate_partner_statements('2026-09-01') r`)).rows[0].r;
    assert.equal(g.generated, 2);
    sept = (await sql(`select * from public.partner_statements where partner_id=$1 and month='2026-09-01'`, [A])).rows[0];
    assert.deepEqual([sept.referred_count, sept.paying_clients, sept.payments_count, Number(sept.month_commissions_cents), Number(sept.balance_cents), sept.payable], [1, 1, 1, 2970, 2970, false]);
    const sb = (await sql(`select * from public.partner_statements where partner_id=$1 and month='2026-09-01'`, [B])).rows[0];
    assert.deepEqual([sb.payments_count, Number(sb.month_commissions_cents), Number(sb.balance_cents), sb.payable], [1, 2970, 5940, true], 'B: Sept. 2025 + Sept. 2026, from 50 € payable');
    assert.equal((await asService(`select public.generate_partner_statements('2026-09-01') r`)).rows[0].r.generated, 0, 'idempotent');
    await refused(() => asService(`select public.generate_partner_statements(date_trunc('month',now())::date)`), /partner_month_invalid/, 'a statement of the current month');
    await asService(`select public.generate_partner_statements('2026-10-01')`);
    oct = (await sql(`select * from public.partner_statements where partner_id=$1 and month='2026-10-01'`, [A])).rows[0];
    assert.deepEqual([Number(oct.month_commissions_cents), Number(oct.balance_cents), oct.payable], [2970, 5940, true], 'the refund (made in November) counts in November');
  });
  await check('PAYOUT: the administrator marks the latest payable statement paid (date, transfer reference) — once; nothing below 50 €', async () => {
    await refused(() => as(K, `select public.mark_partner_statement_paid($1,'2026-11-05','VIR-001')`, [sept.id]), /partner_statement_below_threshold/, 'paying below 50 €');
    // Partner B: 29,70 € (Sept. 2025) + 29,70 € (Sept. 2026) = 59,40 €, payable; its October statement carries it.
    const ob = (await sql(`select * from public.partner_statements where partner_id=$1 and month='2026-10-01'`, [B])).rows[0];
    assert.equal(ob.payable, Number(ob.balance_cents) >= 5000);
    assert.ok(ob.payable, `balance ${ob.balance_cents}`);
    const sb = (await sql(`select id from public.partner_statements where partner_id=$1 and month='2026-09-01'`, [B])).rows[0];
    await refused(() => as(K, `select public.mark_partner_statement_paid($1,'2026-11-05','VIR-000')`, [sb.id]), /partner_statement_below_threshold|partner_statement_superseded/, 'an older statement');
    await refused(() => as(PB, `select public.mark_partner_statement_paid($1,'2026-11-05','VIR-002')`, [ob.id]), /Admin access required/, 'the partner marking it paid');
    await refused(() => as(K, `select public.mark_partner_statement_paid($1,'2026-10-15','VIR-002')`, [ob.id]), /partner_paid_on_invalid/, 'a payment date before the month ended');
    const paid = (await as(K, `select public.mark_partner_statement_paid($1,'2026-11-05','VIR-002') r`, [ob.id])).rows[0].r;
    assert.equal(paid.amount_cents, Number(ob.balance_cents));
    await refused(() => as(K, `select public.mark_partner_statement_paid($1,'2026-11-06','VIR-003')`, [ob.id]), /partner_statement_already_paid/, 'paying twice');
    const space = (await as(PB, 'select public.partner_space() s')).rows[0].s;
    assert.equal(space.balance_cents, -2970, 'after the payout: the refunds made in November, carried to the next statement');
  });
  await check('VISIBILITY: a partner sees only their own figures, clients as anonymous references; nobody else sees a partner’s data', async () => {
    const a = (await as(PA, 'select public.partner_space() s')).rows[0].s;
    assert.equal(a.partner.code, 'AGENCEA'); assert.equal(a.signups, 1); assert.equal(a.paying_clients, 1);
    assert.ok(a.lines.length >= 3 && a.lines.every(l => /^C-[0-9A-F]{6}$/.test(l.client)), 'anonymous references');
    const text = JSON.stringify(a);
    for (const leak of [o1, o2, C1, 'client1@exemple.test', 'Org', 'conseil'])assert.ok(!text.includes(leak), `no ${leak} in the partner space`);
    assert.ok(!JSON.stringify((await as(PB, 'select public.partner_space() s')).rows[0].s).includes('AGENCEA'), 'B never sees A');
    assert.equal((await as(PA, 'select count(*)::int n from public.partner_statements')).rows[0].n, 2, 'A reads its 2 statements only');
    assert.equal((await as(PA, 'select count(*)::int n from public.partners')).rows[0].n, 1, 'A reads its own partner row only');
    assert.equal((await as(PA, 'select count(*)::int n from public.partner_commissions')).rows[0].n, 0, 'the raw ledger: administrator only');
    assert.equal((await as(PA, 'select count(*)::int n from public.partner_payouts')).rows[0].n, 0, 'B’s payout is not A’s');
    assert.equal((await as(C1, 'select count(*)::int n from public.partner_statements')).rows[0].n, 0, 'a client sees no statement');
    await refused(() => as(C1, 'select public.partner_space()'), /partner_not_found/, 'a client opening a partner space');
    await refused(() => as(undefined, 'select public.partner_space()'), /permission denied/i, 'anon');
    const n = (await as(K, 'select count(*)::int n from public.partner_commissions')).rows[0].n;
    assert.equal(n, (await sql('select count(*)::int n from public.partner_commissions')).rows[0].n, 'the administrator reads the whole ledger');
    assert.equal(n, 7, '4 commissions (in_1, in_2, in_5, in_6) and 3 refunds');
  });
  await check('PARTNER ACCOUNT: an unconfirmed e-mail opens nothing; a confirmed one is bound to the partner once', async () => {
    const PC = uid(0xd1);
    await as(K, `select public.create_partner('Chloé Durand','Cabinet Exemple',$1,'cabinet@partenaire-c.test','CABINETC',25)`, [SIRET_A]);
    await sql(`insert into auth.users(id,email) values($1,'cabinet@partenaire-c.test')`, [PC]);
    await refused(() => as(PC, 'select public.partner_space()'), /partner_not_found/, 'an unconfirmed e-mail');
    await sql('update auth.users set email_confirmed_at=now() where id=$1', [PC]);
    assert.equal((await as(PC, 'select public.partner_space() s')).rows[0].s.partner.code, 'CABINETC');
    assert.equal((await sql(`select user_id from public.partners where code='CABINETC'`)).rows[0].user_id, PC);
  });
  await check('APPLICATIONS: the public form is stored through the server; only the administrator reads it', async () => {
    await refused(() => as(undefined, `select public.submit_partner_application('Jean','Jean Conseil',$1,'jean@exemple.test','Je recommande à mes clients PME.')`, [SIRET_A]), /permission denied/i, 'anon writing directly');
    await refused(() => asService(`select public.submit_partner_application('Jean','Jean Conseil','12345678901234','jean@exemple.test','Je recommande à mes clients PME.')`), /partner_siret_invalid/, 'an invalid SIRET');
    await asService(`select public.submit_partner_application('Jean','Jean Conseil',$1,'Jean@Exemple.test','Je recommande ProspectOS à mes clients PME.')`, [SIRET_B]);
    assert.equal((await as(C1, 'select count(*)::int n from public.partner_applications')).rows[0].n, 0);
    const ov = (await as(K, 'select public.partner_admin_overview() o')).rows[0].o;
    assert.equal(ov.applications[0].email, 'jean@exemple.test');
    assert.equal(ov.partners.length, 3);
    assert.ok(ov.statements.length >= 4);
    await refused(() => as(PA, 'select public.partner_admin_overview()'), /Admin access required/, 'a partner reading the overview');
  });
  await check('CHECKOUT METADATA: the referring partner of a user, for the server only', async () => {
    assert.equal((await asService('select public.partner_of_user($1) p', [C1])).rows[0].p, A);
    assert.equal((await asService('select public.partner_of_user($1) p', [C3])).rows[0].p, null);
    await refused(() => as(C1, 'select public.partner_of_user($1)', [C1]), /permission denied/i, 'a browser reading it');
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
