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

// The observation's source, when it came from an analysis (prospect_observations.source_type); null when typed by hand.
export type EstimateEvidence=Evidence&{source_type?:string|null};
export type EstimateState='VERIFIED'|'ESTIMATED'|'TO_REVIEW'|'FALSE'|'UNKNOWN';
export type EstimateLine={key:string;label:string;weight:number;state:EstimateState;confidence:number;points:number;evidence_ids:string[]};
export type FitEstimate={
 verified:ReturnType<typeof scoreProspect>;
 estimated:{score:number;breakdown:EstimateLine[]};
 to_verify:{count:number;points:number};
};

const SOURCE_CONFIDENCE:Record<string,number>={official_website:0.9,public_directory:0.8,search_result:0.6,test_fixture:0.5};
const MANUAL_CONFIDENCE=0.7,INFERENCE_CONFIDENCE=0.3;
const MAX_AGE_MS=90*86400000;

export function evidenceConfidence(e:EstimateEvidence):number{
 if(e.status==='VERIFIED'&&e.verified_by)return 1;
 if(e.status==='INFERRED_UNCONFIRMED')return INFERENCE_CONFIDENCE;
 return e.source_type?SOURCE_CONFIDENCE[e.source_type]??MANUAL_CONFIDENCE:MANUAL_CONFIDENCE;
}
function usable(e:EstimateEvidence,now:Date):boolean{
 const age=now.getTime()-new Date(e.observed_at).getTime();
 return !!safeLink(e.source_url)&&!!e.excerpt?.trim()&&Number.isFinite(age)&&age>=0&&age<=MAX_AGE_MS;
}

export function estimateFit(criteria:Criterion[],evidence:EstimateEvidence[],now:Date):FitEstimate{
 const verified=scoreProspect(criteria,evidence,now);
 const toVerify=new Set<string>();
 const breakdown=criteria.map((c):EstimateLine=>{
  const v=verified.breakdown.find(b=>b.key===c.key)!;
  const base={key:c.key,label:c.label,weight:c.weight};
  if(v.state==='TRUE')return {...base,state:'VERIFIED',confidence:1,points:c.weight,evidence_ids:v.evidence_ids};
  if(v.state==='FALSE')return {...base,state:'FALSE',confidence:1,points:0,evidence_ids:v.evidence_ids};
  if(v.state==='CONFLICT')return {...base,state:'TO_REVIEW',confidence:0,points:0,evidence_ids:v.evidence_ids};
  const rows=evidence.filter(e=>e.criterion===c.key&&(e.status==='NOT_VERIFIED'||e.status==='INFERRED_UNCONFIRMED')&&usable(e,now));
  if(!rows.length)return {...base,state:'UNKNOWN',confidence:0,points:0,evidence_ids:[]};
  const ids=[...new Set(rows.map(e=>e.id))];
  const values=new Set(rows.map(e=>e.value));
  if(values.size>1){ids.forEach(i=>toVerify.add(i));return {...base,state:'TO_REVIEW',confidence:0,points:0,evidence_ids:ids}}
  if(!values.has(true))return {...base,state:'FALSE',confidence:0,points:0,evidence_ids:ids};
  const confidence=Math.max(...rows.map(evidenceConfidence));
  ids.forEach(i=>toVerify.add(i));
  return {...base,state:'ESTIMATED',confidence,points:Math.round(c.weight*confidence),evidence_ids:ids};
 });
 const score=Math.min(100,breakdown.reduce((t,b)=>t+b.points,0));
 return {verified,estimated:{score,breakdown},to_verify:{count:toVerify.size,points:Math.max(0,score-verified.score)}};
}
