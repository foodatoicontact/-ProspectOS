// Beta-tester feedback (public-works brief): too much noise, names not normalized, location missing, website
// analysis failures without a reason, every candidate at 0/100 so nothing to review first. These checks cover
// the answer — noise reduction, entity normalization, observed location, precise analysis failure codes and
// a REVIEW PRIORITY that is never a score — plus a reproducible benchmark (tests/fixtures/appelgagnant-benchmark.json,
// generic fictional data: no real company name exists anywhere in the algorithm).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {mergeSameEntityCandidates,stripPageWords,isSectorBody,briefTargetsSectorBodies} from '../src/discovery/admissibility.ts';
import {reviewPriority,byReviewPriority} from '../src/discovery/review-priority.ts';
import {analysisFailureCode} from '../src/discovery/services.ts';
import {mentionedPlace,locationTarget} from '../src/discovery/geo-fr.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import type {Candidate} from '../src/discovery/types.ts';

type Row = {id: string; type: string; expected: string; expected_priority: string | null; title: string; url: string; description: string};
const bench = JSON.parse(await readFile(new URL('./fixtures/appelgagnant-benchmark.json', import.meta.url), 'utf8')) as {query: string; location: string; results: Row[]};
const provider = new BraveProvider('benchmark-key');
function normalize(hit: {title: string; url: string; description?: string}, query = bench.query, location = bench.location): Candidate {
 const raw = {...hit, __quality: assessCandidateQuality(hit, location), __context: {query, categories: [], location}};
 return provider.normalizeResult(raw);
}
const meta = (c: Candidate) => c.raw_metadata as Record<string, any>;
const eligible = (c: Candidate) => meta(c).source_class === 'COMPANY_CANDIDATE';
// The same pipeline as DiscoveryService: normalize every page, merge one organization's pages, then priority.
function pipeline(rows: Row[]) {
 const byUrl = new Map(rows.map(r => [r.url, r]));
 const {kept} = mergeSameEntityCandidates(rows.map(r => normalize(r)));
 const withPriority = kept.map(c => ({c, row: byUrl.get(c.source_url)!, priority: reviewPriority(c.raw_metadata, c.website)}));
 const main = byReviewPriority(withPriority.filter(x => eligible(x.c)), x => x.priority);
 const setAside = withPriority.filter(x => !eligible(x.c));
 return {kept, main, setAside, withPriority};
}

// ---------------------------------------------------------------- A: noise
test('A — directory, category page, federation, trade union, job listing, article, aggregator: never a candidate for review', () => {
 const {setAside} = pipeline(bench.results);
 const rejected = new Set(setAside.map(x => x.row.id));
 for (const id of ['directory', 'category_page', 'federation', 'trade_union', 'job_board_listing', 'job_page_no_employer', 'article', 'unidentifiable', 'aggregator'])
  assert.ok(rejected.has(id), `${id} must be set aside`);
 for (const x of setAside) assert.equal(x.priority.level, 'LOW', x.row.id);
});
test('A — a federation is rejected with its own visible reason; the page stays listed as a source', () => {
 const c = normalize(bench.results.find(r => r.id === 'federation')!);
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 assert.equal(meta(c).admissibility.reason_code, 'SECTOR_BODY_PAGE');
 assert.equal(c.source_url, 'https://www.frtp-occitanie.fr/');
});
test('A — sector bodies stay candidates when the brief targets them (federations, employers, associations)', () => {
 assert.equal(briefTargetsSectorBodies({query: 'Fédérations et syndicats du BTP en Occitanie', categories: []}), true);
 assert.equal(briefTargetsSectorBodies({query: 'Structures employeuses autour de Gaillac', categories: []}), true);
 assert.equal(briefTargetsSectorBodies({query: bench.query, categories: []}), false);
 const c = normalize({title: 'FRTP Occitanie - Fédération Régionale des Travaux Publics', url: 'https://www.frtp-occitanie.fr/', description: 'Fédération des travaux publics en Occitanie.'}, 'Fédérations professionnelles des travaux publics');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 // A public buyer is not a sector body: "syndicat des eaux" / "syndicat intercommunal" stay organizations.
 assert.equal(isSectorBody('Syndicat des eaux du Tarn', 'Syndicat des eaux du Tarn'), false);
 assert.equal(isSectorBody('Syndicat intercommunal d’assainissement', 'x'), false);
 assert.equal(isSectorBody('Syndicat des entreprises de canalisations', 'x'), true);
});
test('A — a real company stays a COMPANY_CANDIDATE', () => {
 for (const id of ['tp_vrd_official', 'water_official', 'public_references', 'sme_to_qualify']) assert.ok(eligible(normalize(bench.results.find(r => r.id === id)!)), id);
});

// ---------------------------------------------------------------- B: entity
test('B — names are normalized: page words ("Accueil", "Recrutement", "Bienvenue chez") never stay in a company name', () => {
 assert.equal(normalize(bench.results.find(r => r.id === 'public_references')!).name, 'Lauragais Canalisations');
 assert.equal(stripPageWords('Accueil - Garonne TP'), 'Garonne TP');
 assert.equal(stripPageWords('Garonne TP | Recrutement'), 'Garonne TP');
 assert.equal(stripPageWords('Bienvenue chez Garonne TP'), 'Garonne TP');
 assert.equal(stripPageWords('Home Services'), 'Home Services', 'a word of the name without separator is kept');
 assert.equal(stripPageWords('Contact'), 'Contact', 'never reduced to nothing');
});
test('B — the official domain is preferred to a third-party page: the job ad merges into the official-site candidate', () => {
 const {main} = pipeline(bench.results);
 const tp = main.find(x => x.row.id === 'tp_vrd_official')!;
 assert.equal(tp.c.website, 'https://www.garonne-tp.fr');
 assert.equal(tp.c.source_url, 'https://www.garonne-tp.fr/');
 assert.equal(meta(tp.c).additional_sources.length, 1);
 assert.equal(main.filter(x => /garonne/i.test(x.c.name)).length, 1, 'one prospect for one company');
});
test('B — location: a place named by the source is shown as a mention; otherwise UNKNOWN (null), never the requested zone', () => {
 const water = normalize(bench.results.find(r => r.id === 'water_official')!);
 assert.equal(meta(water).observed_location, 'Haute-Garonne (31)');
 const sme = normalize(bench.results.find(r => r.id === 'sme_to_qualify')!);
 assert.equal(meta(sme).observed_location, null, 'Muret is not in the gazetteer of the requested zone: unknown, not guessed');
 assert.equal(sme.city, null, 'city stays null: identity, deduplication and novelty keys are unchanged');
 assert.equal(mentionedPlace(locationTarget('Toulouse (31)'), 'Réseaux à Toulouse et environs'), 'Toulouse');
 assert.equal(mentionedPlace(null, 'aucun lieu ici'), null);
});

// ---------------------------------------------------------------- D: review priority
test('D — HIGH for an identified company whose activity matches, LOW for a directory, MEDIUM for a company to qualify', () => {
 const {withPriority} = pipeline(bench.results);
 for (const x of withPriority) if (x.row.expected_priority) assert.equal(x.priority.level, x.row.expected_priority, `${x.row.id}: ${x.priority.reasons.join(',')}`);
});
test('D — a name read on a third-party page is never HIGH', () => {
 const c = normalize({title: 'Conducteur de travaux H/F - Garonne TP SAS - Toulouse (31)', url: 'https://www.hellowork.com/fr-fr/emplois/1.html', description: 'CDI travaux publics VRD assainissement Toulouse.'});
 assert.equal(eligible(c), true);
 assert.notEqual(reviewPriority(c.raw_metadata, c.website).level, 'HIGH');
});
test('D — ordering is deterministic: same input, same order; equal priorities keep the provider order', () => {
 const a = pipeline(bench.results).main.map(x => x.row.id), b = pipeline(bench.results).main.map(x => x.row.id);
 assert.deepEqual(a, b);
 assert.deepEqual(a, ['tp_vrd_official', 'water_official', 'public_references', 'sme_to_qualify']);
});

// ---------------------------------------------------------------- E: evidence-first invariants
test('E — review priority never touches evidence: verified score stays 0 without validation, and moves only with confirmed proofs', () => {
 const criteria: Criterion[] = [{key: 'public', label: 'Clients publics', weight: 60}, {key: 'vrd', label: 'VRD', weight: 40}];
 const inferred: Evidence[] = [{id: 'e1', criterion: 'public', value: true, status: 'INFERRED_UNCONFIRMED', source_url: 'https://www.garonne-tp.fr/', excerpt: 'collectivités', observed_at: '2026-09-28T00:00:00Z', verified_by: null},
  {id: 'e2', criterion: 'vrd', value: true, status: 'NOT_VERIFIED', source_url: 'https://www.garonne-tp.fr/', excerpt: 'VRD', observed_at: '2026-09-28T00:00:00Z', verified_by: null}];
 const before = JSON.stringify(inferred);
 const c = normalize(bench.results.find(r => r.id === 'tp_vrd_official')!);
 assert.equal(reviewPriority(c.raw_metadata, c.website).level, 'HIGH');
 assert.equal(scoreProspect(criteria, inferred).score, 0, 'HIGH priority, no validated proof: 0/100');
 assert.equal(JSON.stringify(inferred), before, 'no evidence status is changed');
 const confirmed = inferred.map(e => e.id === 'e1' ? {...e, status: 'VERIFIED' as const, verified_by: 'human'} : e);
 assert.equal(scoreProspect(criteria, confirmed).score, 60, 'the existing scoring works unchanged after human validation');
});
test('E — the priority module never names an evidence status and is not called a score', async () => {
 const src = await readFile(new URL('../src/discovery/review-priority.ts', import.meta.url), 'utf8');
 // location_state 'VERIFIED' is a place mention state, not an evidence status: the evidence vocabulary is absent.
 assert.doesNotMatch(src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n'), /INFERRED|NOT_VERIFIED|CONTRADICTED|evidence|scoreProspect|\bscore\b/);
 const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(panel, /tr\('discovery\.reviewPriority'\)/);
 const fr = (await import('../src/i18n/fr.ts')).fr;
 assert.equal(fr['discovery.reviewPriority'], 'Priorité de revue');
 assert.doesNotMatch(fr['discovery.priority.HIGH'] + fr['discovery.priority.MEDIUM'] + fr['discovery.priority.LOW'], /\d|\//, 'no fake numeric score');
 assert.match(fr['discovery.priorityExplain'], /Le score vérifié repose uniquement sur les preuves confirmées/);
});

// ---------------------------------------------------------------- C: website analysis
test('C — every analysis failure gets a code the user can act on; SSRF/policy refusals are never explained', () => {
 const cases: Array<[string, string]> = [
  ['Blocked by robots.txt', 'ROBOTS_DENIED'], ['Robots check failed: HTTP status 403', 'ROBOTS_UNAVAILABLE'], ['Robots check failed: HTTP status 503', 'ROBOTS_UNAVAILABLE'],
  ['Robots check failed: Unsupported robots content type: text/html', 'ROBOTS_UNAVAILABLE'], ['Safe fetch timed out', 'SITE_TIMEOUT'], ['Robots check failed: Request timed out', 'SITE_TIMEOUT'],
  ['getaddrinfo ENOTFOUND garonne-tp.fr', 'SITE_NOT_FOUND'], ['DNS returned no addresses', 'SITE_NOT_FOUND'], ['HTTP status 403', 'SITE_BLOCKED'], ['HTTP status 500', 'SITE_HTTP_ERROR'],
  ['Host is outside the authorized domain', 'SITE_REDIRECT_REFUSED'], ['Maximum redirects exceeded', 'SITE_REDIRECT_REFUSED'], ['Unsupported content type: application/pdf', 'SITE_NOT_HTML'],
  ['Response is too large', 'SITE_TOO_LARGE'],
  // Security refusals stay generic: never tell a caller which address or host policy refused.
  ['DNS returned a non-public address', 'ANALYSIS_FAILED'], ['Non-public IP address is forbidden', 'ANALYSIS_FAILED'], ['Host evil.example is not in the allowed hosts', 'ANALYSIS_FAILED'],
 ];
 for (const [message, code] of cases) assert.equal(analysisFailureCode(message), code, message);
});
test('C — robots.txt: only "does not exist" (404) and "gone" (410) mean no rules; 401/403/5xx still block', async () => {
 const src = await readFile(new URL('../src/discovery/safe-fetch.ts', import.meta.url), 'utf8');
 assert.match(src, /expected === 'robots' && \(response\.statusCode === 404 \|\| response\.statusCode === 410\)/);
 assert.match(src, /robots\.response\.statusCode !== 404 && robots\.response\.statusCode !== 410 && robotsParser\(/);
 const api = await readFile(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 for (const code of ['ROBOTS_UNAVAILABLE', 'SITE_TIMEOUT', 'SITE_NOT_FOUND', 'SITE_BLOCKED', 'SITE_HTTP_ERROR', 'SITE_REDIRECT_REFUSED', 'SITE_NOT_HTML', 'SITE_TOO_LARGE'])
  assert.match(api, new RegExp(`${code}:\\['Analyse impossible`), code);
 assert.doesNotMatch(api.match(/const ANALYSIS_REFUSALS[\s\S]*?\n\};/)![0], /\$\{|host|https?:/, 'no host or address in any message');
});

// ---------------------------------------------------------------- benchmark KPI
test('KPI — commercial exploitability: the top of the review list is only real, identifiable companies', () => {
 const {main, setAside, kept} = pipeline(bench.results);
 const top3 = main.slice(0, 3).map(x => x.row.id);
 assert.deepEqual(top3, ['tp_vrd_official', 'water_official', 'public_references']);
 assert.equal(main.filter(x => x.row.expected === 'REJECTED').length, 0, 'no noise in the review list');
 assert.equal(main.length, 4);
 assert.equal(setAside.length, 9);
 assert.equal(kept.length, 13, '14 pages, the job ad merged into its company');
});

// ================================================================ PR #5 corrections — measured on the REAL run
// tests/fixtures/thomas-real-run-2026-09-27.json: the 20 public results the beta tester actually received, with his
// query, zone and categories. No company name appears in the algorithm; these are inputs only.
import {ownNameInTitle,strongOwnName} from '../src/discovery/admissibility.ts';
import {isEligibleDiscoveryResult} from '../src/discovery/analysis-authorization.ts';
const real = JSON.parse(await readFile(new URL('./fixtures/thomas-real-run-2026-09-27.json', import.meta.url), 'utf8')) as {query: string; location: string; categories: string[]; rows: Array<{title: string; url: string; description: string; orig_class: string}>};
function replayReal() {
 const ctx = {query: real.query, categories: real.categories, location: real.location};
 const {kept} = mergeSameEntityCandidates(real.rows.map(r => provider.normalizeResult({title: r.title, url: r.url, description: r.description, __quality: assessCandidateQuality(r, real.location), __context: ctx})));
 const main = byReviewPriority(kept.filter(eligible), c => reviewPriority(c.raw_metadata, c.website));
 return {kept, main, setAside: kept.filter(c => !eligible(c))};
}
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');
const generic = (title: string, url: string, description = 'Travaux publics, VRD et assainissement pour les collectivités en Auvergne-Rhône-Alpes.') => normalize({title, url, description}, real.query, real.location);

test('1 — long SEO title + short brand at the end: the brand is the name when the domain spells it', () => {
 assert.equal(ownNameInTitle('Entreprise de travaux VRD et assainissement à Lyon, Rhône-Alpes - KTRX', 'ktrx.fr'), 'KTRX');
 assert.equal(strongOwnName('KTRX', 'ktrx'), true);
 assert.equal(strongOwnName('Sky', 'skygroupe'), false, 'a short prefix is only a resemblance');
});
test('2 — mdtp-like fixture: brand segment on its own domain → official site, own domain, RESOLVED_HIGH', () => {
 const c = generic('Entreprise de travaux VRD et assainissement à Lyon, Rhône-Alpes - KTRX', 'https://www.ktrx.fr/ktrx/');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(c.name, 'KTRX');
 assert.equal(c.website, 'https://www.ktrx.fr');
 assert.equal(meta(c).company_domain_method, 'own_site');
 assert.equal(meta(c).entity_confidence, 'RESOLVED_HIGH');
});
test('3 — ambtp-like fixture: initials brand covering most of a longer domain label → official site', () => {
 const c = generic('Entreprise de terrassement, VRD & Enrobés en Rhône-Alpes - RX BTP', 'https://www.rxbtpvrd.fr/');
 assert.equal(c.name, 'RX BTP');
 assert.equal(c.website, 'https://www.rxbtpvrd.fr');
 assert.equal(meta(c).page_type, 'OFFICIAL_ORGANIZATION_SITE');
});
test('4 — "Accueil - VRD - Services" on a vrd-services-like domain → an exploitable name from the segments spelling the domain', () => {
 const c = generic('Accueil - Pose - Reseaux', 'https://pose-reseaux.com/');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(c.name, 'Pose Reseaux');
 assert.equal(c.website, 'https://pose-reseaux.com');
 // Never a domain turned into a company name on its own: without title segments spelling it, nothing is named.
 assert.equal(ownNameInTitle('Accueil', 'pose-reseaux.com'), undefined);
});
test('5, 6 — "Entreprises de tous secteurs en…" is a listing, whatever the case of its first letter', () => {
 for (const title of ['Entreprises de tous secteurs en Auvergne-Rhône-Alpes', 'entreprises de tous secteurs en Auvergne-Rhône-Alpes']) {
  const c = generic(title, 'https://www.entreprises-de-la-region.fr/');
  assert.equal(meta(c).source_class, 'IRRELEVANT', title);
  assert.equal(meta(c).admissibility.reason_code, 'DIRECTORY_PAGE', title);
  assert.equal(reviewPriority(c.raw_metadata, c.website).level, 'LOW');
 }
});
test('7, 8 — business-for-sale listings are set aside as listings', () => {
 for (const [title, url] of [['Entreprise de BTP à vendre – Offres d’entreprises de BTP à vendre', 'https://reprise.example-banque.fr/btp-a-vendre'], ['Entreprise tous corps d’état à vendre en Auvergne-Rhône-Alpes', 'https://www.cessions-pme.fr/beton.aspx'], ['Société de maçonnerie à céder - Rhône', 'https://www.annonces-cession.fr/x'], ['Opportunités de reprise dans le BTP', 'https://www.bourse-reprise.fr/btp']]) {
  const c = generic(title, url);
  assert.equal(meta(c).source_class, 'IRRELEVANT', title);
  assert.equal(meta(c).admissibility.reason_code, 'DIRECTORY_PAGE', title);
 }
});
test('9 — a real company whose own site talks about an acquisition is NOT rejected', () => {
 const c = generic('Durand TP - Travaux publics et VRD | Acquisition de la société Martin Réseaux', 'https://www.durand-tp.fr/', 'Durand TP réalise des travaux publics et VRD pour les collectivités ; le groupe annonce la cession de sa filiale et l’acquisition d’une entreprise locale.');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(c.name, 'Durand TP');
});
test('10 — review priority: a directory can never be HIGH', () => {
 const {setAside} = replayReal();
 for (const c of setAside) assert.equal(reviewPriority(c.raw_metadata, c.website).level, 'LOW', c.source_url);
 assert.equal(reviewPriority({source_class: 'IRRELEVANT', entity_confidence: 'RESOLVED_HIGH', relevance_terms: ['btp', 'vrd', 'travaux']}, 'https://x.fr').level, 'LOW');
});
test('11, 12 — real replay: the verified score stays 0 without validated proof, and nothing is auto-VERIFIED', () => {
 const {main} = replayReal();
 const criteria: Criterion[] = [{key: 'need_fit', label: 'Marchés publics', weight: 100}];
 for (const c of main) {
  assert.equal(scoreProspect(criteria, []).score, 0);
  assert.doesNotMatch(JSON.stringify(c.raw_metadata), /"status":"VERIFIED"|"verified_by"/, 'Discovery never writes an evidence status');
 }
});
test('REAL REPLAY — the 20 pages of the beta tester: 4 identifiable companies, 0 noise, all analyzable, all HIGH', () => {
 const {kept, main, setAside} = replayReal();
 assert.equal(kept.length, 20);
 assert.deepEqual(main.map(c => hostOf(c.website!)).sort(), ['ambtpvrd.fr', 'mdtp.fr', 'ribiere.eu', 'vrd-services.com']);
 assert.deepEqual(main.map(c => c.name).sort(), ['AM BTP', 'MDTP', 'Ribiere', 'VRD Services']);
 for (const c of main) {
  assert.equal(reviewPriority(c.raw_metadata, c.website).level, 'HIGH', c.name);
  // Dynamic Safe Analysis eligibility, under the existing, unchanged rules (own-site Brave result, same domain).
  assert.equal(isEligibleDiscoveryResult({status: 'accepted', provider: 'brave', source_class: 'COMPANY_CANDIDATE', website: c.website, source_url: c.source_url, raw_payload: c.raw_metadata}), true, c.name);
 }
 const reasons = setAside.map(c => meta(c).admissibility.reason_code).sort();
 assert.equal(setAside.length, 16);
 assert.equal(reasons.filter(r => r === 'DIRECTORY_PAGE').length, 9);
 assert.equal(reasons.filter(r => r === 'SECTOR_BODY_PAGE').length, 2);
});
test('Unicode boundaries — "à" and a final "é" are matched: category in a place, "N sociétés", "Société … à céder"', () => {
 for (const title of ['Entreprises de BTP à Lyon', 'Sociétés de VRD à Grenoble', '80 société de terrassement référencées']) {
  assert.equal(meta(generic(title, 'https://www.liste-btp.fr/')).source_class, 'IRRELEVANT', title);
 }
});
