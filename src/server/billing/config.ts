import {CHECKOUT_TO_DB,type CheckoutPlan,type PaidDbPlan} from '../../domain/plans.ts';
// Billing configuration, read on the server only. No value read here is ever returned to the browser.
//
// Locks, all fail-closed:
//  - the key must be a Stripe secret/restricted key; its prefix tells TEST from LIVE;
//  - a TEST key is refused on the production deployment (VERCEL_ENV=production): the sandbox can never be
//    reached from Production; a LIVE key is refused everywhere unless BILLING_ALLOW_LIVE=true, and never
//    outside production;
//  - self-service checkout additionally needs BILLING_ENABLED=true (off by default: unset in Production today);
//  - BILLING_BETA_CHECKOUT_OPEN=false closes the 49 € offer to NEW customers only (grandfathering: existing
//    subscribers keep their price, and the webhook keeps mapping it).
export type StripeMode='test'|'live';
export type BillingEnv=Record<string,string|undefined>;
export type BillingConfig={
 secretKey:string;mode:StripeMode;webhookSecret:string|null;
 prices:Record<CheckoutPlan,string|null>;checkoutEnabled:boolean;betaCheckoutOpen:boolean;automaticTax:boolean;portalConfiguration:string|null;
};
const PRICE_ID=/^price_[A-Za-z0-9]+$/;
export function stripeMode(key:string|undefined):StripeMode|null{
 if(!key)return null;
 if(/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))return 'test';
 if(/^(sk|rk)_live_[A-Za-z0-9]+$/.test(key))return 'live';
 return null;
}
// null = billing unavailable on this deployment (the reason is never sent to a client).
export function billingConfig(env:BillingEnv=process.env):BillingConfig|null{
 const secretKey=env.STRIPE_SECRET_KEY;const mode=stripeMode(secretKey);
 if(!secretKey||!mode)return null;
 const production=env.VERCEL_ENV==='production';
 if(mode==='test'&&production)return null;
 if(mode==='live'&&(!production||env.BILLING_ALLOW_LIVE!=='true'))return null;
 const price=(v:string|undefined)=>v&&PRICE_ID.test(v)?v:null;
 const webhookSecret=env.STRIPE_WEBHOOK_SECRET&&/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET)?env.STRIPE_WEBHOOK_SECRET:null;
 return {
  secretKey,mode,webhookSecret,
  prices:{BETA:price(env.STRIPE_PRICE_BETA),PRO:price(env.STRIPE_PRICE_PRO),TEAM:price(env.STRIPE_PRICE_TEAM)},
  checkoutEnabled:env.BILLING_ENABLED==='true',
  betaCheckoutOpen:env.BILLING_BETA_CHECKOUT_OPEN!=='false',
  automaticTax:env.STRIPE_AUTOMATIC_TAX==='true',
  portalConfiguration:env.STRIPE_PORTAL_CONFIGURATION&&/^bpc_[A-Za-z0-9]+$/.test(env.STRIPE_PORTAL_CONFIGURATION)?env.STRIPE_PORTAL_CONFIGURATION:null,
 };
}
// Stripe price id → internal database plan. Only the configured prices map to anything; every other price
// (a typo, a price created by hand in the dashboard, a LIVE id in TEST) grants nothing.
export function planForPrice(config:Pick<BillingConfig,'prices'>,priceId:string|null|undefined):PaidDbPlan|null{
 if(!priceId)return null;
 for(const plan of ['BETA','PRO','TEAM'] as const)if(config.prices[plan]===priceId)return CHECKOUT_TO_DB[plan];
 return null;
}
// What the account page may know: which offers can be bought here. Booleans only.
export function checkoutAvailability(config:BillingConfig|null){
 const ready=!!config&&config.checkoutEnabled;
 return {BETA:ready&&!!config!.prices.BETA&&config!.betaCheckoutOpen,PRO:ready&&!!config!.prices.PRO,TEAM:ready&&!!config!.prices.TEAM,portal:!!config};
}
