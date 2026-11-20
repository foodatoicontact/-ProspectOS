// ICP import — the deterministic projection of a validated IcpProfile into the existing model (docs/ICP_IMPORT.md).
// Pure and idempotent: the same profile and the same current state always give the same result. It writes only what the
// scoring engine already reads, and never more than the person accepted:
//  - the offer text (projects.offer) — unless the person keeps the current one;
//  - the rules of the existing target_fit criterion (categories = segment labels, locations = cities and departments).
// Weights are never changed: the criteria keep the keys and weights they had (DEFAULT_CRITERIA when the project has none),
// so their sum stays 100. A rule edited by hand since the last projection (or written by hand before any) is kept, never
// overwritten — field by field. need_fit and signals stay as they are until the mapping table of step 4.
import type {Criterion} from '../core.ts';
import {DEFAULT_CRITERIA,validateCriteria} from '../core.ts';
import {DEPARTMENTS} from '../../discovery/geo-fr.ts';
import type {IcpProfile} from './schema.ts';

export const PROJECTED_OFFER_MAX=4000;
const RULE_MIN=2,RULE_MAX=80,RULE_LIST_MAX=20;
type TargetConfig={categories?:string[];locations?:string[];org_types?:string[];match:'all_defined'|'any_defined'};

const clean=(v:string)=>v.replace(/\s+/g,' ').trim();
function ruleList(values:(string|null|undefined)[]):string[]|undefined{
 const out:string[]=[];
 for(const v of values){if(!v)continue;const c=clean(v).slice(0,RULE_MAX);if(c.length>=RULE_MIN&&!out.some(o=>o.toLowerCase()===c.toLowerCase()))out.push(c);if(out.length>=RULE_LIST_MAX)break}
 return out.length?out:undefined;
}
const departmentName=(code:string)=>DEPARTMENTS.find(d=>d.code===code)?.name;

export function projectOffer(p:IcpProfile):string{
 const v=<T>(xs:{value:T|null}[])=>xs.map(x=>x.value).filter((x):x is T=>x!==null);
 const parts=[
  p.company.name.value&&p.company.activity.value?`${p.company.name.value} : ${p.company.activity.value}.`:p.company.activity.value?`${p.company.activity.value}.`:p.company.name.value??'',
  v(p.offer.services).length?`Services : ${v(p.offer.services).join(', ')}.`:'',
  v(p.offer.promises).length?`Engagements : ${v(p.offer.promises).map(x=>x.text).join(', ')}.`:'',
  v(p.offer.differentiators).length?`Différences : ${v(p.offer.differentiators).join(' ; ')}.`:'',
  v(p.offer.proofs).length?`Preuves : ${v(p.offer.proofs).join(' ; ')}.`:'',
 ].filter(Boolean);
 return parts.join('\n').slice(0,PROJECTED_OFFER_MAX);
}

export function projectTargetFit(p:IcpProfile):TargetConfig|null{
 const categories=ruleList(p.segments.map(s=>s.label.value));
 const departments=[...p.company.interventionZones.map(z=>z.value),...p.company.sites.map(s=>s.value?.department??null)].filter((c):c is string=>!!c);
 const locations=ruleList([...p.company.sites.map(s=>s.value?.city),...departments.map(departmentName)]);
 if(!categories&&!locations)return null;
 return {...(categories?{categories}:{}),...(locations?{locations}:{}),match:'any_defined'};
}

// Key order does not matter (the database stores jsonb with its own key order).
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])])):v;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));
export type CriteriaProjection={criteria:Criterion[];changed:string[];kept:string[]};
// current: the project's criteria now; previous: what the last projection wrote (icps.projected_criteria), or null.
export function projectCriteria(p:IcpProfile,current:readonly Criterion[]|null|undefined,previous:readonly Criterion[]|null|undefined):CriteriaProjection{
 const base:Criterion[]=(current?.length?current:DEFAULT_CRITERIA).map(c=>({...c}));
 const changed:string[]=[],kept:string[]=[];
 const target=projectTargetFit(p);
 const i=base.findIndex(c=>c.key==='target_fit');
 if(i>=0&&target){
  const now=base[i]!;const before=previous?.find(c=>c.key==='target_fit');
  const handEdited=now.rules!==undefined&&!same(now.rules,before?.rules);
  const next={type:'target_fit' as const,config:target};
  if(handEdited)kept.push('target_fit');
  else if(!same(now.rules,next)){base[i]={...now,rules:next};changed.push('target_fit')}
 }
 validateCriteria(base); // keys, labels and weights unchanged: still unique and summing to 100
 return {criteria:base,changed,kept};
}
