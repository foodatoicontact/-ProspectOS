import {PLAN_QUOTAS,CHECKOUT_PRICES,type CheckoutPlan,type Quotas} from './plans.ts';
// The three commercial offers as they are DISPLAYED (pricing cards, demo, account). Derived from plans.ts —
// the prices the server checks before any checkout (CHECKOUT_PRICES) and the database quota defaults
// (PLAN_QUOTAS) — so no amount or quota is typed a second time in a component or a translation.
// Display only: the browser never sends a price or an amount, and nothing here grants an action.
export type OfferId='BETA'|'PRO'|'ENTERPRISE';
export type Offer={
 id:OfferId;
 checkoutPlan:CheckoutPlan|null;      // the only value the browser may send to /api/v1/billing/checkout
 priceEurExclVatPerMonth:number|null; // null = on quote
 quotas:Quotas|null;                  // per month; null = on quote
 badge:'early'|null;
 emphasis:boolean;                    // light visual emphasis only — no "best choice" claim
};
export const OFFERS:readonly Offer[]=[
 {id:'BETA',checkoutPlan:'BETA',priceEurExclVatPerMonth:CHECKOUT_PRICES.BETA.unitAmount/100,quotas:PLAN_QUOTAS.BETA,badge:'early',emphasis:false},
 {id:'PRO',checkoutPlan:'PRO',priceEurExclVatPerMonth:CHECKOUT_PRICES.PRO.unitAmount/100,quotas:PLAN_QUOTAS.PRO,badge:null,emphasis:true},
 {id:'ENTERPRISE',checkoutPlan:null,priceEurExclVatPerMonth:null,quotas:null,badge:null,emphasis:false},
];
export const offerFor=(plan:CheckoutPlan):Offer=>OFFERS.find(o=>o.checkoutPlan===plan)!;
// Database plan of a paid subscription → displayed offer ('PAID' is the historical name of ProspectOS Bêta).
export function offerForDbPlan(plan:unknown):Offer|null{
 return plan==='PAID'?offerFor('BETA'):plan==='PRO'?offerFor('PRO'):plan==='ENTERPRISE'?OFFERS[2]:null;
}
