// V2 — Search-Until-New V1: 1 pass = 1 provider request, at most 3 per run, one discovery_run, Novelty memory.
// Orchestrator (pure, injected clock), DiscoveryService with an in-memory repository, and the Brave provider's
// one-request pass with a fake fetch. Cost/filters_json/RLS against the real schema: tests/search-until-new-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import type {Candidate,DiscoveryInput,DiscoveryProvider,DiscoveryResult,DiscoveryRun,ProviderSearchReport} from '../src/discovery/types.ts';
import type {Identity} from '../src/discovery/deduplication.ts';
import {noveltyOf,type ResultMemory} from '../src/discovery/novelty.ts';
import {buildSearchVariants,desiredNewResults,searchUntilNewTarget,MAX_PROVIDER_CALLS,PASS_TIMEOUT_MS,TIME_BUDGET_MS} from '../src/discovery/search-until-new.ts';
import {summarizeRuns,replayFields} from '../src/discovery/run-history.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {deepStopLabel,passesLabel} from '../src/i18n/format.ts';

const W = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliett','Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango','Uniform','Victor','Whiskey','Xray','Yankee','Zulu'];
const actor = (word: string): Candidate => {
 const slug = word.toLowerCase();
 return {name: `Studio ${word}`, canonical_url: `https://${slug}.example/`, website: `https://${slug}.example/`, city: null, address: null, phone: null,
  discovered_source: 'fake', source_url: `https://${slug}.example/`, source_title: `Studio ${word}`, discovery_timestamp: '2026-09-27T08:00:00.000Z', confidence: .8,
  raw_metadata: {source_class: 'COMPANY_CANDIDATE', company_name_status: 'RESOLVED', company_domain_status: 'RESOLVED', admissibility: {admissible: true}},
  deduplication_key: `domain:${slug}.example|`};
};
// A provider whose variants return scripted actor sets, counting requests like Brave's search report.
class FakeProvider implements DiscoveryProvider {
 id = 'fake'; mode = 'test' as const; lastSearch?: ProviderSearchReport;
 classic = 0; passes: string[] = []; script: Array<string[] | Error>; classicSet: string[];
 constructor(script: Array<string[] | Error>, classicSet: string[] = []) { this.script = script; this.classicSet = classicSet; }
 private report() { return this.lastSearch ??= {queries_planned: 0, requests_sent: 0, requests_failed: 0, failure_codes: [], country: 'FR', country_reason: 'default'}; }
 async searchCompanies() { this.classic++; const r = this.report(); r.queries_planned++; r.requests_sent++; return this.classicSet.map(actor); }
 async searchVariant(_input: DiscoveryInput, query: string) {
  const r = this.report(); r.queries_planned++; r.requests_sent++;
  const next = this.script[this.passes.length]; this.passes.push(query);
  if (next instanceof Error || next === undefined) { r.requests_failed++; throw next ?? Error('BRAVE_HTTP_500'); }
  return next.map(actor);
 }
 async fetchCompanyDetails(c: Candidate) { return c; }
 normalizeResult(raw: unknown) { return raw as Candidate; }
}
type Row = ResultMemory & {project_id: string};
class Store { rows: Row[] = []; runs: Array<{id: string; project_id: string; location: string}> = []; prospects: Array<{id: string; project_id: string; name: string; website: string}> = []; }
class Repo implements DiscoveryRepository {
 metrics: Record<string, unknown> = {}; starts = 0; failed = false; memoryFails = false; runId = ''; saved = 0;
 store: Store; project: string;
 constructor(store: Store, project = 'project-A') { this.store = store; this.project = project; }
 async start(input: {location: string}): Promise<DiscoveryRun> { this.starts++; this.runId = `run-${this.store.runs.length + 1}`; this.store.runs.push({id: this.runId, project_id: this.project, location: input.location}); return {id: this.runId, provider: 'fake', status: 'running', result_count: 0, error_message: null}; }
 async existing(projectId: string): Promise<Identity[]> { return this.store.prospects.filter(p => p.project_id === projectId).map(p => ({id: p.id, name: p.name, website: p.website, city: null, phone: null, address: null})); }
 async memory(projectId: string, excludeRunId: string) {
  if (this.memoryFails) throw Error('DATABASE_REQUEST_FAILED');
  return {results: this.store.rows.filter(r => r.project_id === projectId && r.discovery_run_id !== excludeRunId).slice().reverse(), runs: this.store.runs.filter(r => r.project_id === projectId).map(r => ({id: r.id, location: r.location}))};
 }
 async saveResults(run: DiscoveryRun, rows: Array<{candidate: Candidate; dedupe: {status: DiscoveryResult['dedupe_status']; duplicate_of: string | null}}>): Promise<DiscoveryResult[]> {
  this.saved += rows.length;
  return rows.map(({candidate: c, dedupe: d}, i) => {
   this.store.rows.push({id: `${run.id}-${i}`, discovery_run_id: run.id, status: 'pending', prospect_id: null, company_name: c.name, website: c.website, city: null, source_url: c.source_url, source_class: 'COMPANY_CANDIDATE', name_status: 'RESOLVED', domain_status: 'RESOLVED', project_id: this.project});
   return {id: `${run.id}-${i}`, normalized_payload: c, dedupe_status: d.status, duplicate_of: d.duplicate_of, status: 'pending', prospect_id: null, source_class: 'COMPANY_CANDIDATE'};
  });
 }
 async finish(_id: string, _n: number, metrics: Record<string, unknown>, error?: string) { this.metrics = metrics; this.failed = !!error; }
 async prospect(): Promise<never> { throw Error('unused'); }
 async projectCriteria() { return []; }
 async consumeAnalysis() {}
 async saveObservations() { return []; }
}
const INPUT = {query: 'studios sport bien-être', location: 'Ville-Test', categories: ['cours collectifs', 'coaching', 'bien-être'], max_results: 20};
async function run(repo: Repo, provider: FakeProvider, filters: Record<string, unknown> = {search_mode: 'search_new', desired_new_results: 5, max_provider_calls: 3}, meter?: (r: unknown, n: number) => Promise<void>) {
 const found = await new DiscoveryService(repo, provider, () => {}, meter as never).find_prospects({project_id: repo.project, ...INPUT, optional_filters: filters});
 const status = (word: string) => found.results.find(r => r.normalized_payload.name === `Studio ${word}`) && noveltyOf(found.results.find(r => r.normalized_payload.name === `Studio ${word}`)!.normalized_payload.raw_metadata)?.status;
 return {found, status};
}

// ---------------------------------------------------------------- modes
test('SUN-1 — mode Tous: the historical search, unchanged (one searchCompanies, no pass)', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([], ['Alpha', 'Bravo']);
 await run(repo, p, {});
 assert.equal(p.classic, 1); assert.deepEqual(p.passes, []);
 assert.equal(repo.metrics.search_mode, 'all'); assert.ok(!('stop_reason' in repo.metrics));
 await run(repo, p, {search_mode: 'all'});
 assert.equal(p.classic, 2); assert.deepEqual(p.passes, []);
});
test('SUN-2 — mode Nouveaux en priorité: Novelty only, no additional provider call', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([], ['Alpha', 'Bravo']);
 await run(repo, p, {search_mode: 'new_first'});
 assert.equal(p.classic, 1); assert.deepEqual(p.passes, []); assert.equal(p.lastSearch?.requests_sent, 1);
 assert.equal(repo.metrics.search_mode, 'new_first');
});

// ---------------------------------------------------------------- passes and stop reasons
test('SUN-3 — pass 1 reaches the target → 1 call, TARGET_REACHED', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([W.slice(0, 6)]);
 const {found} = await run(repo, p);
 assert.equal(p.passes.length, 1); assert.equal(repo.metrics.provider_calls, 1); assert.equal(repo.metrics.stop_reason, 'TARGET_REACHED');
 assert.equal(found.results.length, 6);
});
test('SUN-4 / 5 — pass 1 short → pass 2 → TARGET_REACHED', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([['Alpha', 'Bravo'], ['Charlie', 'Delta', 'Echo', 'Foxtrot']]);
 await run(repo, p);
 assert.equal(p.passes.length, 2); assert.equal(repo.metrics.stop_reason, 'TARGET_REACHED');
 assert.notEqual(p.passes[0], p.passes[1], 'the second pass is a different query');
 assert.deepEqual(repo.metrics.pass_new_results, [2, 6]);
});
test('SUN-6 — a complementary pass with 0 new (after dedup + memory) → NO_NEW_RESULTS, the third call is not spent', async () => {
 const store = new Store();
 await run(new Repo(store), new FakeProvider([], ['Kilo', 'Lima']), {}); // Kilo, Lima seen historically
 const repo = new Repo(store), p = new FakeProvider([['Alpha'], ['Alpha', 'Kilo', 'Lima'], ['Bravo']]);
 await run(repo, p);
 assert.equal(p.passes.length, 2); assert.equal(repo.metrics.stop_reason, 'NO_NEW_RESULTS');
});
test('SUN-7 — three passes needed: never more than 3 calls → MAX_PROVIDER_CALLS', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([['Alpha'], ['Bravo'], ['Charlie'], ['Delta'], ['Echo']]);
 await run(repo, p, {search_mode: 'search_new', desired_new_results: 20, max_provider_calls: 3});
 assert.equal(p.passes.length, 3); assert.equal(p.lastSearch?.requests_sent, 3); assert.equal(repo.metrics.stop_reason, 'MAX_PROVIDER_CALLS');
 assert.equal(MAX_PROVIDER_CALLS, 3);
 // Even asked for more by a forged payload, the schema refuses above 3.
 await assert.rejects(run(new Repo(new Store()), new FakeProvider([['Alpha']]), {search_mode: 'search_new', max_provider_calls: 4}));
});
test('SUN-8 / 24 — TIME_BUDGET: no new call is started once elapsed + 12 s would pass the 40 s budget', async () => {
 let clock = 0; const calls: string[] = [];
 const r = await searchUntilNewTarget<number>({variants: [{query: 'a', kind: 'plan'}, {query: 'b', kind: 'plan'}, {query: 'c', kind: 'plan'}], desiredNewResults: 10,
  now: () => clock, startedAt: 0, runPass: async v => { calls.push(v.query); clock += 15_000; return [calls.length]; }, countNew: all => all.length});
 assert.deepEqual(calls, ['a', 'b'], 'after 30 s, a third 12 s pass would end past 40 s: not started');
 assert.equal(r.stopReason, 'TIME_BUDGET');
 // Worst case of the whole run stays within the 60 s function: 3 passes × 12 s timeout ≤ 40 s budget.
 assert.ok(MAX_PROVIDER_CALLS * PASS_TIMEOUT_MS <= TIME_BUDGET_MS);
 const route = await readFile(new URL('../app/api/v1/[...path]/route.ts', import.meta.url), 'utf8');
 assert.match(route, /export const maxDuration=60;/);
 const services = await readFile(new URL('../src/discovery/services.ts', import.meta.url), 'utf8');
 assert.match(services, /searchUntilNewTarget<Candidate>\(\{[^}]*startedAt:start/, 'the budget counts from the start of the run');
});
test('SUN-8b — the loop is bounded: finite variants, hard cap, NO_MORE_VARIANTS', async () => {
 const r = await searchUntilNewTarget<number>({variants: [{query: 'only', kind: 'plan'}], desiredNewResults: 50, runPass: async () => [1], countNew: a => a.length});
 assert.deepEqual([r.providerCalls, r.stopReason], [1, 'NO_MORE_VARIANTS']);
 const src = await readFile(new URL('../src/discovery/search-until-new.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(src, /while\s*\(/, 'no open-ended loop');
});
test('SUN-9 — provider error after pass 1: pass 1 kept, run completed, PROVIDER_ERROR; pass 1 failing = failed run', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([['Alpha', 'Bravo'], Error('BRAVE_HTTP_500')]);
 const {found} = await run(repo, p);
 assert.equal(found.results.length, 2); assert.equal(repo.failed, false); assert.equal(repo.metrics.stop_reason, 'PROVIDER_ERROR');
 assert.equal(repo.metrics.search_requests_failed, 1); assert.equal(repo.metrics.provider_calls, 2);
 const repo2 = new Repo(new Store());
 await assert.rejects(run(repo2, new FakeProvider([Error('BRAVE_HTTP_500')])), /DISCOVERY_FAILED/);
 assert.equal(repo2.failed, true, 'existing failed-run behavior');
});

// ---------------------------------------------------------------- dedup and novelty
test('SUN-10 — the same actor on 3 passes → one final line, counted once as NEW', async () => {
 const repo = new Repo(new Store()), p = new FakeProvider([['Alpha'], ['Alpha', 'Bravo'], ['Alpha', 'Bravo', 'Charlie']]);
 const {found} = await run(repo, p, {search_mode: 'search_new', desired_new_results: 10});
 assert.equal(found.results.filter(r => r.normalized_payload.name === 'Studio Alpha').length, 1);
 assert.deepEqual(repo.metrics.pass_new_results, [1, 2, 3]);
 assert.equal(repo.metrics.provider_results_total, 6); assert.equal(repo.metrics.unique_candidates_total, 3);
});
test('SUN-11..14 — historical SEEN, ADDED, IGNORED and a truly NEW actor, across passes', async () => {
 const store = new Store();
 await run(new Repo(store), new FakeProvider([], ['Kilo', 'Lima', 'Mike']), {});
 store.rows.find(r => r.company_name === 'Studio Lima')!.status = 'ignored';
 store.prospects.push({id: 'p-mike', project_id: 'project-A', name: 'Studio Mike', website: 'https://mike.example/'});
 const repo = new Repo(store), p = new FakeProvider([['Kilo', 'Alpha'], ['Lima', 'Mike', 'Bravo']]);
 const {status} = await run(repo, p, {search_mode: 'search_new', desired_new_results: 2});
 assert.deepEqual(['Kilo', 'Lima', 'Mike', 'Alpha', 'Bravo'].map(status), ['SEEN', 'IGNORED', 'ADDED', 'NEW', 'NEW']);
 assert.equal(repo.metrics.stop_reason, 'TARGET_REACHED');
});
test('SUN-10b — final selection keeps max_results, new actors first', async () => {
 const store = new Store();
 await run(new Repo(store), new FakeProvider([], W.slice(0, 20)), {}); // 20 seen
 const repo = new Repo(store), p = new FakeProvider([W.slice(0, 20), W.slice(20, 26)]);
 const {found} = await run(repo, p, {search_mode: 'search_new', desired_new_results: 20});
 assert.equal(found.results.length, 20);
 assert.deepEqual(found.results.slice(0, 6).map(r => noveltyOf(r.normalized_payload.raw_metadata)?.status), Array(6).fill('NEW'));
});

// ---------------------------------------------------------------- metrics, cost, single run
test('SUN-15 / 16 / 17 — exact cumulated metrics, one metered count per run = real requests, one discovery_run', async () => {
 for (const [script, calls] of [[[W.slice(0, 6)], 1], [[['Alpha'], W.slice(1, 7)], 2], [[['Alpha'], ['Bravo'], ['Charlie']], 3]] as const) {
  const repo = new Repo(new Store()), p = new FakeProvider(script.map(s => [...s]));
  const metered: number[] = [];
  await run(repo, p, {search_mode: 'search_new', desired_new_results: 5}, async (_r, n) => { metered.push(n); });
  assert.deepEqual(metered, [calls], `ledger records exactly ${calls} request(s)`);
  assert.equal(repo.starts, 1, 'one discovery_run, whatever the number of passes');
  assert.equal(repo.metrics.provider_calls, calls); assert.equal(repo.metrics.search_passes, calls); assert.equal(repo.metrics.search_requests, calls);
  assert.equal((repo.metrics.pass_durations_ms as number[]).length, calls);
  assert.equal(repo.metrics.desired_new_results, 5);
  for (const k of ['provider', 'duration_ms', 'results', 'entities_merged', 'new_results', 'seen_results', 'already_added', 'ignored_results', 'duplicate_results', 'new_discovery_rate']) assert.ok(k in repo.metrics, k);
 }
});
test('SUN — no memory, no deep search: falls back to the normal search (never a wrong "new")', async () => {
 const repo = new Repo(new Store()); repo.memoryFails = true;
 const p = new FakeProvider([['Alpha']], ['Bravo']);
 await run(repo, p);
 assert.equal(p.classic, 1); assert.deepEqual(p.passes, []);
 assert.equal(repo.metrics.search_mode_fallback, 'novelty_unavailable');
});

// ---------------------------------------------------------------- variants, replay, history, UI
test('SUN — variants: deterministic, finite, built only from the user’s own words', () => {
 const v = buildSearchVariants(INPUT);
 assert.deepEqual(buildSearchVariants(INPUT), v, 'deterministic');
 assert.ok(v.length >= 2 && v.length <= 6);
 assert.equal(new Set(v.map(x => x.query)).size, v.length, 'no duplicate query');
 assert.ok(v.some(x => x.kind === 'category' && x.query.includes('coaching')));
 const words = new Set(`${INPUT.query} ${INPUT.location} ${INPUT.categories.join(' ')}`.toLowerCase().split(/[^\p{L}\p{N}-]+/u));
 for (const x of v) for (const w of x.query.split(' ')) assert.ok(words.has(w), `"${w}" comes from the user`);
 assert.equal(desiredNewResults(undefined, 20), 20); assert.equal(desiredNewResults(50, 20), 20); assert.equal(desiredNewResults(0, 20), 1);
});
test('SUN — anti-hardcoding: no sector, customer or place name in the Search-Until-New logic', async () => {
 const src = await readFile(new URL('../src/discovery/search-until-new.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(src, /kevin|avignon|padel|pilates|yoga|hyrox|restauration|restaurant/i);
});
test('SUN-18 / 19 — replay prefills the mode and target, never searches; history reads filters_json and metrics', async () => {
 const [s] = summarizeRuns([{id: 'r', query: 'q', location: 'Ville-Test', categories: [], provider: 'brave', status: 'completed', started_at: '2026-09-27T08:00:00Z', completed_at: null, result_count: 20,
  filters_json: {max_results: 20, search_mode: 'search_new', desired_new_results: 8, max_provider_calls: 3},
  metrics: {search_mode: 'search_new', search_passes: 3, provider_calls: 3, stop_reason: 'NO_NEW_RESULTS', desired_new_results: 8, new_results_found: 2, pass_results: [20, 20, 12], pass_new_results: [0, 2, 2], pass_durations_ms: [900, 800, 700], results_total: 20, new_results: 2, seen_results: 15, already_added: 3, ignored_results: 0, duplicate_results: 0}}], []);
 assert.deepEqual([s!.search_mode, s!.desired_new_results, s!.search?.passes, s!.search?.stop_reason], ['search_new', 8, 3, 'NO_NEW_RESULTS']);
 assert.deepEqual(replayFields(s!, true), {query: 'q', location: 'Ville-Test', categories: '', max: 20, provider: 'brave', searchMode: 'search_new', desiredNew: 8});
 assert.equal(summarizeRuns([{...s!}])[0]!.search?.passes, 3, 'kept when the panel re-reads the answer');
 const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 const replay = panel.slice(panel.indexOf(' function replay('), panel.indexOf('\n', panel.indexOf(' function replay(')));
 assert.doesNotMatch(replay, /api\(|search\(/, 'replay never launches');
 assert.equal(passesLabel('fr', 3), '3 passes de recherche');
 assert.equal(deepStopLabel('fr', 'NO_NEW_RESULTS', 0), 'Arrêt : aucun nouveau résultat supplémentaire');
 assert.equal(deepStopLabel('fr', 'TARGET_REACHED', 10), 'Objectif atteint : 10 nouveaux acteurs trouvés');
 for (const k of ['MAX_PROVIDER_CALLS', 'TIME_BUDGET', 'PROVIDER_ERROR', 'NO_MORE_VARIANTS']) assert.match(deepStopLabel('fr', k, 0), /^Arrêt : /);
});
test('SUN — UI: explicit mode choice (default Tous), target 1..max, compact status and summary', async () => {
 const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(panel, /const EMPTY_FIELDS:ReplayFields=\{[^}]*searchMode:'all',desiredNew:null\};/, 'default mode: all results');
 assert.match(panel, /<option value="search_new" disabled=\{mode==='demo'\}>/);
 assert.match(panel, /<input name="desired" type="number" min=\{1\} max=\{fields\.max\}/);
 assert.match(panel, /max_provider_calls:MAX_PROVIDER_CALLS/);
 assert.match(panel, /\{busy&&deepPending&&<p className="note deep-status" role="status">\{tr\('deep\.running'\)\}<\/p>\}/);
 assert.match(panel, /<details className="deep-detail">/, 'technical details folded');
});

// ---------------------------------------------------------------- Brave: one pass = one billed request
test('SUN — Brave searchVariant sends exactly one request per pass and accumulates the run report', async () => {
 const urls: string[] = [];
 let fail = false;
 const brave = new BraveProvider('KEY', (async (url: URL) => { urls.push(String(url)); if (fail) return new Response('{}', {status: 429}); return new Response(JSON.stringify({web: {results: [{url: `https://site-${urls.length}.example/`, title: `Site ${urls.length}`, description: 'x'}]}}), {status: 200}); }) as unknown as typeof fetch);
 const input = {project_id: 'p', query: 'q', location: 'Ville-Test', categories: [], max_results: 20, optional_filters: {}} as DiscoveryInput;
 await brave.searchVariant(input, 'studios ville-test');
 await brave.searchVariant(input, 'coaching ville-test');
 assert.equal(urls.length, 2);
 assert.equal(new URL(urls[1]!).searchParams.get('q'), 'coaching ville-test');
 fail = true;
 await assert.rejects(brave.searchVariant(input, 'x'), /BRAVE_HTTP_429/);
 assert.deepEqual([brave.lastSearch?.requests_sent, brave.lastSearch?.requests_failed], [3, 1]);
 assert.doesNotMatch(urls.join(' '), /offset=/, 'no pagination in V1');
});

// ---------------------------------------------------------------- realistic reference case (technical success only)
test('SUN-REF — saturated market (0 new · 10 seen · 3 added): real extra variants, ≤ 3 calls, dedup, memory, clean stop, cost counted', async () => {
 const store = new Store();
 const known = W.slice(0, 13);
 await run(new Repo(store), new FakeProvider([], known), {});
 for (const w of known.slice(10)) store.prospects.push({id: `p-${w}`, project_id: 'project-A', name: `Studio ${w}`, website: `https://${w.toLowerCase()}.example/`});
 // Scenario A — the market is saturated: the complementary pass only returns known actors.
 const a = new Repo(store), pa = new FakeProvider([known, [...known.slice(0, 8), 'Alpha']]);
 const metered: number[] = [];
 const {found} = await run(a, pa, {search_mode: 'search_new', desired_new_results: 20}, async (_r, n) => { metered.push(n); });
 assert.equal(pa.passes.length, 2); assert.notEqual(pa.passes[0], pa.passes[1], 'a genuinely different variant was tried');
 assert.equal(a.metrics.stop_reason, 'NO_NEW_RESULTS'); assert.deepEqual(metered, [2]);
 assert.equal(found.results.length, 13, 'the two passes merged, no duplicate line');
 assert.deepEqual([a.metrics.new_results, a.metrics.seen_results, a.metrics.already_added], [0, 10, 3]);
 // Scenario B — a variant surfaces a few new actors: kept, counted once, stop at the hard cap.
 const b = new Repo(store), pb = new FakeProvider([known, [...known.slice(0, 5), 'Xray', 'Yankee'], ['Xray', 'Zulu']]);
 await run(b, pb, {search_mode: 'search_new', desired_new_results: 20});
 assert.equal(pb.passes.length, 3); assert.equal(b.metrics.stop_reason, 'MAX_PROVIDER_CALLS');
 assert.deepEqual(b.metrics.pass_new_results, [0, 2, 3]);
 assert.equal(b.metrics.new_results, 3);
});
