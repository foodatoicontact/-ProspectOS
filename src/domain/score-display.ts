// "No verified evidence yet" is not "a bad prospect". scoreProspect (core.ts, unchanged) gives 0 in both cases; its
// coverage says which one it is: the weight of criteria that verified evidence settled (TRUE or FALSE). With no
// settled criterion the score is NOT established — shown as "Non scoré", never as 0/100. A real 0 (verified
// evidence that the criteria are false) stays 0/100. Display only: nothing is computed, raised or stored here.
export type ScoreState='SCORED'|'NOT_SCORED';
export const scoreState=(s:{coverage:number}):ScoreState=>s.coverage>0?'SCORED':'NOT_SCORED';
