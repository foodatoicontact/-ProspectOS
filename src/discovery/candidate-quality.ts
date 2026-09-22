// Generic, deterministic, explainable candidate-quality heuristic for real search results. Applies to
// ANY vertical (restaurants, cabinets comptables, agences immobilières, artisans, SaaS, etc.) — nothing
// here references a sector, a brand, or a city by name. It never invents a fact and never produces
// ICP/evidence data: `signal`/`reasons` are Discovery-internal explainability metadata, stored only in
// Candidate.raw_metadata (never surfaced as an ICP criterion, never becomes an Evidence row).
//
// Deliberately conservative (per the brief): this module only ever RE-RANKS and adjusts a normalization
// confidence — it never drops a candidate. A false-positive "this looks like a listicle" costs nothing
// (the result is still shown, just lower in the list and with a lower confidence badge); a false
// negative (missing a real listicle) is preferable to silently hiding a possibly-real business. See
// docs/DISCOVERY_CANDIDATE_QUALITY.md for the full rationale and residual known gaps.
export type QualitySignal = 'likely_business_site' | 'listicle_pattern' | 'editorial_pattern' | 'aggregator_pattern' | 'multi_entity_page' | 'ambiguous';
export interface QualityAssessment { confidence: number; signal: QualitySignal; reasons: string[] }

const MIN_CONFIDENCE = 0.05;
const MAX_CONFIDENCE = 0.9;
const BASELINE_CONFIDENCE = 0.45;

// A title opening with a number (optionally preceded by "les") is the single most reliable, fully
// generic listicle signal in French — "10 restaurants...", "Les 7 meilleures agences...", "15 cabinets
// comptables..." all share this shape regardless of sector.
const LISTICLE_NUMBER_PATTERN = /^\s*(les\s+)?\d{1,3}\s+\S/i;

// Generic French ranking/guide vocabulary — none of these words name a sector, a brand, or a place.
const EDITORIAL_WORDS = /\b(meilleurs?|meilleures?|top|classement|comparatif|guide|s[ée]lection|palmar[eè]s)\b/i;

// Generic multi-entity/marketplace vocabulary — again sector-agnostic.
const AGGREGATOR_WORDS = /\b(annuaire|comparateur|plateforme|marketplace|trouvez)\b/i;

// Small, explicitly secondary signal (never the primary mechanism): a handful of very well-known
// cross-sector aggregator/marketplace/directory/social domains that are structurally never a single
// business's own site, whatever the vertical being searched. Kept intentionally short — this is a
// reinforcement signal, not a domain blacklist to maintain over time.
// Exported so entity-resolution.ts can reuse the exact same list (aggregator/media hosts are never a
// company's own official site) without maintaining a second, driftable copy.
export const KNOWN_AGGREGATOR_HOSTS = [
 'ubereats.com', 'deliveroo.fr', 'deliveroo.com', 'justeat.fr', 'justeat.com',
 'tripadvisor.fr', 'tripadvisor.com', 'pagesjaunes.fr', 'yelp.fr', 'yelp.com',
 'leboncoin.fr', 'seloger.com', 'google.com', 'facebook.com', 'instagram.com',
 'wikipedia.org', 'trustpilot.com',
];
export const isKnownAggregatorHost = (hostname: string): boolean =>
 KNOWN_AGGREGATOR_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

const clamp = (value: number): number => Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, value));

// A shallow, near-root path (the page IS the site, not one article/listing buried in it) combined with
// a short title (a business's own homepage title is typically just its name + a short description, not
// a full editorial sentence) is a weak-but-genuine generic proxy for "this looks like a single
// business's own site" — never a certainty, just a proxy, and only ever a POSITIVE marker: its absence
// never counts as a negative signal (see below — absence of any signal at all stays 'ambiguous', it is
// never silently promoted to 'likely_business_site').
const isShallowPath = (path: string): boolean => path === '' || path === '/' || /^\/[^/]{1,40}\/?$/.test(path);
const looksLikeHomepageTitle = (title: string): boolean => title.trim().length <= 60;

export function assessCandidateQuality(result: { title: string; url: string; description?: string }, location: string): QualityAssessment {
 const reasons: string[] = [];
 let confidence = BASELINE_CONFIDENCE;
 let hostname = '';
 let path = '';
 try { const u = new URL(result.url); hostname = u.hostname.toLowerCase(); path = u.pathname; } catch { /* left blank — normalizeResult's own schema validation handles an invalid URL */ }
 const text = `${result.title} ${result.description ?? ''}`.toLowerCase();

 if (isKnownAggregatorHost(hostname)) { reasons.push('aggregator_pattern', 'multi_entity_page'); confidence -= 0.30; }
 if (LISTICLE_NUMBER_PATTERN.test(result.title)) { reasons.push('listicle_pattern'); confidence -= 0.25; }
 if (EDITORIAL_WORDS.test(text)) { reasons.push('editorial_pattern'); confidence -= 0.20; }
 if (AGGREGATOR_WORDS.test(text)) { reasons.push('aggregator_pattern'); confidence -= 0.20; }
 const hasNegativeSignal = reasons.length > 0;

 // Only ever evaluated when NOTHING negative was found — this is a positive marker, never a way to
 // override a detected negative one, and its absence is never itself treated as a negative: a page that
 // matches neither bucket stays honestly 'ambiguous' rather than being fabricated into either extreme.
 if (!hasNegativeSignal && isShallowPath(path) && looksLikeHomepageTitle(result.title)) {
  reasons.push('likely_business_site'); confidence += 0.15;
 }

 // Purely observational — does the result even mention the requested zone? Never invents a location,
 // only reports whether the exact user-provided (first, comma-separated) zone token already appears.
 // Applied regardless of bucket: it is informational, not a verdict on its own.
 const cityToken = location.split(',')[0]?.trim().toLowerCase();
 if (cityToken && (text.includes(cityToken) || hostname.includes(cityToken.replace(/\s+/g, '')) || path.toLowerCase().includes(cityToken))) {
  reasons.push('location_match'); confidence += 0.05;
 }

 const signal: QualitySignal =
  reasons.includes('aggregator_pattern') || reasons.includes('multi_entity_page') ? 'aggregator_pattern'
  : reasons.includes('listicle_pattern') ? 'listicle_pattern'
  : reasons.includes('editorial_pattern') ? 'editorial_pattern'
  : reasons.includes('likely_business_site') ? 'likely_business_site'
  : 'ambiguous';

 return { confidence: clamp(confidence), signal, reasons: [...new Set(reasons)] };
}
