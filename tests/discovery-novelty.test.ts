// V2 P0-C — Novelty engine: NEW / SEEN / ADDED / IGNORED / CURRENT_RUN_DUPLICATE against the PROJECT's memory.
// B18 1–15 plus the Kevin example (B13). Pure module + DiscoveryService with an in-memory repository that
// behaves like the real one (project-scoped memory, newest first). RLS isolation is covered in
// tests/discovery-novelty-db.mjs against the real schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import type {Candidate,DiscoveryProvider,DiscoveryResult,DiscoveryRun} from '../src/discovery/types.ts';
import type {Identity} from '../src/discovery/deduplication.ts';
import {noveltyCounts,noveltyRates,noveltyOf,newFirst,type Novelty,type ResultMemory} from '../src/discovery/novelty.ts';
import {ProjectNovelty,strongProspectMatch,entityKey,compatibleLocation} from '../src/discovery/novelty-engine.ts';
import {summarizeRuns,replayFields} from '../src/discovery/run-history.ts';
import {runNoveltyLabel,noveltySummaryLabel} from '../src/i18n/format.ts';

const WORDS = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliett','Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango','Uniform','Victor','Whiskey','Xray','Yankee','Zulu'];
function actor(word: string, over: Partial<Candidate> = {}): Candidate {
 const slug = word.toLowerCase();
 return {name: `Studio ${word}`, canonical_url: `https://${slug}.example/`, website: `https://${slug}.example/`, city: null, address: null, phone: null,
  discovered_source: 'fake', source_url: `https://${slug}.example/`, source_title: `Studio ${word}`, discovery_timestamp: '2026-09-27T08:00:00.000Z', confidence: .8,
  raw_metadata: {source_class: 'COMPANY_CANDIDATE', company_name_status: 'RESOLVED', company_domain_status: 'RESOLVED', admissibility: {admissible: true}},
  deduplication_key: `domain:${slug}.example|`, ...over};
}
class FakeProvider implements DiscoveryProvider {
 id = 'fake'; mode = 'test' as const; calls = 0; next: Candidate[] = [];
 async searchCompanies() { this.calls++; return this.next; }
 async fetchCompanyDetails(c: Candidate) { return c; }
 normalizeResult(raw: unknown) { return raw as Candidate; }
}
type Row = ResultMemory & {project_id: string; organization_id: string; normalized_payload: Candidate};
// One shared store for every organization and project, like the database; memory() is project-scoped like
// SupabaseDiscoveryRepository.memory (whose RLS scoping the DB test covers).
class Store {
 rows: Row[] = []; runs: Array<{id: string; project_id: string; organization_id: string; location: string}> = [];
 prospects: Array<{id: string; project_id: string; name: string; website: string | null; city: string | null}> = [];
 accept(resultId: string) { const r = this.rows.find(x => x.id === resultId)!; const id = `prospect-${this.prospects.length + 1}`; this.prospects.push({id, project_id: r.project_id, name: r.company_name, website: r.website, city: r.city}); r.status = 'accepted'; r.prospect_id = id; return id; }
 ignore(resultId: string) { this.rows.find(x => x.id === resultId)!.status = 'ignored'; }
}
class Repo implements DiscoveryRepository {
 metrics: Record<string, unknown> = {}; memoryCalls = 0; failMemory = false; runId = '';
 store: Store; project: string; org: string;
 constructor(store: Store, project: string, org: string) { this.store = store; this.project = project; this.org = org; }
 async start(input: {location: string}): Promise<DiscoveryRun> { this.runId = `run-${this.store.runs.length + 1}`; this.store.runs.push({id: this.runId, project_id: this.project, organization_id: this.org, location: input.location}); return {id: this.runId, provider: 'fake', status: 'running', result_count: 0, error_message: null}; }
 async existing(projectId: string): Promise<Identity[]> { return this.store.prospects.filter(p => p.project_id === projectId).map(p => ({id: p.id, name: p.name, website: p.website, city: p.city, phone: null, address: null})); }
 async memory(projectId: string, excludeRunId: string) {
  this.memoryCalls++; if (this.failMemory) throw Error('DATABASE_REQUEST_FAILED');
  return {results: this.store.rows.filter(r => r.project_id === projectId && r.discovery_run_id !== excludeRunId).slice().reverse(), runs: this.store.runs.filter(r => r.project_id === projectId).map(r => ({id: r.id, location: r.location})).reverse()};
 }
 async saveResults(run: DiscoveryRun, rows: Array<{candidate: Candidate; dedupe: {status: DiscoveryResult['dedupe_status']; duplicate_of: string | null}}>): Promise<DiscoveryResult[]> {
  return rows.map(({candidate: c, dedupe: d}) => {
   const row: Row = {id: `${run.id}-r${this.store.rows.length + 1}`, discovery_run_id: run.id, status: 'pending', prospect_id: null, company_name: c.name, website: c.website, phone: c.phone, city: c.city, source_url: c.source_url, source_class: 'COMPANY_CANDIDATE', name_status: 'RESOLVED', domain_status: c.website ? 'RESOLVED' : 'UNRESOLVED', project_id: this.project, organization_id: this.org, normalized_payload: c};
   this.store.rows.push(row);
   return {id: row.id, normalized_payload: c, dedupe_status: d.status, duplicate_of: d.duplicate_of, status: 'pending', prospect_id: null, source_class: 'COMPANY_CANDIDATE'};
  });
 }
 async finish(_id: string, _n: number, metrics: Record<string, unknown>) { this.metrics = metrics; }
 async prospect(): Promise<never> { throw Error('unused'); }
 async projectCriteria() { return []; }
 async consumeAnalysis() {}
 async saveObservations() { return []; }
}
async function run(repo: Repo, provider: FakeProvider, actors: Candidate[], location = 'Ville-Test') {
 provider.next = actors;
 const found = await new DiscoveryService(repo, provider).find_prospects({project_id: repo.project, query: 'studios sport', location, categories: [], max_results: 20});
 const byName = new Map(found.results.map(r => [r.normalized_payload.name, noveltyOf(r.normalized_payload.raw_metadata)!]));
 return {found, byName, status: (word: string) => byName.get(`Studio ${word}`)?.status};
}
const setup = (project = 'project-A', org = 'org-A', store = new Store()) => ({store, repo: new Repo(store, project, org), provider: new FakeProvider()});

test('B18-1 — first run: 20 actors never seen → 20 NEW, counters and ratios in the run metrics', async () => {
 const {repo, provider} = setup();
 const {found} = await run(repo, provider, WORDS.slice(0, 20).map(w => actor(w)));
 assert.equal(found.results.length, 20);
 assert.ok(found.results.every(r => noveltyOf(r.normalized_payload.raw_metadata)?.status === 'NEW'));
 assert.deepEqual({t: repo.metrics.results_total, n: repo.metrics.new_results, s: repo.metrics.seen_results, a: repo.metrics.already_added, i: repo.metrics.ignored_results, d: repo.metrics.duplicate_results}, {t: 20, n: 20, s: 0, a: 0, i: 0, d: 0});
 assert.equal(repo.metrics.new_discovery_rate, 1); assert.equal(repo.metrics.repeat_rate, 0);
 // Existing metrics untouched.
 for (const k of ['provider', 'duration_ms', 'results', 'normalization_rejected', 'entities_merged', 'ai_tokens', 'ai_cost_estimate']) assert.ok(k in repo.metrics, k);
});

test('B18-2 — second run: 10 identical + 10 new → 10 SEEN (pointing to the earlier run) + 10 NEW', async () => {
 const {repo, provider} = setup();
 await run(repo, provider, WORDS.slice(0, 20).map(w => actor(w)));
 const first = repo.runId;
 const {status, byName} = await run(repo, provider, [...WORDS.slice(0, 10), ...WORDS.slice(20, 26), 'Ares', 'Borea', 'Cyrus', 'Dorian'].map(w => actor(w)));
 assert.equal(WORDS.slice(0, 10).filter(w => status(w) === 'SEEN').length, 10);
 assert.equal([...byName.values()].filter(n => n.status === 'NEW').length, 10);
 assert.equal(byName.get('Studio Alpha')!.run_id, first, '"Voir l’ancien run" targets the run where it was seen');
 assert.equal(repo.metrics.seen_results, 10); assert.equal(repo.metrics.new_results, 10);
 assert.equal(repo.metrics.new_discovery_rate, .5); assert.equal(repo.metrics.repeat_rate, .5);
});

test('B18-3 / 4 — an actor added earlier → ADDED (with its prospect); ignored earlier → IGNORED', async () => {
 const {store, repo, provider} = setup();
 const {found} = await run(repo, provider, ['Alpha', 'Bravo', 'Charlie'].map(w => actor(w)));
 const prospectId = store.accept(found.results[0]!.id);
 store.ignore(found.results[1]!.id);
 const {byName} = await run(repo, provider, ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(w => actor(w)));
 assert.deepEqual([byName.get('Studio Alpha')!.status, byName.get('Studio Alpha')!.prospect_id], ['ADDED', prospectId]);
 assert.equal(byName.get('Studio Bravo')!.status, 'IGNORED');
 assert.equal(byName.get('Studio Charlie')!.status, 'SEEN');
 assert.equal(byName.get('Studio Delta')!.status, 'NEW');
});

test('B18-5 — same domain, slightly different name → the same actor', async () => {
 const {repo, provider} = setup();
 await run(repo, provider, [actor('Alpha')]);
 const {byName} = await run(repo, provider, [actor('Alpha', {name: 'Studio Alpha Centre', source_url: 'https://alpha.example/contact'})]);
 const n = [...byName.values()][0]!;
 assert.deepEqual([n.status, n.basis], ['SEEN', 'domain']);
});

test('B18-6 — same name, different domains → never merged without proof', async () => {
 const {repo, provider} = setup();
 await run(repo, provider, [actor('Alpha')]);
 const {byName} = await run(repo, provider, [actor('Alpha', {website: 'https://alpha-other.example/', canonical_url: 'https://alpha-other.example/', source_url: 'https://alpha-other.example/'})]);
 assert.equal([...byName.values()][0]!.status, 'NEW');
});

test('B2 — a name alone never identifies an actor: name + compatible location only, never a weak similarity', () => {
 const memory = {prospects: [], runs: [{id: 'r1', location: 'Ville-Test'}], results: [
  {id: 'x1', discovery_run_id: 'r1', status: 'pending', prospect_id: null, company_name: 'Studio Orion', website: null, city: null, source_url: 'https://annuaire.example/orion', source_class: 'COMPANY_CANDIDATE', name_status: 'RESOLVED', domain_status: 'UNRESOLVED'},
 ] as ResultMemory[]};
 const subject = (name: string, source: string) => ({name, website: null, city: null, source_url: source, raw_metadata: {source_class: 'COMPANY_CANDIDATE', company_name_status: 'RESOLVED', company_domain_status: 'UNRESOLVED'}});
 assert.equal(new ProjectNovelty(memory, 'Ville-Test').classify(subject('Studio Orion', 'https://blog.example/a')).status, 'SEEN', 'same canonical name + same zone');
 assert.equal(new ProjectNovelty(memory, 'Autre-Ville').classify(subject('Studio Orion', 'https://blog.example/a')).status, 'NEW', 'same name, another zone');
 assert.equal(new ProjectNovelty(memory, 'Ville-Test').classify(subject('Studio Orio', 'https://blog.example/b')).status, 'NEW', 'a similar name is not the same actor');
 // An unresolved page (directory, article) is only "the same" as the very same page.
 const page = {name: 'Les meilleurs studios', website: null, city: null, source_url: 'https://annuaire.example/orion#top', raw_metadata: {source_class: 'SIGNAL_SOURCE'}};
 assert.equal(new ProjectNovelty(memory, 'Ville-Test').classify(page).status, 'SEEN');
 assert.ok(compatibleLocation('Ville-Test', 'Ville-Test et communes limitrophes'));
 assert.ok(!compatibleLocation('Ville-Test', null));
});

test('B2 — a directory domain never identifies an actor (only a resolved organization’s own site)', () => {
 const memory = {prospects: [], runs: [], results: [{id: 'x', discovery_run_id: 'r1', status: 'pending', prospect_id: null, company_name: 'Annuaire', website: 'https://annuaire.example/', city: null, source_url: 'https://annuaire.example/a', source_class: 'SIGNAL_SOURCE', name_status: 'UNRESOLVED', domain_status: 'UNRESOLVED'}] as ResultMemory[]};
 const n = new ProjectNovelty(memory).classify({name: 'Studio Zed', website: 'https://annuaire.example/', city: null, source_url: 'https://annuaire.example/b', raw_metadata: {source_class: 'COMPANY_CANDIDATE', company_name_status: 'RESOLVED', company_domain_status: 'RESOLVED'}});
 assert.equal(n.status, 'NEW');
});

test('B18-7 / 8 — project and tenant isolation: seen in project A (org A) → still NEW in project B and in org B', async () => {
 const store = new Store();
 const a = setup('project-A', 'org-A', store);
 await run(a.repo, a.provider, WORDS.slice(0, 5).map(w => actor(w)));
 const b = setup('project-B', 'org-A', store);
 const sameOrg = await run(b.repo, b.provider, WORDS.slice(0, 5).map(w => actor(w)));
 assert.ok([...sameOrg.byName.values()].every(n => n.status === 'NEW'), 'another project of the same organization');
 const c = setup('project-C', 'org-B', store);
 const otherOrg = await run(c.repo, c.provider, WORDS.slice(0, 5).map(w => actor(w)));
 assert.ok([...otherOrg.byName.values()].every(n => n.status === 'NEW'), 'another organization');
 // The repository reads the memory with the project filter (and the user's RLS-scoped client).
 const repo = await readFile(new URL('../src/discovery/repository.ts', import.meta.url), 'utf8');
 const mem = repo.slice(repo.indexOf('async memory('), repo.indexOf('async saveResults('));
 assert.match(mem, /this\.db\.from\('discovery_results'\)[^;]*\.eq\('project_id',projectId\)\.neq\('discovery_run_id',excludeRunId\)/);
 assert.match(mem, /this\.db\.from\('discovery_runs'\)[^;]*\.eq\('project_id',projectId\)/);
 assert.doesNotMatch(mem, /writer|service_role|createAdminClient/, 'never the privileged client for reading memory');
});

test('B18-9 — replaying a search only prefills the form: no run, no provider call', async () => {
 const summary = summarizeRuns([{id: 'r', query: 'studios', location: 'Ville-Test', categories: [], provider: 'brave', status: 'completed', started_at: '2026-09-26T08:00:00Z', completed_at: null, result_count: 20}])[0]!;
 assert.deepEqual(replayFields(summary, true), {query: 'studios', location: 'Ville-Test', categories: '', max: 20, provider: 'brave'});
 const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 const replay = panel.slice(panel.indexOf(' function replay('), panel.indexOf('\n', panel.indexOf(' function replay(')));
 assert.doesNotMatch(replay, /api\(|search\(|find_prospects/);
});

test('B18-10 / B14 — an already added actor never becomes a second prospect', async () => {
 // Server guard at "Ajouter": same own domain / phone as a prospect → 409 ALREADY_ADDED with that prospect.
 assert.equal(strongProspectMatch({name: 'Studio Alpha bis', website: 'https://www.alpha.example/', source_url: 'https://alpha.example/', raw_metadata: {source_class: 'COMPANY_CANDIDATE'}}, [{id: 'p1', name: 'Studio Alpha', website: 'https://alpha.example/'}]), 'p1');
 assert.equal(strongProspectMatch({name: 'Studio Alpha', website: null, phone: '04 90 00 00 00', source_url: 'https://x.example/', raw_metadata: {}}, [{id: 'p2', name: 'Autre', website: null, phone: '+33490000000'}]), 'p2');
 assert.equal(strongProspectMatch({name: 'Studio Alpha', website: null, source_url: 'https://x.example/'}, [{id: 'p1', name: 'Studio Alpha', website: 'https://alpha.example/', city: 'Ville-Test'}]), null, 'a name alone never blocks');
 const api = await readFile(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 const guard = api.indexOf("code:'ALREADY_ADDED'"), rpc = api.indexOf("db.rpc('accept_discovery_result'");
 assert.ok(guard > 0 && guard < rpc, 'the guard runs before the accept RPC');
 assert.match(api, /identity&&identity\.dedupe_status!=='duplicate_candidate'/, 'the dedup link to the existing prospect is left to the RPC');
 // UI: an ADDED result offers "Voir le prospect", never "Ajouter".
 const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(panel, /const alreadyProspect=r\.status==='pending'&&nov\?\.status==='ADDED'&&!!nov\.prospect_id;/);
 assert.match(panel, /<div className="actions">\{alreadyProspect\?<>\{onOpenProspect&&<button className="text-button" onClick=\{\(\)=>openProspect\(nov!\.prospect_id!\)\}>\{tr\('discovery\.viewProspect'\)\}<\/button>\}<\/>:/);
 // The project's own dedup link to an existing prospect is ADDED with that prospect.
 const n = new ProjectNovelty({prospects: [{id: 'p9', name: 'Studio Nine', website: null}], results: [], runs: []}).classify({name: 'Studio Nine', source_url: 'https://nine.example/'}, {duplicateOf: 'p9'});
 assert.deepEqual([n.status, n.basis, n.prospect_id], ['ADDED', 'prospect_id', 'p9']);
});

test('CURRENT_RUN_DUPLICATE — the same actor twice in one run (same phone, two sites) is flagged, not counted twice', async () => {
 const {repo, provider} = setup();
 const {found} = await run(repo, provider, [actor('Alpha', {phone: '04 90 11 22 33'}), actor('Bravo', {phone: '04 90 11 22 33'})]);
 assert.deepEqual(found.results.map(r => noveltyOf(r.normalized_payload.raw_metadata)!.status), ['NEW', 'CURRENT_RUN_DUPLICATE']);
 assert.equal(repo.metrics.duplicate_results, 1);
 assert.equal(repo.metrics.new_discovery_rate, 1, 'a duplicate of this run is not a second actor');
});

test('B18-11 — default order: NEW before SEEN (then ignored, added, duplicates), the run order kept inside each group', () => {
 const n = (status: Novelty['status']) => ({status}) as Novelty;
 const rows = [{k: 'a', n: n('SEEN')}, {k: 'b', n: n('ADDED')}, {k: 'c', n: n('NEW')}, {k: 'd', n: n('IGNORED')}, {k: 'e', n: n('NEW')}, {k: 'f', n: null}];
 assert.deepEqual(newFirst(rows, r => r.n).map(r => r.k), ['c', 'e', 'f', 'a', 'd', 'b']);
});

test('B18-12 / B5 / B19 — filters Nouveaux / Déjà vus / Ajoutés / Ignorés; "all, new first" by default, narrowing only by the user', async () => {
 const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(panel, /useState<'ALL'\|NoveltyStatus>\('ALL'\)/, 'the default view is every result (new first), never "new only"');
 assert.match(panel, /\(\['ALL','NEW','SEEN','ADDED','IGNORED','CURRENT_RUN_DUPLICATE'\] as const\)/);
 assert.match(panel, /aria-pressed=\{noveltyTab===k\}/);
 assert.match(panel, /const shown=\(hasNovelty\?newFirst\(candidates,novOf\):candidates\)\.filter\(r=>noveltyTab==='ALL'\|\|novOf\(r\)\?\.status===noveltyTab\);/);
 assert.match(panel, /setResults\(rows\);setNoveltyTab\('ALL'\);/, 'a new or reopened run starts on "all"');
 const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
 assert.match(css, /\.novelty-tab\{flex:0 0 auto;min-height:44px/, 'phone: compact chips, 44 px targets');
 for (const k of ['NEW', 'SEEN', 'ADDED', 'IGNORED', 'CURRENT_RUN_DUPLICATE']) for (const lang of ['fr', 'en']) {
  const dict = await readFile(new URL(`../src/i18n/${lang}.ts`, import.meta.url), 'utf8');
  assert.match(dict, new RegExp(`'novelty\\.${k}':'`)); assert.match(dict, new RegExp(`'novelty\\.tab\\.${k}':'`));
 }
});

test('B18-13 / B4 — exact counters: 20 analysed = 7 new · 6 seen · 4 added · 3 ignored', async () => {
 const {store, repo, provider} = setup();
 const earlier = await run(repo, provider, WORDS.slice(0, 13).map(w => actor(w)));
 // 4 added, 3 ignored, 6 left as seen.
 earlier.found.results.slice(0, 4).forEach(r => store.accept(r.id));
 earlier.found.results.slice(4, 7).forEach(r => store.ignore(r.id));
 const {found} = await run(repo, provider, [...WORDS.slice(0, 13), ...WORDS.slice(13, 20)].map(w => actor(w)));
 const counts = noveltyCounts(found.results.map(r => noveltyOf(r.normalized_payload.raw_metadata)));
 assert.deepEqual(counts, {results_total: 20, new_results: 7, seen_results: 6, already_added: 4, ignored_results: 3, duplicate_results: 0});
 for (const [k, v] of Object.entries(counts)) assert.equal(repo.metrics[k], v, k);
 assert.equal(noveltySummaryLabel('fr', counts), '7 nouveaux · 6 déjà vus · 4 déjà ajoutés · 3 ignorés');
 assert.deepEqual(noveltyRates(counts), {new_discovery_rate: .35, repeat_rate: .65});
});

test('B13 — Kevin: run 1 A B C D E, run 2 A B C F G H → seen A B C, new F G H', async () => {
 const {repo, provider} = setup();
 await run(repo, provider, ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map(w => actor(w)));
 const {status} = await run(repo, provider, ['Alpha', 'Bravo', 'Charlie', 'Foxtrot', 'Golf', 'Hotel'].map(w => actor(w)));
 assert.deepEqual(['Alpha', 'Bravo', 'Charlie'].map(status), ['SEEN', 'SEEN', 'SEEN']);
 assert.deepEqual(['Foxtrot', 'Golf', 'Hotel'].map(status), ['NEW', 'NEW', 'NEW']);
});

test('B18-14 / B10 — history keeps each run’s novelty counters; older runs show none', () => {
 const base = {query: 'q', location: 'Ville-Test', categories: [], provider: 'brave', status: 'completed', started_at: '2026-09-26T08:00:00Z', completed_at: null, result_count: 20};
 const [withNovelty, legacy] = summarizeRuns([
  {...base, id: 'new', metrics: {provider: 'brave', results_total: 20, new_results: 7, seen_results: 6, already_added: 4, ignored_results: 3, duplicate_results: 0, new_discovery_rate: .35}},
  {...base, id: 'old', started_at: '2026-09-25T08:00:00Z', metrics: {provider: 'brave', results: 20}},
 ], []);
 assert.deepEqual(withNovelty!.novelty, {results_total: 20, new_results: 7, seen_results: 6, already_added: 4, ignored_results: 3, duplicate_results: 0});
 assert.equal(legacy!.novelty, null);
 // The panel re-reads the API's answer: counts and novelty are kept (they used to reset to 0).
 const again = summarizeRuns([{...withNovelty!, accepted_count: 2, ignored_count: 1}]);
 assert.deepEqual([again[0]!.accepted_count, again[0]!.ignored_count, again[0]!.novelty?.new_results], [2, 1, 7]);
 assert.equal(runNoveltyLabel('fr', withNovelty!.novelty!), '7 nouveaux · 13 déjà vus');
 assert.equal(runNoveltyLabel('en', withNovelty!.novelty!), '7 new · 13 seen before');
});

test('B18-15 / B15 — viewing an old run never calls a provider; one memory read per run, never one per result', async () => {
 const api = await readFile(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 const view = api.slice(api.indexOf("if(resource==='discovery-runs'&&method==='GET')"), api.indexOf("if(resource==='discovery-results'&&method==='POST')"));
 assert.doesNotMatch(view, /DiscoveryService|BraveProvider|FixtureProvider|searchCompanies|recordApiUsage/);
 const {repo, provider} = setup();
 await run(repo, provider, WORDS.slice(0, 20).map(w => actor(w)));
 await run(repo, provider, WORDS.slice(0, 20).map(w => actor(w)));
 assert.equal(repo.memoryCalls, 2, 'one batch read per run');
 assert.equal(provider.calls, 2, 'one search per launched run — nothing added by the novelty engine');
});

test('Fail-soft — a memory read failure never fails the search: results are simply not labelled', async () => {
 const {repo, provider} = setup();
 repo.failMemory = true;
 const {found} = await run(repo, provider, WORDS.slice(0, 3).map(w => actor(w)));
 assert.equal(found.results.length, 3);
 assert.ok(found.results.every(r => noveltyOf(r.normalized_payload.raw_metadata) === null), 'never a wrong "new"');
 assert.equal(repo.metrics.novelty_unavailable, 1);
 assert.ok(!('new_results' in repo.metrics));
});

test('B8 — prepared, not implemented: stable entity keys for a future "search until N new" loop', async () => {
 assert.equal(entityKey(actor('Alpha')), 'domain:alpha.example');
 assert.equal(entityKey(actor('Alpha', {website: 'https://www.alpha.example/contact'})), 'domain:alpha.example');
 const src = await readFile(new URL('../src/discovery/novelty.ts', import.meta.url), 'utf8');
 assert.match(src, /export type SearchUntilNewTarget=\{desiredNewResults:number;maxProviderCalls:number;seenEntityIds:ReadonlySet<string>\}/);
 assert.doesNotMatch(src, /function searchUntilNewTarget/, 'no additional provider search in version 1');
});

test('B21 — scoring, ICP mapping, evidence statuses and analysis are untouched by the novelty engine', async () => {
 for (const f of ['../src/discovery/novelty.ts', '../src/discovery/novelty-engine.ts']) {
  const src = await readFile(new URL(f, import.meta.url), 'utf8');
  assert.doesNotMatch(src, /scoreProspect|VERIFIED|INFERRED|safe-fetch|robots|quota/i, f);
 }
});
