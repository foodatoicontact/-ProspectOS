import {safeLink,type Evidence} from './core.ts';
// Conservative lexical extraction. Every output needs source review, including negation/context.
export function proposeEvidence(text:string,source:string):Evidence[]{
 if(!safeLink(source))throw Error('Source HTTP(S) requise');
 const patterns:[string,RegExp][]=[['food',/restaurant|pizzeria|boulangerie|snack/i],['region',/Toulouse|Occitanie|Lombez/i],['phone_orders',/command.{0,50}téléphone/i],['platforms',/Uber\s*Eats|Deliveroo/i],['social_orders',/command.{0,50}(WhatsApp|Instagram|Snapchat)/i]];
 const sentences=text.slice(0,10000).split(/(?<=[.!?\n])\s+/).filter(Boolean);
 return patterns.flatMap(([criterion,pattern])=>{const excerpt=sentences.find(s=>pattern.test(s));return excerpt?[{id:crypto.randomUUID(),criterion,value:true,status:'NOT_VERIFIED',source_url:source,excerpt:excerpt.slice(0,1500),observed_at:new Date().toISOString(),verified_by:null}]:[]});
}
