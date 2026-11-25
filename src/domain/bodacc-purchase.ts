// What a BODACC « Ventes et cessions » notice really announces — ONE rule for every part of the product that reads that
// family: the reprises search (src/discovery/providers/bodacc-sales.ts), the signals on a followed company
// (src/signals/providers/bodacc.ts), the national daily collection (src/collect/bodacc.ts) and the published figures
// (src/domain/company-creations.ts).
//
// The family mixes real purchases of a business with contributions, mergers, donations and attributions between companies
// of a same group. Measured on the 4 893 initial notices published 26 Oct.–24 Nov. 2026 (all of France), sorted by hand:
//  - « Achat d'un fonds… » / « Achat d'un établissement… »: purchases (1 597 of the hand-sorted purchases), unless the
//    origin of the business says it came by contribution (« acquis par apport »);
//  - « Mise en activité d'une société suite à achat »: the company created to take a business over, announced once it
//    starts — a purchase (684), rejected until 25 Nov. 2026, so a reprise by a new company (the usual case for a restaurant)
//    was never shown;
//  - « Autre achat, apport, attribution »: a catch-all of 2 567 notices, mostly contributions and mergers; it holds a
//    purchase only when the origin of the business says so (« acquis par achat au prix stipulé… »);
//  - a sale ordered in a collective proceeding (liquidation, receivership, plan de cession) is not a sale by agreement: never
//    counted as a reprise.
// Only two fields are read: the category of the sale and the origin of the business (« origineFonds »). The act's free text
// (descriptif), which names sellers and private persons, is never read here. When a field is missing the notice is not a
// purchase: a missing signal, never a wrong one.
export const PURCHASE_CATEGORY=/^Achat d['’]un (?:fonds|établissement)/i;
const START_AFTER_PURCHASE=/^mise en activite d'une societe suite a achat/;
const CATCH_ALL=/^autre achat/;
const BOUGHT=/\bachat\b|\bachete|\bacqui[st]\b|\bacquisition\b/;
const PAID=/\bachat\b|\bachete/;
const NOT_BOUGHT=/\bapport|\bfusion|\bscission|\bdonation|\battribution|\bpartage|transmission universelle|\bheritage|\bsuccession\b/;
const FORCED=/liquidation judiciaire|liquidateur judiciaire|redressement judiciaire|mandataire judiciaire|administrateur judiciaire|plan de cession|juge[- ]commissaire|adjudication|procedure collective/;

export type PurchaseVerdict={purchase:true}|{purchase:false;reason:'NOT_A_PURCHASE'|'FORCED_SALE'};
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ').trim();
const parse=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return null}};
const first=(v:unknown):unknown=>Array.isArray(v)?v[0]:v;

export function saleCategory(acte:unknown):string{
 const c=(parse(acte) as {vente?:{categorieVente?:unknown}}|null)?.vente?.categorieVente;
 return typeof c==='string'?c.trim():'';
}
export function fundsOrigin(establishments:unknown):string{
 const e=first((parse(establishments) as {etablissement?:unknown}|null)?.etablissement) as {origineFonds?:unknown}|undefined;
 return typeof e?.origineFonds==='string'?fold(e.origineFonds):'';
}
// acte and listeetablissements as the BODACC API gives them (JSON text or object).
export function purchaseOf(acte:unknown,establishments:unknown):PurchaseVerdict{
 const category=saleCategory(acte),origin=fundsOrigin(establishments),c=fold(category);
 if(FORCED.test(origin))return {purchase:false,reason:'FORCED_SALE'};
 // The origin is more precise than the category: « Achat d'un fonds… » with an origin « acquis par apport » is a
 // contribution (14 such notices in the period above).
 if(NOT_BOUGHT.test(origin)&&!PAID.test(origin))return {purchase:false,reason:'NOT_A_PURCHASE'};
 if(PURCHASE_CATEGORY.test(category))return {purchase:true};
 if(START_AFTER_PURCHASE.test(c))return {purchase:true};
 if(CATCH_ALL.test(c)&&BOUGHT.test(origin))return {purchase:true};
 return {purchase:false,reason:'NOT_A_PURCHASE'};
}

// A purchase is often announced twice, a few days apart (« Achat d'un fonds… » then « Mise en activité… », or the same
// notice filed by two registries): the same buyer in the same postal code is one reprise. Notices without a register number
// are never merged.
export function buyerSiren(registre:unknown):string|null{
 const list=Array.isArray(registre)?registre.map(String):typeof registre==='string'?registre.replace(/[\[\]']/g,'').split(','):[];
 for(const x of list){const m=/^\s*(\d{3}) ?(\d{3}) ?(\d{3})\s*$/.exec(x);if(m)return m.slice(1,4).join('')}
 return null;
}
export function postalCodeOf(establishments:unknown):string|null{
 const e=first((parse(establishments) as {etablissement?:unknown}|null)?.etablissement) as {adresse?:{codePostal?:unknown}}|undefined;
 const cp=String(e?.adresse?.codePostal??'').trim();
 return /^\d{5}$/.test(cp)?cp:null;
}
export function purchaseKey(siren:string|null,postalCode:string|null):string|null{
 return siren?`${siren}:${postalCode??''}`:null;
}
