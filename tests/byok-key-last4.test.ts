import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

// ============================================================
// BYOK key_last4 + input trimming. A pasted Anthropic key whose tail holds '-', '_' or whitespace used to
// produce a key_last4 the provider_credentials CHECK (migration 009) rejects, so the save failed with a generic
// 400 and nothing was stored. Every key below is fake; assertions never print a key (ok() with a fixed message).
// ============================================================

process.env.BYOK_MASTER_KEY??=randomBytes(32).toString('base64');
const {last4,decryptSecret}=await import('../src/server/crypto.ts');
const {saveProviderCredential,ProviderCredentialSaveSchema}=await import('../src/server/byok.ts');

const migration009=readFileSync(new URL('../db/migrations/009_real_discovery_cost_byok.sql',import.meta.url),'utf8');
const constraintSource=migration009.match(/key_last4 text not null check\(key_last4 ~ '([^']+)'\)/)?.[1];
const DB_KEY_LAST4=new RegExp(constraintSource??'(?!)');

const FAKE='sk-ant-api03-FAKE-test-only-0000';
const TAILS:[string,string][]=[
 ['ending with -',`${FAKE}xyZ9-`],
 ['ending with _',`${FAKE}xyZ9_`],
 ['ending with a space',`${FAKE}xyZ9 `],
 ['ending with a newline',`${FAKE}xyZ9\n`],
 ['ending with -AbC_',`${FAKE}9-AbC_`],
];

test('contract — the code reads the exact key_last4 CHECK of migration 009',()=>{
 assert.equal(constraintSource,'^[A-Za-z0-9]{4}$','migration 009 key_last4 CHECK changed: update last4() and this contract together');
});

for(const [label,key] of TAILS){
 test(`last4 — key ${label} still yields a preview the DB CHECK accepts`,()=>{
  assert.match(last4(key),DB_KEY_LAST4);
 });
}

test('last4 — previews built only from the alphanumeric tail',()=>{
 assert.equal(last4(`${FAKE}xyZ9-`),'xyZ9');
 assert.equal(last4(`${FAKE}9-AbC_`),'9AbC');
});

test('last4 — an alphanumeric key keeps its exact last four characters (unchanged behaviour)',()=>{
 assert.equal(last4('sk-ant-api03-realistic-looking-key12'),'ey12');
 assert.equal(last4('abcdefgh'),'efgh');
});

test('last4 — a key with fewer than four alphanumerics is padded and still matches the CHECK',()=>{
 assert.match(last4('-_-_-_-_a'),DB_KEY_LAST4);
 assert.match(last4('--------'),DB_KEY_LAST4);
});

test('POST schema — surrounding whitespace is trimmed before anything else sees the key',()=>{
 const parsed=ProviderCredentialSaveSchema.parse({provider:'anthropic',api_key:`  ${FAKE}xyZ9\n`});
 assert.ok(parsed.api_key===`${FAKE}xyZ9`,'api_key must be the trimmed key');
});

test('POST schema — length bounds apply to the trimmed key',()=>{
 assert.throws(()=>ProviderCredentialSaveSchema.parse({provider:'anthropic',api_key:'   abc   \n'}));
 assert.throws(()=>ProviderCredentialSaveSchema.parse({provider:'anthropic',api_key:'x'.repeat(501)}));
 assert.throws(()=>ProviderCredentialSaveSchema.parse({provider:'anthropic',api_key:`${FAKE}xyZ9`,extra:1}),'schema stays strict');
});

test('save — the encrypted value and key_last4 come from the trimmed key, never the raw paste',async()=>{
 const calls:Record<string,unknown>[]=[];
 const fakeDb={rpc:(_name:string,params:Record<string,unknown>)=>{calls.push(params);return Promise.resolve({data:{},error:null})}} as any;
 const {api_key}=ProviderCredentialSaveSchema.parse({provider:'anthropic',api_key:` \t${FAKE}9-AbC_ \n`});
 await saveProviderCredential(fakeDb,'org-1','anthropic',api_key);
 const params=calls[0];
 const bytes=(value:unknown)=>Buffer.from(String(value).replace(/^\\x/,''),'hex');
 const decrypted=decryptSecret({ciphertext:bytes(params.p_encrypted_secret),iv:bytes(params.p_iv),authTag:bytes(params.p_auth_tag)});
 assert.ok(decrypted===`${FAKE}9-AbC_`,'the encrypted secret must be exactly the trimmed key');
 assert.match(String(params.p_key_last4),DB_KEY_LAST4);
 assert.equal(params.p_key_last4,'9AbC');
 for(const value of Object.values(params))assert.ok(!String(value).includes(FAKE),'the plaintext key must never reach the RPC');
});

test('route — POST provider-credentials parses with the shared trimming parser and saves the parsed key',()=>{
 const route=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 const block=route.split("if(resource==='provider-credentials'){")[1]?.split("if(request.method==='DELETE')")[0]??'';
 assert.match(block,/parseProviderCredentialSave\(body\)/);
 assert.match(block,/saveProviderCredential\(db,organizationId,b\.provider,b\.api_key\)/);
 assert.doesNotMatch(block,/api_key:z\.string\(\)/,'no second, untrimmed api_key schema in the route');
});
