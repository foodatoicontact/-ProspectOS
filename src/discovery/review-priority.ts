// Review priority — WHICH candidate to look at first, before any proof is reviewed. Deterministic, pure, no
// network, no LLM. It reads only what Discovery already observed about the page and the organization
// (raw_metadata), and it is never a score:
//   - it never reads, writes or implies an evidence status (VERIFIED / NOT_VERIFIED / INFERRED / UNKNOWN);
//   - it never enters the verified 0–100 score (domain/core.ts scoreProspect), which keeps counting validated
//     proofs only — a candidate with HIGH priority and no validated proof still scores 0/100;
//   - its output is three levels and the list of observations that produced it, so the user always sees WHY.
// A result that is not an exploitable COMPANY_CANDIDATE is always LOW: it stays visible (transparency) but
// never competes with real organizations for the top of the review list.
export type ReviewPriorityLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type ReviewPriorityReason =
 | 'official_site' | 'named_by_third_party' | 'website_identified' | 'query_terms_observed' | 'single_query_term' | 'no_specific_query_term'
 | 'location_mentioned' | 'several_sources' | 'business_site_shape' | 'job_ad_source' | 'content_source' | 'listing_or_editorial_shape'
 | 'not_a_company_candidate' | 'cooperative_or_network' | 'public_body' | 'public_registry' | 'registry_activity_code';
export type ReviewPriority = {level: ReviewPriorityLevel; reasons: ReviewPriorityReason[]};

// Words of a brief that say nothing about the target's activity ("entreprises", "sociétés", "PME"…): observing
// them in a snippet is no sign of relevance.
const GENERIC_TERMS = new Set(['entreprise', 'entreprises', 'societe', 'societes', 'pme', 'tpe', 'eti', 'structure', 'structures', 'organisation', 'organisations',
 'professionnel', 'professionnels', 'acteur', 'acteurs', 'client', 'clients', 'publics', 'public', 'france', 'region', 'secteur']);
const specificTerms = (terms: unknown): string[] => Array.isArray(terms) ? terms.filter((t): t is string => typeof t === 'string' && !GENERIC_TERMS.has(t)) : [];

type Meta = Record<string, unknown> & {
 source_class?: unknown; source_type?: unknown; entity_confidence?: unknown; company_domain_method?: unknown; relevance_terms?: unknown; location_state?: unknown;
 page_type?: unknown; quality_signal?: unknown; additional_sources?: unknown; entity_type?: unknown;
};

export function reviewPriority(meta: Meta | null | undefined, website?: string | null): ReviewPriority {
 const m = meta ?? {};
 if (m.source_class !== 'COMPANY_CANDIDATE') return {level: 'LOW', reasons: ['not_a_company_candidate']};
 const reasons: ReviewPriorityReason[] = [];
 let points = 0;
 const ownSite = m.entity_confidence === 'RESOLVED_HIGH';
 // A company from the public register (providers/registry.ts) is an identity with its declared activity (NAF
 // code), not a name read on someone else's page: it is said so. Without its official site it stays MEDIUM.
 if (m.source_type === 'public_registry') {
  reasons.push('public_registry', 'registry_activity_code');
  return {level: 'MEDIUM', reasons};
 }
 if (ownSite) { points += 2; reasons.push('official_site'); } else reasons.push('named_by_third_party');
 if (website) { points += 1; reasons.push('website_identified'); }
 const terms = specificTerms(m.relevance_terms);
 if (terms.length >= 2) { points += 2; reasons.push('query_terms_observed'); }
 else if (terms.length === 1) { points += 1; reasons.push('single_query_term'); }
 else { points -= 1; reasons.push('no_specific_query_term'); }
 if (m.location_state === 'VERIFIED') { points += 1; reasons.push('location_mentioned'); }
 if (Array.isArray(m.additional_sources) && m.additional_sources.length > 0) { points += 1; reasons.push('several_sources'); }
 if (m.quality_signal === 'likely_business_site') { points += 1; reasons.push('business_site_shape'); }
 if (m.quality_signal === 'listicle_pattern' || m.quality_signal === 'editorial_pattern' || m.quality_signal === 'aggregator_pattern') { points -= 1; reasons.push('listing_or_editorial_shape'); }
 if (m.page_type === 'THIRD_PARTY_JOB_BOARD') { points -= 1; reasons.push('job_ad_source'); }
 if (m.page_type === 'NEWS_ARTICLE' || m.page_type === 'BLOG_OR_CONTENT' || m.page_type === 'UNKNOWN') { points -= 1; reasons.push('content_source'); }
 // A cooperative, a network of members or a public body is correctly identified, but it is not the single company a
 // prospect list targets: it stays visible (a possible partner or client) and never tops the review list.
 const notASingleCompany = m.entity_type === 'COOPERATIVE' || m.entity_type === 'NETWORK' || m.entity_type === 'PUBLIC_BODY';
 if (m.entity_type === 'COOPERATIVE' || m.entity_type === 'NETWORK') { points -= 2; reasons.push('cooperative_or_network'); }
 if (m.entity_type === 'PUBLIC_BODY') { points -= 2; reasons.push('public_body'); }
 // HIGH needs the organization's own site AND at least two specific activity terms observed: an identified
 // company whose activity matches the brief. A name read on someone else's page is at most MEDIUM.
 const level: ReviewPriorityLevel = !notASingleCompany && ownSite && terms.length >= 2 && points >= 5 ? 'HIGH' : points >= 2 ? 'MEDIUM' : 'LOW';
 return {level, reasons};
}

const RANK: Record<ReviewPriorityLevel, number> = {HIGH: 0, MEDIUM: 1, LOW: 2};
// Stable: equal priorities keep their current order (novelty first, then the provider's order).
export function byReviewPriority<T>(rows: T[], priority: (row: T) => ReviewPriority): T[] {
 return rows.map((row, i) => ({row, i, rank: RANK[priority(row).level]})).sort((a, b) => a.rank - b.rank || a.i - b.i).map(x => x.row);
}
