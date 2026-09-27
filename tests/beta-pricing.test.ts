// ProspectOS Bêta pricing — 49 € HT / month, 7-day free trial (20 Discovery · 50 analyses), then 100 Discovery
// and 250 analyses per monthly period, no overage. The limits are enforced by the database (migration 016,
// tests/beta-commercial-quotas-db.mjs); these checks cover what the browser shows and sends: the pricing copy,
// the counters read from the server, the end of the trial, the e-mail rate-limit message, one request per
// click, and the untouched Search-Until-New limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BETA_OFFER,usageView,daysLeft,isEmailRateLimitError} from '../src/domain/pricing.ts';
import {createInFlight} from '../src/components/evidence-verification.ts';
import {usageCounterLabel,usageResetLabel,trialEndsInLabel} from '../src/i18n/format.ts';
import {localizeApiErrorMessage} from '../src/i18n/errors.ts';
import {MAX_PROVIDER_CALLS,PASS_TIMEOUT_MS,TIME_BUDGET_MS} from '../src/discovery/search-until-new.ts';
import {MAX_SEARCH_QUERIES} from '../src/discovery/query-plan.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const page=await read('../app/page.tsx');
const panel=await read('../src/components/DiscoveryPanel.tsx');
const review=await read('../src/components/ObservationsReview.tsx');
const route=await read('../app/api/v1/[...path]/route.ts');
const migration=await read('../db/migrations/016_beta_commercial_quotas.sql');
const NOW=Date.parse('2026-09-27T10:00:00Z');
const day=(n:number)=>new Date(NOW+n*86400000).toISOString();
const trial={plan:'BETA',status:'ACTIVE',period_start:day(-2),period_end:day(5),active:true,discovery_used:3,discovery_limit:20,analysis_used:12,analysis_limit:50};
const paid={plan:'PAID',status:'ACTIVE',period_start:day(-10),period_end:day(20),active:true,discovery_used:100,discovery_limit:100,analysis_used:40,analysis_limit:250};

// ---------------------------------------------------------------- A, F, G: the offer, never changed silently
test('A/F/G — the offer is 49 € HT, 7 days, 20/50 in trial and 100/250 per paid period — same numbers as the migration',()=>{
 assert.deepEqual(BETA_OFFER,{priceEurExclVatPerMonth:49,trialDays:7,trial:{discovery:20,analysis:50},paid:{discovery:100,analysis:250}});
 assert.match(migration,/trial_discovery_limit int not null default 20/);
 assert.match(migration,/trial_analysis_limit int not null default 50/);
 assert.match(migration,/paid_discovery_limit int not null default 100/);
 assert.match(migration,/paid_analysis_limit int not null default 250/);
 assert.equal(fr['pricing.trialLimits'],'Essai 7 jours : 20 Discovery · 50 analyses');
 assert.equal(fr['pricing.paidLimits'],'49 € HT/mois : 100 Discovery / mois · 250 analyses / mois');
});

// ---------------------------------------------------------------- N, O: pricing copy on the sign-up card
test('N — the pricing shows 49 € HT / mois, without commitment, cancellable at any time',()=>{
 assert.equal(fr['pricing.planName'],'ProspectOS Bêta');
 assert.equal(fr['pricing.price'],'49 € HT / mois');
 assert.equal(fr['pricing.terms'],'7 jours gratuits · Sans engagement · Annulation à tout moment');
 assert.equal(en['pricing.price'],'€49 excl. VAT / month');
 assert.match(page,/<div className="pricing-offer"><p><b>\{tr\('pricing\.planName'\)\}<\/b> · \{tr\('pricing\.price'\)\}<\/p><p className="muted">\{tr\('pricing\.terms'\)\}<\/p><ul><li>\{tr\('pricing\.trialLimits'\)\}<\/li><li>\{tr\('pricing\.paidLimits'\)\}<\/li><\/ul>/);
});
test('O — the CTA announces the 7 free days, no card, and that the beta needs one\'s own account',()=>{
 assert.equal(fr['landing.trialCta'],'Démarrer mon essai gratuit — 7 jours');
 assert.equal(fr['landing.trialSub'],'Aucune carte bancaire requise pour commencer.');
 assert.equal(en['landing.trialCta'],'Start my free trial — 7 days');
 assert.equal(fr['pricing.betaAccess'],'Créez votre propre compte pour accéder à la bêta.');
 assert.equal(fr['pricing.trialStart'],'Votre compte démarre avec 7 jours d’essai gratuit.');
 assert.match(page,/onClick=\{\(\)=>login\(true\)\}>\{tr\('landing\.trialCta'\)\}<\/button><small className="muted">\{tr\('landing\.trialSub'\)\}<\/small><div className="pricing-offer">/);
 assert.match(page,/\{tr\('pricing\.betaAccess'\)\} \{tr\('pricing\.trialStart'\)\}/);
});
test('No internal cost and no payment secret ever reaches the browser',()=>{
 for(const [k,v] of Object.entries({...fr,...en}))if(k.startsWith('pricing.')||k.startsWith('account.usage'))assert.doesNotMatch(v,/\$|USD|Brave|Anthropic|coût|cost/i,k);
 for(const src of [page,panel])assert.doesNotMatch(src,/stripe|sk_live|sk_test|pk_live|pk_test/i);
});

// ---------------------------------------------------------------- counters: display of the server's numbers
test('Counters — trial: "Discovery : X / 20 utilisées", "Analyses : X / 50", "Essai se termine dans X jours"',()=>{
 const v=usageView(trial,NOW)!;
 assert.equal(v.kind,'trial');assert.equal(v.active,true);assert.equal(v.daysLeft,5);
 assert.equal(usageCounterLabel('fr','discovery',v.discovery.used,v.discovery.limit),'Discovery : 3 / 20 utilisées');
 assert.equal(usageCounterLabel('fr','analysis',v.analysis.used,v.analysis.limit),'Analyses : 12 / 50');
 assert.equal(trialEndsInLabel('fr',5),'Essai se termine dans 5 jours');
 assert.equal(trialEndsInLabel('fr',1),'Essai se termine dans 1 jour');
 assert.equal(trialEndsInLabel('fr',0),'Essai se termine aujourd’hui');
 assert.equal(usageCounterLabel('en','discovery',3,20),'Discovery: 3 / 20 used');
});
test('Counters — paid: "Discovery : 100 / 100 utilisées" flagged as reached, "Réinitialisation le …"',()=>{
 const v=usageView(paid,NOW)!;
 assert.equal(v.kind,'paid');assert.equal(v.discovery.reached,true);assert.equal(v.analysis.reached,false);
 assert.equal(usageCounterLabel('fr','discovery',100,100),'Discovery : 100 / 100 utilisées');
 assert.match(usageResetLabel('fr',v.periodEnd),/^Réinitialisation le \d{2}\/\d{2}\/2026$/);
 assert.match(usageResetLabel('en',v.periodEnd),/^Resets on /);
});
test('Counters — nothing is shown for INTERNAL, no entitlement, a missing migration or a malformed answer',()=>{
 for(const raw of [null,undefined,{plan:null},{plan:'INTERNAL',status:'ACTIVE'},{...trial,discovery_used:'3'},{...trial,period_end:'nope'},{...trial,analysis_limit:-1},'x'])assert.equal(usageView(raw,NOW),null);
});
test('Counters — the page reads them from GET account only, and shows the reset date or the trial end',()=>{
 assert.match(page,/async function refreshUsage\(t=token\)\{try\{const acc=await api\('account','GET',undefined,t\);setUsage\(usageView\(acc\.usage\)\)\}catch\{\}\}/);
 assert.match(page,/setUsage\(usageView\(acc\.usage\)\)/);
 assert.match(page,/usage\.kind==='paid'\?usageResetLabel\(locale,usage\.periodEnd\):trialEndsInLabel\(locale,usage\.daysLeft\)/);
 assert.match(route,/const usageAnswer=await db\.rpc\('get_commercial_usage'\);/);
 assert.match(route,/usage:usageAnswer\.error\?null:usageAnswer\.data\?\?null,/,'the account answer degrades to usage:null, never an error');
 assert.match(page,/setEntitlementPlan\(null\);setUsage\(null\);/,'logout clears the counters');
});

// ---------------------------------------------------------------- J, K: reading is free, one click = one request
test('J — refreshing the counters is a GET: it never reaches a quota function',()=>{
 const account=route.slice(route.indexOf("const usageAnswer"),route.indexOf("if(id==='export'"));
 assert.doesNotMatch(account,/consume_|start_discovery|activate_trial/);
 assert.match(migration,/create or replace function public\.get_commercial_usage\(\) returns jsonb\nlanguage plpgsql stable security definer/);
});
test('K — a double click on "launch" or "analyze" sends a single request while the first is pending',async()=>{
 const guard=createInFlight();let calls=0;let release!:()=>void;const pending=new Promise<void>(r=>{release=r});
 const first=guard.run('search',async()=>{calls++;await pending});
 assert.equal(await guard.run('search',async()=>{calls++}),false);
 release();assert.equal(await first,true);assert.equal(calls,1);
 assert.match(panel,/async function search\(form:FormData\)\{await launching\.current\.run\('search',async\(\)=>\{await execute\(/);
 assert.match(panel,/const launching=useRef\(createInFlight\(\)\);/);
 assert.match(review,/async function analyze\(\)\{await analyzing\.current\.run\(prospect\.id,\(\)=>execute\(/);
});

// ---------------------------------------------------------------- M: end of trial
test('M — trial ended: data kept, clear message, upgrade offer, no deletion path',()=>{
 const v=usageView({...trial,period_end:day(-1),active:false},NOW)!;
 assert.equal(v.active,false);assert.equal(daysLeft(day(-1),NOW),0);
 assert.equal(fr['account.trialEnded'],'Votre essai est terminé.');
 assert.equal(fr['account.upgrade'],'Passez à ProspectOS Bêta — 49 € HT/mois');
 assert.match(fr['account.trialEndedNote'],/Vos données restent disponibles/);
 assert.match(page,/\{entitlementPlan==='BETA'&&betaActive===false&&<div className="account-field upgrade"><p><b>\{tr\('account\.upgrade'\)\}<\/b><\/p><p className="muted">\{tr\('account\.upgradeNote'\)\}<\/p><\/div>\}/);
 assert.match(fr['account.upgradeNote'],/Aucune donnée n’est supprimée/);
});
test('Plan limit — the refusal is its own code (429), localized, distinct from the hourly quota',async()=>{
 const api=await read('../src/discovery/api.ts');const repo=await read('../src/discovery/repository.ts');
 assert.match(repo,/if\(error\.message\?\.includes\('plan_limit_reached'\)\)throw Error\('PLAN_LIMIT_REACHED'\);/);
 assert.ok(repo.indexOf("'plan_limit_reached'")<repo.indexOf("'quota_exceeded'"),'checked before the hourly quota');
 assert.match(api,/code==='QUOTA_EXCEEDED'\|\|code==='PLAN_LIMIT_REACHED'\?429/);
 assert.equal(localizeApiErrorMessage('x','PLAN_LIMIT_REACHED','fr'),fr['error.planLimitReached']);
 assert.equal(localizeApiErrorMessage('x','PLAN_LIMIT_REACHED','en'),en['error.planLimitReached']);
});

// ---------------------------------------------------------------- e-mail rate limit
test('E-mail rate limit — the agreed FR/EN message replaces the raw Supabase error',()=>{
 assert.equal(fr['login.emailRateLimited'],'Un e-mail de confirmation a déjà été envoyé. Consultez votre boîte mail avant d’en demander un nouveau.');
 assert.equal(en['login.emailRateLimited'],'A confirmation email has already been sent. Check your inbox before requesting another one.');
 assert.equal(isEmailRateLimitError({code:'over_email_send_rate_limit',status:429,message:'email rate limit exceeded'}),true);
 assert.equal(isEmailRateLimitError({status:429,message:'For security purposes, you can only request this after 42 seconds.'}),true);
 assert.equal(isEmailRateLimitError({status:429,message:'Email rate limit exceeded'}),true);
 for(const other of [{status:400,message:'Invalid login credentials'},{status:422,message:'User already registered'},{status:429,message:'Too many requests'},null,'x'])assert.equal(isEmailRateLimitError(other),false);
 assert.match(page,/if\(result\.error\)\{if\(isEmailRateLimitError\(result\.error\)\)\{setNotice\(tr\('login\.emailRateLimited'\)\);return\}throw result\.error\}/);
});

// ---------------------------------------------------------------- Q, R: existing limits untouched
test('Q — the hourly limits stay in place, unchanged, ahead of nothing: the plan limit is added on top',()=>{
 assert.match(migration,/if used >= allowed then raise exception 'quota_exceeded'/);
 assert.match(migration,/if used >= per_user then raise exception 'quota_exceeded'/);
 assert.match(migration,/if used >= per_org then raise exception 'quota_exceeded'/);
 assert.doesNotMatch(migration,/update prospectos_private\.discovery_quota_settings|runs_per_hour\s*=|analyses_per_hour\s*=/);
});
test('R — Search-Until-New keeps its limits: 3 provider calls, 3 queries, 12 s per pass, 40 s budget',()=>{
 assert.equal(MAX_PROVIDER_CALLS,3);assert.equal(MAX_SEARCH_QUERIES,3);
 assert.equal(PASS_TIMEOUT_MS,12_000);assert.equal(TIME_BUDGET_MS,40_000);
});
test('i18n — every new key exists in both languages',()=>{
 for(const k of Object.keys(fr).filter(k=>/^(pricing\.|account\.(usage|upgrade|paidEnded)|login\.emailRateLimited|error\.planLimitReached)/.test(k)))assert.ok(k in en,k);
});
