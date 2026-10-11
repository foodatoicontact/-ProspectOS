import test,{mock} from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// Provider failure observability (AI outreach canary phase 1 ended in AI_ERROR with no trace of the HTTP status).
// composeOutreachMessage logs ONE line on a non-2xx answer or a network failure: provider, operation, status and a
// well-formed Anthropic request id — never the key, the prompt, the response body or the network error text.
// Behaviour is unchanged: non-2xx still throws AI_UNAVAILABLE without usage, a network error is rethrown as is.
// Every value below is fake and the network is always mocked.
// ============================================================

const KEY='sk-ant-FAKE-observability-key-1234';
const SYSTEM='SYSTEM-PROMPT-MARKER';
const USER='{"company":"PROSPECT-MARKER","sources":["EVIDENCE-MARKER https://source.example/marker"]}';
const BODY_MARKER='RESPONSE-BODY-MARKER';
const FORBIDDEN=[KEY,'x-api-key',SYSTEM,'PROSPECT-MARKER','EVIDENCE-MARKER','source.example',BODY_MARKER,'NETWORK-DETAIL-MARKER'];

const {composeOutreachMessage}=await import('../src/server/ai.ts');
const {composeWithAi}=await import('../src/outreach/ai-composer.ts');

const env={...process.env};const realFetch=globalThis.fetch;
test.beforeEach(()=>{process.env.AI_PROVIDER='anthropic';process.env.AI_MODEL='claude-test-model';process.env.AI_API_KEY='platform-FAKE-key'});
test.afterEach(()=>{globalThis.fetch=realFetch;mock.restoreAll();for(const k of ['AI_PROVIDER','AI_MODEL','AI_API_KEY'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]});

function captureErrors(){return mock.method(console,'error',()=>{})}
const logged=(spy:ReturnType<typeof captureErrors>)=>spy.mock.calls.map(c=>c.arguments.map(String).join(' '));
function assertClean(lines:string[]){
 for(const line of lines)for(const marker of FORBIDDEN)assert.ok(!line.includes(marker),`a provider failure log line must not contain a forbidden value (${marker===KEY?'API key':marker})`);
}
function failWith(status:number,headers:Record<string,string>={'request-id':'req_011CTestRequestId42'}){
 globalThis.fetch=(async()=>new Response(JSON.stringify({type:'error',error:{type:'some_error',message:`${BODY_MARKER} invalid x-api-key ${KEY}`}}),{status,headers})) as typeof fetch;
}

for(const status of [400,401,403,404,429,500]){
 test(`HTTP ${status} — one log line with provider, operation, status and request id; still AI_UNAVAILABLE without usage`,async()=>{
  failWith(status);const spy=captureErrors();
  await assert.rejects(composeOutreachMessage({system:SYSTEM,user:USER},{apiKeyOverride:KEY}),(e:any)=>e.message==='AI_UNAVAILABLE'&&!e.usage);
  const lines=logged(spy);
  assert.equal(lines.length,1,'exactly one log line per failed call');
  assert.deepEqual(JSON.parse(lines[0]),{component:'composeOutreachMessage',provider:'anthropic',operation:'outreach_generation',reason:'HTTP_ERROR',status,request_id:'req_011CTestRequestId42'});
  assertClean(lines);
 });
}

test('a missing or malformed request-id header is omitted, never echoed',async()=>{
 for(const headers of [{},{'request-id':`req_${KEY}`},{'request-id':'req_'+'a'.repeat(200)},{'request-id':'not-a-request-id'}]){
  failWith(401,headers);const spy=captureErrors();
  await assert.rejects(composeOutreachMessage({system:SYSTEM,user:USER},{apiKeyOverride:KEY}),/AI_UNAVAILABLE/);
  const lines=logged(spy);
  assert.deepEqual(JSON.parse(lines[0]),{component:'composeOutreachMessage',provider:'anthropic',operation:'outreach_generation',reason:'HTTP_ERROR',status:401});
  assertClean(lines);spy.mock.restore();
 }
});

test('network failure — generic category only, the original error is rethrown unchanged',async()=>{
 const failure=new TypeError('fetch failed',{cause:new Error(`NETWORK-DETAIL-MARKER ${KEY}`)});
 globalThis.fetch=(async()=>{throw failure}) as typeof fetch;const spy=captureErrors();
 await assert.rejects(composeOutreachMessage({system:SYSTEM,user:USER},{apiKeyOverride:KEY}),(e:unknown)=>e===failure);
 const lines=logged(spy);
 assert.equal(lines.length,1);
 assert.deepEqual(JSON.parse(lines[0]),{component:'composeOutreachMessage',provider:'anthropic',operation:'outreach_generation',reason:'NETWORK_ERROR'});
 assertClean(lines);
});

test('provider timeout — logged as its own generic category, rethrown unchanged',async()=>{
 const timeout=new DOMException('The operation was aborted due to timeout','TimeoutError');
 globalThis.fetch=(async()=>{throw timeout}) as typeof fetch;const spy=captureErrors();
 await assert.rejects(composeOutreachMessage({system:SYSTEM,user:USER},{apiKeyOverride:KEY}),(e:unknown)=>e===timeout);
 assert.deepEqual(JSON.parse(logged(spy)[0]),{component:'composeOutreachMessage',provider:'anthropic',operation:'outreach_generation',reason:'NETWORK_TIMEOUT'});
});

test('a 2xx answer logs nothing',async()=>{
 globalThis.fetch=(async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"message":"Bonjour"}'}],usage:{input_tokens:10,output_tokens:5}})) as typeof fetch;
 const spy=captureErrors();
 const r=await composeOutreachMessage({system:SYSTEM,user:USER},{apiKeyOverride:KEY});
 assert.equal(r.text,'{"message":"Bonjour"}');assert.equal(spy.mock.callCount(),0);
});

test('functional path unchanged — an HTTP or network failure still ends in the rule-based fallback with AI_ERROR',async()=>{
 const input={name:'Kerlan',offer:'Offre.',locale:'fr' as const,angle:{type:'evidence',source_id:'e1',label:'l',reason:'r',source_url:'https://www.example.fr/',observed_at:'2026-01-01T00:00:00Z',excerpt:'Extrait.'},
  sources:['Extrait.'],style:null as any,examples:[],fallback:{text:'Message de secours.',evidence_ids:['e1'],signal_ids:[],public_content_ids:[]}};
 const call=(req:{system:string;user:string})=>composeOutreachMessage(req,{apiKeyOverride:KEY}).then(r=>r.text);
 captureErrors();
 failWith(401);
 assert.deepEqual(await composeWithAi(input as any,call),{...input.fallback,provider:'rule_based_v1',fallback_reason:'AI_ERROR'});
 globalThis.fetch=(async()=>{throw new TypeError('fetch failed')}) as typeof fetch;
 assert.deepEqual(await composeWithAi(input as any,call),{...input.fallback,provider:'rule_based_v1',fallback_reason:'AI_ERROR'});
});
