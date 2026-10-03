// Demo / billing UX: plan intent (demo → account → the right offer), the shared pricing component, the
// subscriber guard, and the client-side billing invariants (offer name only, server decides everything).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PLAN_INTENT_KEY,parsePlanIntent,readPlanIntent,savePlanIntent,clearPlanIntent,decidePlanIntent,hasCurrentSubscription,type StorageLike} from '../src/domain/plan-intent.ts';
import {OFFERS,offerFor,offerForDbPlan} from '../src/domain/offers.ts';
import {PLAN_QUOTAS,CHECKOUT_PRICES} from '../src/domain/plans.ts';
import {startCheckout} from '../src/server/billing/checkout.ts';
import {billingConfig} from '../src/server/billing/config.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {DEMO_ONBOARDING_STEPS,DEMO_ONBOARDING_STEPS_EN,DEMO_ONBOARDING_TITLES,DEMO_ONBOARDING_TITLES_EN} from '../src/domain/demo.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const page=await read('../app/page.tsx');
const pricing=await read('../src/components/PricingPlans.tsx');
const billingSection=await read('../src/components/BillingSection.tsx');
const fn=(name:string)=>{const i=page.indexOf(name);assert.ok(i>=0,`${name} not found`);return page.slice(i,page.indexOf('\n',i))};

function memoryStorage(initial:Record<string,string>={}):StorageLike&{data:Map<string,string>}{
 const data=new Map(Object.entries(initial));
 return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,String(v))},removeItem:k=>{data.delete(k)}};
}
const OPEN={BETA:true,PRO:true,portal:true};
const CLOSED={BETA:false,PRO:false,portal:false};

// ---------------------------------------------------------------- plan intent: storage
test('plan intent accepts only BETA and PRO; anything else is dropped and removed',()=>{
 assert.equal(parsePlanIntent('BETA'),'BETA');assert.equal(parsePlanIntent('PRO'),'PRO');
 for(const bad of ['ENTERPRISE','beta','price_123','4900','{"plan":"PRO"}','',null,undefined,49])assert.equal(parsePlanIntent(bad),null,String(bad));
 const s=memoryStorage({[PLAN_INTENT_KEY]:'price_abc'});
 assert.equal(readPlanIntent(s),null);assert.equal(s.data.has(PLAN_INTENT_KEY),false,'an invalid stored value is forgotten');
 assert.equal(savePlanIntent(s,'ENTERPRISE'),null);assert.equal(s.data.size,0);
 assert.equal(savePlanIntent(s,'PRO'),'PRO');assert.equal(s.data.get(PLAN_INTENT_KEY),'PRO');
 assert.equal(PLAN_INTENT_KEY,'prospectos-plan-intent-v1');
});
test('plan intent never breaks the page when storage is unavailable',()=>{
 const broken:StorageLike={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}};
 assert.equal(readPlanIntent(broken),null);assert.equal(savePlanIntent(broken,'BETA'),null);assert.doesNotThrow(()=>clearPlanIntent(broken));
 assert.equal(readPlanIntent(null),null);
});

// ---------------------------------------------------------------- journeys (pure, same functions as the page)
for(const plan of ['BETA','PRO'] as const){
 test(`demo → choose ${plan} → sign-up → confirmation e-mail → sign-in → checkout for ${plan} (and the intent is gone)`,async()=>{
  const storage=memoryStorage();
  savePlanIntent(storage,plan);                                  // demo click: intent only, no network
  assert.equal(readPlanIntent(storage),plan,'survives the sign-up screen');
  assert.equal(readPlanIntent(storage),plan,'survives the confirmation e-mail round trip (same browser)');
  // Signed in: the server's account answer decides.
  const decision=decidePlanIntent(readPlanIntent(storage),OPEN,{has_customer:false});
  assert.deepEqual(decision,{action:'CHECKOUT',plan});
  // The page sends exactly { plan } — and the real server handler accepts it and charges the configured price.
  const calls:any[]=[];
  const deps={config:billingConfig({STRIPE_SECRET_KEY:['sk','test','unitfake000'].join('_'),STRIPE_PRICE_BETA:'price_beta49',STRIPE_PRICE_PRO:'price_pro99',BILLING_ENABLED:'true',VERCEL_ENV:'preview'}),
   stripe:{retrievePrice:async(id:string)=>({id,active:true,currency:'eur',unit_amount:id==='price_beta49'?4900:9900,livemode:false,recurring:{interval:'month',interval_count:1},type:'recurring'}),
    createCustomer:async()=>({id:'cus_1'}),createCheckoutSession:async(p:any)=>{calls.push(p);return {id:'cs_1',url:'https://checkout.stripe.com/c/pay/cs_1'}},
    createPortalSession:async()=>({url:'https://billing.stripe.com/p/1'}),retrieveSubscription:async()=>{throw Error('x')}},
   store:{getAccount:async()=>null,linkCustomer:async(_u:string,id:string)=>id}} as any;
  const result=await startCheckout({userId:'00000000-0000-4000-8000-000000000001',email:null,body:{plan},origin:'https://example.test'},deps);
  assert.equal(result.status,200);
  assert.equal(calls[0].line_items[0].price,plan==='BETA'?'price_beta49':'price_pro99','the server picks the price of THIS offer');
  clearPlanIntent(storage);                                      // page: cleared once the hosted page URL exists
  assert.equal(readPlanIntent(storage),null);
  assert.deepEqual(decidePlanIntent(readPlanIntent(storage),OPEN,{has_customer:false}),{action:'NONE'},'back from the payment page: nothing re-opens (no loop)');
 });
}
test('existing subscriber → portal, never a second checkout (same states as the server guard)',()=>{
 for(const status of ['active','trialing','past_due','unpaid','paused'])
  assert.deepEqual(decidePlanIntent('PRO',OPEN,{has_customer:true,plan:'PAID',status}),{action:'SUBSCRIBED'},status);
 assert.deepEqual(decidePlanIntent('BETA',OPEN,{has_customer:true,plan:'PAID',status:'canceled'}),{action:'CHECKOUT',plan:'BETA'},'an ended subscription can subscribe again');
 assert.equal(hasCurrentSubscription({has_customer:false,status:'active'}),false);
});
test('offer unavailable on this deployment (or no server answer) → no checkout',()=>{
 assert.deepEqual(decidePlanIntent('BETA',CLOSED,{has_customer:false}),{action:'UNAVAILABLE',plan:'BETA'});
 assert.deepEqual(decidePlanIntent('PRO',{BETA:true,PRO:false,portal:true},null),{action:'UNAVAILABLE',plan:'PRO'});
 assert.deepEqual(decidePlanIntent('PRO',null,null),{action:'UNAVAILABLE',plan:'PRO'},'availability is only what the server said');
 assert.deepEqual(decidePlanIntent(null,OPEN,null),{action:'NONE'});
});

// ---------------------------------------------------------------- page wiring
test('demo/visitor click records the intent and leaves the demo; it never calls the payment route',()=>{
 const choose=fn('function choosePlan(');
 const visitor=choose.slice(choose.indexOf('return}')+7);
 assert.match(visitor,/savePlanIntent\(browserStorage\(\),plan\)/);
 assert.match(visitor,/if\(mode==='demo'\)\{clearWorkspace\(\);setMode\('welcome'\)\}/);
 assert.doesNotMatch(visitor,/api\(|startCheckout|fetch\(/,'no network call for a visitor');
 assert.match(choose,/if\(mode==='live'\)\{setModal\(''\);void work\(\(\)=>startCheckout\(plan\)\);return\}/,'LIVE → BETA/PRO goes straight to startCheckout(plan)');
});
test('the welcome screen shows the chosen offer during sign-up, confirmation and sign-in',()=>{
 const welcome=page.match(/if\(mode==='welcome'\)return <main className="welcome">[\s\S]*?<\/main>;/)![0];
 assert.match(welcome,/<section className="login card">\{planIntent&&<div className="plan-intent" role="status"><p>\{tr\('offers\.selected'\)\} <b>\{tr\(planIntent==='BETA'\?'billing\.betaName':'billing\.proName'\)\}<\/b>/,'shown above the sign-up form, the check-email screen and the sign-in form alike');
 assert.equal(fr['offers.selected'],'Offre choisie :');assert.equal(fr['billing.betaName'],'ProspectOS Bêta');assert.equal(fr['billing.proName'],'ProspectOS Pro B2B');
});
test('the intent is acted on once, after the authenticated account answer, and only through startCheckout',()=>{
 const resume=fn('async function resumePlanIntent(');
 assert.match(resume,/if\(!intent\|\|!acc\|\|intentHandled\.current\)return;intentHandled\.current=true;/,'no answer → nothing; never twice per session');
 assert.match(resume,/decidePlanIntent\(intent,acc\.billing_offers,acc\.billing\)/,'decided on the server answer only');
 assert.match(resume,/if\(decision\.action==='CHECKOUT'\)\{try\{await startCheckout\(decision\.plan,t\)\}catch\(e\)\{forgetPlanIntent\(\);/,'a refused checkout forgets the intent (no retry loop)');
 assert.match(page,/await loadAccount\(t\);\n setMode\('live'\);void resumePlanIntent\(t\)/,'after a sign-in, with the session token (React state is not updated yet in this closure)');
 assert.match(page,/setMode\('live'\);if\(AUTH_RETURN==='CONFIRMED'[^\n]*void resumePlanIntent\(t\)\}catch/,'after the confirmation link / reload');
 assert.match(page,/async function loadAccount\(t=token\)\{try\{\n const acc=await api\('account','GET',undefined,t\);lastAccount\.current=acc;/);
});
test('the intent is removed only once the hosted payment page URL was returned',()=>{
 assert.match(fn('async function startCheckout('),/^async function startCheckout\(plan:'BETA'\|'PRO',t=token\)\{const \{url\}=await api\('billing\/checkout','POST',\{plan\},t\);if\(typeof url==='string'\)\{clearPlanIntent\(browserStorage\(\)\);setPlanIntent\(null\);window\.location\.assign\(url\)\}\}$/);
});
test('back from the payment page: a notice only — no checkout, no access granted by the browser, no intent read',()=>{
 const ret=page.slice(page.indexOf("new URLSearchParams(window.location.search).get('billing')")-40,page.indexOf("new URLSearchParams(window.location.search).get('billing')")+420);
 assert.doesNotMatch(ret,/startCheckout|api\(|PlanIntent|setEntitlementPlan|setBetaActive/);
});
test('demo reset and logout never touch the auth session nor the stored intent',()=>{
 const reset=page.match(/function resetDemo\(\)\{[^}]*\}/)![0];
 assert.doesNotMatch(reset,/PLAN_INTENT|plan-intent|signOut|setToken|identity/);
 const logout=page.match(/async function logout\(\)\{.*\}/)![0];
 assert.doesNotMatch(logout,/removeItem|clearPlanIntent/);
});

// ---------------------------------------------------------------- pricing source of truth + component
test('offers derive from the server-checked prices and the database quotas (no second copy)',()=>{
 assert.deepEqual(OFFERS.map(o=>o.id),['BETA','PRO','ENTERPRISE']);
 assert.equal(offerFor('BETA').priceEurExclVatPerMonth,CHECKOUT_PRICES.BETA.unitAmount/100);
 assert.equal(offerFor('PRO').priceEurExclVatPerMonth,99);assert.equal(offerFor('BETA').priceEurExclVatPerMonth,49);
 assert.deepEqual(offerFor('BETA').quotas,PLAN_QUOTAS.BETA);assert.deepEqual(offerFor('PRO').quotas,{discovery:300,analysis:750,aiOffer:75});
 assert.equal(OFFERS[2].checkoutPlan,null,'ENTERPRISE is never buyable online');assert.equal(OFFERS[2].priceEurExclVatPerMonth,null);
 assert.equal(offerForDbPlan('PAID')?.id,'BETA');assert.equal(offerForDbPlan('PRO')?.id,'PRO');assert.equal(offerForDbPlan('BETA'),null,'the trial is not a subscription');
 // Remaining public copy that still spells the BETA numbers matches the same source.
 assert.match(fr['pricing.price'],/^49 € HT/);assert.match(fr['pricing.paidLimits'],/100 Discovery · 250 analyses prospects · 25 analyses d’offre IA/);
});
test('the pricing component renders amounts and quotas from OFFERS only, with the agreed CTAs and no ranking claim',()=>{
 assert.match(pricing,/OFFERS\.map\(/);
 assert.doesNotMatch(pricing,/\b(49|99|100|250|300|750)\b/,'no amount or quota typed in the component');
 for(const [k,v] of [['offers.chooseBeta','Choisir Bêta'],['offers.choosePro','Choisir Pro'],['offers.contact','Nous contacter'],['offers.badgeEarly','Premiers utilisateurs'],['offers.perMonth','HT / mois'],['offers.onQuote','Sur devis']])assert.equal(fr[k as keyof typeof fr],v);
 for(const v of [...Object.values(fr),...Object.values(en)])assert.doesNotMatch(v,/meilleur choix|le plus populaire|most popular|best choice|best value/i);
 assert.match(pricing,/onClick=\{\(\)=>onChoose\(plan\)\}/,'a click hands back the offer name only');
 assert.match(pricing,/disabled=\{busy\|\|!available\}/,'account context: not buyable on this deployment → disabled');
 assert.match(pricing,/available=plan\?\(context==='public'\|\|availability\?\.\[plan\]===true\):false/);
});
test('the account billing block: subscriber → summary + portal, no pricing cards; manual plans see no cards',()=>{
 assert.match(billingSection,/const showPlans=!view\?\.current&&entitlementPlan!=='INTERNAL'&&entitlementPlan!=='ENTERPRISE';/);
 assert.match(billingSection,/view\.manage==='portal'/,'manage button driven by the server availability (see the subscription management tests)');
 assert.match(billingSection,/<PricingPlans locale=\{locale\} context="account" availability=\{offers\}/,'same component as the demo');
 assert.match(page,/<PricingPlans locale=\{locale\} context=\{mode==='live'\?'account':'public'\} availability=\{mode==='live'\?billingOffers:null\}/);
});

// ---------------------------------------------------------------- client-side billing invariants
test('no price id, amount, currency, customer or provider key in any client file; the page sends { plan } only',async()=>{
 for(const src of [page,pricing,billingSection,await read('../src/domain/offers.ts'),await read('../src/domain/plan-intent.ts'),await read('../src/components/DemoMission.tsx')]){
  assert.doesNotMatch(src,/price_[A-Za-z0-9]{3,}|unit_amount|stripe_customer|cus_[A-Za-z0-9]|sk_(test|live)|pk_(test|live)|checkout\.stripe\.com/i);
 }
 const calls=[...page.matchAll(/api\('billing\/checkout','POST',([^)]*)\)/g)].map(m=>m[1]);
 assert.deepEqual(calls,['{plan},t']);
});

// ---------------------------------------------------------------- demo presentation, unchanged substance
test('onboarding: same 7 factual steps, plus 7 short titles in both languages',()=>{
 assert.equal(DEMO_ONBOARDING_STEPS.length,7);assert.equal(DEMO_ONBOARDING_TITLES.length,7);assert.equal(DEMO_ONBOARDING_TITLES_EN.length,7);assert.equal(DEMO_ONBOARDING_STEPS_EN.length,7);
 assert.equal(DEMO_ONBOARDING_STEPS[2],'Les observations ne deviennent pas automatiquement des preuves.');
 assert.equal(DEMO_ONBOARDING_STEPS[6],'L’envoi reste humain.');
});
test('demo mission header: honest disclaimer, the 5-step process, and the upgrade entry opens the pricing dialog',async()=>{
 const mission=await read('../src/components/DemoMission.tsx');
 assert.doesNotMatch(mission,/api\(|fetch\(/);
 assert.equal(fr['demoMission.objective'],'Identifier et qualifier des établissements pertinents à partir de signaux publics.');
 assert.deepEqual(['step1','step2','step3','step4','step5'].map(k=>fr[`demoMission.${k}` as keyof typeof fr]),['Découvrir','Documenter','Vérifier','Scorer','Préparer l’approche']);
 assert.match(fr['demoMission.disclaimer'],/non clientes/);assert.match(fr['demoMission.disclaimer'],/Aucune recherche web ni analyse de site en direct, aucun message envoyé/);
 assert.match(page,/\{mode==='demo'&&<DemoMission locale=\{locale\} missionName=\{project\?\.name\?\?DEMO_PROJECT\.name\}[^\n]*?onUpgrade=\{\(\)=>setModal\('pricing'\)\}\/>\}/);
});
test('the pricing dialog is the only dialog open when it is shown (the generic workspace dialog excludes it)',()=>{
 assert.match(page,/\{modal&&modal!=='account'&&modal!=='delete-account'&&modal!=='byok-anthropic'&&modal!=='pricing'&&<div className="modal-backdrop"/);
});
test('prospect header: status and evidence coverage are written out, never colour-only',()=>{
 assert.match(page,/<span className="status">\{tr\('detail\.statusLabel'\)\} : \{statusLabel\(current\.status,locale\)\}<\/span><span className="detail-coverage">\{tr\('detail\.coverageShort'\)\} : <b>\{scored\.coverage\}%<\/b><\/span>/);
});
test('no copy announces live payment or automated sending',()=>{
 for(const v of [...Object.values(fr),...Object.values(en)]){
  assert.doesNotMatch(v,/paiement réel|paiement activé|live payment|payment is live|envoi automatique activé|sends automatically/i);
 }
});

// ---------------------------------------------------------------- final mobile polish
test('account: a current subscription is ONE block; Accès / Utilisation are kept for everyone else',()=>{
 assert.match(page,/const subscribed=hasCurrentSubscription\(billingStatus\);/);
 assert.match(page,/\{!subscribed&&<div className="account-field plan-identity"><span className="muted">\{tr\('account\.access'\)\}<\/span><p className="plan-identity-name">/);
 assert.match(page,/\{!subscribed&&usage&&<div className="account-field usage"><span className="muted">\{tr\('account\.usage'\)\}<\/span>/);
 assert.match(page,/<BillingSection locale=\{locale\} offers=\{billingOffers\} status=\{billingStatus\} busy=\{busy\} usage=\{usage\}[^\n]*?onPortal=\{openBillingPortal\}\/>/);
 assert.match(billingSection,/<p className="subscription-offer">\{tr\(view\.offer==='BETA'\?'account\.usagePaid':'account\.usagePro'\)\}<\/p>/,'offer named once, inside the block');
 assert.equal(fr['billing.currentTitle'],'Votre abonnement');
});
test('demo help: the 7 steps stay visible; the score note and the 4 live limitations stay present, folded',()=>{
 assert.match(page,/<ol className="onboarding-steps"[^>]*>\{\(locale==='fr'\?DEMO_ONBOARDING_STEPS:DEMO_ONBOARDING_STEPS_EN\)\.map/);
 assert.match(page,/<details className="demo-help-more"><summary>\{tr\('demoHelp\.moreSummary'\)\}<\/summary><p className="muted">\{tr\('demoHelp\.zeroScore'\)\}<\/p><ul className="muted">\{\(locale==='fr'\?DEMO_LIVE_LIMITATIONS:DEMO_LIVE_LIMITATIONS_EN\)\.map/);
 assert.ok(fr['demoHelp.moreSummary']&&en['demoHelp.moreSummary']);
});

// ---------------------------------------------------------------- subscription management access
import {subscriptionView} from '../src/domain/subscription-view.ts';
const END='2026-10-28T10:00:00Z';
test('PAID active subscription → "Gérer mon abonnement" through the portal',()=>{
 const v=subscriptionView({has_customer:true,plan:'PAID',status:'active',cancel_at_period_end:false,current_period_end:END},OPEN)!;
 assert.deepEqual(v,{offer:'BETA',status:'active',current:true,cancelScheduled:false,date:{kind:'renews',iso:END},manage:'portal'});
});
test('cancel_at_period_end → button still there, access kept until current_period_end',()=>{
 const v=subscriptionView({has_customer:true,plan:'PAID',status:'active',cancel_at_period_end:true,current_period_end:END},OPEN)!;
 assert.equal(v.manage,'portal');assert.equal(v.cancelScheduled,true);assert.deepEqual(v.date,{kind:'ends',iso:END});
 assert.equal(fr['billing.cancelScheduled'],'Abonnement résilié : accès maintenu jusqu’au');
 for(const status of ['trialing','past_due','unpaid','paused'])assert.equal(subscriptionView({has_customer:true,plan:'PRO',status},OPEN)!.manage,'portal',status);
});
test('portal not configured on this deployment → explicit message, never a dead button',()=>{
 const v=subscriptionView({has_customer:true,plan:'PAID',status:'active',cancel_at_period_end:true,current_period_end:END},{BETA:false,PRO:false,portal:false})!;
 assert.equal(v.manage,'unavailable');
 assert.match(billingSection,/\{view\.manage==='portal'\n?\s*\?<button type="button" className="primary subscription-manage"[^>]*onClick=\{manage\}>\{tr\('billing\.manage'\)\}<\/button>\n?\s*:<p className="subscription-unavailable" role="note">\{tr\('billing\.portalUnavailable'\)\}/);
 assert.match(fr['billing.portalUnavailable'],/n’est pas disponible/);assert.ok(en['billing.portalUnavailable']);
 assert.doesNotMatch(fr['plan.subscribedNotice'],/Gérer mon abonnement/,'the notice never points to a button that may not exist');
});
test('no subscription → no subscription block, no manage button',()=>{
 assert.equal(subscriptionView({has_customer:false},OPEN),null);
 assert.equal(subscriptionView(null,OPEN),null);
 assert.equal(subscriptionView({has_customer:true,status:null},OPEN),null);
 assert.match(billingSection,/\{view&&<section className="subscription-card"/,'the button lives only inside the subscription block');
 assert.equal((billingSection.match(/tr\('billing\.manage'\)/g)??[]).length,1);
});
test('click → existing portal route; the URL comes from the server, never built by the browser',async()=>{
 assert.match(page,/async function openBillingPortal\(\)\{const \{url\}=await api\('billing\/portal','POST',\{\}\);if\(typeof url==='string'\)window\.location\.assign\(url\)\}/);
 assert.match(billingSection,/async function manage\(\)\{setOpening\(true\);setPortalError\(''\);try\{await onPortal\(\)\}catch\(e\)\{setPortalError/,'a refusal is shown inside the account dialog');
 for(const src of [page,billingSection,await read('../src/domain/subscription-view.ts')])assert.doesNotMatch(src,/billing\.stripe\.com|checkout\.stripe\.com|https:\/\/[a-z.]*stripe/i);
});
test('subscribed → no second checkout: pricing cards hidden, intent decision SUBSCRIBED',()=>{
 assert.match(billingSection,/const showPlans=!view\?\.current&&entitlementPlan!=='INTERNAL'&&entitlementPlan!=='ENTERPRISE';/);
 assert.equal(subscriptionView({has_customer:true,plan:'PAID',status:'active',cancel_at_period_end:true,current_period_end:END},OPEN)!.current,true);
 assert.deepEqual(decidePlanIntent('PRO',OPEN,{has_customer:true,plan:'PAID',status:'active',cancel_at_period_end:true}),{action:'SUBSCRIBED'});
 assert.equal(subscriptionView({has_customer:true,plan:'PAID',status:'canceled'},OPEN)!.current,false,'an ended subscription may subscribe again');
});
