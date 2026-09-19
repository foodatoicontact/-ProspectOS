import test, {mock} from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// BLOC 4A.4.3 — Sonnet 5 structured-analysis hardening. Every scenario is mocked at the `fetch` level —
// NEVER a real network call, NEVER a real Anthropic key. Exercises the real production analyzeOffer()
// from src/server/ai.ts, not a reimplementation.
// ============================================================
const savedEnv={AI_PROVIDER:process.env.AI_PROVIDER,AI_API_KEY:process.env.AI_API_KEY,AI_MODEL:process.env.AI_MODEL};
test.after(()=>{process.env.AI_PROVIDER=savedEnv.AI_PROVIDER;process.env.AI_API_KEY=savedEnv.AI_API_KEY;process.env.AI_MODEL=savedEnv.AI_MODEL});

function mockFetchOnce(status:number,jsonBody:unknown){
 return mock.method(globalThis,'fetch',async()=>({ok:status>=200&&status<300,status,json:async()=>jsonBody}) as unknown as Response);
}

const {analyzeOffer}=await import('../src/server/ai.ts');

function setAnthropicEnv(){process.env.AI_PROVIDER='anthropic';process.env.AI_API_KEY='platform-key-hardening-test';process.env.AI_MODEL='claude-sonnet-5';}
const validText='un texte public suffisamment long pour passer la validation métier';

// ---- 1. thinking.type === 'disabled' in the outgoing payload ----
test('1 — the Anthropic request body sets thinking:{type:"disabled"}',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await analyzeOffer(validText);
  const [,init]=fetchMock.mock.calls[0].arguments as [string,{body:string}];
  const sentBody=JSON.parse(init.body);
  assert.deepEqual(sentBody.thinking,{type:'disabled'});
 }finally{fetchMock.mock.restore()}
});

// ---- 2. max_tokens equals the retained value (2048) ----
test('2 — the Anthropic request body sets max_tokens to the retained conservative value (2048)',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await analyzeOffer(validText);
  const [,init]=fetchMock.mock.calls[0].arguments as [string,{body:string}];
  const sentBody=JSON.parse(init.body);
  assert.equal(sentBody.max_tokens,2048);
 }finally{fetchMock.mock.restore()}
});

// ---- 3. no text block at all ----
test('3 — no text block in content => a stable code (AI_INVALID_RESULT), never a raw SyntaxError',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'thinking',thinking:'internal reasoning only, no answer emitted'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof Error);
   assert.equal(err.message,'AI_INVALID_RESULT');
   assert.notEqual(err.constructor.name,'SyntaxError');
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

// ---- 4. text === '' ----
test('4 — an empty text block => AI_INVALID_RESULT, never JSON.parse(\'\') leaking as a raw SyntaxError',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:''}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof Error);
   assert.equal(err.message,'AI_INVALID_RESULT');
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

// ---- 5. whitespace-only text ----
test('5 — a whitespace-only text block => AI_INVALID_RESULT',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'   \n\t  '}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText),/AI_INVALID_RESULT/);
 }finally{fetchMock.mock.restore()}
});

// ---- 6. malformed JSON ----
test('6 — malformed JSON text => AI_INVALID_RESULT, never a raw SyntaxError',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'{not valid json'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof Error);
   assert.equal(err.message,'AI_INVALID_RESULT');
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

// ---- 7. valid JSON, wrong schema ----
test('7 — valid JSON but wrong schema (missing/invalid fields) => AI_INVALID_RESULT',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:123,target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText),/AI_INVALID_RESULT/);
 }finally{fetchMock.mock.restore()}
});

// ---- 8. thinking block + valid text block => success ----
test('8 — a thinking block preceding a valid text block still succeeds (correct content[].type===\'text\' selection)',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'thinking',thinking:'reasoning...'},{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'end_turn',usage:{input_tokens:7,output_tokens:3}});
 try{
  const result=await analyzeOffer(validText);
  assert.equal(result.summary,'s');
  assert.equal(result.target,'t');
  assert.deepEqual(result.questions,['q']);
  assert.equal(result.usage.input_tokens,7);
 }finally{fetchMock.mock.restore()}
});

// ---- 9. stop_reason === 'max_tokens' ----
test('9 — stop_reason max_tokens fails closed with a dedicated stable code (AI_TRUNCATED_RESULT), even if content happens to look parseable',async()=>{
 setAnthropicEnv();
 // Deliberately give it content that WOULD parse successfully, to prove stop_reason is checked first.
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'max_tokens',usage:{input_tokens:1,output_tokens:2048}});
 try{
  await assert.rejects(analyzeOffer(validText),/AI_TRUNCATED_RESULT/);
 }finally{fetchMock.mock.restore()}
});

// ---- 10. stop_reason === 'refusal' ----
test('10 — stop_reason refusal fails closed with a stable code',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:'Je ne peux pas répondre à cette demande.'}],stop_reason:'refusal',usage:{input_tokens:1,output_tokens:1}});
 try{
  await assert.rejects(analyzeOffer(validText),(err:unknown)=>{
   assert.ok(err instanceof Error);
   assert.ok(['AI_INVALID_RESULT','AI_TRUNCATED_RESULT'].includes(err.message),`expected a stable fail-closed code, got ${err.message}`);
   return true;
  });
 }finally{fetchMock.mock.restore()}
});

// ---- 11. normal valid response — parsing unchanged ----
test('11 — a normal, complete, valid response (stop_reason end_turn, single text block) parses exactly as before',async()=>{
 setAnthropicEnv();
 const fetchMock=mockFetchOnce(200,{content:[{type:'text',text:JSON.stringify({summary:'Résumé réel','target':'PME locales','questions':['Combien de succursales ?']})}],stop_reason:'end_turn',usage:{input_tokens:120,output_tokens:45}});
 try{
  const result=await analyzeOffer(validText);
  assert.equal(result.summary,'Résumé réel');
  assert.equal(result.target,'PME locales');
  assert.deepEqual(result.questions,['Combien de succursales ?']);
  assert.equal(result.status,'PROPOSITION_À_VALIDER');
  assert.equal(result.credential_source,'PLATFORM');
  assert.equal(result.usage.input_tokens,120);
  assert.equal(result.usage.output_tokens,45);
 }finally{fetchMock.mock.restore()}
});

// ---- 12. no leak of secrets/provider body in any of the above failure paths ----
test('12 — none of the fail-closed error paths ever expose x-api-key, the platform/BYOK key, or the raw provider body',async()=>{
 setAnthropicEnv();
 const scenarios:Array<{label:string;body:unknown}>=[
  {label:'no text block',body:{content:[{type:'thinking',thinking:'secret-looking-key-should-never-appear-anywhere'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}},
  {label:'malformed JSON',body:{content:[{type:'text',text:'{not json, x-api-key: sk-ant-should-never-leak'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}},
  {label:'truncated',body:{content:[{type:'text',text:JSON.stringify({summary:'s',target:'t',questions:['q']})}],stop_reason:'max_tokens',usage:{input_tokens:1,output_tokens:1}}},
 ];
 for(const scenario of scenarios){
  const fetchMock=mockFetchOnce(200,scenario.body);
  try{
   await assert.rejects(analyzeOffer(validText,{apiKeyOverride:'byok-key-must-not-leak-anywhere'}),(err:unknown)=>{
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message,/byok-key-must-not-leak-anywhere/);
    assert.doesNotMatch(err.message,/platform-key-hardening-test/);
    assert.doesNotMatch(err.message,/x-api-key/);
    assert.doesNotMatch(err.message,/sk-ant-/);
    // The stable code itself is short and enumerable — never the provider body serialized into it.
    assert.ok(['AI_INVALID_RESULT','AI_TRUNCATED_RESULT'].includes(err.message),`scenario "${scenario.label}": expected a stable code, got "${err.message}"`);
    return true;
   });
  }finally{fetchMock.mock.restore()}
 }
});
