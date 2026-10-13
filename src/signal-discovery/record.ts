// Signal-first Discovery V1 — the ONE mapping from a P1 candidate (rank.ts, SignalDiscoveryCandidate) to the row
// public.save_signal_discovery_candidates stores (migration 030). Field for field, nothing computed again, nothing
// added: the database refuses any other key (strict list in 030), and tests pin both sides
// (tests/signal-discovery-service.test.ts, tests/signal-discovery-db.mjs).
import {contentHash} from '../signals/service.ts';
import type {SignalDiscoveryCandidate} from './rank.ts';

export const CANDIDATE_ROW_FIELDS=['entity_name','entity_name_status','entity_method','entity_confidence','entity_domain','entity_domain_status','entity_domain_method',
 'signal_type','trigger_text','headline','excerpt','excerpt_truncated','excerpt_origin','content_hash','source_url','source_domain','source_type','source_page_kind',
 'hosting_platform','observed_on_page','published_at','event_date_text','event_year','event_month','event_day','event_month_from','event_month_to','event_granularity',
 'event_tense','location_text','location_departments','location_regions','location_basis','icp_match','icp_reasons','event_key','other_sources','review_tier','raw_metadata'] as const;
export type CandidateRow=Record<typeof CANDIDATE_ROW_FIELDS[number],unknown>;

export function toCandidateRow(c:SignalDiscoveryCandidate):CandidateRow{
 const d=c.event_date;
 return {
  entity_name:c.entity_name,entity_name_status:c.entity_name_status,entity_method:c.entity_name_method,entity_confidence:c.entity_confidence,
  entity_domain:c.entity_domain,entity_domain_status:c.entity_domain_status,entity_domain_method:c.entity_domain_method,
  signal_type:c.signal_type,trigger_text:c.trigger,headline:c.headline,excerpt:c.excerpt,excerpt_truncated:c.excerpt_truncated,excerpt_origin:c.excerpt_origin,
  // Same hash as the Signal Engine's own (src/signals/service.ts): the signal created on "add" deduplicates like any other.
  content_hash:contentHash(c.excerpt),source_url:c.source_url,source_domain:c.source_domain,source_type:c.source_type,source_page_kind:c.source_page_kind,
  hosting_platform:c.hosting_platform,observed_on_page:c.observed_on_page,published_at:c.published_at,
  event_date_text:d?.text??null,event_year:d?.year??null,event_month:d?.month??null,event_day:d?.day??null,
  event_month_from:d?.months?.[0]??null,event_month_to:d?.months?.[1]??null,event_granularity:d?.granularity??null,event_tense:c.event_tense,
  location_text:c.location?.text??null,location_departments:c.location?.departments??[],location_regions:c.location?.regions??[],location_basis:c.location?.basis??null,
  icp_match:c.icp_match,icp_reasons:c.icp_reasons,event_key:c.event_key,
  // Other sources: where the same event was also found — URL, domain, publication and the search result's text.
  other_sources:c.other_sources.slice(0,20),review_tier:c.review_tier,
  raw_metadata:{entity_reasons:c.reasons.slice(0,10),review_label:c.review_label},
 };
}
