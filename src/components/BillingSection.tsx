'use client';
import {useState} from 'react';
import {type Locale,translate,type TKey,usageCounterLabel,usageResetLabel} from '../i18n';
import {PricingPlans} from './PricingPlans';
import {type BillingAvailability,type BillingSummary} from '../domain/plan-intent';
import {subscriptionView} from '../domain/subscription-view';
import type {UsageView} from '../domain/pricing';
import type {CheckoutPlan} from '../domain/plans';
// Account page billing block. Display only: the offers shown as buyable, the subscription status and every
// button come from the server's answer (billing_offers / billing); the browser only sends the offer NAME
// ('BETA', 'PRO' or 'TEAM') to /api/v1/billing/checkout, or asks POST /api/v1/billing/portal for the Customer Portal,
// and follows the URL the server returns — it never builds a payment-provider URL itself.
// A current subscription is managed in the portal: no second checkout is ever offered next to it.
export type BillingOffers=BillingAvailability;
export type BillingStatus=BillingSummary;

const STATUS_KEYS=['active','trialing','past_due','unpaid','paused','canceled','incomplete'] as const;
const statusKey=(s:string|null|undefined):TKey=>(STATUS_KEYS as readonly string[]).includes(s??'')?`billing.status.${s}` as TKey:'billing.status.unknown';

export function BillingSection({locale,offers,status,usage,busy,entitlementPlan,teamMember=false,onCheckout,onPortal}:{locale:Locale;offers:BillingOffers|null;status:BillingStatus|null;usage?:UsageView|null;busy:boolean;entitlementPlan?:string|null;teamMember?:boolean;onCheckout:(plan:CheckoutPlan)=>void;onPortal:()=>Promise<void>}){
 const tr=(k:TKey)=>translate(locale,k);
 const [opening,setOpening]=useState(false);const [portalError,setPortalError]=useState('');
 const view=subscriptionView(status,offers);
 const date=(iso:string)=>new Date(iso).toLocaleDateString(locale==='fr'?'fr-FR':'en-US');
 // Manual plans (INTERNAL, ENTERPRISE) are outside self-service: no pricing cards for them. A team member works on
 // its owner's plan: the subscription is the owner's to manage, never a second one of its own.
 const showPlans=!teamMember&&!view?.current&&entitlementPlan!=='INTERNAL'&&entitlementPlan!=='ENTERPRISE';
 // The error is shown here, inside the account dialog, not in the page notice hidden behind it.
 async function manage(){setOpening(true);setPortalError('');try{await onPortal()}catch(e){setPortalError(e instanceof Error?e.message:tr('error.generic'))}finally{setOpening(false)}}
 return <div className="account-field billing">
  {view&&<section className="subscription-card" aria-labelledby="subscription-title">
   <div className="subscription-head"><span id="subscription-title" className="muted">{tr('billing.currentTitle')}</span><span className={`status-pill tone-${view.current?'verified':'neutral'}`}>{tr(statusKey(view.status))}</span></div>
   {view.current&&view.offer&&<p className="subscription-offer">{view.offer==='TEAM'?tr('account.usageTeamPlan').replace('{n}',String(view.seats??'—')):tr(view.offer==='BETA'?'account.usagePaid':'account.usagePro')}</p>}
   {view.status==='past_due'&&<p className="reached" role="alert">{tr('billing.pastDue')}</p>}
   {view.date&&<p className="subscription-date">{view.date.kind==='ends'?`${tr('billing.cancelScheduled')} ${date(view.date.iso)}`:`${tr('billing.renewsOn')} ${date(view.date.iso)}`}</p>}
   {view.status==='canceled'&&<p className="muted">{tr('billing.ended')}</p>}
   {view.current&&usage&&<div className="subscription-usage">
    <p className={usage.discovery.reached?'reached':''}>{usageCounterLabel(locale,'discovery',usage.discovery.used,usage.discovery.limit)}</p>
    <p className={usage.analysis.reached?'reached':''}>{usageCounterLabel(locale,'analysis',usage.analysis.used,usage.analysis.limit)}</p>
    <p className={usage.aiOffer.reached?'reached':''}>{usageCounterLabel(locale,'ai_offer',usage.aiOffer.used,usage.aiOffer.limit)}</p>{usage.aiOutreach&&<p className={usage.aiOutreach.reached?'reached':''}>{usageCounterLabel(locale,'ai_outreach',usage.aiOutreach.used,usage.aiOutreach.limit)}</p>}
    {usage.active&&usage.kind==='paid'&&!view.cancelScheduled&&<p className="muted">{usageResetLabel(locale,usage.periodEnd)}</p>}
   </div>}
   {view.manage==='portal'
    ?<button type="button" className="primary subscription-manage" disabled={busy||opening} aria-busy={opening} onClick={manage}>{tr('billing.manage')}</button>
    :<p className="subscription-unavailable" role="note">{tr('billing.portalUnavailable')} <a href="/mentions-legales">{tr('offers.contact')}</a></p>}
   {portalError&&<p className="reached" role="alert">{portalError}</p>}
  </section>}
  {showPlans&&<PricingPlans locale={locale} context="account" availability={offers} busy={busy} onChoose={onCheckout} layout="stack"/>}
 </div>;
}
