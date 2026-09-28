// Commercial plans of ProspectOS, independent of any payment provider. Display and mapping only: every quota
// decision is taken in the database (enforce_plan_limit, migrations 016/017) and every paid plan is granted by
// the server after the payment provider confirmed the payment. Nothing here can grant or extend an action.
//
// Database values are kept as they already exist in production (no row is rewritten):
//   account_entitlements.plan  'BETA'       → commercial TRIAL      (7-day free trial, historical name)
//                              'PAID'       → commercial BETA       (ProspectOS Bêta, 49 € HT / month)
//                              'PRO'        → commercial PRO        (ProspectOS Pro B2B, 99 € HT / month)
//                              'ENTERPRISE' → commercial ENTERPRISE (quote only, activated by an operator)
//                              'INTERNAL'   → commercial INTERNAL   (unlimited, unchanged)
export type CommercialPlan='TRIAL'|'BETA'|'PRO'|'ENTERPRISE'|'INTERNAL';
export type DbPlan='BETA'|'PAID'|'PRO'|'ENTERPRISE'|'INTERNAL';
// The only plans a customer can buy by themselves. ENTERPRISE is never on this list: quote only.
export type CheckoutPlan='BETA'|'PRO';
export type Quotas={discovery:number;analysis:number;aiOffer:number};

export const DB_TO_COMMERCIAL:Record<DbPlan,CommercialPlan>={BETA:'TRIAL',PAID:'BETA',PRO:'PRO',ENTERPRISE:'ENTERPRISE',INTERNAL:'INTERNAL'};
export const CHECKOUT_TO_DB:Record<CheckoutPlan,'PAID'|'PRO'>={BETA:'PAID',PRO:'PRO'};

// Same numbers as the database defaults (016: trial_* / paid_*, 017: pro_*); tests pin both sides together.
export const PLAN_QUOTAS:Record<'TRIAL'|'BETA'|'PRO',Quotas>={
 TRIAL:{discovery:20,analysis:50,aiOffer:5},
 BETA:{discovery:100,analysis:250,aiOffer:25},
 PRO:{discovery:300,analysis:750,aiOffer:75},
};
// What each self-service plan must cost. The server refuses to open a checkout on a provider price that does
// not match exactly (amount in cents, currency, monthly recurrence), whatever the configuration says.
export const CHECKOUT_PRICES:Record<CheckoutPlan,{unitAmount:number;currency:'eur';interval:'month'}>={
 BETA:{unitAmount:4900,currency:'eur',interval:'month'},
 PRO:{unitAmount:9900,currency:'eur',interval:'month'},
};
export const isCheckoutPlan=(v:unknown):v is CheckoutPlan=>v==='BETA'||v==='PRO';
export function commercialPlan(dbPlan:unknown):CommercialPlan|null{
 return typeof dbPlan==='string'&&Object.hasOwn(DB_TO_COMMERCIAL,dbPlan)?DB_TO_COMMERCIAL[dbPlan as DbPlan]:null;
}
