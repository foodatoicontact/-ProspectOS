'use client';
import {type Locale,translate,type TKey} from '../i18n';
// Account page billing block. Display only: the offers shown as buyable, the subscription status and every
// button come from the server's answer (billing_offers / billing); the browser only sends the offer NAME
// ('BETA' or 'PRO') to /api/v1/billing/checkout and follows the hosted payment page URL it gets back.
export type BillingOffers={BETA:boolean;PRO:boolean;portal:boolean};
export type BillingStatus={has_customer:boolean;plan?:'PAID'|'PRO'|null;status?:string|null;cancel_at_period_end?:boolean;current_period_end?:string|null};

export function BillingSection({locale,offers,status,busy,onCheckout,onPortal}:{locale:Locale;offers:BillingOffers|null;status:BillingStatus|null;busy:boolean;onCheckout:(plan:'BETA'|'PRO')=>void;onPortal:()=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const buyable=!!offers&&(offers.BETA||offers.PRO);
 const current=status?.has_customer&&status.status&&['active','past_due','unpaid','trialing','paused'].includes(status.status);
 if(!buyable&&!(offers?.portal&&status?.has_customer))return null;
 return <div className="account-field billing">
  {status?.status==='past_due'&&<p className="reached" role="alert">{tr('billing.pastDue')}</p>}
  {current&&status?.cancel_at_period_end&&status.current_period_end&&<p className="muted">{tr('billing.cancelScheduled')} {new Date(status.current_period_end).toLocaleDateString(locale==='fr'?'fr-FR':'en-US')}</p>}
  {status?.has_customer&&status.status==='canceled'&&<p className="muted">{tr('billing.ended')}</p>}
  {offers?.portal&&status?.has_customer&&<button disabled={busy} onClick={onPortal}>{tr('billing.manage')}</button>}
  {buyable&&!current&&<>
   <span className="muted">{tr('billing.title')}</span>
   <div className="billing-plans">
    {offers!.BETA&&<div className="billing-plan"><p><b>{tr('billing.betaName')}</b></p><p>{tr('billing.betaPrice')}</p><p className="muted">{tr('billing.betaLimits')}</p><p className="muted">{tr('billing.betaNote')}</p><button className="primary" disabled={busy} onClick={()=>onCheckout('BETA')}>{tr('billing.subscribe')}</button></div>}
    {offers!.PRO&&<div className="billing-plan"><p><b>{tr('billing.proName')}</b></p><p>{tr('billing.proPrice')}</p><p className="muted">{tr('billing.proLimits')}</p><button className="primary" disabled={busy} onClick={()=>onCheckout('PRO')}>{tr('billing.subscribe')}</button></div>}
    <div className="billing-plan"><p><b>{tr('billing.enterpriseName')}</b></p><p>{tr('billing.enterprisePrice')}</p><p className="muted">{tr('billing.enterpriseNote')}</p><a className="button" href="/mentions-legales">{tr('billing.contact')}</a></div>
   </div>
   <p className="muted">{tr('billing.terms')}</p>
  </>}
 </div>;
}
