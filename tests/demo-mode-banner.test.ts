// The demo says plainly what it is, at the top: a demo, synthetic search results, and the one way to real
// prospects — create an account for the 7-day free trial. The button only opens sign-up (no paid offer chosen),
// it never activates anything by itself, and the claim matches the trial the database really grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');

test('demo banner: the exact, explicit French copy and its English counterpart',()=>{
 assert.equal(fr['demoBanner.title'],'Vous êtes en mode démo');
 assert.equal(fr['demoBanner.synthetic'],'Les résultats de recherche affichés sont synthétiques.');
 assert.equal(fr['demoBanner.trial'],'Créez votre compte pour lancer de vraies recherches pendant 7 jours gratuitement.');
 assert.equal(fr['demoBanner.cta'],'Tester avec de vrais prospects');
 for(const k of ['demoBanner.title','demoBanner.synthetic','demoBanner.trial','demoBanner.cta'] as const)assert.ok(en[k],k);
 assert.match(en['demoBanner.trial'],/7 days/);
});

test('demo banner: static, accessible, one button that only calls its handler',async()=>{
 const banner=await read('../src/components/DemoModeBanner.tsx');
 assert.doesNotMatch(banner,/api\(|fetch\(|localStorage/);
 assert.match(banner,/<section className="demo-mode-banner" aria-labelledby="demo-mode-banner-title">/);
 assert.match(banner,/<h2 id="demo-mode-banner-title">\{tr\('demoBanner\.title'\)\}<\/h2>/);
 assert.match(banner,/<button type="button" className="primary" onClick=\{onTryReal\}>\{tr\('demoBanner\.cta'\)\}<\/button>/);
});

test('demo banner: shown first in demo only; its button opens “Créer mon compte” with NO paid offer chosen',async()=>{
 const page=await read('../app/page.tsx');
 assert.match(page,/\{mode==='demo'&&<DemoModeBanner locale=\{locale\} onTryReal=\{tryRealProspects\}\/>\}\{mode==='demo'&&<DemoMission /);
 // The free 7-day trial is claimed by the first signed-in arrival (activate_trial), not by a plan intent: a BETA
 // intent would open the paid checkout after sign-up, contradicting “gratuitement”. Any earlier intent is dropped.
 const fn=/function tryRealProspects\(\)\{[^}]*\}/.exec(page)?.[0]??'';
 assert.equal(fn,"function tryRealProspects(){clearPlanIntent(browserStorage());setPlanIntent(null);clearWorkspace();setAuthView('signup');setMode('welcome')}");
 assert.doesNotMatch(fn,/savePlanIntent|choosePlan|checkout/i);
 assert.match(page,/activate_trial/,'the trial is claimed on the first signed-in arrival');
});

test('demo banner: “7 jours” is the trial the database grants',async()=>{
 assert.match(await read('../db/migrations/012_beta_self_service_trial.sql'),/now\(\)\+interval '7 days'/);
});
