// Admissibility gate — A PAGE IS NOT A PROSPECT. Runs after entity resolution (entity-resolution.ts) and
// before anything is written as a discovery_result, for every search result:
//   1. classifyCandidatePage: what kind of page this is (official site, the organization's own job page,
//      a third-party job board, a directory, a training provider or course page, news, content, social,
//      public directory, unknown);
//   2. resolveCandidateEntity: which real organization, if any, the page EXPLICITLY identifies — its own
//      site, or an employer/organization named on a third-party page. A source site's own name/hostname is
//      never that organization;
//   3. evaluateCandidateAdmissibility: only a resolved organization, on a page type that may carry one, not
//      excluded by the user's own query and not explicitly outside the requested zone, becomes a candidate.
// Everything else is kept for transparency but never becomes an actionable prospect. Deterministic, no
// network, no LLM; never produces an evidence status and never touches scoring.
import {getDomain} from 'tldts';
import type {QualityAssessment} from './candidate-quality.ts';
import {EXCLUSION_CLAUSE,isKnownPlatformDomain,isListingTitle,isQueryEchoOrGeneric,nameSegments,titleSegments,type QueryContext} from './source-classification.ts';
import {cleanTitle,nameFromDomain,type CanonicalResolution} from './entity-resolution.ts';
import {compareLocation,isPlaceName,locationTarget,placesIn,type LocationState} from './geo-fr.ts';

export type PageType = 'OFFICIAL_ORGANIZATION_SITE' | 'OFFICIAL_JOB_PAGE' | 'THIRD_PARTY_JOB_BOARD' | 'DIRECTORY' | 'TRAINING_PROVIDER' | 'TRAINING_COURSE_PAGE'
 | 'NEWS_ARTICLE' | 'BLOG_OR_CONTENT' | 'SOCIAL_PROFILE' | 'GOVERNMENT_OR_PUBLIC_DIRECTORY' | 'UNKNOWN';
export type AdmissibilityReason = 'ADMISSIBLE' | 'TRAINING_COURSE_PAGE' | 'DIRECTORY_PAGE' | 'PUBLIC_DIRECTORY_PAGE' | 'SOCIAL_PROFILE_PAGE'
 | 'EXCLUDED_BY_QUERY' | 'ENTITY_UNRESOLVED' | 'NO_OBSERVABLE_RELEVANCE' | 'LOCATION_MISMATCH' | 'SECTOR_BODY_PAGE' | 'EVENT_PAGE' | 'ENTITY_TYPE_MISMATCH';
export type EntityMethod = 'own_site' | 'own_job_page' | 'job_title_employer' | 'labeled_field' | 'title_organization' | 'explicit_title_pattern' | 'cited_domain';
// RESOLVED_HIGH: the organization's own site/job page identifies it (name + website). RESOLVED_MEDIUM: an
// organization explicitly named by a secondary source, identity/website not confirmed. UNRESOLVED: no
// organization can be named with certainty — never a candidate. Both RESOLVED levels were already
// admissible before this change (a job board naming its employer); no threshold is lowered.
export type EntityConfidence = 'RESOLVED_HIGH' | 'RESOLVED_MEDIUM' | 'UNRESOLVED';
export type ResolvedEntity = {name: string; website: string | null; canonicalUrl: string | null; method: EntityMethod; confidence: Exclude<EntityConfidence, 'UNRESOLVED'>};
export type Admissibility = {
 admissible: boolean; reasonCode: AdmissibilityReason; pageType: PageType; pageTypeReasons: string[]; resolvedEntity: ResolvedEntity | null;
 location: {state: LocationState; target: string | null; regions: string[]; departments: string[]};
};

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const alnum = (s: string): string => fold(s).replace(/[^a-z0-9]/g, '');

// ------------------------------------------------------------
// User exclusions written in the query ("Exclure organismes de formation et pages DEJEPS").
// ------------------------------------------------------------
export type QueryExclusions = {pageTypes: Set<PageType>; keywords: string[]};
const EXCLUDED_CATEGORIES: Array<[RegExp, PageType[]]> = [
 [/\b(organismes?|centres?|ecoles?|instituts?) de formation\b|\bcfa\b|\bformations?\b|\bformateurs?\b|\becoles?\b/, ['TRAINING_PROVIDER', 'TRAINING_COURSE_PAGE']],
 [/\bannuaires?\b|\brepertoires?\b/, ['DIRECTORY', 'GOVERNMENT_OR_PUBLIC_DIRECTORY']],
 [/\bjob ?boards?\b|\bsites? d emploi\b|\bsites? de recrutement\b|\bplateformes?\b/, ['THIRD_PARTY_JOB_BOARD']],
 [/\barticles?\b|\bblogs?\b|\bactualites?\b|\bpresse\b|\bmedias?\b/, ['NEWS_ARTICLE', 'BLOG_OR_CONTENT']],
 [/\breseaux sociaux\b|\blinkedin\b|\bfacebook\b|\binstagram\b/, ['SOCIAL_PROFILE']],
];
const EXCLUSION_FILLER = new Set(['pages', 'page', 'sites', 'site', 'les', 'des', 'de', 'du', 'la', 'le', 'un', 'une', 'aux', 'resultats', 'resultat', 'liens', 'lien', 'type', 'types', 'contenus', 'contenu', 'offres', 'structures', 'entreprises', 'organismes', 'tous', 'toutes', 'tout']);

// The user's exclusion instructions, and the query with those clauses removed — the removed text must
// never be sent to the search engine (it attracts exactly the excluded pages) nor count as relevance.
export function parseQueryExclusions(query: string): {exclusions: QueryExclusions; cleanedQuery: string} {
 const pageTypes = new Set<PageType>();
 const keywords = new Set<string>();
 const cleanedQuery = query.replace(EXCLUSION_CLAUSE, (_all, lead: string, _verb: string, clause: string) => {
  for (const item of clause.split(/,|\bet\b|\bou\b|\/|\+/i)) {
   const f = fold(item).replace(/['’]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
   if (!f) continue;
   const category = EXCLUDED_CATEGORIES.find(([pattern]) => pattern.test(f));
   if (category) { category[1].forEach(t => pageTypes.add(t)); continue; }
   f.split(' ').filter(w => w.length >= 3 && !EXCLUSION_FILLER.has(w)).forEach(w => keywords.add(w));
  }
  return lead;
 }).replace(/\s{2,}/g, ' ').trim();
 return {exclusions: {pageTypes, keywords: [...keywords]}, cleanedQuery};
}

// ------------------------------------------------------------
// Page classification.
// ------------------------------------------------------------
const SOCIAL_HOSTS = ['linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'threads.net'];
// Reinforcing only (the structural signals below catch unknown hosts): well-known French company/public directories.
const KNOWN_DIRECTORY_DOMAINS = new Set(['societe.com', 'pappers.fr', 'verif.com', 'infogreffe.fr', 'kompass.com', 'manageo.fr', 'pagesjaunes.fr', 'cylex.fr', 'justacote.com', 'hoodspot.fr', 'mappy.com', '118000.fr', '118712.fr', 'net-entreprises.fr', 'lefigaro.fr']);
const DIRECTORY_LABEL = /(annuaire|repertoire|directory|pagesjaunes|listing)/;
const PUBLIC_DIRECTORY_DOMAINS = new Set(['service-public.fr', 'data.gouv.fr', 'insee.fr', 'legifrance.gouv.fr']);
const STRONG_JOB = /\b(H\/F|F\/H|CDI|CDD|recrute|recrutent|recrutement|offres? d['’]emploi|postes?|postuler|candidature|emplois?)\b/i;
const JOB_PATH = /^(jobs?|emplois?|offres?|offre-emploi|offres-d-emploi|viewjob|recrutement|carrieres?|careers?|nous-rejoindre|rejoignez-nous)$/i;
// Acronyms are matched in capitals only ("but", "cap" are ordinary French words); spelled-out diplomas in any case.
const DIPLOMA_ACRONYM = /\b(DEJEPS|DESJEPS|BPJEPS|CPJEPS|BAFA|BAFD|BTS|BUT|DUT|CAP|BEP|RNCP|VAE)\b/;
const DIPLOMA_SPELLED = /\b(bac pro|licence pro(fessionnelle)?|master [12]|titre professionnel|dipl[ôo]mes? d['’][ée]tat)\b/i;
const DIPLOMA = {test: (s: string) => DIPLOMA_ACRONYM.test(s) || DIPLOMA_SPELLED.test(s)};
const COURSE_TITLE = /^\s*(formations?|cursus|programme|parcours de formation|fiche (formation|dipl[ôo]me))\b/i;
const COURSE_PATH = /^(formations?|diplomes?|cursus|programmes?|catalogue|certifications?|nos-formations)$/i;
const TRAINING_PROVIDER_TEXT = /\b(organisme de formation|centre de formation|institut de formation|[ée]cole de formation|qualiopi|nos formations|cfa|maison familiale rurale)\b/i;
// An organization whose own name says it is a training institution — excluded with "organismes de formation".
const TRAINING_ORG_NAME = /\b(MFR|maison familiale rurale|CFA|organisme de formation|centre de formation|institut de formation|[ée]cole|formations?|lyc[ée]e|coll[èe]ge|universit[ée]|IRTS|CREPS|campus|acad[ée]mie|academy)\b/i;
const TRAINING_LABEL = /(formation|^cfa|campus|academie|academy|^ecole)/;
const CONTENT_TITLE = /(^\s*(qu['’]est[- ]ce|comment|pourquoi|quel(le)?s? |tout savoir|guide|fiche m[ée]tier|d[ée]finition|devenir)\b|\?)/i;
const NEWS_PATH = /^(actualites?|actus?|news|article|articles|presse|magazine|\d{4})$/i;
const OWN_CORPORATE_PATH = /^(a-propos|apropos|about|about-us|qui-sommes-nous|presentation|l-entreprise|la-societe|entreprise|societe|accueil|home|index)$/i;
const BLOG_PATH = /^(blog|blogs|dossiers?|conseils?|guides?|fiches?-metiers?|metiers?)$/i;

// Generic organizational forms (never a sector's brand list): a job-ad title segment carrying one of
// these names an employer.
const EMPLOYER_MARKER = /\b(association|asso|f[ée]d[ée]ration|mjc|mfr|centre (social|socio[- ]?culturel|de loisirs|d['’]animation|m[ée]dico[- ]?\S+|hospitalier|communal)|foyer|ehpad|ime|itep|esat|sessad|mecs|mairie|commune de|ville de|communaut[ée] (de communes|d['’]agglom[ée]ration)|agglom[ée]ration|conseil (d[ée]partemental|r[ée]gional)|ccas|cias|udaf|fondation|mutuelle|clinique|h[ôo]pital|chu|union|ligue|comit[ée]|club|maison (des|de la|du)|soci[ée]t[ée]|entreprise|groupe|cabinet|agence|sarl|sas|sasu|eurl|scop|scic|coop[ée]rative)\b/i;
const ORG_GENERIC_WORDS = new Set(['association', 'asso', 'federation', 'la', 'le', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'en', 'societe', 'groupe', 'sarl', 'sas', 'sasu', 'eurl']);

const GENERIC_ORG_TOKENS = new Set(['association', 'asso', 'federation', 'centre', 'social', 'sociale', 'socioculturel', 'maison', 'jeunes', 'jeunesse', 'culture', 'club', 'mairie', 'commune', 'ville', 'foyer', 'mjc', 'ehpad', 'ime', 'itep', 'esat', 'union', 'ligue', 'comite', 'fondation', 'mutuelle', 'societe', 'groupe', 'entreprise', 'agence', 'cabinet', 'sarl', 'sas', 'sasu', 'eurl', 'la', 'le', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'en']);
// The organization's name reduced to its distinctive words: "Fédération ADMR du Tarn" -> "admrtarn".
export const entityCore = (name: string): string => fold(name).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !ORG_GENERIC_WORDS.has(w)).join('');
// The name without its organizational-type words: "Communauté d'agglomération Gaillac-Graulhet" -> "gaillacgraulhet".
const ORG_TYPE_WORDS = new Set(['association', 'asso', 'federation', 'communaute', 'communes', 'commune', 'agglomeration', 'mairie', 'ville', 'ccas', 'cias', 'centre', 'communal', 'action', 'sociale', 'social', 'maison', 'jeunes', 'culture', 'mjc', 'conseil', 'departemental', 'departement', 'regional', 'region', 'syndicat', 'intercommunal', 'metropole']);
export const distinctiveCore = (name: string): string => fold(name).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !ORG_GENERIC_WORDS.has(w) && !ORG_TYPE_WORDS.has(w)).join('');
// A name is the site's own when its core and the domain label start the same way, or when its
// distinctive core IS the label exactly ("…Gaillac-Graulhet" / gaillac-graulhet.fr) — never a partial
// resemblance on the distinctive part alone.
function sameEntityAsDomain(name: string, domain: string | null): boolean {
 if (!domain) return false;
 const core = entityCore(name), label = alnum(domain.split('.')[0] ?? '');
 if (core.length < 3 || label.length < 3) return false;
 if (label.startsWith(core) || (label.length >= 4 && core.startsWith(label))) return true;
 const distinctive = distinctiveCore(name);
 return distinctive.length >= 5 && distinctive === label;
}

const OWN_NAME_MAX_WORDS = 6;
// The site's own name in its title, strongest match first:
//   1. a segment, or 2-3 consecutive segments, spelling EXACTLY the domain label ("MDTP" on mdtp.fr; "VRD - Services"
//      on vrd-services.com -> "VRD Services"): exact spellings beat a mere prefix ("VRD" alone);
//   2. a short segment the label starts with ("AM BTP" on ambtpvrd.fr) — never a long SEO sentence (> 6 words);
//   3. the leading words of a segment spelling the label.
// A weak resemblance never names anything.
// Strong enough to call an otherwise unclassified page the organization's own site: the name spells the domain
// label exactly, or covers a substantial start of it ("AM BTP" = 5 of the 8 characters of ambtpvrd). A short
// prefix ("Sky" for skygroupe) is only a resemblance and classifies nothing.
export function strongOwnName(name: string | undefined, label: string): boolean {
 if (!name || label.length < 3) return false;
 const core = alnum(name);
 return core === label || (core.length >= 5 && label.startsWith(core) && core.length / label.length >= 0.6);
}
export function ownNameInTitle(title: string, domain: string | null): string | undefined {
 const segments = nameSegments(title);
 const exactLabel = alnum(domain?.split('.')[0] ?? '');
 if (exactLabel.length >= 3) {
  for (let i = 0; i < segments.length; i++) for (const n of [1, 2, 3]) {
   if (i + n > segments.length) break;
   const joined = segments.slice(i, i + n).join(' ');
   if (alnum(joined) === exactLabel && joined.split(/\s+/).length <= OWN_NAME_MAX_WORDS && !isPlaceName(joined)) return joined;
  }
 }
 const whole = segments.find(s => s.split(/\s+/).length <= OWN_NAME_MAX_WORDS && sameEntityAsDomain(s, domain) && !isPlaceName(s));
 if (whole) return whole;
 const label = alnum(domain?.split('.')[0] ?? '');
 if (label.length < 4) return undefined;
 for (const s of segments) {
  const words = s.split(/\s+/);
  for (const n of [1, 2, 3]) { const lead = words.slice(0, n).join(' '); if (n <= words.length && alnum(lead) === label && !isPlaceName(lead)) return lead; }
 }
 return undefined;
}

function urlParts(url: string): {host: string; domain: string | null; segments: string[]; params: string[]} {
 try {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  return {host, domain: getDomain(host), segments: u.pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s).replace(/\.(html?|php|aspx?)$/i, '')), params: [...u.searchParams.keys()]};
 } catch { return {host: '', domain: null, segments: [], params: []}; }
}
const hostIs = (host: string, list: readonly string[]) => list.some(d => host === d || host.endsWith(`.${d}`));

// Job-ad suffixes attached to any segment ("… GAILLAC-GRAULHET (H/F)"), department codes "(81)" and
// offer references are stripped before a segment is read.
const JOB_SUFFIX = /\s*[([]?\s*\b(h\s*\/\s*f(\s*\/\s*x)?|f\s*\/\s*h(\s*\/\s*x)?)\b\s*[)\]]?\s*/gi;
const cleanSegment = (s: string): string => s.replace(JOB_SUFFIX, ' ').replace(/\s*\((\d{2,5}|2[AB])\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
// A segment that starts with a job title names the role, never the employer.
const ROLE_START = /^(agents?|animat|coordinat|charg[ée]|responsable|direct|[ée]ducat|assistant|conseill|technicien|infirm|aides?\b|auxiliaire|atsem|moniteur|monitrice|intervenant|employ|stagiaire|apprenti|alternant|chef|manager|commercial|d[ée]veloppeu|comptable|secr[ée]taire|m[ée]diat|accompagn|gestionnaire|op[ée]rat|ouvrier|cuisinier|serveu|vendeu|pr[ée]parat|psycholog|travailleu|professeur|enseignant|formateur|formatrice|offres?\b|emplois?\b)/i;
// "Associations à Gaillac", "EHPAD près de Toulouse": a category searched in a place, not a name.
const CATEGORY_IN_PLACE = /^(\S+\s+){0,2}(à|a|en|dans|pr[èe]s de|autour de|sur)\s/i;
// An organization's name LEADS with its form ("Association…", "Communauté d'agglomération…", "CCAS…",
// optionally after an article) or ENDS with a legal form ("ACME SAS") — an organizational word in the
// middle of a sentence ("…concerts, festivals, club & raves", "Votre cabinet de freelances…") is not a name.
const LEGAL_FORM_END = /\b(SAS|SARL|SASU|EURL|SA|SCOP|SCIC|SCI)\s*$/;
function leadsWithOrganizationForm(s: string): boolean {
 if (LEGAL_FORM_END.test(s)) return true;
 const m = EMPLOYER_MARKER.exec(s);
 return !!m && s.slice(0, m.index).trim().split(/\s+/).filter(Boolean).every(w => /^(la|le|les|l['’]?)$/i.test(w));
}
// "Entreprise de travaux VRD et assainissement à Lyon", "Entreprise générale de bâtiment": a description of an
// activity, never an organization's name.
const ACTIVITY_DESCRIPTION = /^(une |l['’])?entreprises? (de |d['’]|du |des |g[ée]n[ée]rale|sp[ée]cialis[ée]e|familiale|tous corps|ind[ée]pendante)/i;
function isOrganizationSegment(s: string, sourceDomain: string | null): boolean {
 if (ACTIVITY_DESCRIPTION.test(s)) return false;
 if (s.length < 3 || s.length > 80 || ROLE_START.test(s) || STRONG_JOB.test(s) || !leadsWithOrganizationForm(s) || CATEGORY_IN_PLACE.test(s)) return false;
 if (isPlaceName(s) || /^[A-Z0-9]{5,12}$/.test(s) || /^\d{2,5}$/.test(s)) return false;
 if (!hasDistinctiveName(s)) return false; // "Centre social", "Association": a type, not an organization
 if (sourceDomain && sameEntityAsDomain(s, sourceDomain) && (isKnownPlatformDomain(sourceDomain) || !domainCouldBeOrg(sourceDomain))) return false;
 return true;
}
const domainCouldBeOrg = (domain: string): boolean => !(KNOWN_DIRECTORY_DOMAINS.has(domain) || PUBLIC_DIRECTORY_DOMAINS.has(domain) || DIRECTORY_LABEL.test(alnum(domain.split('.')[0] ?? '')));
const distinctNames = (names: string[]): string[] => [...new Map(names.map(n => [entityCore(n), n])).values()];

// "Coordinateur de projets H/F - Fédération ADMR du Tarn - Gaillac (81)" -> "Fédération ADMR du Tarn";
// "AGENT POLYVALENT … - COMMUNAUTE D'AGGLOMERATION GAILLAC-GRAULHET (H/F)" -> that community. Only a
// segment that carries an explicit organizational form, is not the role, not a place, not an offer
// reference and not the source site itself; exactly one such organization, otherwise nothing.
export function employerFromJobTitle(title: string, sourceDomain: string | null): string | null {
 const found = distinctNames(titleSegments(title).map(cleanSegment).filter(s => isOrganizationSegment(s, sourceDomain)));
 return found.length === 1 ? found[0]! : null;
}

// "Employeur : ACME", "Entreprise : Fédération X", "Recruteur : …" in a title or snippet — the source
// labels the organization explicitly. Placeholders ("non communiqué", "confidentiel") never count.
// The label opens a field (start of text or after a separator), and the value is a name (capital or digit first).
const LABELED_FIELD = /(?:^|[|•·\n]\s*|\s[-–—]\s)(entreprise|employeur|soci[ée]t[ée]|recruteur|structure|[ée]tablissement|organisme employeur|collectivit[ée])\s*:\s*([A-ZÀ-Ý0-9][^|•·\n;,.()]{2,79})/gi;
const PLACEHOLDER = /\b(non commun|confidenti|anonyme|n\/c|nc|particulier|inconnu)/i;
export function labeledOrganizations(text: string, sourceDomain: string | null, context?: QueryContext): string[] {
 const out: string[] = [];
 for (const m of text.matchAll(LABELED_FIELD)) {
  const name = cleanSegment(m[2]!.replace(/\s+-\s+.*$/, ''));
  if (name.length < 3 || PLACEHOLDER.test(name) || ROLE_START.test(name) || isPlaceName(name) || isQueryEchoOrGeneric(name, context)) continue;
  if (sourceDomain && sameEntityAsDomain(name, sourceDomain)) continue;
  out.push(name);
 }
 return distinctNames(out);
}

// A source that is never itself a prospect can still NAME one — explicitly: a labeled field, or a job-ad
// employer on a page that is a job offer. Exactly one organization, otherwise nothing.
function explicitOrganization(input: {title: string; description?: string}, sourceDomain: string | null, jobSignal: boolean, context?: QueryContext): {name: string; method: EntityMethod} | null {
 const labeled = labeledOrganizations(`${input.title} | ${input.description ?? ''}`, sourceDomain, context);
 const employer = jobSignal ? employerFromJobTitle(input.title, sourceDomain) : null;
 const all = distinctNames([...labeled, ...(employer ? [employer] : [])]);
 if (all.length !== 1) return null;
 return {name: all[0]!, method: labeled.length ? 'labeled_field' : 'job_title_employer'};
}
const hasJobSignal = (title: string, segments: string[]): boolean => STRONG_JOB.test(title) || titleSegments(title).some(s => ROLE_START.test(cleanSegment(s))) || segments.some(s => JOB_PATH.test(s) || /^offre/i.test(s));

// Display form of an organization name written in capitals or in lowercase by a source: title case,
// French particles lowercase, organizational acronyms kept, accents restored only on a closed list of
// generic organizational words (never on a proper name). Mixed-case names are kept exactly as written.
const ACRONYMS = new Set(['ccas', 'cias', 'mjc', 'mfr', 'ehpad', 'ime', 'itep', 'esat', 'sessad', 'mecs', 'udaf', 'admr', 'chu', 'ch', 'sas', 'sarl', 'sasu', 'eurl', 'scop', 'scic', 'apf', 'caf', 'cpam', 'msa', 'adapei', 'apajh', 'cfa', 'irts', 'epci', 'sivu', 'sivom', 'ufcv', 'cemea', 'ufolep']);
const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'aux', 'au', 'en', 'sur', 'pour']);
const ACCENTS: Record<string, string> = {communaute: 'communauté', agglomeration: 'agglomération', federation: 'fédération', societe: 'société', comite: 'comité', departement: 'département', departemental: 'départemental', departementale: 'départementale', regional: 'régional', regionale: 'régionale', etablissement: 'établissement', education: 'éducation', medico: 'médico', sante: 'santé', reseau: 'réseau', cooperative: 'coopérative', ecole: 'école', centre: 'centre'};
export function canonicalOrganizationName(name: string): string {
 const n = name.replace(/\s+/g, ' ').trim();
 if (!/[a-zà-ÿ]/i.test(n) || (n !== n.toUpperCase() && n !== n.toLowerCase())) return n;
 // A short name written in capitals made only of initials ("MDTP", "AM BTP": at most 4 letters and one vowel per
 // word) is kept as written. A capitalized word ("AVAL", "RIBIERE") or a long name is recased as before.
 const tokens = n.split(' ');
 const initials = (t: string): boolean => { const letters = t.replace(/[^\p{L}]/gu, ''); return letters.length >= 2 && letters.length <= 4 && (letters.match(/[AEIOUYÀ-ÆÈ-ÏÒ-ÖÙ-Ü]/g) ?? []).length <= 1; };
 if (n === n.toUpperCase() && tokens.length <= 3 && tokens.every(initials)) return n;
 const word = (w: string, first: boolean): string => {
  const lower = w.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  const accented = ACCENTS[lower] ?? lower;
  if (!first && PARTICLES.has(lower)) return lower;
  return accented.charAt(0).toUpperCase() + accented.slice(1);
 };
 return n.split(' ').map((token, i) => token.split('-').map((part, j) => {
  const ap = /^([dl])['’](.+)$/i.exec(part);
  if (ap) return `${ap[1]!.toLowerCase()}'${word(ap[2]!, false)}`;
  return word(part, i === 0 && j === 0);
 }).join('-')).join(' ');
}

export function classifyCandidatePage(input: {title: string; description: string; url: string; resolution: CanonicalResolution}): {pageType: PageType; reasons: string[]} {
 const {host, domain, segments, params} = urlParts(input.url);
 const label = alnum((domain ?? '').split('.')[0] ?? '');
 const title = input.title;
 const text = `${title} ${input.description}`;
 const sourceType = input.resolution.sourceType;

 if (hostIs(host, SOCIAL_HOSTS) || sourceType === 'individual_profile') return {pageType: 'SOCIAL_PROFILE', reasons: ['social_or_individual_profile']};
 if (host.endsWith('.gouv.fr') || (domain && PUBLIC_DIRECTORY_DOMAINS.has(domain))) return {pageType: 'GOVERNMENT_OR_PUBLIC_DIRECTORY', reasons: ['public_directory_host']};
 if ((domain && KNOWN_DIRECTORY_DOMAINS.has(domain)) || DIRECTORY_LABEL.test(label) || sourceType === 'directory' || sourceType === 'marketplace' || sourceType === 'search_page' || /\bannuaire\b/i.test(title))
  return {pageType: 'DIRECTORY', reasons: ['directory_structure']};

 const titleIsJob = STRONG_JOB.test(title) || isListingTitle(title);
 const trainingDomain = TRAINING_LABEL.test(label) || TRAINING_PROVIDER_TEXT.test(text);
 // A diploma/course page: the title is ABOUT a diploma or a course, and is not a job ad asking for one.
 if (!titleIsJob && (DIPLOMA.test(title) || COURSE_TITLE.test(title) || (trainingDomain && segments.some(s => COURSE_PATH.test(s)))))
  return {pageType: 'TRAINING_COURSE_PAGE', reasons: ['diploma_or_course_page']};

 if (titleIsJob || sourceType === 'job_board' || segments.some(s => JOB_PATH.test(s))) {
  const employer = employerFromJobTitle(title, domain);
  if ((domain && isKnownPlatformDomain(domain)) || isListingTitle(title) || params.some(p => ['q', 'query', 'search', 'keywords', 'k', 'what'].includes(p.toLowerCase())))
   return {pageType: 'THIRD_PARTY_JOB_BOARD', reasons: ['job_board_listing_or_platform']};
  if (employer && sameEntityAsDomain(employer, domain)) return {pageType: 'OFFICIAL_JOB_PAGE', reasons: ['employer_matches_own_domain']};
  if (employer) return {pageType: 'THIRD_PARTY_JOB_BOARD', reasons: ['employer_differs_from_source_domain']};
  // The site naming only itself on a jobs page is a platform ("Missions freelance et emplois | Free-Work"),
  // not an employer: an own job page needs an explicit employer ("Association X recrute…").
  if (titleOrgMatchesDomain(title, domain)) return {pageType: 'OFFICIAL_JOB_PAGE', reasons: ['employer_leads_title_on_own_domain']};
  return {pageType: 'THIRD_PARTY_JOB_BOARD', reasons: ['job_page_without_identified_employer']};
 }
 if (trainingDomain) return {pageType: 'TRAINING_PROVIDER', reasons: ['training_provider_signals']};
 if (sourceType === 'editorial' || CONTENT_TITLE.test(title) || segments.some(s => NEWS_PATH.test(s) || BLOG_PATH.test(s))) {
  const isNews = segments.some(s => NEWS_PATH.test(s)) || input.resolution.classificationReasons.includes('title_names_another_organization') || input.resolution.classificationReasons.includes('cites_external_company_domain');
  return isNews && !CONTENT_TITLE.test(title) ? {pageType: 'NEWS_ARTICLE', reasons: ['news_structure']} : {pageType: 'BLOG_OR_CONTENT', reasons: ['content_structure']};
 }
 if (sourceType === 'official_site') return {pageType: 'OFFICIAL_ORGANIZATION_SITE', reasons: ['own_site']};
 // "Entreprise de travaux VRD… à Lyon - MDTP" on mdtp.fr: a long SEO sentence, then the brand that the page's own
 // domain spells. On the site's home, a corporate page or the page named after the site itself, the page IS the
 // organization's own site. An article ends with its publisher's name too, hence the path condition.
 if (strongOwnName(ownNameInTitle(title, domain), label) && (segments.length === 0 || (segments.length === 1 && (OWN_CORPORATE_PATH.test(segments[0]!) || alnum(segments[0]!) === label))))
  return {pageType: 'OFFICIAL_ORGANIZATION_SITE', reasons: ['brand_segment_matches_domain']};
 // Never promoted to an official site on a title/domain resemblance alone: an unknown page only ever
 // yields an organization it explicitly names.
 return {pageType: 'UNKNOWN', reasons: ['no_structural_signal']};
}

// "Association Horizons Jeunesse recrute…" on horizons-jeunesse.org: the leading organization of the
// title is the site's own.
function titleOrgMatchesDomain(title: string, domain: string | null): boolean {
 const lead = /^(.{3,80}?)\s+(recrute|recrutent|cherche|embauche|propose)\b/i.exec(title.trim());
 return !!lead && sameEntityAsDomain(lead[1]!, domain);
}

// ------------------------------------------------------------
// Entity resolution under the page type.
// ------------------------------------------------------------
function originOf(url: string): string | null { try { return new URL(url).origin; } catch { return null; } }
const EXPLICIT_METHODS = new Set(['colon_prefix', 'leading_verb', 'chez_mention']);

export function resolveCandidateEntity(pageType: PageType, input: {title: string; description?: string; url: string; resolution: CanonicalResolution; context?: QueryContext; pageReasons?: string[]}): ResolvedEntity | null {
 const r = input.resolution;
 const {domain} = urlParts(input.url);
 const own = (name: string, method: EntityMethod): ResolvedEntity | null => { const origin = originOf(input.url); return origin ? {name, website: origin, canonicalUrl: origin, method, confidence: 'RESOLVED_HIGH'} : null; };
 const {segments} = urlParts(input.url);
 const explicit = (jobSignal: boolean): ResolvedEntity | null => { const e = explicitOrganization(input, domain, jobSignal, input.context); return e ? {name: e.name, website: null, canonicalUrl: null, method: e.method, confidence: 'RESOLVED_MEDIUM'} : null; };
 // A job title is never an organization: a title-pattern name that opens with a role (the same ROLE_START that keeps
 // roles out of organization segments) is a job title when the page is a job board or when the name ends with a
 // place ("Développeur Java Lyon"). Elsewhere a role-like first word stays possible ("Direct …" as a brand).
 const jobTitle = (name: string): boolean => { const n = cleanSegment(name); if (!ROLE_START.test(n)) return false; if (pageType === 'THIRD_PARTY_JOB_BOARD') return true; const w = n.split(/\s+/); return [1, 2, 3].some(k => w.length > k && isPlaceName(w.slice(-k).join(' '))); };
 const pattern = (): ResolvedEntity | null => r.companyName.status === 'RESOLVED' && EXPLICIT_METHODS.has(r.companyName.method) && !jobTitle(r.companyName.name) ? {name: r.companyName.name, website: null, canonicalUrl: null, method: 'explicit_title_pattern', confidence: 'RESOLVED_MEDIUM'} : null;
 const cited = r.companyDomain.status === 'RESOLVED' && r.companyDomain.method === 'domain_in_text' ? r.companyDomain : null;
 if (cited && r.companyName.status === 'RESOLVED') return {name: r.companyName.name, website: cited.website, canonicalUrl: cited.canonical_url, method: 'cited_domain', confidence: 'RESOLVED_MEDIUM'};
 switch (pageType) {
  case 'OFFICIAL_ORGANIZATION_SITE':
  case 'TRAINING_PROVIDER': {
   // The site's own name as written in its title ("MJC de Gaillac" on mjc-gaillac.fr) beats a name
   // merely capitalized from the domain ("Mjc Gaillac"). A name, not a tagline: a segment of more than
   // OWN_NAME_MAX_WORDS words that merely starts with the name ("Marocfourniture Votre spécialiste de…")
   // only lends its leading words that spell the domain.
   const segment = ownNameInTitle(input.title, domain);
   // A page of a site whose title names ANOTHER organization ("CCAS GAILLAC - …" on the town's site): that
   // organization, without claiming the host site as its website — never the host renamed from its domain.
   const named = !segment && !(r.companyName.status === 'RESOLVED' && r.companyName.method === 'own_site_title') ? titleSegments(input.title).map(cleanSegment).find(s => isOrganizationSegment(s, domain)) : undefined;
   if (named) return {name: named, website: null, canonicalUrl: null, method: 'title_organization', confidence: 'RESOLVED_MEDIUM'};
   if (r.companyDomain.status === 'RESOLVED' && r.companyDomain.method === 'own_site' && r.companyName.status === 'RESOLVED')
    // A title segment spelling the domain label exactly ('VRD Services' on vrd-services.com) beats any shorter prefix.
    return {name: (segment && alnum(segment) === alnum((domain ?? '').split('.')[0] ?? '')) || !(r.companyName.method === 'own_site_title' || !segment) ? segment! : r.companyName.name, website: r.companyDomain.website, canonicalUrl: r.companyDomain.canonical_url, method: 'own_site', confidence: 'RESOLVED_HIGH'};
   return segment ? own(segment, 'own_site') : null;
  }
  case 'OFFICIAL_JOB_PAGE': {
   const employer = employerFromJobTitle(input.title, domain);
   const lead = /^(.{3,80}?)\s+(recrute|recrutent|cherche|embauche|propose)\b/i.exec(input.title.trim())?.[1];
   const name = (employer && sameEntityAsDomain(employer, domain) ? employer : null) ?? (lead && sameEntityAsDomain(lead, domain) ? lead.trim() : null)
    ?? titleSegments(input.title).find(s => sameEntityAsDomain(s, domain)) ?? (domain ? nameFromDomain(domain) : null);
   return name ? own(name, 'own_job_page') : null;
  }
  case 'THIRD_PARTY_JOB_BOARD':
   // A job page the classifier found WITHOUT an identified employer: "<role> <place> : Emploi et recrutement" is the
   // board's own search facet, not an organization — a colon-prefix title pattern never creates the entity there.
   // An employer the page names explicitly (labeled field, "… chez X", "X recrute") still does.
   return explicit(true) ?? (input.pageReasons?.includes('job_page_without_identified_employer') && r.companyName.status === 'RESOLVED' && r.companyName.method === 'colon_prefix' ? null : pattern());
  // Pages that are never a prospect themselves: only an organization they name explicitly (labeled
  // field, or the employer of a job offer they publish) — never an entry of a plain directory listing.
  case 'DIRECTORY':
  case 'GOVERNMENT_OR_PUBLIC_DIRECTORY':
   return explicit(hasJobSignal(input.title, segments));
  case 'NEWS_ARTICLE':
  case 'BLOG_OR_CONTENT':
  case 'UNKNOWN': {
   const title = titleSegments(input.title).map(cleanSegment).filter(s => isOrganizationSegment(s, domain));
   const named = distinctNames(title);
   return explicit(hasJobSignal(input.title, segments)) ?? pattern() ?? (named.length === 1 ? {name: named[0]!, website: null, canonicalUrl: null, method: 'title_organization', confidence: 'RESOLVED_MEDIUM'} : null);
  }
  default:
   return null;
 }
}

// ------------------------------------------------------------
// Sector bodies and page words.
// ------------------------------------------------------------
// A professional body of the sector — federation, trade union, chamber, professional order, cluster — speaks
// FOR the companies the user is looking for; it is not one of them. Its page stays visible as a source (with
// its reason), but it is not proposed as a prospect unless the brief itself targets such bodies or looks for
// employers/structures in general (a job seeker's "structures employeuses" does include a federation). Public
// bodies that buy works (syndicat intercommunal, syndicat des eaux, syndicat mixte) are NOT sector bodies.
const SECTOR_BODY = /^(la |le |les |l['’])?(f[ée]d[ée]rations?|conf[ée]d[ée]ration|syndicats? (?!(intercommunal|mixte|des eaux|d['’]eau|d['’]assainissement|d['’][ée]nergie|de communes|d['’][ée]lectricit[ée]|de bassin|des ordures))|syndicat$|union (professionnelle|patronale|r[ée]gionale des|nationale des|des entreprises)|chambres? (de commerce|des m[ée]tiers|r[ée]gionale|syndicale|d['’]agriculture|professionnelle)|ordre (des|national)|clusters?\b|p[ôo]le de comp[ée]titivit[ée]|interprofession|organisation professionnelle|groupement professionnel|observatoire (des|r[ée]gional))/i;
// Reinforcing only: well-known national professional bodies written as acronyms.
const SECTOR_BODY_ACRONYM = /^(FNTP|FRTP|FFB|CAPEB|UNICEM|SYNTEC|CINOV|MEDEF|CPME|U2P|UMIH|CCI|CMA)\b/;
const SECTOR_INTENT = /\b(f[ée]d[ée]rations?|syndicats?|chambres?|unions?|organisations? professionnelles?|associations?|clusters?|r[ée]seaux?|interprofessions?|ordres? professionnels?|structures?|employeu\w*|recrut\w*|alternan\w*|stages?)\b/i;
// A title segment "les|l' <sector> en|dans|de|du [la] <zone>" whose sector words are ALL the user's own search words
// (query, categories — never a sector list) and whose zone is a region ("région …"), a known place or the run's zone.
// Narrow by construction: an offer ("Fabricant …", "Leader de …"), a tagline ("L'excellence industrielle en …",
// "L'industrie du futur en …") or a product ("Les plats cuisinés de …") never matches; the organization's own name
// segment is never read as the descriptor.
const SECTOR_STEM = (w: string): string => w.slice(0, 6);
export function sectorPortalTitle(title: string, entityName: string, domain: string | null, context: QueryContext | undefined): boolean {
 if (!context) return false;
 const sector = new Set(fold(`${context.query} ${context.categories.join(' ')}`).split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(SECTOR_STEM));
 if (!sector.size) return false;
 const zone = context.location ? fold(context.location).replace(/[^a-z0-9]+/g, ' ').trim() : '';
 const isZone = (tail: string): boolean => /^r[ée]gion\s+\S/i.test(tail) || isPlaceName(tail) || (!!zone && fold(tail).replace(/[^a-z0-9]+/g, ' ').trim() === zone);
 for (const raw of titleSegments(title)) {
  const segment = cleanSegment(raw);
  if ((domain && sameEntityAsDomain(segment, domain)) || alnum(segment) === alnum(entityName)) continue;
  const lead = /^(?:les\s+|l['’]\s*)(.+)$/i.exec(segment);
  if (!lead) continue;
  const words = lead[1]!.split(/\s+/);
  for (let i = 1; i < words.length - 1 && i <= 3; i++) {
   if (!/^(?:en|dans|de|du)$/i.test(words[i]!)) continue;
   const head = fold(words.slice(0, i).join(' ')).split(/[^a-z0-9]+/).filter(w => w.length >= 3);
   const tail = words.slice(i + 1).join(' ').replace(/^la\s+/i, '');
   if (head.length && head.every(w => sector.has(SECTOR_STEM(w))) && isZone(tail)) return true;
  }
 }
 return false;
}
export function isSectorBody(name: string, title: string): boolean {
 return [name, ...titleSegments(title)].some(s => SECTOR_BODY.test(s.trim()) || SECTOR_BODY_ACRONYM.test(s.trim()));
}
// An event — trade show, fair, forum, congress, conference, webinar — gathers the companies the user looks for; the
// event itself (its own site, its exhibitor page) is not one of them. It stays visible as a source with its reason.
// Recognised only with an event noun AND a sign of an event (an edition year, exhibitors, registration, programme):
// a "Salon de coiffure" or a company called "Forum Immobilier" is never caught. Never applied when the brief itself
// looks for events or their organisers.
const EVENT_NOUN = /(?:^|[^\p{L}])(salons?(?! de (?:coiffure|beaut[ée]|th[ée]|toilettage|massage|esth[ée]tique))|foires?|forums?|congr[eè]s|conf[ée]rences?|webinaires?|webinars?|meetups?|trade ?shows?|expositions?|festivals?|sommets?|summits?|rencontres (?:d['’]affaires|professionnelles|r[ée]gionales))(?!\p{L})/iu;
const EVENT_SIGN = /(?:^|[^\p{L}0-9])(20\d\d|exposants?|inscriptions?|inscrivez-vous|billetterie|programme|stands?|intervenants?|participants|[ée]dition)(?![\p{L}0-9])/iu;
const EVENT_INTENT = /\b(salons?|[ée]v[ée]nements?|[ée]v[ée]nementiel|organisateurs?|forums?|congr[eè]s|conf[ée]rences?|events?|exposants?)\b/i;
export function isEventPage(title: string, description: string): boolean { return EVENT_NOUN.test(title) && EVENT_SIGN.test(`${title} ${description}`); }
export const briefTargetsEvents = (context: QueryContext | undefined): boolean =>
 !!context && EVENT_INTENT.test(`${parseQueryExclusions(context.query).cleanedQuery} ${context.categories.join(' ')}`);
// ENTITY TYPE × SEARCH INTENT. A real organization with a real domain is not a commercial prospect by default: a
// federation, an association, a public body or a media/publisher is set aside (ENTITY_TYPE_MISMATCH) when the brief
// explicitly asks for commercial actors ("Entreprise BTP…", "PME…", "sociétés…") and does NOT ask for that kind of
// actor too. A brief asking for it ("fédérations BTP", "associations professionnelles", "organismes publics",
// "médias spécialisés") keeps it; a brief that says neither leaves the organization reviewable. Nothing here
// judges fit, size, competition or confirmed activity — that stays human qualification.
export type NonCommercialKind = 'FEDERATION' | 'ASSOCIATION' | 'PUBLIC_BODY' | 'MEDIA' | 'TRAINING' | 'FOUNDATION';
export const PUBLIC_BODY_NAME = /^(ville|commune|mairie) (de|d')|conseil (departemental|regional|general)|(^|\s)metropole(\s|$)|communaute (de communes|d'agglomeration|urbaine)|^region\s|^departement\s|office public de l'habitat|^prefecture/;
const ASSOCIATION_SIGN = /^(?:l['’])?association\s|(?:^|[^\p{L}])(?:l['’]association|association (?:des|de|du|professionnelle|r[ée]gionale))(?!\p{L})/iu;
// A publisher's own site says what it publishes, in its title: "L'actualité du BTP", a magazine, a journal…
const MEDIA_TITLE = /(?:^|[^\p{L}])(?:l['’]actualit[ée] (?:du|de la|des|de l['’])|toute l['’]actualit[ée]|magazines?|journal|quotidien|hebdomadaire|webzine|m[ée]dia (?:sp[ée]cialis|d['’]information|de r[ée]f[ée]rence))(?!\p{L})/iu;
const foldName = (s: string): string => fold(s).replace(/[’`]/g, "'");
// How an organization describes ITSELF (its title, the snippet of its page) when its name says nothing — an acronym:
// "X est l'association qui représente…", "un institut de formation", "CFA", "l'agence régionale…", a title segment
// "Formations en …". Generic kinds only; a company merely mentioning an association or a training never matches.
const SELF_ASSOCIATION = /(?:^|[^\p{L}])(?:est|sommes)\s+(?:l['’]|une\s+)association(?!\p{L})|(?:^|[^\p{L}])association (?:loi (?:de )?1901|qui (?:repr[ée]sente|f[ée]d[èe]re|regroupe|rassemble))(?!\p{L})/iu;
const SELF_TRAINING = /(?:^|[^\p{L}])(?:(?:institut|organisme|centre|[ée]cole)s? de formation|cfa|centre de formation d['’]apprentis)(?!\p{L})/iu;
const TRAINING_TITLE_SEGMENT = /^(?:nos )?formations?\s+(?:en|aux?|à|de|d['’]|pour)\s/iu;
// "X est une organisation professionnelle / une fédération / un cluster / la filière …", "X est une fondation": the
// entity says what it IS (copula + article + kind). Being "membre d'un cluster", "adhérente à une fédération" or "un
// acteur de la filière" never matches — the kind must follow the article directly.
const SELF_FEDERATION = /(?:^|[^\p{L}])(?:est|sommes)\s+(?:l['’]|la\s+|le\s+|une?\s+)(?:organisation professionnelle|f[ée]d[ée]ration|syndicat professionnel|union professionnelle|interprofession|cluster|p[ôo]le de comp[ée]titivit[ée]|fili[èe]re)(?!\p{L})/iu;
const SELF_FOUNDATION = /(?:^|[^\p{L}])(?:est|sommes)\s+(?:la\s+|une\s+)fondation(?!\p{L})/iu;
const SELF_PUBLIC_AGENCY = /(?:^|[^\p{L}])(?:est|sommes)\s+(?:l['’]|une\s+)agence (?:r[ée]gionale|d[ée]partementale|nationale|publique)(?!\p{L})|(?:^|[^\p{L}])[ée]tablissement public(?!\p{L})/iu;
function selfDescribedKind(title: string, description: string): NonCommercialKind | null {
 const text = `${title} ${description}`;
 if (SELF_FEDERATION.test(text)) return 'FEDERATION';
 if (SELF_FOUNDATION.test(text)) return 'FOUNDATION';
 if (SELF_ASSOCIATION.test(text)) return 'ASSOCIATION';
 if (SELF_TRAINING.test(text) || titleSegments(title).some(s => TRAINING_TITLE_SEGMENT.test(cleanSegment(s)))) return 'TRAINING';
 if (SELF_PUBLIC_AGENCY.test(text)) return 'PUBLIC_BODY';
 return null;
}
export function nonCommercialKind(name: string, title: string, url: string, description = ''): NonCommercialKind | null {
 if (isSectorBody(name, title)) return 'FEDERATION';
 if (PUBLIC_BODY_NAME.test(foldName(name))) return 'PUBLIC_BODY';
 const host = urlParts(url).host;
 if (/(^|\.)asso\.fr$/.test(host) || ASSOCIATION_SIGN.test(name) || titleSegments(title).some(s => ASSOCIATION_SIGN.test(s))) return 'ASSOCIATION';
 if (MEDIA_TITLE.test(title)) return 'MEDIA';
 return selfDescribedKind(title, description);
}
const COMMERCIAL_INTENT = /(?:^|[^\p{L}])(entreprises?|soci[ée]t[ée]s?|pme|eti|tpe|startups?|start-ups?|commerces?|commer[çc]ants?|[ée]tablissements?|prestataires?|fournisseurs?|fabricants?|industriels?|artisans?|cabinets?|agences?|bureaux d['’][ée]tudes?|distributeurs?|n[ée]gociants?)(?!\p{L})/iu;
const KIND_INTENT: Record<NonCommercialKind, RegExp> = {
 FEDERATION: /(?:^|[^\p{L}])(f[ée]d[ée]rations?|conf[ée]d[ée]rations?|syndicats?|chambres?|unions? (?:professionnelles?|patronales?)|organisations? professionnelles?|associations? professionnelles?|interprofessions?|clusters?|ordres? professionnels?|organismes? professionnels?)(?!\p{L})/iu,
 ASSOCIATION: /(?:^|[^\p{L}])(associations?|associatifs?|associatives?)(?!\p{L})/iu,
 PUBLIC_BODY: /(?:^|[^\p{L}])(organismes? publics?|acteurs? publics?|collectivit[ée]s?|administrations?|[ée]tablissements? publics?|services? publics?|mairies?|communes?|intercommunalit[ée]s?|epci|acheteurs? publics?)(?!\p{L})/iu,
 MEDIA: /(?:^|[^\p{L}])(m[ée]dias?|presse|journaux|journal|magazines?|[ée]diteurs?|publications?|journalistes?)(?!\p{L})/iu,
 TRAINING: /(?:^|[^\p{L}])(formations?|organismes? de formation|instituts?|[ée]coles?|cfa|centres? de formation|apprentissage)(?!\p{L})/iu,
 FOUNDATION: /(?:^|[^\p{L}])(fondations?|fonds de dotation|m[ée]c[ée]nat)(?!\p{L})/iu,
};
export function entityTypeMismatch(kind: NonCommercialKind | null, context: QueryContext | undefined): boolean {
 if (!kind || !context) return false;
 const brief = `${parseQueryExclusions(context.query).cleanedQuery} ${context.categories.join(' ')}`;
 return COMMERCIAL_INTENT.test(brief) && !KIND_INTENT[kind].test(brief);
}
export const briefTargetsSectorBodies = (context: QueryContext | undefined): boolean =>
 !!context && SECTOR_INTENT.test(`${parseQueryExclusions(context.query).cleanedQuery} ${context.categories.join(' ')}`);

// Words of the PAGE, not of the organization ("Accueil - Ribière", "Ribière | Recrutement", "Bienvenue chez
// X"): removed at either end of a name, only when a distinctive name remains. Never anything in the middle.
const PAGE_WORDS = "accueil|home|homepage|page d['’]accueil|site officiel|recrutement|nos offres(?: d['’]emploi)?|offres d['’]emploi|contact(?:ez-nous)?|qui sommes[- ]nous|nos r[ée]alisations|nos services|mentions l[ée]gales";
// A page word is only removed when a separator cuts it from the name ("Accueil - X", "X | Recrutement"), so a
// company named "Home Services" keeps its name; the two greeting forms are removed before the name itself.
const LEADING_PAGE_WORDS = new RegExp(`^(?:(?:${PAGE_WORDS})\\s*[-–—|:,]\\s*|(?:bienvenue (?:chez|sur|dans)|site officiel de)\\s+)`, 'i');
const TRAILING_PAGE_WORDS = new RegExp(`\\s*[-–—|:,]\\s*(?:${PAGE_WORDS})\\s*$`, 'i');
export function stripPageWords(name: string): string {
 let n = name.replace(/\s+/g, ' ').trim();
 for (let i = 0; i < 3; i++) {
  const next = n.replace(LEADING_PAGE_WORDS, '').replace(TRAILING_PAGE_WORDS, '').trim();
  if (next === n || next.length < 2 || !hasDistinctiveName(next)) break;
  n = next;
 }
 return n;
}

// ------------------------------------------------------------
// The gate.
// ------------------------------------------------------------
// Never a prospect, and never used to name one.
const REJECTED_PAGE_TYPES: Partial<Record<PageType, AdmissibilityReason>> = {TRAINING_COURSE_PAGE: 'TRAINING_COURSE_PAGE', SOCIAL_PROFILE: 'SOCIAL_PROFILE_PAGE'};
// Never a prospect themselves; may only NAME one explicitly (see resolveCandidateEntity).
const SOURCE_ONLY_PAGE_TYPES: Partial<Record<PageType, AdmissibilityReason>> = {DIRECTORY: 'DIRECTORY_PAGE', GOVERNMENT_OR_PUBLIC_DIRECTORY: 'PUBLIC_DIRECTORY_PAGE'};

export function evaluateCandidateAdmissibility(input: {title: string; description: string; url: string; quality: QualityAssessment; context?: QueryContext; resolution: CanonicalResolution}): Admissibility {
 const {pageType, reasons} = classifyCandidatePage(input);
 const target = input.context?.location ? input.context.location : null;
 const {segments} = urlParts(input.url);
 const locationText = `${input.title} ${input.description} ${segments.join(' ')}`;
 const tgt = target ? locationTarget(target) : null;
 if (tgt && input.context) { const fromQuery = placesIn(parseQueryExclusions(input.context.query).cleanedQuery); fromQuery.departments.forEach(d => tgt.places.departments.add(d)); fromQuery.regions.forEach(r => tgt.places.regions.add(r)); }
 const loc = tgt ? compareLocation(tgt, locationText) : {state: 'UNKNOWN' as LocationState, candidate: placesIn(locationText)};
 const location = {state: loc.state, target, regions: [...loc.candidate.regions], departments: [...loc.candidate.departments]};
 const verdict = (reasonCode: AdmissibilityReason, resolvedEntity: ResolvedEntity | null = null): Admissibility =>
  ({admissible: reasonCode === 'ADMISSIBLE', reasonCode, pageType, pageTypeReasons: reasons, resolvedEntity, location});

 const rejected = REJECTED_PAGE_TYPES[pageType];
 if (rejected) return verdict(rejected);
 const sourceOnly = SOURCE_ONLY_PAGE_TYPES[pageType];
 const exclusions = input.context ? parseQueryExclusions(input.context.query).exclusions : {pageTypes: new Set<PageType>(), keywords: []};
 const excludedText = ` ${fold(`${input.title} ${segments.join(' ')}`).replace(/[^a-z0-9]+/g, ' ')} `;
 if ((!sourceOnly && exclusions.pageTypes.has(pageType)) || exclusions.keywords.some(k => excludedText.includes(` ${k} `))) return verdict('EXCLUDED_BY_QUERY');

 // Entity resolution is attempted before any project-level dedup/exclusion (services.ts): an
 // organization later found to be already known is still correctly RESOLVED.
 const found = resolveCandidateEntity(pageType, {...input, pageReasons: reasons});
 const entity = found ? {...found, name: canonicalOrganizationName(stripPageWords(found.name))} : null;
 const placeNames = tgt ? tgt.cityTokens : [];
 const sourceDomain = urlParts(input.url).domain;
 if (!entity || entity.name.trim().length < 2 || isPlaceName(entity.name, placeNames) || isQueryEchoOrGeneric(entity.name, input.context)
  || (entity.method !== 'own_site' && entity.method !== 'own_job_page' && sourceDomain && sameEntityAsDomain(entity.name, sourceDomain) && (pageType === 'THIRD_PARTY_JOB_BOARD' || !!sourceOnly)))
  return verdict(sourceOnly ?? 'ENTITY_UNRESOLVED');
 // "Exclure organismes de formation": an organization whose own name says it is a training institution
 // is excluded whatever page named it.
 if (exclusions.pageTypes.has('TRAINING_PROVIDER') && TRAINING_ORG_NAME.test(entity.name)) return verdict('EXCLUDED_BY_QUERY', entity);
 // A federation, trade union or chamber of the sector: kept as a visible source, never proposed as a prospect
 // unless the brief targets such bodies (see isSectorBody).
 if (!briefTargetsSectorBodies(input.context) && isSectorBody(entity.name, input.title)) return verdict('SECTOR_BODY_PAGE', entity);
 // The event's own pages, or a name that is the event itself. An organization the event page names explicitly
 // (labeled field, job employer) is still that organization, not the event.
 if (!briefTargetsEvents(input.context) && isEventPage(input.title, input.description) && (entity.method === 'own_site' || entity.method === 'title_organization' || EVENT_NOUN.test(entity.name)))
  return verdict('EVENT_PAGE', entity);
 if (entityTypeMismatch(nonCommercialKind(entity.name, input.title, input.url, input.description), input.context)) return verdict('ENTITY_TYPE_MISMATCH', entity);
 // An organization's own page whose title presents the searched sector AS A WHOLE in a zone ("Les industries
 // agroalimentaires en région X", "L'agroalimentaire en X") speaks for the sector, not for what it makes or sells: a
 // sector body or portal, kept visible as a sector source (sectorPortalTitle). After the
 // organization-kind check: a page that says what the organization IS keeps that more precise kind.
 if (!briefTargetsSectorBodies(input.context) && (pageType === 'OFFICIAL_ORGANIZATION_SITE' || pageType === 'TRAINING_PROVIDER') && sectorPortalTitle(input.title, entity.name, sourceDomain, input.context)) return verdict('SECTOR_BODY_PAGE', entity);
 if (input.resolution.classificationReasons.includes('no_observable_relevance')) return verdict('NO_OBSERVABLE_RELEVANCE', entity);
 if (loc.state === 'MISMATCH') return verdict('LOCATION_MISMATCH', entity);
 return verdict('ADMISSIBLE', entity);
}

// The page's own label for a non-admissible result: its title — shown as a source, never as a company.
export const pageLabel = (title: string): string => cleanTitle(title);

// ------------------------------------------------------------
// Same organization reached through several pages of ONE search (an employer's own site and its job ad
// on a job board): one candidate, several sources. Only admissible candidates merge; the page with the
// organization's own website becomes the primary source, every other page is kept in
// raw_metadata.additional_sources. Never across searches, never on a name made only of generic
// organizational words ("Centre social", "Association"), never when two different websites conflict.
// ------------------------------------------------------------
type Mergeable = {name: string; website: string | null; canonical_url: string | null; source_url: string; source_title: string; deduplication_key: string; raw_metadata: Record<string, unknown>};
const hostOf = (url: string | null): string | null => { if (!url) return null; try { return getDomain(new URL(url).hostname.toLowerCase()); } catch { return null; } };
function hasDistinctiveName(name: string): boolean {
 return fold(name).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).some(w => w.length >= 3 && !GENERIC_ORG_TOKENS.has(w));
}
function sameEntity(a: Mergeable, b: Mergeable): boolean {
 // A legal identifier settles it: two different SIRENs are two companies, whatever their names.
 const sa = a.raw_metadata.siren, sb = b.raw_metadata.siren;
 if (typeof sa === 'string' && typeof sb === 'string') return sa === sb;
 const da = hostOf(a.website), db = hostOf(b.website);
 if (da && db) return da === db;
 // Name-based only when at most one side has a website (the other is a third-party mention of it).
 const ca = entityCore(a.name), cb = entityCore(b.name);
 return ca.length >= 3 && ca === cb && hasDistinctiveName(a.name);
}
export function mergeSameEntityCandidates<T extends Mergeable>(candidates: T[]): {kept: T[]; merged: number} {
 const kept: T[] = [];
 let merged = 0;
 for (const c of candidates) {
  const admissible = (c.raw_metadata.admissibility as {admissible?: boolean} | undefined)?.admissible === true;
  const target = admissible ? kept.find(k => (k.raw_metadata.admissibility as {admissible?: boolean} | undefined)?.admissible === true && sameEntity(k, c)) : undefined;
  if (!target) { kept.push(c); continue; }
  merged++;
  const [primary, secondary] = !target.website && c.website ? [c, target] : [target, c];
  const sources = [...((target.raw_metadata.additional_sources as unknown[]) ?? []), ...((c.raw_metadata.additional_sources as unknown[]) ?? []),
   {source_url: secondary.source_url, source_title: secondary.source_title, source_type: secondary.raw_metadata.source_type ?? null, page_type: secondary.raw_metadata.page_type ?? null}];
  // Several concordant public sources, one of them the organization's own site: the best confidence wins.
  const confidence = [target, c].some(x => x.raw_metadata.entity_confidence === 'RESOLVED_HIGH') ? 'RESOLVED_HIGH' : primary.raw_metadata.entity_confidence;
  // Every search query that reached any of the merged pages (provenance only).
  const queries = [...new Set([target, c].flatMap(x => (x.raw_metadata.search_queries as string[] | undefined) ?? []))];
  const next = {...primary, raw_metadata: {...primary.raw_metadata, additional_sources: sources, entity_confidence: confidence, ...(queries.length ? {search_queries: queries} : {})}} as T;
  kept[kept.indexOf(target)] = next;
 }
 return {kept, merged};
}

// Project-level dedup, applied AFTER resolution: an organization already present in the project under
// the same canonical name (case, accents, punctuation, particles and legal forms ignored) is still
// resolved, but flagged for review instead of being proposed as new. Distinctive names only.
export function sameCanonicalOrganization(a: string, b: string): boolean {
 const ca = entityCore(a), cb = entityCore(b);
 return ca.length >= 3 && ca === cb && hasDistinctiveName(a);
}
