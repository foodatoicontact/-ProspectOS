import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {parseQueryExclusions} from '../src/discovery/admissibility.ts';
import {compareLocation,locationTarget} from '../src/discovery/geo-fr.ts';
import {scoreProspect,DEFAULT_CRITERIA} from '../src/domain/core.ts';
import type {Candidate} from '../src/discovery/types.ts';

// Admissibility gate — A PAGE IS NOT A PROSPECT. Regression suite for the real "Anaïs" case (search for a
// host structure for a DEJEPS ASEC work-study around Gaillac): training pages, training providers,
// directories, job boards and out-of-zone results were presented as prospects. Deterministic fixtures,
// real BraveProvider + real classification/resolution/gate code, fake fetch — no network.
const ANAIS_QUERY = 'Trouver des structures employeuses autour de Gaillac pouvant accueillir une alternante en coordination de projets. Prioriser animation, éducation populaire, social et médico-social. Exclure organismes de formation et pages DEJEPS. Chercher des signaux de recrutement, alternance, projets ou partenariats.';
// The full brief is 281 characters; the Discovery input accepts 250. Service-level runs use the same
// brief condensed (same zone, same priorities, same exclusions).
const ANAIS_QUERY_SHORT = 'Structures employeuses autour de Gaillac pour une alternante en coordination de projets : animation, éducation populaire, social, médico-social. Exclure organismes de formation et pages DEJEPS. Signaux : recrutement, alternance.';
const ZONE = 'Gaillac, Tarn';
const provider = new BraveProvider('test-key');
type Meta = Record<string, any>;
function normalize(hit: {title: string; url: string; description?: string}, query = ANAIS_QUERY, location = ZONE): Candidate {
 const raw: Record<string, unknown> = {...hit};
 raw.__quality = assessCandidateQuality(hit, location);
 raw.__context = {query, categories: [], location};
 return provider.normalizeResult(raw);
}
const meta = (c: Candidate) => c.raw_metadata as Meta;
const verdict = (c: Candidate) => ({admissible: meta(c).admissibility.admissible as boolean, reason: meta(c).admissibility.reason_code as string, pageType: meta(c).page_type as string, cls: meta(c).source_class as string});

test('Cas 1 — DEJEPS course page on a training site: TRAINING_COURSE_PAGE, not admissible', () => {
 const c = normalize({title: 'DEJEPS ASEC - Coordination de projet | Trajectoire Formation', url: 'https://www.trajectoire-formation.com/formations/dejeps-asec', description: 'Formation DEJEPS animation socio-éducative en alternance, coordination de projets, éducation populaire.'});
 assert.deepEqual(verdict(c), {admissible: false, reason: 'TRAINING_COURSE_PAGE', pageType: 'TRAINING_COURSE_PAGE', cls: 'IRRELEVANT'});
 assert.equal(meta(c).company_name, null);
 assert.equal(c.website, null);
});

test('Cas 2 — training provider homepage, query excludes training providers: not admissible (EXCLUDED_BY_QUERY)', () => {
 const c = normalize({title: 'Trajectoire Formation - Organisme de formation animation', url: 'https://www.trajectoire-formation.com/', description: 'Organisme de formation certifié Qualiopi : BPJEPS, DEJEPS, animation et éducation populaire en Occitanie.'});
 assert.deepEqual(verdict(c), {admissible: false, reason: 'EXCLUDED_BY_QUERY', pageType: 'TRAINING_PROVIDER', cls: 'IRRELEVANT'});
 // Without the exclusion, a training provider is an ordinary organization (it may employ people).
 const neutral = normalize({title: 'Trajectoire Formation - Organisme de formation animation', url: 'https://www.trajectoire-formation.com/', description: 'Organisme de formation certifié Qualiopi : animation et éducation populaire à Gaillac.'}, 'structures animation éducation populaire Gaillac');
 assert.equal(verdict(neutral).pageType, 'TRAINING_PROVIDER');
 assert.equal(verdict(neutral).admissible, true);
});

test('Cas 3 — annuaire-mairie.fr: DIRECTORY, never "Annuaire Mairie" as a company', () => {
 const c = normalize({title: 'Mairie de Gaillac 81600 - adresse et horaires', url: 'https://www.annuaire-mairie.fr/mairie-gaillac.html', description: 'Coordonnées de la mairie de Gaillac (Tarn) : services, animation, social.'});
 assert.deepEqual(verdict(c), {admissible: false, reason: 'DIRECTORY_PAGE', pageType: 'DIRECTORY', cls: 'IRRELEVANT'});
 assert.equal(c.website, null);
 assert.equal(meta(c).company_name, null);
 assert.notEqual(c.name, 'Annuaire Mairie');
});

test('Cas 4 — Hellowork job ad naming Fédération ADMR du Tarn: the employer is the candidate, Hellowork stays the source', () => {
 const c = normalize({title: 'Coordinateur de projets H/F - Fédération ADMR du Tarn - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/58345123.html', description: 'Alternance coordination de projets, aide à domicile, médico-social, Gaillac 81600.'});
 assert.deepEqual(verdict(c), {admissible: true, reason: 'ADMISSIBLE', pageType: 'THIRD_PARTY_JOB_BOARD', cls: 'COMPANY_CANDIDATE'});
 assert.equal(c.name, 'Fédération ADMR du Tarn');
 assert.equal(c.website, null, 'the job board domain is never the employer website');
 assert.equal(meta(c).source_domain, 'hellowork.com');
 assert.equal(c.source_url, 'https://www.hellowork.com/fr-fr/emplois/58345123.html');
 assert.equal(meta(c).company_name_method, 'job_title_employer');
});

test('Cas 5 — job board with no identified employer: ENTITY_UNRESOLVED, the job board is never the prospect', () => {
 for (const hit of [
  {title: 'Offres d\'emploi Animation Gaillac - 37 offres', url: 'https://fr.indeed.com/q-animation-l-gaillac-emplois.html', description: '37 offres d\'emploi animation, social, alternance à Gaillac.'},
  {title: 'Coordinateur de projets H/F - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/1.html', description: 'Alternance coordination de projets à Gaillac.'},
 ]) {
  const c = normalize(hit);
  assert.deepEqual(verdict(c), {admissible: false, reason: 'ENTITY_UNRESOLVED', pageType: 'THIRD_PARTY_JOB_BOARD', cls: 'IRRELEVANT'});
  assert.equal(meta(c).company_name, null);
  assert.doesNotMatch(c.name, /^(Hellowork|Indeed)$/i);
 }
});

test('Cas 6 — target Gaillac/Tarn, candidate explicitly in Paris / Île-de-France: LOCATION_MISMATCH', () => {
 const c = normalize({title: 'Association Horizons Jeunesse recrute un coordinateur de projets en alternance', url: 'https://www.horizons-jeunesse.org/actualites/recrutement-alternance', description: 'Paris 11e (75011), Île-de-France : éducation populaire, animation, projets jeunesse.'});
 assert.deepEqual(verdict(c), {admissible: false, reason: 'LOCATION_MISMATCH', pageType: 'OFFICIAL_JOB_PAGE', cls: 'IRRELEVANT'});
 assert.equal(meta(c).location_state, 'MISMATCH');
 assert.deepEqual(meta(c).location_regions, ['Île-de-France']);
});

test('Cas 7 — no explicit location: UNKNOWN, never written as a match, never rejected for it', () => {
 const c = normalize({title: 'Association Les Petits Débrouillards - Éducation populaire', url: 'https://www.petits-debrouillards-asso.org/', description: 'Animation scientifique et éducation populaire, projets jeunesse.'}, ANAIS_QUERY, ZONE);
 assert.equal(meta(c).location_state, 'UNKNOWN');
 assert.equal(c.city, null, 'no city is ever inferred');
 assert.notEqual(verdict(c).reason, 'LOCATION_MISMATCH');
 // A candidate in the same region but another department is COMPATIBLE, never VERIFIED.
 assert.equal(compareLocation(locationTarget(ZONE), 'Centre social à Rodez (12000)').state, 'COMPATIBLE');
 assert.equal(compareLocation(locationTarget(ZONE), 'MJC d’Albi, Tarn').state, 'VERIFIED');
 assert.equal(compareLocation(locationTarget('Gaillac'), 'Paris (75011)').state, 'UNKNOWN', 'a zone the gazetteer cannot place never rejects anything');
});

test('Cas 8 — official site of a local structure: resolved, admissible', () => {
 const c = normalize({title: 'MJC de Gaillac - Maison des Jeunes et de la Culture', url: 'https://www.mjc-gaillac.fr/', description: 'Animation, éducation populaire et projets jeunesse à Gaillac, Tarn.'});
 assert.deepEqual(verdict(c), {admissible: true, reason: 'ADMISSIBLE', pageType: 'OFFICIAL_ORGANIZATION_SITE', cls: 'COMPANY_CANDIDATE'});
 assert.equal(c.name, 'MJC de Gaillac');
 assert.equal(c.website, 'https://www.mjc-gaillac.fr');
 assert.equal(meta(c).location_state, 'VERIFIED');
});

// ---------- Full run (DiscoveryService + BraveProvider, fake fetch) ----------
class Repo implements DiscoveryRepository {
 saved: Candidate[] = []; metrics: Record<string, unknown> = {};
 async start() { return {id: 'run-1', provider: 'brave', status: 'running', result_count: 0, error_message: null}; }
 async existing() { return []; }
 async saveResults(_r: unknown, rows: {candidate: Candidate}[]) { this.saved = rows.map(r => r.candidate); return rows.map((r, i) => ({id: String(i), normalized_payload: r.candidate, dedupe_status: 'unique' as const, duplicate_of: null, status: 'pending' as const, prospect_id: null, source_class: meta(r.candidate).source_class})); }
 async finish(_id: string, _n: number, metrics: Record<string, unknown>) { this.metrics = metrics; }
 async prospect(): Promise<never> { throw Error('unused'); }
 async projectCriteria() { return []; }
 async consumeAnalysis() {}
 async saveObservations() { return []; }
}
async function runSearch(results: unknown[], query = ANAIS_QUERY_SHORT) {
 const urls: string[] = [];
 const brave = new BraveProvider('KEY', (async (url: URL) => { urls.push(String(url)); return new Response(JSON.stringify({web: {results}}), {status: 200}); }) as unknown as typeof fetch);
 const repo = new Repo();
 const found = await new DiscoveryService(repo, brave).find_prospects({project_id: 'p', query, location: ZONE, categories: [], max_results: 20});
 return {repo, found, urls};
}

test('Cas 9 — same organization via its own site and a job board: ONE candidate, both sources kept', async () => {
 const {repo, found} = await runSearch([
  {title: 'Coordinateur de projets H/F - Fédération ADMR du Tarn - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/58345123.html', description: 'Alternance coordination de projets, médico-social, Gaillac 81600.'},
  {title: 'Fédération ADMR du Tarn - Aide et soins à domicile', url: 'https://www.admr-tarn.fr/', description: 'Aide à domicile et médico-social dans le Tarn, recrutement et alternance.'},
 ]);
 const candidates = repo.saved.filter(c => meta(c).source_class === 'COMPANY_CANDIDATE');
 assert.equal(candidates.length, 1);
 assert.equal(found.results.length, 1);
 const admr = candidates[0]!;
 assert.equal(admr.name, 'Fédération ADMR du Tarn');
 assert.equal(admr.website, 'https://www.admr-tarn.fr', 'the official site is the primary source');
 assert.deepEqual((meta(admr).additional_sources as {source_url: string}[]).map(s => s.source_url), ['https://www.hellowork.com/fr-fr/emplois/58345123.html']);
 assert.equal(repo.metrics.entities_merged, 1);
 // Two different organizations with generic names are never merged.
 const generic = await runSearch([
  {title: 'Animateur H/F - Centre social - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/2.html', description: 'Animation Gaillac.'},
  {title: 'Coordinateur H/F - Centre social - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/3.html', description: 'Coordination de projets Gaillac.'},
 ]);
 assert.equal(generic.repo.metrics.entities_merged, 0);
});

const ANAIS_RESULTS = [
 {title: 'DEJEPS ASEC - Coordination de projet | Trajectoire Formation', url: 'https://www.trajectoire-formation.com/formations/dejeps-asec', description: 'Formation DEJEPS animation socio-éducative en alternance, coordination de projets, éducation populaire.'},
 {title: 'Trajectoire Formation - Organisme de formation animation', url: 'https://www.trajectoire-formation.com/', description: 'Organisme de formation certifié Qualiopi : BPJEPS, DEJEPS, animation et éducation populaire en Occitanie.'},
 {title: 'Mairie de Gaillac 81600 - adresse et horaires', url: 'https://www.annuaire-mairie.fr/mairie-gaillac.html', description: 'Coordonnées de la mairie de Gaillac (Tarn) : services, animation, social.'},
 {title: 'Coordinateur de projets H/F - Fédération ADMR du Tarn - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/58345123.html', description: 'Alternance coordination de projets, aide à domicile, médico-social, Gaillac 81600.'},
 {title: 'Offres d\'emploi Animation Gaillac - 37 offres', url: 'https://fr.indeed.com/q-animation-l-gaillac-emplois.html', description: '37 offres d\'emploi animation, social, alternance à Gaillac.'},
 {title: 'Association Horizons Jeunesse recrute un coordinateur de projets en alternance', url: 'https://www.horizons-jeunesse.org/actualites/recrutement-alternance', description: 'Paris 11e (75011), Île-de-France : éducation populaire, animation, projets jeunesse.'},
 {title: 'MJC de Gaillac - Maison des Jeunes et de la Culture', url: 'https://www.mjc-gaillac.fr/', description: 'Animation, éducation populaire et projets jeunesse à Gaillac, Tarn.'},
 {title: 'Qu\'est-ce que le DEJEPS ASEC ? Débouchés et salaire', url: 'https://www.metiers-animation.fr/blog/dejeps-asec', description: 'Tout savoir sur le DEJEPS animation socio-éducative : coordination de projets, alternance.'},
 {title: 'Centre social de Gaillac : projets et partenariats', url: 'https://www.ladepeche.fr/2026/09/01/centre-social-gaillac.html', description: 'Le centre social développe ses projets d\'animation et d\'éducation populaire.'},
];

test('Anaïs replay — only real, in-zone, non-excluded organizations become candidates', async () => {
 const {repo, urls} = await runSearch(ANAIS_RESULTS);
 const candidates = repo.saved.filter(c => meta(c).source_class === 'COMPANY_CANDIDATE').map(c => c.name).sort();
 assert.deepEqual(candidates, ['Fédération ADMR du Tarn', 'MJC de Gaillac']);
 const byUrl = (u: string) => repo.saved.find(c => c.source_url === u)!;
 assert.equal(meta(byUrl('https://www.trajectoire-formation.com/formations/dejeps-asec')).admissibility.reason_code, 'TRAINING_COURSE_PAGE');
 assert.equal(meta(byUrl('https://www.trajectoire-formation.com/')).admissibility.reason_code, 'EXCLUDED_BY_QUERY');
 assert.equal(meta(byUrl('https://www.annuaire-mairie.fr/mairie-gaillac.html')).admissibility.reason_code, 'DIRECTORY_PAGE');
 assert.equal(meta(byUrl('https://fr.indeed.com/q-animation-l-gaillac-emplois.html')).admissibility.reason_code, 'ENTITY_UNRESOLVED');
 assert.equal(meta(byUrl('https://www.horizons-jeunesse.org/actualites/recrutement-alternance')).admissibility.reason_code, 'LOCATION_MISMATCH');
 assert.notEqual(meta(byUrl('https://www.metiers-animation.fr/blog/dejeps-asec')).source_class, 'COMPANY_CANDIDATE');
 // A place is never an organization ("Centre social de Gaillac" on a news site names no specific entity beyond the place).
 assert.notEqual(meta(byUrl('https://www.ladepeche.fr/2026/09/01/centre-social-gaillac.html')).company_name, 'Gaillac');
 // Every non-candidate is IRRELEVANT (out of the main list, never acceptable) — no "entreprise non résolue" is actionable.
 for (const c of repo.saved) assert.ok(['COMPANY_CANDIDATE', 'IRRELEVANT'].includes(meta(c).source_class));
 // The exclusion clause never reaches Brave; still exactly one request.
 assert.equal(urls.length, 1);
 const q = new URL(urls[0]!).searchParams.get('q')!;
 assert.doesNotMatch(q, /exclure|DEJEPS|organismes de formation/i);
 assert.match(q, /Structures employeuses autour de Gaillac/);
});

test('query exclusions: parsed from natural language, removed from the search terms', () => {
 assert.ok(ANAIS_QUERY_SHORT.length <= 250);
 const {exclusions, cleanedQuery} = parseQueryExclusions(ANAIS_QUERY);
 assert.ok(exclusions.pageTypes.has('TRAINING_PROVIDER') && exclusions.pageTypes.has('TRAINING_COURSE_PAGE'));
 assert.deepEqual(exclusions.keywords, ['dejeps']);
 assert.doesNotMatch(cleanedQuery, /Exclure|DEJEPS/);
 assert.match(cleanedQuery, /Chercher des signaux de recrutement/);
 assert.deepEqual(parseQueryExclusions('agences marketing à Lyon, sauf annuaires et job boards').exclusions.pageTypes, new Set(['DIRECTORY', 'GOVERNMENT_OR_PUBLIC_DIRECTORY', 'THIRD_PARTY_JOB_BOARD']));
 assert.equal(parseQueryExclusions('restaurants burger Toulouse').cleanedQuery, 'restaurants burger Toulouse');
});

test('Cas 10 — evidence invariants: the gate never creates VERIFIED evidence, never scores, never forges a source', async () => {
 const {repo} = await runSearch(ANAIS_RESULTS);
 for (const c of repo.saved) {
  const m = meta(c);
  assert.notEqual(m.company_name_status, 'VERIFIED');
  assert.notEqual(m.company_domain_status, 'VERIFIED');
  assert.ok(!('review_status' in m) && !('evidence' in m) && !('score' in m));
  assert.ok(ANAIS_RESULTS.some(r => r.url === c.source_url), 'every source is a page the search actually returned');
 }
 assert.equal(scoreProspect(DEFAULT_CRITERIA, []).score, 0, 'no evidence -> score 0');
 for (const f of ['../src/discovery/admissibility.ts', '../src/discovery/geo-fr.ts']) {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.doesNotMatch(src, /review_status|scoreProspect|from ['"][^'"]*evidence|fetch\(/, `${f} stays out of evidence, scoring and network`);
 }
});

// Traps found by replaying the 174 real Brave results stored in production (read-only).
test('real-data trap — ordinary words "but"/"cap" are not diplomas: a retail news title is never a course page', () => {
 const c = normalize({title: 'Lidl : découvrez la liste complète des nouveaux magasins qui ouvriront en 2026, but et cap du groupe', url: 'https://www.example-media.fr/actualites/lidl-nouveaux-magasins', description: 'L’enseigne ouvre de nouveaux magasins.'}, 'enseignes ouvrant de nouveaux magasins', 'France');
 assert.notEqual(meta(c).page_type, 'TRAINING_COURSE_PAGE');
 assert.equal(c.name, 'Lidl');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
});
test('real-data trap — a job platform naming only itself is never an employer', () => {
 for (const hit of [
  {title: 'Missions freelance et emplois Marketing | Free-Work', url: 'https://www.free-work.com/fr/marketing', description: 'Missions freelance marketing.'},
  {title: 'Recrutement freelance marketing, com & digital | Find Your Talent', url: 'https://www.findyourtalent.fr/recrutement', description: 'Recrutement freelance marketing.'},
 ]) {
  const c = normalize(hit, 'freelance marketing', 'France');
  assert.equal(meta(c).source_class, 'IRRELEVANT');
  assert.equal(meta(c).admissibility.reason_code, 'ENTITY_UNRESOLVED');
 }
});
