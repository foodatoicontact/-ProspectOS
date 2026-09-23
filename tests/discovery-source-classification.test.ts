import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';

// ============================================================
// HOTFIX DISCOVERY QUALITY — a search result that is semantically relevant must never be mistaken for a
// company. Every fixture below goes through the real BraveProvider.normalizeResult, tagged exactly the
// way searchCompanies tags it (quality assessment + the user's own query context), so these tests pin
// the production path, not a helper. Hosts/titles are either the real smoke-test observations
// (Indeed, kerline.fr, free-work, malt, lacollab) or deliberately unknown hosts, to prove the
// classification is structural and never depends on a domain list alone.
// ============================================================
type Hit = {title: string; url: string; description?: string};
const provider = new BraveProvider('test');
function normalize(hit: Hit, query: string, categories: string[] = []) {
 return provider.normalizeResult(Object.assign({}, hit, {__quality: assessCandidateQuality(hit, 'France'), __context: {query, categories}}));
}
const meta = (c: ReturnType<typeof normalize>) => c.raw_metadata as Record<string, unknown>;

// ------------------------------------------------------------
// A — an organization's own website can become a COMPANY_CANDIDATE.
// ------------------------------------------------------------
test('A — official site: lacollab.com homepage is a COMPANY_CANDIDATE whose name is corroborated by its own domain', () => {
 const c = normalize({title: 'La Collab — Agence de collaboration créative', url: 'https://lacollab.com/', description: 'Agence créative spécialisée en marketing digital et contenus.'}, 'agence marketing digital');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(meta(c).source_type, 'official_site');
 assert.equal(meta(c).company_name, 'La Collab');
 assert.equal(meta(c).company_domain, 'lacollab.com');
 assert.equal(c.website, 'https://lacollab.com');
});
test('A — official site with an SEO-style title: the company name comes from the domain, never from the SEO title', () => {
 const c = normalize({title: 'Plombier Toulouse — Dépannage 24/7', url: 'https://www.plomberie-martin.fr/', description: 'Plombier à Toulouse, dépannage rapide.'}, 'plombier toulouse');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(meta(c).company_name, 'Plomberie Martin', 'an uncorroborated SEO title is never used as the company name');
 assert.notEqual(c.name, 'Plombier Toulouse');
});

// ------------------------------------------------------------
// B — a job board ad about an identifiable company: the job board is never the prospect; it can only
// be a SIGNAL_SOURCE attached to the company that is explicitly named.
// ------------------------------------------------------------
test('B — Indeed ad "… chez Grand Frais": SIGNAL_SOURCE for Grand Frais, company_domain never indeed.com', () => {
 const c = normalize({title: 'Chargé de marketing digital H/F chez Grand Frais - Lyon | Indeed', url: 'https://fr.indeed.com/viewjob?jk=abc123', description: 'Poste en CDI basé à Lyon.'}, 'marketing digital');
 assert.equal(meta(c).source_class, 'SIGNAL_SOURCE');
 assert.equal(meta(c).source_type, 'job_board');
 assert.equal(meta(c).company_name, 'Grand Frais');
 assert.equal(meta(c).company_domain, null);
 assert.equal(meta(c).source_domain, 'indeed.com');
 assert.equal(c.website, null, 'the job board domain is never promoted to the company website');
 assert.equal(c.name, 'Grand Frais');
});
test('B — unknown job board host, structural only: "X recrute …" is a SIGNAL_SOURCE for X', () => {
 const c = normalize({title: 'Grand Frais recrute un chef de rayon (CDI)', url: 'https://www.emplois-regionaux.fr/offre/12345', description: 'Candidature en ligne.'}, 'chef de rayon');
 assert.equal(meta(c).source_class, 'SIGNAL_SOURCE');
 assert.equal(meta(c).company_name, 'Grand Frais');
 assert.equal(c.website, null);
});

// ------------------------------------------------------------
// C — a job board page with no resolvable company is never a prospect.
// ------------------------------------------------------------
test('C — real Indeed listing (short URL): IRRELEVANT, indeed.com is never the company, the SEO title never the name', () => {
 const c = normalize({title: 'Freelance Media : plus de 100 emplois (13 mai 2026) | Indeed', url: 'https://fr.indeed.com/q-freelance-media-emplois.html', description: 'Offres d\'emploi Freelance Media disponibles sur Indeed.com.'}, 'freelance media');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 assert.equal(meta(c).company_name, null);
 assert.equal(meta(c).company_domain, null);
 assert.equal(c.website, null);
 assert.equal(meta(c).company_name_status, 'UNRESOLVED');
});
test('C — real Indeed listing (deep URL): the "X :" prefix is a search term, never a company name', () => {
 const c = normalize({title: 'Freelance Media : plus de 100 emplois (13 mai 2026) | Indeed', url: 'https://fr.indeed.com/jobs/france/q-freelance-media-emplois.html', description: 'Offres d\'emploi.'}, 'freelance media');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 assert.notEqual(c.name, 'Freelance Media');
 assert.equal(meta(c).company_name_status, 'UNRESOLVED');
});
test('C — free-work style job search page: IRRELEVANT, structurally (query string + job vocabulary)', () => {
 const c = normalize({title: 'Missions freelance et emplois Marketing', url: 'https://www.free-work.com/fr/tech-it/jobs?query=marketing', description: 'Trouvez votre prochaine mission freelance.'}, 'freelance marketing');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 assert.equal(meta(c).company_name, null);
});
test('C — an unknown job board host with a listing count is IRRELEVANT without any domain list', () => {
 const c = normalize({title: 'Comptable : 245 offres d\'emploi', url: 'https://www.jobs-partout.example/comptable', description: 'Postulez dès maintenant.'}, 'comptable');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 assert.equal(c.website, null);
});

// ------------------------------------------------------------
// D — a freelance marketplace is not a prospect, unless the query explicitly targets platforms.
// ------------------------------------------------------------
test('D — malt search page: IRRELEVANT', () => {
 const c = normalize({title: 'Freelance Marketing Digital', url: 'https://www.malt.fr/s/freelance-marketing-digital', description: 'Trouvez les meilleurs freelances en marketing digital.'}, 'freelance marketing digital');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
 assert.equal(meta(c).company_name, null);
});
test('D — marketplace homepage when the query does NOT target platforms: never a COMPANY_CANDIDATE', () => {
 const c = normalize({title: 'Malt — Les meilleurs freelances', url: 'https://www.malt.fr/', description: 'La plateforme des freelances.'}, 'agence marketing digital');
 assert.notEqual(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(c.website, null);
});
test('D — marketplace homepage when the query explicitly targets platforms: may be a COMPANY_CANDIDATE', () => {
 const c = normalize({title: 'Malt — Les meilleurs freelances', url: 'https://www.malt.fr/', description: 'La plateforme des freelances.'}, 'plateformes de freelances');
 assert.equal(meta(c).source_class, 'COMPANY_CANDIDATE');
 assert.equal(meta(c).company_domain, 'malt.fr');
});

// ------------------------------------------------------------
// E — an individual profile / freelance consultant is not an organization by default.
// ------------------------------------------------------------
test('E — kerline.fr "Consultant Freelance en Marketing Digital": never an identified company', () => {
 const c = normalize({title: 'Consultant Freelance en Marketing Digital', url: 'https://www.kerline.fr/', description: 'Consultant freelance en marketing digital à Paris.'}, 'marketing digital');
 assert.equal(meta(c).source_class, 'UNCERTAIN');
 assert.equal(meta(c).source_type, 'individual_profile');
 assert.equal(meta(c).company_name, null);
 assert.equal(meta(c).company_domain, null);
 assert.equal(meta(c).company_name_status, 'UNRESOLVED');
 assert.equal(c.website, null);
});

// ------------------------------------------------------------
// F — an article/blog/editorial page is never itself the prospect.
// ------------------------------------------------------------
test('F — listicle article with no named company: IRRELEVANT', () => {
 const c = normalize({title: '10 meilleures agences marketing digital à Paris', url: 'https://blog-marketing.example/classement-agences-paris', description: 'Notre sélection.'}, 'agence marketing digital');
 assert.equal(meta(c).source_class, 'IRRELEVANT');
});
test('F — editorial article naming Grand Frais: SIGNAL_SOURCE for Grand Frais, the media domain is never the company', () => {
 const c = normalize({title: 'Grand Frais : 30 nouveaux magasins ouvrent en France dès le 1er juin 2026, votre ville est-elle concernée ?', url: 'https://www.aufeminin.com/news/grand-frais-30-nouveaux-magasins.html', description: 'L\'enseigne poursuit son expansion en France avec de nouveaux magasins.'}, 'enseignes ouvrant de nouveaux magasins');
 assert.equal(meta(c).source_class, 'SIGNAL_SOURCE');
 assert.equal(meta(c).company_name, 'Grand Frais');
 assert.equal(meta(c).company_domain, null);
 assert.equal(meta(c).source_domain, 'aufeminin.com');
});

// ------------------------------------------------------------
// G — an ambiguous result stays UNCERTAIN; a company is never invented.
// ------------------------------------------------------------
test('G — ambiguous deep page: UNCERTAIN, no company name invented from the title', () => {
 const c = normalize({title: 'Accompagnement stratégique et croissance', url: 'https://www.example-conseil.fr/accompagnement/strategie-croissance-pme', description: 'Nous aidons les PME à structurer leur croissance.'}, 'accompagnement croissance pme');
 assert.equal(meta(c).source_class, 'UNCERTAIN');
 assert.equal(meta(c).company_name, null);
 assert.equal(meta(c).company_domain, null);
});

// ------------------------------------------------------------
// Relevance gate — Brave's semantic relevance is never ICP validation; a candidate must at least have
// an observable link to the user's query in its own snippet.
// ------------------------------------------------------------
test('relevance gate: an official site whose snippet shows none of the query terms is downgraded to UNCERTAIN', () => {
 const c = normalize({title: 'La Collab — Agence de collaboration créative', url: 'https://lacollab.com/', description: 'Agence créative.'}, 'plombier toulouse');
 assert.equal(meta(c).source_class, 'UNCERTAIN');
 assert.deepEqual(meta(c).relevance_terms, []);
});

// ------------------------------------------------------------
// Invariants.
// ------------------------------------------------------------
test('invariant: a SIGNAL_SOURCE never carries its own source domain as the company domain', () => {
 for (const [hit, q] of [
  [{title: 'Chargé de marketing digital H/F chez Grand Frais - Lyon | Indeed', url: 'https://fr.indeed.com/viewjob?jk=abc123'}, 'marketing digital'],
  [{title: 'Grand Frais : 30 nouveaux magasins ouvrent en France', url: 'https://www.aufeminin.com/news/grand-frais.html', description: 'nouveaux magasins'}, 'nouveaux magasins'],
 ] as Array<[Hit, string]>) {
  const c = normalize(hit, q);
  assert.equal(meta(c).source_class, 'SIGNAL_SOURCE');
  assert.notEqual(meta(c).company_domain, meta(c).source_domain);
 }
});
test('invariant: classification never produces a VERIFIED status anywhere', async () => {
 for (const f of ['../src/discovery/entity-resolution.ts', '../src/discovery/source-classification.ts']) {
  const source = await readFile(new URL(f, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'VERIFIED'/);
  assert.doesNotMatch(source, /fetch\(|anthropic|openai/i, 'deterministic only: no network, no LLM');
 }
});
test('accept gate: only COMPANY_CANDIDATE / SIGNAL_SOURCE (and legacy/fixture rows with no class) can become prospects', async () => {
 const {isAcceptableCandidate} = await import('../src/discovery/source-classification.ts');
 assert.equal(isAcceptableCandidate({raw_metadata: {source_class: 'COMPANY_CANDIDATE'}}), true);
 assert.equal(isAcceptableCandidate({raw_metadata: {source_class: 'SIGNAL_SOURCE'}}), true);
 assert.equal(isAcceptableCandidate({raw_metadata: {source_class: 'IRRELEVANT'}}), false);
 assert.equal(isAcceptableCandidate({raw_metadata: {source_class: 'UNCERTAIN'}}), false);
 assert.equal(isAcceptableCandidate({raw_metadata: {fixture: true}}), true, 'fixture/legacy rows keep their existing behavior');
 assert.equal(isAcceptableCandidate(null), true, 'a missing payload is left to the existing RPC checks, never guessed');
});
test('accept gate is enforced server-side before accept_discovery_result is called', async () => {
 const source = await readFile(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 const gate = source.indexOf('isAcceptableCandidate(');
 const rpc = source.indexOf("db.rpc('accept_discovery_result'");
 assert.ok(gate > 0 && rpc > gate, 'the classification gate runs before the accept RPC');
 assert.match(source, /CANDIDATE_NOT_ACCEPTABLE/);
});
test('FixtureProvider is unchanged in behavior: its curated TEST companies stay COMPANY_CANDIDATE with their own website', async () => {
 const {FixtureProvider} = await import('../src/discovery/providers/fixture.ts');
 const p = new FixtureProvider();
 const rows = await p.searchCompanies({project_id: 'p', query: 'x', location: 'Toulouse', categories: [], max_results: 3, optional_filters: {}});
 for (const raw of rows) {
  const c = p.normalizeResult(raw);
  assert.match(c.name, /^TEST — /);
  assert.ok(c.website);
  assert.equal((c.raw_metadata as Record<string, unknown>).source_class, 'COMPANY_CANDIDATE');
 }
});
test('scoring invariant: src/domain/core.ts (scoreProspect) is byte-identical to main', async () => {
 const {execSync} = await import('node:child_process');
 const diff = execSync('git diff --name-only daf49e39848f79f4459b6dc426ec8580b4cb69ff -- src/domain/core.ts src/server/entitlement.ts db/migrations', {cwd: new URL('..', import.meta.url), encoding: 'utf8'});
 assert.equal(diff.trim(), '');
});
test('Brave budget invariant: still exactly one HTTP call per search, context tagging adds no request', async () => {
 let calls = 0;
 const p = new BraveProvider('test', async () => { calls++; return Response.json({web: {results: [{title: 'Freelance Media : plus de 100 emplois | Indeed', url: 'https://fr.indeed.com/q-freelance-media-emplois.html'}]}}); });
 const raws = await p.searchCompanies({project_id: 'p', query: 'freelance media', location: 'France', categories: [], max_results: 3, optional_filters: {}});
 assert.equal(calls, 1);
 const c = p.normalizeResult(raws[0]);
 assert.equal((c.raw_metadata as Record<string, unknown>).source_class, 'IRRELEVANT', 'the query context tagged by searchCompanies reaches normalizeResult');
});

// ------------------------------------------------------------
// UI — three clearly distinct states, all localized; "Entreprise identifiée" only for a resolved
// organization; never an add button for a page without one; score line preserved.
// ------------------------------------------------------------
test('UI: DiscoveryPanel distinguishes Entreprise candidate / Source de signal / Non résolu via tr() keys only', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 for (const key of ['discovery.class.companyCandidate', 'discovery.class.signalSource', 'discovery.class.uncertain', 'discovery.notAddable', 'discovery.discardedTitle', 'discovery.signalSourceNote'])
  assert.match(source, new RegExp(`tr\\('${key.replace(/\./g, '\\.')}'\\)`));
 for (const literal of ['Entreprise candidate', 'Source de signal', 'Résultats écartés', 'Company candidate', 'Signal source'])
  assert.doesNotMatch(source, new RegExp(literal), `"${literal}" must live only in the dictionaries`);
});
test('UI: IRRELEVANT results are never rendered as candidate cards, only in the collapsed discarded list', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(source, /results\.filter\(r=>metaOf\(r\)\.source_class!=='IRRELEVANT'\)\.map\(/);
 assert.match(source, /<details className="note discovery-discarded">/);
});
test('UI: "Entreprise identifiée" is only reachable for a resolved, addable organization; UNCERTAIN has no add button', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(source, /const canAdd=cls!=='UNCERTAIN';const nameResolved=canAdd&&meta\.company_name_status==='RESOLVED'/);
 assert.match(source, /\{nameResolved\?<><h3>\{r\.normalized_payload\.name\}<\/h3><p><b>\{tr\('discovery\.identifiedCompanyLabel'\)\}/);
 assert.match(source, /r\.status==='pending'&&!canAdd\?<><p className="muted">\{tr\('discovery\.notAddable'\)\}<\/p><button disabled=\{busy\} onClick=\{\(\)=>ignore\(r\)\}>/);
 assert.match(source, /\{tr\('discovery\.currentScore'\)\} <b>0\/100<\/b>/, 'the 0/100 score line is preserved');
});
test('i18n: every new key exists in FR and EN with genuinely distinct values; no key claims "verified"', async () => {
 const {fr} = await import('../src/i18n/fr.ts');
 const {en} = await import('../src/i18n/en.ts');
 const keys = Object.keys(fr).filter(k => k.startsWith('discovery.class.') || k.startsWith('discovery.sourceType.') || ['discovery.notAddable', 'discovery.discardedTitle', 'discovery.discardedNote', 'discovery.signalSourceNote', 'error.candidateNotAcceptable'].includes(k)) as Array<keyof typeof fr>;
 assert.equal(keys.length, 16, "3 class + 8 source-type + 5 notice/error keys");
 for (const k of keys) {
  assert.notEqual(fr[k], en[k], k);
  assert.doesNotMatch(fr[k], /v[ée]rifi/i, k);
  assert.doesNotMatch(en[k], /verified/i, k);
 }
});
