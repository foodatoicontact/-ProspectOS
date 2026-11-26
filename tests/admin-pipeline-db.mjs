// Migration 060 — cockpit administrateur, écran Pipeline (owner decision, 26 nov. 2026), on real PostgreSQL (PGlite), full
// chain. The requests of the two public forms (056) are followed in six columns; a move is versioned (a stale screen never
// overwrites a newer move) and kept in an append-only history; both go with their request at the 12-month retention; and
// the RLS test: a client account and an anonymous visitor read nothing, call nothing, write nothing.
// WITHOUT_060=1: the checks must fail.
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
    .filter(f => !(process.env.WITHOUT_060 && f.startsWith('060_')));
  assert.ok(process.env.WITHOUT_060 || migrations.includes('060_admin_pipeline.sql'), 'migration 060 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const K = uid(0xad), C = uid(0xc1);
  await sql(`insert into auth.users(id,email) values($1,'admin@prospectos.test'),($2,'gerant@boulangerie.test')`, [K, C]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  await as(C, `select public.create_organization('Boulangerie Martin')`);
  const submit = (kind, activity, email) => asService(`select public.submit_contact_request($1,$2,'Restaurants','69',$3,'Société test','') r`, [kind, activity, email]).then(r => r.rows[0].r);
  await submit('PROSPECTS', 'Expert-comptable', 'a@cabinet.test');
  await submit('WATCH', 'Franchise de restauration', 'b@franchise.test');
  await submit('PROSPECTS', 'Agence web', 'c@agence.test');
  const ids = (await sql(`select id,email from public.contact_requests order by email`)).rows;
  const [A, B, Cr] = ids.map(r => r.id);
  const board = (kinds = null) => as(K, `select public.admin_pipeline($1) r`, [kinds]).then(r => r.rows[0].r);
  const move = (id, stage, version) => as(K, `select public.admin_pipeline_move($1,$2,$3) r`, [id, stage, version]).then(r => r.rows[0].r);

  await check('BOARD: every request of both forms, newest first, « Nouveau » until moved; filtered by form', async () => {
    const b = await board();
    assert.equal(b.total, 3); assert.equal(b.items.length, 3);
    assert.ok(b.items.every(i => i.stage === 'NEW' && i.version === 0 && i.moved_at === null));
    const a = b.items.find(i => i.id === A);
    assert.equal(a.email, 'a@cabinet.test'); assert.equal(a.kind, 'PROSPECTS'); assert.equal(a.department, '69'); assert.equal(a.company, 'Société test');
    assert.deepEqual((await board(['WATCH'])).items.map(i => i.id), [B]);
    await refused(() => board(['OTHER']), /admin_query_invalid/, 'an unknown form');
  });

  await check('MOVE: versioned; a stale screen is refused and never overwrites; same stage is a no-op', async () => {
    const m1 = await move(A, 'CONTACTED', 0);
    assert.equal(m1.stage, 'CONTACTED'); assert.equal(m1.version, 1);
    const m2 = await move(A, 'DEMO', 1);
    assert.equal(m2.version, 2);
    await refused(() => move(A, 'LOST', 1), /admin_pipeline_conflict/, 'a move from a stale screen');
    assert.equal((await board()).items.find(i => i.id === A).stage, 'DEMO', 'the newer move stays');
    assert.equal((await move(A, 'DEMO', 2)).version, 2, 'no-op');
    await move(A, 'QUOTE', 2); await move(A, 'SIGNED', 3); await move(B, 'LOST', 0);
    const a = (await board()).items.find(i => i.id === A);
    assert.equal(a.stage, 'SIGNED'); assert.equal(a.moved_by, 'admin@prospectos.test');
    await refused(() => move(A, 'WON', 4), /admin_query_invalid/, 'an unknown stage');
    await refused(() => move(uid(0x999), 'DEMO', 0), /admin_request_not_found/, 'an unknown request');
  });

  await check('HISTORY: every move kept with its author; append-only for every role, the owner included', async () => {
    const h = (await as(K, `select from_stage,to_stage from public.admin_pipeline_moves where request_id=$1 order by id`, [A])).rows;
    assert.deepEqual(h.map(x => `${x.from_stage}>${x.to_stage}`), ['NEW>CONTACTED', 'CONTACTED>DEMO', 'DEMO>QUOTE', 'QUOTE>SIGNED']);
    await refused(() => sql(`update public.admin_pipeline_moves set to_stage='LOST'`), /append-only/, 'the owner changing the history');
    await refused(() => sql(`delete from public.admin_pipeline_moves`), /append-only/, 'the owner deleting the history');
    await refused(() => sql(`truncate public.admin_pipeline_moves`), /append-only/, 'the owner truncating the history');
  });

  await check('RETENTION: a request deleted at 12 months takes its stage and its history with it', async () => {
    await sql(`update public.contact_requests set created_at=now()-interval '13 months' where id=$1`, [A]);
    await asService(`select public.purge_contact_requests()`);
    assert.equal((await sql(`select count(*)::int n from public.admin_pipeline where request_id=$1`, [A])).rows[0].n, 0);
    assert.equal((await sql(`select count(*)::int n from public.admin_pipeline_moves where request_id=$1`, [A])).rows[0].n, 0);
    assert.equal((await sql(`select count(*)::int n from public.admin_pipeline_moves where request_id=$1`, [B])).rows[0].n, 1, 'the others stay');
    assert.equal((await board()).total, 2);
  });

  await check('RLS: a client account and an anonymous visitor read, call and write nothing', async () => {
    assert.equal((await as(C, 'select count(*)::int n from public.admin_pipeline')).rows[0].n, 0);
    assert.equal((await as(C, 'select count(*)::int n from public.admin_pipeline_moves')).rows[0].n, 0);
    await refused(() => as(C, `select public.admin_pipeline(null)`), /Admin access required/, 'a client reading the board');
    await refused(() => as(C, `select public.admin_pipeline_move($1,'DEMO',0)`, [Cr]), /Admin access required/, 'a client moving a request');
    await refused(() => as(C, `insert into public.admin_pipeline(request_id,stage,moved_by) values($1,'DEMO',$2)`, [Cr, C]), /permission denied/i, 'a direct insert');
    await refused(() => as(C, `insert into public.admin_pipeline_moves(request_id,from_stage,to_stage,moved_by) values($1,'NEW','DEMO',$2)`, [Cr, C]), /permission denied/i, 'a direct history insert');
    await refused(() => as(undefined, 'select count(*) from public.admin_pipeline'), /permission denied/i, 'anon reading the board');
    await refused(() => as(undefined, `select public.admin_pipeline(null)`), /permission denied/i, 'anon calling the board');
    assert.equal((await as(K, 'select count(*)::int n from public.admin_pipeline')).rows[0].n, 1, 'the administrator, and only them');
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
