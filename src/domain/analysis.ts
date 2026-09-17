import {safeLink,type Criterion,type Evidence} from './core.ts';
const RESTAURANT_PATTERNS:[string,RegExp][]=[['food',/restaurant|pizzeria|boulangerie|snack/i],['region',/Toulouse|Occitanie|Lombez/i],['phone_orders',/command.{0,50}téléphone/i],['platforms',/Uber\s*Eats|Deliveroo/i],['social_orders',/command.{0,50}(WhatsApp|Instagram|Snapchat)/i]];
const STOPWORDS=new Set(['dans','pour','avec','sans','plus','votre','vos','vous','notre','nos','nous','cette','ces','sont','être','avoir','leur','leurs','qui','que','dont','tout','tous','toute','toutes']);
const significantWords=(label:string)=>label.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4&&!STOPWORDS.has(w));
// Conservative lexical extraction. Every output needs source review, including negation/context.
// A proposal's criterion must exist in the project's own ICP: restaurant patterns only fire for
// criteria the project already carries, and unknown-at-compile-time criteria are matched on their label.
export function proposeEvidence(text:string,source:string,criteria:Criterion[]):Evidence[]{
 if(!safeLink(source))throw Error('Source HTTP(S) requise');
 const allowed=new Set(criteria.map(c=>c.key));
 const sentences=text.slice(0,10000).split(/(?<=[.!?\n])\s+/).filter(Boolean);
 const restaurant=RESTAURANT_PATTERNS.filter(([criterion])=>allowed.has(criterion)).flatMap(([criterion,pattern])=>{const excerpt=sentences.find(s=>pattern.test(s));return excerpt?[{criterion,excerpt}]:[]});
 const covered=new Set(restaurant.map(r=>r.criterion));
 const generic=criteria.filter(c=>!covered.has(c.key)).flatMap(c=>{const words=significantWords(c.label);if(!words.length)return [];const excerpt=sentences.find(s=>{const n=' '+s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()+' ';return words.some(w=>n.includes(' '+w))});return excerpt?[{criterion:c.key,excerpt}]:[]});
 return [...restaurant,...generic].map(({criterion,excerpt})=>({id:crypto.randomUUID(),criterion,value:true,status:'NOT_VERIFIED',source_url:source,excerpt:excerpt.slice(0,1500),observed_at:new Date().toISOString(),verified_by:null}));
}
