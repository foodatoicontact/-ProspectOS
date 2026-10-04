// ProspectOS Bêta pricing — 49 € HT / month, 7-day free trial (20 Discovery · 50 prospect analyses · 5 AI offer
// analyses), then 100 / 250 / 25 per monthly period, no overage. The limits are enforced by the database (migration 016,
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
import {trackAnalysisReservation,releaseOnFailure} from '../src/server/commercial-usage.ts';
import {CompanyAnalysisService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const page=await read('../app/page.tsx');
const panel=await read('../src/components/DiscoveryPanel.tsx');
const review=await read('../src/components/ObservationsReview.tsx');
const route=await read('../app/api/v1/[...path]/route.ts');
const migration=await read('../db/migrations/016_beta_commercial_quotas.sql');
const discoveryApi=await read('../src/discovery/api.ts');
const offerBlock=route.match(/if\(resource==='analyze-company'&&request\.method==='POST'\)\{[\s\S]*?return json\(analysis\);\n \}/)?.[0]??'';
const NOW=Date.parse('2026-09-27T10:00:00Z');
const day=(n:number)=>new Date(NOW+n*86400000).toISOString();
const trial={plan:'BETA',status:'ACTIVE',period_start:day(-2),period_end:day(5),active:true,discovery_used:3,discovery_limit:20,analysis_used:12,analysis_limit:50,ai_offer_used:1,ai_offer_limit:5};
const paid={plan:'PAID',status:'ACTIVE',period_start:day(-10),period_end:day(20),active:true,discovery_used:100,discovery_limit:100,analysis_used:40,analysis_limit:250,ai_offer_used:25,ai_offer_limit:25};

// ---------------------------------------------------------------- A, F, G: the offer, never changed silently
test('Offer — 49 € HT, 7 days, 20/50/5 in trial and 100/250/25 per paid period — same numbers as the migration',()=>{
 assert.deepEqual(BETA_OFFER,{priceEurExclVatPerMonth:49,trialDays:7,trial:{discovery:20,analysis:50,aiOffer:5},paid:{discovery:100,analysis:250,aiOffer:25}});
 assert.match(migration,/trial_ai_offer_limit int not null default 5/);
 assert.match(migration,/paid_ai_offer_limit int not null default 25/);
 assert.match(migration,/trial_discovery_limit int not null default 20/);
 assert.match(migration,/trial_analysis_limit int not null default 50/);
 assert.match(migration,/paid_discovery_limit int not null default 100/);
 assert.match(migration,/paid_analysis_limit int not null default 250/);
 assert.equal(fr['pricing.trialLimits'],'Essai 7 jours : 20 Discovery · 50 analyses prospects · 5 analyses d’offre IA');
 assert.equal(fr['pricing.paidLimits'],'49 € HT/mois : 100 Discovery · 250 analyses prospects · 25 analyses d’offre IA / mois');
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
test('Counters — trial: Discovery X / 20, Analyses prospects X / 50, Analyses d’offre IA X / 5, trial end',()=>{
 const v=usageView(trial,NOW)!;
 assert.equal(v.kind,'trial');assert.equal(v.active,true);assert.equal(v.daysLeft,5);
 assert.equal(usageCounterLabel('fr','discovery',v.discovery.used,v.discovery.limit),'Discovery : 3 / 20');
 assert.equal(usageCounterLabel('fr','analysis',v.analysis.used,v.analysis.limit),'Analyses prospects : 12 / 50');
 assert.equal(usageCounterLabel('fr','ai_offer',v.aiOffer.used,v.aiOffer.limit),'Analyses d’offre IA : 1 / 5');
 assert.equal(usageCounterLabel('en','ai_offer',1,5),'AI offer analyses: 1 / 5');
 assert.equal(trialEndsInLabel('fr',5),'Essai se termine dans 5 jours');
 assert.equal(trialEndsInLabel('fr',1),'Essai se termine dans 1 jour');
 assert.equal(trialEndsInLabel('fr',0),'Essai se termine aujourd’hui');
 assert.equal(usageCounterLabel('en','discovery',3,20),'Discovery: 3 / 20');
});
test('Counters — paid: Discovery X / 100, Analyses prospects X / 250, Analyses d’offre IA X / 25, reset date',()=>{
 const v=usageView(paid,NOW)!;
 assert.equal(v.kind,'paid');assert.equal(v.discovery.reached,true);assert.equal(v.analysis.reached,false);assert.equal(v.aiOffer.reached,true);
 assert.equal(usageCounterLabel('fr','discovery',100,100),'Discovery : 100 / 100');
 assert.equal(usageCounterLabel('fr','analysis',40,250),'Analyses prospects : 40 / 250');
 assert.equal(usageCounterLabel('fr','ai_offer',25,25),'Analyses d’offre IA : 25 / 25');
 assert.match(page,/usageCounterLabel\(locale,'ai_offer',usage\.aiOffer\.used,usage\.aiOffer\.limit\)/);
 assert.match(usageResetLabel('fr',v.periodEnd),/^Réinitialisation le \d{2}\/\d{2}\/2026$/);
 assert.match(usageResetLabel('en',v.periodEnd),/^Resets on /);
});
test('Counters — nothing is shown for INTERNAL, no entitlement, a missing migration or a malformed answer',()=>{
 for(const raw of [null,undefined,{plan:null},{plan:'INTERNAL',status:'ACTIVE'},{...trial,discovery_used:'3'},{...trial,period_end:'nope'},{...trial,analysis_limit:-1},{...trial,ai_offer_limit:undefined},'x'])assert.equal(usageView(raw,NOW),null);
});
test('Counters — the page reads them from GET account only, and shows the reset date or the trial end',()=>{
 // The same GET account read also refreshes the subscription summary and offers (migration 017): still one read.
 assert.match(page,/async function refreshUsage\(t=token\)\{try\{const acc=await api\('account','GET',undefined,t\);setUsage\(usageView\(acc\.usage\)\);setBillingOffers\(acc\.billing_offers\?\?null\);setBillingStatus\(acc\.billing\?\?null\);/);
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
 assert.equal(fr['account.upgrade'],'ProspectOS Bêta — 49 € HT/mois');
 assert.match(fr['account.trialEndedNote'],/Vos données restent disponibles/);
 // The manual-activation message stays wherever self-service checkout is not available (Production today).
 assert.match(page,/\{entitlementPlan==='BETA'&&betaActive===false&&!\(billingOffers\?\.BETA\|\|billingOffers\?\.PRO\)&&<div className="account-field upgrade"><p><b>\{tr\('account\.upgrade'\)\}<\/b><\/p><p className="muted">\{tr\('account\.upgradeNote'\)\}<\/p><\/div>\}/);
 assert.equal(fr['account.upgradeNote'],'Pendant la bêta, l’activation de l’abonnement se fait manuellement. Contactez-nous pour continuer.');
 assert.equal(en['account.upgradeNote'],'During the beta, subscriptions are activated manually. Contact us to continue.');
 // The public pricing no longer claims a manual activation unconditionally (false wherever online payment is
 // open): it says the paid plan is taken from the account and granted only after the server's confirmation.
 assert.equal('pricing.manualActivation' in fr,false);
 assert.equal(fr['pricing.activation'],'Le passage à une offre payante se fait depuis votre compte. L’accès payant n’est accordé qu’après confirmation du paiement par notre serveur.');
 assert.match(page,/<li>\{tr\('pricing\.paidLimits'\)\}<\/li><\/ul><p className="muted">\{tr\('pricing\.activation'\)\}<\/p>/,'the public pricing says it');
 for(const v of Object.values(fr))assert.doesNotMatch(v,/payer maintenant|acheter|s’abonner en ligne|checkout|paiement sécurisé/i);
 for(const v of Object.values(en))assert.doesNotMatch(v,/pay now|buy now|subscribe online|checkout|secure payment/i);
 // Self-service payment exists since 017, but never as a button of its own: the page only calls the server
 // with the offer name, and the offers block renders only what GET account says is buyable on this deployment.
 assert.doesNotMatch(page,/stripe|paiement-en-ligne|href="\/pay/i,'no fake payment button');
 // Every mention of checkout in the page is the startCheckout helper, the BillingSection onCheckout prop, the
 // intent decision constant or the server route: no other entry to the payment page.
 assert.ok((page.match(/checkout/gi)?.length??0)>=3);
 assert.equal(page.replace(/startCheckout|onCheckout=|action==='CHECKOUT'|'billing\/checkout'/g,'').match(/checkout/gi),null,'only startCheckout and the server route');
 assert.match(page,/async function startCheckout\(plan:'BETA'\|'PRO',t=token\)\{const \{url\}=await api\('billing\/checkout','POST',\{plan\},t\);/);
 assert.match(page,/<BillingSection locale=\{locale\} offers=\{billingOffers\}/);
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
 assert.match(page,/if\(result\.error\)\{if\(isEmailRateLimitError\(result\.error\)\)\{setNotice\(tr\('login\.emailRateLimited'\)\);return\}/);
 assert.match(page,/if\(r\.error\)\{if\(isEmailRateLimitError\(r\.error\)\)\{setNotice\(tr\('login\.emailRateLimited'\)\);return\}setNotice\(tr\(authErrorKey\(r\.error\)\)\);return\}/,'resend: same agreed rate-limit message first, then a translated generic/network message — never the raw error (hotfix #11)');
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

// ---------------------------------------------------------------- AI offer analysis: quota, idempotence
test('Offer A–D — the reservation made before the AI call also counts the plan (5 trial / 25 paid), never after',()=>{
 assert.ok(offerBlock,'analyze-company block not found');
 const reserve=offerBlock.indexOf("db.rpc('reserve_offer_analysis'"),call=offerBlock.indexOf('callProviderMeteringFailure(');
 assert.ok(reserve>0&&reserve<call,'reserved before the provider');
 assert.match(migration,/perform public\.consume_ai_offer_quota\(p_project_id\);/,'same hourly reservation as before, plus the plan');
 assert.match(migration,/if is_billable then perform prospectos_private\.enforce_plan_limit\(actor,action_name\); end if;/);
 assert.match(migration,/when 'ai_offer' then 'offer_limit_reached'/);
});
test('Offer — quota reached: the AI is not called and the agreed FR/EN message is shown',async()=>{
 assert.equal(fr['error.offerLimitReached'],'Quota d’analyses d’offre atteint pour cette période.');
 assert.equal(en['error.offerLimitReached'],'Offer analysis quota reached for this period.');
 assert.equal(localizeApiErrorMessage('x','OFFER_LIMIT_REACHED','fr'),fr['error.offerLimitReached']);
 assert.equal(localizeApiErrorMessage('x','OFFER_LIMIT_REACHED','en'),en['error.offerLimitReached']);
 assert.match(route,/OFFER_LIMIT_REACHED:\['Quota d’analyses d’offre atteint pour cette période\.',429\]/);
 const repo=await read('../src/discovery/repository.ts');
 assert.match(repo,/if\(error\.message\?\.includes\('offer_limit_reached'\)\)throw Error\('OFFER_LIMIT_REACHED'\);/);
 const {withAiQuota}=await import('../src/server/ai-guard.ts');let calls=0;
 await assert.rejects(withAiQuota(async()=>{throw Error('OFFER_LIMIT_REACHED')},async()=>{calls++}),/OFFER_LIMIT_REACHED/);
 assert.equal(calls,0,'a refused reservation never reaches the provider');
});
test('Offer E — double click: one request in flight in the browser; identical duplicates refused or read back on the server',()=>{
 assert.match(page,/offering\.current\.run\('offer',\(\)=>work\(async\(\)=>\{const r=await api\('analyze-company','POST'/);
 assert.match(offerBlock,/const textHash=createHash\('sha256'\)\.update\(body\.text\)\.digest\('hex'\);/);
 assert.match(migration,/raise exception 'offer_analysis_in_progress'/);
 assert.equal(localizeApiErrorMessage('x','OFFER_ANALYSIS_IN_PROGRESS','fr'),fr['error.offerAnalysisInProgress']);
});
test('Offer F — an existing analysis is read back without a unit and without an AI call; the result is stored after success only',()=>{
 assert.match(offerBlock,/if\(cached\)return \{\.\.\.cached,usage:\{provider:'',model:'',input_tokens:0,output_tokens:0\},credential_source:null\}/);
 assert.match(offerBlock,/if\(!cached\)await Promise\.resolve\(db\.rpc\('complete_offer_analysis',\{p_project_id:body\.project_id,p_text_hash:textHash,p_result:analysis\}\)\)/);
 assert.match(offerBlock,/if\(usage\.input_tokens\|\|usage\.output_tokens\)/,'a cached answer writes no cost line');
 assert.match(migration,/if found and r\.status='DONE' and r\.updated_at>now\(\)-interval '24 hours' then return jsonb_build_object\('cached',r\.result\); end if;/);
});
test('Offer — the unit goes back only when the AI was never called; a provider call keeps it spent',()=>{
 assert.match(offerBlock,/providerCalled=true;\n    return await callProviderMeteringFailure\(\(\)=>analyzeOffer\(body\.text,\{apiKeyOverride/);
 assert.match(offerBlock,/if\(!providerCalled\|\|\(error instanceof Error&&error\.message==='AI_NOT_CONFIGURED'\)\)\{try\{await releaseCommercialUse\(createAdminClient\(\),user\.id,'ai_offer'\)\}catch\{/);
 assert.ok(offerBlock.indexOf("throw Error('BYOK_CREDENTIAL_INVALID')")<offerBlock.indexOf('providerCalled=true'),'an invalid BYOK key is refunded');
});

// ---------------------------------------------------------------- G, H, I: site analysis
function siteRepo(){
 const calls:string[]=[];
 const repo:DiscoveryRepository={start:async()=>{throw Error('unused')},existing:async()=>[],saveResults:async()=>[],finish:async()=>{},
  prospect:async id=>({id,website:'https://club.example/',organization_id:'o',project_id:'p'}),projectCriteria:async()=>[{key:'lieu',label:'Lieu',weight:100}],
  consumeAnalysis:async()=>{calls.push('reserve')},saveObservations:async(_i,o)=>{calls.push('save');return o}};
 return {repo,calls};
}
test('G — a site analysis that produced its result keeps its plan unit (no release)',async()=>{
 const {repo,calls}=siteRepo();const tracked=trackAnalysisReservation(repo);let released=0;
 const result=await releaseOnFailure(()=>new CompanyAnalysisService(tracked.repo,async url=>({url,html:'<html><body><p>Trois terrains couverts à Lyon.</p></body></html>'})).analyze_company('p1'),tracked.reserved,async()=>{released++});
 assert.ok(result);assert.deepEqual(calls,['reserve','save']);assert.equal(tracked.reserved(),true);assert.equal(released,0);
});
test('H — a fetch that fails before any result releases the plan unit exactly once; the original error is kept',async()=>{
 for(const failure of [Error('ETIMEDOUT'),Error('ECONNREFUSED'),Error('x',{cause:Error('Blocked by robots.txt')}),Error('Response status 503')]){
  const {repo,calls}=siteRepo();const tracked=trackAnalysisReservation(repo);let released=0;
  await assert.rejects(releaseOnFailure(()=>new CompanyAnalysisService(tracked.repo,async()=>{throw failure}).analyze_company('p1'),tracked.reserved,async()=>{released++}),/ANALYSIS_FAILED|ROBOTS_DENIED/);
  assert.deepEqual(calls,['reserve'],'nothing saved');assert.equal(released,1);
 }
});
test('H — a refusal before the reservation (hourly or plan limit, missing website) never refunds anything',async()=>{
 const {repo}=siteRepo();repo.consumeAnalysis=async()=>{throw Error('PLAN_LIMIT_REACHED')};
 const tracked=trackAnalysisReservation(repo);let released=0;
 await assert.rejects(releaseOnFailure(()=>new CompanyAnalysisService(tracked.repo,async url=>({url,html:''})).analyze_company('p1'),tracked.reserved,async()=>{released++}),/PLAN_LIMIT_REACHED/);
 assert.equal(released,0);
 const noSite=siteRepo();noSite.repo.prospect=async id=>({id,website:null,organization_id:'o',project_id:'p'}) as any;
 const t2=trackAnalysisReservation(noSite.repo);
 await assert.rejects(releaseOnFailure(()=>new CompanyAnalysisService(t2.repo,async url=>({url,html:''})).analyze_company('p1'),t2.reserved,async()=>{released++}),/OFFICIAL_WEBSITE_REQUIRED/);
 assert.equal(released,0);
});
test('I — the refund is commercial only: the hourly log row stays, and both analysis paths use it',()=>{
 assert.match(migration,/update prospectos_private\.discovery_quota_usage set billable=false where id=target;/);
 assert.doesNotMatch(migration,/delete from prospectos_private\.discovery_quota_usage/);
 assert.match(migration,/used_at > now\(\)-interval '1 hour';\n if used >= per_user then raise exception 'quota_exceeded'/,'hourly count ignores the billable flag');
 assert.match(discoveryApi,/releaseOnFailure\(\(\)=>analyzeProspectWebsite\(\{repo:tracked\.repo,/);
 assert.match(discoveryApi,/releaseOnFailure\(\(\)=>new CompanyAnalysisService\(tracked\.repo,/);
 assert.match(migration,/grant execute on function public\.release_commercial_use\(uuid,text\) to service_role;/);
 assert.match(migration,/revoke all on function public\.release_commercial_use\(uuid,text\) from public,anon,authenticated;/);
});

// ---------------------------------------------------------------- J: Discovery real vs fixture
test('J — a real Discovery is charged at launch whatever it finds; a fixture run is not charged to the plan',()=>{
 assert.match(migration,/perform prospectos_private\.consume_discovery_quota\(tenant,'discovery',p_provider<>'fixture'\);/);
 const services=discoveryApi; // the Discovery Engine itself is untouched: the provider id recorded is the one executed
 // Migration 019 added the register: the provider is built by the explicit factory (providers/index.ts), whose id
 // is the one recorded by start_discovery — 'registry' is billed like 'brave' by the unchanged line above.
 assert.match(services,/const provider=createDiscoveryProvider\(name,process\.env\);/);
});

// ---------------------------------------------------------------- K: beta capacity message
test('K — beta full: a clean FR/EN sentence, the internal code is never shown to the user',()=>{
 assert.equal(fr['error.betaCapacityReached'],'La bêta est actuellement complète. Contactez-nous pour être informé de la prochaine ouverture.');
 assert.equal(en['error.betaCapacityReached'],'The beta is currently full. Contact us to be notified when access reopens.');
 for(const locale of ['fr','en'] as const){const shown=localizeApiErrorMessage('La bêta est actuellement complète. Contactez-nous pour être informé de la prochaine ouverture.','BETA_CAPACITY_REACHED',locale);assert.doesNotMatch(shown,/BETA_CAPACITY_REACHED|CAPACITY/)}
 assert.match(route,/return json\(\{error:'La bêta est actuellement complète\. Contactez-nous pour être informé de la prochaine ouverture\.',code:'BETA_CAPACITY_REACHED'\},409\);/);
 assert.match(page,/code==='BETA_CAPACITY_REACHED'\)setNotice\(e\.message\)/,'the page shows the localized message, never the code');
 assert.match(migration,/^(?![\s\S]*beta_program)/,'capacity (10) is not touched by this migration');
});
