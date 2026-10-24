import {scoreProspect,safeLink,type Criterion,type Evidence} from './core.ts';
// FIT estimé (product decision of 2026-10-06): the score is computed AUTOMATICALLY by crossing every observation found
// for a company, weighted by how far its source can be trusted, and shown "estimé" next to the VERIFIED score — the
// unchanged scoreProspect of core.ts, which counts only what a person confirmed. The person verifies the sources: each
// verification moves the estimate toward the verified score. Messages still quote verified evidence only.
//
// Per criterion: a person's decision wins (verified TRUE → full points, verified FALSE → 0, verified conflict → to
// review); otherwise the usable unverified observations (source URL, excerpt, ≤ 90 days, criterion of this ICP):
// all TRUE → weight × the best source's confidence; TRUE and FALSE → "to review", 0 (never an average); all FALSE → 0.
// A contradicted observation (rejected by a person) is ignored. Pure and deterministic: no model, `now` is a parameter.
//
// UI-4 — USER_DECLARED (a person states a criterion from what they know, WITHOUT a source; migration 033): read like an
// unverified observation, at the existing manual confidence (0.7), with no source required — it may move the ESTIMATE
// only. It never reaches `verified` (scoreProspect reads VERIFIED rows with a real source only), so it never raises the
// verified score or coverage, never makes CONTACT eligible and is never quoted. A declared FALSE is an unverified FALSE:
// 0 points, never a verified counter-proof (no OFF_TARGET). Same 90-day window as every other row.

// The observation's source, when it came from an analysis (prospect_observations.source_type); null when typed by hand.
export type EstimateEvidence=Evidence&{source_type?:string|null};
export type EstimateState='VERIFIED'|'ESTIMATED'|'TO_REVIEW'|'FALSE'|'UNKNOWN';
// declared: the person's own value when this criterion's unverified estimate rests on USER_DECLARED rows only (else null).
export type EstimateLine={key:string;label:string;weight:number;state:EstimateState;confidence:number;points:number;evidence_ids:string[];declared:boolean|null};
export type FitEstimate={
 verified:ReturnType<typeof scoreProspect>;
 estimated:{score:number;breakdown:EstimateLine[]};
 to_verify:{count:number;points:number};
 // UI-4: what the person's declarations contribute to THIS estimate, as content — `criterion=T|F`, sorted, deduplicated:
 // only USER_DECLARED rows of a criterion of this ICP, inside the 90-day window, that no verified fact already decides.
 // Never an id, never the note (the engine reads neither): the identity changes exactly when the estimate's input does.
 declarations:string[];
};

const SOURCE_CONFIDENCE:Record<string,number>={official_website:0.9,public_directory:0.8,search_result:0.6,test_fixture:0.5};
const MANUAL_CONFIDENCE=0.7,INFERENCE_CONFIDENCE=0.3;
const MAX_AGE_MS=90*86400000;

export function evidenceConfidence(e:EstimateEvidence):number{
 if(e.status==='VERIFIED'&&e.verified_by)return 1;
 if(e.status==='INFERRED_UNCONFIRMED')return INFERENCE_CONFIDENCE;
 if(e.status==='USER_DECLARED')return MANUAL_CONFIDENCE;
 return e.source_type?SOURCE_CONFIDENCE[e.source_type]??MANUAL_CONFIDENCE:MANUAL_CONFIDENCE;
}
const fresh=(e:EstimateEvidence,now:Date)=>{const age=now.getTime()-new Date(e.observed_at).getTime();return Number.isFinite(age)&&age>=0&&age<=MAX_AGE_MS};
function usable(e:EstimateEvidence,now:Date):boolean{
 if(e.status==='USER_DECLARED')return typeof e.value==='boolean'&&fresh(e,now);
 return !!safeLink(e.source_url)&&!!e.excerpt?.trim()&&fresh(e,now);
}

export function estimateFit(criteria:Criterion[],evidence:EstimateEvidence[],now:Date):FitEstimate{
 const verified=scoreProspect(criteria,evidence,now);
 const toVerify=new Set<string>();const declarations=new Set<string>();
 const breakdown=criteria.map((c):EstimateLine=>{
  const v=verified.breakdown.find(b=>b.key===c.key)!;
  const base={key:c.key,label:c.label,weight:c.weight,declared:null};
  if(v.state==='TRUE')return {...base,state:'VERIFIED',confidence:1,points:c.weight,evidence_ids:v.evidence_ids};
  if(v.state==='FALSE')return {...base,state:'FALSE',confidence:1,points:0,evidence_ids:v.evidence_ids};
  if(v.state==='CONFLICT')return {...base,state:'TO_REVIEW',confidence:0,points:0,evidence_ids:v.evidence_ids};
  const rows=evidence.filter(e=>e.criterion===c.key&&(e.status==='NOT_VERIFIED'||e.status==='INFERRED_UNCONFIRMED'||e.status==='USER_DECLARED')&&usable(e,now));
  if(!rows.length)return {...base,state:'UNKNOWN',confidence:0,points:0,evidence_ids:[]};
  for(const e of rows)if(e.status==='USER_DECLARED')declarations.add(`${c.key}=${e.value?'T':'F'}`);
  const ids=[...new Set(rows.map(e=>e.id))];
  const values=new Set(rows.map(e=>e.value));
  const declared=rows.every(e=>e.status==='USER_DECLARED')&&values.size===1?rows[0]!.value:null;
  // A declaration has no source to check: it is never counted among the sources "to verify".
  const checkable=[...new Set(rows.filter(e=>e.status!=='USER_DECLARED').map(e=>e.id))];
  if(values.size>1){checkable.forEach(i=>toVerify.add(i));return {...base,state:'TO_REVIEW',confidence:0,points:0,evidence_ids:ids}}
  if(!values.has(true))return {...base,state:'FALSE',confidence:0,points:0,evidence_ids:ids,declared};
  const confidence=Math.max(...rows.map(evidenceConfidence));
  checkable.forEach(i=>toVerify.add(i));
  return {...base,state:'ESTIMATED',confidence,points:Math.round(c.weight*confidence),evidence_ids:ids,declared};
 });
 const score=Math.min(100,breakdown.reduce((t,b)=>t+b.points,0));
 return {verified,estimated:{score,breakdown},to_verify:{count:toVerify.size,points:Math.max(0,score-verified.score)},declarations:[...declarations].sort()};
}
