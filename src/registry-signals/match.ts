// Signaux SIRENE — does a Google place clearly belong to a register establishment? Deterministic, no network.
// Prudent by design: CONFIRMED only when the name AND the address both match clearly and exactly one place does;
// a doubt is NOT_CONFIRMED (with its reason), no result is ABSENT. A correspondence is never guessed or completed.
//  - Name: the distinctive words of one register name (legal name, sign "enseigne", trade name) are all found in the
//    place's name, or the reverse. Shared words must include one that is not a generic activity word ("pizza",
//    "coiffure"…), so "Pizza Napoli" never matches "PIZZA DU CENTRE".
//  - Address: same postal code, same house number when the register gives one, street words that agree. Without a
//    house number in the register, the street must agree entirely (two words at least).
import {addressParts,fold,nameTokens,overlap,type AddressParts} from './normalize.ts';

export type MatchStatus='confirme'|'non_confirme'|'absent';
export type MatchReason='NAME_AND_ADDRESS_MATCH'|'NO_RESULT'|'NAME_MISMATCH'|'ADDRESS_MISMATCH'|'AMBIGUOUS'|'PLACE_CLOSED';
export type RegistrySide={names:string[];address:string|null;postalCode:string|null;commune:string|null};
export type PlaceCandidate={id:string;name:string;formattedAddress:string|null;postalCode:string|null;streetNumber:string|null;route:string|null;
 businessStatus:string|null};
export type MatchResult={status:MatchStatus;reason:MatchReason;place:PlaceCandidate|null};

// Words that describe an activity, not a business: never enough on their own to say two names are the same.
const GENERIC=new Set(['restaurant','resto','brasserie','bistrot','bistro','cafe','bar','pizza','pizzeria','kebab','snack','burger','sushi','traiteur','creperie',
 'boulangerie','patisserie','boucherie','charcuterie','epicerie','primeur','fromagerie','cave','tabac','presse','fleuriste','fleurs','pharmacie','opticien','optique',
 'coiffure','coiffeur','coiffeuse','barber','barbier','salon','institut','beaute','esthetique','ongles','nails','spa','onglerie','boutique','magasin','store','shop',
 'market','marche','mode','concept','maison','atelier','studio','centre','france','sud','nord','est','ouest','food','home','new']);

export const placeAddressParts=(p:PlaceCandidate):AddressParts=>{
 const parsed=addressParts(p.formattedAddress,p.postalCode);
 if(!p.route)return parsed;
 const fromComponents=addressParts(`${p.streetNumber??''} ${p.route}`,p.postalCode);
 return {number:fromComponents.number??parsed.number,street:fromComponents.street,postalCode:p.postalCode??parsed.postalCode};
};

// The commune's own words ("Le Haillan" → haillan) are as generic as an activity word for a business of that commune.
export function namesMatch(registryNames:readonly string[],placeName:string,commune:string|null=null):boolean{
 const place=nameTokens(placeName);if(!place.length)return false;
 const local=new Set(nameTokens(commune));const distinctive=(w:string)=>w.length>=3&&!GENERIC.has(w)&&!local.has(w);
 return registryNames.some(n=>{
  const reg=nameTokens(n);if(!reg.length)return false;
  if(fold(reg.join(' '))===fold(place.join(' ')))return reg.some(distinctive)||reg.length>=2;
  if(overlap(reg,place)<1)return false;
  const shared=reg.filter(w=>place.includes(w));
  return shared.some(distinctive);
 });
}

export function addressesMatch(reg:AddressParts,place:AddressParts):boolean{
 if(!reg.postalCode||reg.postalCode!==place.postalCode)return false;
 if(reg.number){
  if(reg.number!==place.number)return false;
  return reg.street.length>0&&overlap(reg.street,place.street)>=0.6;
 }
 // No house number: the same street words on both sides (never "CENTRE COMMERCIAL LE HAILLAN" = "Centre Commercial").
 const a=new Set(reg.street),b=new Set(place.street);
 return a.size>=2&&a.size===b.size&&[...a].every(w=>b.has(w));
}

export function matchPlace(registry:RegistrySide,places:readonly PlaceCandidate[]):MatchResult{
 if(!places.length)return {status:'absent',reason:'NO_RESULT',place:null};
 const reg=addressParts(registry.address,registry.postalCode);
 const named=places.filter(p=>namesMatch(registry.names,p.name,registry.commune));
 if(!named.length)return {status:'non_confirme',reason:'NAME_MISMATCH',place:null};
 const both=named.filter(p=>addressesMatch(reg,placeAddressParts(p)));
 if(!both.length)return {status:'non_confirme',reason:'ADDRESS_MISMATCH',place:null};
 const ids=new Set(both.map(p=>p.id));
 if(ids.size>1)return {status:'non_confirme',reason:'AMBIGUOUS',place:null};
 const place=both[0]!;
 if(place.businessStatus==='CLOSED_PERMANENTLY')return {status:'non_confirme',reason:'PLACE_CLOSED',place:null};
 return {status:'confirme',reason:'NAME_AND_ADDRESS_MATCH',place};
}
