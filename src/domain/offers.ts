import {PLAN_QUOTAS,CHECKOUT_PRICES,TEAM_PRICING,type CheckoutPlan,type Quotas} from './plans.ts';
// The four commercial offers as they are DISPLAYED (pricing cards, demo, account). Derived from plans.ts —
// the prices the server checks before any checkout (CHECKOUT_PRICES) and the database quota defaults
// (PLAN_QUOTAS) — so no amount or quota is typed a second time in a component or a translation.
// Display only: the browser never sends a price or an amount, and nothing here grants an action.
export type OfferId='BETA'|'PRO'|'TEAM'|'ENTERPRISE';
export type Offer={
 id:OfferId;
 checkoutPlan:CheckoutPlan|null;      // the only value the browser may send to /api/v1/billing/checkout
 priceEurExclVatPerMonth:number|null; // null = on quote; TEAM: the price for `team.includedSeats` accounts
 quotas:Quotas|null;                  // per month (TEAM: per account, pooled); null = on quote
 team:{includedSeats:number;maxSeats:number;extraSeatEur:number}|null; // per-seat offer only
 badge:'early'|null;
 emphasis:boolean;                    // light visual emphasis only — no "best choice" claim
};
export const OFFERS:readonly Offer[]=[
 {id:'BETA',checkoutPlan:'BETA',priceEurExclVatPerMonth:CHECKOUT_PRICES.BETA.unitAmount/100,quotas:PLAN_QUOTAS.BETA,team:null,badge:'early',emphasis:false},
 {id:'PRO',checkoutPlan:'PRO',priceEurExclVatPerMonth:CHECKOUT_PRICES.PRO.unitAmount/100,quotas:PLAN_QUOTAS.PRO,team:null,badge:null,emphasis:true},
 {id:'TEAM',checkoutPlan:'TEAM',priceEurExclVatPerMonth:TEAM_PRICING.baseAmount/100,quotas:PLAN_QUOTAS.PRO,
  team:{includedSeats:TEAM_PRICING.includedSeats,maxSeats:TEAM_PRICING.maxSeats,extraSeatEur:TEAM_PRICING.extraSeatAmount/100},badge:null,emphasis:false},
 {id:'ENTERPRISE',checkoutPlan:null,priceEurExclVatPerMonth:null,quotas:null,team:null,badge:null,emphasis:false},
];
export const offerFor=(plan:CheckoutPlan):Offer=>OFFERS.find(o=>o.checkoutPlan===plan)!;
// Database plan of a paid subscription → displayed offer ('PAID' is the historical name of ProspectOS Solo).
export function offerForDbPlan(plan:unknown):Offer|null{
 return plan==='PAID'?offerFor('BETA'):plan==='PRO'?offerFor('PRO'):plan==='TEAM'?offerFor('TEAM'):plan==='ENTERPRISE'?OFFERS.find(o=>o.id==='ENTERPRISE')!:null;
}
