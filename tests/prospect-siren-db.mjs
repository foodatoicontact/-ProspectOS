// Migration 050 — the SIREN on the prospect record, on real PostgreSQL (PGlite): the chain up to 049, records made before,
// then 050 — the backfill, the SIREN of a new register record, one record per company and project, format and rights.
// WITHOUT_050=1 runs the checks without the migration: they must fail.
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
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  assert.ok(migrations.includes('050_prospect_siren.sql'), 'migration 050 present');
  for (const f of migrations.filter(f => f < '050_')) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test.fr'),($2,'b@test.fr')`, [A, B]);
  const orgA = (await as(A, `select public.create_organization('A') id`)).rows[0].id;
  const orgB = (await as(B, `select public.create_organization('B') id`)).rows[0].id;
  const project = async (user, org) => (await as(user, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [org])).rows[0].id;
  const [pA, pA2, pB] = [await project(A, orgA), await project(A, orgA), await project(B, orgB)];
  const prospect = async (user, org, proj, name, key = null) => (await as(user, `insert into public.prospects(organization_id,project_id,name,discovery_dedupe_key) values($1,$2,$3,$4) returning id`, [org, proj, name, key])).rows[0].id;
  // Before 050: records from a register result (dedupe key), and one identified by the public registers (observation).
  const old1 = await prospect(A, orgA, pA, 'Ancien registre', 'siren:111111111');
  const old2 = await prospect(A, orgA, pA, 'Identifié', 'domain:x.example|');
  const old3 = await prospect(A, orgA, pA2, 'Autre projet', 'siren:111111111');
  await sql(`insert into public.prospect_observations(organization_id,prospect_id,observation_type,claim,status,source_url,source_title,source_excerpt,source_type,confidence,collected_at,expires_at,content_hash)
    values($1,$2,'REGISTRY_IDENTITY','Identité','OBSERVED','https://annuaire-entreprises.data.gouv.fr/entreprise/222222222','Registre','X SIREN 222222222','public_directory',.9,now(),now()+interval '1 year','h1')`, [orgA, old2]);
  if (!process.env.WITHOUT_050) await db.exec(await readFile(new URL('../db/migrations/050_prospect_siren.sql', import.meta.url), 'utf8'));
  const sirenOf = async id => (await sql(`select siren from public.prospects where id=$1`, [id])).rows[0].siren;

  await check('BACKFILL: from the register dedupe key and from the registers\' identity row, per project', async () => {
    assert.equal(await sirenOf(old1), '111111111');
    assert.equal(await sirenOf(old2), '222222222');
    assert.equal(await sirenOf(old3), '111111111', 'another project of the same organization has its own record');
  });
  await check('NEW RECORD: created from a register result, it carries its SIREN; kept apart on purpose (|separate:), it does not', async () => {
    const p = await prospect(A, orgA, pA, 'Nouveau', 'siren:333333333');
    assert.equal(await sirenOf(p), '333333333');
    const apart = await prospect(A, orgA, pA, 'Gardé à part', 'siren:333333333|separate:x');
    assert.equal(await sirenOf(apart), null);
  });
  await check('ONE RECORD PER COMPANY AND PROJECT: a second record never takes a SIREN already used; a hand-set duplicate is refused', async () => {
    await as(A, `update public.prospects set siren='444444444' where id=$1`, [old2]).catch(() => {});
    const p = await prospect(A, orgA, pA, 'Doublon', 'domain:y.example|');
    await refused(() => as(A, `update public.prospects set siren='111111111' where id=$1`, [p]), /prospects_project_siren_idx|duplicate key/, 'two records with one SIREN in a project');
  });
  await check('FORMAT AND RIGHTS: 9 digits only; a member sets it by hand, another organization cannot', async () => {
    const p = await prospect(A, orgA, pA, 'Manuel');
    await refused(() => as(A, `update public.prospects set siren='12345' where id=$1`, [p]), /prospects_siren_format/, 'a malformed SIREN');
    await as(A, `update public.prospects set siren='555555555' where id=$1`, [p]);
    assert.equal(await sirenOf(p), '555555555');
    const r = await as(B, `update public.prospects set siren='666666666' where id=$1 returning id`, [p]);
    assert.equal(r.rows.length, 0, 'RLS: invisible to another organization');
    assert.equal(await sirenOf(p), '555555555');
  });
  await check('NOTHING_ELSE: a column, its index, one insert trigger on prospects; no evidence, observation or policy change', async () => {
    const m = (await readFile(new URL('../db/migrations/050_prospect_siren.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|delete from) public\.\w+/i);
    assert.doesNotMatch(m, /(update|on|alter table) public\.(evidence|prospect_observations|signals|account_entitlements)\b/i);
    assert.doesNotMatch(m, /create policy|drop policy/i);
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
