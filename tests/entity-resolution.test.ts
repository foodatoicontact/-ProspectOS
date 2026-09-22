import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveCanonicalCompany,cleanTitle,nameFromDomain} from '../src/discovery/entity-resolution.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {DeduplicationService} from '../src/discovery/deduplication.ts';

// ============================================================
// Root-cause regression: Discovery correctly finds a commercial signal (an opening/expansion
// article) but must resolve SIGNAL -> CANONICAL COMPANY -> OFFICIAL WEBSITE -> SOURCE (kept as
// evidence) -> PROSPECT, never letting the media page itself become the prospect. The 7 CAS fixtures
// below reproduce the Verisure/retail acceptance scenario end to end through the real BraveProvider.
// ============================================================
function quality(hit: {title: string; url: string; description?: string}, location = 'France') {
 return assessCandidateQuality(hit, location);
}
// Mirrors exactly what BraveProvider.searchCompanies does before normalizeResult ever sees a raw hit
// (tag it with its quality assessment) — calling normalizeResult directly on an untagged hit would
// silently fall back to a neutral 'ambiguous' default and hide any signal-dependent behavior.
function normalize(provider: BraveProvider, hit: {title: string; url: string; description?: string}) {
 return provider.normalizeResult(Object.assign({}, hit, {__quality: quality(hit)}));
}

// ------------------------------------------------------------
// CAS 1 — media != prospect: a pure editorial article about a company opening a store must never
// resolve its own (media) domain as the company's website.
// ------------------------------------------------------------
test('CAS 1: a media article about a company opening a store never resolves to the media\'s own domain', () => {
 const hit = {title: 'Mango ouvre un nouveau magasin à Lyon', url: 'https://www.francetvinfo.fr/economie/entreprises/mango-ouvre-a-lyon.html', description: 'Le groupe espagnol Mango poursuit son expansion en France.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.status, 'UNRESOLVED', 'no domain is explicitly cited in the text, so no arbitrary selection happens');
 if (r.status === 'UNRESOLVED') assert.doesNotMatch(r.reasons.join(' '), /francetvinfo/);
});

// ------------------------------------------------------------
// CAS 2 — two media articles about the SAME real company must converge to one canonical candidate:
// once each article explicitly cites the company's real domain, both resolve to the identical
// website/domain and therefore the identical dedupe key, letting the existing (already-tested)
// DeduplicationService naturally merge them.
// ------------------------------------------------------------
test('CAS 2: two different media articles citing the same official domain converge to one canonical company (same dedupe key)', () => {
 const provider = new BraveProvider('test');
 const article1 = {title: 'Grand Frais annonce l\'ouverture de 12 nouveaux magasins', url: 'https://www.lsa-conso.fr/grand-frais-ouverture-magasins.html', description: 'L\'enseigne grand-frais.fr confirme son plan d\'expansion.'};
 const article2 = {title: 'Grand Frais poursuit son maillage territorial', url: 'https://www.toute-la-franchise.com/actus-6789.html', description: 'Selon le site grand-frais.fr, l\'enseigne cible les zones périurbaines.'};
 const c1 = normalize(provider, article1);
 const c2 = normalize(provider, article2);
 assert.equal(c1.raw_metadata.official_website_status, 'RESOLVED');
 assert.equal(c2.raw_metadata.official_website_status, 'RESOLVED');
 assert.equal(c1.website, 'https://grand-frais.fr');
 assert.equal(c1.website, c2.website, 'both articles resolve to the same real company domain');
 assert.equal(c1.deduplication_key, c2.deduplication_key, 'identical resolved domain -> identical dedupe key -> DeduplicationService.match will flag them as the same candidate');
 const dedupe = new DeduplicationService();
 const match = dedupe.match(c2, [c1]);
 assert.notEqual(match.status, 'unique', 'the second article about the same company must never be treated as a brand-new, unrelated prospect');
});

// ------------------------------------------------------------
// CAS 3 — two articles about two DIFFERENT real companies must never be merged, even if superficially
// similar (same retail sector, same kind of announcement).
// ------------------------------------------------------------
test('CAS 3: two articles about two different companies never share a dedupe key', () => {
 const provider = new BraveProvider('test');
 const mango = {title: 'Mango ouvre un nouveau magasin', url: 'https://www.lsa-conso.fr/mango-ouverture.html', description: 'Le site mango.com confirme l\'ouverture.'};
 const lidl = {title: 'Lidl ouvre un nouveau magasin', url: 'https://www.lsa-conso.fr/lidl-ouverture.html', description: 'Le site lidl.fr confirme l\'ouverture.'};
 const c1 = normalize(provider, mango);
 const c2 = normalize(provider, lidl);
 assert.equal(c1.website, 'https://mango.com');
 assert.equal(c2.website, 'https://lidl.fr');
 assert.notEqual(c1.deduplication_key, c2.deduplication_key);
 const dedupe = new DeduplicationService();
 assert.equal(dedupe.match(c2, [c1]).status, 'unique', 'two distinct real companies must never be flagged as duplicates of one another');
});

// ------------------------------------------------------------
// CAS 4 — a generic institutional/directory page (no single identifiable company) stays UNRESOLVED,
// never forced into a fabricated "company".
// ------------------------------------------------------------
test('CAS 4: a generic institutional page with no single identifiable company stays UNRESOLVED', () => {
 const hit = {title: 'Commerce de détail : tendances et chiffres clés du secteur', url: 'https://www.businessfrance.fr/actualites/commerce-detail-tendances', description: 'Panorama du secteur du commerce de détail en France, acteurs et perspectives.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.status, 'UNRESOLVED');
});

// ------------------------------------------------------------
// CAS 5 — an article citing SEVERAL distinct companies must never arbitrarily pick one: ambiguity
// fails closed to UNRESOLVED rather than guessing.
// ------------------------------------------------------------
test('CAS 5: an article citing several distinct company domains never arbitrarily selects one (fails closed)', () => {
 const hit = {title: 'Mango, Lidl et Grand Frais accélèrent leur expansion', url: 'https://www.lsa-conso.fr/panorama-expansion-2026.html', description: 'Les enseignes mango.com, lidl.fr et grand-frais.fr multiplient les ouvertures.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.status, 'UNRESOLVED');
 if (r.status === 'UNRESOLVED') assert.match(r.reasons.join(' '), /ambiguë/);
});

// ------------------------------------------------------------
// CAS 6 — the company's own official site is found directly (not a media page about it): resolves via
// 'own_site', with a clean name and a real, attachable website.
// ------------------------------------------------------------
test('CAS 6: the company\'s own official site, found directly, resolves via own_site with a clean name', () => {
 const provider = new BraveProvider('test');
 const hit = {title: 'Grand Frais — Le marché qui a du goût', url: 'https://www.grand-frais.fr/', description: 'Retrouvez tous nos magasins Grand Frais près de chez vous.'};
 const c = normalize(provider, hit);
 assert.equal(c.raw_metadata.official_website_status, 'RESOLVED');
 assert.equal(c.raw_metadata.canonical_resolution_method, 'own_site');
 assert.equal(c.website, 'https://www.grand-frais.fr');
 assert.equal(c.canonical_url, 'https://www.grand-frais.fr');
 assert.equal(c.name, 'Grand Frais');
});

// ------------------------------------------------------------
// CAS 7 — an ambiguous directory/aggregator listing page fails closed to UNRESOLVED, its source kept,
// never promoted to a company.
// ------------------------------------------------------------
test('CAS 7: an ambiguous directory/aggregator page fails closed to UNRESOLVED and keeps its source', () => {
 const hit = {title: 'Annuaire des commerces de détail en France', url: 'https://www.pagesjaunes.fr/annuaire/commerce-detail', description: 'Trouvez tous les commerces de détail près de chez vous.'};
 const provider = new BraveProvider('test');
 const c = normalize(provider, hit);
 assert.equal(c.raw_metadata.official_website_status, 'UNRESOLVED');
 assert.equal(c.website, null);
 assert.equal(c.source_url, hit.url, 'the directory page itself is always kept as an attachable source, never deleted');
});

// ============================================================
// Pure-function unit coverage of the two helpers.
// ============================================================
test('cleanTitle: strips only a short trailing editorial/publisher segment, never a middle one, never when nothing substantial remains', () => {
 assert.equal(cleanTitle('Grand Frais - Accueil'), 'Grand Frais');
 assert.equal(cleanTitle('Chez Mario | Restaurant italien à Toulouse'), 'Chez Mario');
 assert.equal(cleanTitle('Boulangerie Pain-de-Sucre'), 'Boulangerie Pain-de-Sucre', 'an internal hyphen with no surrounding spaces is never treated as a separator');
 assert.equal(cleanTitle('Chez Mario'), 'Chez Mario', 'a title with no separator is returned untouched');
});
test('nameFromDomain: deterministic capitalization only, never a fabricated legal form or brand spelling', () => {
 assert.equal(nameFromDomain('mango.com'), 'Mango');
 assert.equal(nameFromDomain('grand-frais.fr'), 'Grand Frais');
});

// ============================================================
// No LLM, no new provider, no second network call — this bloc is a pure, deterministic Discovery-layer
// module.
// ============================================================
test('entity-resolution.ts makes no network/HTTP call and references no AI/LLM provider', async () => {
 const source = await readFile(new URL('../src/discovery/entity-resolution.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /fetch\(|anthropic|openai|claude/i);
});
test('BraveProvider.searchCompanies still makes exactly one HTTP call per invocation — entity resolution runs entirely on the already-fetched title/description/url', async () => {
 let calls = 0;
 const provider = new BraveProvider('test', async () => { calls++; return Response.json({web: {results: [{title: 'Grand Frais', url: 'https://www.grand-frais.fr/'}]}}); });
 await provider.searchCompanies({project_id: 'p', query: 'grand frais', location: 'France', categories: [], max_results: 3, optional_filters: {}});
 assert.equal(calls, 1);
});

// ============================================================
// Invariants this bloc must never touch (per the brief): no auto-VERIFIED evidence, scoring/ICP/RLS/
// entitlement/Outreach/BYOK all untouched, no third-party source ever deleted, no migration added.
// ============================================================
test('invariant: no migration file was added or modified by this bloc — resolution lives entirely in the Discovery layer', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const committed = execSync('git diff --name-only main...HEAD -- db/migrations', {cwd, encoding: 'utf8'});
 const working = execSync('git status --porcelain --untracked-files=all -- db/migrations', {cwd, encoding: 'utf8'});
 assert.equal(committed.trim(), '', 'no migration should appear in this branch\'s committed diff against main');
 assert.equal(working.trim(), '', 'no migration should be staged, modified or newly created in the working tree either');
});
test('invariant: scoreProspect signature is untouched by this bloc', async () => {
 const source = await readFile(new URL('../src/domain/core.ts', import.meta.url), 'utf8');
 assert.match(source, /export function scoreProspect\(criteria:Criterion\[\],evidence:Evidence\[\],now=new Date\(\)\)/);
});
test('invariant: requireActiveEntitlement (the sole access gate) is untouched by this bloc', async () => {
 const source = await readFile(new URL('../src/server/entitlement.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /entity.resolution|canonical/i);
});
test('invariant: entity-resolution.ts never produces or references a VERIFIED status — that stays ObservationsReview\'s human-gated flow', async () => {
 const source = await readFile(new URL('../src/discovery/entity-resolution.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /'VERIFIED'/);
});
test('invariant: an UNRESOLVED candidate\'s source is never dropped from discovery_results — website/canonical_url are null, but source_url/source_title are always preserved', () => {
 const provider = new BraveProvider('test');
 const hit = {title: '10 meilleurs commerces à Paris', url: 'https://guide-sortir.fr/paris/top10'};
 const c = provider.normalizeResult(hit);
 assert.equal(c.source_url, hit.url);
 assert.equal(c.source_title, hit.title);
});
test('invariant: KNOWN_AGGREGATOR_HOSTS is reused, not duplicated, between candidate-quality.ts and entity-resolution.ts', async () => {
 const resolutionSource = await readFile(new URL('../src/discovery/entity-resolution.ts', import.meta.url), 'utf8');
 assert.match(resolutionSource, /from '\.\/candidate-quality\.ts'/);
 assert.doesNotMatch(resolutionSource, /ubereats\.com/, 'the aggregator host list must never be re-declared here');
});
