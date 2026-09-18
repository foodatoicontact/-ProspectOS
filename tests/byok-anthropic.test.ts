import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// ============================================================
// BLOC 4A.3 — BYOK Anthropic wired into analyzeOffer() + cost metering provenance.
// NEVER makes a real network call: every fetch/DB dependency below is mocked. This exercises the
// ACTUAL production code (src/server/ai.ts, src/server/usage.ts, src/server/byok.ts), not a
// reimplementation of it — the extensionless-import fix in this same commit (byok.ts/usage.ts now
// import their sibling modules with an explicit .ts extension, matching every other src/ subdirectory)
// is what makes these modules directly importable/executable by node's test runner at all.
// ============================================================

const savedEnv={AI_PROVIDER:process.env.AI_PROVIDER,AI_API_KEY:process.env.AI_API_KEY,AI_MODEL:process.env.AI_MODEL};
test.after(()=>{process.env.AI_PROVIDER=savedEnv.AI_PROVIDER;process.env.AI_API_KEY=savedEnv.AI_API_KEY;process.env.AI_MODEL=savedEnv.AI_MODEL});

function mockFetchOnce(status:number,jsonBody:unknown){
 return mock.method(globalThis,'fetch',async()=>({ok:status>=200&&status<300,status,json:async()=>jsonBody}) as unknown as Response);
}

const {analyzeOffer}=await import('../src/server/ai.ts');

// ------------------------------------------------------------
// A — BYOK only ever activates when the platform is already configured for Anthropic; it never
// changes which provider/model is called, only which key pays.
// ------------------------------------------------------------
test('A — a BYOK key override is used (as the x-api-key header) and credential_source is BYOK, when AI_PROVIDER is anthropic',async()=>{
 process.env.AI_PROVIDER='anthropic';process.env.AI_API_KEY='platform-key-should-not-be-used';process.env.AI_MODEL='claude-observed-model';
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],usage:{input_tokens:11,output_tokens:22}});
 try{
  const result=await analyzeOffer('un texte public suffisamment long pour passer la validation métier',{apiKeyOverride:'byok-user-key-abc123'});
  assert.equal(result.credential_source,'BYOK');
  assert.equal(result.usage.input_tokens,11);
  assert.equal(result.usage.output_tokens,22);
  const [,init]=fetchMock.mock.calls[0].arguments as [string,{headers:Record<string,string>}];
  assert.equal(init.headers['x-api-key'],'byok-user-key-abc123','the BYOK key, not the platform key, must be sent to Anthropic');
 }finally{fetchMock.mock.restore()}
});

test('A — with no BYOK override, the platform key is used and credential_source is PLATFORM',async()=>{
 process.env.AI_PROVIDER='anthropic';process.env.AI_API_KEY='platform-key-123';process.env.AI_MODEL='claude-observed-model';
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],usage:{input_tokens:5,output_tokens:9}});
 try{
  const result=await analyzeOffer('un texte public suffisamment long pour passer la validation métier');
  assert.equal(result.credential_source,'PLATFORM');
  const [,init]=fetchMock.mock.calls[0].arguments as [string,{headers:Record<string,string>}];
  assert.equal(init.headers['x-api-key'],'platform-key-123');
 }finally{fetchMock.mock.restore()}
});

test('A — a BYOK override is silently ignored (never sent, never activated) when the platform provider is openai, never a silent provider switch',async()=>{
 process.env.AI_PROVIDER='openai';process.env.AI_API_KEY='platform-openai-key';process.env.AI_MODEL='gpt-observed-model';
 const fetchMock=mockFetchOnce(200,{choices:[{message:{content:JSON.stringify({summary:'s',target:'t',questions:['q']})}}],usage:{prompt_tokens:3,completion_tokens:4}});
 try{
  const result=await analyzeOffer('un texte public suffisamment long pour passer la validation métier',{apiKeyOverride:'anthropic-key-must-be-ignored'});
  assert.equal(result.credential_source,'PLATFORM');
  const [url,init]=fetchMock.mock.calls[0].arguments as [string,{headers:Record<string,string>;body:string}];
  assert.match(url,/openai\.com/);
  assert.equal(init.headers.Authorization,'Bearer platform-openai-key');
  assert.doesNotMatch(init.body,/anthropic-key-must-be-ignored/,'the ignored BYOK override must never leak into the request actually sent');
 }finally{fetchMock.mock.restore()}
});

// ------------------------------------------------------------
// B — the decrypted/override key never appears anywhere in analyzeOffer's return value.
// ------------------------------------------------------------
test('B — neither the BYOK override key nor the platform key ever appears in the returned result, in either branch',async()=>{
 process.env.AI_PROVIDER='anthropic';process.env.AI_API_KEY='platform-secret-xyz';process.env.AI_MODEL='claude-observed-model';
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],usage:{input_tokens:1,output_tokens:1}});
 try{
  const result=await analyzeOffer('un texte public suffisamment long pour passer la validation métier',{apiKeyOverride:'byok-secret-abc'});
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/byok-secret-abc/);
  assert.doesNotMatch(serialized,/platform-secret-xyz/);
 }finally{fetchMock.mock.restore()}
});

// ------------------------------------------------------------
// C — no key at all (no BYOK, no platform key configured) still fails closed exactly as before.
// ------------------------------------------------------------
test('C — AI_NOT_CONFIGURED is still thrown when there is no BYOK override and no platform key configured',async()=>{
 process.env.AI_PROVIDER='anthropic';delete process.env.AI_API_KEY;process.env.AI_MODEL='claude-observed-model';
 const fetchMock=mock.method(globalThis,'fetch',async()=>{throw Error('must never be called')});
 try{
  await assert.rejects(analyzeOffer('un texte public suffisamment long pour passer la validation métier'),/AI_NOT_CONFIGURED/);
  assert.equal(fetchMock.mock.calls.length,0,'no network call is ever attempted without a usable key');
 }finally{fetchMock.mock.restore()}
});

// ------------------------------------------------------------
// D — usage.ts: billing_source provenance, defaulting and BYOK propagation, cost stays fail-closed.
// ------------------------------------------------------------
test('D — recordApiUsage defaults billing_source to PLATFORM when not specified (the existing Brave call site is unaffected)',async()=>{
 const inserted:Record<string,unknown>[]=[];
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   rpc:async()=>({data:null,error:null}),
   from:()=>({insert:(row:Record<string,unknown>)=>{inserted.push(row);return Promise.resolve({error:null})}}),
  })},
 });
 const {recordApiUsage}=await import(`../src/server/usage.ts?d=${Date.now()}`);
 await recordApiUsage({organizationId:'org-1',userId:'user-1',provider:'brave',operation:'search',requestCount:1});
 assert.equal(inserted.length,1);
 assert.equal(inserted[0].billing_source,'PLATFORM');
 mock.reset();
});

test('D — recordApiUsage records BYOK as the billing_source when explicitly passed, and cost stays null (no anthropic pricing seeded — fail-closed)',async()=>{
 const inserted:Record<string,unknown>[]=[];
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   rpc:async()=>({data:null,error:null}),
   from:()=>({insert:(row:Record<string,unknown>)=>{inserted.push(row);return Promise.resolve({error:null})}}),
  })},
 });
 const {recordApiUsage}=await import(`../src/server/usage.ts?d=${Date.now()}`);
 await recordApiUsage({organizationId:'org-1',userId:'user-1',provider:'anthropic',operation:'offer_analysis',model:'claude-observed-model',inputTokens:100,outputTokens:50,billingSource:'BYOK'});
 assert.equal(inserted.length,1);
 assert.equal(inserted[0].billing_source,'BYOK');
 assert.equal(inserted[0].estimated_cost_micros,null,'no Anthropic price is seeded in this bloc — resolve_provider_cost returning null must never be replaced with a guess');
 mock.reset();
});

test('D — recordApiUsage never includes any provider API key field in the row it writes',async()=>{
 const inserted:Record<string,unknown>[]=[];
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   rpc:async()=>({data:null,error:null}),
   from:()=>({insert:(row:Record<string,unknown>)=>{inserted.push(row);return Promise.resolve({error:null})}}),
  })},
 });
 const {recordApiUsage}=await import(`../src/server/usage.ts?d=${Date.now()}`);
 await recordApiUsage({organizationId:'org-1',userId:'user-1',provider:'anthropic',operation:'offer_analysis',model:'claude-observed-model',inputTokens:1,outputTokens:1,billingSource:'BYOK'});
 assert.deepEqual(Object.keys(inserted[0]).sort(),['discovery_run_id','estimated_cost_micros','input_tokens','model','operation','organization_id','output_tokens','pricing_version','project_id','provider','request_count','user_id','billing_source'].sort());
 mock.reset();
});

// ------------------------------------------------------------
// E — byok.ts CRITICAL BYTEA PATH: save encrypts (never plaintext to the RPC), resolve decrypts the
// exact same \x-hex bytea shape PostgREST itself returns for a bytea column, via real AES-256-GCM.
// ------------------------------------------------------------
process.env.BYOK_MASTER_KEY=Buffer.alloc(32,7).toString('base64');

test('E — saveProviderCredential never sends the plaintext API key to the RPC, only ciphertext + last4',async()=>{
 const rpcCalls:Array<{name:string;params:Record<string,unknown>}>=[];
 const fakeDb={rpc:(name:string,params:Record<string,unknown>)=>{rpcCalls.push({name,params});return Promise.resolve({data:{provider:'anthropic',key_last4:'ey12',created_at:'now',updated_at:'now'},error:null})}} as any;
 const {saveProviderCredential}=await import('../src/server/byok.ts');
 await saveProviderCredential(fakeDb,'org-1','anthropic','sk-ant-api03-realistic-looking-key12');
 assert.equal(rpcCalls.length,1);
 assert.equal(rpcCalls[0].name,'save_provider_credential');
 const params=rpcCalls[0].params;
 assert.equal(params.p_key_last4,'ey12');
 for(const value of Object.values(params))
  assert.doesNotMatch(String(value),/sk-ant-api03-realistic-looking-key12/,'the plaintext key must never reach the RPC call, only its encrypted form');
 assert.match(String(params.p_encrypted_secret),/^\\x[0-9a-f]+$/,'ciphertext crosses as \\x-prefixed hex bytea text, the exact format PostgREST/supabase-js expects');
 assert.match(String(params.p_iv),/^\\x[0-9a-f]+$/);
 assert.match(String(params.p_auth_tag),/^\\x[0-9a-f]+$/);
});

test('E — CRITICAL: resolveProviderCredential decrypts the exact \\x-hex bytea shape a real PostgREST response carries, via real AES-256-GCM, and returns the exact original plaintext',async()=>{
 const {encryptSecret}=await import('../src/server/crypto.ts');
 const secret='sk-ant-api03-a-realistic-anthropic-key-0123456789';
 const encrypted=encryptSecret(secret);
 const toBytea=(buf:Buffer)=>'\\x'+buf.toString('hex');
 // Exactly what save_provider_credential/list stores and what a PostgREST SELECT of a bytea column
 // returns as JSON — the fromBytea path this test exists to prove, per the brief's explicit
 // "save → PostgREST → bytea → DB → read → PostgREST → fromBytea → AES-GCM decrypt" requirement.
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{encrypted_secret:toBytea(encrypted.ciphertext),iv:toBytea(encrypted.iv),auth_tag:toBytea(encrypted.authTag)},error:null})})})})}),
  })},
 });
 const {resolveProviderCredential}=await import(`../src/server/byok.ts?d=${Date.now()}`);
 const result=await resolveProviderCredential('org-1','anthropic');
 assert.equal(result,secret,'the full save-shape → bytea-hex → decrypt round trip must return the exact original plaintext key');
 mock.reset();
});

test('E — resolveProviderCredential returns null (never throws, never a fabricated key) when no credential row exists',async()=>{
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})}),
  })},
 });
 const {resolveProviderCredential}=await import(`../src/server/byok.ts?d=${Date.now()}`);
 assert.equal(await resolveProviderCredential('org-1','anthropic'),null);
 mock.reset();
});

test('E — resolveProviderCredential itself propagates a decryption failure (e.g. tampered/corrupted stored ciphertext) — it is the ROUTE call site\'s job to catch it and fall back to the platform key, never this function silently returning null for a real error',async()=>{
 mock.module('../src/server/admin-client.ts',{
  namedExports:{createAdminClient:()=>({
   from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{encrypted_secret:'\\xdeadbeef',iv:'\\x000000000000000000000000',auth_tag:'\\x00000000000000000000000000000000'},error:null})})})})}),
  })},
 });
 const {resolveProviderCredential}=await import(`../src/server/byok.ts?d=${Date.now()}`);
 await assert.rejects(resolveProviderCredential('org-1','anthropic'));
 mock.reset();
});

// ------------------------------------------------------------
// F — route.ts wiring: static, source-level proof (same convention as tests/account-session.test.ts)
// that the BYOK resolution + billing_source propagation is actually wired into analyze-company, and
// that the resolved/decrypted key is never part of the JSON response returned to the client.
// ------------------------------------------------------------
const routeSource=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
const analyzeCompanyBlock=routeSource.match(/if\(resource==='analyze-company'&&request\.method==='POST'\)\{[\s\S]*?return json\(analysis\);\n \}/)?.[0]??'';

test('F — analyze-company resolves the BYOK credential only when the platform provider is already anthropic',()=>{
 assert.ok(analyzeCompanyBlock,'analyze-company block not found');
 assert.match(analyzeCompanyBlock,/process\.env\.AI_PROVIDER==='anthropic'\?await resolveProviderCredential/);
});
test('F — the resolved credential_source is forwarded to recordApiUsage as billingSource, and stripped out of the client-facing JSON',()=>{
 assert.match(analyzeCompanyBlock,/const \{usage,credential_source,\.\.\.analysis\}=await analyzeCompanyGuarded/,'credential_source is destructured out of the object returned to the client');
 assert.match(analyzeCompanyBlock,/billingSource:credential_source/);
 assert.match(analyzeCompanyBlock,/return json\(analysis\)/,'the public response is built from `analysis` only — never includes credential_source or usage');
});
test('F — a BYOK resolution/decryption failure is swallowed to null (falls back to the platform key) rather than ever surfacing to the client',()=>{
 assert.match(analyzeCompanyBlock,/resolveProviderCredential\([^)]*\)\.catch\(\(\)=>null\)/);
});

// ------------------------------------------------------------
// G — no server module in this bloc's new code path ever logs, or otherwise leaks, a decrypted key.
// ------------------------------------------------------------
test('G — no console.* call anywhere in ai.ts, byok.ts or usage.ts ever references the resolved key/apiKeyOverride/plaintext secret',()=>{
 for(const path of ['../src/server/ai.ts','../src/server/byok.ts','../src/server/usage.ts']){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  const consoleCalls=source.match(/console\.[a-z]+\([^)]*\)/g)??[];
  for(const call of consoleCalls)
   for(const forbidden of [/apiKeyOverride/,/plaintext/,/decryptSecret/,/\bkey\b/])
    assert.doesNotMatch(call,forbidden,`console call "${call}" must never reference the decrypted key`);
 }
});
