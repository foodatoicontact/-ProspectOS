// Deterministic source classification for real search results: WHAT KIND OF PAGE is this, before
// anything is allowed to call it a company. A search engine returns pages that are semantically
// relevant to a query — a job board listing, a freelance marketplace, a news article, a consultant's
// personal site — and relevance is not identity: none of those pages is itself the organization being
// prospected. Structural signals come first (URL shape, search parameters, listing counts, job-ad and
// role vocabulary, the existing editorial/aggregator quality signals); a short list of well-known
// cross-sector platforms is only a reinforcing signal, never the mechanism. Pure, no network, no LLM,
// never produces or references an evidence verification status.
import {getDomain} from 'tldts';
import {isKnownAggregatorHost,type QualityAssessment} from './candidate-quality.ts';

export type SourceClass = 'COMPANY_CANDIDATE' | 'SIGNAL_SOURCE' | 'IRRELEVANT' | 'UNCERTAIN';
export type SourceType = 'official_site' | 'editorial' | 'job_board' | 'marketplace' | 'directory' | 'search_page' | 'individual_profile' | 'unknown';
export interface QueryContext { query: string; categories: string[] }

// Reinforcing signal only (see module doc): widely used, cross-sector job boards and freelance
// marketplaces. Everything these catch is also caught structurally for an unknown host.
const KNOWN_JOB_BOARD_DOMAINS = new Set(['indeed.com', 'welcometothejungle.com', 'hellowork.com', 'monster.fr', 'glassdoor.fr', 'glassdoor.com', 'apec.fr', 'francetravail.fr', 'jobteaser.com', 'jooble.org', 'meteojob.com', 'cadremploi.fr']);
const KNOWN_MARKETPLACE_DOMAINS = new Set(['malt.fr', 'malt.com', 'fiverr.com', 'upwork.com', 'codeur.com', 'comeup.com']);
export const isKnownPlatformDomain = (domain: string | null): boolean => !!domain && (KNOWN_JOB_BOARD_DOMAINS.has(domain) || KNOWN_MARKETPLACE_DOMAINS.has(domain));

const SEARCH_PARAM_KEYS = new Set(['q', 'query', 'search', 's', 'keywords', 'k', 'what', 'term', 'recherche']);
const SEARCH_PATH_SEGMENT = /^(search|recherche|rechercher|resultats?|results?|s|q-.+)$/i;
const JOB_PATH_SEGMENT = /^(jobs?|emplois?|offres?|offre-emploi|offres-d-emploi|viewjob|recrutement|missions?)$/i;
const JOB_VOCABULARY = /\b(H\/F|F\/H|CDI|CDD|alternance|offres? d['’]emploi|emplois?|recrute|recrutement|candidature|postuler|jobs?|missions? freelance)\b/i;
// "plus de 100 emplois", "245 offres d'emploi", "12 000 freelances" — a count of items is the shape of a
// listing page, never of a single organization's page.
const JOB_LISTING_COUNT = /\b\d[\d\s.,]*\+?\s*(offres?|emplois?|jobs?|missions?|annonces?|postes?)\b/i;
const PROFILE_LISTING_COUNT = /\b\d[\d\s.,]*\+?\s*(freelances?|profils?|prestataires?|consultants?|experts?)\b/i;
const RESULTS_COUNT = /\b\d[\d\s.,]*\+?\s*r[ée]sultats?\b/i;
const MARKETPLACE_VOCABULARY = /\b(marketplace|plateforme|trouvez (les |des |un |une )?(meilleurs? )?(freelances?|prestataires?|consultants?|experts?|profils?))\b/i;
const DIRECTORY_VOCABULARY = /\b(annuaire|comparateur)\b/i;
const EDITORIAL_PATH_SEGMENT = /^(actualites?|actus?|news|article|articles|blog|magazine|presse|dossiers?|\d{4})$/i;
// A title (or title segment) that opens with a singular role noun describes a PERSON offering a
// service ("Consultant Freelance en Marketing Digital", "Jean Dupont - Consultante indépendante"), not
// an organization. Plural forms ("Consultants en stratégie") and explicit organization markers
// ("Cabinet", "Agence", "SAS"…) are deliberately excluded.
const ROLE_START = /^(consultant|consultante|freelance|ind[ée]pendant|ind[ée]pendante|auto[- ]?entrepreneur|auto[- ]?entrepreneuse|coach|formateur|formatrice|portfolio|cv)\b/i;
const ORGANIZATION_MARKER = /\b(agence|cabinet|soci[ée]t[ée]|groupe|studio|collectif|entreprise|sarl|sas|sasu|eurl)\b/i;
const PROFILE_PATH_SEGMENT = /^(profil|profile|profiles|in|u|user|users|freelancer|@.+)$/i;
// The query itself explicitly targets platforms — only then may a platform's own homepage be a
// company candidate (e.g. "plateformes de freelances").
const PLATFORM_INTENT = /\b(marketplaces?|plateformes?|job ?boards?|sites? d['’]emploi|sites? de recrutement|annuaires?|agr[ée]gateurs?)\b/i;

const TITLE_SPLIT = /\s[-\u2013\u2014|:]\s|\s:\s?/;
export const titleSegments = (title: string): string[] => title.split(TITLE_SPLIT).map(s => s.trim()).filter(Boolean);

export function sourceDomainOf(url: string): string | null {
 try { return getDomain(new URL(url).hostname.toLowerCase()); } catch { return null; }
}

export function classifySourceType(input: {title: string; description: string; url: string; quality: QualityAssessment; context?: QueryContext}): {type: SourceType; reasons: string[]} {
 let hostname = '', segments: string[] = [], paramKeys: string[] = [];
 try {
  const u = new URL(input.url);
  hostname = u.hostname.toLowerCase();
  segments = u.pathname.split('/').filter(Boolean);
  paramKeys = [...u.searchParams.keys()].map(k => k.toLowerCase());
 } catch { /* CandidateSchema rejects an invalid source_url upstream */ }
 const domain = hostname ? getDomain(hostname) : null;
 const title = input.title;
 const titleAndPath = `${title} ${segments.join(' ')}`;
 const titleAndDescription = `${title} ${input.description}`;
 const isHomepage = segments.length === 0 && paramKeys.length === 0;
 const knownJobBoard = !!domain && KNOWN_JOB_BOARD_DOMAINS.has(domain);
 const knownMarketplace = !!domain && KNOWN_MARKETPLACE_DOMAINS.has(domain);
 const platformIntent = !!input.context && PLATFORM_INTENT.test(`${input.context.query} ${input.context.categories.join(' ')}`);

 if (platformIntent && isHomepage && (knownJobBoard || knownMarketplace || isKnownAggregatorHost(hostname) || MARKETPLACE_VOCABULARY.test(titleAndDescription)))
  return {type: 'official_site', reasons: ['platform_homepage_targeted_by_query']};
 if (knownJobBoard || JOB_LISTING_COUNT.test(title) || JOB_VOCABULARY.test(titleAndPath) || segments.some(s => JOB_PATH_SEGMENT.test(s)))
  return {type: 'job_board', reasons: [knownJobBoard ? 'known_job_board' : 'job_structure']};
 if (knownMarketplace || PROFILE_LISTING_COUNT.test(title) || MARKETPLACE_VOCABULARY.test(titleAndDescription))
  return {type: 'marketplace', reasons: [knownMarketplace ? 'known_marketplace' : 'marketplace_structure']};
 if (isKnownAggregatorHost(hostname) || DIRECTORY_VOCABULARY.test(title))
  return {type: 'directory', reasons: ['directory_structure']};
 if (paramKeys.some(k => SEARCH_PARAM_KEYS.has(k)) || segments.some(s => SEARCH_PATH_SEGMENT.test(s)) || RESULTS_COUNT.test(title))
  return {type: 'search_page', reasons: ['search_page_structure']};
 if (input.quality.signal === 'listicle_pattern' || input.quality.signal === 'editorial_pattern' || segments.some(s => EDITORIAL_PATH_SEGMENT.test(s)))
  return {type: 'editorial', reasons: ['editorial_structure']};
 if ((!ORGANIZATION_MARKER.test(title) && titleSegments(title).some(s => ROLE_START.test(s))) || segments.some(s => PROFILE_PATH_SEGMENT.test(s)))
  return {type: 'individual_profile', reasons: ['individual_role_or_profile_path']};
 if (input.quality.signal === 'likely_business_site')
  return {type: 'official_site', reasons: ['homepage_shape']};
 return {type: 'unknown', reasons: ['no_structural_signal']};
}

// A listing page's title describes the listing ("Freelance Media : plus de 100 emplois"), never an
// entity — no company name may ever be extracted from it.
export const isListingTitle = (title: string): boolean => JOB_LISTING_COUNT.test(title) || PROFILE_LISTING_COUNT.test(title) || RESULTS_COUNT.test(title);

const STOPWORDS = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'par', 'aux', 'est', 'son', 'ses', 'leur', 'leurs', 'qui', 'que', 'site', 'officiel', 'france', 'the', 'and', 'for']);
const ROLE_WORDS = new Set(['freelance', 'freelances', 'consultant', 'consultante', 'consultants', 'emploi', 'emplois', 'job', 'jobs', 'mission', 'missions', 'offre', 'offres', 'stage', 'stages', 'alternance', 'recrutement', 'annonce', 'annonces', 'independant', 'independante', 'independants']);
const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const queryTerms = (context: QueryContext | undefined): string[] =>
 context ? [...new Set(fold(`${context.query} ${context.categories.join(' ')}`).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOPWORDS.has(t)))] : [];

// A name made only of the user's own query words and generic role/listing words is the search echoed
// back by the page ("Freelance Media" for the query "freelance media"), not an organization.
export function isQueryEchoOrGeneric(name: string, context: QueryContext | undefined): boolean {
 const words = fold(name).split(/[^a-z0-9]+/).filter(w => w.length >= 2);
 if (!words.length) return true;
 const terms = new Set(queryTerms(context));
 return words.every(w => ROLE_WORDS.has(w) || terms.has(w) || terms.has(w.replace(/[sx]$/, '')) || terms.has(`${w}s`));
}

// Phase-5 relevance gate: which of the user's query terms are literally observable in this result's own
// title/snippet. This is NOT an ICP validation and never becomes evidence — only a minimal, explainable
// "why was this shown" check. null = no query context to evaluate against (e.g. a direct unit call).
export function observedQueryTerms(text: string, context: QueryContext | undefined): string[] | null {
 const terms = queryTerms(context);
 if (!terms.length) return null;
 const haystack = fold(text);
 return terms.filter(t => haystack.includes(t) || (t.length > 4 && haystack.includes(t.replace(/[sx]$/, ''))));
}

// Server-side accept gate: only a result whose organization is actually resolved may become a
// prospect. Rows without a class (fixture, or created before this classification existed) keep their
// existing behavior — the gate never guesses about data it cannot read.
export function isAcceptableCandidate(normalizedPayload: unknown): boolean {
 const cls = (normalizedPayload as {raw_metadata?: {source_class?: unknown}} | null)?.raw_metadata?.source_class;
 return cls !== 'IRRELEVANT' && cls !== 'UNCERTAIN';
}
