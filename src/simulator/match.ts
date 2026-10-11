// Public simulator V1 — which demonstration scenario best fits what the visitor typed. Deterministic and explainable,
// no model: words are normalized (lower case, no accents), a dictionary term matches a word that starts with its stem,
// each target term found counts 2, each offer term found counts 1. The best scenario wins if it reaches the minimum
// score; ties keep the fixed scenario order; otherwise the generic example, flagged as a fallback. The result only
// carries dictionary labels — never the visitor's own words.
import {SCENARIOS} from './scenarios/index.ts';
import type {Keyword,ScenarioId} from './types.ts';

export const SIM_MATCH_MIN_SCORE=2;
export const SIM_INPUT_LIMITS={offer:500,target:200} as const;
export type SimMatch={scenario_id:ScenarioId;fallback:boolean;matched:string[];score:number};

export function normalizeWords(text:string):string[]{
 return text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
const hits=(words:string[],keywords:Keyword[])=>keywords.filter(k=>words.some(w=>w.startsWith(k.stem)));

export function matchScenario(offer:string,target:string):SimMatch{
 const offerWords=normalizeWords(String(offer??'').slice(0,SIM_INPUT_LIMITS.offer));
 const targetWords=normalizeWords(String(target??'').slice(0,SIM_INPUT_LIMITS.target));
 let best:SimMatch|null=null;
 for(const s of SCENARIOS){
  if(!s.match.target.length&&!s.match.offer.length)continue;
  const t=hits(targetWords,s.match.target),o=hits(offerWords,s.match.offer);
  const score=t.length*2+o.length;
  if(!best||score>best.score)best={scenario_id:s.id,fallback:false,matched:[...new Set([...t,...o].map(k=>k.label))],score};
 }
 if(!best||best.score<SIM_MATCH_MIN_SCORE)return {scenario_id:'generique',fallback:true,matched:[],score:best?.score??0};
 return best;
}
