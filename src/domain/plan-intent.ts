import {isCheckoutPlan,type CheckoutPlan} from './plans.ts';
// Plan intent: the offer a visitor picked BEFORE having an account (public demo, landing). It survives the
// sign-up, the confirmation e-mail round trip and the sign-in in this browser only, then is consumed once the
// account is loaded. It is a preference, never an authorization: the server alone says which offers can be
// bought here (billing_offers), whether a subscription already exists (billing), and which price is charged.
// The name of a self-service offer as the page handles it (the page never names the payment step itself).
export type PlanName=CheckoutPlan;
export const PLAN_INTENT_KEY='prospectos-plan-intent-v1';
export type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};

// Only 'BETA', 'PRO' and 'TEAM' are ever kept. Anything else (ENTERPRISE, a price id, an amount, JSON) is dropped.
export const parsePlanIntent=(raw:unknown):CheckoutPlan|null=>isCheckoutPlan(raw)?raw:null;

export function readPlanIntent(storage:StorageLike|null|undefined):CheckoutPlan|null{
 if(!storage)return null;
 try{
  const raw=storage.getItem(PLAN_INTENT_KEY);
  const plan=parsePlanIntent(raw);
  if(raw!==null&&!plan)storage.removeItem(PLAN_INTENT_KEY); // invalid value: forgotten, never interpreted
  return plan;
 }catch{return null}
}
export function savePlanIntent(storage:StorageLike|null|undefined,plan:unknown):CheckoutPlan|null{
 const valid=parsePlanIntent(plan);
 if(!storage||!valid)return null;
 try{storage.setItem(PLAN_INTENT_KEY,valid);return valid}catch{return null}
}
export function clearPlanIntent(storage:StorageLike|null|undefined):void{
 try{storage?.removeItem(PLAN_INTENT_KEY)}catch{/* private mode: nothing stored anyway */}
}

export type BillingAvailability={BETA:boolean;PRO:boolean;TEAM?:boolean;portal:boolean};
export type BillingSummary={has_customer:boolean;plan?:'PAID'|'PRO'|'TEAM'|null;seats?:number|null;status?:string|null;cancel_at_period_end?:boolean;current_period_end?:string|null};
// Same states as the server's own guard (checkout.ts BLOCKING): such a subscription already covers or still
// bills the account, so it is managed in the portal and never doubled by a second checkout.
const CURRENT=new Set(['active','trialing','past_due','unpaid','paused']);
export const hasCurrentSubscription=(billing:BillingSummary|null|undefined):boolean=>
 !!billing?.has_customer&&typeof billing.status==='string'&&CURRENT.has(billing.status);

export type PlanIntentDecision=
 |{action:'NONE'}
 |{action:'SUBSCRIBED'}                       // manage the existing subscription (portal); no checkout
 |{action:'CHECKOUT';plan:CheckoutPlan}       // the server said this offer can be bought here
 |{action:'UNAVAILABLE';plan:CheckoutPlan};   // not buyable online on this deployment: no checkout
// Pure decision taken once the authenticated account answer is known. A missing answer (null) never opens
// a checkout: availability is only ever what the server returned.
export function decidePlanIntent(intent:CheckoutPlan|null,offers:BillingAvailability|null|undefined,billing:BillingSummary|null|undefined):PlanIntentDecision{
 if(!intent)return {action:'NONE'};
 if(hasCurrentSubscription(billing))return {action:'SUBSCRIBED'};
 if(offers&&offers[intent]===true)return {action:'CHECKOUT',plan:intent};
 return {action:'UNAVAILABLE',plan:intent};
}
