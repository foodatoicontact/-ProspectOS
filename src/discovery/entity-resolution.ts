// Deterministic, sector-agnostic entity resolution. Pipeline for one search result:
//   1. classify the PAGE (source-classification.ts): own site, job board, marketplace, directory, search
//      page, article, individual profile, or unknown;
//   2. resolve the ORGANIZATION the page is about — company name and company domain, independently —
//      with rules gated by that page type;
//   3. derive the result's class: COMPANY_CANDIDATE (the resolved organization — the page is either its
//      own site, or a third-party page such as a job ad or an article that explicitly names it; then the
//      page only remains the provenance: source_type/source_url describe it and its domain is never the
//      company's website), IRRELEVANT (a third-party page with no resolvable organization — never a
//      prospect), UNCERTAIN (cannot tell — never presented as a company). SIGNAL_SOURCE stays a valid
//      class but is not produced here; the database refuses it on accept like everything but
//      COMPANY_CANDIDATE (migration 014).
// Invariants: a search title is never blindly a company name (a title-derived name must be corroborated
// by the page's own domain, or come from an explicit naming pattern on a non-listing page); a source's
// own domain is only ever the company domain when the page IS that company's own site; a domain is never
// inferred from a name; ambiguity always fails closed; nothing here ever produces an evidence
// verification status — that stays exclusively the human-gated ObservationsReview flow. No LLM, no
// network: runs only on the title/description/URL already fetched by the single search request.
import {parse as parseDomain} from 'tldts';
import {isKnownAggregatorHost} from './candidate-quality.ts';
import type {QualityAssessment} from './candidate-quality.ts';
import {classifySourceType,isKnownPlatformDomain,isListingTitle,isQueryEchoOrGeneric,observedQueryTerms,sourceDomainOf,titleSegments,type QueryContext,type SourceClass,type SourceType} from './source-classification.ts';

// ------------------------------------------------------------
// Company NAME resolution
// ------------------------------------------------------------
export type CompanyNameMethod = 'own_site_title' | 'domain_label' | 'colon_prefix' | 'leading_verb' | 'chez_mention';
export type CompanyNameResolution =
 | {status: 'RESOLVED'; name: string; method: CompanyNameMethod}
 | {status: 'UNRESOLVED'; name: string};

// A trailing " | Publisher" / " - Publisher" / " — Publisher" / " – Publisher" segment is generic
// editorial/CMS boilerplate, never part of a shorter, more specific business name — only ever the
// LAST such segment is dropped (never a middle one), and only when what remains is still
// substantial, so a title with no such separator is returned completely untouched.
const TITLE_SEPARATOR = /\s[-–—|]\s/;
export function cleanTitle(title: string): string {
 const trimmed = title.trim();
 const parts = trimmed.split(TITLE_SEPARATOR);
 if (parts.length < 2) return trimmed;
 const head = parts.slice(0, -1).join(' - ').trim();
 const tail = parts[parts.length - 1]!.trim();
 return tail.length >= 1 && tail.length <= 40 && head.length >= 2 ? head : trimmed;
}

// Deterministic, capitalization-only name derivation from a registrable domain's own label — used
// only when a domain is confidently identified as the company's own (never for an aggregator/media
// host, filtered upstream of every call site). "grand-frais.fr" -> "Grand Frais"; never invents a
// legal form or a brand's real spelling beyond straightforward capitalization of the domain's words.
export function nameFromDomain(domain: string): string {
 const label = domain.split('.')[0] ?? domain;
 return label.split(/[-_]+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

const alnum = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A title segment is the organization's own name only when the site's own domain label starts with it
// ("Chez Mario" / chezmario-toulouse.fr, "La Collab" / lacollab.com). An SEO phrase ("Plombier
// Toulouse", "Consultant Freelance en Marketing Digital") is never corroborated by the domain and is
// therefore never used as a company name.
function corroborates(name: string, domain: string | null): boolean {
 if (!domain) return false;
 const n = alnum(name), label = alnum(domain.split('.')[0] ?? '');
 return n.length >= 3 && label.startsWith(n);
}

// A run of 1-4 capitalized words — the shape a single, specific proper-noun company name takes in a
// French headline. Deliberately never longer (a 5+ word "capitalized run" is far more likely to be a
// full sentence in title case or an accidental grab than a real company name).
const CAPITALIZED_WORD = "[A-ZÀ-ÖØ-Þ][\\wÀ-ÖØ-öø-ÿ'’.-]*";
const CAPITALIZED_RUN = `${CAPITALIZED_WORD}(?:\\s+${CAPITALIZED_WORD}){0,3}`;
// "Grand Frais : 30 nouveaux magasins..." — a leading capitalized run immediately followed by a colon.
const COLON_PREFIX_PATTERN = new RegExp(`^(${CAPITALIZED_RUN})\\s*:\\s+\\S`);
// A short, closed list of French organizational-action verbs (openings/expansion/hiring) — never an
// open-ended or sector-specific list.
const COMMERCIAL_VERBS = ['ouvre', 'ouvrira', 'va ouvrir', 'a ouvert', 'ont ouvert', 'annonce', 'lance', 'inaugure', 'poursuit', 'prévoit', 'dévoile', 'recrute'];
const LEADING_VERB_PATTERN = new RegExp(`^(${CAPITALIZED_RUN})\\s+(?:${COMMERCIAL_VERBS.join('|')})\\b`);
// "Chargé de marketing H/F chez Grand Frais - Lyon" — a job ad naming its employer. Lowercase "chez"
// only, so a business whose own name starts with "Chez" is never matched here.
const CHEZ_PATTERN = new RegExp(`\\bchez\\s+(${CAPITALIZED_RUN})`);

// Explicit conjunction/list guard: never silently pick one company out of a title naming several
// ("Aldi et Lidl : ...").
function namesMultipleEntities(candidate: string): boolean {
 return /\b(et|and)\b/i.test(candidate) || /[,&]/.test(candidate);
}

// Narrow, explicit-pattern extractor for third-party pages — never a generic "grab the first
// capitalized word(s)" heuristic. Fails closed (null) on a listing title (its "X :" prefix is the
// search term, not an entity), on a multi-entity match, on an implausible capture, and on a name made
// only of the user's own query words / generic role words (the search echoed back by the page).
function extractCompanyNameFromTitle(title: string, context?: QueryContext): {name: string; method: CompanyNameMethod} | null {
 const trimmed = title.trim();
 if (isListingTitle(trimmed)) return null;
 for (const [pattern, method] of [[COLON_PREFIX_PATTERN, 'colon_prefix'], [LEADING_VERB_PATTERN, 'leading_verb'], [CHEZ_PATTERN, 'chez_mention']] as const) {
  const match = pattern.exec(trimmed);
  if (!match) continue;
  const name = match[1]!.trim();
  if (name.length >= 2 && name.length <= 60 && !namesMultipleEntities(name) && !isQueryEchoOrGeneric(name, context)) return {name, method};
 }
 return null;
}

// ------------------------------------------------------------
// Company DOMAIN resolution — a domain is resolved ONLY from directly observable evidence (an
// explicitly cited domain, or the page being the organization's own site), NEVER inferred from a name
// and NEVER taken from a third-party source page.
// ------------------------------------------------------------
export type CompanyDomainMethod = 'own_site' | 'domain_in_text';
export type CompanyDomainResolution =
 | {status: 'RESOLVED'; method: CompanyDomainMethod; website: string; canonical_url: string; reasons: string[]}
 | {status: 'UNRESOLVED'; reasons: string[]};

// Domain-like tokens validated against the real Public Suffix List (tldts). The source's own domain,
// aggregators and known job boards / marketplaces are never a cited company domain ("disponible sur
// Indeed.com" names the platform, not an employer).
// A dotted number ("23.09.2026", "1.500", "0.08", "v2.0") also matches DOMAIN_TOKEN, and tldts treats
// an unknown suffix as public by default — so only a suffix from the ICANN section of the list counts,
// never an IP, and only a domain that is itself a valid, unchanged URL host: never a website made up
// from a number.
const DOMAIN_TOKEN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+\b/gi;
const isUrlHost = (domain: string): boolean => { try { return new URL(`https://${domain}`).hostname === domain; } catch { return false; } };
function extractMentionedDomains(text: string, ownDomain: string | null): string[] {
 const found = new Set<string>();
 for (const token of text.match(DOMAIN_TOKEN) ?? []) {
  const parsed = parseDomain(token.toLowerCase());
  const domain = parsed.domain;
  if (!domain || parsed.isIcann !== true || parsed.isIp || !isUrlHost(domain)) continue;
  if (domain === ownDomain || isKnownAggregatorHost(domain) || isKnownPlatformDomain(domain)) continue;
  found.add(domain);
 }
 return [...found];
}

// ------------------------------------------------------------
// Combined result.
// ------------------------------------------------------------
export interface CanonicalResolution {
 companyName: CompanyNameResolution;
 companyDomain: CompanyDomainResolution;
 sourceType: SourceType;
 sourceClass: SourceClass;
 sourceDomain: string | null;
 classificationReasons: string[];
 // Query terms literally observed in this result's own title/snippet; null = no query to check.
 relevanceTerms: string[] | null;
}

const THIRD_PARTY_TYPES_WITHOUT_COMPANY_ARE_IRRELEVANT: ReadonlySet<SourceType> = new Set(['job_board', 'marketplace', 'directory', 'search_page', 'editorial']);

export function resolveCanonicalCompany(input: {title: string; description: string; sourceUrl: string; quality: QualityAssessment; context?: QueryContext}): CanonicalResolution {
 const sourceDomain = sourceDomainOf(input.sourceUrl);
 const page = classifySourceType({title: input.title, description: input.description, url: input.sourceUrl, quality: input.quality, context: input.context});
 let sourceType = page.type;
 const reasons = [...page.reasons];
 const fallbackName = cleanTitle(input.title);
 const relevanceTerms = observedQueryTerms(`${input.title} ${input.description}`, input.context);
 const unresolvedDomain = (why: string): CompanyDomainResolution => ({status: 'UNRESOLVED', reasons: [why]});
 const finish = (companyName: CompanyNameResolution, companyDomain: CompanyDomainResolution, sourceClass: SourceClass): CanonicalResolution => {
  // Phase-5 relevance gate: a resolved organization whose own snippet shows none of the user's query
  // terms is never presented as an exploitable candidate — Brave's semantic ranking is not an ICP
  // validation. Identity fields are kept (they are observed facts); only the class is downgraded.
  if ((sourceClass === 'COMPANY_CANDIDATE' || sourceClass === 'SIGNAL_SOURCE') && relevanceTerms !== null && relevanceTerms.length === 0) {
   reasons.push('no_observable_relevance');
   sourceClass = 'UNCERTAIN';
  }
  return {companyName, companyDomain, sourceType, sourceClass, sourceDomain, classificationReasons: reasons, relevanceTerms};
 };

 // 1. An explicitly cited external company domain, on any page, identifies the organization the page is
 //    about — and makes the page a third-party signal source for it.
 const mentioned = extractMentionedDomains(`${input.title} ${input.description}`, sourceDomain);
 if (mentioned.length === 1) {
  const domain = mentioned[0]!;
  const website = `https://${domain}`;
  if (sourceType === 'official_site' || sourceType === 'unknown') sourceType = 'editorial';
  reasons.push('cites_external_company_domain');
  return finish({status: 'RESOLVED', name: nameFromDomain(domain), method: 'domain_label'}, {status: 'RESOLVED', method: 'domain_in_text', website, canonical_url: website, reasons: [`domaine cité dans le texte : ${domain}`]}, 'COMPANY_CANDIDATE');
 }
 if (mentioned.length > 1) {
  reasons.push('multiple_company_domains_cited');
  const domain = unresolvedDomain(`plusieurs domaines distincts cités (${mentioned.join(', ')}) — résolution ambiguë, aucune sélection automatique`);
  return finish({status: 'UNRESOLVED', name: fallbackName}, domain, THIRD_PARTY_TYPES_WITHOUT_COMPANY_ARE_IRRELEVANT.has(sourceType) ? 'IRRELEVANT' : 'UNCERTAIN');
 }

 // 2. The page is shaped like an organization's own site. It really is one only if its title does not
 //    explicitly name a DIFFERENT organization ("Mango ouvre…" on a media domain is an article).
 const extracted = extractCompanyNameFromTitle(input.title, input.context);
 if (sourceType === 'official_site' && extracted && !corroborates(extracted.name, sourceDomain)) {
  sourceType = 'editorial';
  reasons.push('title_names_another_organization');
 }
 if (sourceType === 'official_site' && sourceDomain) {
  let origin = '';
  try { origin = new URL(input.sourceUrl).origin; } catch { /* unreachable: sourceDomain was parsed from it */ }
  if (origin) {
   const ownName = titleSegments(input.title).find(segment => corroborates(segment, sourceDomain));
   const companyName: CompanyNameResolution = ownName ? {status: 'RESOLVED', name: ownName, method: 'own_site_title'} : {status: 'RESOLVED', name: nameFromDomain(sourceDomain), method: 'domain_label'};
   return finish(companyName, {status: 'RESOLVED', method: 'own_site', website: origin, canonical_url: origin, reasons: [...page.reasons, `page source = domaine ${sourceDomain}`]}, 'COMPANY_CANDIDATE');
  }
 }

 // 3. Any other page is third-party content: it can only point AT an organization it explicitly names.
 //    Its own domain is never the company domain.
 const thirdPartyDomain = unresolvedDomain(sourceType === 'unknown' ? 'aucun domaine identifiable dans le titre ou la description' : `page tierce (${sourceType}) : son domaine n’est jamais celui de l’entreprise`);
 if (extracted) return finish({status: 'RESOLVED', name: extracted.name, method: extracted.method}, thirdPartyDomain, 'COMPANY_CANDIDATE');
 return finish({status: 'UNRESOLVED', name: fallbackName}, thirdPartyDomain, THIRD_PARTY_TYPES_WITHOUT_COMPANY_ARE_IRRELEVANT.has(sourceType) ? 'IRRELEVANT' : 'UNCERTAIN');
}
