import type {Criterion,TargetFitRules} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
import {findLiteralMatch} from './text-match.ts';
// Closed, explainable key vocabulary — mirrors contact-channel.ts / commercial-signal.ts. Recognizing
// the *concept* by key is deliberately not enough on its own: the criterion must ALSO carry a valid,
// user-authored `rules.type==='target_fit'`. An ICP using one of these keys without ever configuring
// rules behaves exactly as it always has (no deterministic rule at all) — which is what keeps every
// existing ICP (Foodatoi, Test SaaS, or any other without rules) strictly unchanged.
export const TARGET_FIT_KEYS=['target_fit','icp_target_fit','target_match'] as const;
export function findTargetFitCriterion(criteria:Criterion[]):Criterion|null{
 const keys=new Set<string>(TARGET_FIT_KEYS);
 return criteria.find(c=>keys.has(c.key)&&c.rules?.type==='target_fit')??null;
}
type Dimension='categories'|'locations'|'org_types';
export const TARGET_FIT_DIMENSION_LABELS:Record<Dimension,string>={categories:'catégorie',locations:'localisation',org_types:'type d’organisation'};
export type TargetFitMatch={dimension:Dimension; matchedValue:string; line:string};
export type TargetFitEvaluation={satisfied:boolean; matches:TargetFitMatch[]};
function isStringArray(value:unknown):value is string[]{return Array.isArray(value)&&value.every(v=>typeof v==='string')}
// icps.criteria is a schema-less jsonb column, writable outside this application's own Zod validation
// (e.g. directly via PostgREST) — so a criterion's declared `TargetFitRules` TypeScript type is never
// trusted at runtime. Anything short of this exact shape is "no exploitable rule": never repaired,
// never partially interpreted from whichever fields happen to look right. In particular, an invalid
// `match` never silently falls back to any_defined — it fails the whole rule closed, same as any
// other malformation.
function isValidTargetFitConfig(config:unknown):config is TargetFitRules{
 if(typeof config!=='object'||config===null)return false;
 const c=config as Record<string,unknown>;
 if(c.match!=='all_defined'&&c.match!=='any_defined')return false;
 for(const key of ['categories','locations','org_types'] as const){
  if(key in c&&c[key]!==undefined&&!isStringArray(c[key]))return false;
 }
 return true;
}
// The user's own values are the ONLY vocabulary ever consulted here — never the criterion's label,
// never a hardcoded per-sector list, never a guess. A dimension only counts as "defined" when the
// user actually populated it (an absent or empty dimension is simply not part of the rule).
export function evaluateTargetFit(ctx:Pick<ObservationContext,'lines'>,rules:unknown):TargetFitEvaluation{
 if(!isValidTargetFitConfig(rules))return {satisfied:false,matches:[]};
 const dimensions:[Dimension,string[]|undefined][]=[['categories',rules.categories],['locations',rules.locations],['org_types',rules.org_types]];
 const defined=dimensions.filter((entry):entry is [Dimension,string[]]=>!!entry[1]&&entry[1].length>0);
 const matches:TargetFitMatch[]=[];
 for(const [dimension,values] of defined){
  for(const value of values){
   const found=findLiteralMatch(ctx.lines,value);
   if(found){matches.push({dimension,matchedValue:value,line:found.line});break}
  }
 }
 const matchedDimensions=new Set(matches.map(m=>m.dimension));
 const satisfied=defined.length>0&&(rules.match==='all_defined'?defined.every(([dimension])=>matchedDimensions.has(dimension)):matchedDimensions.size>0);
 return {satisfied,matches};
}
