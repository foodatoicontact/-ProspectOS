import test, {mock} from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// BLOC 4A.4.2 — SECURITY GATE sentinel leak test (Section 7 of the brief).
//
// SENTINEL is a clearly fake, obviously-not-real credential string — never a real Anthropic key, never
// used for any real network call (every fetch/DB dependency below is mocked). It is EXPECTED to appear
// in this file's own source and transiently in memory while a test runs — that is not a leak. Every
// assertion below checks that it does NOT appear anywhere OUTSIDE the one explicitly necessary
// transmission point per scenario (e.g. the outbound provider header in scenario C), using the REAL
// production functions from src/server/{byok,ai,account}.ts, never a reimplementation.
// ============================================================
const SENTINEL = 'sk-ant-FAKE-SECRET-LEAK-TEST-9f3a7c2e';
const sentinelPattern = new RegExp(SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
function assertNoSentinel(haystack: unknown, label: string) {
 const serialized = typeof haystack === 'string' ? haystack : JSON.stringify(haystack);
 assert.doesNotMatch(serialized ?? '', sentinelPattern, `sentinel leaked into ${label}`);
}
// A minimal chainable/thenable stub covering both query shapes account.ts actually uses:
// `await db.from(t).select(cols)` (awaited directly) and `db.from(t).select(cols).eq(...).maybeSingle()`.
function chainable(result: {data: unknown; error: null}) {
 return {eq: () => chainable(result), maybeSingle: () => Promise.resolve(result), then: (res: any, rej: any) => Promise.resolve(result).then(res, rej)};
}

process.env.BYOK_MASTER_KEY = Buffer.alloc(32, 3).toString('base64');
const {saveProviderCredential, deleteProviderCredential, listProviderCredentials} = await import('../src/server/byok.ts');
const {encryptSecret, last4} = await import('../src/server/crypto.ts');
const {analyzeOffer} = await import('../src/server/ai.ts');
const {buildAccountExportZip} = await import('../src/server/account.ts');

// ---- A. save credential ----
test('sentinel A — save credential never returns the plaintext sentinel, only ciphertext + last4 reach the RPC', async () => {
 const rpcCalls: Array<Record<string, unknown>> = [];
 const fakeDb = {rpc: (_name: string, params: Record<string, unknown>) => {
  rpcCalls.push(params);
  return Promise.resolve({data: {provider: 'anthropic', key_last4: last4(SENTINEL), created_at: 'now', updated_at: 'now'}, error: null});
 }} as any;
 const summary = await saveProviderCredential(fakeDb, 'org-1', 'anthropic', SENTINEL);
 assertNoSentinel(summary, 'saveProviderCredential return value');
 for (const params of rpcCalls) assertNoSentinel(params, 'save_provider_credential RPC params (ciphertext/iv/tag/last4 only)');
});

// ---- B. list/status ----
test('sentinel B — list/status never returns the plaintext sentinel, only metadata + last4', async () => {
 const fakeDb = {rpc: () => Promise.resolve({data: [{provider: 'anthropic', key_last4: last4(SENTINEL), created_at: 'now', updated_at: 'now'}], error: null})} as any;
 const list = await listProviderCredentials(fakeDb, 'org-1');
 assertNoSentinel(list, 'listProviderCredentials return value');
 assert.equal(list[0].key_last4, last4(SENTINEL));
});

// ---- C. simulated valid BYOK usage ----
test('sentinel C — a BYOK call using the sentinel as apiKeyOverride sends it ONLY as the provider header, never returns it', async () => {
 process.env.AI_PROVIDER = 'anthropic'; process.env.AI_API_KEY = 'unrelated-platform-key-never-used-here'; process.env.AI_MODEL = 'claude-sonnet-5';
 const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
  assert.equal(init.headers['x-api-key'], SENTINEL, 'the sentinel must reach the provider header — this is the one legitimate transmission point');
  return {ok: true, status: 200, json: async () => ({content: [{type: 'text', text: JSON.stringify({summary: 's', target: 't', questions: ['q']})}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}})};
 });
 try {
  const result = await analyzeOffer('un texte public suffisamment long pour la validation métier', {apiKeyOverride: SENTINEL});
  assertNoSentinel(result, 'analyzeOffer result (BYOK branch)');
 } finally { fetchMock.mock.restore(); }
});

// ---- D. corrupted ciphertext/tag/IV ----
test('sentinel D — a corrupted stored credential (encrypted from the sentinel, then tampered) fails closed and never leaks the sentinel/ciphertext/iv/tag anywhere, including logs', async () => {
 const encrypted = encryptSecret(SENTINEL);
 const toBytea = (buf: Buffer) => '\\x' + buf.toString('hex');
 const tamperedCiphertext = Buffer.from(encrypted.ciphertext); tamperedCiphertext[0] ^= 0xff;
 mock.module('../src/server/admin-client.ts', {namedExports: {createAdminClient: () => ({
  from: () => ({select: () => ({eq: () => ({eq: () => ({maybeSingle: async () => ({data: {encrypted_secret: toBytea(tamperedCiphertext), iv: toBytea(encrypted.iv), auth_tag: toBytea(encrypted.authTag)}, error: null})})})})}),
 })}});
 const consoleErrorSpy = mock.method(console, 'error', () => {});
 const consoleLogSpy = mock.method(console, 'log', () => {});
 try {
  const {resolveProviderCredential: freshResolve} = await import(`../src/server/byok.ts?d=${Date.now()}`);
  const result = await freshResolve('org-1', 'anthropic');
  assert.deepEqual(result, {status: 'INVALID'}, 'fail-closed: a corrupted credential resolves to INVALID, never a fabricated key, never a throw that could carry crypto detail');
  assertNoSentinel(result, 'INVALID resolution result');
  for (const call of [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]) assertNoSentinel(call.arguments, 'console output during a corrupted-credential resolution');
 } finally { consoleErrorSpy.mock.restore(); consoleLogSpy.mock.restore(); mock.reset(); }
});

// ---- E. simulated provider error ----
test('sentinel E — a simulated non-2xx provider response never lets the sentinel/header/body leak into the thrown error, and the response body is never even read', async () => {
 process.env.AI_PROVIDER = 'anthropic'; process.env.AI_MODEL = 'claude-sonnet-5';
 const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init: any) => {
  assert.equal(init.headers['x-api-key'], SENTINEL);
  return {
   ok: false, status: 401,
   // If analyzeOffer ever regressed to read a non-ok body (e.g. to relay a provider error detail), this
   // throws loudly instead of silently letting a sensitive body through — the current code never calls
   // this on the non-ok path (see src/server/ai.ts: the `if(!response.ok)throw` happens strictly before
   // `response.json()`).
   json: async () => { throw Error('regression: the non-ok branch must never call .json() on the response'); },
  };
 });
 try {
  await assert.rejects(
   analyzeOffer('un texte public suffisamment long pour la validation métier', {apiKeyOverride: SENTINEL}),
   (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, 'AI_UNAVAILABLE', 'a stable, generic code — never the provider status/body/headers');
    assertNoSentinel(err.message, 'thrown AI_UNAVAILABLE error message');
    return true;
   },
  );
 } finally { fetchMock.mock.restore(); }
});

// ---- F. delete credential ----
test('sentinel F — deleting a credential never transmits or returns any key material (delete only ever needs provider+org id)', async () => {
 const rpcCalls: Array<Record<string, unknown>> = [];
 const fakeDb = {rpc: (_name: string, params: Record<string, unknown>) => {rpcCalls.push(params); return Promise.resolve({data: null, error: null})}} as any;
 await deleteProviderCredential(fakeDb, 'org-1', 'anthropic');
 for (const params of rpcCalls) {
  assertNoSentinel(params, 'delete_provider_credential RPC params');
  assert.deepEqual(Object.keys(params).sort(), ['p_organization_id', 'p_provider']);
 }
});

// ---- G. account/RGPD export ----
test('sentinel G — buildAccountExportZip never queries provider_credentials, dynamically confirmed (not just by a static source grep)', async () => {
 const queriedTables: string[] = [];
 const fakeDb = {from: (table: string) => { queriedTables.push(table); return {select: () => chainable({data: [], error: null})}; }} as any;
 await buildAccountExportZip(fakeDb, {id: 'user-1', email: 'user@example.com'});
 assert.ok(!queriedTables.includes('provider_credentials'), `provider_credentials must never be queried by the export — tables actually queried: ${queriedTables.join(',')}`);
});
