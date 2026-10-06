// Commercial plans of ProspectOS, independent of any payment provider. Display and mapping only: every quota
// decision is taken in the database (enforce_plan_limit, migrations 016/017) and every paid plan is granted by
// the server after the payment provider confirmed the payment. Nothing here can grant or extend an action.
//
// Database values are kept as they already exist in production (no row is rewritten):
//   account_entitlements.plan  'BETA'       → commercial TRIAL      (7-day free trial, historical name)
//                              'PAID'       → commercial BETA       (ProspectOS Bêta, 49 € HT / month)
//                              'PRO'        → commercial PRO        (ProspectOS Pro, 99 € HT / month, 1 account)
//                              'TEAM'       → commercial TEAM       (ProspectOS Équipe, 2 to 5 accounts, per seat — 023)
//                              'ENTERPRISE' → commercial ENTERPRISE (quote only, activated by an operator)
//                              'INTERNAL'   → commercial INTERNAL   (unlimited, unchanged)
export type CommercialPlan='TRIAL'|'BETA'|'PRO'|'TEAM'|'ENTERPRISE'|'INTERNAL';
export type DbPlan='BETA'|'PAID'|'PRO'|'TEAM'|'ENTERPRISE'|'INTERNAL';
// The only plans a customer can buy by themselves. ENTERPRISE is never on this list: quote only.
export type CheckoutPlan='BETA'|'PRO'|'TEAM';
export type Quotas={discovery:number;analysis:number;aiOffer:number};

export const DB_TO_COMMERCIAL:Record<DbPlan,CommercialPlan>={BETA:'TRIAL',PAID:'BETA',PRO:'PRO',TEAM:'TEAM',ENTERPRISE:'ENTERPRISE',INTERNAL:'INTERNAL'};
export type PaidDbPlan='PAID'|'PRO'|'TEAM';
export const CHECKOUT_TO_DB:Record<CheckoutPlan,PaidDbPlan>={BETA:'PAID',PRO:'PRO',TEAM:'TEAM'};

// Same numbers as the database defaults (016: trial_* / paid_*, 017: pro_*); tests pin both sides together.
export const PLAN_QUOTAS:Record<'TRIAL'|'BETA'|'PRO',Quotas>={
 TRIAL:{discovery:20,analysis:50,aiOffer:5},
 BETA:{discovery:100,analysis:250,aiOffer:25},
 PRO:{discovery:300,analysis:750,aiOffer:75},
};
// What each self-service plan must cost. The server refuses to open a checkout on a provider price that does
// not match exactly (amount in cents, currency, monthly recurrence), whatever the configuration says.
export const CHECKOUT_PRICES:Record<'BETA'|'PRO',{unitAmount:number;currency:'eur';interval:'month'}>={
 BETA:{unitAmount:4900,currency:'eur',interval:'month'},
 PRO:{unitAmount:9900,currency:'eur',interval:'month'},
};
// ProspectOS Équipe: ONE graduated Stripe price — a flat amount covering the first `includedSeats` accounts, then
// `extraSeatAmount` per account — whose quantity is the number of accounts (minSeats..maxSeats, enforced by the
// server and the database, 023). The checkout refuses any configured price whose tiers are not exactly these.
export const TEAM_PRICING={includedSeats:2,minSeats:2,maxSeats:5,baseAmount:17900,extraSeatAmount:6000,currency:'eur',interval:'month'} as const;
export function teamMonthlyPriceEur(seats:number):number{
 if(!Number.isInteger(seats)||seats<TEAM_PRICING.minSeats||seats>TEAM_PRICING.maxSeats)throw RangeError('seats out of range');
 return (TEAM_PRICING.baseAmount+Math.max(0,seats-TEAM_PRICING.includedSeats)*TEAM_PRICING.extraSeatAmount)/100;
}
// A team gets the Pro volumes per paid account, pooled (enforce_plan_limit, 023).
export const teamQuotas=(seats:number):Quotas=>({discovery:PLAN_QUOTAS.PRO.discovery*seats,analysis:PLAN_QUOTAS.PRO.analysis*seats,aiOffer:PLAN_QUOTAS.PRO.aiOffer*seats});
export const isCheckoutPlan=(v:unknown):v is CheckoutPlan=>v==='BETA'||v==='PRO'||v==='TEAM';
export function commercialPlan(dbPlan:unknown):CommercialPlan|null{
 return typeof dbPlan==='string'&&Object.hasOwn(DB_TO_COMMERCIAL,dbPlan)?DB_TO_COMMERCIAL[dbPlan as DbPlan]:null;
}
