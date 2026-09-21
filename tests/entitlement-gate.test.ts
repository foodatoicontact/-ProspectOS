import test from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// BETA HOTFIX — fail-closed requireActiveEntitlement() unit coverage. Exercises the REAL production
// function from src/server/entitlement.ts, never a reimplementation. The DB client is a minimal fake
// mirroring exactly the one chain the function actually calls (`db.from(t).select(c).eq(k,v).maybeSingle()`)
// — no network, no real Supabase project, no provider call of any kind.
// ============================================================
const {requireActiveEntitlement} = await import('../src/server/entitlement.ts');

function fakeDb(result: {data: unknown; error: {message: string} | null}) {
 return {
  from: () => ({
   select: () => ({
    eq: () => ({
     maybeSingle: async () => result,
    }),
   }),
  }),
 } as any;
}

// ---- 1. NO ENTITLEMENT — the closed legacy bypass. Must now fail closed, never silently allow. ----
test('1 — no entitlement row at all => ENTITLEMENT_REQUIRED (never a silent allow, the legacy bypass is closed)', async () => {
 const db = fakeDb({data: null, error: null});
 await assert.rejects(requireActiveEntitlement(db, 'user-1'), (err: unknown) => {
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'ENTITLEMENT_REQUIRED');
  return true;
 });
});

// ---- 2. INTERNAL — always allowed, regardless of expires_at (even one already in the past). ----
test('2 — plan=INTERNAL, status=ACTIVE => allowed, even if expires_at is technically in the past', async () => {
 const db = fakeDb({data: {plan: 'INTERNAL', status: 'ACTIVE', expires_at: new Date(Date.now() - 86400000).toISOString()}, error: null});
 await assert.doesNotReject(requireActiveEntitlement(db, 'owner-1'));
});

// ---- 3. BETA active — allowed. ----
test('3 — plan=BETA, status=ACTIVE, expires_at in the future => allowed', async () => {
 const db = fakeDb({data: {plan: 'BETA', status: 'ACTIVE', expires_at: new Date(Date.now() + 86400000).toISOString()}, error: null});
 await assert.doesNotReject(requireActiveEntitlement(db, 'beta-user'));
});

// ---- 4. BETA expired — denied with the existing, unchanged public code. ----
test('4 — plan=BETA, status=ACTIVE, expires_at in the past => BETA_ACCESS_EXPIRED', async () => {
 const db = fakeDb({data: {plan: 'BETA', status: 'ACTIVE', expires_at: new Date(Date.now() - 1000).toISOString()}, error: null});
 await assert.rejects(requireActiveEntitlement(db, 'beta-user'), /BETA_ACCESS_EXPIRED/);
});

// ---- 5. BETA with a non-ACTIVE status (REVOKED/EXPIRED) — denied even if expires_at hasn't passed. ----
test('5 — plan=BETA, status=REVOKED, expires_at still in the future => BETA_ACCESS_EXPIRED (status is checked, not just the date)', async () => {
 const db = fakeDb({data: {plan: 'BETA', status: 'REVOKED', expires_at: new Date(Date.now() + 86400000).toISOString()}, error: null});
 await assert.rejects(requireActiveEntitlement(db, 'beta-user'), /BETA_ACCESS_EXPIRED/);
});

// ---- 6. INTERNAL with a non-ACTIVE status — also denied (INTERNAL bypasses expiry, never status). ----
test('6 — plan=INTERNAL, status=REVOKED => BETA_ACCESS_EXPIRED (INTERNAL only bypasses the expiry check, never the status check)', async () => {
 const db = fakeDb({data: {plan: 'INTERNAL', status: 'REVOKED', expires_at: new Date(Date.now() + 86400000 * 365 * 100).toISOString()}, error: null});
 await assert.rejects(requireActiveEntitlement(db, 'owner-1'), /BETA_ACCESS_EXPIRED/);
});

// ---- 7. A database error never resolves to a fabricated allow/deny — it's its own stable code. ----
test('7 — a database error on the read => DATABASE_REQUEST_FAILED, never a fabricated allow', async () => {
 const db = fakeDb({data: null, error: {message: 'connection reset'}});
 await assert.rejects(requireActiveEntitlement(db, 'user-1'), (err: unknown) => {
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'DATABASE_REQUEST_FAILED');
  assert.doesNotMatch(err.message, /connection reset/, 'the raw DB error detail must never leak into the thrown code');
  return true;
 });
});

// ---- 8. Never trusts a client-supplied userId beyond which row to look at (RLS is the real boundary,
// this just confirms the function itself never reads/branches on anything but the row it's handed). ----
test('8 — the function never returns or leaks the queried row itself, only allows or throws a stable code', async () => {
 const db = fakeDb({data: {plan: 'BETA', status: 'ACTIVE', expires_at: new Date(Date.now() + 86400000).toISOString()}, error: null});
 const result = await requireActiveEntitlement(db, 'beta-user');
 assert.equal(result, undefined, 'resolves to void — never echoes back plan/status/expires_at or any other row content');
});
