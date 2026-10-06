// ProspectOS Équipe (2026-10-06): Pro is ONE account at 99 € HT; a team buys the Équipe offer — 179 € HT / month for
// 2 accounts, then 60 € per extra account, up to 5 — through ONE graduated Stripe price whose quantity is the number of
// accounts. The server checks the price's tiers before any checkout and maps the paid quantity to seats; the database
// decides the rest (tests/team-offer-db.mjs). Every amount shown or published comes from src/domain/plans.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TEAM_PRICING,teamMonthlyPriceEur,teamQuotas,PLAN_QUOTAS,CHECKOUT_TO_DB,commercialPlan,isCheckoutPlan} from '../src/domain/plans.ts';
import {OFFERS,offerForDbPlan} from '../src/domain/offers.ts';
import {billingConfig,planForPrice,checkoutAvailability} from '../src/server/billing/config.ts';
import {startCheckout,priceMatches} from '../src/server/billing/checkout.ts';
import {subscriptionState} from '../src/server/billing/webhook.ts';
import type {StripeApi,StripePrice,StripeSubscription} from '../src/server/billing/stripe-client.ts';
import type {BillingStore,BillingAccount} from '../src/server/billing/store.ts';
import {parsePlanIntent,decidePlanIntent} from '../src/domain/plan-intent.ts';
import {subscriptionView} from '../src/domain/subscription-view.ts';
import {usageView} from '../src/domain/pricing.ts';
import {translate} from '../src/i18n/index.ts';
import {llmsTxt} from '../src/domain/geo.ts';
import {getSeoPage,softwareApplicationJsonLd} from '../src/domain/seo.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const KEY=['sk','test','teamfake000'].join('_');
const ENV={STRIPE_SECRET_KEY:KEY,STRIPE_WEBHOOK_SECRET:['whsec','teamfake000'].join('_'),STRIPE_PRICE_BETA:'price_beta49',STRIPE_PRICE_PRO:'price_pro99',STRIPE_PRICE_TEAM:'price_team',BILLING_ENABLED:'true',VERCEL_ENV:'preview'};
const config=billingConfig(ENV)!;
const USER='00000000-0000-4000-8000-000000000001';
const TIERS=[{up_to:2,flat_amount:17900,unit_amount:0},{up_to:null,flat_amount:null,unit_amount:6000}];
const teamPrice=(over:Partial<StripePrice>={}):StripePrice=>({id:'price_team',active:true,currency:'eur',unit_amount:null,livemode:false,recurring:{interval:'month',interval_count:1},type:'recurring',billing_scheme:'tiered',tiers_mode:'graduated',tiers:TIERS,...over});
function fakeStripe(price:StripePrice){
 const calls:any[]=[];
 const api:StripeApi={
  retrievePrice:async id=>{calls.push(['price',id]);return price},
  createCustomer:async()=>({id:'cus_1'}),
  createCheckoutSession:async(params,key)=>{calls.push(['session',params,key]);return {id:'cs_1',url:'https://checkout.stripe.com/c/pay/cs_1'}},
  createPortalSession:async()=>({url:'https://billing.stripe.com/p/session/1'}),
  retrieveSubscription:async()=>{throw Error('unused')},
 };
 return {api,calls};
}
const store:BillingStore={getAccount:async()=>null,linkCustomer:async(_u,c)=>c,applyState:async()=>({outcome:'granted',user_id:USER})};

test('pricing: 179 € for 2 accounts, + 60 € per extra account, 2 to 5 accounts; Pro volumes per account',()=>{
 assert.deepEqual({min:TEAM_PRICING.minSeats,max:TEAM_PRICING.maxSeats,included:TEAM_PRICING.includedSeats},{min:2,max:5,included:2});
 assert.deepEqual([2,3,4,5].map(teamMonthlyPriceEur),[179,239,299,359]);
 assert.throws(()=>teamMonthlyPriceEur(1));assert.throws(()=>teamMonthlyPriceEur(6));
 assert.deepEqual(teamQuotas(3),{discovery:PLAN_QUOTAS.PRO.discovery*3,analysis:PLAN_QUOTAS.PRO.analysis*3,aiOffer:PLAN_QUOTAS.PRO.aiOffer*3});
 assert.equal(CHECKOUT_TO_DB.TEAM,'TEAM');assert.equal(commercialPlan('TEAM'),'TEAM');assert.equal(isCheckoutPlan('TEAM'),true);
});

test('offers: Solo, Pro (1 account), Équipe, Entreprise — amounts read from plans.ts',()=>{
 assert.deepEqual(OFFERS.map(o=>o.id),['BETA','PRO','TEAM','ENTERPRISE']);
 const team=OFFERS.find(o=>o.id==='TEAM')!;
 assert.equal(team.checkoutPlan,'TEAM');assert.equal(team.priceEurExclVatPerMonth,179);
 assert.deepEqual(team.team,{includedSeats:2,maxSeats:5,extraSeatEur:60});
 assert.deepEqual(team.quotas,PLAN_QUOTAS.PRO,'quotas shown per account');
 assert.equal(OFFERS.find(o=>o.id==='PRO')!.team,null);
 assert.equal(offerForDbPlan('TEAM')?.id,'TEAM');
});

test('config: STRIPE_PRICE_TEAM maps to TEAM, only when it is a price id; availability per offer',()=>{
 assert.equal(planForPrice(config,'price_team'),'TEAM');
 assert.equal(checkoutAvailability(config).TEAM,true);
 assert.equal(checkoutAvailability(billingConfig({...ENV,STRIPE_PRICE_TEAM:'prod_x'})).TEAM,false,'a product id is not a price id');
 assert.equal(checkoutAvailability(billingConfig({...ENV,STRIPE_PRICE_TEAM:undefined})).TEAM,false);
});

test('price check: only the graduated 179 € / 2 + 60 € tiers, EUR, monthly, same mode',()=>{
 assert.equal(priceMatches(teamPrice(),'TEAM','test'),true);
 for(const bad of [
  {tiers_mode:'volume'},{billing_scheme:'per_unit',unit_amount:17900,tiers:undefined},{currency:'usd'},{livemode:true},{active:false},
  {tiers:[{up_to:2,flat_amount:15000,unit_amount:0},{up_to:null,flat_amount:null,unit_amount:6000}]},
  {tiers:[{up_to:3,flat_amount:17900,unit_amount:0},{up_to:null,flat_amount:null,unit_amount:6000}]},
  {tiers:[{up_to:2,flat_amount:17900,unit_amount:0},{up_to:null,flat_amount:null,unit_amount:5000}]},
  {tiers:[{up_to:2,flat_amount:17900,unit_amount:0}]},
  {recurring:{interval:'year',interval_count:1}},
 ] as Partial<StripePrice>[])assert.equal(priceMatches(teamPrice(bad),'TEAM','test'),false,JSON.stringify(bad));
 assert.equal(priceMatches(teamPrice(),'PRO','test'),false,'a tiered price is never the Pro price');
});

test('checkout: TEAM opens a Stripe session for 2 accounts, adjustable from 2 to 5 on the Stripe page',async()=>{
 const {api,calls}=fakeStripe(teamPrice());
 const r=await startCheckout({userId:USER,email:'a@b.fr',body:{plan:'TEAM'},origin:'https://app.example'},{config,stripe:api,store});
 assert.equal(r.status,200);
 const [, params]=calls.find(c=>c[0]==='session');
 assert.deepEqual(params.line_items,[{price:'price_team',quantity:2,adjustable_quantity:{enabled:true,minimum:2,maximum:5}}]);
 assert.equal(params.metadata.prospectos_plan,'TEAM');
 // The browser never chooses an amount, a price or a quantity.
 for(const body of [{plan:'TEAM',quantity:5},{plan:'TEAM',price:'price_x'},{plan:'TEAM',seats:3}])
  assert.equal((await startCheckout({userId:USER,email:null,body,origin:'https://app.example'},{config,stripe:api,store})).status,400);
 const wrong=fakeStripe(teamPrice({tiers_mode:'volume'}));
 assert.equal((await startCheckout({userId:USER,email:null,body:{plan:'TEAM'},origin:'https://app.example'},{config,stripe:wrong.api,store})).status,503);
});

test('webhook: the subscription quantity becomes the seats; a non-matching price grants nothing',()=>{
 const sub=(over:any={}):StripeSubscription=>({id:'sub_1',customer:'cus_1',status:'active',cancel_at_period_end:false,livemode:false,
  items:{data:[{price:teamPrice() as any,quantity:3,current_period_start:1,current_period_end:2,...over}]},latest_invoice:{id:'in_1',status:'paid'}});
 const s=subscriptionState(sub(),config,{id:'evt_1',type:'invoice.paid'},teamPrice());
 assert.equal(s.plan,'TEAM');assert.equal(s.seats,3);
 assert.equal(subscriptionState(sub(),config,{id:'evt_2',type:'invoice.paid'},teamPrice({tiers_mode:'volume'})).plan,null);
 assert.equal(subscriptionState(sub(),config,{id:'evt_4',type:'invoice.paid'}).plan,null,'tiers not re-read: no plan');
 // The range (2–5) is enforced by the database (invalid_seats); the server passes the quantity as Stripe gives it.
 assert.equal(subscriptionState(sub({quantity:7}),config,{id:'evt_3',type:'invoice.paid'},teamPrice()).seats,7);
});

test('webhook end to end: only the Équipe price is re-read (with tiers); Solo/Pro subscriptions make no extra call',async()=>{
 const {handleStripeWebhook}=await import('../src/server/billing/webhook.ts');
 const {signPayload}=await import('../src/server/billing/signature.ts');
 const run=async(priceId:string,itemPrice:any)=>{
  const calls:any[]=[];const applied:any[]=[];
  const sub:StripeSubscription={id:'sub_1',customer:'cus_1',status:'active',cancel_at_period_end:false,livemode:false,items:{data:[{price:itemPrice,quantity:4,current_period_start:1,current_period_end:2}]},latest_invoice:{id:'in_1',status:'paid'}};
  const stripe={...fakeStripe(teamPrice()).api,retrievePrice:async(id:string,withTiers?:boolean)=>{calls.push([id,withTiers]);return teamPrice()},retrieveSubscription:async()=>sub};
  const raw=JSON.stringify({id:'evt_9',type:'invoice.paid',livemode:false,data:{object:{subscription:'sub_1'}}});const t=Math.floor(Date.now()/1000);
  await handleStripeWebhook(raw,`t=${t},v1=${signPayload(raw,ENV.STRIPE_WEBHOOK_SECRET,t)}`,{config,stripe,store:{...store,applyState:async(s:any)=>{applied.push(s);return {outcome:'granted',user_id:USER}}}});
  return {calls,applied};
 };
 const team=await run('price_team',{id:'price_team'});
 assert.deepEqual(team.calls,[['price_team',true]]);assert.equal(team.applied[0].plan,'TEAM');assert.equal(team.applied[0].seats,4);
 const pro=await run('price_pro99',{id:'price_pro99',unit_amount:9900,currency:'eur',recurring:{interval:'month'}});
 assert.deepEqual(pro.calls,[],'no extra Stripe call for Pro');assert.equal(pro.applied[0].plan,'PRO');assert.equal(pro.applied[0].seats,null);
});

test('plan intent, subscription view and usage: TEAM is a first-class offer',()=>{
 assert.equal(parsePlanIntent('TEAM'),'TEAM');
 assert.deepEqual(decidePlanIntent('TEAM',{BETA:true,PRO:true,TEAM:true,portal:true},{has_customer:false}),{action:'CHECKOUT',plan:'TEAM'});
 assert.equal(subscriptionView({has_customer:true,plan:'TEAM',seats:3,status:'active',current_period_end:'2026-11-06T00:00:00Z'},{BETA:true,PRO:true,TEAM:true,portal:true})?.offer,'TEAM');
 const u=usageView({plan:'TEAM',seats:3,active:true,period_end:'2099-01-01T00:00:00Z',discovery_used:1,discovery_limit:900,analysis_used:0,analysis_limit:2250,ai_offer_used:0,ai_offer_limit:225});
 assert.equal(u?.kind,'paid');assert.equal(u?.discovery.limit,900);
});

test('copy: Pro says 1 account, Équipe says 2 to 5 accounts with shared base and quotas (FR and EN)',()=>{
 assert.doesNotMatch(translate('fr','offers.proPoint2'),/5 comptes/);
 assert.match(translate('fr','offers.proPoint2'),/1 compte/);
 assert.equal(translate('fr','billing.teamName'),'ProspectOS Équipe');assert.equal(translate('en','billing.teamName'),'ProspectOS Team');
 assert.match(translate('fr','offers.teamPoint1'),/base de données et quotas partagés/);
 assert.match(translate('fr','team.proOnly'),/Équipe/);assert.doesNotMatch(translate('fr','team.readOnly'),/offre Pro/);
});

test('public facts: llms.txt, /tarifs and schema.org state Pro = 1 account and Équipe = 179 € for 2 + 60 € per account up to 5',()=>{
 const t=llmsTxt();
 assert.match(t,/ProspectOS Pro — 99 € HT\/mois, 1 compte/);
 assert.match(t,/ProspectOS Équipe — 179 € HT\/mois pour 2 comptes, \+ 60 € HT par compte supplémentaire, jusqu’à 5 comptes/);
 const tarifs=JSON.stringify(getSeoPage('tarifs'));
 assert.ok(tarifs.includes('179 € HT par mois')&&tarifs.includes('60 € HT par compte supplémentaire')&&tarifs.includes('jusqu’à 5 comptes'));
 assert.doesNotMatch(tarifs,/ProspectOS Pro[^"]{0,80}jusqu’à 5 comptes/,'Pro is never sold as a team anymore');
 const offers=(softwareApplicationJsonLd as any).offers as any[];
 const team=offers.find(o=>o.name==='ProspectOS Équipe');assert.ok(team);assert.equal(team.price,'179');
});

test('account page: team features belong to TEAM / Entreprise / Internal, never to Pro',async()=>{
 const page=await read('../app/page.tsx');
 assert.match(page,/teamPlan=\{entitlementPlan==='TEAM'\|\|entitlementPlan==='ENTERPRISE'\|\|entitlementPlan==='INTERNAL'\}/);
 assert.match(page,/entitlementPlan==='TEAM'\?/);
});
