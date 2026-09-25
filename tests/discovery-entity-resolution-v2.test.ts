import test from 'node:test';
import assert from 'node:assert/strict';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {canonicalOrganizationName,entityCore,labeledOrganizations,sameCanonicalOrganization} from '../src/discovery/admissibility.ts';
import {scoreProspect,DEFAULT_CRITERIA} from '../src/domain/core.ts';
import type {Candidate} from '../src/discovery/types.ts';
import type {Identity} from '../src/discovery/deduplication.ts';

// Entity resolution V2 — a source that is never a prospect (job board, public job site, directory,
// article) can still NAME an organization explicitly; that organization, not the source, becomes the
// candidate. Fixtures reproduce the production test of 2026-09-24 (Anaïs: 10 results, 0 candidate, the
// employer "COMMUNAUTE D'AGGLOMERATION GAILLAC-GRAULHET" explicitly named but never resolved). Real
// BraveProvider + real resolution/gate code, fake fetch, no network. Nothing here is specific to that case.
const QUERY = 'Structures employeuses autour de Gaillac pour alternance en coordination de projets. Prioriser animation, éducation populaire, social et médico-social. Exclure organismes de formation et pages DEJEPS.';
const ZONE = 'Gaillac, Tarn (81)';
const provider = new BraveProvider('test-key');
type Meta = Record<string, any>;
function normalize(hit: {title: string; url: string; description?: string}, query = QUERY, location = ZONE): Candidate {
 const raw: Record<string, unknown> = {...hit};
 raw.__quality = assessCandidateQuality(hit, location);
 raw.__context = {query, categories: [], location};
 return provider.normalizeResult(raw);
}
const meta = (c: Candidate) => c.raw_metadata as Meta;

const FT_AGGLO = {title: 'AGENT POLYVALENT RESTAURATION ENTRETIEN ET ANIMATION - COMMUNAUTE D\'AGGLOMERATION GAILLAC-GRAULHET (H/F)', url: 'https://candidat.francetravail.fr/offres/recherche/detail/188ABCD', description: 'Animation périscolaire, entretien, Gaillac (81).'};
const PUBLIC_AGGLO = {title: 'Atsem animateur.trice - communauté d\'agglomération gaillac-graulhet', url: 'https://choisirleservicepublic.gouv.fr/offre-emploi/atsem-animateurtrice-reference-2026-123456/', description: 'Communauté d\'agglomération Gaillac-Graulhet, Tarn : animation, écoles.'};
const OFFICIAL_AGGLO = {title: 'Communauté d\'agglomération Gaillac-Graulhet - Site officiel', url: 'https://www.gaillac-graulhet.fr/', description: 'L\'agglomération du Tarn : animation, enfance, jeunesse, social, recrutement.'};

test('TEST A — generic Indeed listing: no explicit employer, no prospect', () => {
 for (const hit of [
  {title: 'Social, Gaillac (81) : plus de 25 emplois | Indeed', url: 'https://fr.indeed.com/q-social-l-gaillac-(81)-emplois.html', description: 'Plus de 25 emplois social à Gaillac.'},
  {title: 'Emplois : Social, 81600 Gaillac - 12 mars 2026 | Indeed', url: 'https://fr.indeed.com/q-social-l-81600-gaillac-emplois.html', description: 'Social, 81600 Gaillac : offres d\'emploi.'},
 ]) {
  const c = normalize(hit);
  assert.equal(meta(c).source_class, 'IRRELEVANT');
  assert.equal(meta(c).admissibility.reason_code, 'ENTITY_UNRESOLVED');
  assert.equal(meta(c).entity_confidence, 'UNRESOLVED');
  assert.equal(meta(c).company_name, null);
 }
});

test('TEST B — France Travail naming COMMUNAUTE D\'AGGLOMERATION GAILLAC-GRAULHET (H/F): the employer is extracted, France Travail never is', () => {
 const c = normalize(FT_AGGLO);
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(c.name, 'Communauté d\'Agglomération Gaillac-Graulhet');
 assert.equal(meta(c).company_name_method, 'job_title_employer');
 assert.equal(meta(c).entity_confidence, 'RESOLVED_MEDIUM');
 assert.equal(c.website, null, 'no website is claimed from a job board');
 assert.equal(meta(c).source_domain, 'francetravail.fr', 'the source stays attached as provenance');
 assert.equal(c.source_url, FT_AGGLO.url);
 assert.doesNotMatch(c.name, /france ?travail/i);
});

test('TEST C — the public job site naming the same organization resolves to the same canonical entity', () => {
 const ft = normalize(FT_AGGLO), pub = normalize(PUBLIC_AGGLO);
 assert.equal(meta(pub).page_type, 'GOVERNMENT_OR_PUBLIC_DIRECTORY', 'the page itself stays a public-site page');
 assert.equal(meta(pub).source_class, 'COMPANY_CANDIDATE');
 assert.equal(pub.name, ft.name);
 assert.equal(entityCore(pub.name), entityCore(ft.name));
 assert.ok(sameCanonicalOrganization('COMMUNAUTE D\'AGGLOMERATION GAILLAC-GRAULHET', 'communauté d\'agglomération gaillac-graulhet'));
});

class Repo implements DiscoveryRepository {
 saved: Candidate[] = []; dedupe: Array<{status: string; reason: string}> = []; known: Identity[] = []; metrics: Record<string, unknown> = {};
 async start() { return {id: 'run-1', provider: 'brave', status: 'running', result_count: 0, error_message: null}; }
 async existing() { return this.known; }
 async saveResults(_r: unknown, rows: {candidate: Candidate; dedupe: {status: string; reason: string}}[]) { this.saved = rows.map(r => r.candidate); this.dedupe = rows.map(r => r.dedupe); return rows.map((r, i) => ({id: String(i), normalized_payload: r.candidate, dedupe_status: r.dedupe.status as 'unique', duplicate_of: null, status: 'pending' as const, prospect_id: null})); }
 async finish(_id: string, _n: number, metrics: Record<string, unknown>) { this.metrics = metrics; }
 async prospect(): Promise<never> { throw Error('unused'); }
 async projectCriteria() { return []; }
 async consumeAnalysis() {}
 async saveObservations() { return []; }
}
async function run(results: unknown[], known: Identity[] = []) {
 const brave = new BraveProvider('KEY', (async () => new Response(JSON.stringify({web: {results}}), {status: 200})) as unknown as typeof fetch);
 const repo = new Repo(); repo.known = known;
 await new DiscoveryService(repo, brave).find_prospects({project_id: 'p', query: QUERY, location: ZONE, categories: [], max_results: 20});
 return repo;
}

test('TEST D — France Travail + public job site + official site: ONE candidate, official website, all sources kept', async () => {
 const repo = await run([FT_AGGLO, PUBLIC_AGGLO, OFFICIAL_AGGLO]);
 const candidates = repo.saved.filter(c => meta(c).source_class === 'COMPANY_CANDIDATE');
 assert.equal(candidates.length, 1);
 const agglo = candidates[0]!;
 assert.equal(agglo.name, 'Communauté d\'agglomération Gaillac-Graulhet', 'the official site\'s own spelling wins');
 assert.equal(agglo.website, 'https://www.gaillac-graulhet.fr');
 assert.equal(meta(agglo).entity_confidence, 'RESOLVED_HIGH');
 assert.deepEqual((meta(agglo).additional_sources as {source_url: string}[]).map(s => s.source_url).sort(), [FT_AGGLO.url, PUBLIC_AGGLO.url].sort());
 assert.equal(repo.metrics.entities_merged, 2);
});

test('TEST E — a generic directory of associations is never a candidate and names nobody', () => {
 for (const hit of [
  {title: 'Associations à Gaillac – Coordonnées et contact', url: 'https://www.net1901.org/associations/ville/Gaillac.html', description: 'Liste des associations de Gaillac (81600).'},
  {title: 'Mission locale Gaillac - Annuaire des missions locales', url: 'https://www.annuaire-mission-locale.fr/gaillac', description: 'Mission locale de Gaillac (81600).'},
  {title: 'Mairie de Gaillac 81600 - adresse et horaires', url: 'https://www.annuaire-mairie.fr/mairie-gaillac.html', description: 'Coordonnées de la mairie de Gaillac (Tarn).'},
  {title: 'Service-Public.fr | Le site officiel de l\'administration française', url: 'https://www.service-public.fr/', description: 'Démarches et informations administratives.'},
 ]) {
  const c = normalize(hit);
  assert.equal(meta(c).source_class, 'IRRELEVANT', hit.title);
  assert.equal(meta(c).company_name, null, hit.title);
 }
});

test('TEST F — DEJEPS / BAC Pro course pages and training providers never become prospects', () => {
 const course = normalize({title: 'BAC Pro SAPAT Services aux Personnes et Animation dans les Territoires – MFR Gaillac', url: 'https://www.mfr-gaillac.fr/formations/bac-pro-sapat', description: 'Formation en alternance à la MFR de Gaillac.'});
 assert.equal(meta(course).page_type, 'TRAINING_COURSE_PAGE');
 assert.equal(meta(course).source_class, 'IRRELEVANT');
 const dejeps = normalize({title: 'DEJEPS ASEC - Coordination de projet | Trajectoire Formation', url: 'https://www.trajectoire-formation.com/formations/dejeps-asec', description: 'Formation DEJEPS en alternance.'});
 assert.equal(meta(dejeps).source_class, 'IRRELEVANT');
 // A training institution named on a job board is still excluded when the query excludes training providers.
 const mfrAd = normalize({title: 'Moniteur animateur (H/F) - MFR de Gaillac - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/9.html', description: 'Animation, internat, Gaillac.'});
 assert.equal(meta(mfrAd).source_class, 'IRRELEVANT');
 assert.equal(meta(mfrAd).admissibility.reason_code, 'EXCLUDED_BY_QUERY');
 assert.equal(meta(mfrAd).company_name, 'MFR de Gaillac', 'still RESOLVED — excluded afterwards, never unresolved');
});

test('TEST G — a resolved organization explicitly outside the zone: MISMATCH, rejected', () => {
 const c = normalize({title: 'Animateur périscolaire (H/F) - COMMUNAUTE D\'AGGLOMERATION PARIS-SACLAY - Orsay (91)', url: 'https://candidat.francetravail.fr/offres/recherche/detail/199ZZZ', description: 'Animation, Orsay 91400, Essonne, Île-de-France.'});
 assert.equal(meta(c).company_name, 'Communauté d\'Agglomération Paris-Saclay');
 assert.equal(meta(c).location_state, 'MISMATCH');
 assert.equal(meta(c).admissibility.reason_code, 'LOCATION_MISMATCH');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 // UNKNOWN stays UNKNOWN: never promoted, never rejected for it.
 const unknown = normalize({title: 'Animateur (H/F) - Association Les Jardins Partagés', url: 'https://www.hellowork.com/fr-fr/emplois/7.html', description: 'Animation et éducation populaire.'});
 assert.equal(meta(unknown).location_state, 'UNKNOWN');
 assert.equal(meta(unknown).source_class, 'COMPANY_CANDIDATE');
});

test('TEST H — no organization can be named with certainty: UNRESOLVED, nothing invented', () => {
 for (const hit of [
  {title: 'Animateur social Gaillac', url: 'https://www.hellowork.com/fr-fr/emplois/11.html', description: 'Poste d\'animateur social à Gaillac.'},
  {title: 'Offre d\'emploi Animateurs(trices) accueil de loisirs - 81 - GAILLAC - 187QWXZ | France Travail', url: 'https://candidat.francetravail.fr/offres/recherche/detail/187QWXZ', description: 'Animation, accueil de loisirs, Gaillac (81).'},
  {title: 'Animateur (H/F) - Centre social - Gaillac (81)', url: 'https://www.hellowork.com/fr-fr/emplois/12.html', description: 'Animation Gaillac.'},
  {title: 'Chargé de projets (H/F) - Entreprise : non communiqué', url: 'https://www.hellowork.com/fr-fr/emplois/13.html', description: 'Coordination de projets, animation, Gaillac.'},
  {title: 'Créer son entreprise : les dispositifs d’aide à connaître | info.gouv.fr', url: 'https://www.info.gouv.fr/actualite/creer-son-entreprise', description: 'Animation économique.'},
  {title: 'Billets de concerts, festivals, open air, club & raves · Shotgun', url: 'https://shotgun.live/fr', description: 'Animation, soirées.'},
 ]) {
  const c = normalize(hit);
  assert.equal(meta(c).source_class, 'IRRELEVANT', hit.title);
  assert.equal(meta(c).entity_confidence, 'UNRESOLVED', hit.title);
  assert.equal(meta(c).company_name, null, hit.title);
 }
});

test('TEST I — named on a source + confirmed by its official site: candidate (RESOLVED_HIGH), score 0, no VERIFIED', async () => {
 const repo = await run([FT_AGGLO, OFFICIAL_AGGLO]);
 const [agglo] = repo.saved.filter(c => meta(c).source_class === 'COMPANY_CANDIDATE');
 assert.ok(agglo);
 assert.equal(meta(agglo).entity_confidence, 'RESOLVED_HIGH');
 assert.equal(agglo.website, 'https://www.gaillac-graulhet.fr');
 for (const c of repo.saved) {
  const m = meta(c);
  assert.notEqual(m.company_name_status, 'VERIFIED');
  assert.notEqual(m.company_domain_status, 'VERIFIED');
  assert.ok(!('review_status' in m) && !('score' in m) && !('evidence' in m));
 }
 assert.equal(scoreProspect(DEFAULT_CRITERIA, []).score, 0);
});

test('project dedup runs AFTER resolution: an organization already in the project is resolved, then flagged for review', async () => {
 const repo = await run([FT_AGGLO], [{id: 'prospect-1', name: 'Communauté d\'agglomération Gaillac-Graulhet', website: null, phone: null, address: null, city: null}]);
 const [c] = repo.saved;
 assert.equal(meta(c!).entity_confidence, 'RESOLVED_MEDIUM', 'still resolved');
 assert.equal(meta(c!).source_class, 'COMPANY_CANDIDATE');
 assert.equal(repo.dedupe[0]!.status, 'merge_review_required');
 assert.match(repo.dedupe[0]!.reason, /déjà présente dans ce projet/);
 // A generic name never matches on name alone.
 assert.equal(sameCanonicalOrganization('Centre social', 'centre social'), false);
});

test('extraction rules: labeled fields, CCAS on a host site, canonical display names', () => {
 assert.deepEqual(labeledOrganizations('Chargé de projets | Employeur : Association Les Amis du Tarn | CDD', 'hellowork.com'), ['Association Les Amis du Tarn']);
 assert.deepEqual(labeledOrganizations('Entreprise : non communiqué', 'hellowork.com'), []);
 assert.deepEqual(labeledOrganizations('Créer son entreprise : les dispositifs d’aide', 'info.gouv.fr'), []);
 const ccas = normalize({title: 'CCAS GAILLAC - Centre communal d\'action sociale', url: 'https://www.ville-gaillac.fr/ccas', description: 'Action sociale, accompagnement, Gaillac 81600.'});
 assert.equal(ccas.name, 'CCAS Gaillac');
 assert.equal(ccas.website, null, 'the host site is never claimed as the named organization\'s website');
 assert.equal(meta(ccas).entity_confidence, 'RESOLVED_MEDIUM');
 assert.equal(canonicalOrganizationName('COMMUNAUTE D\'AGGLOMERATION GAILLAC-GRAULHET'), 'Communauté d\'Agglomération Gaillac-Graulhet');
 assert.equal(canonicalOrganizationName('communauté d\'agglomération gaillac-graulhet'), 'Communauté d\'Agglomération Gaillac-Graulhet');
 assert.equal(canonicalOrganizationName('FEDERATION ADMR DU TARN'), 'Fédération ADMR du Tarn');
 assert.equal(canonicalOrganizationName('MJC de Gaillac'), 'MJC de Gaillac', 'mixed case is kept exactly');
});
