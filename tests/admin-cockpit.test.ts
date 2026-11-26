// Cockpit administrateur (migration 056, owner decision 26 nov. 2026): the push channel (ntfy, no personal data), the feed's
// vocabulary and API, and the wiring of every source (forms, Stripe webhook, jobs). The database side — sources, append-only,
// RLS — is tests/admin-cockpit-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pushConfig,pushRequest,dispatchAdminPush,PUSH_KINDS} from '../src/cockpit/push.ts';
import {FEED_KINDS,FEED_GROUPS,KIND_LABEL,eventSummary,stripeLink,type FeedEvent} from '../src/cockpit/model.ts';
import {handleCockpit,parseFeedQuery} from '../src/cockpit/api.ts';
import {parseWatchRequest} from '../src/domain/watch-request.ts';
const read=(f:string)=>readFileSync(new URL(`../${f}`,import.meta.url),'utf8');
const TOPIC='prospectos-k3v9x2m7q8w4';

test('push config — a secret topic of 16+ characters, https only, an optional token; anything else sends nothing',()=>{
 assert.equal(pushConfig({}),null);
 assert.equal(pushConfig({NTFY_TOPIC:'court'}),null,'a guessable topic');
 assert.equal(pushConfig({NTFY_TOPIC:'a/b/../../c-xxxxxxxxxxxx'}),null,'no path in the topic');
 assert.deepEqual(pushConfig({NTFY_TOPIC:TOPIC}),{url:'https://ntfy.sh',topic:TOPIC,token:null});
 assert.equal(pushConfig({NTFY_TOPIC:TOPIC,NTFY_URL:'http://ntfy.sh'}),null,'never in clear text');
 assert.equal(pushConfig({NTFY_TOPIC:TOPIC,NTFY_URL:'https://user:pw@ntfy.example'}),null);
 assert.deepEqual(pushConfig({NTFY_TOPIC:TOPIC,NTFY_URL:'https://ntfy.example/',NTFY_TOKEN:'tk_abcdefgh'}),{url:'https://ntfy.example',topic:TOPIC,token:'tk_abcdefgh'});
});

test('push message — the kind and a link to the cockpit only: no name, no e-mail, no amount; ASCII headers',()=>{
 const cfg=pushConfig({NTFY_TOPIC:TOPIC,NTFY_TOKEN:'tk_abcdefgh'})!;
 assert.deepEqual([...PUSH_KINDS].sort(),['CANCELLATION','COMMISSION_DUE','PAYMENT_FAILED','WATCH_REQUEST'],'the four kinds the owner asked for');
 for(const k of PUSH_KINDS){
  const {url,init}=pushRequest(cfg,k,'https://prospectos.fr/cockpit');
  assert.equal(url,`https://ntfy.sh/${TOPIC}`);
  const h=init.headers as Record<string,string>;
  assert.equal(h.Click,'https://prospectos.fr/cockpit');assert.equal(h.Authorization,'Bearer tk_abcdefgh');
  for(const v of Object.values(h))assert.match(v,/^[\x20-\x7e]*$/,'header values are ASCII');
  assert.doesNotMatch(String(init.body),/@|€|\d/,'no e-mail, no amount, no number');
  assert.equal(init.redirect,'error');
 }
 assert.match(pushRequest(cfg,'WATCH_REQUEST','x').init.headers!['Title' as keyof HeadersInit] as string,/Demande de veille/);
});

test('push dispatch — claims, sends each one, reports it; a failure is reported for retry; unconfigured = nothing claimed',async()=>{
 const calls:[string,Record<string,unknown>][]=[];const sent:string[]=[];
 const rpc=async(fn:string,args:Record<string,unknown>)=>{calls.push([fn,args]);return fn==='claim_admin_push'?[{id:1,kind:'WATCH_REQUEST'},{id:2,kind:'PAYMENT_FAILED'},{id:3,kind:'SIGNUP'}]:{state:'SENT'}};
 const fetchStub=(async(url:string)=>{sent.push(url);return {ok:sent.length===1}}) as unknown as typeof fetch;
 const r=await dispatchAdminPush({rpc,fetch:fetchStub,config:pushConfig({NTFY_TOPIC:TOPIC}),cockpitUrl:'https://prospectos.fr/cockpit'});
 assert.deepEqual(r,{sent:1,failed:1});
 assert.equal(sent.length,2,'a kind that is not pushed is never sent');
 assert.deepEqual(calls.slice(1),[['finish_admin_push',{p_event_id:1,p_sent:true}],['finish_admin_push',{p_event_id:2,p_sent:false}]]);
 const none:string[]=[];
 assert.deepEqual(await dispatchAdminPush({rpc:async fn=>{none.push(fn);return []},fetch:fetchStub,config:null,cockpitUrl:'x'}),{sent:0,failed:0,skipped:'PUSH_NOT_CONFIGURED'});
 assert.deepEqual(none,[],'the queue waits: nothing claimed without a topic');
 assert.deepEqual(await dispatchAdminPush({rpc:async()=>{throw Error('x')},fetch:fetchStub,config:pushConfig({NTFY_TOPIC:TOPIC}),cockpitUrl:'x'}),{sent:0,failed:0,skipped:'QUEUE_UNAVAILABLE'},'never throws');
});

test('feed vocabulary — every kind labelled and in exactly one filter group; one readable line per event, resolved from its source',()=>{
 for(const k of FEED_KINDS)assert.ok(KIND_LABEL[k]);
 assert.deepEqual(FEED_GROUPS.flatMap(g=>g.kinds).sort(),[...FEED_KINDS].sort());
 const e=(kind:FeedEvent['kind'],p:Partial<FeedEvent>={}):FeedEvent=>({id:1,kind,occurred_at:'2026-11-26T08:00:00Z',organization_id:'o',organization:'Agence Client',source_table:'stripe_webhook_events',source_id:'evt_1',detail:{},source:null,...p});
 assert.equal(eventSummary(e('PLAN_CHANGED',{detail:{from:'PAID',to:'PRO'}})),'Agence Client — Solo → Pro');
 assert.equal(eventSummary(e('PLAN_CHANGED',{detail:{from:null,to:'TEAM'}})),'Agence Client — souscription Équipe');
 assert.equal(eventSummary(e('WATCH_REQUEST',{source:{activity:'Expertise comptable',department:'31',company:'Cabinet X'}})),'Cabinet X — Expertise comptable · département 31');
 assert.match(eventSummary(e('WATCH_REQUEST')),/supprimée/,'a request deleted after 12 months says so');
 assert.match(eventSummary(e('COMMISSION_DUE',{source:{company:'Agence Exemple',balance_cents:6000,paid:false}})),/Agence Exemple — solde 60,00\s€/);
 assert.equal(stripeLink(e('INVOICE_PAID')),'https://dashboard.stripe.com/events/evt_1');
 assert.equal(stripeLink(e('SIGNUP',{source_table:'organizations'})),null);
});

test('feed API — filters validated before the database; the refusal of a non-administrator is a 403',async()=>{
 assert.ok(parseFeedQuery(new URLSearchParams('kinds=SIGNUP,WATCH_REQUEST&from=2026-11-01&to=2026-11-26&before=12&limit=50')).success);
 assert.ok(!parseFeedQuery(new URLSearchParams('kinds=DROP_TABLE')).success);
 assert.ok(!parseFeedQuery(new URLSearchParams('from=26/11/2026')).success);
 assert.ok(!parseFeedQuery(new URLSearchParams('limit=5000')).success);
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
 const args:Record<string,unknown>[]=[];
 const db={rpc:async(_:string,a:Record<string,unknown>)=>{args.push(a);return {data:null,error:{message:'Admin access required',code:'42501'}}}} as any;
 const r=await handleCockpit(new Request('https://x/api/v1/cockpit/feed?kinds=CANCELLATION'),['cockpit','feed'],db,json);
 assert.equal(r!.status,403);
 assert.deepEqual(args[0],{p_kinds:['CANCELLATION'],p_from:null,p_to:null,p_before:null,p_limit:50});
 assert.equal((await handleCockpit(new Request('https://x/api/v1/cockpit/feed?from=2026-11-26&to=2026-11-01'),['cockpit','feed'],db,json))!.status,422);
 assert.equal(await handleCockpit(new Request('https://x/api/v1/leads'),['leads'],db,json),null);
 assert.match(read('app/api/v1/[...path]/route.ts'),/const cockpitResponse=await handleCockpit\(request,path,db,json\);/,'behind the signed-in session and its rate limit');
});

test('quote form — the same validation as the "3 prospects" form, plus the company; a robot is answered like a success',()=>{
 const ok=parseWatchRequest({activity:'Expertise comptable',target:'Reprises',department:'31',company:'Cabinet X',email:'Contact@Cabinet.fr',message:'',consent:true});
 assert.ok(ok.ok&&ok.request.email==='contact@cabinet.fr'&&ok.request.company==='Cabinet X');
 assert.deepEqual(parseWatchRequest({activity:'x',department:'31',email:'a@b.fr',consent:true}),{ok:false,error:'ACTIVITY_REQUIRED'});
 assert.deepEqual(parseWatchRequest({activity:'Compta',department:'999',email:'a@b.fr',consent:true}),{ok:false,error:'DEPARTMENT_INVALID'});
 assert.deepEqual(parseWatchRequest({activity:'Compta',department:'31',email:'a@b.fr',consent:false}),{ok:false,error:'CONSENT_REQUIRED'});
 assert.deepEqual(parseWatchRequest({activity:'Compta',department:'31',email:'a@b.fr',consent:true,website:'http://spam'}),{ok:false,error:'SPAM'});
 const route=read('app/api/public/demande-veille/route.ts');
 assert.match(route,/new URL\(origin\)\.host!==host\)return json\(403/);
 assert.match(route,/if\(raw\.length>4000\)return json\(413/);
 assert.match(route,/bucket:'watch_request',limit:5,windowSeconds:3600/);
 assert.match(route,/rpc\('submit_contact_request',\{p_kind:'WATCH',/);
 assert.ok(route.indexOf("rpc('submit_contact_request'")<route.indexOf('sendPendingPush(admin)'),'stored, then the push');
 assert.match(route,/transport\.send\(\{to:PROSPECT_REQUEST_TO,/,'the notice goes to ProspectOS only');
 assert.doesNotMatch(route,/r\.email\}|\$\{r\.email|to:r\.|to:parsed/,'the requester\'s e-mail is neither in the notice nor a recipient');
 assert.match(read('src/components/PricingPage.tsx'),/<a href="\/demande-veille">Demander un devis<\/a>/,'the mailto is replaced');
 assert.match(read('src/components/WatchRequestForm.tsx'),/Elles sont supprimées 12 mois après l’envoi/);
});

test('sources wired — Stripe webhook, collection jobs, partner statements and the daily cockpit job',()=>{
 const hook=read('app/api/v1/billing/stripe/webhook/route.ts');
 assert.match(hook,/if\(result\.status===200\)\{try\{await sendPendingPush\(createAdminClient\(\)\)\}catch\{\}\}/,'after a processed event, never changing the answer to Stripe');
 assert.ok(hook.indexOf('handleStripeWebhook(raw')<hook.indexOf('sendPendingPush('));
 assert.match(read('app/api/cron/collect/route.ts'),/rpc\('record_collect_failure',\{p_job:'collect',p_code:'COLLECT_FAILED'\}\)/);
 assert.match(read('app/api/cron/enrich/[slot]/route.ts'),/rpc\('record_collect_failure',\{p_job:`enrich-\$\{slot\}`,p_code:'ENRICH_FAILED'\}\)/);
 assert.match(read('app/api/cron/partner-statements/route.ts'),/if\(generated>0\)await sendPendingPush\(admin\);/);
 const cron=read('app/api/cron/cockpit/route.ts');
 assert.match(cron,/cronAuthorized\(request\.headers\.get\('authorization'\),process\.env\.CRON_SECRET\)/);
 assert.ok(cron.indexOf("rpc('sweep_admin_events')")<cron.indexOf('sendPendingPush(admin)'));
});

test('screen — /cockpit is never indexed, reads the feed through the API only; the menu entry is the administrator’s only',()=>{
 const page=read('app/cockpit/page.tsx');
 assert.match(page,/robots:\{index:false,follow:false\}/);
 const app=read('src/ui/v2/cockpit/CockpitApp.tsx');
 assert.match(app,/fetch\(`\/api\/v1\/\$\{path\}`,\{headers:\{Authorization:`Bearer \$\{token\}`\}\}\)/);
 assert.doesNotMatch(app+read('src/ui/v2/cockpit/CockpitFeed.tsx'),/\.from\(|\.rpc\(|service_role|SUPABASE_SERVICE/,'no direct database read from the browser');
 assert.match(read('src/ui/v2/shell/UserMenu.tsx'),/\{live&&p\.internal&&<li><a className="pos-menu__item" href="\/cockpit"/);
 const css=read('src/ui/v2/cockpit/cockpit.css');
 assert.doesNotMatch(css.replace(/var\(--pos-[a-z0-9-]+(,[^)]*)?\)/g,''),/#[0-9a-f]{3,6}\b|rgb\(/i,'tokens only');
});
