import test from 'node:test';
import assert from 'node:assert/strict';
import {BraveProvider} from '../src/discovery/providers/brave.ts';

const baseInput = {project_id: 'p', query: 'restaurants Toulouse commande en ligne', location: 'Toulouse, occitanie', categories: ['Restaurant'], max_results: 3, optional_filters: {}};

function mockBrave(results: Array<{title: string; url: string; description?: string}>) {
 let calls = 0;
 const requested: URL[] = [];
 const provider = new BraveProvider('test', async url => { calls++; requested.push(new URL(String(url))); return Response.json({web: {results}}); });
 return {provider, requested, callCount: () => calls};
}

// ============================================================
// Query construction — generic, never hardcodes a sector/brand/city.
// ============================================================
test('query construction carries the caller-supplied terms plus a generic, vertical-agnostic entity-seeking phrase — nothing sector-specific is injected', async () => {
 const {provider, requested} = mockBrave([]);
 await provider.searchCompanies(baseInput);
 const q = requested[0]!.searchParams.get('q')!;
 assert.match(q, /restaurants Toulouse commande en ligne/);
 assert.match(q, /Toulouse, occitanie/);
 assert.match(q, /Restaurant/);
 assert.match(q, /site officiel/, 'the generic entity-seeking bias phrase is present');
});
test('query construction is generic across sectors — no restaurant/Foodatoi-specific term is hardcoded anywhere in the module', async () => {
 const {provider, requested} = mockBrave([]);
 const saasInput = {...baseInput, query: 'cabinet expertise comptable', location: 'Lyon, auvergne-rhone-alpes', categories: ['expertise comptable']};
 await provider.searchCompanies(saasInput);
 const q = requested[0]!.searchParams.get('q')!.toLowerCase();
 for (const forbidden of ['restaurant', 'toulouse', 'foodatoi', 'uber eats', 'deliveroo'])
  assert.doesNotMatch(q, new RegExp(forbidden, 'i'), `"${forbidden}" must never be injected by the provider itself — only what the caller actually supplied`);
});

// ============================================================
// Budget — over-fetching within the SAME single call is fine; a second call is never allowed.
// ============================================================
test('exactly one HTTP call is made per searchCompanies invocation, however small max_results is — no retry, no pagination, no second request', async () => {
 const {provider, requested, callCount} = mockBrave([{title: 'Chez Mario', url: 'https://chezmario.fr/'}]);
 await provider.searchCompanies({...baseInput, max_results: 3});
 assert.equal(callCount(), 1);
 assert.equal(requested[0]!.searchParams.get('count'), '20', 'requests Brave\'s own max page size in that one call, regardless of the small max_results the user asked for — same billed request either way');
});
test('the returned candidate pool never exceeds the caller-requested max_results, even though up to 20 were fetched in the one call', async () => {
 const many = Array.from({length: 12}, (_, i) => ({title: `Entreprise Individuelle ${i}`, url: `https://entreprise-${i}.example/`}));
 const {provider} = mockBrave(many);
 const results = await provider.searchCompanies({...baseInput, max_results: 3});
 assert.equal(results.length, 3);
});

// ============================================================
// The actual regression this bloc fixes: reproduces the real 2026-09-18 smoke-test result set (1
// aggregator + 1 listicle + 1 ambiguous editorial page) alongside a genuine individual-business result
// that Brave's own raw ordering happened to rank last. Before this fix, requesting max_results=3 would
// have returned exactly the three bad candidates and silently dropped the one real business. After the
// fix, the same real business is surfaced within the top 3, and the ranking is fully explainable.
// ============================================================
test('regression: a real individual-business result buried behind 3 low-quality results is surfaced into the top max_results, and every result carries an explainable reason', async () => {
 const rawBraveOrder = [
  {title: 'Plats à Emporter à Toulouse | Livraison à Domicile | Uber Eats', url: 'https://www.ubereats.com/fr/toulouse/plats-a-emporter'},
  {title: '10 restaurants avec service de livraison de qualité à Toulouse', url: 'https://guide-sortir.fr/toulouse/top-livraison'},
  {title: 'À emporter ou en livraison, vos chefs toulousains vous régalent à domicile - toulouscope.fr', url: 'https://toulouscope.fr/a-la-une/emporter-livraison-toulouse'},
  {title: 'Chez Mario - Restaurant italien à Toulouse', url: 'https://chezmario-toulouse.fr/', description: 'Commande en ligne disponible, livraison à domicile.'},
 ];
 const {provider} = mockBrave(rawBraveOrder);
 const results = await provider.searchCompanies({...baseInput, max_results: 3}) as typeof rawBraveOrder;
 assert.equal(results.length, 3);
 assert.ok(results.some(r => r.url === 'https://chezmario-toulouse.fr/'), 'the real individual business must now be surfaced, not silently dropped because Brave happened to rank it 4th');
 // The worst-scoring raw result (the marketplace: -0.30, a heavier penalty than the listicle's -0.25) is
 // the one that gets excluded once the pool is ranked and truncated to 3 — never the real business.
 assert.ok(!results.some(r => r.url.includes('ubereats.com')));

 // Every returned candidate, once normalized, carries its explainable quality signal/reasons — never
 // presented as ICP evidence, only Discovery-internal explainability metadata.
 const normalized = results.map(r => provider.normalizeResult(r));
 const mario = normalized.find(c => c.source_url.includes('chezmario'))!;
 const listicle = normalized.find(c => c.source_url.includes('guide-sortir'))!;
 const ambiguous = normalized.find(c => c.source_url.includes('toulouscope'))!;
 assert.equal(mario.raw_metadata.quality_signal, 'likely_business_site');
 assert.equal(listicle.raw_metadata.quality_signal, 'listicle_pattern');
 assert.equal(ambiguous.raw_metadata.quality_signal, 'ambiguous');
 assert.ok(mario.confidence > ambiguous.confidence && ambiguous.confidence > listicle.confidence, 'the surfaced real business ranks strictly above the ambiguous page, which ranks strictly above the listicle');
});

// ============================================================
// Nothing about candidate quality ever touches the evidence-first invariants.
// ============================================================
// Superseded by the entity-resolution bloc: a shallow-path, short-title homepage like this one is now
// exactly the case that SHOULD resolve to its own site (this was the bug — see
// tests/entity-resolution.test.ts CAS 6/"own_site"). What must still never happen, whatever the
// resolution outcome, is a status of VERIFIED — that stays exclusively the human-gated
// ObservationsReview flow, which this module never touches.
test('normalizeResult never produces a VERIFIED status, whatever its quality signal or resolution outcome', async () => {
 const {provider} = mockBrave([{title: 'Chez Mario', url: 'https://chezmario.fr/'}]);
 const [raw] = await provider.searchCompanies(baseInput);
 const candidate = provider.normalizeResult(raw);
 assert.notEqual(candidate.raw_metadata.official_website_status, 'VERIFIED');
 assert.ok(['RESOLVED', 'UNRESOLVED'].includes(candidate.raw_metadata.official_website_status as string));
 assert.equal(candidate.city, null);
});
test('normalizeResult: a shallow-path, short-title homepage now resolves its own website via entity resolution (the exact bug this bloc fixes)', async () => {
 const {provider} = mockBrave([{title: 'Chez Mario', url: 'https://chezmario.fr/'}]);
 const [raw] = await provider.searchCompanies(baseInput);
 const candidate = provider.normalizeResult(raw);
 assert.equal(candidate.raw_metadata.official_website_status, 'RESOLVED');
 assert.equal(candidate.raw_metadata.canonical_resolution_method, 'own_site');
 assert.equal(candidate.website, 'https://chezmario.fr');
 assert.equal(candidate.canonical_url, 'https://chezmario.fr');
});
test('normalizeResult: a listicle/editorial/aggregator hit with no identifiable official domain stays UNRESOLVED, and its source is never dropped', async () => {
 const {provider} = mockBrave([{title: '10 meilleurs restaurants à Toulouse', url: 'https://guide-sortir.fr/toulouse/top10'}]);
 const [raw] = await provider.searchCompanies(baseInput);
 const candidate = provider.normalizeResult(raw);
 assert.equal(candidate.raw_metadata.official_website_status, 'UNRESOLVED');
 assert.equal(candidate.website, null);
 assert.equal(candidate.canonical_url, null);
 assert.equal(candidate.source_url, 'https://guide-sortir.fr/toulouse/top10', 'the media source itself is always kept, attachable as evidence');
});
test('confidence stays within the existing Candidate schema bounds (0..1) for every quality bucket', async () => {
 const {provider} = mockBrave([
  {title: 'Chez Mario', url: 'https://chezmario.fr/'},
  {title: '10 meilleurs restaurants', url: 'https://x.example/top10'},
  {title: 'Uber Eats Toulouse', url: 'https://www.ubereats.com/fr/toulouse'},
 ]);
 const raws = await provider.searchCompanies(baseInput);
 for (const raw of raws) { const c = provider.normalizeResult(raw); assert.ok(c.confidence > 0 && c.confidence < 1); }
});

// ============================================================
// 4A.2 end-to-end: quality ranking AND diversity selection working together through the real
// searchCompanies path, still exactly one HTTP call. Reproduces the real post-4A.1 smoke-test pool
// (2 near-duplicate Resto Drive results + Terra Tolosa + other distinct establishments lower down).
// ============================================================
test('end-to-end: searchCompanies surfaces Terra Tolosa and excludes the duplicate Resto Drive slot, in a single HTTP call', async () => {
 const rawPool = [
  {title: 'Commande en ligne restaurant Toulouse', url: 'https://www.restodrive.fr/toulouse'},
  {title: 'Commande en ligne restaurant Toulouse : solution click & collect | Resto Drive', url: 'https://www.restodrive.fr/toulouse/click-and-collect'},
  {title: 'Terra Tolosa - Restaurant Traditionnel - Toulouse', url: 'https://terratolosa.fr/'},
  {title: '10 meilleurs restaurants à Toulouse', url: 'https://guide-sortir.fr/toulouse/top10'},
  {title: 'Chez Mario - Restaurant italien - Toulouse', url: 'https://chezmario-toulouse.fr/'},
 ];
 const {provider, callCount} = mockBrave(rawPool);
 const results = await provider.searchCompanies({...baseInput, max_results: 3}) as typeof rawPool;
 assert.equal(callCount(), 1, 'still exactly one Brave HTTP call');
 assert.equal(results.length, 3);
 assert.ok(results.some(r => r.url === 'https://terratolosa.fr/'));
 assert.equal(results.filter(r => r.url.includes('restodrive.fr')).length, 1, 'only one Resto Drive slot survives quality ranking + diversity selection together');
 assert.equal(new Set(results.map(r => new URL(r.url).hostname)).size, 3, 'three distinct hostnames in the final top 3');
});
