// Programme partenaires (052) — the server and browser logic with fakes: the ?ref= capture (sessionStorage only, never a
// cookie), the code sent with the sign-up, the Stripe webhook (invoice.paid and charge.refunded re-read from Stripe, the
// flag off changes nothing), the partner id in the Stripe metadata at checkout, the routes behind the flag, and the pages.
// The decisions themselves (attribution, window, idempotency, ledger, statements, visibility) are proven against the real
// database in tests/partner-program-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {normalizePartnerCode,refFromSearch,partnerSignupData,rememberRef,storedRef,REF_STORAGE_KEY,siretValid,invoiceAmounts,commissionOf,referralLink}
 from '../src/partners/model.ts';
import {partnersEnabled} from '../src/partners/flag.ts';
import {handleStripeWebhook,HANDLED_EVENTS} from '../src/server/billing/webhook.ts';
import {handlePartnerEvent,type PartnerStore} from '../src/server/billing/partners.ts';
import {startCheckout} from '../src/server/billing/checkout.ts';
import {billingConfig} from '../src/server/billing/config.ts';
import {signPayload} from '../src/server/billing/signature.ts';
import type {StripeApi,StripePrice,StripeSubscription,PartnerStripeApi,StripeInvoiceFull,StripeCharge} from '../src/server/billing/stripe-client.ts';
import type {BillingStore} from '../src/server/billing/store.ts';
import {handlePartners} from '../src/partners/api.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const KEY=['sk','test','unitfake000'].join('_');
const WHSEC=['whsec','unitfake000'].join('_');
const config=billingConfig({STRIPE_SECRET_KEY:KEY,STRIPE_WEBHOOK_SECRET:WHSEC,STRIPE_PRICE_BETA:'price_beta49',STRIPE_PRICE_PRO:'price_pro99',BILLING_ENABLED:'true',VERCEL_ENV:'preview'})!;
const USER='00000000-0000-4000-8000-000000000001',PARTNER='00000000-0000-4000-8000-0000000000aa';

// ── attribution in the browser ─────────────────────────────────────────────────────────────────────────────────────────
test('ref link: ?ref=CODE on any page is normalized and kept in sessionStorage only; a malformed code is dropped',()=>{
 assert.equal(normalizePartnerCode(' agence-a '),'AGENCEA');
 assert.equal(normalizePartnerCode('ab'),null);assert.equal(normalizePartnerCode('x'.repeat(21)),null);assert.equal(normalizePartnerCode('AG<script>'),null);
 assert.equal(refFromSearch('?utm=x&ref=conseilb'),'CONSEILB');assert.equal(refFromSearch('?ref='),null);assert.equal(refFromSearch(''),null);
 const mem=new Map<string,string>();const store={getItem:(k:string)=>mem.get(k)??null,setItem:(k:string,v:string)=>{mem.set(k,v)}};
 assert.equal(rememberRef(store,'?ref=agencea'),'AGENCEA');assert.equal(mem.get(REF_STORAGE_KEY),'AGENCEA');
 assert.equal(rememberRef(store,'?page=2'),null);assert.equal(mem.get(REF_STORAGE_KEY),'AGENCEA','a page without ref keeps the code of the tab');
 assert.equal(storedRef(store),'AGENCEA');
 const broken={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}};
 assert.equal(rememberRef(broken,'?ref=agencea'),'AGENCEA','blocked storage never breaks the page');assert.equal(storedRef(broken),'');assert.equal(storedRef(null),'');
 for(const f of ['../src/partners/model.ts','../src/partners/RefCapture.tsx','../src/partners/SignupCode.tsx'])assert.doesNotMatch(read(f),/document\.cookie|localStorage|Set-Cookie/i,`${f}: no cookie, no localStorage`);
 assert.match(read('../src/partners/RefCapture.tsx'),/window\.sessionStorage/);
});
test('sign-up: the code (from the link or typed, optional, editable) goes with the account; an empty or malformed one sends nothing',()=>{
 assert.deepEqual(partnerSignupData('agencea'),{partner_code:'AGENCEA'});assert.deepEqual(partnerSignupData(''),{});assert.deepEqual(partnerSignupData('?!'),{});
 const page=read('../app/page.tsx');
 assert.match(page,/data:\{terms_accepted_at:new Date\(\)\.toISOString\(\),terms_version:TERMS_VERSION,privacy_version:PRIVACY_VERSION,\.\.\.\(PARTNERS\?partnerSignupData\(partnerCode\):\{\}\)\}/);
 assert.match(page,/\{PARTNERS&&authView==='signup'&&<SignupCode value=\{partnerCode\} onChange=\{setPartnerCode\} locale=\{locale\}\/>\}/,'the field only with the flag, only at sign-up');
 const field=read('../src/partners/SignupCode.tsx');
 assert.match(field,/Code partenaire/);assert.doesNotMatch(field,/<input[^>]*\srequired/,'optional');
 assert.match(read('../app/layout.tsx'),/<PartnerRefCapture\/>/);assert.doesNotMatch(read('../app/layout.tsx'),/process\.env/,'the layout stays flag-free');
 assert.match(read('../src/partners/RefCapture.tsx'),/if\(!PARTNERS\)return/);
});
test('flag: off unless NEXT_PUBLIC_PARTNERS_ENABLED is true or 1',()=>{
 for(const v of [undefined,'','0','false','yes'])assert.equal(partnersEnabled(v),false,String(v));
 for(const v of ['1','true',' TRUE '])assert.equal(partnersEnabled(v),true,v);
});
test('SIRET and amounts: the same Luhn rule as the database; HT paid in the invoice’s own proportion',()=>{
 assert.equal(siretValid('999 000 001 00019'),true);assert.equal(siretValid('99900000100010'),false);assert.equal(siretValid('35600000000001'),true,'La Poste');
 assert.deepEqual(invoiceAmounts({amount_paid:9900,total:9900,total_excluding_tax:9900}),{paid:9900,ht:9900});
 assert.deepEqual(invoiceAmounts({amount_paid:11880,total:11880,total_excluding_tax:9900}),{paid:11880,ht:9900},'VAT excluded');
 assert.deepEqual(invoiceAmounts({amount_paid:5940,total:11880,total_excluding_tax:9900}),{paid:5940,ht:4950},'part paid from the customer balance');
 assert.equal(invoiceAmounts({amount_paid:9900,total:0,total_excluding_tax:0}),null);assert.equal(invoiceAmounts({amount_paid:-1,total:1,total_excluding_tax:1}),null);
 assert.equal(commissionOf(9900,30),2970);assert.equal(referralLink('https://prospectos.fr/','AGENCEA'),'https://prospectos.fr/?ref=AGENCEA');
});

// ── Stripe webhook ─────────────────────────────────────────────────────────────────────────────────────────────────────
const sub:StripeSubscription={id:'sub_1',customer:'cus_1',status:'active',cancel_at_period_end:false,livemode:false,
 items:{data:[{price:{id:'price_pro99',unit_amount:9900,currency:'eur',recurring:{interval:'month',interval_count:1}},current_period_start:1790000000,current_period_end:1792600000}]},latest_invoice:{id:'in_1',status:'paid'}};
function fakes(inv:Partial<StripeInvoiceFull>={},ch:Partial<StripeCharge>={}){
 const calls:any[]=[];const recorded:any[]=[];
 const api:StripeApi={retrievePrice:async()=>{throw Error('no')},createCustomer:async()=>({id:'cus_1'}),createCheckoutSession:async()=>({id:'cs',url:null}),
  createPortalSession:async()=>({url:''}),retrieveSubscription:async id=>{calls.push(['subscription',id]);return sub}};
 const partnerApi:PartnerStripeApi={
  retrieveInvoice:async id=>{calls.push(['invoice',id]);return {id,status:'paid',customer:'cus_1',currency:'eur',livemode:false,amount_paid:11880,total:11880,total_excluding_tax:9900,status_transitions:{paid_at:1793000000},...inv}},
  retrieveCharge:async id=>{calls.push(['charge',id]);return {id,livemode:false,currency:'eur',amount:11880,amount_refunded:11880,customer:'cus_1',payment_intent:'pi_1',...ch}},
  invoiceForPaymentIntent:async pi=>{calls.push(['invoice_payment',pi]);return 'in_1'},
  updateCustomerMetadata:async()=>({}),
 };
 const store:BillingStore={getAccount:async()=>null,linkCustomer:async(_u,c)=>c,applyState:async()=>({outcome:'granted',user_id:USER})};
 const seen=new Set<string>();
 const pstore:PartnerStore={
  recordInvoice:async a=>{recorded.push(['invoice',a]);if(seen.has(a.invoiceId))return {outcome:'duplicate'};seen.add(a.invoiceId);return {outcome:'recorded'}},
  recordRefund:async a=>{recorded.push(['refund',a]);return {outcome:'recorded'}},
 };
 return {api,partnerApi,store,pstore,calls,recorded};
}
const signed=(event:Record<string,unknown>)=>{const t=Math.floor(Date.now()/1000);const raw=JSON.stringify(event);return {raw,header:`t=${t},v1=${signPayload(raw,WHSEC,t)}`}};
const evt=(type:string,object:Record<string,unknown>,id='evt_1')=>({id,type,livemode:false,data:{object}});

test('invoice.paid: the subscription is applied as before, then the invoice is RE-READ from Stripe and recorded once (HT amount)',async()=>{
 const f=fakes();const deps={config,stripe:f.api,store:f.store,partners:{stripe:f.partnerApi,store:f.pstore}};
 // The body claims another amount and customer: never read.
 const e=signed(evt('invoice.paid',{id:'in_1',subscription:'sub_1',amount_paid:1,customer:'cus_evil'}));
 const r=await handleStripeWebhook(e.raw,e.header,deps);
 assert.equal(r.status,200);assert.deepEqual(r.body,{received:true,outcome:'granted',partner:'recorded'});
 assert.deepEqual(f.recorded[0],['invoice',{eventId:'evt_1',invoiceId:'in_1',customerId:'cus_1',paidAt:new Date(1793000000*1000).toISOString(),paidCents:11880,paidHtCents:9900,currency:'eur'}]);
 assert.deepEqual(f.calls.map(c=>c[0]),['subscription','invoice']);
 const again=await handleStripeWebhook(e.raw,e.header,deps);
 assert.equal(again.body.partner,'duplicate','a replayed webhook never makes a second line (the database decides; proven in the DB test)');
});
test('charge.refunded: re-read, the invoice found through its payment, recorded as a negative line by the database',async()=>{
 const f=fakes();const deps={config,stripe:f.api,store:f.store,partners:{stripe:f.partnerApi,store:f.pstore}};
 const e=signed(evt('charge.refunded',{id:'ch_1',amount_refunded:999999},'evt_r1'));
 const r=await handleStripeWebhook(e.raw,e.header,deps);
 assert.deepEqual(r.body,{received:true,partner:'recorded'});
 assert.deepEqual(f.recorded[0],['refund',{eventId:'evt_r1',chargeId:'ch_1',invoiceId:'in_1',refundedTotalCents:11880}]);
 assert.ok(!f.calls.some(c=>c[0]==='subscription'),'a refund never re-reads or changes the subscription');
 const legacy=fakes({},{invoice:'in_9'});
 await handlePartnerEvent(evt('charge.refunded',{id:'ch_2'}),false,{stripe:legacy.partnerApi,store:legacy.pstore});
 assert.equal(legacy.recorded[0][1].invoiceId,'in_9');assert.ok(!legacy.calls.some(c=>c[0]==='invoice_payment'));
});
test('flag OFF (no partner deps): the webhook is exactly as before — charge.refunded ignored, invoice.paid without a partner line',async()=>{
 const f=fakes();const deps={config,stripe:f.api,store:f.store};
 const e=signed(evt('charge.refunded',{id:'ch_1'}));
 assert.deepEqual((await handleStripeWebhook(e.raw,e.header,deps)).body,{received:true,ignored:true});
 const p=signed(evt('invoice.paid',{id:'in_1',subscription:'sub_1'}));
 assert.deepEqual((await handleStripeWebhook(p.raw,p.header,deps)).body,{received:true,outcome:'granted'});
 assert.deepEqual(f.calls.map(c=>c[0]),['subscription'],'no invoice or charge read');assert.equal(f.recorded.length,0);
 assert.deepEqual([...HANDLED_EVENTS].sort(),['checkout.session.completed','customer.subscription.created','customer.subscription.deleted','customer.subscription.updated','invoice.paid','invoice.payment_failed']);
});
test('webhook guards: a TEST invoice never counts on LIVE; an unpaid invoice or inconsistent amounts make no line',async()=>{
 for(const [inv,outcome] of [[{livemode:true},'livemode_mismatch'],[{status:'open'},'not_paid'],[{total:0},'invalid_amounts'],[{status_transitions:{}},'not_paid']] as const){
  const f=fakes(inv as Partial<StripeInvoiceFull>);
  assert.equal((await handlePartnerEvent(evt('invoice.paid',{id:'in_1'}),false,{stripe:f.partnerApi,store:f.pstore})).outcome,outcome);
  assert.equal(f.recorded.length,0);
 }
 const f=fakes();assert.equal((await handlePartnerEvent(evt('invoice.paid',{id:'../x'}),false,{stripe:f.partnerApi,store:f.pstore})).outcome,'ignored');
});

// ── checkout metadata ──────────────────────────────────────────────────────────────────────────────────────────────────
const price=(id:string,unit:number):StripePrice=>({id,active:true,currency:'eur',unit_amount:unit,livemode:false,recurring:{interval:'month',interval_count:1},type:'recurring'});
function checkoutFakes(existing:boolean){
 const calls:any[]=[];
 const api:StripeApi={retrievePrice:async id=>price(id,id==='price_pro99'?9900:4900),createCustomer:async(params,key)=>{calls.push(['customer',params,key]);return {id:'cus_new'}},
  createCheckoutSession:async(params,key)=>{calls.push(['session',params,key]);return {id:'cs',url:'https://checkout.stripe.com/c/pay/cs'}},
  createPortalSession:async()=>({url:''}),retrieveSubscription:async()=>sub,updateCustomerMetadata:async(id,m)=>{calls.push(['update',id,m]);return {}}};
 const store:BillingStore={getAccount:async()=>existing?{user_id:USER,stripe_customer_id:'cus_old',stripe_subscription_id:null,stripe_price_id:null,plan:null,subscription_status:null,current_period_start:null,current_period_end:null,cancel_at_period_end:false}:null,
  linkCustomer:async(_u,c)=>c,applyState:async()=>({outcome:'x',user_id:null})};
 return {api,store,calls};
}
test('checkout: the referring partner id is copied into the Stripe customer and subscription metadata; without it, nothing changes',async()=>{
 const a=checkoutFakes(false);
 await startCheckout({userId:USER,email:'c@x.test',body:{plan:'PRO'},origin:'https://p.test'},{config,stripe:a.api,store:a.store,partnerOf:async()=>PARTNER});
 assert.equal(a.calls.find(c=>c[0]==='customer')[1].partnerId,PARTNER);
 const s=a.calls.find(c=>c[0]==='session')[1];
 assert.deepEqual(s.metadata,{prospectos_user_id:USER,prospectos_plan:'PRO',prospectos_partner_id:PARTNER});assert.deepEqual(s.subscription_data.metadata,s.metadata);
 const b=checkoutFakes(true);
 await startCheckout({userId:USER,email:'c@x.test',body:{plan:'PRO'},origin:'https://p.test'},{config,stripe:b.api,store:b.store,partnerOf:async()=>PARTNER});
 assert.deepEqual(b.calls.find(c=>c[0]==='update'),['update','cus_old',{prospectos_partner_id:PARTNER}]);
 const c=checkoutFakes(false);
 await startCheckout({userId:USER,email:'c@x.test',body:{plan:'PRO'},origin:'https://p.test'},{config,stripe:c.api,store:c.store});
 assert.deepEqual(c.calls.find(x=>x[0]==='session')[1].metadata,{prospectos_user_id:USER,prospectos_plan:'PRO'},'flag off: the metadata is exactly as before');
 assert.deepEqual(c.calls.find(x=>x[0]==='customer')[1],{email:'c@x.test',userId:USER});
});

// ── routes, pages, job ─────────────────────────────────────────────────────────────────────────────────────────────────
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s});
test('routes: 404 with the flag off; the database answers the rest (the partner reads only partner_space)',async()=>{
 const rpc:any[]=[];const db={rpc:async(fn:string,args:unknown)=>{rpc.push([fn,args]);return {data:{ok:true},error:null}}} as any;
 const off=await handlePartners(new Request('http://x/api/v1/partners/me'),['partners','me'],db,json,{enabled:false,origin:'https://p.test'});
 assert.equal(off!.status,404);assert.equal(rpc.length,0);
 assert.equal(await handlePartners(new Request('http://x'),['projects'],db,json,{enabled:true,origin:'https://p.test'}),null);
 await handlePartners(new Request('http://x/api/v1/partners/me'),['partners','me'],db,json,{enabled:true,origin:'https://p.test'});
 assert.deepEqual(rpc.at(-1),['partner_space',{}]);
 const bad=await handlePartners(new Request('http://x',{method:'POST',body:JSON.stringify({name:'A',company:'B',siret:'1',email:'x',code:'a',rate_percent:30})}),['partners','admin','partners'],db,json,{enabled:true,origin:'https://p.test'});
 assert.equal(bad!.status,422);
 await handlePartners(new Request('http://x',{method:'POST',body:JSON.stringify({name:'Alice Martin',company:'Agence Exemple',siret:'99900000100019',email:'a@b.test',code:'agence-a',rate_percent:30})}),['partners','admin','partners'],db,json,{enabled:true,origin:'https://p.test'});
 assert.deepEqual(rpc.at(-1),['create_partner',{p_name:'Alice Martin',p_company:'Agence Exemple',p_siret:'99900000100019',p_email:'a@b.test',p_code:'AGENCEA',p_rate_percent:30}]);
 const paid=await handlePartners(new Request('http://x',{method:'POST',body:JSON.stringify({paid_on:'2026-12-05',reference:'VIR-2026-12'})}),['partners','admin','statements','00000000-0000-4000-8000-000000000001','paid'],db,json,{enabled:true,origin:'https://p.test'});
 assert.equal(paid!.status,200);assert.equal(rpc.at(-1)[0],'mark_partner_statement_paid');
 const deny={rpc:async()=>({data:null,error:{message:'Admin access required',code:'42501'}})} as any;
 assert.equal((await handlePartners(new Request('http://x/api/v1/partners/admin'),['partners','admin'],deny,json,{enabled:true,origin:'https://p.test'}))!.status,403);
});
test('pages and job: behind the flag; the public page through the legal envelope with its form; the job on the 1st only',()=>{
 for(const f of ['../app/partenaires/page.tsx','../app/partenaires/espace/page.tsx','../app/partenaires/admin/page.tsx'])assert.match(read(f),/if\(!PARTNERS\)notFound\(\)/,f);
 assert.match(read('../app/partenaires/page.tsx'),/<LegalPage /);assert.match(read('../app/partenaires/page.tsx'),/<PartnerApplicationForm/);
 for(const f of ['../app/partenaires/espace/page.tsx','../app/partenaires/admin/page.tsx'])assert.match(read(f),/robots:\{index:false,follow:false\}/,f);
 const cron=read('../app/api/cron/partner-statements/route.ts');
 assert.match(cron,/partnersEnabledIn\(process\.env\)/);assert.match(cron,/generate_partner_statements/);assert.match(cron,/authorization/i);
 assert.match(read('../vercel.json'),/"\/api\/cron\/partner-statements"/);
 const form=read('../app/api/public/partenaires/route.ts');
 assert.match(form,/submit_partner_application/);assert.match(form,/hitForAddress/);assert.match(form,/partnersEnabledIn\(process\.env\)/);
 assert.ok(existsSync(new URL('../docs/PARTNERS.md',import.meta.url)));
});
test('space: no client name or e-mail is ever rendered — anonymous references and amounts only',()=>{
 const views=read('../src/ui/v2/partners/PartnerViews.tsx');
 assert.match(views,/l\.client/);assert.doesNotMatch(views,/organization|\.email\b(?!\})|client_name/i);
});
