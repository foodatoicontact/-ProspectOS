import type {Observation} from '../types.ts';
import type {Criterion} from '../../domain/core.ts';
import type {ObservationContext} from './restaurant.ts';
// Sector-agnostic extraction: works from the project's own ICP labels instead of any hardcoded vertical.
// A criterion never seen at compile time can still receive a proposal as long as it exists in the ICP passed in.
const STOPWORDS=new Set(['dans','pour','avec','sans','plus','votre','vos','vous','notre','nos','nous','cette','ces','sont','être','avoir','leur','leurs','qui','que','dont','tout','tous','toute','toutes','fait','faire','très','bien','aussi','donc','ainsi','comme','the','and','for','with','this','that','from','your','have']);
function significantWords(label:string):string[]{return label.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4&&!STOPWORDS.has(w))}
const PHONE_PATTERN=/(?:\+33\s*(?:\(0\)\s*)?|0)[1-9](?:[ .-]?\d{2}){4}/;
export function extractGenericObservations(ctx:ObservationContext,criteria:Criterion[],covered:Set<string>):Observation[]{
 const {lines,text,make}=ctx;const out:Observation[]=[];
 // Cross-sector raw contact signal — a phone number is not tied to any vertical.
 const phone=text.match(PHONE_PATTERN)?.[0];if(phone)out.push(make(null,'PHONE_RAW',phone,null,'OBSERVED','Numéro public présent ; usage commercial non déduit',.95));
 for(const criterion of criteria){
  if(covered.has(criterion.key))continue; // already handled by a specialized preset for this ICP
  const words=significantWords(criterion.label);if(!words.length)continue;
  const line=lines.find(l=>{const normalized=' '+l.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()+' ';return words.some(w=>normalized.includes(' '+w))});
  if(line){const matched=words.filter(w=>(' '+line.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()+' ').includes(' '+w)).length;const confidence=Math.min(.6,.3+.1*matched);
  out.push(make(criterion.key,'GENERIC_KEYWORD_MATCH',line,true,'OBSERVED',`Mention en lien avec « ${criterion.label} » repérée dans le texte`,confidence))}
 }
 return out;
}
