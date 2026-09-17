import {safeLink,type Criterion,type Evidence} from './core.ts';
// Deterministic, explicitly supported patterns only. Each still only fires for a criterion key
// the project's own ICP actually carries — never a hardcoded fallback for a project without it.
const RESTAURANT_PATTERNS:[string,RegExp][]=[['food',/restaurant|pizzeria|boulangerie|snack/i],['region',/Toulouse|Occitanie|Lombez/i],['phone_orders',/command.{0,50}téléphone/i],['platforms',/Uber\s*Eats|Deliveroo/i],['social_orders',/command.{0,50}(WhatsApp|Instagram|Snapchat)/i]];
// Conservative lexical extraction. Every output needs source review, including negation/context.
// A bare keyword overlap between an ICP label and the text is not a strong enough signal to
// assert a criterion is satisfied — only the deterministic patterns above ever produce an
// Evidence(value:true). Anything short of that produces no Evidence at all, never a guess.
export function proposeEvidence(text:string,source:string,criteria:Criterion[]):Evidence[]{
 if(!safeLink(source))throw Error('Source HTTP(S) requise');
 const allowed=new Set(criteria.map(c=>c.key));
 const sentences=text.slice(0,10000).split(/(?<=[.!?\n])\s+/).filter(Boolean);
 const restaurant=RESTAURANT_PATTERNS.filter(([criterion])=>allowed.has(criterion)).flatMap(([criterion,pattern])=>{const excerpt=sentences.find(s=>pattern.test(s));return excerpt?[{criterion,excerpt}]:[]});
 return restaurant.map(({criterion,excerpt})=>({id:crypto.randomUUID(),criterion,value:true,status:'NOT_VERIFIED',source_url:source,excerpt:excerpt.slice(0,1500),observed_at:new Date().toISOString(),verified_by:null}));
}
