import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveCanonicalCompany,cleanTitle,nameFromDomain} from '../src/discovery/entity-resolution.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {DeduplicationService} from '../src/discovery/deduplication.ts';

// ============================================================
// V2 — company NAME and company DOMAIN are resolved INDEPENDENTLY (micro-patch after the real Brave
// smoke test on the Verisure case surfaced "Grand Frais : 30 nouveaux magasins... (Aufeminin)": the
// company name is clearly identifiable from the headline even though no verifiable domain is ever
// cited or fetched directly). RESOLVED name + UNRESOLVED domain must read as an honest intermediate
// state, never as "nothing was found", and a domain must NEVER be guessed from a resolved name alone.
// The 7 CAS fixtures below are the exact ones mandated by the bloc.
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
// CAS 1 — Grand Frais / Aufeminin: the real case that motivated this patch. The company name is
// clearly identifiable ("Grand Frais : ...") even though no domain is ever cited or fetchable.
// ------------------------------------------------------------
test('CAS 1 — Grand Frais / Aufeminin: company name RESOLVED, domain UNRESOLVED, source preserved', () => {
 const hit = {title: 'Grand Frais : 30 nouveaux magasins ouvrent en France dès le 1er juin 2026, votre ville est-elle concernée ?', url: 'https://www.aufeminin.com/news/grand-frais-30-nouveaux-magasins.html', description: 'L\'enseigne Grand Frais poursuit son expansion en France.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.companyName.status, 'RESOLVED');
 assert.equal(r.companyName.name, 'Grand Frais');
 if (r.companyName.status === 'RESOLVED') assert.equal(r.companyName.method, 'colon_prefix');
 assert.equal(r.companyDomain.status, 'UNRESOLVED', 'aufeminin.com is a media host — never guessed as the company\'s own domain');
});
test('CAS 1 (through BraveProvider) — the candidate carries the identified name with website null, and the media source is kept intact', () => {
 const provider = new BraveProvider('test');
 const hit = {title: 'Grand Frais : 30 nouveaux magasins ouvrent en France dès le 1er juin 2026, votre ville est-elle concernée ?', url: 'https://www.aufeminin.com/news/grand-frais-30-nouveaux-magasins.html', description: 'L\'enseigne Grand Frais poursuit son expansion en France.'};
 const c = normalize(provider, hit);
 assert.equal(c.name, 'Grand Frais');
 assert.equal(c.website, null);
 assert.equal(c.canonical_url, null);
 assert.equal(c.raw_metadata.company_name_status, 'RESOLVED');
 assert.equal(c.raw_metadata.company_domain_status, 'UNRESOLVED');
 assert.equal(c.source_url, hit.url, 'Aufeminin is never replaced or deleted — it stays the attachable source');
});

// ------------------------------------------------------------
// CAS 2 — Picard / média: a leading commercial-signal verb phrase ("a ouvert") names the company.
// ------------------------------------------------------------
test('CAS 2 — Picard / média: "Picard a ouvert dix magasins en 2026" resolves the name, domain stays null when absent', () => {
 const hit = {title: 'Picard a ouvert dix magasins en 2026 dans toute la France', url: 'https://www.lsa-conso.fr/actualites/picard-dix-magasins-2026.html', description: 'Le surgelé français continue son maillage.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.companyName.status, 'RESOLVED');
 assert.equal(r.companyName.name, 'Picard');
 if (r.companyName.status === 'RESOLVED') assert.equal(r.companyName.method, 'leading_verb');
 assert.equal(r.companyDomain.status, 'UNRESOLVED');
});

// ------------------------------------------------------------
// CAS 3 — Mango / média: a leading commercial-signal verb ("ouvre") names the company.
// ------------------------------------------------------------
test('CAS 3 — Mango / média: "Mango ouvre 45 magasins" resolves the name, domain stays null when absent', () => {
 const hit = {title: 'Mango ouvre 45 magasins dans le monde entier cette année', url: 'https://www.lsa-conso.fr/actualites/mango-45-magasins.html', description: 'Le groupe espagnol confirme son expansion internationale.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.companyName.status, 'RESOLVED');
 assert.equal(r.companyName.name, 'Mango');
 if (r.companyName.status === 'RESOLVED') assert.equal(r.companyName.method, 'leading_verb');
 assert.equal(r.companyDomain.status, 'UNRESOLVED');
});

// ------------------------------------------------------------
// CAS 4 — titre ambigu: a title starting with a number never invents a name.
// ------------------------------------------------------------
test('CAS 4 — ambiguous title: "30 nouveaux magasins ouvrent en France" never invents a company name', () => {
 const hit = {title: '30 nouveaux magasins ouvrent en France dès juin', url: 'https://www.lsa-conso.fr/panorama-2026.html', description: 'Plusieurs enseignes annoncent leur expansion.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.companyName.status, 'UNRESOLVED');
 assert.equal(r.companyDomain.status, 'UNRESOLVED');
});

// ------------------------------------------------------------
// CAS 5 — article multi-entreprises: never arbitrarily pick one of several named companies.
// ------------------------------------------------------------
test('CAS 5 — multi-entity article: "Aldi et Lidl : la liste complète" never arbitrarily picks a name', () => {
 const hit = {title: 'Aldi et Lidl : la liste complète des ouvertures en 2026', url: 'https://www.lsa-conso.fr/actualites/aldi-lidl-liste-2026.html', description: 'Les deux enseignes multiplient les implantations.'};
 const r = resolveCanonicalCompany({...hit, sourceUrl: hit.url, quality: quality(hit)});
 assert.equal(r.companyName.status, 'UNRESOLVED', 'neither Aldi nor Lidl is arbitrarily selected');
});

// ------------------------------------------------------------
// CAS 6 — site officiel direct: name AND domain resolve together, exactly as before this patch.
// ------------------------------------------------------------
test('CAS 6 — direct official site: name and domain both RESOLVED via own_site', () => {
 const provider = new BraveProvider('test');
 const hit = {title: 'Grand Frais — Le marché qui a du goût', url: 'https://www.grand-frais.fr/', description: 'Retrouvez tous nos magasins Grand Frais près de chez vous.'};
 const c = normalize(provider, hit);
 assert.equal(c.raw_metadata.company_name_status, 'RESOLVED');
 assert.equal(c.raw_metadata.company_name_method, 'own_site_title');
 assert.equal(c.raw_metadata.company_domain_status, 'RESOLVED');
 assert.equal(c.raw_metadata.company_domain_method, 'own_site');
 assert.equal(c.website, 'https://www.grand-frais.fr');
 assert.equal(c.canonical_url, 'https://www.grand-frais.fr');
 assert.equal(c.name, 'Grand Frais');
});

// ------------------------------------------------------------
// CAS 7 — domaine explicitement cité: a third-party article naming mango.com resolves both the name
// (derived from the domain) and the domain itself, via domain_in_text.
// ------------------------------------------------------------
test('CAS 7 — domain explicitly cited: a third-party article citing mango.com resolves both name and domain via domain_in_text', () => {
 const provider = new BraveProvider('test');
 const hit = {title: 'Mango ouvre un nouveau magasin', url: 'https://www.lsa-conso.fr/mango-ouverture.html', description: 'Le site mango.com confirme l\'ouverture.'};
 const c = normalize(provider, hit);
 assert.equal(c.raw_metadata.company_name_status, 'RESOLVED');
 assert.equal(c.raw_metadata.company_name_method, 'domain_label');
 assert.equal(c.raw_metadata.company_domain_status, 'RESOLVED');
 assert.equal(c.raw_metadata.company_domain_method, 'domain_in_text');
 assert.equal(c.website, 'https://mango.com');
 assert.equal(c.name, 'Mango');
});

// ============================================================
// Deduplication stays domain-only: two name-RESOLVED/domain-UNRESOLVED candidates about the same
// company are NEVER merged on name alone (a generic name like "Orange"/"Action" would be far too
// risky) — this is intentionally documented as follow-up debt, not implemented in this patch.
// ============================================================
test('name-only resolution never triggers a merge: two Grand Frais articles with no resolvable domain keep distinct dedupe keys', () => {
 const provider = new BraveProvider('test');
 const article1 = {title: 'Grand Frais : 30 nouveaux magasins ouvrent en France dès le 1er juin 2026', url: 'https://www.aufeminin.com/news/grand-frais-a.html', description: 'Expansion en cours.'};
 const article2 = {title: 'Grand Frais annonce une nouvelle vague d\'ouvertures', url: 'https://www.lsa-conso.fr/actualites/grand-frais-b.html', description: 'Nouvelle étape pour l\'enseigne.'};
 const c1 = normalize(provider, article1);
 const c2 = normalize(provider, article2);
 assert.equal(c1.name, 'Grand Frais');
 assert.equal(c2.name, 'Grand Frais');
 assert.equal(c1.website, null);
 assert.equal(c2.website, null);
 assert.notEqual(c1.deduplication_key, c2.deduplication_key, 'name-only resolution must never merge two candidates — that would risk false-merging on a generic name');
 const dedupe = new DeduplicationService();
 assert.equal(dedupe.match(c2, [c1]).status, 'unique');
});

// ------------------------------------------------------------
// Domain-based dedup (unchanged from the previous patch): two articles both citing the SAME domain
// still converge to one canonical candidate.
// ------------------------------------------------------------
test('domain-based dedup is unaffected: two articles citing the same domain still converge to one candidate', () => {
 const provider = new BraveProvider('test');
 const article1 = {title: 'Grand Frais annonce l\'ouverture de 12 nouveaux magasins', url: 'https://www.lsa-conso.fr/grand-frais-ouverture-magasins.html', description: 'L\'enseigne grand-frais.fr confirme son plan d\'expansion.'};
 const article2 = {title: 'Grand Frais poursuit son maillage territorial', url: 'https://www.toute-la-franchise.com/actus-6789.html', description: 'Selon le site grand-frais.fr, l\'enseigne cible les zones périurbaines.'};
 const c1 = normalize(provider, article1);
 const c2 = normalize(provider, article2);
 assert.equal(c1.website, 'https://grand-frais.fr');
 assert.equal(c1.website, c2.website);
 assert.equal(c1.deduplication_key, c2.deduplication_key);
 const dedupe = new DeduplicationService();
 assert.notEqual(dedupe.match(c2, [c1]).status, 'unique');
});
test('domain never invented from a resolved name: Grand Frais name-only resolution never yields grandfrais.com or any website', () => {
 const provider = new BraveProvider('test');
 const hit = {title: 'Grand Frais : 30 nouveaux magasins ouvrent en France dès le 1er juin 2026', url: 'https://www.aufeminin.com/news/grand-frais.html', description: 'Expansion en cours.'};
 const c = normalize(provider, hit);
 assert.equal(c.website, null);
 assert.equal(c.canonical_url, null);
});

// ============================================================
// Pure-function unit coverage of the helpers.
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
// Invariants this bloc must never touch: no auto-VERIFIED evidence, scoring/ICP/RLS/entitlement/
// Outreach/BYOK all untouched, no third-party source ever deleted, no migration added.
// ============================================================
test('invariant: no migration file was added or modified by this bloc', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const working = execSync('git status --porcelain --untracked-files=all -- db/migrations', {cwd, encoding: 'utf8'});
 assert.equal(working.trim(), '', 'no migration should be staged, modified or newly created in the working tree');
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
