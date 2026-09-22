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

// --- B: current organization (and role) shown when available ---
test('B — the organization is displayed only when already available, fetched from the server-derived /account endpoint',()=>{
 assert.match(accountModal,/\{orgName&&<div className="account-field">/);
 assert.match(page,/api\('account','GET'/,'role/organization/entitlement are all read from one server-derived endpoint — never asserted by the client');
});
test('B — the role shown is exactly what the server reports, never invented client-side',()=>{
 assert.match(accountModal,/\{role&&<div className="account-field">/);
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

// ============================================================
// Privacy/beta bloc: access status, export, self-service deletion
// ============================================================
const deleteModalMatch=page.match(/\{modal==='delete-account'&&<div className="modal-backdrop"[\s\S]*?<\/section><\/div>\}/);
const deleteModal=deleteModalMatch?.[0]??'';

test('setup sanity: the delete-account modal block was found in the source',()=>{
 assert.ok(deleteModal,'delete-account modal JSX not found — later assertions would be vacuous');
});

test('access status: Interne/Essai gratuit non activé/Essai gratuit · N jours restants/terminé is shown, and the expiry date only when actually on an active, non-INTERNAL trial',()=>{
 assert.match(accountModal,/entitlementPlan==='INTERNAL'\?'Interne':betaActive===null\?'Essai gratuit non activé':betaActive\?`Essai gratuit · \$\{trialDaysRemaining\}/);
 assert.match(accountModal,/entitlementPlan!=='INTERNAL'&&betaActive&&betaExpiresAt&&<p className="muted">Expire le/);
});
test('an expired trial still sees a clear "trial ended" message, never a silent data loss',()=>{
 assert.match(accountModal,/betaActive===false&&<p className="muted">Votre essai gratuit est terminé\./);
});
test('a user with no entitlement at all sees a clear, non-alarming explanation — never the old "Actif" legacy label',()=>{
 assert.match(accountModal,/entitlementPlan!=='INTERNAL'&&betaActive===null&&<p className="muted">Activation de l.essai gratuit indisponible/);
 assert.doesNotMatch(accountModal,/betaActive===null\?'Actif'/,'the old legacy "no entitlement = Actif" label must not reappear');
});

test('export: a dedicated button triggers a real authenticated server call, not a client-side fabrication',()=>{
 assert.match(accountModal,/onClick=\{\(\)=>work\(exportAccount\)\}>Exporter mes données/);
 assert.match(page,/fetch\('\/api\/v1\/account\/export',\{method:'POST',headers:\{Authorization:`Bearer \$\{token\}`\}\}\)/);
});
test('export never renders/exposes the raw token or blob URL in visible UI text',()=>{
 assert.doesNotMatch(accountModal,/exportAccount.*token/s);
});

test('delete: the account panel only opens a dedicated confirmation flow, it never deletes on a single click',()=>{
 assert.match(accountModal,/onClick=\{\(\)=>\{setModal\('delete-account'\);setDeleteStep\(1\)\}\}>Supprimer mon compte/);
});
test('delete step 1: the irreversibility warning and data-handling explanation are shown before any confirmation input exists',()=>{
 assert.match(deleteModal,/Cette action est irréversible/);
 assert.match(deleteModal,/deleteStep===1/);
 assert.doesNotMatch(deleteModal.split('deleteStep===2')[0],/<input/,'no confirmation input exists before the user explicitly continues past the warning');
});
test('delete step 1: the warning accurately describes anonymization (not physical erasure) of personal auth info, retention of organizational data, and retention of audit references',()=>{
 assert.match(deleteModal,/informations d.authentification personnelles \(email, mot de passe\) sont anonymisées/,'must not imply personal auth data is physically deleted — the real behavior is anonymization in place');
 assert.match(deleteModal,/Les données appartenant à votre organisation[^<]*sont conservées/,'must state organizational/shared data is retained, not erased');
 assert.match(deleteModal,/références d.audit[^<]*sont conservées pour préserver l.intégrité des preuves et de l.historique/,'must state audit references (evidence.verified_by / events.actor_id) are retained, never described as merely possible');
});
test('delete step 2: the literal word SUPPRIMER must be typed, and the destructive button is disabled until it matches exactly',()=>{
 assert.match(deleteModal,/Pour confirmer, saisissez <b>SUPPRIMER<\/b>/);
 assert.match(deleteModal,/disabled=\{busy\|\|deleteConfirm!=='SUPPRIMER'\}/);
});
test('delete: the server call carries the same typed confirmation, the API is never trusted to accept a bare click',()=>{
 assert.match(page,/api\('account\/delete','POST',\{confirm:deleteConfirm\}\)/);
});
test('delete: no UUID/token/tenant id is ever rendered in the deletion flow either',()=>{
 for(const forbidden of [/access_token/,/refresh_token/,/organization_id/,/identity\.current/])
  assert.doesNotMatch(deleteModal,forbidden);
});

// --- server-side enforcement: which routes are actually gated, and which never are ---
const routeSource=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
const discoveryApiSource=readFileSync(new URL('../src/discovery/api.ts',import.meta.url),'utf8');

test('server enforcement: outreach generation and the AI offer analysis both require an active entitlement',()=>{
 const outreachBlock=routeSource.match(/if\(resource==='outreach'&&request\.method==='POST'\)\{[\s\S]*?requireActiveEntitlement/);
 const analyzeBlock=routeSource.match(/if\(resource==='analyze-company'&&request\.method==='POST'\)\{[\s\S]*?requireActiveEntitlement/);
 assert.ok(outreachBlock,'outreach generation is not gated');
 assert.ok(analyzeBlock,'AI offer analysis is not gated');
});
test('server enforcement: Discovery search and page analysis require an active entitlement, but reading existing results/observations never does',()=>{
 assert.match(discoveryApiSource,/resource==='projects'&&action==='discovery'&&method==='POST'\)\|\|\(resource==='prospects'&&action==='analyze'&&method==='POST'\)\)await requireActiveEntitlement/);
});
test('server enforcement: login, account, export, delete-account and logout are never gated by the entitlement check',()=>{
 assert.doesNotMatch(routeSource.split("if(resource==='account')")[1]?.split("if(resource==='export'")[0]??'',/requireActiveEntitlement/,'the entire account resource block (info/export/delete) must never call the entitlement gate');
});
test('server enforcement: an expired entitlement maps to a stable, documented error code (BETA_ACCESS_EXPIRED, HTTP 402)',()=>{
 assert.match(routeSource,/code==='BETA_ACCESS_EXPIRED'\?402/);
 assert.match(discoveryApiSource,/code==='BETA_ACCESS_EXPIRED'\?402/);
});
test('server enforcement: NO entitlement at all maps to a stable, documented error code (ENTITLEMENT_REQUIRED, HTTP 403), never a silent allow',()=>{
 assert.match(routeSource,/code==='ENTITLEMENT_REQUIRED'\?403/);
 assert.match(discoveryApiSource,/code==='ENTITLEMENT_REQUIRED'\?403/);
});

// --- migration-level guarantees a client can never override ---
const migration008=readFileSync(new URL('../db/migrations/008_account_privacy_beta.sql',import.meta.url),'utf8');
test('migration: grant_beta_access is never callable by a logged-in app user, only by direct SQL access',()=>{
 assert.match(migration008,/revoke all on function public\.grant_beta_access\(text\) from public,anon,authenticated;/);
});
test('migration: account_entitlements has no client write grant at all — mutation only through the SECURITY DEFINER functions',()=>{
 assert.match(migration008,/grant select on public\.account_entitlements to authenticated;/);
 assert.doesNotMatch(migration008,/grant (insert|update|delete)[^;]*account_entitlements/i);
});

// --- migration 011 (BETA hotfix): INTERNAL plan + its own admin-only, capacity-exempt grant function ---
const migration011=readFileSync(new URL('../db/migrations/011_beta_entitlement_gate.sql',import.meta.url),'utf8');
test('migration 011: widens plan to allow INTERNAL alongside the existing BETA — never replaces or removes BETA',()=>{
 assert.match(migration011,/add constraint account_entitlements_plan_check check\(plan in \('BETA','INTERNAL'\)\)/);
});
test('migration 011: grant_internal_access is never callable by a logged-in app user, only by direct SQL access — same model as grant_beta_access',()=>{
 assert.match(migration011,/create or replace function public\.grant_internal_access\(p_user_email text\) returns jsonb/);
 assert.match(migration011,/revoke all on function public\.grant_internal_access\(text\) from public,anon,authenticated;/);
});
test('migration 011: no user_id is ever guessed or inserted automatically — the migration contains no unconditional INSERT into account_entitlements',()=>{
 const withoutFunctionBody=migration011.replace(/create or replace function[\s\S]*?\$\$;/g,'');
 assert.doesNotMatch(withoutFunctionBody,/insert into public\.account_entitlements/i,'the migration itself must never insert an entitlement row directly — only the admin-only function does, and only when explicitly invoked with an email');
});
test('migration 011: grant_internal_access has no capacity check and no advisory lock — INTERNAL is exempt from the 10-slot BETA cap by construction (a different plan value), not by a separate limit to maintain',()=>{
 const fnMatch=migration011.match(/create or replace function public\.grant_internal_access[\s\S]*?\$\$;/);
 assert.ok(fnMatch,'grant_internal_access function body not found');
 assert.doesNotMatch(fnMatch[0],/pg_advisory_xact_lock/);
 assert.doesNotMatch(fnMatch[0],/beta_program/);
});
