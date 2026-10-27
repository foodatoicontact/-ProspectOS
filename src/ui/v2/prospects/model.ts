// Prospects 2.0 (UI-5A, docs/UI_V2.md) — presentation model only. It reads what app/page.tsx already computes for the
// legacy list and record (the visible prospects, scoreProspect, estimateFit, the ObservationsReview summary) and only
// re-says it in the v2 hierarchy: company → situation → signal / context → evidence → human action → details on demand.
// Nothing here scores, filters, saves or decides: no business rule changes.
//
// Three honesty rules carried by every label below:
//  - VERIFIED = a proof (a source a person checked);
//  - USER_DECLARED = what the person said, without a source: "Déclaré par vous", never "Vérifié", never green;
//  - INFERRED / NOT_VERIFIED = to check.
// A /100 never leads: the list says how the FIT is known (Vérifié / Estimé / À documenter), the numbers live in
// "Détails avancés" of the record.
import {estimateFit,type EstimateLine,type FitEstimate} from '../../../domain/fit-estimate.ts';
import {fitDisplay,type FitDisplay} from '../../../domain/score-display.ts';
import {safeLink,type Criterion,type Evidence,type Prospect,type scoreProspect} from '../../../domain/core.ts';
import {hasVerifiedCopy,reviewSummaryReady,unreviewedContrary} from '../../../components/evidence-verification.ts';
import type {ReviewSummary} from '../../../components/evidence-presentation.ts';
import {statusLabel,evidenceStatusLabel,declaredValueLabel} from '../../../i18n/labels.ts';
import type {Locale} from '../../../i18n/locale.ts';

export type FitKind='verified'|'estimated'|'document';
export type FitBadge={kind:FitKind;label:string;hint:string|null};
export type ProspectRow={id:string;name:string;initial:string;place:string|null;status:string;statusLabel:string;fit:FitBadge};

const FIT_LABEL:Record<Locale,Record<FitKind,string>>={
 fr:{verified:'Vérifié',estimated:'Estimé',document:'À documenter'},
 en:{verified:'Verified',estimated:'Estimated',document:'To document'},
};
function plural(n:number,locale:Locale,fr:[string,string],en:[string,string]):string{
 const [one,many]=locale==='fr'?fr:en;return `${n} ${n===1?one:many}`;
}
// How the FIT is known, from the same display rule as the legacy badge (fitDisplay): nothing documented → "À documenter";
// sources still to check → "Estimé"; every counted source checked → "Vérifié". fitDisplay does not count a declaration
// (it has no source to check): when the person's own declarations are what make the estimate, the FIT is "Estimé —
// déclaré par vous", as Today says it (UI-4) — never "Vérifié". The hint says what is left in words, never as a score.
export function fitBadge(f:FitDisplay,e:FitEstimate,locale:Locale):FitBadge{
 const declared=e.estimated.breakdown.some(l=>l.declared===true&&l.points>0);
 const kind:FitKind=f.kind==='none'?(declared?'estimated':'document'):f.kind;
 const parts=[f.kind==='estimated'&&f.toVerify>0?plural(f.toVerify,locale,['source à vérifier','sources à vérifier'],['source to check','sources to check']):'',
  declared&&f.kind!=='verified'?(locale==='fr'?'déclaré par vous':'declared by you'):''].filter(Boolean);
 const hint=kind==='document'?(locale==='fr'?'Aucune information documentée':'Nothing documented yet'):parts.length?parts.join(' · '):null;
 return {kind,label:FIT_LABEL[locale][kind],hint};
}
const initialOf=(name:string)=>(name.trim()[0]??'?').toUpperCase();

// One row per prospect the legacy list shows (same `visible` array: same search, same status filter, same order).
export function prospectRows(visible:readonly Prospect[],criteria:Criterion[],locale:Locale,now:Date):ProspectRow[]{
 return visible.map(p=>({id:p.id,name:p.name,initial:initialOf(p.name),place:p.city?.trim()||null,status:p.status,statusLabel:statusLabel(p.status,locale),
  fit:(e=>fitBadge(fitDisplay(e),e,locale))(estimateFit(criteria,p.evidence,now))}));
}

// ── The record ─────────────────────────────────────────────────────────────────────────────────────────────────────
// How one ICP criterion is known. `verified`, `verified_false` and `contradicted` come from verified evidence only
// (scoreProspect); `declared` / `declared_false` from the person's own declarations; `to_verify` from sources found but
// not checked yet; `unknown` = nothing documented.
export type CriterionState='verified'|'verified_false'|'contradicted'|'declared'|'declared_false'|'to_verify'|'unknown';
export type EvidenceBasis='verified'|'declared'|'to_verify';
export type EvidenceItem={id:string;basis:EvidenceBasis;text:string;note:string|null;href:string|null;date:string;statusLabel:string;verifiable:boolean;evidence:Evidence};
export type CriterionView={key:string;label:string;weight:number;state:CriterionState;stateLabel:string;
 // The observations block of this criterion (ObservationsReview), when there is one: "Revoir les preuves" scrolls to it.
 reviewAnchor:string|null;pending:number;items:EvidenceItem[];
 // A proof pointing the other way that nobody reviewed yet, while the criterion already reads as settled: said on the
 // line (display only — the score counts verified proofs and is unchanged). Null when there is none.
 contraryLabel:string|null};
const CONTRARY_LABEL:Record<Locale,string>={fr:'Preuve contraire à relire',en:'Contrary evidence to review'};

const STATE_LABEL:Record<Locale,Record<CriterionState,string>>={
 fr:{verified:'Vérifié',verified_false:'Vérifié non rempli',contradicted:'Contradiction à revoir',declared:'Déclaré par vous',declared_false:'Déclaré non rempli par vous',
  to_verify:'À vérifier',unknown:'Non documenté'},
 en:{verified:'Verified',verified_false:'Verified not met',contradicted:'Contradiction to review',declared:'Declared by you',declared_false:'Declared not met by you',
  to_verify:'To check',unknown:'Not documented'},
};
export function criterionStateLabel(s:CriterionState,locale:Locale):string{return STATE_LABEL[locale][s]}

type Breakdown=ReturnType<typeof scoreProspect>['breakdown'][number];
function stateOf(b:Breakdown,line:EstimateLine|undefined,pending:boolean):CriterionState{
 if(b.state==='TRUE')return 'verified';
 if(b.state==='FALSE')return 'verified_false';
 if(b.state==='CONFLICT')return 'contradicted';
 if(line?.declared===true)return 'declared';
 if(line?.declared===false)return 'declared_false';
 if(pending||line?.state==='ESTIMATED'||line?.state==='TO_REVIEW'||line?.state==='FALSE')return 'to_verify';
 return 'unknown';
}
function itemOf(e:Evidence,locale:Locale,all:Evidence[]):EvidenceItem{
 const note=(e as Evidence&{note?:string|null}).note??null;
 const basis:EvidenceBasis=e.status==='VERIFIED'?'verified':e.status==='USER_DECLARED'?'declared':'to_verify';
 return {id:e.id,basis,text:basis==='declared'?declaredValueLabel(e.value,locale):e.excerpt,note:basis==='declared'&&note?note:null,
  href:basis==='declared'?null:safeLink(e.source_url),date:e.observed_at.slice(0,10),statusLabel:evidenceStatusLabel(e.status,e.verified_by,locale),
  // Same rule as the legacy button: a source not verified yet, and not already verified elsewhere. A declaration has no source.
  verifiable:basis==='to_verify'&&!hasVerifiedCopy(e,all),evidence:e};
}
// One entry per ICP criterion, in the ICP order, with the same evidence the legacy "Pourquoi ce prospect ?" lists under
// it: once ObservationsReview has loaded, the rows it already shows (linked, or context not verified) are not repeated.
export function criteriaView(breakdown:Breakdown[],estimate:FitEstimate,summary:ReviewSummary,prospect:Prospect,locale:Locale):CriterionView[]{
 const ready=reviewSummaryReady(summary,prospect.id);
 return breakdown.map(b=>{
  const g=summary.criteria[b.key];
  const manual=ready?prospect.evidence.filter(e=>e.criterion===b.key&&!summary.linkedEvidenceIds.includes(e.id)&&(e.status==='VERIFIED'||!summary.contextEvidenceIds.includes(e.id))&&!hasVerifiedCopy(e,prospect.evidence)):[];
  const pending=b.state!=='TRUE'&&!!g&&g.pending>0;
  const state=stateOf(b,estimate.estimated.breakdown.find(l=>l.key===b.key),pending);
  return {key:b.key,label:b.label,weight:b.weight,state,stateLabel:STATE_LABEL[locale][state],reviewAnchor:g?.anchorId??null,pending:g?.pending??0,
   items:manual.map(e=>itemOf(e,locale,prospect.evidence)),contraryLabel:unreviewedContrary(b.state,b.key,prospect.evidence).length?CONTRARY_LABEL[locale]:null};
 });
}

// The situation in one sentence: how many criteria are verified, declared by the person, still to check or undocumented.
export function situationOf(view:CriterionView[],locale:Locale):string{
 const n=(s:CriterionState[])=>view.filter(v=>s.includes(v.state)).length;
 const verified=n(['verified','verified_false']),declared=n(['declared','declared_false']),check=n(['to_verify','contradicted']),unknown=n(['unknown']);
 const total=view.length;
 const parts=locale==='fr'
  ?[`${verified} critère${verified>1?'s':''} sur ${total} vérifié${verified>1?'s':''}`,declared?`${declared} déclaré${declared>1?'s':''} par vous`:'',check?`${check} à vérifier`:'',unknown?`${unknown} à documenter`:'']
  :[`${verified} of ${total} criteria verified`,declared?`${declared} declared by you`:'',check?`${check} to check`:'',unknown?`${unknown} to document`:''];
 return parts.filter(Boolean).join(' · ')+'.';
}

// Level 3 (on demand): the numbers the legacy record shows in its hero, for audit only.
// `intent`: the INTENT score SignalsPanel computes (legacy pill), moved here — no score sits in the context section.
export function advancedOf(scored:{score:number;coverage:number},fit:FitDisplay,locale:Locale,intent:{score:number;estimated:{score:number}}|null=null):{label:string;value:string}[]{
 const fr=locale==='fr';
 return [
  ...(intent?[{label:fr?'INTENT (signaux vérifiés)':'INTENT (verified signals)',value:`${intent.score}/100`},
   {label:fr?'INTENT estimé':'Estimated INTENT',value:intent.estimated.score>intent.score?`${intent.estimated.score}/100`:'—'}]:[]),
  {label:fr?'FIT vérifié':'Verified FIT',value:fit.verified===null?(fr?'non établi':'not established'):`${fit.verified}/100`},
  {label:fr?'FIT estimé':'Estimated FIT',value:fit.kind==='estimated'?`${fit.main}/100`:'—'},
  {label:fr?'Sources à vérifier':'Sources to check',value:fit.toVerify?`${fit.toVerify} (${fit.toVerifyPoints} pt)`:'0'},
  {label:fr?'Couverture des preuves':'Evidence coverage',value:`${scored.coverage}%`},
  {label:fr?'Score vérifié (scoreProspect)':'Verified score (scoreProspect)',value:`${scored.score}/100`},
 ];
}

// "Tous les statuts" is the working list: an ignored prospect leaves it (it stays in the project's memory, so Discovery
// never brings it back as new, and its history is kept). Choosing the "Ignoré" status shows them. Display only: the
// same `visible` array, never a write, never a status change.
export const IGNORED_STATUS='Ignoré';
export function workingList<T extends {status:string}>(visible:readonly T[],filter:string):{shown:T[];hiddenIgnored:number}{
 if(filter!=='Tous')return {shown:[...visible],hiddenIgnored:0};
 const shown=visible.filter(p=>p.status!==IGNORED_STATUS);
 return {shown,hiddenIgnored:visible.length-shown.length};
}
