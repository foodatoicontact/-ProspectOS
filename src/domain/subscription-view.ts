import {hasCurrentSubscription,type BillingAvailability,type BillingSummary} from './plan-intent.ts';
// What the account's "Votre abonnement" block shows, derived only from the server's answer (billing +
// billing_offers). Pure and display-only: it never decides an access, it only says which button may exist.
//  - manage 'portal'      → "Gérer mon abonnement" calls the existing server route POST /api/v1/billing/portal;
//  - manage 'unavailable' → this deployment has no billing configuration (server answered portal:false):
//                           an explicit message, never a button that cannot work.
// A subscription is never offered a second checkout: `current` hides the pricing cards in BillingSection.
export type SubscriptionView={
 offer:'BETA'|'PRO'|'TEAM'|null;
 seats:number|null;
 status:string;
 current:boolean;
 cancelScheduled:boolean;
 date:{kind:'renews'|'ends';iso:string}|null;
 manage:'portal'|'unavailable';
};
export function subscriptionView(status:BillingSummary|null|undefined,offers:BillingAvailability|null|undefined):SubscriptionView|null{
 if(!status?.has_customer||typeof status.status!=='string'||!status.status)return null;
 const current=hasCurrentSubscription(status);
 const cancelScheduled=current&&status.cancel_at_period_end===true;
 const end=status.current_period_end&&Number.isFinite(new Date(status.current_period_end).getTime())?status.current_period_end:null;
 return {
  offer:status.plan==='PAID'?'BETA':status.plan==='PRO'?'PRO':status.plan==='TEAM'?'TEAM':null,
  seats:status.plan==='TEAM'&&typeof status.seats==='number'?status.seats:null,
  status:status.status,current,cancelScheduled,
  date:current&&end?{kind:cancelScheduled?'ends':'renews',iso:end}:null,
  manage:offers?.portal===true?'portal':'unavailable',
 };
}
