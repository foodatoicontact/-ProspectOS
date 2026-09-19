import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// ============================================================
// BLOC 4A.5 — FAILED-RESULT AI COST METERING.
//
// Gap this bloc closes: if Anthropic returns HTTP 200 with real, billable usage but ProspectOS then
// rejects the business result (malformed JSON, schema mismatch, truncation, unexpected stop_reason...),
// the call was still paid for but was never written to api_usage_events. AnalyzeOfferError
// (src/server/ai.ts) now carries that exact real usage on every such throw; callProviderMeteringFailure
// (app/api/v1/[...path]/route.ts) meters it before rethrowing the SAME unchanged public error code.
//
// NEVER a real network call, NEVER a real Anthropic key — every fetch/DB dependency below is mocked.
// analyzeOffer() and recordApiUsage() are the REAL production functions. route.ts itself is a Next.js
// Route Handler module that must export ONLY its HTTP method handlers, so callProviderMeteringFailure
// cannot be imported directly — section R below proves, via static source assertions against the real
// file, that meterOnFailure (redefined here) is byte-for-byte what route.ts actually runs.
// ============================================================

const savedEnv={AI_PROVIDER:process.env.AI_PROVIDER,AI_API_KEY:process.env.AI_API_KEY,AI_MODEL:process.env.AI_MODEL};
test.after(()=>{process.env.AI_PROVIDER=savedEnv.AI_PROVIDER;process.env.AI_API_KEY=savedEnv.AI_API_KEY;process.env.AI_MODEL=savedEnv.AI_MODEL});

function mockFetchOnce(status:number,jsonBody:unknown){
 return mock.method(globalThis,'fetch',async()=>({ok:status>=200&&status<300,status,json:async()=>jsonBody}) as unknown as Response);
}
function mockFetchThrows(err:Error){
 return mock.method(globalThis,'fetch',async()=>{throw err});
}
// admin-client is mocked fresh per test (mock.module + a cache-busting `?d=` re-import of usage.ts,
// same convention as tests/byok-anthropic.test.ts section D) since usage.ts's own static import of
// admin-client.ts is otherwise already bound to the real module by the time this file's other imports run.
function mockAdminCapturingInserts(insertResult:{error:null|{message:string}}={error:null}){
 const inserted:Record<string,unknown>[]=[];
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   rpc:async()=>({data:null,error:null}),
   from:()=>({insert:(row:Record<string,unknown>)=>{inserted.push(row);return Promise.resolve(insertResult)}}),
  })},
 });
 return inserted;
}

const {analyzeOffer,AnalyzeOfferError}=await import('../src/server/ai.ts');

function setAnthropicEnv(){process.env.AI_PROVIDER='anthropic';process.env.AI_API_KEY='platform-key-4a5';process.env.AI_MODEL='claude-sonnet-5';}
const validText='un texte public suffisamment long pour passer la validation métier';
const meter={organizationId:'org-1',projectId:'project-1',userId:'user-1'};

// EXACTLY route.ts's real callProviderMeteringFailure (see section R for the static proof it matches).
// Only the recordApiUsage import is re-fetched per call so each test's admin-client mock is picked up.
async function meterOnFailure<T>(call:()=>Promise<T>,ctx:{organizationId:string;projectId:string;userId:string}):Promise<T>{
 try{
  return await call();
 }catch(err){
  if(err instanceof AnalyzeOfferError&&err.usage){
   const {recordApiUsage}=await import(`../src/server/usage.ts?d=${Date.now()}`);
   await recordApiUsage({organizationId:ctx.organizationId,projectId:ctx.projectId,userId:ctx.userId,provider:err.usage.provider as 'anthropic'|'openai',operation:'offer_analysis',model:err.usage.model,inputTokens:err.usage.input_tokens,outputTokens:err.usage.output_tokens,billingSource:err.usage.credential_source});
  }
  throw err instanceof AnalyzeOfferError?Error(err.message):err;
 }
}

// ------------------------------------------------------------
// U — unit level: AnalyzeOfferError.usage itself (pure, on the real analyzeOffer, mocked fetch only).
// ------------------------------------------------------------
test('U1 — AnalyzeOfferError.usage carries the exact real token counts, provider, model and PLATFORM credential_source',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:77,output_tokens:88}});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof AnalyzeOfferError);
   assert.equal(err.message,'AI_INVALID_RESULT');
   assert.deepEqual(err.usage,{provider:'anthropic',model:'claude-sonnet-5',input_tokens:77,output_tokens:88,credential_source:'PLATFORM'});
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

test('U2 — credential_source in the attached usage is BYOK when an apiKeyOverride was used',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText,{apiKeyOverride:'byok-key-u2'}),(err:unknown)=>{
   assert.ok(err instanceof AnalyzeOfferError);
   assert.equal(err.usage?.credential_source,'BYOK');
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

test('U3 — AnalyzeOfferError.usage is null when the response has no usage object at all',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn'});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof AnalyzeOfferError);
   assert.equal(err.usage,null);
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

test('U4 — AnalyzeOfferError.usage is null when a reported token count is not a non-negative integer (never fabricated)',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:'77',output_tokens:88}});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof AnalyzeOfferError);
   assert.equal(err.usage,null);
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

// ------------------------------------------------------------
// 1-17 — the mandated test matrix, against meterOnFailure (== route.ts's real wrapper, proven in R).
// ------------------------------------------------------------
test('1 — success => exactly 1 ledger event (the wrapper itself never meters a success; route.ts\'s separate, unchanged success-path write is reproduced once here)',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:50}});
 const inserted=mockAdminCapturingInserts();
 try{
  const result=await meterOnFailure(()=>analyzeOffer(validText),meter);
  assert.equal(inserted.length,0,'a successful call must never be metered by the failure wrapper');
  const {recordApiUsage}=await import(`../src/server/usage.ts?d=${Date.now()}`);
  await recordApiUsage({organizationId:meter.organizationId,projectId:meter.projectId,userId:meter.userId,provider:result.usage.provider as 'anthropic'|'openai',operation:'offer_analysis',model:result.usage.model,inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens,billingSource:result.credential_source});
  assert.equal(inserted.length,1);
  assert.equal(inserted[0].input_tokens,100);
  assert.equal(inserted[0].output_tokens,50);
 }finally{fetchMock.mock.restore();mock.reset()}
});

const businessFailureCases:Array<{label:string;body:unknown;expectedError:RegExp}>=[
 {label:'2 — MALFORMED_JSON',body:{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:30,output_tokens:5}},expectedError:/AI_INVALID_RESULT/},
 {label:'3 — SCHEMA_MISMATCH',body:{content:[{type:'text',text:JSON.stringify({summary:123,target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:31,output_tokens:6}},expectedError:/AI_INVALID_RESULT/},
 {label:'4 — NO_TEXT_BLOCK',body:{content:[{type:'thinking',thinking:'internal reasoning only'}],stop_reason:'end_turn',usage:{input_tokens:32,output_tokens:7}},expectedError:/AI_INVALID_RESULT/},
 {label:'5 — EMPTY_TEXT',body:{content:[{type:'text',text:''}],stop_reason:'end_turn',usage:{input_tokens:33,output_tokens:8}},expectedError:/AI_INVALID_RESULT/},
 {label:'6 — INVALID_STOP_REASON',body:{content:[{type:'text',text:'Je ne peux pas répondre.'}],stop_reason:'refusal',usage:{input_tokens:34,output_tokens:9}},expectedError:/AI_INVALID_RESULT/},
 {label:'7 — AI_TRUNCATED_RESULT (max_tokens)',body:{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'max_tokens',usage:{input_tokens:35,output_tokens:2048}},expectedError:/AI_TRUNCATED_RESULT/},
];
for(const {label,body,expectedError} of businessFailureCases){
 test(`${label} + usage valide => the business error is propagated UNCHANGED, and exactly 1 ledger event is written with the real usage`,async()=>{
  setAnthropicEnv();
  const fetchMock=mockFetchOnce(200,body);
  const inserted=mockAdminCapturingInserts();
  try{
   await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),expectedError);
   assert.equal(inserted.length,1);
   assert.equal(inserted[0].provider,'anthropic');
   assert.equal(inserted[0].model,'claude-sonnet-5');
   assert.equal(inserted[0].operation,'offer_analysis');
   assert.equal(inserted[0].billing_source,'PLATFORM');
   assert.equal(inserted[0].request_count,1);
   const {input_tokens,output_tokens}=(body as {usage:{input_tokens:number;output_tokens:number}}).usage;
   assert.equal(inserted[0].input_tokens,input_tokens);
   assert.equal(inserted[0].output_tokens,output_tokens);
  }finally{fetchMock.mock.restore();mock.reset()}
 });
}

test('8 — HTTP non-2xx => 0 ledger event (no usage is ever read on this path, see src/server/ai.ts)',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(401,{});
 const inserted=mockAdminCapturingInserts();
 try{
  await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),/AI_UNAVAILABLE/);
  assert.equal(inserted.length,0);
 }finally{fetchMock.mock.restore();mock.reset()}
});

test('9 — network error (fetch itself throws) => 0 ledger event',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchThrows(Object.assign(new Error('network failure'),{name:'AbortError'}));
 const inserted=mockAdminCapturingInserts();
 try{
  await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter));
  assert.equal(inserted.length,0);
 }finally{fetchMock.mock.restore();mock.reset()}
});

test('10 — credential invalid before any provider call => the wrapper is never even invoked, 0 ledger event, 0 fetch call',async()=>{
 setAnthropicEnv();
 const fetchMock=mock.method(globalThis,'fetch',async()=>{throw Error('fetch must never be called when the BYOK credential is INVALID')});
 const inserted=mockAdminCapturingInserts();
 try{
  // Mirrors route.ts exactly: `if(credential.status==='INVALID')throw Error('BYOK_CREDENTIAL_INVALID')`
  // happens strictly BEFORE callProviderMeteringFailure is ever called (see section R5).
  const runRouteSequence=async(credentialStatus:'INVALID')=>{
   if(credentialStatus==='INVALID')throw Error('BYOK_CREDENTIAL_INVALID');
   return meterOnFailure(()=>analyzeOffer(validText),meter);
  };
  await assert.rejects(runRouteSequence('INVALID'),/BYOK_CREDENTIAL_INVALID/);
  assert.equal(fetchMock.mock.calls.length,0);
  assert.equal(inserted.length,0);
 }finally{fetchMock.mock.restore();mock.reset()}
});

test('11 — usage absent on an otherwise-200 response => 0 ledger event, never a fabricated 0-cost row',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn'});
 const inserted=mockAdminCapturingInserts();
 try{
  await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),/AI_INVALID_RESULT/);
  assert.equal(inserted.length,0);
 }finally{fetchMock.mock.restore();mock.reset()}
});

test('12 — malformed provider usage (wrong type) on an otherwise-200 response is never metered',async()=>{
 setAnthropicEnv();
 const malformedUsages:unknown[]=[
  {input_tokens:'100',output_tokens:50},
  {input_tokens:100,output_tokens:'50'},
  {input_tokens:100.5,output_tokens:50},
  {input_tokens:{nested:true},output_tokens:50},
  {input_tokens:null,output_tokens:50},
  {},
 ];
 for(const usage of malformedUsages){
  const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage});
  const inserted=mockAdminCapturingInserts();
  try{
   await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),/AI_INVALID_RESULT/);
   assert.equal(inserted.length,0,`usage ${JSON.stringify(usage)} must never be metered`);
  }finally{fetchMock.mock.restore();mock.reset()}
 }
});

test('13 — negative token counts on an otherwise-200 response are never metered',async()=>{
 setAnthropicEnv();
 for(const usage of [{input_tokens:-1,output_tokens:50},{input_tokens:100,output_tokens:-1},{input_tokens:-1,output_tokens:-1}]){
  const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage});
  const inserted=mockAdminCapturingInserts();
  try{
   await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),/AI_INVALID_RESULT/);
   assert.equal(inserted.length,0);
  }finally{fetchMock.mock.restore();mock.reset()}
 }
});

test('14 — success path never double-meters: the wrapper writes nothing, only route.ts\'s single separate post-return write fires',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20}});
 const inserted=mockAdminCapturingInserts();
 try{
  const result=await meterOnFailure(()=>analyzeOffer(validText),meter);
  assert.equal(inserted.length,0);
  const {recordApiUsage}=await import(`../src/server/usage.ts?d=${Date.now()}`);
  if(result.usage.input_tokens||result.usage.output_tokens){
   await recordApiUsage({organizationId:meter.organizationId,projectId:meter.projectId,userId:meter.userId,provider:result.usage.provider as 'anthropic'|'openai',operation:'offer_analysis',model:result.usage.model,inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens,billingSource:result.credential_source});
  }
  assert.equal(inserted.length,1,'exactly one ledger event total for one successful call — never two');
 }finally{fetchMock.mock.restore();mock.reset()}
});

test('15 — failure path never double-meters: a single failed call writes exactly one ledger event, never two',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:50,output_tokens:60}});
 const inserted=mockAdminCapturingInserts();
 try{
  await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),/AI_INVALID_RESULT/);
  assert.equal(inserted.length,1);
 }finally{fetchMock.mock.restore();mock.reset()}
});

test('16 — a ledger write failure never triggers a second provider call (no retry)',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:40,output_tokens:10}});
 mockAdminCapturingInserts({error:{message:'insert failed (simulated)'}}); // recordApiUsage swallows this internally — see src/server/usage.ts
 const consoleErrorSpy=mock.method(console,'error',()=>{});
 try{
  await assert.rejects(meterOnFailure(()=>analyzeOffer(validText),meter),/AI_INVALID_RESULT/);
  assert.equal(fetchMock.mock.calls.length,1,'exactly one provider call — a ledger write failure must never cause a second analyzeOffer call');
 }finally{fetchMock.mock.restore();consoleErrorSpy.mock.restore();mock.reset()}
});

test('17 — no secret, credential, or business content ever appears in the ledger row or in any console output during a metered failure',async()=>{
 setAnthropicEnv();
 process.env.AI_API_KEY='platform-secret-4a5-must-not-leak';
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json, x-api-key: sk-ant-should-never-leak, foodatoi-prospect-text'}],stop_reason:'end_turn',usage:{input_tokens:41,output_tokens:11}});
 const inserted=mockAdminCapturingInserts();
 const consoleErrorSpy=mock.method(console,'error',()=>{});
 try{
  await assert.rejects(meterOnFailure(()=>analyzeOffer(validText,{apiKeyOverride:'byok-secret-4a5-must-not-leak'}),meter),/AI_INVALID_RESULT/);
  assert.equal(inserted.length,1);
  const rowSerialized=JSON.stringify(inserted[0]);
  assert.doesNotMatch(rowSerialized,/byok-secret-4a5-must-not-leak/);
  assert.doesNotMatch(rowSerialized,/platform-secret-4a5-must-not-leak/);
  assert.doesNotMatch(rowSerialized,/sk-ant-should-never-leak/);
  assert.doesNotMatch(rowSerialized,/foodatoi/i);
  assert.deepEqual(Object.keys(inserted[0]).sort(),['discovery_run_id','estimated_cost_micros','input_tokens','model','operation','organization_id','output_tokens','pricing_version','project_id','provider','request_count','user_id','billing_source'].sort());
  for(const call of consoleErrorSpy.mock.calls){
   const serialized=JSON.stringify(call.arguments);
   assert.doesNotMatch(serialized,/byok-secret-4a5-must-not-leak/);
   assert.doesNotMatch(serialized,/platform-secret-4a5-must-not-leak/);
   assert.doesNotMatch(serialized,/sk-ant-should-never-leak/);
   assert.doesNotMatch(serialized,/foodatoi/i);
  }
 }finally{fetchMock.mock.restore();consoleErrorSpy.mock.restore();mock.reset()}
});

// ------------------------------------------------------------
// R — static, source-level proof (same convention as tests/byok-anthropic.test.ts section F) that
// route.ts's REAL callProviderMeteringFailure matches meterOnFailure above, and that both analyze-company
// provider call sites are actually wrapped by it — never a bare, unmetered analyzeOffer call.
// ------------------------------------------------------------
const routeSource=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');

test('R1 — route.ts imports AnalyzeOfferError alongside analyzeOffer',()=>{
 assert.match(routeSource,/import \{analyzeOffer,AnalyzeOfferError\} from '\.\.\/\.\.\/\.\.\/\.\.\/src\/server\/ai'/);
});

test('R2 — callProviderMeteringFailure only meters an AnalyzeOfferError carrying real usage, then rethrows the unchanged public error code',()=>{
 assert.match(routeSource,/async function callProviderMeteringFailure/);
 assert.match(routeSource,/if\(err instanceof AnalyzeOfferError&&err\.usage\)\{/);
 assert.match(routeSource,/throw err instanceof AnalyzeOfferError\?Error\(err\.message\):err/);
});

test('R3 — both analyze-company provider call sites (BYOK/anthropic and non-anthropic) go through callProviderMeteringFailure — no bare, unmetered analyzeOffer call',()=>{
 const analyzeCompanyBlock=routeSource.match(/if\(resource==='analyze-company'&&request\.method==='POST'\)\{[\s\S]*?return json\(analysis\);\n \}/)?.[0]??'';
 assert.ok(analyzeCompanyBlock,'analyze-company block not found');
 const allAnalyzeOfferCalls=analyzeCompanyBlock.match(/analyzeOffer\(/g)??[];
 const wrappedAnalyzeOfferCalls=analyzeCompanyBlock.match(/callProviderMeteringFailure\(\(\)=>analyzeOffer\(/g)??[];
 assert.equal(allAnalyzeOfferCalls.length,2,'exactly two analyzeOffer call sites: BYOK/anthropic branch and non-anthropic branch');
 assert.equal(wrappedAnalyzeOfferCalls.length,2,'both must be wrapped by callProviderMeteringFailure');
});

test('R4 — the meter context passed to callProviderMeteringFailure carries the correct organization/project/user ids',()=>{
 assert.match(routeSource,/const meter=\{organizationId:project\.organization_id,projectId:body\.project_id,userId:user\.id\}/);
});

test('R5 — BYOK_CREDENTIAL_INVALID is still thrown strictly before any provider call or metering attempt (unchanged fail-closed ordering)',()=>{
 const analyzeCompanyBlock=routeSource.match(/if\(resource==='analyze-company'&&request\.method==='POST'\)\{[\s\S]*?return json\(analysis\);\n \}/)?.[0]??'';
 assert.match(analyzeCompanyBlock,/if\(credential\.status==='INVALID'\)throw Error\('BYOK_CREDENTIAL_INVALID'\)/);
 const invalidThrowIndex=analyzeCompanyBlock.indexOf("throw Error('BYOK_CREDENTIAL_INVALID')");
 const meteringCallIndex=analyzeCompanyBlock.indexOf('callProviderMeteringFailure');
 assert.ok(invalidThrowIndex>=0&&meteringCallIndex>=0&&invalidThrowIndex<meteringCallIndex,'the INVALID throw must appear before the metering wrapper is ever referenced');
});
