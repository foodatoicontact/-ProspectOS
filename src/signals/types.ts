import {z} from 'zod';
// Signal Engine (docs/SIGNAL_ENGINE_V1_PLAN.md, migration 024). A signal is a dated, sourced public fact about a
// company that may make it relevant to contact NOW. It is never evidence and never feeds the FIT score; it counts for
// INTENT only once a person verified it. The closed lists below are the database's own checks (tests pin both).
export const SIGNAL_TYPES=['hiring_role','leadership_change','funding','acquisition','new_site','expansion','product_launch',
 'partnership','certification','tech_change','public_contract_won','headcount_growth','incident_cyber','event'] as const;
export type SignalType=typeof SIGNAL_TYPES[number];
export const SIGNAL_PROVIDERS=['web_search','official_site','bodacc','discovery_recycled','user_provided','test_fixture'] as const;
export const SIGNAL_SOURCE_TYPES=['official_website','news','job_board','legal_announcement','public_procurement','search_snippet','user_provided','test_fixture'] as const;
export type SignalSourceType=typeof SIGNAL_SOURCE_TYPES[number];
export type SignalStatus='PENDING_REVIEW'|'VERIFIED'|'REJECTED';

// Confidence by rule, never by a model: the kind of source, × 0.7 when the fact has no date of its own (only the day
// it was read). Same table as prospectos_private.signal_confidence (024); the database computes the stored value.
const SOURCE_CONFIDENCE:Record<SignalSourceType,number>={official_website:1,legal_announcement:1,public_procurement:1,news:0.8,job_board:0.8,user_provided:0.7,search_snippet:0.6,test_fixture:0.5};
export function signalConfidence(sourceType:SignalSourceType,eventDate:string|null,publishedAt:string|null):number{
 return Math.round(SOURCE_CONFIDENCE[sourceType]*(eventDate||publishedAt?1:0.7)*100)/100;
}

const publicUrl=z.string().max(2048).url().refine(v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}},'HTTP(S) requis');
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// What a provider (or the user) hands to save_signals. No status, no confidence: the database decides both.
export const SignalCandidateSchema=z.object({
 provider:z.enum(SIGNAL_PROVIDERS),
 signal_type:z.enum(SIGNAL_TYPES),
 title:z.string().trim().min(1).max(300),
 excerpt:z.string().trim().min(1).max(500),
 source_url:publicUrl,
 source_type:z.enum(SIGNAL_SOURCE_TYPES),
 event_date:isoDate.nullable().optional(),
 published_at:z.string().datetime({offset:true}).nullable().optional(),
 observed_at:z.string().datetime({offset:true}),
 matched_terms:z.array(z.string().min(1).max(80)).max(20).default([]),
 content_hash:z.string().regex(/^[0-9a-f]{64}$/),
 event_key:z.string().min(1).max(200),
 raw_metadata:z.record(z.string(),z.unknown()).default({}),
}).strict();
export type SignalCandidate=z.infer<typeof SignalCandidateSchema>;

// The project's explicit choices (save_intent_profile): weights per signal type (0–50) and the relevance words.
export const IntentProfileSchema=z.object({
 types:z.partialRecord(z.enum(SIGNAL_TYPES),z.number().int().min(0).max(50)),
 terms:z.array(z.string().trim().min(2).max(80)).max(30).default([]),
}).strict();
export type IntentProfile=z.infer<typeof IntentProfileSchema>;
