// Offers and the end of the free-trial seats:
//  - the 49 € offer is displayed as "Solo" (database plan, Stripe and prices unchanged);
//  - whether a free-trial seat is still open is public as ONE boolean (no count, no list), read server-side;
//  - when the seats are gone, the demo banner and the sign-up switch directly to the subscription choice,
//    and an account created anyway is shown the offers instead of a dead end;
//  - the register's headcount can be typed in the search form; register results read as register identities.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {reviewPriority} from '../src/discovery/review-priority.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');

test('offers: the 49 € offer is “Solo”, Pro and Entreprise keep their names',()=>{
 assert.equal(fr['billing.betaName'],'ProspectOS Solo');assert.equal(en['billing.betaName'],'ProspectOS Solo');
 assert.equal(fr['pricing.planName'],'ProspectOS Solo');assert.equal(fr['offers.chooseBeta'],'Choisir Solo');assert.equal(en['offers.chooseBeta'],'Choose Solo');
 assert.equal(fr['account.usagePaid'],'ProspectOS Solo — 49 € HT/mois');assert.equal(fr['account.upgrade'],'ProspectOS Solo — 49 € HT/mois');
 assert.match(fr['offers.proPoint1'],/Solo/);assert.match(en['offers.proPoint1'],/Solo/);
 assert.equal(fr['billing.proName'],'ProspectOS Pro B2B');assert.equal(fr['billing.enterpriseName'],'Entreprise / White Label');
 for(const k of ['billing.betaName','pricing.planName','offers.chooseBeta','account.usagePaid','account.upgrade','account.paidEnded','error.betaOfferClosed','offers.proPoint1'] as const){
  assert.doesNotMatch(fr[k],/Bêta/,k);assert.doesNotMatch(en[k],/\bBeta\b/,k);
 }
});

test('trial availability: migration 020 exposes one boolean to anyone, never a count',async()=>{
 const sql=await read('../db/migrations/020_public_trial_availability.sql');
 assert.match(sql,/create or replace function public\.trial_available\(\) returns boolean/);
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/prospectos_private\.beta_seats_used\(\)\s*<\s*\(select capacity from prospectos_private\.beta_program where singleton\)/);
 assert.match(sql,/revoke all on function public\.trial_available\(\) from public;/);
 assert.match(sql,/grant execute on function public\.trial_available\(\) to anon, authenticated;/);
 assert.doesNotMatch(sql,/returns (int|integer|jsonb|table)/i);
});

test('trial availability: a public, unauthenticated, uncached route that only relays the boolean',async()=>{
 const route=await read('../app/api/public/trial-availability/route.ts');
 assert.match(route,/export async function GET\(\)/);
 assert.match(route,/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);assert.doesNotMatch(route,/SERVICE_ROLE|authorization/i);
 assert.match(route,/\.rpc\('trial_available'\)/);
 assert.match(route,/available:error\?null:typeof data==='boolean'\?data:null/,'anything but a boolean is "unknown", never "open"');
 assert.match(route,/'cache-control':'no-store'/);
});

test('seats gone: sign-up becomes “Créer mon compte” + the subscription choice; unknown keeps the trial copy',async()=>{
 const page=await read('../app/page.tsx');
 assert.match(page,/fetch\('\/api\/public\/trial-availability',\{cache:'no-store'\}\)/);
 assert.match(page,/\{tr\(trialFull\?'landing\.createAccountCta':'landing\.trialCta'\)\}/);
 assert.match(page,/\{trialFull\?<><small className="muted">\{tr\('landing\.trialFullSub'\)\}<\/small><PricingPlans locale=\{locale\} context="public" availability=\{null\} busy=\{busy\} selected=\{planIntent\} onChoose=\{choosePlan\} layout="stack"\/><\/>:<>/);
 assert.match(page,/const trialFull=trialAvailable===false;/,'only an explicit "false" switches the copy');
 assert.equal(fr['landing.createAccountCta'],'Créer mon compte');
 assert.match(fr['landing.trialFullSub'],/places d’essai gratuit sont épuisées/);assert.ok(en['landing.trialFullSub']);
});

test('seats gone: the demo banner points to the offers instead of promising a trial',async()=>{
 const banner=await read('../src/components/DemoModeBanner.tsx');
 assert.match(banner,/<p>\{tr\(trialFull\?'demoBanner\.full':'demoBanner\.trial'\)\}<\/p>/);
 assert.match(banner,/onClick=\{trialFull\?onSeeOffers:onTryReal\}>\{tr\(trialFull\?'demoBanner\.ctaOffers':'demoBanner\.cta'\)\}<\/button>/);
 const page=await read('../app/page.tsx');
 assert.match(page,/<DemoModeBanner locale=\{locale\} trialFull=\{trialFull\} onTryReal=\{tryRealProspects\} onSeeOffers=\{\(\)=>setModal\('pricing'\)\}\/>/);
 assert.equal(fr['demoBanner.full'],'Les places d’essai gratuit sont épuisées : choisissez une offre pour lancer de vraies recherches.');
 assert.equal(fr['demoBanner.ctaOffers'],'Voir les offres');assert.ok(en['demoBanner.full']&&en['demoBanner.ctaOffers']);
});

test('seats gone after sign-up: the account is shown the offers, never a dead end',async()=>{
 const page=await read('../app/page.tsx');
 assert.match(page,/code==='BETA_CAPACITY_REACHED'\)\{setNotice\(e\.message\);setTrialAvailable\(false\);setModal\('pricing'\)\}/);
});

test('register headcount: typed in the search form, sent only for the register, both bounds or none',async()=>{
 const panel=await read('../src/components/DiscoveryPanel.tsx');
 assert.match(panel,/\{provider==='registry'&&<fieldset className="registry-headcount"><legend>\{tr\('discovery\.headcountLabel'\)\}<\/legend>/);
 assert.match(panel,/name="employee_min" type="number" min=\{0\}/);assert.match(panel,/name="employee_max" type="number" min=\{1\}/);
 assert.match(panel,/import \{headcountFromInputs,sameHeadcount\} from '.\/headcount'/);
 const {headcountFromInputs}=await import('../src/components/headcount.ts');
 assert.deepEqual(headcountFromInputs('200','2000'),{min:200,max:2000});
 assert.equal(headcountFromInputs('',''),null);assert.equal(headcountFromInputs('200',''),null);
 assert.equal(headcountFromInputs('3000','200'),null,'min > max: no filter rather than a wrong one');
 assert.equal(headcountFromInputs('-5','10'),null);assert.equal(headcountFromInputs('1.5','10'),null);
 assert.ok(fr['discovery.headcountLabel']&&en['discovery.headcountLabel']);
});

test('register results read as register identities, not as names “seen on a third-party page”',()=>{
 const meta={source_class:'COMPANY_CANDIDATE',source_type:'public_registry',entity_type:'COMPANY',registry:{naf:'10.13A'}};
 const p=reviewPriority(meta,null);
 assert.ok(p.reasons.includes('public_registry'));assert.ok(p.reasons.includes('registry_activity_code'));
 assert.ok(!p.reasons.includes('named_by_third_party'));assert.ok(!p.reasons.includes('no_specific_query_term'));
 assert.equal(p.level,'MEDIUM','an identity without its official site is never HIGH');
 assert.equal(fr['discovery.priorityReason.public_registry'],'Entreprise identifiée au registre public (SIREN)');
 assert.equal(fr['discovery.priorityReason.registry_activity_code'],'activité déclarée au registre (code NAF)');
 assert.ok(en['discovery.priorityReason.public_registry']&&en['discovery.priorityReason.registry_activity_code']);
 // a web result keeps its reasons exactly as before
 assert.ok(reviewPriority({source_class:'COMPANY_CANDIDATE'},null).reasons.includes('named_by_third_party'));
});
