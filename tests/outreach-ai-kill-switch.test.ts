import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// ============================================================
// AI outreach kill switch (AI_OUTREACH_ENABLED, src/outreach/ai-switch.ts). Absent / "false" / anything but "true" or "1"
// = hard OFF: no availability check (so no BYOK credential read), no unit reserved, no provider call, no metering — the
// rule-based message only; the browser shows neither the "use AI" option nor an AI outreach counter. The switch is AI
// outreach only: the offer analysis keeps using a stored BYOK key exactly as before.
// Every key is fake; the network is always mocked — no real provider call.
// ============================================================

const {aiOutreachEnabled,withAiOutreachUsage}=await import('../src/outreach/ai-switch.ts');
const {generateOutreachWithAi}=await import('../src/outreach/ai-generate.ts');
const {composeOutreachMessage,analyzeOffer}=await import('../src/server/ai.ts');

const FAKE_BYOK='fake-byok-key-for-tests-0001';
const composed={text:'Bonjour l’équipe Kerlan, message factuel.',evidence_ids:['e1'],signal_ids:[],public_content_ids:[],provider:'rule_based_v1' as const,why_now:null,
 angle:{type:'evidence' as const,source_id:'e1',label:'l',reason:'VERIFIED_EVIDENCE',source_url:'https://www.example.fr/',observed_at:null,excerpt:'Kerlan recrute.'}} as any;
const input={composed,name:'Kerlan',offer:'Nous auditons la sécurité des sites industriels.',locale:'fr' as const,style:null,sources:['Kerlan recrute.'],userId:'me'};
const VALID='Bonjour, j’ai vu que Kerlan recrute. Nous auditons la sécurité des sites industriels. Seriez-vous ouvert à un court échange ?';

// A stored BYOK key is "available" for this organization: the route's availability() would return it.
function byokDeps(enabled:boolean,call?:(req:any,key:string|null)=>Promise<any>){
 const log:string[]=[];const keys:(string|null)[]=[];
 const d={enabled,userId:'me',
  availability:async()=>{log.push('availability');return {ok:true as const,apiKeyOverride:FAKE_BYOK,billingSource:'BYOK' as const}},
  reserve:async()=>{log.push('reserve');return 'usage-1'},
  loadExampleRows:async()=>{log.push('examples');return []},
  call:async(req:any,key:string|null)=>{log.push('call');keys.push(key);return call?call(req,key):{text:JSON.stringify({message:VALID}),usage:{provider:'anthropic' as const,model:'m',input_tokens:10,output_tokens:5}}},
  meter:async()=>{log.push('meter')}};
 return {d,log,keys};
}

test('1 — AI_OUTREACH_ENABLED absent ⇒ hard OFF',()=>{
 assert.equal(aiOutreachEnabled({}),false);
 assert.equal(aiOutreachEnabled({AI_OUTREACH_ENABLED:undefined}),false);
});

test('2 — "false" (and every other value but true / 1) ⇒ hard OFF',()=>{
 for(const v of ['false','FALSE','0','',' ','no','off','yes','enabled','truee','tru','2'])assert.equal(aiOutreachEnabled({AI_OUTREACH_ENABLED:v}),false,JSON.stringify(v));
 for(const v of ['true','TRUE',' true ','1'])assert.equal(aiOutreachEnabled({AI_OUTREACH_ENABLED:v}),true,JSON.stringify(v));
});

test('3 — ON + BYOK ⇒ the AI path is allowed: availability, one unit, the provider call with the BYOK key',async()=>{
 const {d,log,keys}=byokDeps(aiOutreachEnabled({AI_OUTREACH_ENABLED:'true'}));
 const r=await generateOutreachWithAi(input,d);
 assert.deepEqual(log,['availability','reserve','examples','call','meter']);
 assert.deepEqual(keys,[FAKE_BYOK]);
 assert.deepEqual({provider:r.provider,attempted:r.attempted,usage_id:r.usage_id,outcome:r.outcome},{provider:'ai_composer_v1',attempted:true,usage_id:'usage-1',outcome:'AI_VALID'});
});

test('4 — OFF + an existing BYOK key ⇒ zero provider call, zero AI outreach unit, zero BYOK read, rule-based message',async()=>{
 for(const env of [{},{AI_OUTREACH_ENABLED:'false'}]){
  const fetchSpy=mock.method(globalThis,'fetch',async()=>{throw Error('must not be called')});
  // The real provider function behind the injected call: if anything reached it, fetch would be called.
  const {d,log}=byokDeps(aiOutreachEnabled(env),(req,key)=>composeOutreachMessage(req,{apiKeyOverride:key}));
  const r=await generateOutreachWithAi(input,d);
  assert.deepEqual(log,[],'no availability (no BYOK read), no reserve, no examples, no call, no meter');
  assert.equal(fetchSpy.mock.callCount(),0,'no network');
  assert.deepEqual({provider:r.provider,attempted:r.attempted,usage_id:r.usage_id,outcome:r.outcome,fallback_reason:r.fallback_reason,text:r.text},
   {provider:'rule_based_v1',attempted:false,usage_id:null,outcome:null,fallback_reason:'AI_OUTREACH_DISABLED',text:composed.text});
  fetchSpy.mock.restore();
 }
});

test('4b — fail closed: a caller that forgets the switch gets no attempt',async()=>{
 const {d,log}=byokDeps(true);const {enabled:_e,...withoutSwitch}=d;
 const r=await generateOutreachWithAi(input,withoutSwitch as any);
 assert.deepEqual(log,[]);assert.equal(r.attempted,false);assert.equal(r.fallback_reason,'AI_OUTREACH_DISABLED');
});

test('5 — other BYOK uses are unaffected: with the switch absent, the offer analysis still uses the stored BYOK key',async()=>{
 const saved={p:process.env.AI_PROVIDER,m:process.env.AI_MODEL,k:process.env.AI_API_KEY,s:process.env.AI_OUTREACH_ENABLED};
 process.env.AI_PROVIDER='anthropic';process.env.AI_MODEL='claude-test';delete process.env.AI_API_KEY;delete process.env.AI_OUTREACH_ENABLED;
 const seen:string[]=[];
 const fetchSpy=mock.method(globalThis,'fetch',async(_url:string,init:any)=>{seen.push(init.headers['x-api-key']);
  return {ok:true,status:200,json:async()=>({content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:3,output_tokens:4}})} as unknown as Response});
 try{
  const r=await analyzeOffer('un texte public suffisamment long pour passer la validation métier',{apiKeyOverride:FAKE_BYOK});
  assert.equal(fetchSpy.mock.callCount(),1);assert.deepEqual(seen,[FAKE_BYOK]);assert.equal(r.credential_source,'BYOK');
 }finally{
  fetchSpy.mock.restore();
  for(const [k,v] of [['AI_PROVIDER',saved.p],['AI_MODEL',saved.m],['AI_API_KEY',saved.k],['AI_OUTREACH_ENABLED',saved.s]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
});

test('5b — the switch is read only by the AI outreach path: not by the offer analysis, BYOK, Discovery or signals',async()=>{
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.equal((route.match(/aiOutreachEnabled\(process\.env\)/g)??[]).length,3,'outreach generation deps + the account answer (flag, counters)');
 assert.match(route,/enabled:aiOutreachEnabled\(process\.env\),\n\s+userId:user\.id,/);
 for(const f of ['../src/server/ai.ts','../src/server/byok.ts','../src/discovery/api.ts','../src/signals/api.ts','../src/server/ai-guard.ts'])
  assert.doesNotMatch(await readFile(new URL(f,import.meta.url),'utf8'),/AI_OUTREACH_ENABLED|aiOutreachEnabled/,f);
});

test('6 — the account answer drops only the AI outreach counter while OFF',()=>{
 const usage={plan:'BETA',discovery_used:1,discovery_limit:5,analysis_used:0,analysis_limit:5,ai_offer_used:2,ai_offer_limit:3,ai_outreach_used:0,ai_outreach_limit:25};
 const {ai_outreach_used:_u,ai_outreach_limit:_l,...rest}=usage;
 assert.deepEqual(withAiOutreachUsage(usage,false),rest);
 assert.deepEqual(withAiOutreachUsage(usage,true),usage);
 assert.equal(withAiOutreachUsage(null,false),null);
});

test('7 — the browser offers AI outreach only when the server says the switch is on',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/const \[aiOutreachOn,setAiOutreachOn\]=useState\(false\)/,'off until the server says otherwise');
 assert.equal((page.match(/setAiOutreachOn\(acc\.ai_outreach_enabled===true\)/g)??[]).length,2,'set from the account answer (load + refresh), strict true');
 assert.match(page,/\{mode==='live'&&aiOutreachOn&&<label className="checkbox"><input type="checkbox" checked=\{useAi\}/);
 assert.match(page,/ai:useAi&&aiOutreachOn\}/);
 // Legacy record + Prospects 2.0 record (UI-5A, only one is ever rendered): both behind the same server switch.
 assert.equal((page.match(/tr\('outreach\.useAi'\)/g)??[]).length,2,'the only "use AI" options are the gated ones');
 assert.match(page,/ai:mode==='live'&&aiOutreachOn\?\{checked:useAi,label:tr\('outreach\.useAi'\),onChange:setUseAi\}:null/);
});
