'use client';
import {type Locale,translate,type TKey} from '../i18n';
import {OFFERS,type Offer} from '../domain/offers';
import type {CheckoutPlan} from '../domain/plans';
// The one pricing component (demo, landing and account). Display only: every amount and quota comes from
// src/domain/offers.ts, and a click only ever hands back the offer NAME ('BETA' | 'PRO') to the caller —
// never a price, an amount or a provider identifier.
//  - context 'public' (visitor, demo): no account yet, so nothing is "available" or not; the caller only
//    records the intent and sends the visitor to account creation.
//  - context 'account' (signed in): a plan is clickable only if the server's billing_offers says so.
export type PlanAvailability={BETA:boolean;PRO:boolean}|null;

export function formatOfferPrice(amount:number,locale:Locale):string{
 return new Intl.NumberFormat(locale==='fr'?'fr-FR':'en-GB',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(amount);
}

export const offerNameKey=(id:Offer['id']):TKey=>id==='BETA'?'billing.betaName':id==='PRO'?'billing.proName':'billing.enterpriseName';

const POINTS:Record<Offer['id'],TKey[]>={
 BETA:['offers.betaPoint1','offers.betaPoint2','offers.betaPoint3'],
 PRO:['offers.proPoint1','offers.proPoint2','offers.proPoint3'],
 ENTERPRISE:['offers.enterprisePoint1','offers.enterprisePoint2'],
};

export function PricingPlans({locale,context,availability,busy,selected,onChoose,layout='grid'}:{locale:Locale;context:'public'|'account';availability:PlanAvailability;busy:boolean;selected?:CheckoutPlan|null;onChoose:(plan:CheckoutPlan)=>void;layout?:'grid'|'stack'}){
 const tr=(k:TKey)=>translate(locale,k);
 const n=(v:number)=>new Intl.NumberFormat(locale==='fr'?'fr-FR':'en-GB').format(v);
 const noneAvailable=context==='account'&&!(availability?.BETA||availability?.PRO);
 return <div className={`pricing pricing-${layout}`}>
  <div className="pricing-cards">
   {OFFERS.map(offer=>{
    const titleId=`plan-${offer.id.toLowerCase()}-title`;
    const plan=offer.checkoutPlan;
    const available=plan?(context==='public'||availability?.[plan]===true):false;
    const isSelected=!!plan&&selected===plan;
    return <article key={offer.id} className={`plan-card${offer.emphasis?' plan-emphasis':''}${isSelected?' plan-selected':''}`} aria-labelledby={titleId}>
     <header className="plan-head">
      <h3 id={titleId}>{tr(offerNameKey(offer.id))}</h3>
      {offer.badge==='early'&&<span className="plan-badge">{tr('offers.badgeEarly')}</span>}
      {isSelected&&<span className="plan-badge plan-badge-selected">✓ {tr('offers.chosen')}</span>}
     </header>
     <p className="plan-price">{offer.priceEurExclVatPerMonth===null
      ?<b>{tr('offers.onQuote')}</b>
      :<><b>{formatOfferPrice(offer.priceEurExclVatPerMonth,locale)}</b> <span>{tr('offers.perMonth')}</span></>}</p>
     {offer.quotas&&<ul className="plan-quotas">
      <li>{tr('offers.quotaDiscovery').replace('{n}',n(offer.quotas.discovery))}</li>
      <li>{tr('offers.quotaAnalysis').replace('{n}',n(offer.quotas.analysis))}</li>
      <li>{tr('offers.quotaAiOffer').replace('{n}',n(offer.quotas.aiOffer))}</li>
     </ul>}
     <ul className="plan-points">{POINTS[offer.id].map(k=><li key={k}>{tr(k)}</li>)}</ul>
     <div className="plan-cta">
      {plan
       ?<button type="button" className={offer.emphasis?'primary':''} disabled={busy||!available} aria-pressed={context==='public'?isSelected:undefined}
         onClick={()=>onChoose(plan)}>{available?tr(plan==='BETA'?'offers.chooseBeta':'offers.choosePro'):tr('offers.unavailable')}</button>
       :<a className="button" href="/mentions-legales" aria-label={tr('offers.contactAria')}>{tr('offers.contact')}</a>}
     </div>
    </article>})}
  </div>
  <p className="pricing-note">{context==='public'?tr('offers.publicNote'):noneAvailable?tr('offers.unavailableNote'):tr('billing.terms')} {tr('offers.quotaNote')}</p>
 </div>;
}
