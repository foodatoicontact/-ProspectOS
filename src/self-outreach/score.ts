// Self-Outreach scoring — explainable, reusing the Next Best Action engine (src/nba/engine.ts): FIT (verified score of
// the FitProfile, the same number CONTACT reads), INTENT, TIMING and EVIDENCE QUALITY come from buildOpportunity, never
// from a model. OUTREACH = 0.35 FIT + 0.30 TIMING + 0.15 INTENT + 0.20 EVIDENCE QUALITY (0–100), each line explained.
// OUTREACH ≥ threshold (75 by default) means ONLY "eligible for a person's review" — never an authorization to send.
// Hard gates (eligible = false whatever the score): the signal is not VERIFIED by a person, the signal's place is
// outside the ICP's zone, or verified evidence shows a low FIT.
import type {Opportunity,ClassifiedSignal} from '../nba/engine.ts';
export const OUTREACH_CONFIG_VERSION='self-outreach-v1';
export const OUTREACH_WEIGHTS={fit:0.35,timing:0.30,intent:0.15,evidence_quality:0.20} as const;
export type OutreachScore={fit:number;intent:number;timing:number;evidence_quality:number;outreach:number;threshold:number;eligible:boolean;
 gates:string[];explanation:{lines:{component:string;value:number;weight:number;points:number;why:string}[];gates:string[];nba_action:string;nba_rule:string}};

export function outreachScore(o:Opportunity,signal:{id:string;status:string}|null,classified:Pick<ClassifiedSignal,'geo'>|null,threshold:number):OutreachScore{
 const p=o.scores.fit.profile;
 const fit=p.verified_score,intent=o.scores.intent.score,timing=o.scores.timing.score,evidence_quality=o.scores.evidence_quality.score;
 const parts:[keyof typeof OUTREACH_WEIGHTS,number,string][]=[
  ['fit',fit,p.verified_positive_weight>0?`Critères ICP vérifiés : ${p.supporting.join(', ')} (${p.verified_coverage} % de l’ICP vérifié).`:'Aucun critère ICP vérifié : le FIT vérifié vaut 0.'],
  ['timing',timing,o.scores.timing.lines.length?o.scores.timing.lines.map(l=>l.label).join(' ; '):'Aucun signal récent qui compte pour cet ICP.'],
  ['intent',intent,intent>0?'Intention mesurée par le moteur d’intention à partir des signaux vérifiés de ce compte.':'Aucune intention mesurée sur les signaux vérifiés de ce compte.'],
  ['evidence_quality',evidence_quality,'Confiance de la source du signal × revue humaine, et part de l’ICP couverte par des preuves vérifiées.'],
 ];
 const lines=parts.map(([component,value,why])=>({component,value,weight:OUTREACH_WEIGHTS[component],points:Math.round(value*OUTREACH_WEIGHTS[component]*10)/10,why}));
 const outreach=Math.max(0,Math.min(100,Math.round(lines.reduce((t,l)=>t+l.value*l.weight,0))));
 const gates:string[]=[];
 if(!signal||signal.status!=='VERIFIED')gates.push('SIGNAL_NOT_VERIFIED');
 if(classified?.geo.relevance==='MISMATCH')gates.push('SIGNAL_OUTSIDE_ICP_ZONE');
 if(p.state==='KNOWN_LOW')gates.push('KNOWN_LOW_FIT');
 return {fit,intent,timing,evidence_quality,outreach,threshold,eligible:!gates.length&&outreach>=threshold,gates,
  explanation:{lines,gates,nba_action:o.recommended_action,nba_rule:o.rule}};
}
// What the database stores (create_outreach_candidate p_scores). A gated candidate is stored below the threshold so it
// never enters the review queue.
export function scoresPayload(s:OutreachScore,signalType:string){
 return {fit:s.fit,intent:s.intent,timing:s.timing,evidence_quality:s.evidence_quality,outreach:s.eligible?s.outreach:Math.min(s.outreach,Math.max(0,s.threshold-1)),
  threshold:s.threshold,signal_type:signalType,config_version:OUTREACH_CONFIG_VERSION,explanation:{...s.explanation,raw_outreach:s.outreach}};
}
