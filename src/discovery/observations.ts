import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import type {Criterion,Evidence} from '../domain/core.ts';
import {ObservationSchema,type Observation} from './types.ts';
import {extractRestaurantObservations,isRestaurantPresetActive,RESTAURANT_PRESET_KEYS} from './strategies/restaurant.ts';
import {extractGenericObservations} from './strategies/generic.ts';
export class ObservationService {
 // Generic pipeline driven by the project's own ICP: PROJECT -> CRITERIA -> OBSERVATIONS.
 // The restaurant preset only runs when the ICP itself carries one of its known keys — never from the project name.
 extract(html:string,url:string,criteria:Criterion[],sourceType:Observation['source_type']='official_website',now=new Date()):Observation[]{
 const $=load(html.slice(0,500000));$('script,style,noscript,template,svg').remove();const title=$('title').text().trim().slice(0,300)||'Page publique';
 $('br').replaceWith('\n');$('p,div,li,section,h1,h2,h3,footer,address').append('\n');
 const text=$('body').text().replace(/[ \t]+/g,' ').trim();const lines=text.split(/[\n]+|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
 const hash=createHash('sha256').update(text).digest('hex');const collected=now.toISOString(),expires=new Date(+now+90*86400000).toISOString();
 const make=(criterion:Observation['criterion'],type:string,excerpt:string,value:boolean|null,status:Observation['status'],claim:string,confidence:number):Observation=>ObservationSchema.parse({criterion,observation_type:type,claim,value,status,source_url:url,source_title:title,source_excerpt:excerpt.slice(0,500),source_type:sourceType,confidence,collected_at:collected,expires_at:expires,content_hash:hash});
 const ctx={lines,text,make};
 const criteriaKeys=new Set(criteria.map(c=>c.key));
 const restaurantActiveKeys=new Set(RESTAURANT_PRESET_KEYS.filter(k=>criteriaKeys.has(k)));
 const out:Observation[]=isRestaurantPresetActive(criteriaKeys)?extractRestaurantObservations(ctx,restaurantActiveKeys):[];
 // Keys owned by the restaurant preset are never re-attempted by the generic matcher, even unmatched.
 out.push(...extractGenericObservations(ctx,criteria,restaurantActiveKeys));
 // Fill UNKNOWN strictly from this project's own criteria — never a hardcoded vertical's list.
 for(const c of criteria)if(!out.some(o=>o.criterion===c.key))out.push(make(c.key,'UNKNOWN','',null,'UNKNOWN','À confirmer : information absente de cette page',0));
 return out;
 }
}
export class EvidenceProposalService {
 // A proposal whose criterion is not part of the current ICP is dropped — Discovery never invents a criterion.
 propose(observations:Observation[],criteria:Criterion[]):Evidence[]{
 const allowed=new Set(criteria.map(c=>c.key));
 return observations.filter(o=>o.criterion&&allowed.has(o.criterion)&&o.status!=='UNKNOWN'&&o.source_excerpt.trim()&&o.value!==null).map(o=>({id:crypto.randomUUID(),criterion:o.criterion!,value:o.value!,status:o.status==='INFERRED'?'INFERRED_UNCONFIRMED':'NOT_VERIFIED',source_url:o.source_url,excerpt:o.source_excerpt,observed_at:o.collected_at,verified_by:null}));
 }
}
export const EXTRACTION_SYSTEM_PROMPT='You may only use facts present in the supplied source content. If the information is absent, return UNKNOWN. Never fabricate a company, URL, phone number, social account, feature, ordering channel, delivery platform or customer signal. Return strict structured observations. Never return VERIFIED. Every positive claim requires an exact source_excerpt present in the supplied text.';
