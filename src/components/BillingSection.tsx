'use client';
import {type Locale,translate,type TKey} from '../i18n';
import {PricingPlans,offerNameKey} from './PricingPlans';
import {offerForDbPlan} from '../domain/offers';
import {hasCurrentSubscription,type BillingAvailability,type BillingSummary} from '../domain/plan-intent';
// Account page billing block. Display only: the offers shown as buyable, the subscription status and every
// button come from the server's answer (billing_offers / billing); the browser only sends the offer NAME
// ('BETA' or 'PRO') to /api/v1/billing/checkout and follows the hosted payment page URL it gets back.
// A current subscription is managed in the portal: no second checkout is ever offered next to it.
export type BillingOffers=BillingAvailability;
export type BillingStatus=BillingSummary;

const STATUS_KEYS=['active','trialing','past_due','unpaid','paused','canceled','incomplete'] as const;
const statusKey=(s:string|null|undefined):TKey=>(STATUS_KEYS as readonly string[]).includes(s??'')?`billing.status.${s}` as TKey:'billing.status.unknown';

export function BillingSection({locale,offers,status,busy,entitlementPlan,onCheckout,onPortal}:{locale:Locale;offers:BillingOffers|null;status:BillingStatus|null;busy:boolean;entitlementPlan?:string|null;onCheckout:(plan:'BETA'|'PRO')=>void;onPortal:()=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const current=hasCurrentSubscription(status);
 const date=(iso:string)=>new Date(iso).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 const offer=offerForDbPlan(status?.plan);
 // Manual plans (INTERNAL, ENTERPRISE) are outside self-service: no pricing cards for them.
 const showPlans=!current&&entitlementPlan!=='INTERNAL'&&entitlementPlan!=='ENTERPRISE';
 return <div className="account-field billing">
  {status?.status==='past_due'&&<p className="reached" role="alert">{tr('billing.pastDue')}</p>}
  {status?.has_customer&&status.status&&<div className="subscription-card">
   <p className="subscription-title"><span className="muted">{tr('billing.currentTitle')}</span><b>{offer?tr(offerNameKey(offer.id)):'—'}</b></p>
   <p><span className="muted">{tr('billing.statusLabel')} : </span><span className={`status-pill tone-${current?'verified':'neutral'}`}>{tr(statusKey(status.status))}</span></p>
   {current&&status.current_period_end&&<p className="muted">{status.cancel_at_period_end?`${tr('billing.cancelScheduled')} ${date(status.current_period_end)}`:`${tr('billing.renewsOn')} ${date(status.current_period_end)}`}</p>}
   {status.status==='canceled'&&<p className="muted">{tr('billing.ended')}</p>}
   {offers?.portal&&<button type="button" disabled={busy} onClick={onPortal}>{tr('billing.manage')}</button>}
  </div>}
  {showPlans&&<PricingPlans locale={locale} context="account" availability={offers} busy={busy} onChoose={onCheckout} layout="stack"/>}
 </div>;
}
