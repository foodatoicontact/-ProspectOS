// Discovery run history — pure logic, API reads (fake client recording every call) and static wiring.
// Tenant isolation of the underlying rows is proven on a real database in tests/discovery-history-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeRuns, runState, replayFields, RUN_STALE_AFTER_MS, type RunSummary} from '../src/discovery/run-history.ts';
import {handleDiscovery} from '../src/discovery/api.ts';

const row = (id: string, started: string, over: Record<string, unknown> = {}) => ({id, query: 'Padel', location: 'Avignon', categories: ['padel'], provider: 'brave', filters_json: {max_results: 20, offer: 'x'}, status: 'completed', started_at: started, completed_at: started, result_count: 20, ...over});

// ---------------- Pure logic ----------------
test('1 — a project without runs: empty history', () => {
 assert.deepEqual(summarizeRuns([], []), []);
});
test('2 + 13 — several runs are listed newest first; an older run stays listed after a newer one', () => {
 const list = summarizeRuns([row('strict', '2026-09-26T15:08:00.000+00:00'), row('wide', '2026-09-26T17:08:00.000Z', {location: 'Avignon élargie'}), row('old', '2026-09-20T09:00:00Z')]);
 assert.deepEqual(list.map(r => r.id), ['wide', 'strict', 'old']);
 assert.equal(list[1].location, 'Avignon');
});
test('7 — per-run counts of results added to the project and ignored', () => {
 const [r] = summarizeRuns([row('r1', '2026-09-26T15:08:00Z')], [{discovery_run_id: 'r1', status: 'accepted'}, {discovery_run_id: 'r1', status: 'accepted'}, {discovery_run_id: 'r1', status: 'ignored'}, {discovery_run_id: 'other', status: 'accepted'}]);
 assert.equal(r.accepted_count, 2); assert.equal(r.ignored_count, 1);
 assert.equal(r.max_results, 20); assert.deepEqual(r.categories, ['padel']); assert.equal(r.provider, 'brave');
 assert.ok(!('filters_json' in r), 'the offer/ICP stored with the run is not sent back to the history');
});
test('14 + 15 — failed runs keep their status; a run still "running" is in progress, then shown interrupted', () => {
 const now = new Date('2026-09-26T17:30:00Z');
 assert.equal(runState({status: 'failed', started_at: '2026-09-26T17:00:00Z'}, now), 'failed');
 assert.equal(runState({status: 'completed', started_at: '2026-09-26T17:00:00Z'}, now), 'completed');
 assert.equal(runState({status: 'running', started_at: '2026-09-26T17:25:00Z'}, now), 'running');
 assert.equal(runState({status: 'running', started_at: new Date(now.getTime() - RUN_STALE_AFTER_MS - 1).toISOString()}, now), 'interrupted');
 assert.equal(summarizeRuns([row('f', '2026-09-26T17:00:00Z', {status: 'failed', result_count: 0})])[0].status, 'failed');
 assert.equal(summarizeRuns([row('x', '2026-09-26T17:00:00Z', {status: 'something'})])[0].status, 'running');
});
test('5 — "Rejouer" prefills query, zone, categories, max results and the provider when still available', () => {
 const [r] = summarizeRuns([row('r', '2026-09-26T17:00:00Z', {categories: ['padel', 'sport'], filters_json: {max_results: 12}})]);
 assert.deepEqual(replayFields(r, true), {query: 'Padel', location: 'Avignon', categories: 'padel, sport', max: 12, provider: 'brave'});
 assert.equal(replayFields(r, false).provider, 'fixture', 'Brave no longer configured → back to the TEST source');
 assert.equal(replayFields({...r, max_results: null}, true).max, 20);
 assert.equal(replayFields({...r, max_results: 100}, true).max, 20, 'bounded to the form limit');
});

// ---------------- API: reads only ----------------
type Call = {table?: string; op: string; args: unknown[]};
function fakeDb(tables: Record<string, unknown[]>) {
 const calls: Call[] = [];
 const builder = (table: string) => {
  const b: any = {};
  for (const op of ['select', 'eq', 'in', 'order', 'limit', 'single']) b[op] = (...args: unknown[]) => { calls.push({table, op, args}); return b; };
  for (const op of ['insert', 'update', 'upsert', 'delete']) b[op] = (...args: unknown[]) => { calls.push({table, op, args}); return b; };
  b.then = (res: (v: unknown) => unknown) => {
   const single = calls.some(c => c.table === table && c.op === 'single');
   const data = tables[table] ?? [];
   return Promise.resolve({data: single ? data[0] ?? null : data, error: null}).then(res);
  };
  return b;
 };
 const db = {from: (t: string) => { calls.push({table: t, op: 'from', args: []}); return builder(t); }, rpc: (...args: unknown[]) => { calls.push({op: 'rpc', args}); return Promise.resolve({data: null, error: null}); }};
 return {db: db as any, calls};
}
const PROJECT = '11111111-1111-4111-8111-111111111111', RUN = '22222222-2222-4222-8222-222222222222';
const get = (path: string[], db: any) => handleDiscovery(new Request(`https://x.test/api/v1/${path.join('/')}`, {method: 'GET'}), path, null, db, {id: 'user-1'});

test('history endpoint — GET projects/:id/discovery reads runs and decided results only, newest first, no provider call, no write', async (t) => {
 const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw Error('no network expected'); });
 const {db, calls} = fakeDb({discovery_runs: [row('a', '2026-09-26T15:00:00Z'), row('b', '2026-09-26T17:00:00Z')], discovery_results: [{discovery_run_id: 'a', status: 'accepted'}]});
 const res = await get(['projects', PROJECT, 'discovery'], db);
 assert.equal(res!.status, 200);
 const body = await res!.json() as RunSummary[];
 assert.deepEqual(body.map(r => [r.id, r.accepted_count]), [['b', 0], ['a', 1]]);
 assert.equal(fetchMock.mock.callCount(), 0);
 assert.deepEqual([...new Set(calls.filter(c => c.op === 'from').map(c => c.table))], ['discovery_runs', 'discovery_results']);
 assert.ok(!calls.some(c => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(c.op)), 'no write, no RPC (no quota, no run)');
 assert.ok(calls.some(c => c.table === 'discovery_runs' && c.op === 'eq' && c.args[0] === 'project_id' && c.args[1] === PROJECT));
 assert.ok(calls.some(c => c.table === 'discovery_runs' && c.op === 'order' && c.args[0] === 'started_at' && (c.args[1] as {ascending: boolean}).ascending === false));
});
test('3 + 4 — "Voir les résultats" (GET discovery-runs/:id/results) calls no provider and creates no run', async (t) => {
 const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw Error('no network expected'); });
 const {db, calls} = fakeDb({discovery_runs: [{id: RUN}], discovery_results: [{id: 'r1', status: 'accepted', prospect_id: 'p1'}]});
 const res = await get(['discovery-runs', RUN, 'results'], db);
 assert.equal(res!.status, 200);
 assert.deepEqual(await res!.json(), [{id: 'r1', status: 'accepted', prospect_id: 'p1'}]);
 assert.equal(fetchMock.mock.callCount(), 0);
 assert.ok(!calls.some(c => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(c.op)));
});
test('history endpoint — invalid project id refused before any read', async () => {
 const {db, calls} = fakeDb({});
 const res = await get(['projects', 'not-a-uuid', 'discovery'], db);
 assert.ok(res!.status >= 400);
 assert.equal(calls.length, 0);
});

// ---------------- Static wiring ----------------
const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const fn = (src: string, name: string) => { const i = src.indexOf(name); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n', src.indexOf('})}', i)) + 1); };
test('3 + 6 — viewing a run and replaying a run never search: GET only for "Voir", form fill only for "Rejouer"', () => {
 const view = fn(panel, 'async function viewRun(');
 assert.match(view, /api\(`discovery-runs\/\$\{summary\.id\}\/results`\)/);
 assert.doesNotMatch(view, /'POST'|\/discovery`,'POST'|search\(/);
 const replay = panel.slice(panel.indexOf('function replay('), panel.indexOf('function openProspect('));
 assert.doesNotMatch(replay, /api\(|search\(|requestSubmit|submit\(/);
 assert.match(replay, /setFields\(f\)/);
 // The only POST to the discovery route stays inside search(), which only the form's submit calls.
 assert.equal((panel.match(/\/discovery`,'POST'/g) ?? []).length, 1);
 assert.match(panel, /onSubmit=\{e=>\{e\.preventDefault\(\);search\(new FormData\(e\.currentTarget\)\)\}\}/);
 const effect = panel.slice(panel.indexOf('useEffect(()=>{version.current++'), panel.indexOf('async function loadHistory'));
 assert.doesNotMatch(effect, /search\(|'POST'/, 'opening the screen never runs a search');
});
test('7 + 8 — an accepted candidate shows "Ajouté au projet" and "Voir le prospect" instead of an add button', () => {
 assert.match(panel, /r\.status==='accepted'\?tr\('discovery\.addedToProject'\)/);
 assert.match(panel, /r\.status==='accepted'&&r\.prospect_id&&onOpenProspect&&<button className="text-button" onClick=\{\(\)=>openProspect\(r\.prospect_id!\)\}>\{tr\('discovery\.viewProspect'\)\}/);
 assert.match(panel, /r\.status==='pending'\?<><button disabled=\{busy\} className="primary" onClick=\{\(\)=>accept/, 'the add button exists only for pending results');
});
test('9 — navigation: the open run is kept per project and restored; back returns to Discovery', () => {
 assert.match(page, /activeRunId=\{discoveryRuns\[projectId\]\?\?null\}/);
 assert.match(page, /onOpenProspect=\{openFromDiscovery\}/);
 // History entries come from the pure planner (tests/discovery-back-navigation.test.ts); popstate restores from the entry's state.
 assert.match(page, /function openFromDiscovery\(prospectId:string\)\{applyHistory\(planOpenProspect\(history\.state,projectId,discoveryRuns\[projectId\]\?\?null,prospectId\)\)/);
 assert.match(page, /const onPop=\(e:PopStateEvent\)=>restoreRef\.current\(e\.state\);window\.addEventListener\('popstate',onPop\)/);
 assert.match(page, /\{fromDiscovery&&<button className="text-button back-to-discovery" onClick=\{backToDiscovery\}>/);
 assert.match(panel, /if\(summary\)void viewRun\(summary,true\)/, 'the remembered run is reopened with its scroll position');
});
test('7 — an added candidate shows its prospect\'s current score from the existing engine; others keep 0/100', () => {
 assert.match(panel, /if\(r\.status!=='accepted'\|\|!r\.prospect_id\)return null;const p=existing\.find\(x=>x\.id===r\.prospect_id\);if\(!p\)return null;try\{return scoreProspect\(criteria,p\.evidence\)\.score\}/);
 assert.match(panel, /\{tr\('discovery\.currentScore'\)\} <b>0\/100<\/b>/);
});
