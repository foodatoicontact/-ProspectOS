// V2 P0-C — Novelty engine against the REAL schema (PGlite, full migration chain, RLS as `authenticated`).
// The project memory is read exactly as SupabaseDiscoveryRepository.memory reads it (same columns, same
// project filter, user's RLS-scoped role) and classified by the same engine. Proves, with no migration:
//  - the novelty snapshot and the run counters fit in the existing jsonb columns (normalized_payload, metrics);
//  - project isolation and tenant isolation (RLS) of the memory;
//  - ADDED after accept_discovery_result, IGNORED after ignore_discovery_result.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ProjectNovelty, currentProjectStatuses, alreadyAddedProspect } from '../src/discovery/novelty-engine.ts';
import { noveltyCounts, noveltyRates, noveltyOf, displayNovelty } from '../src/discovery/novelty.ts';
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

  const ZONE = 'Ville-Test';
  const start = async (user, project) => (await as(user, `select public.start_discovery($1,'studios sport',$2,'[]','brave',20,'{}') run`, [project, ZONE])).rows[0].run.id;
  const candidate = word => ({name: `Studio ${word}`, website: `https://${word.toLowerCase()}.example/`, phone: null, city: null, source_url: `https://${word.toLowerCase()}.example/`,
    raw_metadata: {source_class: 'COMPANY_CANDIDATE', company_name_status: 'RESOLVED', company_domain_status: 'RESOLVED'}});
  // SupabaseDiscoveryRepository.memory, as SQL: same columns, same project filter, newest first, the caller's role.
  const memory = async (user, project, runId) => ({
    results: (await as(user, `select id,discovery_run_id,status,prospect_id,company_name,website,phone,city,source_url,source_class,
      normalized_payload->'raw_metadata'->>'company_name_status' as name_status,normalized_payload->'raw_metadata'->>'company_domain_status' as domain_status
      from public.discovery_results where project_id=$1 and discovery_run_id<>$2 order by created_at desc, id limit 1000`, [project, runId])).rows,
    runs: (await as(user, `select id,location from public.discovery_runs where project_id=$1 order by started_at desc, id limit 1000`, [project])).rows,
  });
  const prospects = async (user, project) => (await as(user, `select id,name,website,city from public.prospects where project_id=$1`, [project])).rows;
  // One run the way DiscoveryService does it: read memory once, classify in memory, save through the
  // privileged RPC with the snapshot in normalized_payload, finish with the counters in metrics.
  async function discover(user, project, words) {
    const runId = await start(user, project);
    const engine = new ProjectNovelty({...(await memory(user, project, runId)), prospects: await prospects(user, project)}, ZONE);
    const rows = words.map(w => { const c = candidate(w); const novelty = engine.classify(c); return {c, novelty}; });
    const saved = (await asService(`select * from public.save_discovery_results($1,$2,$3::jsonb)`, [user, runId, JSON.stringify(rows.map(({c, novelty}) => ({
      company_name: c.name, website: c.website, phone: null, address: null, city: null, source_url: c.source_url, source_title: c.name,
      raw_payload: {...c.raw_metadata, novelty}, normalized_payload: {...c, raw_metadata: {...c.raw_metadata, novelty}},
      dedupe_key: `domain:${new URL(c.website).hostname}|`, dedupe_status: 'unique', duplicate_of: null, reason: 'test', source_class: 'COMPANY_CANDIDATE'})))])).rows;
    const counts = noveltyCounts(rows.map(r => r.novelty));
    await as(user, `update public.discovery_runs set status='completed',result_count=$2,completed_at=now(),metrics=$3::jsonb where id=$1`, [runId, saved.length, JSON.stringify({provider: 'brave', results: saved.length, ...counts, ...noveltyRates(counts)})]);
    return {runId, saved, status: Object.fromEntries(rows.map(r => [r.c.name.replace('Studio ', ''), r.novelty.status]))};
  }

  const first = await discover(A, PA1, ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
  await check('DB-1 first run of project A1 → every actor NEW, snapshot stored in normalized_payload (no new column)', async () => {
    assert.deepEqual(Object.values(first.status), ['NEW', 'NEW', 'NEW', 'NEW', 'NEW']);
    const stored = (await as(A, `select normalized_payload->'raw_metadata'->'novelty'->>'status' s from public.discovery_results where discovery_run_id=$1`, [first.runId])).rows;
    assert.deepEqual(stored.map(r => r.s), ['NEW', 'NEW', 'NEW', 'NEW', 'NEW']);
  });

  // Decisions on the first run, through the real RPCs.
  await as(A, `select public.accept_discovery_result($1,false)`, [first.saved[0].id]); // Alpha → prospect
  await as(A, `select public.ignore_discovery_result($1)`, [first.saved[1].id]);        // Bravo → ignored

  const second = await discover(A, PA1, ['Alpha', 'Bravo', 'Charlie', 'Foxtrot', 'Golf', 'Hotel']);
  await check('DB-2 second run, same project: ADDED (accepted) · IGNORED · SEEN · NEW, from the real rows and RPCs', () => {
    assert.deepEqual(second.status, {Alpha: 'ADDED', Bravo: 'IGNORED', Charlie: 'SEEN', Foxtrot: 'NEW', Golf: 'NEW', Hotel: 'NEW'});
  });
  await check('DB-3 run counters live in discovery_runs.metrics (existing jsonb) and reach the history summary', async () => {
    const run = (await as(A, `select id,query,location,categories,provider,filters_json,status,started_at,completed_at,result_count,metrics from public.discovery_runs where id=$1`, [second.runId])).rows[0];
    assert.equal(run.metrics.provider, 'brave', 'existing metrics kept');
    assert.deepEqual(summarizeRuns([run], [])[0].novelty, {results_total: 6, new_results: 3, seen_results: 1, already_added: 1, ignored_results: 1, duplicate_results: 0});
    assert.equal(run.metrics.new_discovery_rate, .5);
  });
  await check('DB-4 the earlier run is unchanged by the later one (its snapshot still says NEW)', async () => {
    const s = (await as(A, `select normalized_payload->'raw_metadata'->'novelty'->>'status' s from public.discovery_results where id=$1`, [first.saved[2].id])).rows[0].s;
    assert.equal(s, 'NEW');
  });

  const other = await discover(A, PA2, ['Alpha', 'Bravo', 'Charlie']);
  await check('DB-5 project isolation: same organization, another project → NEW', () => {
    assert.deepEqual(Object.values(other.status), ['NEW', 'NEW', 'NEW']);
  });
  const tenant = await discover(B, PB, ['Alpha', 'Bravo', 'Charlie']);
  await check('DB-6 tenant isolation: another organization → NEW', () => {
    assert.deepEqual(Object.values(tenant.status), ['NEW', 'NEW', 'NEW']);
  });
  await check('DB-7 RLS: a member of B reading A’s project memory gets nothing — even naming A’s project id', async () => {
    const leaked = await memory(B, PA1, '00000000-0000-4000-8000-000000000000');
    assert.equal(leaked.results.length, 0); assert.equal(leaked.runs.length, 0);
    assert.equal((await prospects(B, PA1)).length, 0);
  });
  await check('DB-8 no schema change: discovery tables keep their columns (novelty uses jsonb only)', async () => {
    const cols = (await sql(`select table_name, count(*)::int n from information_schema.columns where table_schema='public' and table_name in ('discovery_runs','discovery_results') group by table_name order by table_name`)).rows;
    const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) assert.doesNotMatch(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'), /novelty/i, `no migration for novelty (${f})`);
    assert.ok(cols.length === 2);
  });

  // ---- Final hardening 1: an old run shows where its actors stand NOW; its snapshot and metrics never change.
  const runRow = async id => (await as(A, `select * from public.discovery_results where discovery_run_id=$1 order by created_at`, [id])).rows;
  const prospectsNow = async project => (await as(A, `select id,name,website,city,discovery_dedupe_key from public.prospects where project_id=$1`, [project])).rows;
  const metricsBefore = (await as(A, `select metrics from public.discovery_runs where id=$1`, [second.runId])).rows[0].metrics;
  // Charlie is SEEN in run 2; it is then added to the project from ANOTHER run (run 3).
  const third = await discover(A, PA1, ['Charlie']);
  await as(A, `select public.accept_discovery_result($1,false)`, [third.saved[0].id]);
  await check('HARD-1 old run reopened: snapshot still SEEN, current status ADDED with the prospect, metrics untouched', async () => {
    const rows = await runRow(second.runId);
    const charlie = rows.find(r => r.company_name === 'Studio Charlie');
    assert.equal(noveltyOf(charlie.normalized_payload.raw_metadata).status, 'SEEN', 'historical snapshot kept');
    const now = currentProjectStatuses(rows, await prospectsNow(PA1));
    const prospect = (await prospectsNow(PA1)).find(p => p.website === 'https://charlie.example/');
    assert.deepEqual(now.get(charlie.id), {status: 'ADDED', prospect_id: prospect.id});
    const shown = displayNovelty(noveltyOf(charlie.normalized_payload.raw_metadata), now.get(charlie.id));
    assert.deepEqual([shown.status, shown.prospect_id], ['ADDED', prospect.id], 'UI: "Déjà ajouté" + "Voir le prospect", no "Ajouter"');
    assert.deepEqual((await as(A, `select metrics from public.discovery_runs where id=$1`, [second.runId])).rows[0].metrics, metricsBefore, 'run metrics never rewritten');
    assert.equal(now.get(rows.find(r => r.company_name === 'Studio Foxtrot').id), null, 'an actor still not in the project keeps its snapshot');
  });

  // ---- Final hardening 2: two tabs, one actor. Tab 1 adds it; tab 2 (stale screen) tries again.
  const tab1 = await discover(A, PA1, ['Kilo']);
  const tab2 = await discover(A, PA1, ['Kilo']);
  // Same organization reached with another zone part in its dedupe key: the RPC alone would create a second prospect.
  await sql(`update public.discovery_results set dedupe_key='domain:kilo.example|autre-zone' where id=$1`, [tab2.saved[0].id]);
  await as(A, `select public.accept_discovery_result($1,false)`, [tab1.saved[0].id]);
  await check('HARD-2 race: the stale second "Ajouter" is refused with the existing prospect — one prospect, never two', async () => {
    const identity = (await as(A, `select dedupe_status,dedupe_key,company_name,website,phone,city,source_url,source_class from public.discovery_results where id=$1`, [tab2.saved[0].id])).rows[0];
    const prospects = await prospectsNow(PA1);
    const existing = prospects.find(p => p.website === 'https://kilo.example/');
    assert.equal(alreadyAddedProspect(identity, identity.source_class, prospects, false), existing.id, 'server answers 409 ALREADY_ADDED with this prospect');
    assert.equal(alreadyAddedProspect(identity, identity.source_class, prospects, true), existing.id, '"Ajouter séparément" is refused too');
    // Without the guard, the database RPC would indeed have created a duplicate (rolled back).
    await sql('begin');
    try {
      await as(A, `select public.accept_discovery_result($1,false)`, [tab2.saved[0].id]);
      assert.equal((await prospectsNow(PA1)).filter(p => p.website === 'https://kilo.example/').length, 2, 'the guard is what prevents the duplicate');
    } finally { await sql('rollback'); }
    assert.equal((await prospectsNow(PA1)).filter(p => p.website === 'https://kilo.example/').length, 1);
    // Once reconciled, the stale row reads as ADDED with that prospect.
    const now = currentProjectStatuses(await runRow(tab2.runId), prospects);
    assert.deepEqual(now.get(tab2.saved[0].id), {status: 'ADDED', prospect_id: existing.id});
  });
} catch (error) {
  results.push(['setup', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}

for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} novelty DB checks passed`);
if (failed.length) process.exit(1);
