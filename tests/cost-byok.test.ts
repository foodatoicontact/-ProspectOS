import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// ============================================================
// BYOK encryption: AES-256-GCM round-trip, pure unit tests (no DB, no network).
// ============================================================
process.env.BYOK_MASTER_KEY=Buffer.alloc(32,7).toString('base64');
const {encryptSecret,decryptSecret,last4}=await import('../src/server/crypto.ts');

test('BYOK crypto: round-trip returns the exact original plaintext', () => {
 const secret='sk-live-abcdefghijklmnopqrstuvwxyz0123456789';
 const encrypted=encryptSecret(secret);
 assert.equal(decryptSecret(encrypted),secret);
});

test('BYOK crypto: two encryptions of the same plaintext never produce the same ciphertext or IV', () => {
 const a=encryptSecret('same-secret'),b=encryptSecret('same-secret');
 assert.notEqual(a.iv.toString('hex'),b.iv.toString('hex'),'a fresh random IV must be used every time');
 assert.notEqual(a.ciphertext.toString('hex'),b.ciphertext.toString('hex'));
});

test('BYOK crypto: a tampered ciphertext or auth tag fails to decrypt (authenticity, not just confidentiality)', () => {
 const encrypted=encryptSecret('a-real-looking-api-key');
 const tamperedCiphertext={...encrypted,ciphertext:Buffer.from(encrypted.ciphertext)};tamperedCiphertext.ciphertext[0]^=0xff;
 assert.throws(()=>decryptSecret(tamperedCiphertext));
 const tamperedTag={...encrypted,authTag:Buffer.from(encrypted.authTag)};tamperedTag.authTag[0]^=0xff;
 assert.throws(()=>decryptSecret(tamperedTag));
});

test('BYOK crypto: encryptSecret refuses to run without a configured master key', () => {
 const saved=process.env.BYOK_MASTER_KEY;delete process.env.BYOK_MASTER_KEY;
 try{assert.throws(()=>encryptSecret('x'),/CONFIGURATION_REQUIRED/)}finally{process.env.BYOK_MASTER_KEY=saved}
});

test('last4 always returns exactly 4 characters, even for a very short input', () => {
 assert.equal(last4('abcdwxyz'),'wxyz');
 assert.equal(last4('ab'),'00ab');
});

// ============================================================
// Z — the fixture/TEST provider never produces a real-looking cost record. Static, source-level proof
// (same convention as tests/account-session.test.ts's server-enforcement checks): the ONLY call to
// recordApiUsage in the Discovery search path is inside the meter built for `name==='brave'` only
// (Discovery Recall V3: the meter records the real request count) — the fixture path gets no meter.
// ============================================================
const discoveryApi=readFileSync(new URL('../src/discovery/api.ts',import.meta.url),'utf8');
test('Z — recordApiUsage for a search is only ever called for the real Brave provider, never for fixture/TEST', () => {
 const braveBranch=discoveryApi.match(/const meter=name==='brave'\?async\([^)]*\)=>\{[^\n]*?recordApiUsage\([^\n]*\}:undefined;/);
 assert.ok(braveBranch,'recordApiUsage must be called from inside the brave-only branch');
 // And the inverse: the whole discovery POST handler contains exactly one recordApiUsage call — nothing
 // in the fixture path (which runs unconditionally before the brave-only guard) reaches it either.
 const callCount=(discoveryApi.match(/recordApiUsage\(/g)??[]).length;
 assert.equal(callCount,1,'exactly one recordApiUsage call site in the Discovery search handler, and it is provider-gated');
});

// ============================================================
// AA — an expired beta entitlement blocks REAL Discovery exactly like it already blocks TEST/fixture
// Discovery: requireActiveEntitlement is called unconditionally, before the provider (fixture vs brave)
// is even chosen — so this was already true before this bloc, and remains true after it (no branch was
// added that could bypass the gate for provider==='brave' specifically).
// ============================================================
test('AA — the entitlement gate for a Discovery search runs before the provider is even selected, so it can never be bypassed for the real (Brave) provider specifically', () => {
 const gateBeforeProvider=discoveryApi.match(/requireActiveEntitlement\(db,user\.id\);[\s\S]*?const provider=name==='brave'/);
 assert.ok(gateBeforeProvider,'requireActiveEntitlement must run before any provider — fixture or brave — is instantiated');
});

// ============================================================
// X — the RGPD export never queries provider_credentials at all (no BYOK secret can ever end up in an
// export, because the table is never even read by it).
// ============================================================
const accountSource=readFileSync(new URL('../src/server/account.ts',import.meta.url),'utf8');
test('X — buildAccountExportZip never selects from provider_credentials (BYOK secrets can never reach an export)', () => {
 assert.doesNotMatch(accountSource,/provider_credentials/);
});

// ============================================================
// V — the platform Brave/AI provider keys are only ever read from server-only env vars, never returned
// in any Discovery/cost API response.
// ============================================================
const usageSource=readFileSync(new URL('../src/server/usage.ts',import.meta.url),'utf8');
const costMetricsSource=readFileSync(new URL('../src/discovery/cost-metrics.ts',import.meta.url),'utf8');
test('V — no server module in the cost-metering path ever references a platform API key directly, let alone returns one', () => {
 for(const source of [usageSource,costMetricsSource])
  for(const forbidden of [/BRAVE_SEARCH_API_KEY/,/AI_API_KEY/,/SUPABASE_SERVICE_ROLE_KEY/])
   assert.doesNotMatch(source,forbidden,`${forbidden} must never be referenced directly in the cost-observability read path`);
});
