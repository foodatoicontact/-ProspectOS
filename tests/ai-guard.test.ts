import test from 'node:test';
import assert from 'node:assert/strict';
import {withAiQuota} from '../src/server/ai-guard.ts';

// Q8 — a request rejected by the quota check must never reach the paid provider.
test('provider is never called when the quota check rejects',async()=>{
 let providerCalls=0;
 await assert.rejects(
  withAiQuota(async()=>{throw Error('QUOTA_EXCEEDED')},async()=>{providerCalls++}),
  /QUOTA_EXCEEDED/,
 );
 assert.equal(providerCalls,0);
});

// Fail-closed red-team case: the quota check failing for an unrelated infrastructure reason (DB
// unreachable, unexpected error) must ALSO block the provider call — never "call anyway for safety".
test('provider is never called when the quota check fails for an unrelated reason (fail-closed)',async()=>{
 let providerCalls=0;
 await assert.rejects(
  withAiQuota(async()=>{throw Error('DATABASE_REQUEST_FAILED')},async()=>{providerCalls++}),
  /DATABASE_REQUEST_FAILED/,
 );
 assert.equal(providerCalls,0);
});

// Allowed path: quota consumed, then (and only then) the provider runs exactly once.
test('provider runs exactly once after the quota check succeeds',async()=>{
 let consumeCalls=0,providerCalls=0;
 const result=await withAiQuota(async()=>{consumeCalls++},async()=>{providerCalls++;return 'ok'});
 assert.equal(consumeCalls,1);
 assert.equal(providerCalls,1);
 assert.equal(result,'ok');
});

// Q9 — a provider failure AFTER the quota was consumed does not trigger any refund attempt: the quota
// call is invoked exactly once, never a second time to "give the unit back".
test('a provider failure after a successful quota consumption never re-invokes the quota check',async()=>{
 let consumeCalls=0;
 await assert.rejects(
  withAiQuota(async()=>{consumeCalls++},async()=>{throw Error('AI_UNAVAILABLE')}),
  /AI_UNAVAILABLE/,
 );
 assert.equal(consumeCalls,1);
});
