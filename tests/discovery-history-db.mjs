// Discovery run history — real PostgreSQL (PGlite), full production migration chain, no new migration.
// Runs the exact reads of GET projects/:id/discovery and GET discovery-runs/:id/results as members
// (role authenticated, RLS on), and proves: newest-first listing, old runs kept, failed/running visible,
// reading creates nothing, tenant isolation, and no duplicate prospect when a result is accepted again.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { summarizeRuns } from '../src/discovery/run-history.ts';

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
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 400)]); }
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
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
  const OA = '10000000-0000-4000-8000-00000000000a', OB = '10000000-0000-4000-8000-00000000000b';
  const PA = '20000000-0000-4000-8000-00000000000a', PB = '20000000-0000-4000-8000-00000000000b', PA2 = '20000000-0000-4000-8000-0000000000a2';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA, A, OB, B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'Padel'),($3,$4,'B'),($5,$2,'Autre projet A')`, [PA, OA, PB, OB, PA2]);

  const start = async (user, project, query, location, max = 20) => (await as(user, `select public.start_discovery($1,$2,$3,'["padel"]','brave',$4,'{}') run`, [project, query, location, max])).rows[0].run.id;
  const candidate = (name) => ({company_name: name, website: `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.example/`, phone: null, address: null, city: 'Avignon',
    source_url: `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.example/`, source_title: name, provider: 'brave', raw_payload: {company_domain_method: 'own_site'},
    normalized_payload: {name, raw_metadata: {source_class: 'COMPANY_CANDIDATE'}}, dedupe_key: `name:${name}|${Math.random()}`, dedupe_status: 'unique', duplicate_of: null, reason: 'test', source_class: 'COMPANY_CANDIDATE'});
  const write = async (user, run, names) => (await asService('select * from public.save_discovery_results($1,$2,$3::jsonb)', [user, run, JSON.stringify(names.map(candidate))])).rows;

  // Two runs of the blind test (strict zone, then a wider one) for A, one run for B.
  const strict = await start(A, PA, 'Padel', 'Avignon');
  const strictRows = await write(A, strict, ['Padel Club Avignon', 'Urban Padel', 'Le Padel Sud']);
  await sql(`update public.discovery_runs set status='completed',completed_at=started_at,result_count=3,started_at='2026-09-26T15:08:00Z' where id=$1`, [strict]);
  const wide = await start(A, PA, 'Padel', 'Avignon élargie', 12);
  await write(A, wide, ['Padel Club Avignon', 'Padel Orange', 'Padel Cavaillon', 'Padel Carpentras']);
  await sql(`update public.discovery_runs set status='completed',completed_at=started_at,result_count=4,started_at='2026-09-26T17:08:00Z' where id=$1`, [wide]);
  const failed = await start(A, PA, 'Padel', 'Nîmes');
  await sql(`update public.discovery_runs set status='failed',completed_at=started_at,error_message='DISCOVERY_FAILED',started_at='2026-09-26T18:00:00Z' where id=$1`, [failed]);
  const running = await start(A, PA, 'Padel', 'Arles');
  await sql(`update public.discovery_runs set started_at='2026-09-26T18:30:00Z' where id=$1`, [running]);
  const runB = await start(B, PB, 'Secret B', 'Lyon');
  await write(B, runB, ['Entreprise B']);

  // The exact reads of the endpoints, as a member (RLS on).
  const listRuns = async (user, project) => {
    const runs = (await as(user, `select id,query,location,categories,provider,filters_json,status,started_at,completed_at,result_count from public.discovery_runs where project_id=$1 order by started_at desc limit 50`, [project])).rows
      .map(r => ({...r, started_at: new Date(r.started_at).toISOString(), completed_at: r.completed_at && new Date(r.completed_at).toISOString()}));
    const ids = runs.map(r => r.id);
    const decided = ids.length ? (await as(user, `select discovery_run_id,status from public.discovery_results where discovery_run_id = any($1::uuid[]) and status in ('accepted','ignored')`, [ids])).rows : [];
    return summarizeRuns(runs, decided);
  };
  const runResults = async (user, run) => {
    const found = (await as(user, 'select * from public.discovery_runs where id=$1', [run])).rows;
    if (found.length !== 1) throw new Error('RUN_NOT_FOUND'); // .single() in the API: 0 rows is an error
    return (await as(user, 'select * from public.discovery_results where discovery_run_id=$1 order by created_at', [run])).rows;
  };
  const count = async t => (await sql(`select count(*)::int n from public.${t}`)).rows[0].n;

  await check('1_EMPTY: a project without runs has an empty history', async () => {
    assert.deepEqual(await listRuns(A, PA2), []);
  });
  await check('2_13_ORDER_AND_KEPT: several runs newest first; the strict run is still there after the wider one', async () => {
    const list = await listRuns(A, PA);
    assert.deepEqual(list.map(r => [r.location, r.status]), [['Arles', 'running'], ['Nîmes', 'failed'], ['Avignon élargie', 'completed'], ['Avignon', 'completed']]);
    assert.equal(list.find(r => r.id === wide).max_results, 12);
    assert.deepEqual(list.find(r => r.id === strict).categories, ['padel']);
  });
  await check('14_15_STATUSES: failed and running runs are listed with their own status', async () => {
    const list = await listRuns(A, PA);
    assert.equal(list.find(r => r.id === failed).status, 'failed');
    assert.equal(list.find(r => r.id === running).status, 'running');
  });
  await check('3_4_VIEW_CREATES_NOTHING: reading history and results creates no run, no result, no quota usage', async () => {
    const before = [await count('discovery_runs'), await count('discovery_results'), await count('prospects')];
    const quotaBefore = (await sql(`select count(*)::int n from prospectos_private.discovery_quota_usage`)).rows[0].n;
    await listRuns(A, PA); await runResults(A, strict); await runResults(A, wide); await runResults(A, strict);
    assert.deepEqual([await count('discovery_runs'), await count('discovery_results'), await count('prospects')], before);
    assert.equal((await sql(`select count(*)::int n from prospectos_private.discovery_quota_usage`)).rows[0].n, quotaBefore);
  });
  await check('RESULTS_EXACT: viewing a run returns exactly its own results, the other run\'s stay separate', async () => {
    assert.deepEqual((await runResults(A, strict)).map(r => r.company_name).sort(), ['Le Padel Sud', 'Padel Club Avignon', 'Urban Padel']);
    assert.equal((await runResults(A, wide)).length, 4);
  });
  await check('7_8_ACCEPTED_NO_DUPLICATE: an accepted result shows its prospect; accepting it again creates no duplicate', async () => {
    const id = strictRows.find(r => r.company_name === 'Urban Padel').id;
    const first = (await as(A, 'select public.accept_discovery_result($1,false) p', [id])).rows[0].p;
    const prospects = await count('prospects');
    const again = (await as(A, 'select public.accept_discovery_result($1,false) p', [id])).rows[0].p;
    assert.equal(again.id, first.id); assert.equal(await count('prospects'), prospects);
    const row = (await runResults(A, strict)).find(r => r.id === id);
    assert.equal(row.status, 'accepted'); assert.equal(row.prospect_id, first.id);
    assert.equal((await listRuns(A, PA)).find(r => r.id === strict).accepted_count, 1);
    await as(A, 'select public.ignore_discovery_result($1)', [strictRows.find(r => r.company_name === 'Le Padel Sud').id]);
    assert.equal((await listRuns(A, PA)).find(r => r.id === strict).ignored_count, 1);
  });
  await check('10_TENANT_RUNS: a member of A cannot list or open B\'s runs, and B cannot see A\'s', async () => {
    assert.deepEqual(await listRuns(A, PB), []);
    assert.deepEqual(await listRuns(B, PA), []);
    await assert.rejects(() => runResults(A, runB), /RUN_NOT_FOUND/);
    await assert.rejects(() => runResults(B, strict), /RUN_NOT_FOUND/);
    assert.equal((await listRuns(B, PB)).length, 1);
  });
  await check('11_TENANT_RESULTS: results of another tenant are unreadable even by run id', async () => {
    assert.equal((await as(A, 'select * from public.discovery_results where discovery_run_id=$1', [runB])).rows.length, 0);
    assert.equal((await as(B, 'select * from public.discovery_results where discovery_run_id = any($1::uuid[])', [[strict, wide]])).rows.length, 0);
    assert.equal((await as(undefined, 'select count(*)::int n from public.discovery_runs').catch(() => ({rows: [{n: 0}]}))).rows[0].n, 0);
  });
} finally {
  await db.close();
}

const width = Math.max(...results.map(r => r[0].length));
for (const [name, status, detail] of results) console.log(`${status}  ${name.padEnd(width)}  ${detail}`);
const failedChecks = results.filter(r => r[1] !== 'PASS');
console.log(`\nDISCOVERY HISTORY DB: ${results.length - failedChecks.length}/${results.length} checks passed`);
if (failedChecks.length) process.exit(1);
