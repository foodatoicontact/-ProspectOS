import type {FitEstimate} from './fit-estimate.ts';
// "No verified evidence yet" is not "a bad prospect". scoreProspect (core.ts, unchanged) gives 0 in both cases; its
// coverage says which one it is: the weight of criteria that verified evidence settled (TRUE or FALSE). With no
// settled criterion the score is NOT established — shown as "Non scoré", never as 0/100. A real 0 (verified
// evidence that the criteria are false) stays 0/100. Display only: nothing is computed, raised or stored here.
export type ScoreState='SCORED'|'NOT_SCORED';
export const scoreState=(s:{coverage:number}):ScoreState=>s.coverage>0?'SCORED':'NOT_SCORED';

// FIT estimé (2026-10-06): what a score badge shows. The ESTIMATE (fit-estimate.ts) is shown as soon as sources were
// found, labelled "estimé" while some of them are still to verify; once every counted source is verified it is the
// verified score. Nothing found at all → "Non scoré", never a fake 0/100. Display only.
export type FitDisplay={kind:'none'|'estimated'|'verified';main:number|null;verified:number|null;toVerify:number;toVerifyPoints:number};
export function fitDisplay(f:FitEstimate):FitDisplay{
 const verified=f.verified.coverage>0?f.verified.score:null;
 if(f.to_verify.count===0)return verified===null?{kind:'none',main:null,verified:null,toVerify:0,toVerifyPoints:0}:{kind:'verified',main:verified,verified,toVerify:0,toVerifyPoints:0};
 return {kind:'estimated',main:f.estimated.score,verified,toVerify:f.to_verify.count,toVerifyPoints:f.to_verify.points};
}
