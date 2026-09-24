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
import {EXCLUSION_CLAUSE,isKnownPlatformDomain,isListingTitle,isQueryEchoOrGeneric,titleSegments,type QueryContext} from './source-classification.ts';
import {cleanTitle,nameFromDomain,type CanonicalResolution} from './entity-resolution.ts';
import {compareLocation,isPlaceName,locationTarget,placesIn,type LocationState} from './geo-fr.ts';

export type PageType = 'OFFICIAL_ORGANIZATION_SITE' | 'OFFICIAL_JOB_PAGE' | 'THIRD_PARTY_JOB_BOARD' | 'DIRECTORY' | 'TRAINING_PROVIDER' | 'TRAINING_COURSE_PAGE'
 | 'NEWS_ARTICLE' | 'BLOG_OR_CONTENT' | 'SOCIAL_PROFILE' | 'GOVERNMENT_OR_PUBLIC_DIRECTORY' | 'UNKNOWN';
export type AdmissibilityReason = 'ADMISSIBLE' | 'TRAINING_COURSE_PAGE' | 'DIRECTORY_PAGE' | 'PUBLIC_DIRECTORY_PAGE' | 'SOCIAL_PROFILE_PAGE'
 | 'EXCLUDED_BY_QUERY' | 'ENTITY_UNRESOLVED' | 'NO_OBSERVABLE_RELEVANCE' | 'LOCATION_MISMATCH';
export type EntityMethod = 'own_site' | 'own_job_page' | 'job_title_employer' | 'explicit_title_pattern' | 'cited_domain';
export type ResolvedEntity = {name: string; website: string | null; canonicalUrl: string | null; method: EntityMethod};
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
const DIPLOMA = /\b(DEJEPS|DESJEPS|BPJEPS|CPJEPS|BAFA|BAFD|BTS|BUT|DUT|CAP|BEP|RNCP|VAE)\b|\b([Bb]ac [Pp]ro|[Ll]icence [Pp]ro(fessionnelle)?|[Mm]aster [12]|[Tt]itre [Pp]rofessionnel|[Dd]ipl[ôo]mes? d['’][ÉéEe]tat)\b/;
const COURSE_TITLE = /^\s*(formations?|cursus|programme|parcours de formation|fiche (formation|dipl[ôo]me))\b/i;
const COURSE_PATH = /^(formations?|diplomes?|cursus|programmes?|catalogue|certifications?|nos-formations)$/i;
const TRAINING_PROVIDER_TEXT = /\b(organisme de formation|centre de formation|institut de formation|[ée]cole de formation|qualiopi|nos formations|cfa)\b/i;
const TRAINING_LABEL = /(formation|^cfa|campus|academie|academy|^ecole)/;
const CONTENT_TITLE = /(^\s*(qu['’]est[- ]ce|comment|pourquoi|quel(le)?s? |tout savoir|guide|fiche m[ée]tier|d[ée]finition|devenir)\b|\?)/i;
const NEWS_PATH = /^(actualites?|actus?|news|article|articles|presse|magazine|\d{4})$/i;
const BLOG_PATH = /^(blog|blogs|dossiers?|conseils?|guides?|fiches?-metiers?|metiers?)$/i;

// Generic organizational forms (never a sector's brand list): a job-ad title segment carrying one of
// these names an employer.
const EMPLOYER_MARKER = /\b(association|asso|f[ée]d[ée]ration|mjc|mfr|centre (social|socio[- ]?culturel|de loisirs|d['’]animation|m[ée]dico[- ]?\S+|hospitalier|communal)|foyer|ehpad|ime|itep|esat|sessad|mecs|mairie|commune de|ville de|communaut[ée] (de communes|d['’]agglom[ée]ration)|agglom[ée]ration|conseil (d[ée]partemental|r[ée]gional)|ccas|cias|udaf|fondation|mutuelle|clinique|h[ôo]pital|chu|union|ligue|comit[ée]|club|maison (des|de la|du)|soci[ée]t[ée]|entreprise|groupe|cabinet|agence|sarl|sas|sasu|eurl|scop|scic|coop[ée]rative)\b/i;
const ORG_GENERIC_WORDS = new Set(['association', 'asso', 'federation', 'la', 'le', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'en', 'societe', 'groupe', 'sarl', 'sas', 'sasu', 'eurl']);

// The organization's name reduced to its distinctive words: "Fédération ADMR du Tarn" -> "admrtarn".
export const entityCore = (name: string): string => fold(name).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !ORG_GENERIC_WORDS.has(w)).join('');
// A name is the site's own when its distinctive core and the domain label start the same way.
function sameEntityAsDomain(name: string, domain: string | null): boolean {
 if (!domain) return false;
 const core = entityCore(name), label = alnum(domain.split('.')[0] ?? '');
 if (core.length < 3 || label.length < 3) return false;
 return label.startsWith(core) || (label.length >= 4 && core.startsWith(label));
}

function urlParts(url: string): {host: string; domain: string | null; segments: string[]; params: string[]} {
 try {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  return {host, domain: getDomain(host), segments: u.pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s).replace(/\.(html?|php|aspx?)$/i, '')), params: [...u.searchParams.keys()]};
 } catch { return {host: '', domain: null, segments: [], params: []}; }
}
const hostIs = (host: string, list: readonly string[]) => list.some(d => host === d || host.endsWith(`.${d}`));

// "Coordinateur de projets H/F - Fédération ADMR du Tarn - Gaillac (81)" -> "Fédération ADMR du Tarn".
// Only a segment that carries an explicit organizational form, is not the role, not a place and not the
// source site itself; exactly one such segment, otherwise nothing (never a guess).
export function employerFromJobTitle(title: string, sourceDomain: string | null): string | null {
 const found = titleSegments(title).map(s => s.replace(/\s*\((\d{2,5}|2[AB])\)\s*$/, '').trim()).filter(s => {
  if (s.length < 3 || s.length > 80 || STRONG_JOB.test(s) || !EMPLOYER_MARKER.test(s)) return false;
  if (isPlaceName(s) || /^\d{2,5}$/.test(s)) return false;
  if (sourceDomain && isKnownPlatformDomain(sourceDomain) && sameEntityAsDomain(s, sourceDomain)) return false;
  return true;
 });
 return found.length === 1 ? found[0]! : null;
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

export function resolveCandidateEntity(pageType: PageType, input: {title: string; url: string; resolution: CanonicalResolution}): ResolvedEntity | null {
 const r = input.resolution;
 const {domain} = urlParts(input.url);
 const own = (name: string, method: EntityMethod): ResolvedEntity | null => { const origin = originOf(input.url); return origin ? {name, website: origin, canonicalUrl: origin, method} : null; };
 const cited = r.companyDomain.status === 'RESOLVED' && r.companyDomain.method === 'domain_in_text' ? r.companyDomain : null;
 if (cited && r.companyName.status === 'RESOLVED') return {name: r.companyName.name, website: cited.website, canonicalUrl: cited.canonical_url, method: 'cited_domain'};
 switch (pageType) {
  case 'OFFICIAL_ORGANIZATION_SITE':
  case 'TRAINING_PROVIDER': {
   // The site's own name as written in its title ("MJC de Gaillac" on mjc-gaillac.fr) beats a name
   // merely capitalized from the domain ("Mjc Gaillac").
   const segment = titleSegments(input.title).find(s => sameEntityAsDomain(s, domain) && !isPlaceName(s));
   if (r.companyDomain.status === 'RESOLVED' && r.companyDomain.method === 'own_site' && r.companyName.status === 'RESOLVED')
    return {name: r.companyName.method === 'own_site_title' || !segment ? r.companyName.name : segment, website: r.companyDomain.website, canonicalUrl: r.companyDomain.canonical_url, method: 'own_site'};
   return segment ? own(segment, 'own_site') : null;
  }
  case 'OFFICIAL_JOB_PAGE': {
   const employer = employerFromJobTitle(input.title, domain);
   const lead = /^(.{3,80}?)\s+(recrute|recrutent|cherche|embauche|propose)\b/i.exec(input.title.trim())?.[1];
   const name = (employer && sameEntityAsDomain(employer, domain) ? employer : null) ?? (lead && sameEntityAsDomain(lead, domain) ? lead.trim() : null)
    ?? titleSegments(input.title).find(s => sameEntityAsDomain(s, domain)) ?? (domain ? nameFromDomain(domain) : null);
   return name ? own(name, 'own_job_page') : null;
  }
  case 'THIRD_PARTY_JOB_BOARD': {
   const employer = employerFromJobTitle(input.title, domain);
   if (employer) return {name: employer, website: null, canonicalUrl: null, method: 'job_title_employer'};
   return r.companyName.status === 'RESOLVED' && EXPLICIT_METHODS.has(r.companyName.method) ? {name: r.companyName.name, website: null, canonicalUrl: null, method: 'explicit_title_pattern'} : null;
  }
  case 'NEWS_ARTICLE':
  case 'BLOG_OR_CONTENT':
  case 'UNKNOWN':
   return r.companyName.status === 'RESOLVED' && EXPLICIT_METHODS.has(r.companyName.method) ? {name: r.companyName.name, website: null, canonicalUrl: null, method: 'explicit_title_pattern'} : null;
  default:
   return null;
 }
}

// ------------------------------------------------------------
// The gate.
// ------------------------------------------------------------
const REJECTED_PAGE_TYPES: Partial<Record<PageType, AdmissibilityReason>> = {
 TRAINING_COURSE_PAGE: 'TRAINING_COURSE_PAGE', DIRECTORY: 'DIRECTORY_PAGE', GOVERNMENT_OR_PUBLIC_DIRECTORY: 'PUBLIC_DIRECTORY_PAGE', SOCIAL_PROFILE: 'SOCIAL_PROFILE_PAGE',
};

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
 const exclusions = input.context ? parseQueryExclusions(input.context.query).exclusions : {pageTypes: new Set<PageType>(), keywords: []};
 const excludedText = ` ${fold(`${input.title} ${segments.join(' ')}`).replace(/[^a-z0-9]+/g, ' ')} `;
 if (exclusions.pageTypes.has(pageType) || exclusions.keywords.some(k => excludedText.includes(` ${k} `))) return verdict('EXCLUDED_BY_QUERY');

 const entity = resolveCandidateEntity(pageType, input);
 const placeNames = tgt ? tgt.cityTokens : [];
 if (!entity || entity.name.trim().length < 2 || isPlaceName(entity.name, placeNames) || isQueryEchoOrGeneric(entity.name, input.context)
  || (entity.method !== 'own_site' && entity.method !== 'own_job_page' && urlParts(input.url).domain && sameEntityAsDomain(entity.name, urlParts(input.url).domain) && pageType === 'THIRD_PARTY_JOB_BOARD'))
  return verdict('ENTITY_UNRESOLVED');
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
const GENERIC_ORG_TOKENS = new Set(['association', 'asso', 'federation', 'centre', 'social', 'sociale', 'socioculturel', 'maison', 'jeunes', 'jeunesse', 'culture', 'club', 'mairie', 'commune', 'ville', 'foyer', 'mjc', 'ehpad', 'ime', 'itep', 'esat', 'union', 'ligue', 'comite', 'fondation', 'mutuelle', 'societe', 'groupe', 'entreprise', 'agence', 'cabinet', 'sarl', 'sas', 'sasu', 'eurl', 'la', 'le', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'en']);
const hostOf = (url: string | null): string | null => { if (!url) return null; try { return getDomain(new URL(url).hostname.toLowerCase()); } catch { return null; } };
function hasDistinctiveName(name: string): boolean {
 return fold(name).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).some(w => w.length >= 3 && !GENERIC_ORG_TOKENS.has(w));
}
function sameEntity(a: Mergeable, b: Mergeable): boolean {
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
  const next = {...primary, raw_metadata: {...primary.raw_metadata, additional_sources: sources}} as T;
  kept[kept.indexOf(target)] = next;
 }
 return {kept, merged};
}
