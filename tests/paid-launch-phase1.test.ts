import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// ============================================================
// Paid launch — phase 1 (commercial layer, Stripe LIVE not activated). What a visitor and a user read and where
// each commercial refusal leads: pricing and trial copy, no "bêta" left in user-facing text, a route to the offers
// on every commercial refusal, the Team intent bug, a safe /tarifs call to action, real contact links, AI outreach
// still off by default, and Stripe LIVE still impossible without its explicit gate.
// ============================================================

const {fr}=await import('../src/i18n/fr.ts');
const {en}=await import('../src/i18n/en.ts');
const {PLAN_QUOTAS,CHECKOUT_PRICES,TEAM_PRICING}=await import('../src/domain/plans.ts');
const {getSeoPage}=await import('../src/domain/seo.ts');
const {paywallReasonForCode,paywallReasonForAccount}=await import('../src/domain/paywall.ts');
const {CONTACT_EMAIL,CONTACT_MAILTO}=await import('../src/domain/contact.ts');
const {EDITOR}=await import('../src/domain/legal.ts');
const {aiOutreachEnabled}=await import('../src/outreach/ai-switch.ts');
const {billingConfig,checkoutAvailability}=await import('../src/server/billing/config.ts');
const read=(f:string)=>readFile(new URL(f,import.meta.url),'utf8');
const page=await read('../app/page.tsx');
const pricingPage=await read('../src/components/PricingPage.tsx');
const pricingPlans=await read('../src/components/PricingPlans.tsx');
const billingSection=await read('../src/components/BillingSection.tsx');
const tarifsRoute=await read('../app/tarifs/page.tsx');
const welcome=page.match(/if\(mode==='welcome'\)return <main className="welcome">[\s\S]*?<\/main>;/)![0];

// ---------------------------------------------------------------- pricing copy
test('pricing — /tarifs states Solo 49 € and Pro 99 € per month, the trial, Team second, all read from plans.ts',()=>{
 const t=getSeoPage('tarifs');const all=JSON.stringify(t);
 assert.equal(CHECKOUT_PRICES.BETA.unitAmount,4900);assert.equal(CHECKOUT_PRICES.PRO.unitAmount,9900);
 assert.match(t.h1,/7 jours gratuitement, puis choisissez Solo ou Pro/);
 assert.ok(all.includes('ProspectOS Solo — 49 € par mois')&&all.includes('ProspectOS Pro — 99 € par mois'));
 assert.ok(all.includes(`${PLAN_QUOTAS.BETA.discovery} recherches de prospects`)&&all.includes(`${PLAN_QUOTAS.PRO.discovery} recherches de prospects`));
 assert.doesNotMatch(t.title,/Entreprise/,'the Enterprise offer is not promoted in the title');
 assert.doesNotMatch(all,/Entreprise \/ White Label — sur devis/,'no Enterprise line in the offers list');
 // The offers block itself: amounts and quotas only from plans.ts, Solo then Pro, Team as a secondary line.
 assert.match(pricingPage,/import \{CHECKOUT_PRICES,PLAN_QUOTAS,TEAM_PRICING,type Quotas\} from '\.\.\/domain\/plans';/);
 assert.doesNotMatch(pricingPage.replace('cents/100',''),/\b(49|99|179|100|250|300|750)\b/,'no amount or quota typed in the offers block');
 assert.ok(pricingPage.indexOf('ProspectOS Solo')<pricingPage.indexOf('ProspectOS Pro')&&pricingPage.indexOf('ProspectOS Pro')<pricingPage.indexOf('ProspectOS Équipe'));
 assert.match(pricingPage,/className="pricing-team"/,'Team is a line under the two cards, not a card');
 assert.match(tarifsRoute,/<PublicSeoPage page=\{page\}><PricingPage\/><\/PublicSeoPage>/);
 assert.equal(TEAM_PRICING.baseAmount,17900);
});
test('pricing — Solo vs Pro: who each plan is for is said plainly',()=>{
 assert.match(pricingPage,/Pour une personne qui prospecte régulièrement : dirigeant, indépendant ou premier commercial\./);
 assert.match(pricingPage,/Pour une personne dont la prospection est une activité centrale : trois fois les volumes de Solo\./);
});
test('pricing — no annual price, no fake scarcity, no unsupported ranking or "for life" claim',async()=>{
 const sources=[pricingPage,JSON.stringify(getSeoPage('tarifs')),await read('../app/cgv/page.tsx'),...Object.values(fr),...Object.values(en)].join('\n');
 assert.doesNotMatch(sources,/annuel|par an\b|\/ ?an\b|yearly|annual|per year/i,'no annual billing');
 assert.doesNotMatch(sources,/à vie|for life|garanti à vie|lifetime/i,'never "for life"');
 assert.doesNotMatch(sources,/premiers utilisateurs|early users|dans la limite des places|places limitées|plus que \d+ places|offre limitée/i,'no fake scarcity');
 assert.doesNotMatch(sources,/le plus populaire|meilleur choix|most popular|best value|best choice/i);
});

// ---------------------------------------------------------------- trial copy
test('trial — 7 days, no card, said on the home page, /tarifs and the CGV; no subscription starts by itself',async()=>{
 assert.equal(fr['landing.trialCta'],'Démarrer mon essai gratuit — 7 jours');
 assert.equal(fr['landing.trialSub'],'Aucune carte bancaire requise pour commencer.');
 assert.match(pricingPage,/Essai gratuit de 7 jours, sans carte bancaire/);
 assert.match(pricingPage,/Aucun abonnement n’est souscrit automatiquement à la fin de l’essai\./);
 assert.match(await read('../app/cgv/page.tsx'),/À la fin de l’essai, aucun abonnement n’est souscrit automatiquement et aucune somme n’est due/);
 assert.equal(fr['pricing.trialLimits'],`Essai 7 jours : ${PLAN_QUOTAS.TRIAL.discovery} recherches de prospects · ${PLAN_QUOTAS.TRIAL.analysis} analyses de prospects · ${PLAN_QUOTAS.TRIAL.aiOffer} analyses d’offre IA`);
});

// ---------------------------------------------------------------- "bêta" removed from user-facing text
test('beta terminology — no user-facing string still speaks of a beta (the internal analytics dashboard excepted)',async()=>{
 const internal=(k:string)=>/betaAnalytics/.test(k);
 for(const [k,v] of Object.entries(fr))if(!internal(k))assert.doesNotMatch(v,/bêta|beta/i,k);
 for(const [k,v] of Object.entries(en))if(!internal(k))assert.doesNotMatch(v,/\bbeta\b/i,k);
 for(const f of ['../app/api/v1/[...path]/route.ts','../src/server/billing/checkout.ts','../app/cgu/page.tsx','../app/cgv/page.tsx','../app/confidentialite/page.tsx','../src/components/PricingPage.tsx'])
  assert.doesNotMatch((await read(f)).replace(/BETA_[A-Z_]+|'BETA'|\.BETA\b|beta_[a-z_]+|betaCheckoutOpen|plan==='BETA'/g,''),/bêta|Bêta/,f);
});

// ---------------------------------------------------------------- paywall: a route to the offers
test('paywall — trial or paid access ended and quota reached lead to the offers; an hourly anti-abuse limit does not',()=>{
 assert.equal(paywallReasonForCode('BETA_ACCESS_EXPIRED'),'expired');
 assert.equal(paywallReasonForCode('ENTITLEMENT_REQUIRED'),'expired');
 assert.equal(paywallReasonForCode('PLAN_LIMIT_REACHED'),'limit');
 assert.equal(paywallReasonForCode('OFFER_LIMIT_REACHED'),'limit');
 assert.equal(paywallReasonForCode('MONITORING_LIMIT_REACHED'),'limit');
 for(const c of ['QUOTA_EXCEEDED','BETA_CAPACITY_REACHED','SITE_TIMEOUT',undefined,null,42,'toString','__proto__'])assert.equal(paywallReasonForCode(c),null,String(c));
});
test('paywall — an ended trial or paid period shows the offers without waiting for a refusal (never for a team member or a manual plan)',()=>{
 assert.equal(paywallReasonForAccount({mode:'live',active:false,role:'owner',plan:'BETA'}),'expired');
 assert.equal(paywallReasonForAccount({mode:'live',active:false,role:'owner',plan:'PAID'}),'expired');
 assert.equal(paywallReasonForAccount({mode:'live',active:true,role:'owner',plan:'BETA'}),null);
 assert.equal(paywallReasonForAccount({mode:'live',active:null,role:'owner',plan:null}),null,'unknown is not ended');
 assert.equal(paywallReasonForAccount({mode:'live',active:false,role:'member',plan:'TEAM'}),null,'a member’s plan is the owner’s');
 assert.equal(paywallReasonForAccount({mode:'live',active:false,role:'owner',plan:'INTERNAL'}),null);
 assert.equal(paywallReasonForAccount({mode:'demo',active:false,role:'owner',plan:'BETA'}),null);
});
test('paywall — every API refusal goes through api(): its code raises the banner, whose button only opens the offers',()=>{
 assert.match(page,/\(err as Error&\{code\?:string\}\)\.code=data\.code;\n \{const reason=mode==='live'\?paywallReasonForCode\(data\.code\):null;if\(reason\)\{setPaywall\(reason\);setPaywallDismissed\(false\)\}\}/);
 const banner=page.slice(page.indexOf('className="paywall-banner"')-200,page.indexOf('className="paywall-banner"')+600);
 assert.match(banner,/const reason=paywall\?\?paywallReasonForAccount\(\{mode,active:betaActive,role,plan:entitlementPlan\}\)/);
 assert.match(banner,/<button type="button" className="primary" onClick=\{\(\)=>setModal\('pricing'\)\}>\{tr\('paywall\.seeOffers'\)\}<\/button>/);
 assert.doesNotMatch(banner,/startCheckout|billing\/checkout/,'the banner never starts a payment');
 assert.equal(fr['paywall.seeOffers'],'Voir les offres');assert.ok(en['paywall.seeOffers']);
 for(const k of ['paywall.expired','paywall.limit'] as const){assert.ok(fr[k]&&en[k],k)}
 assert.match(fr['error.betaAccessExpired'],/Choisissez une offre pour continuer/);
 assert.match(fr['error.planLimitReached'],/passez à une offre supérieure/);
 assert.match(page,/setPaywall\(null\);setPaywallDismissed\(false\);/,'logout clears it');
});

// ---------------------------------------------------------------- plan selection / Team intent
test('plan selection — the chosen offer is named after itself (Équipe is no longer shown as Pro)',()=>{
 assert.match(pricingPlans,/export const offerNameKey=\(id:Offer\['id'\]\):TKey=>id==='BETA'\?'billing\.betaName':id==='PRO'\?'billing\.proName':id==='TEAM'\?'billing\.teamName':'billing\.enterpriseName';/,'TEAM → its own name');
 assert.match(welcome,/<b>\{tr\(offerNameKey\(planIntent\)\)\}<\/b>/);
 assert.doesNotMatch(page,/planIntent==='BETA'\?'billing\.betaName':'billing\.proName'/);
 assert.equal(fr['billing.proName'],'ProspectOS Pro');assert.equal(fr['account.usagePro'],'ProspectOS Pro — 99 €/mois');
 for(const v of [...Object.values(fr),...Object.values(en)])assert.doesNotMatch(v,/Pro B2B/);
});
test('plan selection — a plan chosen before signing in never opens a payment page by itself',()=>{
 const resume=page.slice(page.indexOf('async function resumePlanIntent('),page.indexOf('async function resumePlanIntent(')+900);
 assert.doesNotMatch(resume,/startCheckout/);
 assert.match(resume,/if\(decision\.action==='CHECKOUT'\)\{setModal\('pricing'\);/);
});

// ---------------------------------------------------------------- /tarifs call to action
test('/tarifs — every call to action leads to the free trial (sign-up), never to a payment page',()=>{
 const hrefs=[...pricingPage.matchAll(/href=\{([A-Z_]+)\}/g)].map(m=>m[1]);
 assert.ok(hrefs.filter(h=>h==='TRIAL_SIGNUP_HREF').length>=3,'trial banner + Solo + Pro');
 assert.match(pricingPage,/export const TRIAL_SIGNUP_HREF='\/#inscription';/);
 const code=pricingPage.replace(/^\s*\/\/.*$/gm,'');
 assert.doesNotMatch(code,/startCheckout|billing\/checkout|onClick|'use client'|fetch\(/,'a static page: no payment call, no script');
 const t=getSeoPage('tarifs');assert.equal(t.cta.href,'/#inscription');assert.equal(t.cta.label,'Démarrer mon essai gratuit — 7 jours');
 assert.match(welcome,/<section className="login card" id="inscription">/,'the anchor exists on the home page');
});

// ---------------------------------------------------------------- homepage first screen
test('homepage — explicit B2B promise, one dominant trial CTA, the restaurant demo only as a secondary link',()=>{
 assert.equal(fr['landing.eyebrow'],'LOGICIEL DE PROSPECTION B2B');
 assert.equal([fr['landing.title1'],fr['landing.title2'],fr['landing.title3']].join(' '),'Sachez qui contacter. Pourquoi maintenant. Preuves à l’appui.');
 assert.match(fr['landing.subtitle1'],/explique chaque score critère par critère avec ses sources/);
 assert.match(fr['landing.subtitle2'],/dirigeants, indépendants et équipes commerciales B2B/);
 assert.match(welcome,/<a className="button primary large" href="#inscription">\{tr\(trialFull\?'landing\.createAccountCta':'landing\.trialCta'\)\}<\/a>/);
 assert.match(welcome,/<button type="button" className="text-button welcome-demo-link" onClick=\{demo\}>/,'the demo is a secondary text link');
 assert.equal((welcome.match(/className="primary large"|className="button primary large"/g)??[]).length,1,'one dominant CTA in the hero');
 for(const k of Object.keys(fr).filter(k=>k.startsWith('landing.')))assert.doesNotMatch(fr[k as keyof typeof fr],/Foodatoi/,k);
 assert.match(fr['landing.exploreDemo'],/exemple : prospection de restaurants/,'the demo says what it is: one example');
 assert.match(welcome,/<a href="\/tarifs">\{tr\('landing\.seo\.pricing'\)\}<\/a>/);
 assert.doesNotMatch(welcome,/href="\/prospection-restaurants"/);
});

// ---------------------------------------------------------------- contact paths
test('contact — every "écrivez-nous / nous contacter" path is the published contact address, never a page without a form',async()=>{
 assert.equal(CONTACT_EMAIL,EDITOR.legalEmail);assert.equal(CONTACT_MAILTO,`mailto:${EDITOR.legalEmail}`);
 for(const src of [page,pricingPlans,billingSection,pricingPage])assert.doesNotMatch(src,/href="\/mentions-legales"[^>]*>\{?tr\('(offers\.contact|landing\.footerContact|billing\.contact)'/);
 assert.match(page,/<a href=\{CONTACT_MAILTO\}>\{tr\('landing\.footerContact'\)\}<\/a>/);
 assert.match(pricingPlans,/<a href=\{CONTACT_MAILTO\} aria-label=\{tr\('offers\.contactAria'\)\}>\{tr\('offers\.contact'\)\}<\/a>/);
 assert.match(billingSection,/<a href=\{CONTACT_MAILTO\}>\{tr\('offers\.contact'\)\}<\/a>/);
 for(const [k,v] of [...Object.entries(fr),...Object.entries(en)]){
  const emails=v.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)??[];
  if(/placeholder/i.test(k))continue; // an example address in an input, not a contact channel
  for(const e of emails)assert.equal(e.replace(/\.$/,''),CONTACT_EMAIL,k);
  if(/contactez-nous|contact us/i.test(v))assert.ok(emails.length>0||k.startsWith('error.team')||k==='account.deletePartialFailure',`${k}: a "contact us" without an address`);
 }
});

// ---------------------------------------------------------------- AI outreach stays off by default
test('AI outreach — still off by default; the switch must say true explicitly',()=>{
 assert.equal(aiOutreachEnabled({}),false);
 assert.equal(aiOutreachEnabled({AI_OUTREACH_ENABLED:'false'}),false);
 assert.equal(aiOutreachEnabled({AI_OUTREACH_ENABLED:'true'}),true);
});

// ---------------------------------------------------------------- Stripe LIVE stays impossible without its gate
test('Stripe — a LIVE key is refused unless the deployment is production AND BILLING_ALLOW_LIVE=true; a TEST key is refused in production',()=>{
 const live='sk_live_'+'x'.repeat(24),testKey='sk_test_'+'x'.repeat(24);
 assert.equal(billingConfig({STRIPE_SECRET_KEY:live}),null);
 assert.equal(billingConfig({STRIPE_SECRET_KEY:live,BILLING_ALLOW_LIVE:'true'}),null,'no production marker');
 assert.equal(billingConfig({STRIPE_SECRET_KEY:live,VERCEL_ENV:'production'}),null,'no explicit allow');
 assert.equal(billingConfig({STRIPE_SECRET_KEY:live,VERCEL_ENV:'production',BILLING_ALLOW_LIVE:'1'}),null,'only the exact value true');
 assert.equal(billingConfig({STRIPE_SECRET_KEY:live,VERCEL_ENV:'preview',BILLING_ALLOW_LIVE:'true'}),null);
 assert.equal(billingConfig({STRIPE_SECRET_KEY:live,VERCEL_ENV:'production',BILLING_ALLOW_LIVE:'true'})?.mode,'live','both gates together');
 assert.equal(billingConfig({STRIPE_SECRET_KEY:testKey,VERCEL_ENV:'production'}),null);
 const off=checkoutAvailability(billingConfig({STRIPE_SECRET_KEY:testKey}));
 assert.deepEqual({BETA:off.BETA,PRO:off.PRO,TEAM:off.TEAM},{BETA:false,PRO:false,TEAM:false},'checkout also needs BILLING_ENABLED=true and the prices');
});
