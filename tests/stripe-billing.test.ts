// Stripe Billing (017) — server logic with a fake Stripe API and a fake store: what the browser may send, which
// price the server charges, what a webhook event is turned into, and which configuration can ever reach
// Stripe. The access decisions themselves (grant, period, replay, cancellation) are proven against the real
// database in tests/stripe-billing-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {billingConfig,stripeMode,planForPrice,checkoutAvailability} from '../src/server/billing/config.ts';
import {startCheckout,openPortal,priceMatches} from '../src/server/billing/checkout.ts';
import {handleStripeWebhook,subscriptionState,subscriptionIdOf,HANDLED_EVENTS} from '../src/server/billing/webhook.ts';
import {verifyStripeSignature,signPayload} from '../src/server/billing/signature.ts';
import {formEncode,createStripeClient,type StripeApi,type StripePrice,type StripeSubscription} from '../src/server/billing/stripe-client.ts';
import type {BillingStore,BillingAccount,SubscriptionState} from '../src/server/billing/store.ts';
import {PLAN_QUOTAS,CHECKOUT_PRICES,commercialPlan,DB_TO_COMMERCIAL} from '../src/domain/plans.ts';
import {BETA_OFFER,usageView} from '../src/domain/pricing.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
// Fake identifiers built at runtime: never a real key, and no key-shaped literal in the repository.
const KEY=['sk','test','unitfake000'].join('_');
const LIVE_KEY=['sk','live','unitfake000'].join('_');
const WHSEC=['whsec','unitfake000'].join('_');
const ENV={STRIPE_SECRET_KEY:KEY,STRIPE_WEBHOOK_SECRET:WHSEC,STRIPE_PRICE_BETA:'price_beta49',STRIPE_PRICE_PRO:'price_pro99',BILLING_ENABLED:'true',VERCEL_ENV:'preview'};
const config=billingConfig(ENV)!;
const USER='00000000-0000-4000-8000-000000000001';
const price=(id:string,unit:number,over:Partial<StripePrice>={}):StripePrice=>({id,active:true,currency:'eur',unit_amount:unit,livemode:false,recurring:{interval:'month',interval_count:1},type:'recurring',...over});
const PRICES:Record<string,StripePrice>={price_beta49:price('price_beta49',4900),price_pro99:price('price_pro99',9900)};

function fakeStripe(prices=PRICES,subs:Record<string,StripeSubscription>={}){
 const calls:any[]=[];const customers=new Map<string,{id:string}>();
 const api:StripeApi={
  retrievePrice:async id=>{calls.push(['price',id]);const p=prices[id];if(!p)throw Error('STRIPE_REQUEST_FAILED');return p},
  createCustomer:async(params,key)=>{calls.push(['customer',params,key]);if(!customers.has(key))customers.set(key,{id:`cus_${customers.size+1}`});return customers.get(key)!},
  createCheckoutSession:async(params,key)=>{calls.push(['session',params,key]);return {id:'cs_test_1',url:'https://checkout.stripe.com/c/pay/cs_test_1'}},
  createPortalSession:async params=>{calls.push(['portal',params]);return {url:'https://billing.stripe.com/p/session/test_1'}},
  retrieveSubscription:async id=>{calls.push(['subscription',id]);const s=subs[id];if(!s)throw Error('STRIPE_REQUEST_FAILED');return s},
 };
 return {api,calls};
}
function fakeStore(initial:Record<string,Partial<BillingAccount>>={}){
 const rows=new Map<string,BillingAccount>(Object.entries(initial).map(([u,r])=>[u,{user_id:u,stripe_customer_id:'cus_x',stripe_subscription_id:null,stripe_price_id:null,plan:null,subscription_status:null,current_period_start:null,current_period_end:null,cancel_at_period_end:false,...r}]));
 const applied:SubscriptionState[]=[];
 const store:BillingStore={
  getAccount:async u=>rows.get(u)??null,
  // Same contract as link_stripe_customer: the first stored customer wins.
  linkCustomer:async(u,c)=>{if(!rows.has(u))rows.set(u,{user_id:u,stripe_customer_id:c,stripe_subscription_id:null,stripe_price_id:null,plan:null,subscription_status:null,current_period_start:null,current_period_end:null,cancel_at_period_end:false});return rows.get(u)!.stripe_customer_id},
  applyState:async s=>{applied.push(s);return {outcome:'granted',user_id:USER}},
 };
 return {store,rows,applied};
}
const checkout=(body:unknown,opts:{cfg?:typeof config|null;stripe?:ReturnType<typeof fakeStripe>;store?:ReturnType<typeof fakeStore>;now?:number}={})=>{
 const stripe=opts.stripe??fakeStripe();const store=opts.store??fakeStore();
 return startCheckout({userId:USER,email:'client@example.test',body,origin:'https://preview.example.test',now:opts.now},{config:opts.cfg===undefined?config:opts.cfg,stripe:stripe.api,store:store.store}).then(r=>({r,stripe,store}));
};

// ---------------------------------------------------------------- A–H: checkout
test('A — BETA checkout charges the configured BETA price, verified at 49,00 € before any session is created',async()=>{
 const {r,stripe}=await checkout({plan:'BETA'});
 assert.equal(r.status,200);assert.equal(r.body.url,'https://checkout.stripe.com/c/pay/cs_test_1');
 const session=stripe.calls.find(c=>c[0]==='session');
 assert.deepEqual(session[1].line_items,[{price:'price_beta49',quantity:1}]);
 assert.equal(session[1].mode,'subscription');
 assert.equal(CHECKOUT_PRICES.BETA.unitAmount,4900);
 const tampered=await checkout({plan:'BETA'},{stripe:fakeStripe({...PRICES,price_beta49:price('price_beta49',4800)})});
 assert.equal(tampered.r.status,503);assert.equal(tampered.stripe.calls.some(c=>c[0]==='session'),false,'a 48 € price is never sold as the 49 € offer');
});
test('B — PRO checkout charges the configured PRO price, verified at 99,00 €',async()=>{
 const {r,stripe}=await checkout({plan:'PRO'});
 assert.equal(r.status,200);
 assert.deepEqual(stripe.calls.find(c=>c[0]==='session')[1].line_items,[{price:'price_pro99',quantity:1}]);
 const wrong=await checkout({plan:'PRO'},{stripe:fakeStripe({...PRICES,price_pro99:price('price_pro99',4900)})});
 assert.equal(wrong.r.status,503);
});
test('C, D — currency EUR and monthly recurrence are required (USD, yearly, every-2-months, one-off, inactive, LIVE price: refused)',()=>{
 assert.equal(priceMatches(PRICES.price_beta49,'BETA','test'),true);
 for(const bad of [{currency:'usd'},{recurring:{interval:'year',interval_count:1}},{recurring:{interval:'month',interval_count:2}},{type:'one_time',recurring:null},{active:false},{livemode:true}] as Partial<StripePrice>[])
  assert.equal(priceMatches(price('price_beta49',4900,bad),'BETA','test'),false,JSON.stringify(bad));
 assert.deepEqual(CHECKOUT_PRICES,{BETA:{unitAmount:4900,currency:'eur',interval:'month'},PRO:{unitAmount:9900,currency:'eur',interval:'month'}});
});
test('E — an unknown offer is refused before any Stripe call',async()=>{
 for(const body of [{plan:'GOLD'},{plan:''},{plan:'beta'},{plan:'PAID'},{plan:'INTERNAL'},{plan:'TRIAL'},{},null,[],'BETA']){
  const {r,stripe}=await checkout(body);
  assert.equal(r.status,400,JSON.stringify(body));assert.equal(stripe.calls.length,0);
 }
});
test('F — an unauthenticated request never reaches billing: the route sits behind authenticatedDb (401)',async()=>{
 const route=await read('../app/api/v1/[...path]/route.ts');
 const handlerStart=route.indexOf('async function handler(');
 assert.ok(route.indexOf('const {db,user}=await authenticatedDb(request)',handlerStart)<route.indexOf("if(resource==='billing'",handlerStart));
 assert.match(route,/startCheckout\(\{userId:user\.id,email:user\.email\?\?null,body,origin:appOrigin\(request\)\},deps\)/);
 assert.match(route,/openPortal\(\{userId:user\.id,body,origin:appOrigin\(request\)\},deps\)/);
 const db=await read('../src/server/db.ts');
 assert.match(db,/if\(!\/\^Bearer \[\\w\.\\-\]\+\$\/\.test\(authorization\)\)throw new Error\('UNAUTHORIZED'\)/);
 assert.match(route,/code==='UNAUTHORIZED'\?401/);
});
test('G, AC — ENTERPRISE can never be bought through the public checkout, and has no Stripe price',async()=>{
 const {r,stripe}=await checkout({plan:'ENTERPRISE'});
 assert.equal(r.status,400);assert.equal(r.body.code,'ENTERPRISE_QUOTE_ONLY');assert.equal(stripe.calls.length,0);
 assert.equal(Object.hasOwn(config.prices,'ENTERPRISE'),false);
 assert.equal(planForPrice(config,'price_enterprise'),null);
 const env=await read('../.env.example');assert.doesNotMatch(env,/ENTERPRISE/);
});
test('H — the browser cannot inject price_id, amount, currency, customer or any other field',async()=>{
 for(const extra of [{price_id:'price_cheap'},{price:'price_cheap'},{amount:100},{unit_amount:100},{currency:'usd'},{customer:'cus_other'},{customer_id:'cus_other'},{success_url:'https://evil.example'},{quantity:10}]){
  const {r,stripe}=await checkout({plan:'BETA',...extra});
  assert.equal(r.status,400,JSON.stringify(extra));assert.equal(stripe.calls.length,0);
 }
 const page=await read('../app/page.tsx');
 assert.match(page,/api\('billing\/checkout','POST',\{plan\}\)/,'the page sends the offer name only');
});
test('Checkout collects B2B invoicing data (company, billing address, VAT id); automatic tax only when explicitly enabled',async()=>{
 const {stripe}=await checkout({plan:'PRO'});
 const p=stripe.calls.find(c=>c[0]==='session')[1];
 assert.equal(p.billing_address_collection,'required');assert.deepEqual(p.tax_id_collection,{enabled:true});
 assert.deepEqual(p.customer_update,{name:'auto',address:'auto'});assert.equal(p.automatic_tax,undefined);
 assert.equal(p.client_reference_id,USER);assert.deepEqual(p.subscription_data.metadata,{prospectos_user_id:USER,prospectos_plan:'PRO'});
 assert.equal(p.success_url,'https://preview.example.test/?billing=success');
 assert.equal(p.subscription_data.trial_period_days,undefined,'V — no second (Stripe) trial');
 const taxed=await checkout({plan:'PRO'},{cfg:billingConfig({...ENV,STRIPE_AUTOMATIC_TAX:'true'})});
 assert.deepEqual(taxed.stripe.calls.find(c=>c[0]==='session')[1].automatic_tax,{enabled:true});
});
test('Checkout refused while billing is off (Production today), and while a subscription already covers the account',async()=>{
 assert.equal((await checkout({plan:'BETA'},{cfg:null})).r.status,503);
 assert.equal((await checkout({plan:'BETA'},{cfg:billingConfig({...ENV,BILLING_ENABLED:undefined})})).r.status,503);
 for(const status of ['active','past_due','unpaid','trialing','paused']){
  const {r,stripe}=await checkout({plan:'PRO'},{store:fakeStore({[USER]:{stripe_customer_id:'cus_9',subscription_status:status}})});
  assert.equal(r.status,409,status);assert.equal(r.body.code,'SUBSCRIPTION_EXISTS');assert.equal(stripe.calls.some(c=>c[0]==='session'),false);
 }
 const again=await checkout({plan:'PRO'},{store:fakeStore({[USER]:{stripe_customer_id:'cus_9',subscription_status:'canceled'}})});
 assert.equal(again.r.status,200,'a cancelled customer can subscribe again, with the same customer');
 assert.equal(again.stripe.calls.find(c=>c[0]==='session')[1].customer,'cus_9');
 assert.equal(again.stripe.calls.some(c=>c[0]==='customer'),false);
});
test('AE — two checkouts started at the same moment create ONE Stripe customer (idempotency key per user, first link wins)',async()=>{
 const stripe=fakeStripe();const store=fakeStore();const now=Date.parse('2026-10-12T10:00:00Z');
 const [a,b]=await Promise.all([checkout({plan:'BETA'},{stripe,store,now}),checkout({plan:'BETA'},{stripe,store,now})]);
 assert.equal(a.r.status,200);assert.equal(b.r.status,200);
 const customerCalls=stripe.calls.filter(c=>c[0]==='customer');
 assert.ok(customerCalls.every(c=>c[2]===`prospectos-customer-${USER}`));
 assert.equal(new Set(stripe.calls.filter(c=>c[0]==='session').map(c=>c[1].customer)).size,1);
 assert.equal(store.rows.get(USER)!.stripe_customer_id,'cus_1');
 const keys=new Set(stripe.calls.filter(c=>c[0]==='session').map(c=>c[2]));
 assert.equal(keys.size,1,'the same user, offer and 5-minute window reuse one Checkout Session');
});
test('AA — BETA grandfathering: closing the 49 € offer stops NEW checkouts only; the BETA price keeps mapping to BETA',async()=>{
 const closed=billingConfig({...ENV,BILLING_BETA_CHECKOUT_OPEN:'false'})!;
 const {r}=await checkout({plan:'BETA'},{cfg:closed});
 assert.equal(r.status,409);assert.equal(r.body.code,'BETA_OFFER_CLOSED');
 assert.equal((await checkout({plan:'PRO'},{cfg:closed})).r.status,200);
 assert.equal(planForPrice(closed,'price_beta49'),'PAID','existing subscribers keep their plan');
 assert.deepEqual(checkoutAvailability(closed),{BETA:false,PRO:true,portal:true});
 const src=await read('../src/server/billing/webhook.ts');assert.doesNotMatch(src,/betaCheckoutOpen/,'the webhook never looks at the offer being open');
});

// ---------------------------------------------------------------- U: portal
test('U — the Customer Portal opens only for the caller\'s own linked customer; a customer id from the browser is refused',async()=>{
 const stripe=fakeStripe();const store=fakeStore({[USER]:{stripe_customer_id:'cus_own'}});
 const deps={config,stripe:stripe.api,store:store.store};
 const r=await openPortal({userId:USER,body:{},origin:'https://preview.example.test'},deps);
 assert.equal(r.status,200);assert.equal(stripe.calls[0][1].customer,'cus_own');assert.equal(stripe.calls[0][1].return_url,'https://preview.example.test/?billing=portal');
 const forged=await openPortal({userId:USER,body:{customer_id:'cus_victim'},origin:'x'},deps);
 assert.equal(forged.status,400);assert.equal(stripe.calls.length,1);
 const other=await openPortal({userId:'00000000-0000-4000-8000-000000000002',body:{},origin:'x'},deps);
 assert.equal(other.status,404,'a user without a billing account gets nothing (never someone else\'s customer)');
});

// ---------------------------------------------------------------- N: signature
test('N — webhook signature: valid accepted; wrong secret, altered body, missing header, stale timestamp refused',()=>{
 const body='{"id":"evt_1"}';const t=1_800_000_000;
 const header=`t=${t},v1=${signPayload(body,WHSEC,t)}`;
 assert.equal(verifyStripeSignature(body,header,WHSEC,t),true);
 assert.equal(verifyStripeSignature(body,`t=${t},v1=${signPayload(body,'whsec_other',t)}`,WHSEC,t),false);
 assert.equal(verifyStripeSignature(body+' ',header,WHSEC,t),false);
 assert.equal(verifyStripeSignature(body,null,WHSEC,t),false);
 assert.equal(verifyStripeSignature(body,`t=${t}`,WHSEC,t),false);
 assert.equal(verifyStripeSignature(body,header,WHSEC,t+301),false,'older than 5 minutes');
 assert.equal(verifyStripeSignature(body,`t=${t},v1=${'0'.repeat(64)},v1=${signPayload(body,WHSEC,t)}`,WHSEC,t),true,'secret rotation: any v1 may match');
});

// ---------------------------------------------------------------- I–P: webhook → state
const T0=Date.parse('2026-10-12T00:00:00Z')/1000,T1=Date.parse('2026-11-12T00:00:00Z')/1000;
const sub=(over:Partial<StripeSubscription>={},priceId='price_beta49',unit=4900):StripeSubscription=>({
 id:'sub_1',customer:'cus_1',status:'active',cancel_at_period_end:false,livemode:false,
 items:{data:[{price:{id:priceId,unit_amount:unit,currency:'eur',recurring:{interval:'month'}} as any,current_period_start:T0,current_period_end:T1}]},
 latest_invoice:{id:'in_1',status:'paid'},...over});
function signed(event:Record<string,unknown>,secret=WHSEC,t=Math.floor(Date.now()/1000)){const raw=JSON.stringify(event);return {raw,header:`t=${t},v1=${signPayload(raw,secret,t)}`}}
const evt=(type:string,object:Record<string,unknown>,id='evt_1')=>({id,type,livemode:false,data:{object}});
async function deliver(event:Record<string,unknown>,subs:Record<string,StripeSubscription>,opts:{secret?:string;cfg?:typeof config|null}={}){
 const stripe=fakeStripe(PRICES,subs);const store=fakeStore();const {raw,header}=signed(event,opts.secret);
 const r=await handleStripeWebhook(raw,header,{config:opts.cfg===undefined?config:opts.cfg,stripe:stripe.api,store:store.store});
 return {r,stripe,store};
}
test('N — a badly signed webhook is refused (400) before Stripe or the database is touched',async()=>{
 const {r,stripe,store}=await deliver(evt('invoice.paid',{subscription:'sub_1'}),{sub_1:sub()},{secret:'whsec_attacker'});
 assert.equal(r.status,400);assert.equal(stripe.calls.length,0);assert.equal(store.applied.length,0);
 const unconfigured=await deliver(evt('invoice.paid',{subscription:'sub_1'}),{sub_1:sub()},{cfg:billingConfig({...ENV,STRIPE_WEBHOOK_SECRET:undefined})});
 assert.equal(unconfigured.r.status,503);
});
test('I — checkout.session.completed with a payment not confirmed yet: the subscription is linked, never marked paid',async()=>{
 const {r,store}=await deliver(evt('checkout.session.completed',{mode:'subscription',subscription:'sub_1',payment_status:'unpaid'}),{sub_1:sub({status:'incomplete',latest_invoice:{id:'in_1',status:'open'}})});
 assert.equal(r.status,200);assert.equal(store.applied[0].paid,false);assert.equal(store.applied[0].status,'incomplete');
 // Even if the event itself claims "paid", only the invoice re-read from Stripe counts.
 const lying=await deliver(evt('checkout.session.completed',{mode:'subscription',subscription:'sub_1',payment_status:'paid'}),{sub_1:sub({latest_invoice:{id:'in_1',status:'open'}})});
 assert.equal(lying.store.applied[0].paid,false);
});
test('J, K, L — invoice.paid → paid state with the plan of the Stripe price: BETA price → PAID (BETA), PRO price → PRO',async()=>{
 const beta=await deliver(evt('invoice.paid',{subscription:'sub_1'}),{sub_1:sub()});
 assert.deepEqual({...beta.store.applied[0]},{eventId:'evt_1',eventType:'invoice.paid',customerId:'cus_1',subscriptionId:'sub_1',priceId:'price_beta49',plan:'PAID',status:'active',periodStart:'2026-10-12T00:00:00.000Z',periodEnd:'2026-11-12T00:00:00.000Z',cancelAtPeriodEnd:false,paid:true});
 const pro=await deliver(evt('invoice.paid',{parent:{subscription_details:{subscription:'sub_1'}}}),{sub_1:sub({},'price_pro99',9900)});
 assert.equal(pro.store.applied[0].plan,'PRO','the 2025+ invoice shape (parent.subscription_details) is read too');
 assert.equal(commercialPlan('PAID'),'BETA');assert.equal(commercialPlan('PRO'),'PRO');
});
test('M — an unknown price (or a known id at the wrong amount, or several items) grants no plan',async()=>{
 assert.equal((await deliver(evt('invoice.paid',{subscription:'sub_1'}),{sub_1:sub({},'price_other',4900)})).store.applied[0].plan,null);
 assert.equal((await deliver(evt('invoice.paid',{subscription:'sub_1'}),{sub_1:sub({},'price_beta49',100)})).store.applied[0].plan,null);
 const two=sub();two.items.data.push({...two.items.data[0]});
 assert.equal((await deliver(evt('invoice.paid',{subscription:'sub_1'}),{sub_1:two})).store.applied[0].plan,null);
});
test('P, Q — customer.subscription.updated carries status, period and cancel_at_period_end (item-level and legacy period fields)',async()=>{
 const {store}=await deliver(evt('customer.subscription.updated',{id:'sub_1'}),{sub_1:sub({status:'past_due',cancel_at_period_end:true})});
 assert.equal(store.applied[0].status,'past_due');assert.equal(store.applied[0].cancelAtPeriodEnd,true);
 const legacy=sub({current_period_start:T0,current_period_end:T1});delete (legacy.items.data[0] as any).current_period_start;delete (legacy.items.data[0] as any).current_period_end;
 assert.equal(subscriptionState(legacy,config,{id:'evt_2',type:'x'}).periodEnd,'2026-11-12T00:00:00.000Z');
});
test('Webhook: TEST/LIVE mismatch refused, unhandled types acknowledged without effect, Stripe failure → 5xx (retried)',async()=>{
 const live=await deliver({...evt('invoice.paid',{subscription:'sub_1'}),livemode:true},{sub_1:sub()});
 assert.equal(live.r.status,400);assert.equal(live.store.applied.length,0);
 const other=await deliver(evt('customer.created',{id:'cus_1'}),{});
 assert.equal(other.r.status,200);assert.equal(other.r.body.ignored,true);assert.equal(other.stripe.calls.length,0);
 await assert.rejects(deliver(evt('invoice.paid',{subscription:'sub_missing'}),{}),/STRIPE_REQUEST_FAILED/);
 assert.deepEqual([...HANDLED_EVENTS].sort(),['checkout.session.completed','customer.subscription.created','customer.subscription.deleted','customer.subscription.updated','invoice.paid','invoice.payment_failed']);
 assert.equal(subscriptionIdOf(evt('checkout.session.completed',{mode:'payment',subscription:null}) as any),null);
});

// ---------------------------------------------------------------- configuration locks
test('Configuration — TEST key never on Production, LIVE key only on Production with an explicit opt-in',()=>{
 assert.equal(stripeMode(KEY),'test');assert.equal(stripeMode(LIVE_KEY),'live');assert.equal(stripeMode('pk_test_x'),null);assert.equal(stripeMode(undefined),null);
 assert.equal(billingConfig({...ENV,VERCEL_ENV:'production'}),null,'the sandbox cannot be reached from Production');
 assert.equal(billingConfig({...ENV,STRIPE_SECRET_KEY:LIVE_KEY}),null,'no LIVE key outside Production');
 assert.equal(billingConfig({...ENV,STRIPE_SECRET_KEY:LIVE_KEY,VERCEL_ENV:'production'}),null,'no LIVE without BILLING_ALLOW_LIVE');
 assert.equal(billingConfig({...ENV,STRIPE_SECRET_KEY:LIVE_KEY,VERCEL_ENV:'production',BILLING_ALLOW_LIVE:'true'})?.mode,'live');
 assert.equal(billingConfig({...ENV,STRIPE_PRICE_BETA:'49'})!.prices.BETA,null);
 assert.deepEqual(checkoutAvailability(null),{BETA:false,PRO:false,portal:false});
 assert.deepEqual(checkoutAvailability(billingConfig({...ENV,BILLING_ENABLED:undefined})),{BETA:false,PRO:false,portal:true});
});
test('Stripe client — form encoding, pinned API version, secret only in the Authorization header, Stripe messages not echoed',async()=>{
 assert.equal(formEncode({line_items:[{price:'price_1',quantity:1}],metadata:{a:'b c'},expand:['latest_invoice']}),'line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Ba%5D=b%20c&expand%5B0%5D=latest_invoice');
 const seen:any[]=[];
 const fake=(async(url:string,init:any)=>{seen.push([url,init]);return new Response(JSON.stringify(url.includes('fail')?{error:{type:'invalid_request_error',message:'No such price: price_fail'}}:{id:'price_ok'}),{status:url.includes('fail')?404:200})}) as unknown as typeof fetch;
 const client=createStripeClient(KEY,fake);
 await client.retrievePrice('price_ok');
 assert.equal(seen[0][0],'https://api.stripe.com/v1/prices/price_ok');
 assert.equal(seen[0][1].headers.Authorization,`Bearer ${KEY}`);assert.equal(seen[0][1].headers['Stripe-Version'],'2025-03-31.basil');
 await assert.rejects(client.retrievePrice('price_fail'),(e:Error)=>e.message==='STRIPE_REQUEST_FAILED'&&!e.message.includes('No such'));
 await assert.rejects(client.retrievePrice('../customers'),/INVALID_STRIPE_ID/);
});

// ---------------------------------------------------------------- V–Y, AB: plans and quotas
test('V, W, X, Y — TRIAL 20/50/5 (ProspectOS, no Stripe), BETA 100/250/25, PRO 300/750/75 — same numbers as the migrations',async()=>{
 assert.deepEqual(PLAN_QUOTAS,{TRIAL:{discovery:20,analysis:50,aiOffer:5},BETA:{discovery:100,analysis:250,aiOffer:25},PRO:{discovery:300,analysis:750,aiOffer:75}});
 assert.deepEqual(PLAN_QUOTAS.TRIAL,BETA_OFFER.trial);assert.deepEqual(PLAN_QUOTAS.BETA,BETA_OFFER.paid);
 const m17=await read('../db/migrations/017_stripe_billing.sql');
 for(const [c,v] of [['pro_discovery_limit',300],['pro_analysis_limit',750],['pro_ai_offer_limit',75]] as const)assert.match(m17,new RegExp(`${c} int not null default ${v}`));
 const trial=await read('../db/migrations/012_beta_self_service_trial.sql');
 assert.match(trial,/values\(actor,'BETA','ACTIVE',now\(\),now\(\)\+interval '7 days',now\(\)\)/,'the 7-day trial is still created by ProspectOS itself');
 for(const f of ['config.ts','checkout.ts','webhook.ts'])assert.doesNotMatch(await read(`../src/server/billing/${f}`),/trial_period_days|trial_end/,'no Stripe trial');
});
test('AB — existing accounts keep their database plan values; every one maps to a commercial plan',()=>{
 assert.deepEqual(DB_TO_COMMERCIAL,{BETA:'TRIAL',PAID:'BETA',PRO:'PRO',ENTERPRISE:'ENTERPRISE',INTERNAL:'INTERNAL'});
 const NOW=Date.parse('2026-10-20T00:00:00Z');
 const legacyPaid={plan:'PAID',status:'ACTIVE',period_start:'2026-10-12T00:00:00Z',period_end:'2026-11-12T00:00:00Z',active:true,discovery_used:1,discovery_limit:100,analysis_used:2,analysis_limit:250,ai_offer_used:0,ai_offer_limit:25};
 assert.equal(usageView(legacyPaid,NOW)!.kind,'paid');
 assert.equal(usageView({...legacyPaid,plan:'PRO',discovery_limit:300},NOW)!.discovery.limit,300);
 assert.equal(usageView({...legacyPaid,plan:'BETA'},NOW)!.kind,'trial');
 assert.equal(usageView({plan:'INTERNAL',status:'ACTIVE'},NOW),null);
});

// ---------------------------------------------------------------- AG: no secret in the browser
async function files(dir:URL,out:string[]=[]):Promise<string[]>{
 for(const e of await readdir(dir,{withFileTypes:true})){const u=new URL(e.name+(e.isDirectory()?'/':''),dir);if(e.isDirectory())await files(u,out);else out.push(u.pathname)}
 return out;
}
test('AG — no Stripe key, webhook secret or billing server module can reach the client bundle',async()=>{
 const client=[...await files(new URL('../src/components/',import.meta.url)),...await files(new URL('../src/i18n/',import.meta.url)),...await files(new URL('../src/domain/',import.meta.url)),new URL('../app/page.tsx',import.meta.url).pathname];
 for(const f of client){
  const src=await readFile(f,'utf8');
  assert.doesNotMatch(src,/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|sk_(test|live)_|rk_(test|live)_|whsec_|server\/billing|process\.env\.STRIPE/,f);
 }
 for(const f of await files(new URL('../src/server/billing/',import.meta.url)))assert.doesNotMatch(await readFile(f,'utf8'),/^'use client'/m,f);
 assert.doesNotMatch(await read('../src/server/billing/config.ts'),/NEXT_PUBLIC_/,'no billing value is exposed as NEXT_PUBLIC_');
 const env=await read('../.env.example');
 for(const k of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRICE_BETA','STRIPE_PRICE_PRO'])assert.match(env,new RegExp(`^${k}=$`,'m'),`${k} is listed empty`);
 // After `next build`: the static client chunks contain no key-shaped value, and not the configured key itself.
 const staticDir=new URL('../.next/static/',import.meta.url);
 if(await stat(staticDir).then(()=>true,()=>false)){
  const secret=process.env.STRIPE_SECRET_KEY;
  for(const f of await files(staticDir)){
   if(!/\.(js|css|html|json)$/.test(f))continue;
   const src=await readFile(f,'utf8');
   assert.doesNotMatch(src,/sk_(test|live)_[A-Za-z0-9]{8,}|rk_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/,f);
   if(secret)assert.equal(src.includes(secret),false,`${f} contains the configured Stripe key`);
  }
 }
});
