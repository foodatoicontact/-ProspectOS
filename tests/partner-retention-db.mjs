// Migration 053 — programme partenaires, conservation, on real PostgreSQL (PGlite) with the full migration chain: an
// application that was not accepted is deleted 6 months after it was sent; an accepted one (a partner exists with its
// e-mail) stays; a recent one stays; the nightly run_retention() does it, server only. Fictitious data only.
// WITHOUT_053=1 runs the checks without the migration: they must fail.
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
const SIRET = '99900000100019';
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
    .filter(f => !(process.env.WITHOUT_053 && f.startsWith('053_')));
  assert.ok(process.env.WITHOUT_053 || migrations.includes('053_partner_applications_retention.sql'), 'migration 053 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  const U = '00000000-0000-4000-8000-0000000000a1';
  await sql(`insert into auth.users(id,email) values($1,'u@exemple.test')`, [U]);
  const app = (email, at) => sql(`insert into public.partner_applications(name,company,siret,email,pitch,created_at) values('Nom','Entreprise',$1,$2,'Je recommande ProspectOS à mes clients.',$3)`, [SIRET, email, at]);
  await app('refusee@exemple.test', '2026-01-10T10:00:00Z');                     // old, never accepted → deleted
  await app('acceptee@exemple.test', '2026-01-10T10:00:00Z');                    // old, became a partner → kept
  await app('recente@exemple.test', new Date(Date.now() - 30 * 86400e3).toISOString()); // recent → kept
  await sql(`insert into public.partners(name,company,siret,email,code,created_by) values('Nom','Entreprise',$1,'acceptee@exemple.test','ACCEPTEE',$2)`, [SIRET, U]);

  await check('SERVER ONLY: no browser session may run the purge', async () => {
    await refused(() => as(U, 'select public.purge_partner_applications()'), /permission denied/i, 'a signed-in purge');
    await refused(() => as(undefined, 'select public.purge_partner_applications()'), /permission denied/i, 'an anonymous purge');
  });
  await check('NIGHTLY: run_retention deletes the applications not accepted after 6 months — and only them', async () => {
    const r = (await asService('select public.run_retention() r')).rows[0].r;
    assert.equal(r.partner_applications, 1);
    assert.deepEqual((await sql('select email from public.partner_applications order by email')).rows.map(x => x.email), ['acceptee@exemple.test', 'recente@exemple.test']);
    assert.equal((await asService('select public.purge_partner_applications() n')).rows[0].n, 0, 'a second run finds nothing');
  });
  await check('NOTHING_ELSE: only functions; no table, policy or trigger is created or changed', async () => {
    const m = (await readFile(new URL('../db/migrations/053_partner_applications_retention.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(create|alter|drop) (table|policy|trigger)\b/i);
    assert.doesNotMatch(m, /(insert into|update) public\./i);
    assert.doesNotMatch(m, /delete from public\.(?!partner_applications\b)/i, 'deletes partner applications only');
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
