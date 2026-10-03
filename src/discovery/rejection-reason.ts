// Why a result was set aside, in the most precise words the pipeline can justify. The stored reason_code is
// unchanged (admissibility.ts); a page that named no organization is told apart by its own page type: an editorial
// page or a job listing without an identifiable company says so, instead of a generic "entity not resolved".
export type RejectionReasonCode='TRAINING_COURSE_PAGE'|'DIRECTORY_PAGE'|'PUBLIC_DIRECTORY_PAGE'|'SOCIAL_PROFILE_PAGE'|'EXCLUDED_BY_QUERY'|'ENTITY_UNRESOLVED'|'NO_OBSERVABLE_RELEVANCE'|'LOCATION_MISMATCH'|'SECTOR_BODY_PAGE'|'EVENT_PAGE'|'EDITORIAL_NO_ENTITY'|'JOB_LISTING_NO_EMPLOYER'|'ENTITY_TYPE_MISMATCH'|'TYPE_MISMATCH_FEDERATION'|'TYPE_MISMATCH_ASSOCIATION'|'TYPE_MISMATCH_PUBLIC_BODY'|'TYPE_MISMATCH_MEDIA';
const KNOWN=new Set<string>(['TRAINING_COURSE_PAGE','DIRECTORY_PAGE','PUBLIC_DIRECTORY_PAGE','SOCIAL_PROFILE_PAGE','EXCLUDED_BY_QUERY','ENTITY_UNRESOLVED','NO_OBSERVABLE_RELEVANCE','LOCATION_MISMATCH','SECTOR_BODY_PAGE','EVENT_PAGE','ENTITY_TYPE_MISMATCH']);
// A real organization set aside only because its type is not the kind of actor the brief asks for says which type.
const MISMATCH_TYPES=new Set(['FEDERATION','ASSOCIATION','PUBLIC_BODY','MEDIA']);
export function rejectionReason(reasonCode:unknown,pageType:unknown,entityType?:unknown):RejectionReasonCode|null{
 if(typeof reasonCode!=='string'||!KNOWN.has(reasonCode))return null;
 if(reasonCode==='ENTITY_TYPE_MISMATCH')return typeof entityType==='string'&&MISMATCH_TYPES.has(entityType)?`TYPE_MISMATCH_${entityType}` as RejectionReasonCode:'ENTITY_TYPE_MISMATCH';
 if(reasonCode==='ENTITY_UNRESOLVED'&&(pageType==='NEWS_ARTICLE'||pageType==='BLOG_OR_CONTENT'))return 'EDITORIAL_NO_ENTITY';
 if(reasonCode==='ENTITY_UNRESOLVED'&&pageType==='THIRD_PARTY_JOB_BOARD')return 'JOB_LISTING_NO_EMPLOYER';
 return reasonCode as RejectionReasonCode;
}
