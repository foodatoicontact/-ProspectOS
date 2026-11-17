// Audit 2026-11-11, S5 — on the full migration chain (PGlite): every SECURITY DEFINER function of the public schema that
// a signed-in browser may call checks its caller itself (RLS does not apply inside it) and pins its search_path. A new
// migration that forgets the check fails here.
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
;
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  // Every SECURITY DEFINER function of public that a signed-in browser can call bypasses RLS: it must check who calls it
  // itself. Accepted guards: a membership/ownership/administrator helper, or a query bound to auth.uid().
  const GUARD = /prospectos_private\.(require_member|require_owner|require_team_owner|is_member|is_internal_admin|dedicated_require_\w+)\(|auth\.uid\(\)/;
  // Reviewed exceptions, each with its reason (audit 2026-11-11 S5).
  const NO_CALLER_DATA = { trial_available: 'returns only whether trial capacity remains — no tenant data' };
  const fns = (await sql(`select p.proname, p.prosrc, coalesce(array_to_string(p.proconfig,','),'') cfg
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute') order by 1`)).rows;
  await check('INVENTORY: the signed-in browser can call SECURITY DEFINER functions (the check below is not vacuous)', async () => {
    assert.ok(fns.length >= 60, `${fns.length} functions`);
  });
  await check('GUARD: each one checks its caller (membership, ownership, administrator, or auth.uid())', async () => {
    const unguarded = fns.filter(f => !GUARD.test(f.prosrc) && !NO_CALLER_DATA[f.proname]).map(f => f.proname);
    assert.deepEqual(unguarded, []);
    for (const name of Object.keys(NO_CALLER_DATA)) assert.ok(fns.some(f => f.proname === name), `${name} still exists`);
  });
  await check('SEARCH_PATH: each one pins search_path (no object hijack through a caller schema)', async () => {
    assert.deepEqual(fns.filter(f => !/search_path=/.test(f.cfg)).map(f => f.proname), []);
  });
  await check('ANON: no SECURITY DEFINER function of public is callable without signing in, except reviewed ones', async () => {
    const anon = (await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute') order by 1`)).rows.map(r => r.proname);
    assert.deepEqual(anon.filter(n => !NO_CALLER_DATA[n]), []);
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
