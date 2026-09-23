// Automatic beta access on first authenticated arrival — database guarantees of activate_trial()
// (migration 012), the only path a signed-in user has to a BETA entitlement. The app calls it from
// loadAccount() on every authenticated arrival (login, return from the confirmation link, restored
// session); everything that must hold regardless of how often or how concurrently that happens is proven
// here against real Postgres (PGlite): capacity, idempotence, no second free period, INTERNAL/PAID left
// untouched, no identity or email a caller could inject, no client write path. True parallel sessions
// are covered by tests/beta-trial-concurrency-realpg.sh (needs a local PostgreSQL server).
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const read = f => readFile(new URL(f, import.meta.url), 'utf8');
const sql = (text, params = []) => db.query(text, params);
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
const fails = async (op, pattern) => { try { await op; return false; } catch (e) { return pattern.test(String(e?.message)); } };
const uuid = (p, i) => `${p}-0000-4000-8000-${String(i).padStart(12, '0')}`;
const one = async (text, params) => (await sql(text, params)).rows[0];
const betaUsed = async () => (await one(`select count(*)::int n from public.account_entitlements where plan='BETA'`)).n;
const rowOf = async u => one(`select plan,status,starts_at,expires_at,updated_at from public.account_entitlements where user_id=$1`, [u]);
let seq = 0;
async function newUser(tag) { const id = uuid('a0000000', ++seq); await sql(`insert into auth.users(id,email) values ($1,$2)`, [id, `${tag}${seq}@test`]); return id; }
async function reset(capacity = 10) { await sql(`delete from public.account_entitlements`); await sql(`update prospectos_private.beta_program set capacity=$1`, [capacity]); }
async function fill(n) { for (let i = 0; i < n; i++) await as(await newUser('fill'), `select public.activate_trial()`); }

const results = [];
const check = (name, ok) => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
`);
await db.exec(await read('../db/schema.sql'));
for (const m of ['008_account_privacy_beta', '011_beta_entitlement_gate', '012_beta_self_service_trial']) await db.exec(await read(`../db/migrations/${m}.sql`));
// A PAID plan does not exist yet; widened here, in this throwaway test database only, to prove
// activate_trial() never touches a row of any plan it did not create.
await db.exec(`alter table public.account_entitlements drop constraint account_entitlements_plan_check;
  alter table public.account_entitlements add constraint account_entitlements_plan_check check(plan in ('BETA','INTERNAL','PAID'));`);

// 1 + 2 — first authenticated arrival with a free slot: ACTIVE BETA, exactly 7 days, counter +1.
await reset();
const a = await newUser('a');
const before1 = await betaUsed();
const r1 = (await as(a, `select public.activate_trial() r`)).rows[0].r;
const row1 = await rowOf(a);
check('1_FIRST_LOGIN_SLOT_AVAILABLE', r1.plan === 'BETA' && r1.status === 'ACTIVE' && row1.plan === 'BETA' && (await betaUsed()) === before1 + 1);
check('2_EXACT_7_DAYS', (await one(`select (expires_at - starts_at) = interval '7 days' ok from public.account_entitlements where user_id=$1`, [a])).ok);

// 3 + 4 — second login, then repeated refreshes: nothing moves.
await as(a, `select public.activate_trial()`);
const row3 = await rowOf(a);
check('3_SECOND_LOGIN_IDEMPOTENT', JSON.stringify(row3) === JSON.stringify(row1) && (await one(`select count(*)::int n from public.account_entitlements where user_id=$1`, [a])).n === 1);
for (let i = 0; i < 5; i++) await as(a, `select public.activate_trial()`);
check('4_REFRESH_IDEMPOTENT', JSON.stringify(await rowOf(a)) === JSON.stringify(row1) && (await betaUsed()) === before1 + 1);

// 5 — expired trial (past expiry, and status EXPIRED): never a second free period.
const expiredByDate = await newUser('exp');
await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'BETA','ACTIVE',now()-interval '10 days',now()-interval '3 days')`, [expiredByDate]);
const expiredByStatus = await newUser('exps');
await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'BETA','EXPIRED',now()-interval '10 days',now()-interval '3 days')`, [expiredByStatus]);
const e1 = await rowOf(expiredByDate), e2 = await rowOf(expiredByStatus), usedE = await betaUsed();
const re1 = (await as(expiredByDate, `select public.activate_trial() r`)).rows[0].r;
await as(expiredByStatus, `select public.activate_trial()`);
check('5_EXPIRED_NO_SECOND_TRIAL', JSON.stringify(await rowOf(expiredByDate)) === JSON.stringify(e1) && JSON.stringify(await rowOf(expiredByStatus)) === JSON.stringify(e2)
  && new Date(re1.expires_at) < new Date() && (await betaUsed()) === usedE);

// 6 + 7 — INTERNAL and PAID rows are returned untouched and consume no BETA slot.
const internal = await newUser('int');
await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'INTERNAL','ACTIVE',now(),now()+interval '100 years')`, [internal]);
const paid = await newUser('paid');
await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'PAID','ACTIVE',now(),now()+interval '30 days')`, [paid]);
const i0 = await rowOf(internal), p0 = await rowOf(paid), usedIP = await betaUsed();
const ri = (await as(internal, `select public.activate_trial() r`)).rows[0].r;
const rp = (await as(paid, `select public.activate_trial() r`)).rows[0].r;
check('6_INTERNAL_UNCHANGED', ri.plan === 'INTERNAL' && JSON.stringify(await rowOf(internal)) === JSON.stringify(i0) && (await betaUsed()) === usedIP);
check('7_PAID_UNCHANGED', rp.plan === 'PAID' && JSON.stringify(await rowOf(paid)) === JSON.stringify(p0) && (await betaUsed()) === usedIP);

// 8 — capacity reached: clean refusal, no row created, counter stays at 10.
await reset();
await fill(10);
const late = await newUser('late');
const refused = await fails(as(late, `select public.activate_trial()`), /BETA_CAPACITY_REACHED/);
check('8_CAPACITY_FULL_NO_ACTIVATION', refused && !(await rowOf(late)) && (await betaUsed()) === 10);

// 9 — 9/10 used, two claims: exactly one wins, final 10/10. (Serialized here — PGlite has a single
// connection; real parallel sessions: tests/beta-trial-concurrency-realpg.sh.)
await reset();
await fill(9);
const x = await newUser('x'), y = await newUser('y');
const xOk = !(await fails(as(x, `select public.activate_trial()`), /./));
const yRefused = await fails(as(y, `select public.activate_trial()`), /BETA_CAPACITY_REACHED/);
check('9_TWO_CLAIMS_AT_9_OF_10', xOk && yRefused && (await betaUsed()) === 10 && !!(await rowOf(x)) && !(await rowOf(y)));

// 10 + 12 — no parameter at all: A can only ever activate A; nothing to inject (no user id, no email).
await reset();
const A = await newUser('A'), B = await newUser('B');
await as(A, `select public.activate_trial()`);
const nargs = (await one(`select pronargs from pg_proc where oid='public.activate_trial()'::regprocedure`)).pronargs;
check('10_A_CANNOT_ACTIVATE_B', !!(await rowOf(A)) && !(await rowOf(B)) && nargs === 0);
const injectUid = await fails(as(A, `select public.activate_trial($1::uuid)`, [B]), /does not exist/);
const injectEmail = await fails(as(A, `select public.activate_trial('B@test')`), /does not exist/);
const grantDenied = await fails(as(A, `select public.grant_beta_access('B@test')`), /permission denied/i);
const internalDenied = await fails(as(A, `select public.grant_internal_access('B@test')`), /permission denied/i);
check('12_NO_INJECTABLE_PARAMS', injectUid && injectEmail && grantDenied && internalDenied && !(await rowOf(B)));

// 11 — anonymous callers cannot activate anything.
const usedAnon = await betaUsed();
check('11_ANON_DENIED', (await fails(as(undefined, `select public.activate_trial()`), /permission denied/i)) && (await betaUsed()) === usedAnon);

// 13 — RLS still on, exactly one read-only self policy; a user never reads another user's row.
const rls = (await one(`select relrowsecurity r from pg_class where oid='public.account_entitlements'::regclass`)).r;
const policies = (await sql(`select policyname,cmd from pg_policies where tablename='account_entitlements'`)).rows;
const aSeesB = (await as(A, `select count(*)::int n from public.account_entitlements where user_id<>auth.uid()`)).rows[0].n;
check('13_RLS_ACTIVE', rls === true && policies.length === 1 && policies[0].cmd === 'SELECT' && aSeesB === 0);

// 14 — INTERNAL is not counted: with 1 INTERNAL + 9 BETA, the 10th BETA slot is still available.
await reset();
await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'INTERNAL','ACTIVE',now(),now()+interval '100 years')`, [internal]);
await fill(9);
const tenth = await newUser('tenth');
const tenthOk = !(await fails(as(tenth, `select public.activate_trial()`), /./));
check('14_INTERNAL_NOT_COUNTED', tenthOk && (await betaUsed()) === 10);

// 15 — no path exceeds capacity: the admin grant shares the same pool and is refused too.
const eleventh = await newUser('eleventh');
const selfRefused = await fails(as(eleventh, `select public.activate_trial()`), /BETA_CAPACITY_REACHED/);
const adminRefused = await fails(sql(`select public.grant_beta_access($1)`, [`eleventh${seq}@test`]), /BETA_CAPACITY_REACHED/);
check('15_NO_OVER_CAPACITY', selfRefused && adminRefused && (await betaUsed()) === 10);

// 16 — the client can never write an entitlement directly (insert, extend, delete).
const w = await newUser('w');
const insDenied = await fails(as(w, `insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values (auth.uid(),'BETA','ACTIVE',now(),now()+interval '1 year')`), /permission denied/i);
const updDenied = await fails(as(tenth, `update public.account_entitlements set expires_at=now()+interval '1 year' where user_id=auth.uid()`), /permission denied/i);
const delDenied = await fails(as(tenth, `delete from public.account_entitlements where user_id=auth.uid()`), /permission denied/i);
const grants = (await sql(`select privilege_type from information_schema.role_table_grants where grantee='authenticated' and table_name='account_entitlements' order by 1`)).rows.map(r => r.privilege_type);
check('16_NO_CLIENT_WRITE', insDenied && updDenied && delDenied && JSON.stringify(grants) === '["SELECT"]');

const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `FAIL: ${failed.length}/${results.length} checks failed` : `PASS: beta auto-activation ${results.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
