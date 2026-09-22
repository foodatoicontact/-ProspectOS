// Deterministic, sector-agnostic entity resolution: turns a raw search hit (which may be the
// company's own site, a media article ABOUT the company, a directory listing, or something
// unrelated) into an independently-resolved COMPANY NAME and COMPANY DOMAIN, each with its own
// RESOLVED/UNRESOLVED status. The two are deliberately NOT coupled: a media article can name a real
// company clearly ("Grand Frais : 30 nouveaux magasins...") while citing no verifiable domain at
// all — that must read as "name identified, website to review", never force the whole candidate to
// UNRESOLVED just because no domain could be found, and never invent a domain from the name alone
// (no "Grand Frais" -> "grandfrais.com" guess, ever). Never invents a fact, never guesses among
// several candidates (ambiguity fails closed on both axes independently), and never produces a
// "VERIFIED" evidence status — that stays exclusively the human-gated ObservationsReview flow,
// untouched by this module. No LLM, no external call: runs entirely on the title/description/URL
// already fetched by the provider's own single search request.
import {getDomain} from 'tldts';
import {isKnownAggregatorHost} from './candidate-quality.ts';
import type {QualityAssessment} from './candidate-quality.ts';

// ------------------------------------------------------------
// Company NAME resolution
// ------------------------------------------------------------
export type CompanyNameMethod = 'own_site_title' | 'domain_label' | 'colon_prefix' | 'leading_verb';
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

// A run of 1-4 capitalized words — the shape a single, specific proper-noun company name takes in a
// French headline. Deliberately never longer (a 5+ word "capitalized run" is far more likely to be a
// full sentence in title case or an accidental grab than a real company name) and never a bare single
// generic word matched anywhere else in this module.
const CAPITALIZED_WORD = "[A-ZÀ-ÖØ-Þ][\\wÀ-ÖØ-öø-ÿ'’.-]*";
const CAPITALIZED_RUN = `${CAPITALIZED_WORD}(?:\\s+${CAPITALIZED_WORD}){0,3}`;
// "Grand Frais : 30 nouveaux magasins..." — a leading capitalized run immediately followed by a colon
// is a common, explicit French headline shape naming the article's single subject before elaborating.
const COLON_PREFIX_PATTERN = new RegExp(`^(${CAPITALIZED_RUN})\\s*:\\s+\\S`);
// A short, closed list of French commercial-signal verbs/phrases (openings/expansion — the exact
// kind of signal this codebase already searches for) — never an open-ended or sector-specific list.
const COMMERCIAL_VERBS = ['ouvre', 'ouvrira', 'va ouvrir', 'a ouvert', 'ont ouvert', 'annonce', 'lance', 'inaugure', 'poursuit', 'prévoit', 'dévoile'];
const LEADING_VERB_PATTERN = new RegExp(`^(${CAPITALIZED_RUN})\\s+(?:${COMMERCIAL_VERBS.join('|')})\\b`);

// Explicit conjunction/list guard: even though the capitalized-run shape above already fails to
// extend across a lowercase joiner like " et " (each word in the run must itself start with a
// capital letter), this is kept as a second, independent check — belt and braces against ever
// silently picking one company out of an article that actually names several ("Aldi et Lidl : ...").
function namesMultipleEntities(candidate: string): boolean {
 return /\b(et|and)\b/i.test(candidate) || /[,&]/.test(candidate);
}

// Only ever run when NO domain could be resolved at all (see resolveCanonicalCompany below) — a
// deliberately narrow, explicit-pattern extractor, never a generic "grab the first capitalized
// word(s)" heuristic. Fails closed (returns null) on anything that doesn't cleanly match one of the
// two patterns, on a multi-entity match, or on an implausibly long/short capture.
function extractCompanyNameFromTitle(title: string): {name: string; method: CompanyNameMethod} | null {
 const trimmed = title.trim();
 for (const [pattern, method] of [[COLON_PREFIX_PATTERN, 'colon_prefix'], [LEADING_VERB_PATTERN, 'leading_verb']] as const) {
  const match = pattern.exec(trimmed);
  if (!match) continue;
  const name = match[1]!.trim();
  if (name.length >= 2 && name.length <= 60 && !namesMultipleEntities(name)) return {name, method};
 }
 return null;
}

// ------------------------------------------------------------
// Company DOMAIN resolution — entirely independent of the name: a domain is resolved ONLY from
// directly observable evidence (an explicitly cited domain, or the fetched page itself looking like
// the company's own site), NEVER deduced from a resolved company name. "Grand Frais" never becomes
// "grandfrais.com" by inference.
// ------------------------------------------------------------
export type CompanyDomainMethod = 'own_site' | 'domain_in_text';
export type CompanyDomainResolution =
 | {status: 'RESOLVED'; method: CompanyDomainMethod; website: string; canonical_url: string; reasons: string[]}
 | {status: 'UNRESOLVED'; reasons: string[]};

// Finds domain-like tokens in free text and keeps only those tldts recognizes against the real
// Public Suffix List (rejecting file extensions, version numbers, and other non-domain shapes that a
// naive regex alone would accept) — the same dependency already used by candidate-diversity.ts, so
// no second implementation of "what is a real registrable domain" exists in this codebase.
const DOMAIN_TOKEN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+\b/gi;
function extractMentionedDomains(text: string, exclude: Set<string>): string[] {
 const found = new Set<string>();
 for (const token of text.match(DOMAIN_TOKEN) ?? []) {
  const domain = getDomain(token.toLowerCase());
  if (!domain || exclude.has(domain) || isKnownAggregatorHost(domain)) continue;
  found.add(domain);
 }
 return [...found];
}

// Method priority matters: an EXPLICIT domain citation in the text is checked first and always wins
// over the shape-based "looks like a homepage" proxy below — a media article can easily have a
// shallow, single-segment URL (many news CMSes flatten slugs to the root), so the shape signal alone
// must never outrank a domain the text itself names. The shape-based method is only ever a fallback
// for when NO domain at all is mentioned in the text.
function resolveCompanyDomain(input: {title: string; description: string; sourceUrl: string; quality: QualityAssessment}): CompanyDomainResolution {
 let hostname = '';
 try { hostname = new URL(input.sourceUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* CandidateSchema rejects an invalid source_url upstream anyway */ }
 const ownDomain = hostname ? getDomain(hostname) : null;

 // Method 1: exactly one distinct, non-aggregator domain is explicitly named in the title or
 // description (e.g. a media article citing "mango.com") — the source's own domain is excluded so a
 // media citing itself is never mistaken for citing an external official site.
 const exclude = new Set<string>(ownDomain ? [ownDomain] : []);
 const mentioned = extractMentionedDomains(`${input.title} ${input.description}`, exclude);
 if (mentioned.length === 1) {
  const domain = mentioned[0]!;
  const website = `https://${domain}`;
  return {status: 'RESOLVED', method: 'domain_in_text', website, canonical_url: website, reasons: [`domaine cité dans le texte : ${domain}`]};
 }

 // Method 2 (fallback, only when NOTHING is explicitly cited): the fetched page itself already looks
 // like a single business's own homepage — reusing the existing, already-tested candidate-quality.ts
 // signal — and is never a known aggregator/media host.
 if (mentioned.length === 0 && ownDomain && !isKnownAggregatorHost(hostname) && input.quality.signal === 'likely_business_site') {
  let origin = '';
  try { origin = new URL(input.sourceUrl).origin; } catch { /* unreachable: hostname was already parsed above */ }
  if (origin) return {status: 'RESOLVED', method: 'own_site', website: origin, canonical_url: origin, reasons: ['likely_business_site', `page source = domaine ${ownDomain}`]};
 }

 return {
  status: 'UNRESOLVED',
  reasons: mentioned.length === 0
   ? ['aucun domaine identifiable dans le titre ou la description']
   : [`plusieurs domaines distincts cités (${mentioned.join(', ')}) — résolution ambiguë, aucune sélection automatique`],
 };
}

// ------------------------------------------------------------
// Combined result — name and domain are always reported independently. See the module doc above for
// why: RESOLVED name + UNRESOLVED domain is a normal, expected, honest outcome (the Grand Frais /
// Aufeminin case), never collapsed into a single joint status.
// ------------------------------------------------------------
export interface CanonicalResolution {
 companyName: CompanyNameResolution;
 companyDomain: CompanyDomainResolution;
}

export function resolveCanonicalCompany(input: {title: string; description: string; sourceUrl: string; quality: QualityAssessment}): CanonicalResolution {
 const companyDomain = resolveCompanyDomain(input);
 let companyName: CompanyNameResolution;
 if (companyDomain.status === 'RESOLVED') {
  // The domain was resolved from directly observable evidence — derive the name from that SAME
  // evidence rather than independently re-guessing from the title, so the two never disagree when a
  // domain is actually known.
  companyName = companyDomain.method === 'domain_in_text'
   ? {status: 'RESOLVED', name: nameFromDomain(new URL(companyDomain.website).hostname), method: 'domain_label'}
   : {status: 'RESOLVED', name: cleanTitle(input.title), method: 'own_site_title'};
 } else {
  const extracted = extractCompanyNameFromTitle(input.title);
  companyName = extracted
   ? {status: 'RESOLVED', name: extracted.name, method: extracted.method}
   : {status: 'UNRESOLVED', name: cleanTitle(input.title)};
 }
 return {companyName, companyDomain};
}
