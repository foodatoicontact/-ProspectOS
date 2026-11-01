// Migration 039 — recent business purchases from the BODACC ('bodacc_sales') as a Discovery provider, on real
// PostgreSQL (PGlite) with the full migration chain. start_discovery accepts 'bodacc_sales' and reserves exactly ONE
// billable Discovery (like the register), runs and results carry the provider, a failed run gives its unit back,
// a reprise search is never served from an earlier run, tenants stay isolated, the other providers are unchanged.
// WITHOUT_039=1 runs the same checks without the migration: they must fail (proof the test exercises 039).
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
    .filter(f => !(process.env.WITHOUT_039 && f.startsWith('039_')));
  assert.ok(process.env.WITHOUT_039 || migrations.includes('039_discovery_bodacc_sales_provider.sql'), 'migration 039 present');
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
  const start = (c, provider) => as(c.user, `select public.start_discovery($1,'reprises','Haute-Garonne (31)','["restaurant"]',$2,20,'{}'::jsonb) run`, [c.project, provider]).then(r => r.rows[0].run);
  const billed = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery' and billable`, [user])).rows[0].n);
  const used = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery'`, [user])).rows[0].n);

  let runA;
  await check('A_START_ACCEPTS_BODACC_SALES: start_discovery accepts provider bodacc_sales', async () => {
    runA = await start(ctx.A, 'bodacc_sales');
    assert.equal(runA.provider, 'bodacc_sales'); assert.equal(runA.status, 'running');
  });
  await check('B_RESULTS_STORED: results saved through the server path take provider=bodacc_sales from the run', async () => {
    const rows = [{ company_name: 'NB2M', website: null, city: "L'Isle-en-Dodon", source_url: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A20260208360', source_title: 'Reprise publiée au BODACC le 29 octobre 2026',
      normalized_payload: { name: 'NB2M', raw_metadata: { siren: '106463037', source_class: 'COMPANY_CANDIDATE', source_type: 'legal_announcement' } }, dedupe_key: 'siren:106463037', dedupe_status: 'unique', source_class: 'COMPANY_CANDIDATE' }];
    const saved = (await asService('select * from public.save_discovery_results($1,$2,$3::jsonb)', [A, runA.id, JSON.stringify(rows)])).rows;
    assert.equal(saved.length, 1); assert.equal(saved[0].provider, 'bodacc_sales');
  });
  await check('C_QUOTA_ONCE: one launch consumes exactly one billable Discovery; fixture stays free', async () => {
    await sql('delete from prospectos_private.discovery_quota_usage where user_id=$1', [A]);
    await start(ctx.A, 'bodacc_sales');
    assert.equal(await used(A), 1); assert.equal(await billed(A), 1);
    await start(ctx.A, 'registry'); await start(ctx.A, 'brave');
    assert.equal(await billed(A), 3);
    await start(ctx.A, 'fixture');
    assert.equal(await used(A), 4); assert.equal(await billed(A), 3, 'fixture is never billed');
  });
  await check('C2_QUOTA_ENFORCED: a launch is refused once the plan limit is reached (no bypass)', async () => {
    await sql(`insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select $1,'discovery',$2 from generate_series(1,40)`, [ctx.A.org, A]);
    await refused(() => start(ctx.A, 'bodacc_sales'), /quota|limit/i, 'a launch over the plan limit');
    await sql('delete from prospectos_private.discovery_quota_usage where user_id=$1', [A]);
  });
  await check('D_FAILED_RUN_REFUNDED: a run whose BODACC never answered gives its unit back (021, unchanged)', async () => {
    await sql('delete from prospectos_private.discovery_quota_usage where user_id=$1', [A]);
    const run = await start(ctx.A, 'bodacc_sales');
    await sql(`update public.discovery_runs set status='failed' where id=$1`, [run.id]);
    assert.equal((await asService('select public.release_failed_discovery($1) r', [run.id])).rows[0].r, true);
    assert.equal(await billed(A), 0);
  });
  await check('E_NEVER_REUSED: a completed reprise search is never reused; a register search still is', async () => {
    const make = async provider => { const r = await start(ctx.A, provider); await sql(`update public.discovery_runs set status='completed', result_count=3 where id=$1`, [r.id]); return r; };
    const reusable = async (run, provider) => (await sql(`select prospectos_private.run_reusable(r,$2,'reprises','Haute-Garonne (31)','["restaurant"]',$3,20,'{}'::jsonb) ok from public.discovery_runs r where r.id=$1`, [run.id, ctx.A.org, provider])).rows[0].ok;
    assert.equal(await reusable(await make('bodacc_sales'), 'bodacc_sales'), false);
    assert.equal(await reusable(await make('registry'), 'registry'), true);
  });
  await check('M_UNKNOWN_PROVIDER_STILL_REFUSED: any other provider name is still rejected (run and constraint)', async () => {
    await refused(() => start(ctx.A, 'bodacc'), /Invalid discovery input/, 'an unknown provider');
    await refused(() => sql(`insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider) values($1,$2,'q','l','[]','other')`, [ctx.A.org, ctx.A.project]), /check/i, 'an unknown provider row');
  });
  await check('N_REUSED_START_UNCHANGED: start_reused_discovery still refuses bodacc_sales', async () => {
    const run = await start(ctx.A, 'bodacc_sales');
    await refused(() => as(A, `select public.start_reused_discovery($1,$2,'reprises','Haute-Garonne (31)','["restaurant"]','bodacc_sales',20,'{}'::jsonb)`, [ctx.A.project, run.id]), /Invalid discovery input/, 'a reused reprise search');
  });
  await check('RLS_TENANT_ISOLATION: another tenant sees no run of A and cannot start one in A’s project', async () => {
    assert.equal(Number((await as(B, `select count(*) n from public.discovery_runs where provider='bodacc_sales' and organization_id=$1`, [ctx.A.org])).rows[0].n), 0);
    await refused(() => as(B, `select public.start_discovery($1,'reprises','Haute-Garonne (31)','[]','bodacc_sales',20,'{}'::jsonb)`, [ctx.A.project]), /member|permission|denied/i, 'a non-member launch');
  });
  await check('IDEMPOTENT: re-applying migration 039 changes nothing', async () => {
    if (!process.env.WITHOUT_039) await db.exec(await readFile(new URL('../db/migrations/039_discovery_bodacc_sales_provider.sql', import.meta.url), 'utf8'));
    const r = await start(ctx.A, 'bodacc_sales'); assert.equal(r.provider, 'bodacc_sales');
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
