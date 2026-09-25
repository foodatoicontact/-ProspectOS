import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {planSearchQueries,MAX_SEARCH_QUERIES} from '../src/discovery/query-plan.ts';
import {resolveMarket,BRAVE_COUNTRIES} from '../src/discovery/market.ts';
import type {Candidate,DiscoveryRun} from '../src/discovery/types.ts';

// Discovery Recall V3 — query shaping (A), first-party detection (B), deterministic multi-query (C).
// Benchmark "Export B2B — Maroc": the production run before V3 sent ONE 213-character query on country=FR
// and got 10 directory/marketplace pages and one company homepage misread as editorial -> 0 candidates.
const QUERY = 'Distributeurs et importateurs B2B au Maroc vendant des fournitures, équipements, mobilier ou consommables professionnels aux entreprises.';
const CATEGORIES = ['Fournitures pro', 'Équipements pro', 'Mobilier pro', 'Distribution B2B'];
const ZONE = 'Maroc';
const CONTEXT = {query: QUERY, categories: CATEGORIES, location: ZONE};
type Hit = {title: string; url: string; description?: string};
const meta = (c: Candidate) => c.raw_metadata as Record<string, any>;
// A Discovery candidate never carries a score, an evidence row or a review status. ("location_state":
// "VERIFIED" is the zone check of the page text, not an evidence status.)
function assertNoEvidence(c: Candidate) {
 const {location_state: _zone, ...rest} = meta(c);
 assert.doesNotMatch(JSON.stringify({...c, raw_metadata: rest}), /VERIFIED|"score|"evidence|review_status/);
}
const provider = new BraveProvider('test-key');
function normalize(hit: Hit): Candidate {
 const raw: Record<string, unknown> = {...hit};
 raw.__quality = assessCandidateQuality(hit, ZONE); raw.__context = CONTEXT;
 return provider.normalizeResult(raw);
}

// The 10 results stored in production for that run (title, URL, snippet as Brave returned them).
const MOROCCO_STORED: Hit[] = [
 {title: 'Distributeurs Maroc | Entreprises et fournisseurs B2B | europages', url: 'https://www.europages.fr/entreprises/maroc/distributeurs.html', description: 'chocolat valrhona prix usinedéstockage chaise de salle à mangerdistribution de creed iidistribution de sous écrous'},
 {title: 'Distributeurs en Maroc | Kompass', url: 'https://ma.kompass.com/x/distributor/', description: 'Recherche trop large · Depuis sa création en 2009, PLATINOVA n’a pas cessé d’évoluer. Aujourd’hui, elle occupe les premiers rangs parmi les grands spécialistes de distribution des produits de second œuvre.'},
 {title: 'Materiel Maroc | Entreprises et fournisseurs B2B | europages', url: 'https://www.europages.fr/entreprises/maroc/materiel.html', description: 'Kilym propose des produits artisanaux (décoration, art de la table, linge de maison, petit mobilier, bougies...) conçus à Marrakech.'},
 {title: 'Achat de produits Maroc | Entreprises et fournisseurs B2B | europages', url: 'https://www.europages.fr/entreprises/maroc/achat%20de%20produits.html', description: 'Kilym propose des produits artisanaux conçus à Marrakech avec des matières provenant du Maroc.'},
 {title: 'Entreprises Négoce, grande distribution, détaillants en Maroc | Trouver des fournisseurs | Kompass', url: 'https://ma.kompass.com/s/negoce-grande-distribution-detaillants/13/', description: 'Un grand choix de jeux et jouets, de services et de conseils aux consommateurs. grossiste importateur distributeur d’essence de parfum.'},
 {title: 'Votre fourniture de bureau en un clic Partout au Maroc Fourniture de bureau en 1 clic Fournipro.ma', url: 'https://www.fournipro.ma/', description: 'FOURNIPRO est votre spécialiste des fournitures professionnelles, des équipements informatiques, et des solutions pour les moyens généraux. Fort de la confiance de plus de 25 000 clients, dont 300 entreprises parmi les Top 500, nous proposons une offre complète de plus de 21 000 références.'},
 {title: 'Fournitures, matériel industriels (industries: fournitures et matériel) Maroc | Kerix, l\'annuaire professionnel du Maroc', url: 'https://www.kerix.net/fr/annuaire-entreprise/fournitures-materiel-industriels.html', description: 'Liste des fournisseurs pour Fournitures, matériel industriels (industries: fournitures et matériel) Maroc. Demande de devis, bonnes affaires, exportateurs... par Kerix, le leader du B2B au Maroc.'},
 {title: 'Annuaire Fournisseurs B2B au Maroc - Page 3 | Procurement.ma | Procurement.ma', url: 'https://procurement.ma/fournisseurs?page=3', description: 'ALMAJD PRO est un acteur de référence dans l’importation et la distribution d’équipements et fournitures professionnels au Maroc.'},
 {title: 'Fourniture de bureau: divers Maroc | Kerix, l\'annuaire professionnel du Maroc', url: 'https://www.kerix.net/fr/annuaire-entreprise/fourniture-de-bureau-divers.html', description: 'Liste des fournisseurs pour Fourniture de bureau: divers Maroc. Demande de devis, bonnes affaires, exportateurs... par Kerix, le leader du B2B au Maroc.'},
 {title: 'materiel-equipement Distributeur Maroc | Entreprises et fournisseurs B2B | europages', url: 'https://www.europages.fr/entreprises/maroc/distributeur/materiel-equipement.html', description: 'Tous fournisseurs pour materiel-equipement Distributeur Maroc ✓Recherchez des grossistes et contactez-les directement ✓Plateforme B2B ➤ Trouvez des entreprises dès maintenant !'},
];

// ============================================================
// 1. Morocco stored replay
// ============================================================
test('Morocco replay — Fournipro becomes its own first-party organization; every directory stays a non-prospect', () => {
 const out = MOROCCO_STORED.map(normalize);
 const candidates = out.filter(c => meta(c).source_class === 'COMPANY_CANDIDATE');
 assert.deepEqual(candidates.map(c => [c.name, c.website, meta(c).entity_confidence, meta(c).page_type]), [['Fournipro', 'https://www.fournipro.ma', 'RESOLVED_HIGH', 'OFFICIAL_ORGANIZATION_SITE']]);
 for (const c of out.filter(c => !c.source_url.includes('fournipro'))) {
  assert.equal(meta(c).source_class, 'IRRELEVANT', c.source_url);
  assert.equal(meta(c).page_type, 'DIRECTORY', c.source_url);
  assert.equal(meta(c).admissibility.reason_code, 'DIRECTORY_PAGE', c.source_url);
  assert.equal(c.website, null);
 }
 // D stays out of scope: organizations merely named in a directory snippet are never extracted.
 for (const name of ['PLATINOVA', 'Kilym', 'ALMAJD PRO']) assert.ok(!out.some(c => c.name.includes(name) && meta(c).source_class === 'COMPANY_CANDIDATE'), name);
 // Evidence invariants: nothing verified, nothing scored at Discovery time.
 for (const c of out) assertNoEvidence(c);
});

test('editorial fix — "Top 500" in a company snippet no longer makes its homepage editorial; a ranking title still does', () => {
 const fournipro = assessCandidateQuality(MOROCCO_STORED[5]!, ZONE);
 assert.equal(fournipro.signal, 'likely_business_site');
 assert.ok(fournipro.reasons.includes('title_domain_match'));
 assert.equal(assessCandidateQuality({title: 'Top 10 des fournisseurs de bureau au Maroc', url: 'https://www.exemple-media.ma/'}, ZONE).signal, 'editorial_pattern');
 assert.equal(assessCandidateQuality({title: 'Les meilleurs grossistes - Guide 2026', url: 'https://acme.fr/'}, ZONE).signal, 'editorial_pattern');
 assert.equal(assessCandidateQuality({title: 'La liste des festivals indépendants - OPUS Musiques', url: 'https://www.opus-musiques.fr/'}, ZONE).signal, 'editorial_pattern');
});

// ============================================================
// 4. First-party sample (audit: V2 recognized 8/17)
// ============================================================
const FIRST_PARTY: Array<[string, string, string | null]> = [
 ['Herba, référence en fourniture industrielle au Maroc', 'https://herbamaroc.com/distributeur-industriel-maroc/', 'Herba'],
 ['HERBA - votre partenaire en fourniture industrielle au Maroc', 'https://herbamaroc.com/', 'Herba'],
 ['Votre fourniture de bureau en un clic Partout au Maroc Fourniture de bureau en 1 clic Fournipro.ma', 'https://www.fournipro.ma/', 'Fournipro'],
 ['A Propos - Fournituk || Distributeur de Fournitures de Bureau, Papeterie et Matériel Informatique', 'https://fournituk.com/a-propos/', 'Fournituk'],
 ['Fourniture de Bureau au Maroc - Big Office Maroc', 'https://bigoffice.ma/fourniture-de-bureau-au-maroc/', 'Big Office Maroc'],
 ['Fournitures de bureau au Maroc - Casablanca - Rabat', 'https://fournishop.ma/', 'Fournishop'],
 ['Marconsom - Fournitures de Bureau et Matériel Informatique pour Entreprises à Casablanca', 'https://marconsom.com/', 'Marconsom'],
 ['Marocfourniture Votre spécialiste de fournitures de bureau à Casablanca.', 'https://marocfourniture.com/', 'Marocfourniture'],
 ['SDFI Maroc - Fournitures Industrielles et Équipements de ...', 'https://sdfi.ma/', 'SDFI Maroc'],
 ['AVAL – Équipements et Fournitures industrielles', 'http://aval.ma/', 'Aval'],
 ['Votre partenaire d\'équipements et fournitures industrielles - Outicom', 'https://outicom.com/', 'Outicom'],
 ['ALSTENA Industrie - distributeur fournitures industrielles au Maroc', 'https://alstena.com/', 'ALSTENA Industrie'],
 // Still missed, by design: "Sky" only resembles skygroupe.ma; a brand sub-page 2 levels deep is not the site.
 ['Distribution de matériel industriel de qualité au Maroc - Sky', 'https://www.skygroupe.ma/', null],
 ['MAROC BUREAU, N°1 du mobilier professionnel au Maroc', 'https://www.marocbureau.ma/', 'Maroc Bureau'],
 ['Mobilier de bureau Casablanca Maroc, sur mesure - Cobureau', 'https://www.cobureau.ma/', 'Cobureau'],
 ['Importateur distributeur du mobilier de bureau au maroc', 'https://www.cobureau.ma/brand/1-co-bureau', null],
 ['Mobilier de Bureau sur mesure, L\'Art de Création Unique – Delta Bureau', 'https://www.deltabureau.ma/', 'Delta Bureau'],
];
test('first-party sample — 15/17 own sites recognized (V2: 8/17), each named from its title, never from a tagline', () => {
 let recognized = 0;
 for (const [title, url, name] of FIRST_PARTY) {
  const c = normalize({title, url});
  if (name === null) { assert.notEqual(meta(c).source_class, 'COMPANY_CANDIDATE', url); continue; }
  assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE', url);
  assert.equal(c.name, name, url);
  assert.equal(c.website, new URL(url).origin);
  assert.equal(meta(c).entity_confidence, 'RESOLVED_HIGH');
  recognized++;
 }
 assert.equal(recognized, 15);
});

// ============================================================
// Negative signals keep priority over title <-> domain corroboration.
// ============================================================
test('a directory, job board, social profile, article or course page naming its own domain never becomes first-party', () => {
 const cases: Hit[] = [
  {title: 'Fourniture industrielle à Casablanca,Telecontact les pages jaunes du maroc', url: 'https://www.telecontact.ma/liens/fourniture-industrielle/casablanca.php'},
  {title: 'Annonces B2B professionnels Import Export au Maroc | Bikhirbusiness.ma', url: 'https://www.bikhirbusiness.ma/'},
  {title: 'Annuaire des entreprises du Maroc - Kerix.net', url: 'https://www.kerix.net/'},
  {title: 'Europages - Entreprises et fournisseurs B2B en Europe et dans le monde', url: 'https://www.europages.fr/'},
  {title: 'Emplois : distributeur fournitures Maroc - Indeed.com', url: 'https://ma.indeed.com/'},
  {title: 'Fournipro Maroc | LinkedIn', url: 'https://www.facebook.com/fournipro'},
  {title: 'Grossistes au Maroc : la liste complète - Lematin.ma', url: 'https://lematin.ma/economie/grossistes-maroc-2026'},
  {title: 'Pourquoi choisir un distributeur B2B ? - Acme Distribution', url: 'https://www.acmedistribution.ma/blog/pourquoi-distributeur'},
  {title: 'BTS Négociation et digitalisation de la relation client - Ecole Commerce Maroc', url: 'https://www.ecolecommerce.ma/formations/bts-ndrc'},
 ];
 for (const hit of cases) assert.notEqual(meta(normalize(hit)).source_class, 'COMPANY_CANDIDATE', hit.url);
});

test('an article on a site whose title ends with the site name stays content: the promotion is for the root or an about/contact page only', () => {
 const article = normalize({title: 'Distributeurs de fournitures au Maroc : les nouveaux acteurs du marché en pleine croissance - Opus Business', url: 'https://www.opusbusiness.ma/distributeurs-fournitures-maroc/'});
 assert.notEqual(meta(article).page_type, 'OFFICIAL_ORGANIZATION_SITE');
 assert.notEqual(meta(article).source_class, 'COMPANY_CANDIDATE');
});

test('a generic domain spelled by the query words never becomes an organization name', () => {
 const c = normalize({title: 'Fournitures pro au Maroc, livraison rapide partout dans le Royaume - Fournitures', url: 'https://www.fournitures.ma/'});
 assert.notEqual(meta(c).source_class, 'COMPANY_CANDIDATE');
});

// ============================================================
// 5. Query generation + country
// ============================================================
test('Morocco benchmark queries — 3 short, complementary queries, each with the zone, no "site officiel"', () => {
 const plan = planSearchQueries({query: QUERY, location: ZONE, categories: CATEGORIES});
 assert.deepEqual(plan.queries, ['distributeurs fournitures pro maroc', 'importateurs b2b équipements pro maroc', 'distributeurs mobilier pro maroc']);
 for (const q of plan.queries) { assert.ok(q.length <= 60); assert.match(q, /maroc$/); assert.doesNotMatch(q, /site officiel/); }
});

test('query generation is generic — any sector, any country, never more than 3, never trivial duplicates', () => {
 const cases = [
  {query: 'Agences marketing B2B', location: 'Lyon', categories: ['SEO', 'SEA', 'Social ads', 'Branding']},
  {query: 'Cabinets d\'expertise comptable à Toulouse', location: 'Toulouse', categories: []},
  {query: 'Software companies selling HR tools to SMBs', location: 'Germany', categories: ['HR software', 'Payroll']},
  {query: 'Entreprises en France qui recherchent des freelances Paid Media pour des missions longues ou récurrentes', location: 'France', categories: []},
  {query: 'Structures employeuses autour de Gaillac pour une alternante en coordination de projets : animation, éducation populaire, social. Exclure organismes de formation et pages DEJEPS.', location: 'Gaillac, Tarn (81)', categories: []},
 ];
 for (const input of cases) {
  const {queries} = planSearchQueries(input);
  assert.ok(queries.length >= 1 && queries.length <= MAX_SEARCH_QUERIES, input.query);
  assert.equal(new Set(queries).size, queries.length);
  const zoneWord = input.location.split(/[ ,(]/)[0]!.toLowerCase();
  for (const q of queries) { assert.ok(q.includes(zoneWord), `${q} keeps the zone`); assert.doesNotMatch(q, /exclure|dejeps|organismes de formation/); }
 }
 assert.deepEqual(planSearchQueries(cases[1]!).queries, ['cabinets expertise comptable toulouse']);
});

test('near-identical queries are sent once ("fournisseur équipement" / "fournisseurs équipements")', () => {
 const plan = planSearchQueries({query: 'fournisseur équipement', location: 'Maroc', categories: ['fournisseurs équipements', 'Fournisseur Équipements', 'fournisseurs équipement']});
 assert.deepEqual(plan.queries, ['fournisseur équipement maroc']);
});

test('country — France keeps FR, a foreign zone Brave does not serve is never FR, an unknown zone is neutral', () => {
 assert.deepEqual(resolveMarket('France'), {country: 'FR', reason: 'zone_country'});
 assert.equal(resolveMarket('Toulouse, occitanie').country, 'FR');
 assert.equal(resolveMarket('Gaillac, Tarn (81)').country, 'FR');
 assert.equal(resolveMarket('Paris').country, 'FR');
 for (const zone of ['Maroc', 'Casablanca, Maroc', 'Tunisie', 'Sénégal', 'Afrique du Nord']) assert.deepEqual(resolveMarket(zone), {country: 'ALL', reason: 'zone_unknown'}, zone);
 assert.equal(resolveMarket('Zone inconnue XYZ').country, 'ALL');
 assert.deepEqual(resolveMarket('Valence, Espagne'), {country: 'ES', reason: 'zone_country'});
 assert.equal(resolveMarket('Belgique').country, 'BE');
 assert.equal(resolveMarket('Paris, Texas, United States').country, 'US');
 assert.deepEqual(resolveMarket('Belgique ou France'), {country: 'ALL', reason: 'zone_ambiguous'}, 'two countries: no guess');
 // Explicit filter: honored only when Brave supports it — MA is not a Brave market.
 assert.ok(!BRAVE_COUNTRIES.has('MA'));
 assert.deepEqual(resolveMarket('Maroc', 'MA'), {country: 'ALL', reason: 'explicit_country_unsupported'});
 assert.equal(resolveMarket('Maroc', 'FR').country, 'FR');
});

test('the Brave requests for the Morocco benchmark carry country=ALL, never FR', async () => {
 const sent: URL[] = [];
 const brave = new BraveProvider('k', (async (url: URL) => { sent.push(new URL(String(url))); return Response.json({web: {results: []}}); }) as unknown as typeof fetch);
 await brave.searchCompanies({project_id: 'p', query: QUERY, location: ZONE, categories: CATEGORIES, max_results: 10, optional_filters: {}});
 assert.equal(sent.length, 3);
 for (const url of sent) { assert.equal(url.searchParams.get('country'), 'ALL'); assert.equal(url.searchParams.get('count'), '20'); }
 assert.deepEqual(sent.map(u => u.searchParams.get('q')), ['distributeurs fournitures pro maroc', 'importateurs b2b équipements pro maroc', 'distributeurs mobilier pro maroc']);
});

// ============================================================
// 6. Metering, partial failure — 7. Merge / dedup
// ============================================================
class Repo implements DiscoveryRepository {
 saved: Candidate[] = []; finished: Array<{metrics: Record<string, unknown>; error?: string}> = [];
 async start() { return {id: 'run-1', provider: 'brave', status: 'running', result_count: 0, error_message: null}; }
 async existing() { return []; }
 async saveResults(_run: unknown, rows: {candidate: Candidate}[]) { this.saved = rows.map(r => r.candidate); return rows.map((r, i) => ({id: String(i), normalized_payload: r.candidate, dedupe_status: 'unique' as const, duplicate_of: null, status: 'pending' as const, prospect_id: null})); }
 async finish(_id: string, _n: number, metrics: Record<string, unknown>, error?: string) { this.finished.push({metrics, error}); }
 async prospect(): Promise<never> { throw Error('unused'); }
 async projectCriteria() { return []; }
 async consumeAnalysis() {}
 async saveObservations() { return []; }
}
// responses[i]: what the i-th Brave request returns (a result list, or an HTTP status to fail with).
function run(input: {query: string; location: string; categories: string[]}, responses: Array<Hit[] | number>) {
 let calls = 0;
 const brave = new BraveProvider('BRAVE-KEY-SECRET', (async () => { const r = responses[calls++]!; return typeof r === 'number' ? new Response('{}', {status: r}) : Response.json({web: {results: r}}); }) as unknown as typeof fetch);
 const repo = new Repo(); const logs: Record<string, unknown>[] = []; const metered: number[] = [];
 const service = new DiscoveryService(repo, brave, e => logs.push(e), async (_run: DiscoveryRun, n: number) => { metered.push(n); });
 return {repo, logs, metered, calls: () => calls, done: service.find_prospects({project_id: 'p', ...input, max_results: 10})};
}
const MOROCCO = {query: QUERY, location: ZONE, categories: CATEGORIES};
const fp = (n: number): Hit => ({title: `Distributeur ${n} - Fournitures pro`, url: `https://distrib-${n}.ma/`, description: `Distributeur ${n} : fournitures et équipements professionnels au Maroc.`});

for (const [label, input, expected] of [
 ['1 request', {query: 'Cabinets d\'expertise comptable à Toulouse', location: 'Toulouse', categories: []}, 1],
 ['2 requests', {query: 'Distributeurs B2B au Maroc', location: 'Maroc', categories: ['Fournitures pro', 'Mobilier pro']}, 2],
 ['3 requests', MOROCCO, 3],
] as const) {
 test(`metering — ${label}: the exact number of Brave requests sent is recorded, once`, async () => {
  const r = run(input, [[fp(1)], [fp(2)], [fp(3)]]);
  await r.done;
  assert.equal(r.calls(), expected);
  assert.deepEqual(r.metered, [expected]);
  assert.equal(r.repo.finished[0]!.metrics.search_requests, expected);
  assert.equal(r.repo.finished[0]!.metrics.search_requests_failed, 0);
 });
}

test('partial failure — 2 queries succeed, 1 fails: the run completes on real results, 3 requests are metered, the failure is observable', async () => {
 const r = run(MOROCCO, [[fp(1)], 500, [fp(3)]]);
 const found = await r.done;
 assert.equal(found.status, 'completed');
 assert.deepEqual(r.metered, [3]);
 assert.deepEqual(r.repo.saved.map(c => c.website).sort(), ['https://distrib-1.ma', 'https://distrib-3.ma']);
 const m = r.repo.finished[0]!.metrics;
 assert.equal(m.search_requests, 3); assert.equal(m.search_requests_failed, 1); assert.equal(m.search_failure_codes, 'BRAVE_HTTP_500'); assert.equal(m.search_country, 'ALL');
 const partial = r.logs.find(l => l.event === 'search_partial_failure')!;
 assert.equal(partial.search_requests_failed, 1);
 const text = JSON.stringify(r.logs); for (const secret of ['BRAVE-KEY-SECRET', 'distrib-', 'maroc']) assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `log must not contain ${secret}`);
});

test('every query fails — DISCOVERY_FAILED, nothing invented, and the requests really sent are still metered', async () => {
 const r = run(MOROCCO, [500, 502, 503]);
 await assert.rejects(r.done, /DISCOVERY_FAILED/);
 assert.deepEqual(r.metered, [3]);
 assert.equal(r.repo.finished[0]!.error, 'DISCOVERY_FAILED');
 assert.equal(r.repo.finished[0]!.metrics.search_requests_failed, 3);
 assert.deepEqual(r.repo.saved, []);
});

test('a rate limit (429) stops the remaining queries instead of spending them', async () => {
 const r = run(MOROCCO, [[fp(1)], 429, [fp(3)]]);
 await r.done;
 assert.equal(r.calls(), 2);
 assert.deepEqual(r.metered, [2]);
});

test('merge — the same organization found by Q1, Q2 and Q3 (same page, other pages of its site) is ONE candidate with its provenance', async () => {
 const home = {title: 'Fournipro - Fournitures professionnelles au Maroc', url: 'https://www.fournipro.ma/', description: 'FOURNIPRO : fournitures et équipements professionnels.'};
 const about = {title: 'A propos - Fournipro', url: 'https://fournipro.ma/a-propos', description: 'Fournipro, distributeur de fournitures professionnelles au Maroc.'};
 const r = run(MOROCCO, [[home, fp(1)], [{...home, url: 'https://fournipro.ma/?utm_source=x'}, about], [home, fp(2)]]);
 await r.done;
 const fournipro = r.repo.saved.filter(c => c.website?.includes('fournipro'));
 assert.equal(fournipro.length, 1);
 assert.equal(fournipro[0]!.name, 'Fournipro');
 assert.deepEqual(meta(fournipro[0]!).search_queries, ['distributeurs fournitures pro maroc', 'importateurs b2b équipements pro maroc', 'distributeurs mobilier pro maroc']);
 assert.equal(meta(fournipro[0]!).additional_sources.length, 1, 'the about page is kept as a second source');
 assert.equal(r.repo.saved.length, 3);
});

test('scoring/evidence invariants — a V3 candidate carries no score, no evidence and no VERIFIED status', async () => {
 const r = run(MOROCCO, [MOROCCO_STORED, MOROCCO_STORED, MOROCCO_STORED]);
 await r.done;
 for (const c of r.repo.saved) assertNoEvidence(c);
 const candidates = r.repo.saved.filter(c => meta(c).source_class === 'COMPANY_CANDIDATE');
 assert.deepEqual(candidates.map(c => c.name), ['Fournipro']);
 // Same page returned by all 3 queries: stored once.
 assert.equal(new Set(r.repo.saved.map(c => c.source_url)).size, r.repo.saved.length);
});

test('scope — geo-fr.ts, scoring and the DB schema are untouched by V3', () => {
 const plan = readFileSync(new URL('../src/discovery/query-plan.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/discovery/market.ts', import.meta.url), 'utf8');
 for (const specific of [/fournipro/i, /manutan/i, /douglas/i, /anaïs|anais/i, /foodatoi/i, /\bmaroc\b/i, /\bmorocco\b/i]) assert.doesNotMatch(plan, specific);
});
