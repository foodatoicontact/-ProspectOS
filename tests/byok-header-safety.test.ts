import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

// ============================================================
// BYOK header safety + transport classification. Canary attempt #2 failed with NETWORK_ERROR in ~90 ms and no HTTP
// response: a provider key holding a character an HTTP header cannot carry makes fetch throw locally, before any
// request leaves. A key is header-safe only if, after trim, it matches ^[\x21-\x7E]+$ (visible ASCII, no space).
// - save: refused before encryption/persistence with INVALID_CREDENTIAL_FORMAT (never echoes the key);
// - stored credential that decrypts to an unsafe key: INVALID, so the outreach attempt stops before the reservation;
// - composeOutreachMessage: never calls fetch with an unsafe key (INVALID_PROVIDER_CREDENTIAL);
// - fetch failures: INVALID_REQUEST_HEADER (local rejection) / NETWORK_TIMEOUT / NETWORK_ERROR (+ allowlisted code).
// Every key is fake; the network is always mocked.
// ============================================================

process.env.BYOK_MASTER_KEY??=randomBytes(32).toString('base64');
const {isHeaderSafeSecret,encryptSecret}=await import('../src/server/crypto.ts');
const {parseProviderCredentialSave,saveProviderCredential}=await import('../src/server/byok.ts');
const {composeOutreachMessage}=await import('../src/server/ai.ts');
const {generateOutreachWithAi}=await import('../src/outreach/ai-generate.ts');

const VALID='sk-ant-api03-FAKE_Zq7xSECRETx-AbC9';
const UNSAFE:[string,string][]=[
 ['ellipsis U+2026','sk-ant-api03-FAKE…Zq7xSECRETx'],
 ['zero-width space U+200B','sk-ant-api03-FAKE​Zq7xSECRETx'],
 ['internal newline','sk-ant-api03-FAKE\nZq7xSECRETx'],
 ['tab','sk-ant-api03-FAKE\tZq7xSECRETx'],
 ['internal space','sk-ant-api03-FAKE Zq7xSECRETx'],
 ['accented letter','sk-ant-api03-FAKÉ-Zq7xSECRETx'],
 ['non-breaking space U+00A0','sk-ant-api03-FAKE Zq7xSECRETx'],
];
const MARKERS=['FAKE','Zq7xSECRETx','SYSTEM-MARKER','PROSPECT-MARKER','BODY-MARKER','NET-DETAIL-MARKER'];
function assertNoSecret(text:string){for(const m of MARKERS)assert.ok(!text.includes(m),`no key, prompt, body or error detail may appear (${m})`)}

const env={...process.env};const realFetch=globalThis.fetch;
test.beforeEach(()=>{process.env.AI_PROVIDER='anthropic';process.env.AI_MODEL='claude-test-model';process.env.AI_API_KEY='platform-key-ascii-0001'});
test.afterEach(()=>{globalThis.fetch=realFetch;mock.restoreAll();for(const k of ['AI_PROVIDER','AI_MODEL','AI_API_KEY'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]});
const captureErrors=()=>mock.method(console,'error',()=>{});
const lines=(spy:ReturnType<typeof captureErrors>)=>spy.mock.calls.map(c=>c.arguments.map(String).join(' '));
const REQ={system:'SYSTEM-MARKER',user:'{"company":"PROSPECT-MARKER"}'};

// ——— shared predicate ———
test('isHeaderSafeSecret — visible ASCII only',()=>{
 assert.equal(isHeaderSafeSecret(VALID),true);
 for(const [label,key] of UNSAFE)assert.equal(isHeaderSafeSecret(key),false,label);
 assert.equal(isHeaderSafeSecret(''),false);
});

// ——— FIX 1: save ———
test('save — a valid ASCII key passes, surrounding whitespace removed by trim',()=>{
 assert.ok(parseProviderCredentialSave({provider:'anthropic',api_key:VALID}).api_key===VALID,'valid key unchanged');
 assert.ok(parseProviderCredentialSave({provider:'anthropic',api_key:` \t${VALID}\r\n `}).api_key===VALID,'trimmed key accepted');
});
for(const [label,key] of UNSAFE){
 test(`save — ${label} is refused with INVALID_CREDENTIAL_FORMAT, before encryption, without echoing the key`,()=>{
  let thrown:unknown;
  try{parseProviderCredentialSave({provider:'anthropic',api_key:key})}catch(e){thrown=e}
  assert.ok(thrown instanceof Error,'must throw');
  assert.equal((thrown as Error).message,'INVALID_CREDENTIAL_FORMAT');
  assertNoSecret(`${(thrown as Error).message} ${String((thrown as Error).stack)} ${JSON.stringify(thrown)}`);
 });
}
test('save — other invalid bodies keep their existing validation error (too short, unknown provider, extra field)',()=>{
 for(const body of [{provider:'anthropic',api_key:'short'},{provider:'mistral',api_key:VALID},{provider:'anthropic',api_key:VALID,extra:1}]){
  assert.throws(()=>parseProviderCredentialSave(body),(e:any)=>e?.message!=='INVALID_CREDENTIAL_FORMAT');
 }
});
test('route — POST provider-credentials uses parseProviderCredentialSave; the API maps INVALID_CREDENTIAL_FORMAT to a clear 400',async()=>{
 const {readFileSync}=await import('node:fs');
 const route=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 const block=route.split("if(resource==='provider-credentials'){")[1]?.split("if(request.method==='DELETE')")[0]??'';
 assert.match(block,/const b=parseProviderCredentialSave\(body\);/);
 assert.match(route,/code==='INVALID_CREDENTIAL_FORMAT'\?'[^']*ASCII[^']*'/,'clear user message for the refused format');
});
test('save path — saveProviderCredential is never reached for a refused key (nothing encrypted, nothing sent)',async()=>{
 const rpc=mock.fn(async()=>({data:{},error:null}));
 for(const [,key] of UNSAFE){
  try{const b=parseProviderCredentialSave({provider:'anthropic',api_key:key});await saveProviderCredential({rpc} as any,'org-1',b.provider,b.api_key)}catch{/* refused */}
 }
 assert.equal(rpc.mock.callCount(),0);
});

// ——— FIX 2: stored credential that decrypts to an unsafe key ———
function mockStoredKey(plaintext:string){
 const sealed=encryptSecret(plaintext);const hex=(b:Buffer)=>'\\x'+b.toString('hex');
 mock.module('../src/server/admin-client.ts',{namedExports:{createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{encrypted_secret:hex(sealed.ciphertext),iv:hex(sealed.iv),auth_tag:hex(sealed.authTag)},error:null})})})})})})}});
}
test('stored credential — an unsafe historical key resolves to INVALID (never VALID with the key)',async()=>{
 mockStoredKey(UNSAFE[0][1]);
 const {resolveProviderCredential}=await import(`../src/server/byok.ts?h=${Date.now()}`);
 assert.deepEqual(await resolveProviderCredential('org-1','anthropic'),{status:'INVALID'});
 mock.reset();
});
test('stored credential — a safe key still resolves to VALID with the exact key',async()=>{
 mockStoredKey(VALID);
 const {resolveProviderCredential}=await import(`../src/server/byok.ts?h=${Date.now()}`);
 const r=await resolveProviderCredential('org-1','anthropic');
 assert.ok(r.status==='VALID'&&r.apiKey===VALID,'VALID with the exact stored key');
 mock.reset();
});
test('outreach — an INVALID stored credential stops before the reservation: no unit, no fetch, rule-based message',async()=>{
 const fetchSpy=mock.method(globalThis,'fetch',async()=>{throw Error('must not be called')});
 const reserve=mock.fn(async()=>'usage-1');const call=mock.fn(async()=>({text:'x',usage:null}));
 const composed={text:'Message de secours.',evidence_ids:['e1'],signal_ids:[],public_content_ids:[],angle:{type:'evidence',label:'l',excerpt:'x',source_url:'https://www.example.fr/'}} as any;
 const r=await generateOutreachWithAi({composed,name:'N',offer:'O',locale:'fr',style:null,sources:[],userId:'u'},{userId:'u',
  availability:async()=>({ok:false,reason:'BYOK_CREDENTIAL_INVALID'}),reserve,loadExampleRows:async()=>[],call,meter:async()=>{}});
 assert.equal(reserve.mock.callCount(),0,'no unit reserved');
 assert.equal(call.mock.callCount(),0);assert.equal(fetchSpy.mock.callCount(),0);
 assert.deepEqual({provider:r.provider,attempted:r.attempted,usage_id:r.usage_id,fallback_reason:r.fallback_reason,text:r.text},
  {provider:'rule_based_v1',attempted:false,usage_id:null,fallback_reason:'BYOK_CREDENTIAL_INVALID',text:'Message de secours.'});
});
for(const [label,key] of UNSAFE.slice(0,3)){
 test(`composeOutreachMessage — ${label} key: no fetch, INVALID_PROVIDER_CREDENTIAL, clean log`,async()=>{
  const fetchSpy=mock.method(globalThis,'fetch',async()=>new Response('{}'));const spy=captureErrors();
  await assert.rejects(composeOutreachMessage(REQ,{apiKeyOverride:key}),(e:any)=>e.message==='INVALID_PROVIDER_CREDENTIAL'&&!e.usage);
  assert.equal(fetchSpy.mock.callCount(),0,'fetch must never run with an unsafe key');
  const out=lines(spy);
  assert.deepEqual(out.map(l=>JSON.parse(l)),[{component:'composeOutreachMessage',provider:'anthropic',operation:'outreach_generation',reason:'INVALID_PROVIDER_CREDENTIAL'}]);
  assertNoSecret(out.join('\n'));
 });
}
test('composeOutreachMessage — an unsafe platform key is refused the same way (no fetch)',async()=>{
 process.env.AI_API_KEY='platform key with space';
 const fetchSpy=mock.method(globalThis,'fetch',async()=>new Response('{}'));captureErrors();
 await assert.rejects(composeOutreachMessage(REQ),/INVALID_PROVIDER_CREDENTIAL/);
 assert.equal(fetchSpy.mock.callCount(),0);
});

// ——— FIX 3: transport classification ———
const logOf=async(failure:unknown)=>{
 globalThis.fetch=(async()=>{throw failure}) as typeof fetch;const spy=captureErrors();
 await assert.rejects(composeOutreachMessage(REQ,{apiKeyOverride:VALID}),(e:unknown)=>e===failure,'the original error is rethrown unchanged');
 const out=lines(spy);assertNoSecret(out.join('\n'));assert.equal(out.length,1);
 return JSON.parse(out[0]);
};
const base={component:'composeOutreachMessage',provider:'anthropic',operation:'outreach_generation'};
test('transport — local request rejection (TypeError without cause) → INVALID_REQUEST_HEADER',async()=>{
 assert.deepEqual(await logOf(new TypeError('Cannot convert argument to a ByteString NET-DETAIL-MARKER')),{...base,reason:'INVALID_REQUEST_HEADER'});
});
test('transport — timeout → NETWORK_TIMEOUT',async()=>{
 assert.deepEqual(await logOf(new DOMException('NET-DETAIL-MARKER','TimeoutError')),{...base,reason:'NETWORK_TIMEOUT'});
});
test('transport — real network error → NETWORK_ERROR with an allowlisted cause code only',async()=>{
 const err=(code:string)=>new TypeError('fetch failed',{cause:Object.assign(new Error('NET-DETAIL-MARKER getaddrinfo api.anthropic.com'),{code})});
 assert.deepEqual(await logOf(err('ENOTFOUND')),{...base,reason:'NETWORK_ERROR',cause_code:'ENOTFOUND'});
 assert.deepEqual(await logOf(err('UND_ERR_CONNECT_TIMEOUT')),{...base,reason:'NETWORK_ERROR',cause_code:'UND_ERR_CONNECT_TIMEOUT'});
 assert.deepEqual(await logOf(err('NET-DETAIL-MARKER-CODE')),{...base,reason:'NETWORK_ERROR'},'unknown code omitted');
 assert.deepEqual(await logOf(new TypeError('fetch failed',{cause:new Error('NET-DETAIL-MARKER')})),{...base,reason:'NETWORK_ERROR'},'no code → no cause_code');
});
test('transport — HTTP 401 stays HTTP_ERROR status=401, still AI_UNAVAILABLE without usage',async()=>{
 globalThis.fetch=(async()=>new Response('{"error":"BODY-MARKER"}',{status:401})) as typeof fetch;const spy=captureErrors();
 await assert.rejects(composeOutreachMessage(REQ,{apiKeyOverride:VALID}),(e:any)=>e.message==='AI_UNAVAILABLE'&&!e.usage);
 assert.deepEqual(JSON.parse(lines(spy)[0]),{...base,reason:'HTTP_ERROR',status:401});
});
