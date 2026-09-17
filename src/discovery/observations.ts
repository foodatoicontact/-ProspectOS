import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {FOODATOI_CRITERIA,type Evidence} from '../domain/core.ts';
import {ObservationSchema,type Observation} from './types.ts';
export class ObservationService {
 extract(html:string,url:string,sourceType:Observation['source_type']='official_website',now=new Date()):Observation[]{
 const $=load(html.slice(0,500000));$('script,style,noscript,template,svg').remove();const title=$('title').text().trim().slice(0,300)||'Page publique';
 $('br').replaceWith('\n');$('p,div,li,section,h1,h2,h3,footer,address').append('\n');
 const text=$('body').text().replace(/[ \t]+/g,' ').trim();const lines=text.split(/[\n]+|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
 const hash=createHash('sha256').update(text).digest('hex');const collected=now.toISOString(),expires=new Date(+now+90*86400000).toISOString();
 const make=(criterion:Observation['criterion'],type:string,excerpt:string,value:boolean|null,status:Observation['status'],claim:string,confidence:number):Observation=>ObservationSchema.parse({criterion,observation_type:type,claim,value,status,source_url:url,source_title:title,source_excerpt:excerpt.slice(0,500),source_type:sourceType,confidence,collected_at:collected,expires_at:expires,content_hash:hash});
 const out:Observation[]=[];
 const patterns:[Observation['criterion'],string,RegExp][]=[['food','FOOD_ACTIVITY',/restaurant|snack|tacos|burger|pizza|boulangerie|kebab/i],['region','GEOGRAPHY',/Toulouse|Occitanie|Lombez|Montpellier|Albi|Montauban|Auch|Perpignan|Carcassonne|Nîmes|Tarbes|Foix|Cahors|Rodez|Mende/i],['phone_orders','PHONE_ORDERING',/command(?:ez|es?|er).{0,45}(?:téléphone|(?:au|:)?\s*(?:0[1-9]|\+33)[\d .()-]{8,})/i],['social_orders','SOCIAL_ORDERING',/command.{0,40}(?:\bDM\b|Instagram|WhatsApp|Snapchat|Messenger)/i],['platforms','DELIVERY_PLATFORM',/Uber\s*Eats|Deliveroo/i]];
 for(const [criterion,type,re] of patterns){const line=lines.find(x=>re.test(x));if(line){const neg=/\b(?:pas|plus|sans|jamais|aucun)\b/i.test(line);out.push(make(criterion,type,line,!neg,neg?'INFERRED':'OBSERVED',neg?'Mention avec négation : sens à vérifier':'Mention explicite dans le texte',neg?.45:.85))}}
 const collect=lines.find(x=>/click\s*(?:&|and|et)\s*collect|commander en ligne|commande web|retrait/i.test(x));if(collect)out.push(make('weak_collect','CLICK_AND_COLLECT',collect,false,'INFERRED','Parcours de commande/retrait mentionné ; qualité du click & collect à vérifier',.65));
 const delivery=lines.find(x=>/nous livrons|livraison (?:maison|directe)|nos (?:propres )?livreurs|zones? de livraison/i.test(x));if(delivery)out.push(make('internal_delivery','INTERNAL_DELIVERY',delivery,true,'INFERRED','Livraison annoncée ; organisation interne à confirmer',.5));
 const phone=text.match(/(?:\+33\s*(?:\(0\)\s*)?|0)[1-9](?:[ .-]?\d{2}){4}/)?.[0];if(phone)out.push(make(null,'PHONE_RAW',phone,null,'OBSERVED','Numéro public présent ; usage commande non déduit',.95));
 const otherPlatform=lines.find(x=>/Just\s*Eat/i.test(x));if(otherPlatform)out.push(make(null,'OTHER_DELIVERY_PLATFORM',otherPlatform,null,'OBSERVED','Autre plateforme citée ; hors critère Uber Eats / Deliveroo V0',.85));
 for(const c of FOODATOI_CRITERIA)if(!out.some(o=>o.criterion===c.key))out.push(make(c.key as Observation['criterion'],c.key==='audience'?'SOCIAL_SIGNALS':'UNKNOWN','',null,'UNKNOWN','À confirmer : information absente de cette page',0));
 return out;
 }
}
export class EvidenceProposalService {
 propose(observations:Observation[]):Evidence[]{return observations.filter(o=>o.criterion&&o.status!=='UNKNOWN'&&o.source_excerpt.trim()&&o.value!==null).map(o=>({id:crypto.randomUUID(),criterion:o.criterion!,value:o.value!,status:o.status==='INFERRED'?'INFERRED_UNCONFIRMED':'NOT_VERIFIED',source_url:o.source_url,excerpt:o.source_excerpt,observed_at:o.collected_at,verified_by:null}))}
}
export const EXTRACTION_SYSTEM_PROMPT='You may only use facts present in the supplied source content. If the information is absent, return UNKNOWN. Never fabricate a company, URL, phone number, social account, feature, ordering channel, delivery platform or customer signal. Return strict structured observations. Never return VERIFIED. Every positive claim requires an exact source_excerpt present in the supplied text.';
