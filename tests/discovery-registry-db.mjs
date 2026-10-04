// Migration 019 — the company register ('registry') as a Discovery provider, on real PostgreSQL (PGlite) with
// the full production migration chain. Checked directly against the database, as PostgREST would call it:
// start_discovery accepts 'registry' and reserves exactly ONE billable Discovery (like Brave), runs and results
// carry provider='registry', tenants stay isolated, and 'fixture'/'brave' behave exactly as before.
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
  assert.ok(migrations.includes('019_discovery_registry_provider.sql'), 'migration 019 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  const B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const project = async (user, o) => (await as(user, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [o])).rows[0].id;
  const ctx = {};
  for (const [k, u] of Object.entries({ A, B })) { const o = await org(u); ctx[k] = { user: u, org: o, project: await project(u, o) }; }
  await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000');
  for (const u of [A, B]) await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days') on conflict (user_id) do update set plan='BETA',status='ACTIVE'`, [u]);
  const start = (c, provider) => as(c.user, `select public.start_discovery($1,'industriel','Auvergne-Rhône-Alpes','["industriel","agroalimentaire"]',$2,20,'{"employee_range":{"min":200,"max":2000}}'::jsonb) run`, [c.project, provider]).then(r => r.rows[0].run);
  const billed = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery' and billable`, [user])).rows[0].n);
  const used = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery'`, [user])).rows[0].n);

  let runA;
  await check('A_START_ACCEPTS_REGISTRY: start_discovery accepts provider registry', async () => {
    runA = await start(ctx.A, 'registry');
    assert.equal(runA.provider, 'registry'); assert.equal(runA.status, 'running');
  });
  await check('B_RUN_STORED: the run row carries provider=registry and the structured filters', async () => {
    const row = (await as(A, 'select provider, filters_json from public.discovery_runs where id=$1', [runA.id])).rows[0];
    assert.equal(row.provider, 'registry');
    assert.deepEqual(row.filters_json.employee_range, { min: 200, max: 2000 });
  });
  await check('B2_RESULTS_STORED: results saved through the server path take provider=registry from the run', async () => {
    const rows = [{ company_name: 'CLAUGER', website: null, city: 'BRIGNAIS', source_url: 'https://annuaire-entreprises.data.gouv.fr/entreprise/971506191', source_title: 'CLAUGER — Annuaire des Entreprises (SIREN 971506191)',
      normalized_payload: { name: 'CLAUGER', raw_metadata: { siren: '971506191', source_class: 'COMPANY_CANDIDATE' } }, dedupe_key: 'siren:971506191', dedupe_status: 'unique', source_class: 'COMPANY_CANDIDATE' }];
    const saved = (await asService('select * from public.save_discovery_results($1,$2,$3::jsonb)', [A, runA.id, JSON.stringify(rows)])).rows;
    assert.equal(saved.length, 1); assert.equal(saved[0].provider, 'registry');
    assert.equal((await as(A, 'select count(*) n from public.discovery_results where discovery_run_id=$1', [runA.id])).rows[0].n, 1);
  });
  await check('C_QUOTA_ONCE: one registry launch consumes exactly one billable Discovery, like Brave; fixture stays free', async () => {
    await sql('delete from prospectos_private.discovery_quota_usage where user_id=$1', [A]);
    await start(ctx.A, 'registry');
    assert.equal(await used(A), 1); assert.equal(await billed(A), 1);
    await start(ctx.A, 'brave');
    assert.equal(await billed(A), 2);
    await start(ctx.A, 'fixture');
    assert.equal(await used(A), 3); assert.equal(await billed(A), 2, 'fixture is never billed');
  });
  await check('C2_QUOTA_ENFORCED: a registry launch is refused once the plan limit is reached (no bypass)', async () => {
    await sql(`insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select $1,'discovery',$2 from generate_series(1,40)`, [ctx.A.org, A]);
    await refused(() => start(ctx.A, 'registry'), /quota|limit/i, 'a registry launch over the plan limit');
    await sql('delete from prospectos_private.discovery_quota_usage where user_id=$1', [A]);
  });
  await check('M_UNKNOWN_PROVIDER_STILL_REFUSED: any other provider name is still rejected (run and constraint)', async () => {
    await refused(() => start(ctx.A, 'registre'), /Invalid discovery input/, 'an unknown provider');
    await refused(() => sql(`insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider) values($1,$2,'q','l','[]','other')`, [ctx.A.org, ctx.A.project]), /check/i, 'an unknown provider row');
  });
  await check('RLS_TENANT_ISOLATION: another tenant sees no registry run of A and cannot start one in A’s project', async () => {
    assert.equal(Number((await as(B, `select count(*) n from public.discovery_runs where provider='registry' and organization_id=$1`, [ctx.A.org])).rows[0].n), 0);
    await refused(() => as(B, `select public.start_discovery($1,'industriel','Lyon','[]','registry',20,'{}'::jsonb)`, [ctx.A.project]), /member|permission|denied/i, 'a non-member launch');
  });
  await check('IDEMPOTENT: re-applying migration 019 changes nothing', async () => {
    await db.exec(await readFile(new URL('../db/migrations/019_discovery_registry_provider.sql', import.meta.url), 'utf8'));
    const r = await start(ctx.A, 'registry'); assert.equal(r.provider, 'registry');
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
