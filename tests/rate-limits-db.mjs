// Migration 047 — shared rate limits, on real PostgreSQL (PGlite) with the full migration chain: one fixed window per
// account (keyed by auth.uid(), never by a caller's value) or per server-made key; nobody reads or resets the counters.
// WITHOUT_047=1 runs the checks without the migration: they must fail.
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
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).split('\n')[0]]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
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
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_047 && f.startsWith('047_')));
  assert.ok(process.env.WITHOUT_047 || migrations.includes('047_rate_limits.sql'), 'migration 047 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test.fr'),($2,'b@test.fr')`, [A, B]);
  const hit = (user, bucket = 'api', limit = 3, win = 60) => as(user, `select public.rate_limit_hit($1,$2,$3) r`, [bucket, limit, win]).then(x => x.rows[0].r);
  await check('ACCOUNT: the limit is per account and per bucket; past it the call says when to retry', async () => {
    for (let i = 1; i <= 3; i++) assert.equal((await hit(A)).allowed, true, `call ${i}`);
    const over = await hit(A);
    assert.equal(over.allowed, false); assert.ok(over.retry_after >= 1 && over.retry_after <= 60, `retry_after ${over.retry_after}`);
    assert.equal((await hit(B)).allowed, true, 'another account has its own counter');
    assert.equal((await hit(A, 'tenders')).allowed, true, 'another bucket has its own counter');
  });
  await check('SUBJECT: the counter is keyed by auth.uid(), never by a value the caller sends', async () => {
    const keys = (await sql(`select key from public.rate_limit_counters order by key`)).rows.map(r => r.key);
    assert.ok(keys.every(k => k.endsWith(A) || k.endsWith(B)), keys.join(','));
    await refused(() => as(undefined, `select public.rate_limit_hit('api',3,60)`), /permission denied/i, 'an anonymous call');
    await refused(() => hit(A, 'api:' + B), /Invalid bucket/, 'a bucket that names another account');
    await refused(() => hit(A, 'api', 0), /Invalid rate limit/, 'a zero limit');
  });
  await check('SERVER: anonymous traffic is counted by key, through the server only', async () => {
    const key = 'prospect_request:abcDEF123_-';
    for (let i = 1; i <= 2; i++) assert.equal((await asService(`select public.rate_limit_hit_key($1,2,3600) r`, [key])).rows[0].r.allowed, true);
    assert.equal((await asService(`select public.rate_limit_hit_key($1,2,3600) r`, [key])).rows[0].r.allowed, false);
    await refused(() => as(A, `select public.rate_limit_hit_key($1,2,3600)`, [key]), /permission denied/i, 'a signed-in account using the server key function');
    await refused(() => asService(`select public.rate_limit_hit_key('no key',2,3600)`), /Invalid key/, 'a malformed key');
  });
  await check('TABLE: no browser role reads or writes the counters', async () => {
    await refused(() => as(A, `select * from public.rate_limit_counters`), /permission denied/i, 'reading the counters');
    await refused(() => as(A, `delete from public.rate_limit_counters`), /permission denied/i, 'resetting the counters');
    await refused(() => as(undefined, `insert into public.rate_limit_counters(key,window_start) values('api:x',now())`), /permission denied/i, 'writing a counter');
  });
  await check('WINDOW: a new window starts a new count; old windows are purged', async () => {
    await sql(`update public.rate_limit_counters set window_start=window_start-interval '3 hours'`);
    assert.equal((await hit(A)).allowed, true, 'the previous window no longer counts');
    await sql(`delete from public.rate_limit_counters where window_start<now()-interval '2 hours'`);
    assert.equal((await sql(`select count(*)::int n from public.rate_limit_counters`)).rows[0].n, 1);
  });
  await check('NOTHING_ELSE: only the counter table is written; no other existing object is touched', async () => {
    const m = (await readFile(new URL('../db/migrations/047_rate_limits.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table|on) public\.(?!(rate_limit_counters)\b)\w+/i);
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
