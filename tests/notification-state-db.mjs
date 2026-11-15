// Migration 044 — notification read state, on real PostgreSQL (PGlite) with the full migration chain: each user reads
// only their own row, nobody writes it directly, mark_notifications_seen() sets it for the caller only and never goes back.
// WITHOUT_044=1 runs the checks without the migration: they must fail.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const ATTEST = 'J\'atteste l\'exactitude de ce relevé';
// A small but real PDF (the proposal made by `npm run devis` in practice) and its SHA-256 computed here, independently.
const pdfBytes = text => Buffer.from(`%PDF-1.4\n% proposition ${text}\n${'x'.repeat(200)}\n%%EOF\n`, 'latin1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const item = (siren, name) => ({ siren, name, city: 'Meaux', source_label: 'BODACC — création', source_url: `https://www.bodacc.fr/annonce/${siren}` });

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
    .filter(f => !(process.env.WITHOUT_044 && f.startsWith('044_')));
  assert.ok(process.env.WITHOUT_044 || migrations.includes('044_notification_state.sql'), 'migration 044 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test.fr'),($2,'b@test.fr')`, [A, B]);
  await check('SEEN: the caller marks their own centre as seen; the date never goes back', async () => {
    const t1 = (await as(A, `select public.mark_notifications_seen() t`)).rows[0].t;
    assert.ok(t1);
    const row = (await as(A, `select user_id,seen_at from public.user_notification_state`)).rows;
    assert.equal(row.length, 1); assert.equal(row[0].user_id, A);
    await sql(`update public.user_notification_state set seen_at=now()+interval '1 day' where user_id=$1`, [A]);
    await as(A, `select public.mark_notifications_seen()`);
    assert.ok((await sql(`select seen_at>now() f from public.user_notification_state where user_id=$1`, [A])).rows[0].f, 'greatest: never earlier');
  });
  await check('ISOLATION: a user never reads another user’s row; anon nothing', async () => {
    await as(B, `select public.mark_notifications_seen()`);
    assert.deepEqual((await as(A, `select user_id from public.user_notification_state`)).rows.map(r => r.user_id), [A]);
    assert.deepEqual((await as(B, `select user_id from public.user_notification_state`)).rows.map(r => r.user_id), [B]);
    await refused(() => as(undefined, `select * from public.user_notification_state`), /permission denied/i, 'anon reading');
    await refused(() => as(undefined, `select public.mark_notifications_seen()`), /permission denied/i, 'anon marking');
  });
  await check('NO_DIRECT_WRITE: no browser role writes the table', async () => {
    await refused(() => as(A, `update public.user_notification_state set seen_at=now() where user_id=$1`, [B]), /permission denied/i, 'updating another row');
    await refused(() => as(A, `insert into public.user_notification_state(user_id) values($1)`, [B]), /permission denied/i, 'inserting a row');
    await refused(() => as(A, `delete from public.user_notification_state`), /permission denied/i, 'deleting');
  });
  await check('NOTHING_ELSE: no existing table, policy or function is touched', async () => {
    const m = (await readFile(new URL('../db/migrations/044_notification_state.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table|on) public\.(?!user_notification_state\b)\w+/i);
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
