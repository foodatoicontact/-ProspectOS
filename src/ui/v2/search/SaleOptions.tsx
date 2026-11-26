'use client';
// « Reprises de commerces (BODACC) » — the options of that source on the v2 search screen (owner decision, 26 nov. 2026):
// look for the buyers, or for the companies that SOLD a business (« Entreprises ayant cédé un fonds »), with the sellers'
// activity (NAF codes from the company register; 56 = restauration) and the period. Bound to src/discovery/sale-search.ts,
// sent with the run. And the seller line of a result.
import {useSyncExternalStore} from 'react';
import {getSaleSearch,setSaleSearch,subscribeSaleSearch,DEFAULT_SALE_SEARCH,NAF_PRESETS,SALE_PERIODS,type SalePeriod} from '../../../discovery/sale-search.ts';
import {SELLER_PP_LABEL,SELLER_UNKNOWN_LABEL} from '../../../domain/bodacc-seller.ts';
import type {Locale} from '../../../i18n/locale.ts';

export const SALE_TEXT:Record<Locale,{party:string;buyers:string;sellers:string;naf:string;nafAll:string;nafOther:string;nafHint:string;period:string;
 days:(n:number)=>string;buyersNote:string;sellersNote:string;sellerPm:(siren:string)=>string;sellerPp:string;sellerUnknown:string;sold:string}>={
 fr:{party:'Qui chercher',buyers:'Repreneurs (entreprises qui ont racheté)',sellers:'Entreprises ayant cédé un fonds',naf:'Secteur du cédant (code NAF)',
  nafAll:'Toutes activités',nafOther:'Autres codes NAF',nafHint:'Séparés par des virgules, ex. 56.10A, 56.30',period:'Période',days:n=>`${n} derniers jours`,
  buyersNote:'Entreprises qui ont racheté un fonds de commerce ou un établissement, d’après les annonces officielles du BODACC. Seuls les acheteurs qui sont des sociétés sont proposés ; chaque résultat renvoie à son annonce, à vérifier avant tout contact.',
  sellersNote:'Sociétés qui ont vendu un fonds de commerce, d’après les annonces officielles du BODACC et le registre des entreprises (activité, lieu). Un cédant personne physique n’est jamais affiché ; fusions, apports et annonces annulées sont exclus.',
  sellerPm:s=>`Cédant : société, SIREN ${s.replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3')}`,sellerPp:SELLER_PP_LABEL,sellerUnknown:SELLER_UNKNOWN_LABEL,sold:'A cédé un fonds'},
 en:{party:'Look for',buyers:'Buyers (companies that took over)',sellers:'Companies that sold a business',naf:'Seller’s sector (NAF code)',
  nafAll:'All activities',nafOther:'Other NAF codes',nafHint:'Comma-separated, e.g. 56.10A, 56.30',period:'Period',days:n=>`last ${n} days`,
  buyersNote:'Companies that bought a business or an establishment, from the official BODACC notices. Only buyers that are companies are proposed; each result links to its notice, to check before any contact.',
  sellersNote:'Companies that sold a business, from the official BODACC notices and the company register (activity, place). A seller who is a private person is never shown; mergers, contributions and cancelled notices are excluded.',
  sellerPm:s=>`Seller: company, SIREN ${s.replace(/(\d{3})(\d{3})(\d{3})/,'$1 $2 $3')}`,sellerPp:'Seller: private person, not shown',sellerUnknown:'Seller: not stated in the notice',sold:'Sold a business'},
};

export function SaleOptions({locale}:{locale:Locale}){
 const o=useSyncExternalStore(subscribeSaleSearch,getSaleSearch,()=>DEFAULT_SALE_SEARCH);
 const t=SALE_TEXT[locale];
 const preset=o.naf.length===1&&NAF_PRESETS.some(p=>p.value===o.naf[0])?o.naf[0]!:o.naf.length?'other':'';
 return <>
  <label className="pos-sfield"><span>{t.party}</span>
   <select value={o.party} onChange={e=>setSaleSearch({party:e.target.value==='seller'?'seller':'buyer'})}>
    <option value="buyer">{t.buyers}</option><option value="seller">{t.sellers}</option></select></label>
  {o.party==='seller'&&<label className="pos-sfield"><span>{t.naf}</span>
   <select value={preset} onChange={e=>setSaleSearch({naf:e.target.value&&e.target.value!=='other'?[e.target.value]:e.target.value==='other'?o.naf:[]})}>
    <option value="">{t.nafAll}</option>{NAF_PRESETS.map(p=><option key={p.value} value={p.value}>{p[locale]}</option>)}<option value="other">{t.nafOther}</option></select></label>}
  {o.party==='seller'&&preset==='other'&&<label className="pos-sfield"><span>{t.nafOther}</span>
   <input defaultValue={o.naf.join(', ')} onBlur={e=>setSaleSearch({naf:e.target.value.split(',')})} inputMode="text" autoComplete="off"/><small>{t.nafHint}</small></label>}
  <label className="pos-sfield"><span>{t.period}</span>
   <select value={o.periodDays} onChange={e=>setSaleSearch({periodDays:Number(e.target.value) as SalePeriod})}>
    {SALE_PERIODS.map(n=><option key={n} value={n}>{t.days(n)}</option>)}</select></label>
 </>;
}
export function saleCompaniesLabel(locale:Locale){return getSaleSearch().party==='seller'?(locale==='fr'?'sociétés ayant cédé un fonds, identifiées au registre':'companies that sold a business, identified in the register'):(locale==='fr'?'acheteurs identifiés dans les annonces de reprise':'buyers identified in takeover notices')}
export function saleNote(locale:Locale){return getSaleSearch().party==='seller'?SALE_TEXT[locale].sellersNote:SALE_TEXT[locale].buyersNote}

// The seller line of a BODACC result: on a buyer, who sold (a company's SIREN, or the fixed sentence); on a seller, nothing
// more than the result's own line.
export function SellerLine({meta,locale}:{meta:Record<string,unknown>;locale:Locale}){
 const sale=meta.bodacc_sale as {role?:string;seller?:{kind?:string;siren?:string}}|undefined;
 if(!sale||sale.role==='seller'||!sale.seller)return null;
 const t=SALE_TEXT[locale];const s=sale.seller;
 const text=s.kind==='PM'&&typeof s.siren==='string'&&/^\d{9}$/.test(s.siren)?t.sellerPm(s.siren):s.kind==='PP'?t.sellerPp:t.sellerUnknown;
 return <p className="pos-sres__seller" data-seller={s.kind}>{text}</p>;
}
