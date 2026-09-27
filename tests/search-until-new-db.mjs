// V2 — Search-Until-New V1 against the REAL schema (PGlite, full migration chain, RLS as `authenticated`).
// No migration: the chosen mode lives in discovery_runs.filters_json, the cumulated pass metrics in
// discovery_runs.metrics (jsonb, arrays included), the exact cost comes from the existing ledger pricing
// (resolve_provider_cost, one Brave request = one priced unit), and one run stays one discovery_runs row.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { summarizeRuns, replayFields } from '../src/discovery/run-history.ts';

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

  const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1';
  const OA = '10000000-0000-4000-8000-0000000000a1', OB = '10000000-0000-4000-8000-0000000000b1';
  const PA1 = '20000000-0000-4000-8000-0000000000a1', PA2 = '20000000-0000-4000-8000-0000000000a2', PB = '20000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA, A, OB, B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'A1'),($3,$2,'A2'),($4,$5,'B')`, [PA1, OA, PA2, PB, OB]);

  // The server's call, exactly: optional_filters (with the user's search mode) becomes p_filters.
  const filters = {provider: 'brave', search_mode: 'search_new', desired_new_results: 8, max_provider_calls: 3};
  const runsBefore = Number((await sql(`select count(*) n from public.discovery_runs`)).rows[0].n);
  const run = (await as(A, `select public.start_discovery($1,'studios sport','Ville-Test','[]','brave',20,$2::jsonb) run`, [PA1, JSON.stringify(filters)])).rows[0].run;
  const metrics = {provider: 'brave', duration_ms: 2400, search_requests: 3, search_requests_failed: 0, results: 20, search_mode: 'search_new',
    provider_calls: 3, search_passes: 3, provider_results_total: 52, unique_candidates_total: 31, desired_new_results: 8, new_results_found: 2, stop_reason: 'MAX_PROVIDER_CALLS',
    pass_durations_ms: [900, 800, 700], pass_results: [20, 20, 12], pass_new_results: [0, 1, 2], pass_kinds: ['plan', 'plan', 'category'],
    results_total: 20, new_results: 2, seen_results: 15, already_added: 3, ignored_results: 0, duplicate_results: 0, new_discovery_rate: .1, repeat_rate: .9};
  // repository.finish, with the member's own client (RLS policy discovery_runs_update).
  await as(A, `update public.discovery_runs set status='completed',result_count=20,completed_at=now(),metrics=$2::jsonb where id=$1`, [run.id, JSON.stringify(metrics)]);

  await check('SUN-DB-1 filters_json keeps the search mode, target and cap (replayable), next to max_results', async () => {
    const f = (await as(A, `select filters_json from public.discovery_runs where id=$1`, [run.id])).rows[0].filters_json;
    assert.deepEqual([f.search_mode, f.desired_new_results, f.max_provider_calls, f.max_results], ['search_new', 8, 3, 20]);
  });
  await check('SUN-DB-2 cumulated pass metrics (arrays included) fit the existing metrics jsonb and reach history + replay', async () => {
    const row = (await as(A, `select id,query,location,categories,provider,filters_json,status,started_at,completed_at,result_count,metrics from public.discovery_runs where id=$1`, [run.id])).rows[0];
    assert.deepEqual(row.metrics.pass_durations_ms, [900, 800, 700]);
    const [s] = summarizeRuns([row], []);
    assert.deepEqual([s.search.passes, s.search.provider_calls, s.search.stop_reason, s.novelty.new_results], [3, 3, 'MAX_PROVIDER_CALLS', 2]);
    assert.deepEqual([replayFields(s, true).searchMode, replayFields(s, true).desiredNew], ['search_new', 8]);
  });
  await check('SUN-DB-3 one deep search = one discovery_runs row (and one quota unit), whatever the passes', async () => {
    assert.equal(Number((await sql(`select count(*) n from public.discovery_runs`)).rows[0].n), runsBefore + 1);
    assert.equal(Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and action='discovery'`, [OA])).rows[0].n), 1);
  });
  await check('SUN-DB-4 exact cost from the existing pricing: 1 / 2 / 3 requests = 0.005 / 0.010 / 0.015 $', async () => {
    for (const [n, micros] of [[1, 5000], [2, 10000], [3, 15000]]) {
      // As the server-side admin (like tests/discovery-cost-byok-db.mjs): the pricing RPC is revoked from client roles.
      const cost = (await sql(`select public.resolve_provider_cost('brave','search',null,$1::jsonb) c`, [JSON.stringify([{unit_type: 'request', quantity: n}])])).rows[0].c;
      assert.equal(Number(cost.estimated_cost_micros), micros, `${n} request(s)`);
    }
  });
  await check('SUN-DB-5 RLS tenant: a member of B reads neither the run, its filters nor its metrics', async () => {
    assert.equal((await as(B, `select id from public.discovery_runs where id=$1`, [run.id])).rows.length, 0);
    await as(B, `update public.discovery_runs set metrics='{}'::jsonb where id=$1`, [run.id]);
    assert.equal((await as(A, `select metrics->>'stop_reason' s from public.discovery_runs where id=$1`, [run.id])).rows[0].s, 'MAX_PROVIDER_CALLS', 'B cannot overwrite A’s metrics');
  });
  await check('SUN-DB-6 RLS project: the history of project A2 does not list A1’s deep run', async () => {
    assert.equal((await as(A, `select id from public.discovery_runs where project_id=$1`, [PA2])).rows.length, 0);
    assert.equal((await as(B, `select id from public.discovery_runs where project_id=$1`, [PB])).rows.length, 0);
  });
  await check('SUN-DB-7 no schema change: no migration mentions the search modes', async () => {
    for (const f of migrations) assert.doesNotMatch(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'), /search_new|search_mode|stop_reason/i, f);
  });
} catch (error) {
  results.push(['setup', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}

for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} search-until-new DB checks passed`);
if (failed.length) process.exit(1);
