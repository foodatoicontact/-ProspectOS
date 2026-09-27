// "Synthèse" at the top of a prospect: purely derived from what the page already computes — the existing
// score breakdown (human-verified evidence only) and the review groups (proposals waiting for a human).
// No new qualification, no new score: a criterion is verified only when scoreProspect says so.
import type {Criterion,Evidence} from '../domain/core';
import type {ReviewSummary} from './evidence-presentation';
type Breakdown={key:string;label:string;state:string};
export type ProspectSynthesis={total:number;withSignal:number;verified:number;toConfirm:string[];contradicted:string[];missing:string[]};
export function summarizeProspect(criteria:Criterion[],breakdown:Breakdown[],review:ReviewSummary,evidence:Evidence[]):ProspectSynthesis{
 const s:ProspectSynthesis={total:criteria.length,withSignal:0,verified:0,toConfirm:[],contradicted:[],missing:[]};
 for(const b of breakdown){
  const g=review.criteria[b.key];
  const manual=evidence.filter(e=>e.criterion===b.key&&!review.contextEvidenceIds.includes(e.id));
  if(b.state==='TRUE'){s.verified++;s.withSignal++;continue}
  if(b.state==='CONFLICT'||(g&&g.tone==='contradicted'&&!g.pending)){s.withSignal++;s.contradicted.push(b.label);continue}
  if((g&&g.pending>0)||manual.some(e=>e.status!=='CONTRADICTED')){s.withSignal++;s.toConfirm.push(b.label);continue}
  s.missing.push(b.label);
 }
 return s;
}
