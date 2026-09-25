import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAnalysisAuthorization,canonicalHost,dynamicAnalysisEnabled,type AcceptedDiscoveryResult} from '../src/discovery/analysis-authorization.ts';
import {analyzeProspectWebsite,createPolicyFetcher,type AnalysisAudit} from '../src/discovery/website-analysis.ts';
import {createSafeFetch,registrableDomainOf,USER_AGENT,type SafeFetchDependencies} from '../src/discovery/safe-fetch.ts';
import type {DiscoveryRepository} from '../src/discovery/services.ts';
import type {Observation} from '../src/discovery/types.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';

// Safe dynamic first-party analysis. Everything runs locally: mocked DNS and HTTP, no real site contacted.
// "bebureau.com" is only a realistic fixture value — no code path knows it.
const accepted = (over: Partial<AcceptedDiscoveryResult> = {}): AcceptedDiscoveryResult => ({status: 'accepted', provider: 'brave', source_class: 'COMPANY_CANDIDATE', website: 'https://bebureau.com', source_url: 'https://bebureau.com/', raw_payload: {company_domain_method: 'own_site', entity_confidence: 'RESOLVED_HIGH'}, ...over});
const authorize = (prospectWebsite: string | null, results: AcceptedDiscoveryResult[], o: {allow?: string[]; on?: boolean} = {}) =>
 resolveAnalysisAuthorization({prospectWebsite, acceptedResults: results, staticAllowlist: o.allow ?? [], dynamicEnabled: o.on ?? true});

// ============================================================
// A. Dynamic authorization
// ============================================================
test('A — an accepted Brave first-party (own_site) result authorizes its own host when the flag is on', () => {
 const a = authorize('https://bebureau.com', [accepted()]);
 assert.ok(a.ok);
 assert.equal(a.ok && a.mode, 'dynamic_discovery');
 assert.equal(a.ok && a.url, 'https://bebureau.com/');
 assert.deepEqual(a.ok && a.fetchPolicy, {allowedHosts: ['bebureau.com'], registrableDomain: 'bebureau.com', forbidHttpsDowngrade: true});
});
test('A — not accepted, ignored, rejected class, not own_site, cited domain, fixture/other provider: no dynamic capability', () => {
 for (const [label, r] of [
  ['pending', accepted({status: 'pending'})], ['ignored', accepted({status: 'ignored'})],
  ['IRRELEVANT', accepted({source_class: 'IRRELEVANT'})], ['UNCERTAIN', accepted({source_class: 'UNCERTAIN'})], ['null class', accepted({source_class: null})],
  ['domain cited by a third party', accepted({raw_payload: {company_domain_method: 'domain_in_text'}})], ['no method', accepted({raw_payload: {}})], ['no payload', accepted({raw_payload: null})],
  ['fixture provider', accepted({provider: 'fixture'})], ['no website', accepted({website: null})],
  ['source page on another site', accepted({source_url: 'https://www.europages.fr/entreprises/bebureau.html'})],
  ['IP website', accepted({website: 'https://93.184.216.34', source_url: 'https://93.184.216.34/'})],
 ] as const) {
  const a = authorize('https://bebureau.com', [r]);
  assert.equal(a.ok, false, label);
  assert.equal(!a.ok && a.code, 'DISCOVERY_CAPABILITY_INVALID', label);
 }
});
test('A — a manual prospect (no accepted result) gets the static allowlist only', () => {
 assert.deepEqual(authorize('https://bebureau.com', []), {ok: false, code: 'SOURCE_POLICY_REQUIRED', host: 'bebureau.com'});
 const s = authorize('https://bebureau.com', [], {allow: ['bebureau.com']});
 assert.ok(s.ok && s.mode === 'static_allowlist' && s.url === 'https://bebureau.com');
 assert.deepEqual(s.ok && s.fetchPolicy, {allowedHosts: ['bebureau.com']}, 'static policy unchanged: no registrable-domain or downgrade rule added');
 assert.deepEqual(authorize(null, [accepted()]), {ok: false, code: 'OFFICIAL_WEBSITE_REQUIRED', host: null});
});

// ============================================================
// B. Website tampering — C. client URL
// ============================================================
test('B — prospects.website changed after acceptance loses the capability; only "www." is the same host', () => {
 assert.deepEqual(authorize('https://evil.com', [accepted()]), {ok: false, code: 'WEBSITE_MISMATCH', host: 'evil.com'});
 for (const other of ['https://evilbebureau.com', 'https://bebureau.com.evil.com', 'https://shop.bebureau.com', 'https://bebureau.co', 'https://user:pw@bebureau.com'])
  assert.equal(authorize(other, [accepted()]).ok, false, other);
 for (const same of ['https://www.bebureau.com', 'http://bebureau.com/', 'https://BEBUREAU.COM./', 'https://bebureau.com/contact']) {
  const a = authorize(same, [accepted()]);
  assert.ok(a.ok, same);
  assert.equal(a.ok && a.url, 'https://bebureau.com/', 'the destination is always the discovery website, never prospects.website');
 }
 assert.equal(canonicalHost('https://www.www.bebureau.com'), 'www.bebureau.com', 'only one www. is removed');
 // A tampered website on the static allowlist is the operator's decision, not the Discovery capability.
 const s = authorize('https://evil.com', [accepted()], {allow: ['evil.com']});
 assert.ok(s.ok && s.mode === 'static_allowlist');
});

test('C — the analysis never reads the request body: the destination comes from server data only', () => {
 const api = readFileSync(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 const block = api.slice(api.indexOf("if(action==='analyze'&&method==='POST'){"), api.indexOf("if(action==='observations'")).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
 assert.ok(block.length > 100);
 assert.doesNotMatch(block, /\bbody\b/, 'the analyze branch never references the request body');
 assert.match(block, /prospectId:id,userId:user\.id/);
});

// ============================================================
// Orchestration (C, D, U, V, W, X, BeBureau acceptance)
// ============================================================
const HOME = '<html><head><title>BeBureau</title></head><body><h1>BeBureau</h1><p>Mobilier de bureau professionnel pour entreprises.</p><a href="/contact">Contact</a><a href="/produits">Produits</a><a href="/blog/2026/article">Blog</a><a href="https://evil.com/contact">x</a></body></html>';
class Repo implements DiscoveryRepository {
 website: string | null; tenant: 'A' | 'B'; saved: Observation[] = []; quotaCalls = 0; quotaFails = false;
 constructor(website: string | null, tenant: 'A' | 'B' = 'A') { this.website = website; this.tenant = tenant; }
 async start(): Promise<never> { throw Error('unused'); }
 async existing() { return []; }
 async saveResults(): Promise<never> { throw Error('unused'); }
 async finish() {}
 // RLS: tenant B's member cannot read tenant A's prospect.
 async prospect(id: string) { if (this.tenant !== 'A') throw Error('DATABASE_REQUEST_FAILED'); return {id, website: this.website, organization_id: 'org-a', project_id: 'p'}; }
 async projectCriteria(): Promise<Criterion[]> { return [{key: 'catalog', label: 'Catalogue mobilier', weight: 100, rules: {type: 'need_fit', config: {signals: ['mobilier']}}}]; }
 async consumeAnalysis() { this.quotaCalls++; if (this.quotaFails) throw Error('QUOTA_EXCEEDED'); }
 async saveObservations(_id: string, o: Observation[]) { this.saved = o; return o; }
}
class Audit implements AnalysisAudit {
 rows: Array<Record<string, unknown>> = []; failRecord = false;
 async record(e: Parameters<AnalysisAudit['record']>[0]) { if (this.failRecord) throw Error('DATABASE_REQUEST_FAILED'); this.rows.push({...e}); return `audit-${this.rows.length}`; }
 async complete(id: string, userId: string, outcome: string, pages: number | null, failed: number | null) { this.rows.push({id, userId, outcome, pages, failed}); }
}
async function analyze(o: {website?: string | null; results?: AcceptedDiscoveryResult[]; on?: boolean; allow?: string[]; repo?: Repo; audit?: Audit; pages?: Record<string, string>}) {
 const repo = o.repo ?? new Repo(o.website === undefined ? 'https://bebureau.com' : o.website);
 const audit = o.audit ?? new Audit();
 const fetched: Array<{url: string; policy: unknown}> = [];
 const pages = o.pages ?? {'https://bebureau.com/': HOME, 'https://bebureau.com/contact': '<html><body>Contact : 05 00 00 00 00</body></html>', 'https://bebureau.com/produits': '<html><body>Bureaux, sièges, rangements</body></html>'};
 const run = analyzeProspectWebsite({repo, prospectId: 'prospect-1', userId: 'user-a', acceptedResults: o.results ?? [accepted()], staticAllowlist: o.allow ?? [], dynamicEnabled: o.on ?? true, audit,
  fetchPage: async (raw, policy) => { const url = new URL(raw).href; fetched.push({url, policy}); const html = pages[url]; if (html === undefined) throw Error('HTTP status 404'); return {url, html}; }, log: () => {}});
 return {run, repo, audit, fetched};
}

test('BeBureau acceptance — flag ON: accepted own_site result + same website → analyzed on the discovery host only', async () => {
 const {run, audit, fetched, repo} = await analyze({});
 const result = await run;
 assert.equal(result.authorization_mode, 'dynamic_discovery');
 assert.equal(result.pages_analyzed, 3);
 assert.deepEqual(fetched.map(f => f.url), ['https://bebureau.com/', 'https://bebureau.com/contact', 'https://bebureau.com/produits'], 'same origin, depth 1, 2 extra pages max, never evil.com');
 for (const f of fetched) assert.deepEqual(f.policy, {allowedHosts: ['bebureau.com'], registrableDomain: 'bebureau.com', forbidHttpsDowngrade: true});
 assert.equal(repo.quotaCalls, 1);
 assert.deepEqual(audit.rows[0], {userId: 'user-a', prospectId: 'prospect-1', host: 'bebureau.com', mode: 'dynamic_discovery', outcome: 'STARTED'});
 assert.deepEqual(audit.rows[1], {id: 'audit-1', userId: 'user-a', outcome: 'ANALYZED', pages: 3, failed: 0});
 // W — nothing extracted is ever VERIFIED; X — the score stays 0 without a human confirmation.
 assert.ok(repo.saved.length > 0);
 for (const o of repo.saved) assert.notEqual(o.status as string, 'VERIFIED');
 const evidence: Evidence[] = repo.saved.filter(o => o.criterion && o.value !== null).map((o, i) => ({id: String(i), criterion: o.criterion!, value: o.value!, status: 'NOT_VERIFIED', source_url: o.source_url, excerpt: o.source_excerpt, observed_at: o.collected_at, verified_by: null}));
 assert.equal(scoreProspect(await repo.projectCriteria(), evidence).score, 0);
});

test('BeBureau acceptance — prospects.website = https://evil.com → refused before quota and network, refusal audited', async () => {
 const {run, audit, fetched, repo} = await analyze({website: 'https://evil.com'});
 await assert.rejects(run, /WEBSITE_MISMATCH/);
 assert.equal(fetched.length, 0); assert.equal(repo.quotaCalls, 0);
 assert.deepEqual(audit.rows, [{userId: 'user-a', prospectId: 'prospect-1', host: 'evil.com', mode: null, outcome: 'WEBSITE_MISMATCH'}]);
});

test('V — kill switch: absent/false/anything but "true" disables the dynamic capability; the static allowlist still works', async () => {
 for (const v of [undefined, '', 'false', '1', 'TRUE', 'true ', 'yes']) assert.equal(dynamicAnalysisEnabled(v), false, String(v));
 assert.equal(dynamicAnalysisEnabled('true'), true);
 const off = await analyze({on: false});
 await assert.rejects(off.run, /DYNAMIC_ANALYSIS_DISABLED/);
 assert.equal(off.fetched.length, 0);
 const stat = await analyze({on: false, allow: ['bebureau.com']});
 assert.equal((await stat.run).authorization_mode, 'static_allowlist');
 assert.deepEqual(stat.fetched[0]!.policy, {allowedHosts: ['bebureau.com']});
});

test('D — tenant B cannot analyze tenant A\'s prospect: nothing fetched, no quota, no audit', async () => {
 const {run, audit, fetched, repo} = await analyze({repo: new Repo('https://bebureau.com', 'B')});
 await assert.rejects(run);
 assert.equal(fetched.length, 0); assert.equal(repo.quotaCalls, 0); assert.equal(audit.rows.length, 0);
});

test('U — no audit, no fetch: if the STARTED record cannot be written, nothing is downloaded', async () => {
 const audit = new Audit(); audit.failRecord = true;
 const {run, fetched, repo} = await analyze({audit});
 await assert.rejects(run, /DATABASE_REQUEST_FAILED/);
 assert.equal(fetched.length, 0); assert.equal(repo.quotaCalls, 0);
});

test('U — failures are closed in the audit with codes only; quota refusal and robots refusal are distinct', async () => {
 const quota = new Repo('https://bebureau.com'); quota.quotaFails = true;
 const q = await analyze({repo: quota});
 await assert.rejects(q.run, /QUOTA_EXCEEDED/);
 assert.equal(q.fetched.length, 0);
 assert.equal(q.audit.rows[1]!.outcome, 'QUOTA_EXCEEDED');
 const failed = await analyze({pages: {}});
 await assert.rejects(failed.run, /ANALYSIS_FAILED/);
 assert.deepEqual(failed.audit.rows[1], {id: 'audit-1', userId: 'user-a', outcome: 'ANALYSIS_FAILED', pages: null, failed: null});
 for (const row of [...q.audit.rows, ...failed.audit.rows]) assert.doesNotMatch(JSON.stringify(row), /<html|https?:|\d+\.\d+\.\d+\.\d+/);
});

test('R — malformed HTML is analyzed safely (no crash, no invented data)', async () => {
 const {run} = await analyze({pages: {'https://bebureau.com/': '<html><body><div><p>Mobilier <a href="/contact">Contact<<<</div></span>\u0000<script>alert(1)</script>'}});
 const result = await run;
 assert.ok(result.pages_analyzed >= 1);
});

// ============================================================
// E–Q. Network policy through the real createSafeFetch (mocked DNS + transport)
// ============================================================
type Route = {status: number; headers?: Record<string, string>; body?: string};
function network(dns: Record<string, string[]>, routes: Record<string, Route>) {
 const requests: string[] = [];
 let resolves = 0;
 const deps: SafeFetchDependencies = {
  now: () => Date.now(),
  resolve: async host => { resolves++; const a = dns[host]; if (!a) throw Error('ENOTFOUND'); return a.map(address => ({address, family: address.includes(':') ? 6 : 4}) as {address: string; family: 4 | 6}); },
  request: async ({url, address}) => { requests.push(`${url.href}@${address}`); const r = routes[url.href] ?? {status: 404}; async function* body() { if (r.body) yield new TextEncoder().encode(r.body); } return {statusCode: r.status, headers: r.headers ?? {'content-type': 'text/html'}, body: body()}; },
 };
 return {fetch: createPolicyFetcher(createSafeFetch(deps)), requests, resolves: () => resolves};
}
const DYNAMIC = {allowedHosts: ['bebureau.com'], registrableDomain: 'bebureau.com', forbidHttpsDowngrade: true};
const PUBLIC = {'bebureau.com': ['93.184.216.34'], 'www.bebureau.com': ['93.184.216.34']};
const ok = {status: 200, headers: {'content-type': 'text/html'}, body: '<html>ok</html>'};
const blocked = async (p: Promise<unknown>, pattern: RegExp) => { await assert.rejects(p, pattern); };

test('E/F/G — private IPv4, private IPv6 and metadata destinations are refused, even inside the authorized domain', async () => {
 for (const [host, address] of [['bebureau.com', '10.0.0.5'], ['bebureau.com', '192.168.1.10'], ['bebureau.com', '172.16.0.1'], ['bebureau.com', '127.0.0.1'], ['bebureau.com', 'fd00::1'], ['bebureau.com', '::1'], ['bebureau.com', 'fe80::1'], ['bebureau.com', '::ffff:10.0.0.1'], ['bebureau.com', '169.254.169.254']]) {
  const n = network({[host]: [address]}, {});
  await blocked(n.fetch('https://bebureau.com/', DYNAMIC), /non-public/);
  assert.equal(n.requests.length, 0, `${address}: no connection attempted`);
 }
 const n = network(PUBLIC, {});
 for (const url of ['http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://10.0.0.1/']) await blocked(n.fetch(url, DYNAMIC), /Non-public|outside the authorized/);
});
test('H/I — DNS answering private (or mixed), and DNS rebinding between two lookups, are refused', async () => {
 await blocked(network({'bebureau.com': ['93.184.216.34', '10.0.0.1']}, {}).fetch('https://bebureau.com/', DYNAMIC), /non-public/);
 let call = 0; const seen: string[] = [];
 const rebinding = createPolicyFetcher(createSafeFetch({now: () => Date.now(), resolve: async () => [{address: call++ === 0 ? '93.184.216.34' : '127.0.0.1', family: 4}],
  request: async ({url, address}) => { seen.push(`${url.pathname}@${address}`); async function* b() {} return {statusCode: url.pathname === '/robots.txt' ? 404 : 200, headers: {'content-type': 'text/html'}, body: b()}; }}));
 await blocked(rebinding('https://bebureau.com/', DYNAMIC), /non-public/);
 assert.deepEqual(seen, ['/robots.txt@93.184.216.34'], 'the page request never reached the rebound address');
});
test('J — public → redirect → private / localhost / metadata is refused', async () => {
 for (const location of ['http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/', 'https://internal.bebureau.com/']) {
  const n = network({...PUBLIC, 'internal.bebureau.com': ['10.1.2.3']}, {'https://bebureau.com/robots.txt': {status: 404}, 'https://bebureau.com/': {status: 302, headers: {location}}});
  await blocked(n.fetch('https://bebureau.com/', DYNAMIC), /Localhost|Non-public|non-public|outside the authorized/);
 }
});
test('K — under dynamic authorization a redirect to another public domain is refused (PSL, not a string suffix)', async () => {
 for (const location of ['https://unrelated.com/', 'https://evilbebureau.com/', 'https://bebureau.com.evil.com/']) {
  const n = network({...PUBLIC, 'unrelated.com': ['93.184.216.35'], 'evilbebureau.com': ['93.184.216.36'], 'bebureau.com.evil.com': ['93.184.216.37']}, {'https://bebureau.com/': {status: 301, headers: {location}}});
  // Even if the host were also in allowedHosts, the registrable-domain policy refuses it.
  await blocked(n.fetch('https://bebureau.com/', {...DYNAMIC, allowedHosts: ['bebureau.com', 'unrelated.com', 'evilbebureau.com', 'evil.com']}), /outside the authorized|not in the allowed/);
 }
 assert.equal(registrableDomainOf('shop.bebureau.com'), 'bebureau.com');
 assert.equal(registrableDomainOf('evilbebureau.com'), 'evilbebureau.com');
 assert.equal(registrableDomainOf('a.github.io'), 'a.github.io', 'private PSL section: two github.io sites are two domains');
 assert.notEqual(registrableDomainOf('a.github.io'), registrableDomainOf('b.github.io'));
 assert.equal(registrableDomainOf('93.184.216.34'), null); assert.equal(registrableDomainOf('localhost'), null);
});
test('L — bebureau.com → www.bebureau.com stays within the authorized domain and is followed', async () => {
 const n = network(PUBLIC, {'https://bebureau.com/': {status: 301, headers: {location: 'https://www.bebureau.com/'}}, 'https://www.bebureau.com/': ok});
 const page = await n.fetch('https://bebureau.com/', DYNAMIC);
 assert.equal(page.url, 'https://www.bebureau.com/');
});
test('M — HTTPS → HTTP is refused under dynamic authorization (HTTP → HTTPS is fine)', async () => {
 await blocked(network(PUBLIC, {'https://bebureau.com/': {status: 301, headers: {location: 'http://www.bebureau.com/'}}}).fetch('https://bebureau.com/', DYNAMIC), /downgrade/);
 const up = network(PUBLIC, {'http://bebureau.com/': {status: 301, headers: {location: 'https://bebureau.com/'}}, 'https://bebureau.com/': ok});
 assert.equal((await up.fetch('http://bebureau.com/', DYNAMIC)).url, 'https://bebureau.com/');
 // robots.txt redirects are held to the same rule.
 await blocked(network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 301, headers: {location: 'http://bebureau.com/robots.txt'}}, 'https://bebureau.com/': ok}).fetch('https://bebureau.com/', DYNAMIC), /Robots check failed: HTTPS downgrade/);
});
test('N — ports other than 80/443 are refused, directly or by redirect', async () => {
 await blocked(network(PUBLIC, {}).fetch('https://bebureau.com:8443/', DYNAMIC), /Non-standard ports/);
 await blocked(network(PUBLIC, {'https://bebureau.com/': {status: 302, headers: {location: 'https://bebureau.com:8080/'}}}).fetch('https://bebureau.com/', DYNAMIC), /Non-standard ports/);
});
test('O — robots.txt: Disallow refuses, an unreachable robots.txt refuses (fail-closed), a redirected robots.txt governs the initial host', async () => {
 await blocked(network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 200, headers: {'content-type': 'text/plain'}, body: 'User-agent: *\nDisallow: /'}, 'https://bebureau.com/': ok}).fetch('https://bebureau.com/', DYNAMIC), /Blocked by robots/);
 await blocked(network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 200, headers: {'content-type': 'text/plain'}, body: 'User-agent: ProspectOS\nDisallow: /'}, 'https://bebureau.com/': ok}).fetch('https://bebureau.com/', DYNAMIC), /Blocked by robots/);
 await blocked(network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 503}, 'https://bebureau.com/': ok}).fetch('https://bebureau.com/', DYNAMIC), /Robots check failed/);
 // RFC 9309 §2.3.1.2: robots.txt redirected to www. applies to the initial authority.
 const allowed = network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 301, headers: {location: 'https://www.bebureau.com/robots.txt'}}, 'https://www.bebureau.com/robots.txt': {status: 200, headers: {'content-type': 'text/plain'}, body: 'User-agent: *\nAllow: /'}, 'https://bebureau.com/': ok});
 assert.equal((await allowed.fetch('https://bebureau.com/', DYNAMIC)).url, 'https://bebureau.com/');
 const denied = network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 301, headers: {location: 'https://www.bebureau.com/robots.txt'}}, 'https://www.bebureau.com/robots.txt': {status: 200, headers: {'content-type': 'text/plain'}, body: 'User-agent: *\nDisallow: /'}, 'https://bebureau.com/': ok});
 await blocked(denied.fetch('https://bebureau.com/', DYNAMIC), /Blocked by robots/);
 // Robots redirected off the authorized domain: refused.
 await blocked(network({...PUBLIC, 'cdn.other.net': ['93.184.216.40']}, {'https://bebureau.com/robots.txt': {status: 301, headers: {location: 'https://cdn.other.net/robots.txt'}}}).fetch('https://bebureau.com/', {...DYNAMIC, allowedHosts: ['bebureau.com', 'other.net']}), /Robots check failed: Host is outside the authorized domain/);
});
test('O — the analysis reports a robots refusal as ROBOTS_DENIED (and audits it)', async () => {
 const n = network(PUBLIC, {'https://bebureau.com/robots.txt': {status: 200, headers: {'content-type': 'text/plain'}, body: 'User-agent: *\nDisallow: /'}});
 const audit = new Audit(); const repo = new Repo('https://bebureau.com');
 await assert.rejects(analyzeProspectWebsite({repo, prospectId: 'p', userId: 'user-a', acceptedResults: [accepted()], staticAllowlist: [], dynamicEnabled: true, audit, fetchPage: n.fetch, log: () => {}}), /ROBOTS_DENIED/);
 assert.equal(audit.rows[1]!.outcome, 'ROBOTS_DENIED');
});
test('P/Q — slow and oversized responses fail cleanly', async () => {
 const slow = createPolicyFetcher(createSafeFetch({now: () => Date.now(), resolve: async () => [{address: '93.184.216.34', family: 4}], request: ({signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))}));
 const started = Date.now();
 await blocked(slow('https://bebureau.com/', DYNAMIC), /timed out/);
 assert.ok(Date.now() - started < 13000);
 await blocked(network(PUBLIC, {'https://bebureau.com/': {status: 200, headers: {'content-type': 'text/html'}, body: 'x'.repeat(500001)}}).fetch('https://bebureau.com/', DYNAMIC), /too large/);
});
test('the User-Agent identifies ProspectOS and points to its public legal notice; robots groups match "ProspectOS"', () => {
 assert.match(USER_AGENT, /^ProspectOS\/1\.0 \(\+https:\/\/[^\s)]+\/mentions-legales\)$/);
});
test('scope — no customer- or site-specific rule in the authorization code', () => {
 const code = ['analysis-authorization.ts', 'website-analysis.ts', 'safe-fetch.ts'].map(f => readFileSync(new URL(`../src/discovery/${f}`, import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')).join('\n');
 for (const specific of [/bebureau/i, /maroc/i, /fournipro/i, /foodatoi/i]) assert.doesNotMatch(code, specific);
});

// ============================================================
// Server wiring: audit bound to the JWT user, refusal codes, fixture path unchanged.
// ============================================================
import {createSupabaseAnalysisAudit} from '../src/discovery/analysis-audit.ts';
test('U — the Supabase audit adapter always writes the JWT-verified user and refuses any other user id', async () => {
 const calls: Array<[string, Record<string, unknown>]> = [];
 const writer = {rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return {data: 'audit-id', error: null}; }};
 const audit = createSupabaseAnalysisAudit(writer as never, 'user-a');
 assert.equal(await audit.record({userId: 'user-a', prospectId: 'p', host: 'bebureau.com', mode: 'dynamic_discovery', outcome: 'STARTED'}), 'audit-id');
 await audit.complete('audit-id', 'user-a', 'ANALYZED', 3, 0);
 await assert.rejects(audit.record({userId: 'user-b', prospectId: 'p', host: null, mode: null, outcome: 'SOURCE_POLICY_REQUIRED'}), /AUDIT_USER_MISMATCH/);
 await assert.rejects(audit.complete('audit-id', 'user-b', 'ANALYZED', 1, 0), /AUDIT_USER_MISMATCH/);
 assert.deepEqual(calls.map(([fn, a]) => [fn, a.p_user_id]), [['record_website_analysis', 'user-a'], ['complete_website_analysis', 'user-a']]);
 const api = readFileSync(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 assert.match(api, /createSupabaseAnalysisAudit\(auditWriter,user\.id\)/);
 assert.ok(api.indexOf('createSupabaseAnalysisAudit(') < api.indexOf('analyzeProspectWebsite({'), 'the audit writer exists before any analysis starts');
});
test('failure codes — refusals keep distinct codes and statuses; the shared handler is untouched', () => {
 const api = readFileSync(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 for (const [code, status] of [['SOURCE_POLICY_REQUIRED', 503], ['DYNAMIC_ANALYSIS_DISABLED', 503], ['DISCOVERY_CAPABILITY_INVALID', 403], ['WEBSITE_MISMATCH', 403], ['ROBOTS_DENIED', 422]] as const)
  assert.match(api, new RegExp(`${code}:\\['[^']+',${status}\\]`), code);
 assert.match(api, /DISCOVERY_DYNAMIC_ANALYSIS_ENABLED/);
 assert.doesNotMatch(api, /DISCOVERY_DYNAMIC_ANALYSIS_ENABLED\s*\?\?\s*['"]true/, 'no default-on');
});
