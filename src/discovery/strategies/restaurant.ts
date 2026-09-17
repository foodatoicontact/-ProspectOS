import type {Observation} from '../types.ts';
export type ObservationContext={lines:string[];text:string;make(criterion:Observation['criterion'],type:string,excerpt:string,value:boolean|null,status:Observation['status'],claim:string,confidence:number):Observation};
// Optional preset: activates only when the project's own ICP already contains one of these keys.
// Never activated by project name — see isRestaurantPresetActive().
export const RESTAURANT_PRESET_KEYS=['food','region','phone_orders','social_orders','platforms','weak_collect','audience','internal_delivery'] as const;
// Trigger condition is deliberately conservative: region/audience/platforms are too generic on
// their own (a SaaS project could plausibly name a criterion "platforms" or "audience") to imply
// a restaurant. Only these vertical-specific keys are strong enough to switch the preset on.
export const RESTAURANT_STRONG_KEYS=['food','phone_orders','social_orders','weak_collect','internal_delivery'] as const;
export function isRestaurantPresetActive(criteriaKeys:Set<string>):boolean{return RESTAURANT_STRONG_KEYS.some(k=>criteriaKeys.has(k))}
export function extractRestaurantObservations(ctx:ObservationContext,activeKeys:Set<string>):Observation[]{
 const {lines,text,make}=ctx;const out:Observation[]=[];
 const patterns:[string,string,RegExp][]=[['food','FOOD_ACTIVITY',/restaurant|snack|tacos|burger|pizza|boulangerie|kebab/i],['region','GEOGRAPHY',/Toulouse|Occitanie|Lombez|Montpellier|Albi|Montauban|Auch|Perpignan|Carcassonne|Nîmes|Tarbes|Foix|Cahors|Rodez|Mende/i],['phone_orders','PHONE_ORDERING',/command(?:ez|es?|er).{0,45}(?:téléphone|(?:au|:)?\s*(?:0[1-9]|\+33)[\d .()-]{8,})/i],['social_orders','SOCIAL_ORDERING',/command.{0,40}(?:\bDM\b|Instagram|WhatsApp|Snapchat|Messenger)/i],['platforms','DELIVERY_PLATFORM',/Uber\s*Eats|Deliveroo/i]];
 for(const [criterion,type,re] of patterns){if(!activeKeys.has(criterion))continue;const line=lines.find(x=>re.test(x));if(line){const neg=/\b(?:pas|plus|sans|jamais|aucun)\b/i.test(line);out.push(make(criterion,type,line,!neg,neg?'INFERRED':'OBSERVED',neg?'Mention avec négation : sens à vérifier':'Mention explicite dans le texte',neg?.45:.85))}}
 if(activeKeys.has('weak_collect')){const collect=lines.find(x=>/click\s*(?:&|and|et)\s*collect|commander en ligne|commande web|retrait/i.test(x));if(collect)out.push(make('weak_collect','CLICK_AND_COLLECT',collect,false,'INFERRED','Parcours de commande/retrait mentionné ; qualité du click & collect à vérifier',.65))}
 if(activeKeys.has('internal_delivery')){const delivery=lines.find(x=>/nous livrons|livraison (?:maison|directe)|nos (?:propres )?livreurs|zones? de livraison/i.test(x));if(delivery)out.push(make('internal_delivery','INTERNAL_DELIVERY',delivery,true,'INFERRED','Livraison annoncée ; organisation interne à confirmer',.5))}
 if(activeKeys.has('platforms')){const otherPlatform=lines.find(x=>/Just\s*Eat/i.test(x));if(otherPlatform)out.push(make(null,'OTHER_DELIVERY_PLATFORM',otherPlatform,null,'OBSERVED','Autre plateforme citée ; hors critère Uber Eats / Deliveroo V0',.85))}
 return out;
}
