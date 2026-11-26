// « Reprises de commerces (BODACC) » — the search options of that source (owner decision, 26 nov. 2026): who to look for
// (the buyers, or the companies that SOLD a business), the activity of the seller (NAF code, e.g. 56 = restauration) and
// the period. Chosen on the v2 search screen and sent with the run as optional filters (src/discovery/types.ts) through
// providerSpecificFilters — the search form itself is unchanged. A tiny store, no React: safe for the server and tests.
export type SaleParty='buyer'|'seller';
export const SALE_PERIODS=[30,90,180,365] as const;
export type SalePeriod=typeof SALE_PERIODS[number];
export type SaleSearchOptions={party:SaleParty;naf:string[];periodDays:SalePeriod};
export const DEFAULT_SALE_SEARCH:SaleSearchOptions={party:'buyer',naf:[],periodDays:90};
export const NAF_PREFIX=/^\d{2}(\.\d{1,2}[A-Z]?)?$/;
// Ready-made activities (NAF divisions or classes, INSEE). The person may also type codes.
export const NAF_PRESETS:readonly {value:string;fr:string;en:string}[]=[
 {value:'56',fr:'Restauration (56)',en:'Food and drink (56)'},
 {value:'56.10',fr:'Restaurants et restauration rapide (56.10)',en:'Restaurants and fast food (56.10)'},
 {value:'56.30',fr:'Débits de boissons (56.30)',en:'Bars (56.30)'},
 {value:'47',fr:'Commerce de détail (47)',en:'Retail trade (47)'},
 {value:'96.02',fr:'Coiffure et soins de beauté (96.02)',en:'Hairdressing and beauty (96.02)'},
];
let state:SaleSearchOptions=DEFAULT_SALE_SEARCH;
const listeners=new Set<()=>void>();
export const getSaleSearch=()=>state;
export function setSaleSearch(next:Partial<SaleSearchOptions>){
 const naf=(next.naf??state.naf).map(s=>s.trim().toUpperCase()).filter(s=>NAF_PREFIX.test(s)).slice(0,20);
 const periodDays=SALE_PERIODS.includes(next.periodDays as SalePeriod)?next.periodDays as SalePeriod:state.periodDays;
 state={party:next.party==='seller'||next.party==='buyer'?next.party:state.party,naf:[...new Set(naf)],periodDays};
 for(const l of listeners)l();
}
export function subscribeSaleSearch(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn)}}
// The optional filters of a BODACC sales run. The NAF codes are read for the sellers only (their activity comes from the
// company register); the buyers keep their activity words.
export function saleSearchFilters(o:SaleSearchOptions=state):{sale_party:SaleParty;period_days:SalePeriod;naf_prefixes?:string[]}{
 return {sale_party:o.party,period_days:o.periodDays,...(o.party==='seller'&&o.naf.length?{naf_prefixes:o.naf}:{})};
}
