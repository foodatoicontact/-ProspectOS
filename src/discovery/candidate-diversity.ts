// Generic, deterministic diversity selection over an already quality-ranked candidate pool — runs
// strictly AFTER candidate-quality.ts's ranking and strictly BEFORE truncation to max_results. Never
// calls Brave again, never touches Evidence/scoreProspect/ICP: purely a reordering/selection step over
// results already fetched in the single billed request.
//
// Why this exists (see docs/DISCOVERY_CANDIDATE_QUALITY.md for the quality-ranking side, and
// docs/DISCOVERY_CANDIDATE_DIVERSITY.md for this module's own rationale): quality ranking alone answers
// "does this look like a real business page", but two DIFFERENT pages of the very same generic listing
// (e.g. a delivery-ordering platform's own two near-identical pages for the same city) can both score
// well and both survive ranking — occupying two of a very small max_results while a genuinely distinct
// establishment sits just below the cut. DeduplicationService (deduplication.ts) cannot help here: it
// compares prospects/candidates by website/phone/city, all of which are null on a raw, not-yet-analyzed
// search result — its identity model is for post-analysis prospects, not for search hits.
import {getDomain} from 'tldts';
import {similarity,normalize} from './deduplication.ts';

// A single very-high title similarity is a strong signal on its own, regardless of domain (two
// different sites both echoing the same generic listing text for the same establishment). A
// same-registrable-domain pair only counts as a near-duplicate on the WEAKER prefix/containment signal
// — a shared domain alone is deliberately never sufficient (a corporate/multi-brand domain can
// legitimately host several distinct establishments — see docs, Test C).
const HIGH_TITLE_SIMILARITY = 0.85;
const MIN_CONTAINED_TITLE_LENGTH = 15;

// Correct eTLD+1 (registrable domain) resolution via the Public Suffix List (see tldts in
// package.json — chosen after confirming no equivalent capability already existed anywhere in this
// project's dependency tree; see docs/DISCOVERY_CANDIDATE_DIVERSITY.md for the full justification and
// the alternative considered). A naive "last two labels" heuristic was deliberately rejected: it is
// wrong for composed TLDs (foo.example.co.uk and bar.other.co.uk would both naively reduce to
// "co.uk", wrongly treating two completely unrelated businesses as the same domain). getDomain returns
// null — never a guess — for anything without a recognized public suffix (localhost, a bare IP,
// malformed input): that null NEVER counts as a match, so no domain-based signal can ever fire for it.
const registrableDomain = (url: string): string | null => { try { return getDomain(new URL(url).hostname); } catch { return null; } };

// True when one normalized title is essentially a generic prefix/substring of the other — the exact
// shape of the real observed case ("Commande en ligne restaurant Toulouse" vs the same phrase followed
// by ": solution click & collect | Resto Drive"). Plain edit-distance similarity on the full strings
// scores this pair LOW (the length difference dominates the metric), so it needs its own explicit check
// — but only ever as a signal, combined with same-host below, never as a domain-wide blanket rule.
function titlesShareGenericPrefix(a: string, b: string): boolean {
 const na = normalize(a), nb = normalize(b);
 if (!na || !nb) return false;
 const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
 return shorter.length >= MIN_CONTAINED_TITLE_LENGTH && longer.includes(shorter);
}

export function isNearDuplicateCandidate(a: {title: string; url: string}, b: {title: string; url: string}): boolean {
 const highTitleSimilarity = similarity(a.title, b.title) >= HIGH_TITLE_SIMILARITY;
 if (highTitleSimilarity) return true; // strong enough alone — never requires a matching domain (Test B)
 const domainA = registrableDomain(a.url), domainB = registrableDomain(b.url);
 const sameRegistrableDomain = domainA !== null && domainA === domainB;
 // The weaker prefix signal only ever counts when reinforced by the same REGISTRABLE domain — a shared
 // domain with genuinely distinct titles is explicitly never treated as a duplicate (Test C), and two
 // different registrable domains that merely share a public suffix (foo.example.co.uk vs
 // bar.other.co.uk) are never conflated (Test 5) — domainA===domainB is a full eTLD+1 string match, not
 // a suffix check.
 return sameRegistrableDomain && titlesShareGenericPrefix(a.title, b.title);
}

// Greedy diversity selection: walk the pool in its existing (quality-descending) order, keep a
// candidate only if it is not a near-duplicate of one already kept. If that first pass could not fill
// max_results (too few genuinely distinct candidates in the whole pool — see Test E), a second pass
// fills the remaining slots from the skipped leftovers, in their original quality order, rather than
// under-returning: max_results is a ceiling on distinct-first output, never a reason to return fewer
// results than the pool can actually supply.
export function selectDiverseCandidates<T extends {title: string; url: string}>(qualitySortedPool: T[], maxResults: number): T[] {
 const selected: T[] = [];
 const skipped: T[] = [];
 for (const candidate of qualitySortedPool) {
  if (selected.length >= maxResults) { skipped.push(candidate); continue; }
  if (selected.some(kept => isNearDuplicateCandidate(kept, candidate))) skipped.push(candidate);
  else selected.push(candidate);
 }
 if (selected.length < maxResults) selected.push(...skipped.slice(0, maxResults - selected.length));
 return selected;
}
