import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// This project has no browser/E2E harness (no jsdom/React Testing Library anywhere in the repo —
// see tests/mobile-layout.test.ts for the same precedent). These are static, source-level proofs of
// the Compte/déconnexion invariants: they read app/page.tsx and app/globals.css as text and assert on
// their content/structure, exactly like the existing mobile-layout guards. They cannot replace a real
// click-through against a live Supabase session, but they catch a regression of the actual code path.
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
// Isolate the account modal's own JSX so assertions about "what it renders" can't accidentally match
// unrelated parts of the file (e.g. another modal, or the outreach draft's own evidence ids).
const accountModalMatch=page.match(/\{modal==='account'&&<div className="modal-backdrop"[\s\S]*?<\/section><\/div>\}/);
const accountModal=accountModalMatch?.[0]??'';
const logoutFnMatch=page.match(/async function logout\(\)\{.*\}/);
const logoutFn=logoutFnMatch?.[0]??'';

test('setup sanity: the account modal and logout() blocks were actually found in the source',()=>{
 assert.ok(accountModal,'account modal JSX not found — later assertions would be vacuous');
 assert.ok(logoutFn,'logout() function not found — later assertions would be vacuous');
});

// --- A: a connected user sees their email ---
test('A — the account panel displays the authenticated user\'s email',()=>{
 assert.match(accountModal,/\{userEmail\|\|.*?\}/);
 assert.match(page,/setUserEmail\(session\.user\.email/,'email is captured from the real Supabase session, never invented');
});

// --- B: current organization shown when available ---
test('B — the organization is displayed only when already available, fetched from the user\'s own RLS-scoped organizations',()=>{
 assert.match(accountModal,/\{orgName&&<div className="account-field">/);
 assert.match(page,/api\('organizations','GET'/,'reuses the existing organizations endpoint — no new API surface');
});

// --- C: no technical/token data ever rendered in the account panel ---
test('C — no UUID, tenant id, token, or other technical Supabase field is ever rendered in the account panel',()=>{
 for(const forbidden of [/access_token/,/refresh_token/,/\btoken\b/,/organization_id/,/\.id\}/,/identity\.current/])
  assert.doesNotMatch(accountModal,forbidden,`forbidden technical field pattern ${forbidden} found in the account panel JSX`);
});

// --- D: logout actually invalidates the session (not a UI-only mask) ---
test('D — logout calls Supabase\'s real signOut(), it does not just hide the interface',()=>{
 assert.match(logoutFn,/auth\?\.auth\.signOut\(\)/);
});
test('D — logout clears every piece of local identity state',()=>{
 for(const cleared of [/setToken\(''\)/,/setUserEmail\(''\)/,/setOrgName\(''\)/,/identity\.current=null/])
  assert.match(logoutFn,cleared);
});
test('D — logout still clears local state even if the network signOut() call fails (never leaves a falsely-connected UI)',()=>{
 assert.match(logoutFn,/try\{await auth\?\.auth\.signOut\(\)\}catch/);
});

// --- E: logout returns to the public/auth screen ---
test('E — logout resets the app to the public welcome screen',()=>{
 assert.match(logoutFn,/setMode\('welcome'\)/);
});

// --- F: logout persists across a refresh (proven structurally: it is a real Supabase signOut, not
// an in-memory-only flag, and the auth-state listener independently reaches the same cleared state
// on any SIGNED_OUT event — including one fired by a restored, already-invalid session after reload) ---
test('F — the auth-state listener independently clears identity on any signed-out session (covers a post-refresh SIGNED_OUT event, not just the explicit logout() call path)',()=>{
 const listenerMatch=page.match(/onAuthStateChange\(\(_event,session\)=>\{[\s\S]*?\}\);return/);
 const listener=listenerMatch?.[0]??'';
 assert.ok(listener,'onAuthStateChange listener not found');
 assert.match(listener,/else \{identity\.current=null;setToken\(''\);setUserEmail\(''\);setOrgName\(''\);clearWorkspace\(\);setMode\('welcome'\)\}/);
});

// --- G: an unauthenticated (or demo) user cannot see the account panel ---
test('G — the account trigger only renders for a genuinely authenticated (live) session, never in demo or logged-out mode',()=>{
 assert.match(page,/\{mode==='live'&&<button className="account-trigger"/);
});
test('G — a 401 from the backend (an invalid/expired session) forces a real logout instead of leaving the UI showing "connected"',()=>{
 assert.match(page,/res\.status===401&&mode==='live'\)\{await logout\(\)/);
});

// --- H: mobile layout, no horizontal overflow ---
test('H — the modal (including the new account panel) is capped to the viewport width on narrow screens',()=>{
 assert.match(css,/\.modal\{width:480px;max-width:calc\(100vw - 40px\)/);
});
test('H — the account trigger is a small, fixed-size control that cannot push the topbar into overflow',()=>{
 assert.match(css,/\.account-trigger\{width:26px;height:26px;flex-shrink:0/);
});
test('H — a long email wraps instead of overflowing the account panel',()=>{
 assert.match(css,/\.account-field>p\{[^}]*overflow-wrap:anywhere/);
});
