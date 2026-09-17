import test from 'node:test';
import assert from 'node:assert/strict';
import {withAiQuota,projectIdSchema,analyzeCompanyGuarded} from '../src/server/ai-guard.ts';

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

// project_id validation: same UUID shape as the rest of the codebase (src/discovery/api.ts).
test('projectIdSchema rejects non-UUID strings and accepts a real UUID',()=>{
 for(const bad of ['not-a-uuid','','12345',"'; drop table projects; --",'00000000-0000-0000-0000-00000000000']){
  assert.equal(projectIdSchema.safeParse(bad).success,false,`expected "${bad}" to be rejected`);
 }
 assert.equal(projectIdSchema.safeParse('00000000-0000-4000-8000-000000000001').success,true);
});

// A malformed project_id must be rejected before the quota RPC AND before the provider ever run —
// neither one may be reached, in either order.
test('an invalid project_id is rejected before the quota check and before the provider run',async()=>{
 let consumeCalls=0,providerCalls=0;
 await assert.rejects(
  analyzeCompanyGuarded('not-a-uuid',async()=>{consumeCalls++},async()=>{providerCalls++}),
  /INVALID_PROJECT_ID/,
 );
 assert.equal(consumeCalls,0);
 assert.equal(providerCalls,0);
});

// A valid project_id still goes through the normal consume-then-call order, unaffected by the new gate.
test('a valid project_id still consumes the quota before calling the provider, exactly once each',async()=>{
 let receivedProjectId:string|undefined,consumeCalls=0,providerCalls=0;
 const id='00000000-0000-4000-8000-000000000001';
 const result=await analyzeCompanyGuarded(id,async(projectId)=>{receivedProjectId=projectId;consumeCalls++},async()=>{providerCalls++;return 'ok'});
 assert.equal(receivedProjectId,id);
 assert.equal(consumeCalls,1);
 assert.equal(providerCalls,1);
 assert.equal(result,'ok');
});
