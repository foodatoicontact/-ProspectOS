import {z} from 'zod';
import type {CriterionRules} from '../domain/core.ts';
// zod still runs this refinement when .url() has already failed: new URL must never throw out of the
// schema (a TypeError instead of a validation failure) — an unparseable URL simply fails validation.
const publicUrl=z.string().max(2048).url().refine(v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}},'HTTP(S) requis');
// User-authored, explicit values only — trimmed, bounded, deduplicated. Never a hint for an LLM or a
// similarity model: every value here is later matched literally (see strategies/text-match.ts).
const RuleValue=z.string().trim().min(2).max(80);
const RuleList=z.array(RuleValue).min(1).max(20).transform(values=>[...new Set(values)]);
const MatchMode=z.enum(['all_defined','any_defined']);
const TargetFitRulesConfigSchema=z.object({categories:RuleList.optional(),locations:RuleList.optional(),org_types:RuleList.optional(),match:MatchMode}).strict()
 .refine(r=>!!(r.categories?.length||r.locations?.length||r.org_types?.length),{message:'Au moins une dimension (categories, locations, org_types) doit être définie et non vide.'});
const NeedFitRulesConfigSchema=z.object({signals:RuleList}).strict();
// A criterion's rules are a closed, discriminated set — never an open bag of arbitrary fields.
export const CriterionRulesSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('target_fit'),config:TargetFitRulesConfigSchema}).strict(),
 z.object({type:z.literal('need_fit'),config:NeedFitRulesConfigSchema}).strict(),
]);
// Compile-time only (erased at build time): keeps this schema's output in lockstep with the
// hand-written CriterionRules type in domain/core.ts. If either drifts, tsc fails right here.
type AssertExtends<T,_U extends T>=true;
type _CriterionRulesSchemaStaysInSync=AssertExtends<CriterionRules,z.infer<typeof CriterionRulesSchema>>;
// Generic contract: PROJECT -> OFFER -> ICP -> QUERY. offer/criteria are optional context carried
// alongside the search terms (persisted as-is in discovery_runs.filters_json) — never a hidden
// fallback: when omitted, the query stays exactly what the user typed, with no vertical injected.
// `rules` is explicitly recognized (never `.passthrough()`'d blindly) so a valid Criterion carrying a
// user-authored rule is accepted here exactly as it is when saving the ICP itself (see the `icps`
// route handler, which reuses this exact schema) — any other unknown field is still rejected.
export const CriterionContextSchema=z.object({key:z.string().min(1).max(60),label:z.string().min(1).max(120),weight:z.number(),rules:CriterionRulesSchema.optional()}).strict();
export const DiscoveryInputSchema=z.object({project_id:z.string().min(1).max(100),query:z.string().trim().min(2).max(250),location:z.string().trim().min(2).max(120),categories:z.array(z.string().trim().min(1).max(60)).max(12),max_results:z.number().int().min(1).max(100).default(20),optional_filters:z.object({provider:z.enum(['fixture','brave']).optional(),country:z.string().regex(/^[A-Z]{2}$/).optional(),offer:z.string().max(4000).optional(),criteria:z.array(CriterionContextSchema).max(30).optional()}).strict().default({})}).strict();
export type DiscoveryInput=z.infer<typeof DiscoveryInputSchema>;
export const CandidateSchema=z.object({name:z.string().min(1).max(200),canonical_url:publicUrl.nullable(),website:publicUrl.nullable(),city:z.string().max(120).nullable(),address:z.string().max(400).nullable(),phone:z.string().max(60).nullable(),discovered_source:z.string().max(80),source_url:publicUrl,source_title:z.string().max(300),discovery_timestamp:z.string().datetime(),confidence:z.number().min(0).max(1),raw_metadata:z.record(z.string(),z.unknown()),deduplication_key:z.string().max(1000)}).strict();
export type Candidate=z.infer<typeof CandidateSchema>;
// lastSearch: what the latest searchCompanies call actually did (billed requests sent, failures as codes,
// market) — set by a live provider, absent for the fixture provider.
export type ProviderSearchReport={queries_planned:number;requests_sent:number;requests_failed:number;failure_codes:string[];country:string;country_reason:string};
export interface DiscoveryProvider {id:string;mode:'live'|'test';lastSearch?:ProviderSearchReport;searchCompanies(input:DiscoveryInput):Promise<unknown[]>;fetchCompanyDetails(candidate:Candidate):Promise<Candidate>;normalizeResult(raw:unknown):Candidate}
// criterion is validated against the project's own ICP at proposal time (EvidenceProposalService,
// save_discovery_observations) — never against a fixed vertical's key list, so any ICP works here.
export const ObservationSchema=z.object({criterion:z.string().min(1).max(60).nullable(),observation_type:z.string().min(1).max(60),claim:z.string().max(1000),value:z.boolean().nullable(),status:z.enum(['OBSERVED','UNKNOWN','INFERRED','CONTRADICTED']),source_url:publicUrl,source_title:z.string().max(300),source_excerpt:z.string().max(500),source_type:z.enum(['official_website','search_result','public_directory','test_fixture']),confidence:z.number().min(0).max(1),collected_at:z.string().datetime(),expires_at:z.string().datetime(),content_hash:z.string().min(1).max(100)}).strict().superRefine((v,c)=>{if(v.status!=='UNKNOWN'&&!v.source_excerpt.trim())c.addIssue({code:'custom',message:'Extrait requis'});if(v.status==='UNKNOWN'&&v.value!==null)c.addIssue({code:'custom',message:'UNKNOWN doit avoir value=null'})});
export type Observation=z.infer<typeof ObservationSchema>;
export type StoredObservation=Observation&{id:string;prospect_id:string;organization_id:string;evidence_id:string|null;review_status:'NOT_VERIFIED'|'VERIFIED'|'CONTRADICTED'};
// source_class is the database column (migration 014) — present on persisted rows, NULL for rows written
// before classification existed; absent on demo rows built in the browser, which are never persisted.
export type DiscoveryResult={id:string;normalized_payload:Candidate;dedupe_status:'unique'|'duplicate_candidate'|'merge_review_required';duplicate_of:string|null;status:'pending'|'accepted'|'ignored';prospect_id:string|null;reason?:string;source_class?:'COMPANY_CANDIDATE'|'SIGNAL_SOURCE'|'IRRELEVANT'|'UNCERTAIN'|null};
export type DiscoveryRun={id:string;status:string;provider:string;result_count:number;error_message:string|null;results?:DiscoveryResult[]};
