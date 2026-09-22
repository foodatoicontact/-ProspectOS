// Deterministic, sector-agnostic entity resolution: turns a raw search hit (which may be the
// company's own site, a media article ABOUT the company, a directory listing, or something
// unrelated) into either a RESOLVED canonical company (name + official website, with an
// explainable method) or an explicit UNRESOLVED state. Never invents a fact, never guesses among
// several candidates (ambiguity fails closed), and never produces a "VERIFIED" evidence status —
// that stays exclusively the human-gated ObservationsReview flow, untouched by this module. No
// LLM, no external call: runs entirely on the title/description/URL already fetched by the
// provider's own single search request. See the ENTITY_RESOLUTION_AUDIT report for full rationale.
import {getDomain} from 'tldts';
import {isKnownAggregatorHost} from './candidate-quality.ts';
import type {QualityAssessment} from './candidate-quality.ts';

export type CanonicalResolutionMethod = 'own_site' | 'domain_in_text';
export type CanonicalResolution =
 | {status: 'RESOLVED'; method: CanonicalResolutionMethod; name: string; website: string; canonical_url: string; reasons: string[]}
 | {status: 'UNRESOLVED'; name: string; reasons: string[]};

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

// The sole decision point: RESOLVED only via one of two conservative, explainable methods, and only
// ever when exactly one candidate company is identifiable — any ambiguity (zero or several distinct
// domains mentioned) fails closed to UNRESOLVED rather than guessing among several named companies.
//
// Method priority matters: an EXPLICIT domain citation in the text is checked first and always wins
// over the shape-based "looks like a homepage" proxy below — a media article can easily have a
// shallow, single-segment URL (many news CMSes flatten slugs to the root), so the shape signal alone
// must never outrank a domain the text itself names. The shape-based method is only ever a fallback
// for when NO domain at all is mentioned in the text.
export function resolveCanonicalCompany(input: {title: string; description: string; sourceUrl: string; quality: QualityAssessment}): CanonicalResolution {
 const name = cleanTitle(input.title);
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
  return {status: 'RESOLVED', method: 'domain_in_text', name: nameFromDomain(domain), website, canonical_url: website, reasons: [`domaine cité dans le texte : ${domain}`]};
 }

 // Method 2 (fallback, only when NOTHING is explicitly cited): the fetched page itself already looks
 // like a single business's own homepage — reusing the existing, already-tested candidate-quality.ts
 // signal — and is never a known aggregator/media host.
 if (mentioned.length === 0 && ownDomain && !isKnownAggregatorHost(hostname) && input.quality.signal === 'likely_business_site') {
  let origin = '';
  try { origin = new URL(input.sourceUrl).origin; } catch { /* unreachable: hostname was already parsed above */ }
  if (origin) return {status: 'RESOLVED', method: 'own_site', name, website: origin, canonical_url: origin, reasons: ['likely_business_site', `page source = domaine ${ownDomain}`]};
 }

 return {
  status: 'UNRESOLVED',
  name,
  reasons: mentioned.length === 0
   ? ['aucun domaine officiel identifiable dans le titre ou la description']
   : [`plusieurs domaines distincts cités (${mentioned.join(', ')}) — résolution ambiguë, aucune sélection automatique`],
 };
}
