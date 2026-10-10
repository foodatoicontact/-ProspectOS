// AI outreach quota on the client side: the "IA Outreach used / limit" counter in the Account tab (its own counter,
// never mixed with Discovery, site analyses or AI offer analyses), an older server without the fields still showing
// the other counters, and an exhausted quota giving the rule-based message with a clear "AI unavailable" note.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {usageView} from '../src/domain/pricing.ts';
import {usageCounterLabel} from '../src/i18n/index.ts';
import {generateOutreachWithAi} from '../src/outreach/ai-generate.ts';

const base={plan:'PAID',status:'ACTIVE',active:true,period_end:'2099-01-01T00:00:00Z',discovery_used:1,discovery_limit:100,analysis_used:2,analysis_limit:250,ai_offer_used:3,ai_offer_limit:25};
test('usage view: AI outreach is its own counter (7 / 25), separate from the others; absent fields → no counter, the rest unchanged',()=>{
 const v=usageView({...base,ai_outreach_used:7,ai_outreach_limit:25}) as any;
 assert.deepEqual(v.aiOutreach,{used:7,limit:25,reached:false});
 assert.deepEqual(v.aiOffer,{used:3,limit:25,reached:false});assert.deepEqual(v.discovery,{used:1,limit:100,reached:false});
 assert.equal((usageView({...base,ai_outreach_used:25,ai_outreach_limit:25}) as any).aiOutreach.reached,true);
 const old=usageView(base) as any;assert.ok(old,'an older server answer still shows the other counters');assert.equal(old.aiOutreach,null);
});
test('label: "IA Outreach : 7 / 25" / "AI Outreach: 7 / 25"',()=>{
 assert.equal(usageCounterLabel('fr','ai_outreach' as any,7,25),'IA Outreach : 7 / 25');
 assert.equal(usageCounterLabel('en','ai_outreach' as any,7,25),'AI Outreach: 7 / 25');
});
test('Account tab: the counter is shown next to the others, in both usage blocks',async()=>{
 for(const f of ['../src/components/BillingSection.tsx','../app/page.tsx']){
  const s=await readFile(new URL(f,import.meta.url),'utf8');
  assert.match(s,/usage\.aiOutreach&&<p className=\{usage\.aiOutreach\.reached\?'reached':''\}>\{usageCounterLabel\(locale,'ai_outreach',usage\.aiOutreach\.used,usage\.aiOutreach\.limit\)\}<\/p>/,f);
 }
});
test('quota exhausted → rule-based, no provider call, no unit; the UI says the AI is unavailable',async()=>{
 const calls:string[]=[];
 const composed={text:'Bonjour l’équipe K, message sûr.',evidence_ids:[],signal_ids:[],public_content_ids:[],provider:'rule_based_v1' as const,why_now:null,angle:{type:'generic' as const,source_id:null,label:'',reason:'NO_VERIFIED_DATA',source_url:null,observed_at:null,excerpt:null}};
 // As the route's checked(): the database refusal travels as the error's cause.
 const r=await generateOutreachWithAi({composed,name:'K',offer:'',locale:'fr',style:null,sources:[],userId:'me'},{userId:'me',
  availability:async()=>({ok:true,apiKeyOverride:null,billingSource:'PLATFORM'}),
  reserve:async()=>{calls.push('reserve');throw Error('DATABASE_REQUEST_FAILED',{cause:{message:'ai_outreach_limit_reached'}})},
  loadExampleRows:async()=>{calls.push('examples');return []},call:async()=>{calls.push('call');return {text:'',usage:null}},meter:async()=>{calls.push('meter')}});
 assert.equal(r.provider,'rule_based_v1');assert.equal(r.attempted,false);assert.equal(r.fallback_reason,'AI_OUTREACH_LIMIT_REACHED');assert.equal(r.text,composed.text);
 assert.deepEqual(calls,['reserve']);
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/result\.ai\?\.attempted===false\?'unavailable'/);assert.match(page,/aiNote==='unavailable'\?tr\('outreach\.aiUnavailable'\)/);
 for(const lang of ['fr','en']){const dict=(await import(`../src/i18n/${lang}.ts`))[lang];assert.ok(dict['outreach.aiUnavailable'],lang)}
});
