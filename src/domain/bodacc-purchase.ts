// What a BODACC « Ventes et cessions » notice really announces — ONE rule for every part of the product that reads that
// family: the reprises search (src/discovery/providers/bodacc-sales.ts), the signals on a followed company
// (src/signals/providers/bodacc.ts), the national daily collection (src/collect/bodacc.ts) and the published figures
// (src/domain/company-creations.ts).
//
// The family mixes real purchases of a business with contributions, mergers, donations, attributions, cross-border
// transformations and sales ordered by a court. Measured on the 4 893 initial notices published 26 Oct.–24 Nov. 2026 (all of
// France) against a reference sorted by script then checked by hand on every disagreement (docs/BODACC_RACHATS.md):
//  - « Achat d'un fonds… » / « Achat d'un établissement… »: a purchase, unless the origin of the business says it came by
//    contribution (« acquis par apport »);
//  - « Mise en activité d'une société suite à achat »: the company created to take a business over — a purchase;
//  - « Autre achat, apport, attribution »: a catch-all of 2 567 notices, mostly contributions and mergers; a purchase when
//    the origin of the business, or else the act's text, says the business was sold (« a cédé », « fonds vendu »);
//  - a sale ordered in a collective proceeding (liquidation, receivership, plan de cession) is not a sale by agreement.
//
// THE ACT'S TEXT (descriptif) — owner decision, 25 nov. 2026. It names sellers, sometimes private persons. It is read here,
// in memory, by fixed patterns only (no AI call), and dropped: the result is a kind and the id of the rule that decided,
// two constants. No part of the text is ever returned, stored, logged or put in an error, and no name is extracted.
export const PURCHASE_CATEGORY=/^Achat d['’]un (?:fonds|établissement)/i;

export const SALE_KINDS=['PURCHASE','CONTRIBUTION','MERGER','FORCED_SALE','UNDETERMINED'] as const;
export type SaleKind=typeof SALE_KINDS[number];
// Every rule that can decide, in the order they are tried. A verdict carries one of these ids, never any text.
export const SALE_RULES=['origin_forced','text_forced','origin_contribution','origin_merger','category_purchase','start_after_purchase',
 'origin_purchase','category_contribution','text_merger','text_contribution','text_sale','text_head_office_move','no_rule'] as const;
export type SaleRule=typeof SALE_RULES[number];
export type SaleVerdict={kind:SaleKind;rule:SaleRule};
export type PurchaseVerdict={purchase:true;rule:SaleRule}|{purchase:false;reason:'NOT_A_PURCHASE'|'FORCED_SALE';kind:SaleKind;rule:SaleRule};

const START_AFTER_PURCHASE=/^mise en activite d'une societe suite a achat/;
const CATCH_ALL=/^autre achat/;
const CONTRIBUTION_CATEGORY=/^(?:apport|attribution)/;
const BOUGHT=/\bachat\b|\bachete|\bacqui[st]\b|\bacquisition\b/;
const PAID=/\bachat\b|\bachete/;
const CONTRIBUTION=/\bapport|\bdonation|\battribution|\bpartage|\bheritage|\bsuccession\b/;
const MERGER=/\bfusion|\bscission|transmission universelle|\babsorb|transformation transfrontaliere/;
// A court-ordered sale, as the liquidator's or the court's wording says it. « ordonnance » alone is NOT one: a pharmacy sells
// its « livres d'ordonnances » (1 such notice in the period); the judge's order is caught by « juge-commissaire ».
const FORCED=/liquidation judiciaire|liquidateur judiciaire|redressement judiciaire|mandataire judiciaire|administrateur judiciaire|plan de cession|juge[- ]commissaire|procedure collective|l\.? ?642-19|\badjudication/;
// A registry sometimes files a head-office move under « Achat d'un établissement… » (3 notices in the period): with no origin
// and an act that only speaks of the move, it is not a purchase.
const HEAD_OFFICE_MOVE=/transfert (?:du|de) siege|transfert de l'etablissement principal/;
// The act says the business changed hands: « X a cédé à Y le fonds », « fonds vendu », « fonds cédé », or the legal formula
// of a sale of a business — the former and the new owner's addresses, the oppositions of article L.141-12 (4 notices of
// the period carried nothing else).
const SOLD=/\ba cede\b|\bcede a\b|\bfonds (?:de commerce |artisanal |cede|vendu)|\bfonds cede\b|\bfonds vendu\b|\ba vendu\b|\bcession (?:du|d'un|de son) fonds|\bancien proprietaire\b|\bl\.? ?141-12\b/;

const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ').trim();
const parse=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return null}};
const first=(v:unknown):unknown=>Array.isArray(v)?v[0]:v;
const acteOf=(acte:unknown)=>(parse(acte) as {descriptif?:unknown;vente?:{categorieVente?:unknown}}|null)??{};

export function saleCategory(acte:unknown):string{
 const c=acteOf(acte).vente?.categorieVente;
 return typeof c==='string'?c.trim():'';
}
export function fundsOrigin(establishments:unknown):string{
 const e=first((parse(establishments) as {etablissement?:unknown}|null)?.etablissement) as {origineFonds?:unknown}|undefined;
 return typeof e?.origineFonds==='string'?fold(e.origineFonds):'';
}
// The act's text, folded, for the patterns below only. Module-private: never exported, never returned.
function actText(acte:unknown):string{const t=acteOf(acte).descriptif;return typeof t==='string'?fold(t):''}

// acte and listeetablissements as the BODACC API gives them (JSON text or object). Pure; never throws.
export function classifySale(acte:unknown,establishments:unknown):SaleVerdict{
 const category=saleCategory(acte),c=fold(category),origin=fundsOrigin(establishments);
 let text:string|null=null;const t=()=>text??=actText(acte);
 if(!category)return {kind:'UNDETERMINED',rule:'no_rule'};
 if(FORCED.test(origin))return {kind:'FORCED_SALE',rule:'origin_forced'};
 // The origin is more precise than the category: « Achat d'un fonds… » with an origin « acquis par apport » is a
 // contribution (14 such notices in the period above).
 if(!PAID.test(origin)){
  if(MERGER.test(origin))return {kind:'MERGER',rule:'origin_merger'};
  if(CONTRIBUTION.test(origin))return {kind:'CONTRIBUTION',rule:'origin_contribution'};
 }
 let base:SaleVerdict|null=null;
 if(PURCHASE_CATEGORY.test(category)){
  if(!origin&&HEAD_OFFICE_MOVE.test(t())&&!SOLD.test(t()))return {kind:'UNDETERMINED',rule:'text_head_office_move'};
  base={kind:'PURCHASE',rule:'category_purchase'};
 }
 else if(START_AFTER_PURCHASE.test(c))base={kind:'PURCHASE',rule:'start_after_purchase'};
 else if(CATCH_ALL.test(c)&&BOUGHT.test(origin))base={kind:'PURCHASE',rule:'origin_purchase'};
 else if(CONTRIBUTION_CATEGORY.test(c))return {kind:'CONTRIBUTION',rule:'category_contribution'};
 else if(CATCH_ALL.test(c)&&!origin){
  // No origin: only the act's text can tell. A restructuring first — its notices also use « cession » for the shares.
  if(MERGER.test(t()))return {kind:'MERGER',rule:'text_merger'};
  if(CONTRIBUTION.test(t()))return {kind:'CONTRIBUTION',rule:'text_contribution'};
  if(SOLD.test(t()))base={kind:'PURCHASE',rule:'text_sale'};
 }
 if(!base)return {kind:'UNDETERMINED',rule:'no_rule'};
 if(FORCED.test(t()))return {kind:'FORCED_SALE',rule:'text_forced'};
 return base;
}
export function purchaseOf(acte:unknown,establishments:unknown):PurchaseVerdict{
 const v=classifySale(acte,establishments);
 return v.kind==='PURCHASE'?{purchase:true,rule:v.rule}:{purchase:false,reason:v.kind==='FORCED_SALE'?'FORCED_SALE':'NOT_A_PURCHASE',kind:v.kind,rule:v.rule};
}

// The same purchase is often announced twice, a few days apart (« Achat d'un fonds… » then « Mise en activité… », or the
// same notice filed by two registries, with the address spelt two ways): one buyer is one reprise within
// DUPLICATE_WINDOW_DAYS. A company that buys two businesses the same month counts once — rare, and the search already keeps
// one candidate per company. Notices without a register number are never merged.
export const DUPLICATE_WINDOW_DAYS=30;
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
// Keeps, among dated purchases of any order, the first of each buyer per DUPLICATE_WINDOW_DAYS (by date, then input order).
export function dedupePurchases<T>(items:readonly T[],siren:(x:T)=>string|null,day:(x:T)=>string|null):T[]{
 const sorted=items.map((x,i)=>({x,i,d:day(x)??''})).sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.i-b.i);
 const last=new Map<string,number>();const keep=new Set<number>();
 for(const {x,i,d} of sorted){
  const s=siren(x);if(!s){keep.add(i);continue}
  const at=Date.parse(`${d||'1970-01-01'}T00:00:00Z`),prev=last.get(s);
  if(prev!==undefined&&at-prev<DUPLICATE_WINDOW_DAYS*86_400_000)continue;
  last.set(s,at);keep.add(i);
 }
 return items.filter((_,i)=>keep.has(i));
}
