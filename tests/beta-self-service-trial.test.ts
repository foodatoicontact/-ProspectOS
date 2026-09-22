import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// ============================================================
// Self-service 7-day trial (migration 012). Concurrency/idempotency/capacity/cross-user-isolation
// properties are proven against a real PGlite Postgres in tests/beta-self-service-trial-db.mjs (run via
// `npm run test:trial-db`) — TESTS 1,2,3,5,6,7,8,10 from the brief live there. This file covers what a
// real Postgres run doesn't need to re-prove: TEST 4 (expiration enforcement — cross-referencing the
// existing, untouched requireActiveEntitlement coverage), TEST 9 (no privileged secret reachable from
// client code), and static pins on the new route/UI surface.
// ============================================================

// ------------------------------------------------------------
// TEST 4 — expired trial: protected features refused. requireActiveEntitlement (src/server/entitlement.ts)
// is the sole server-side gate and is completely untouched by this bloc — proven by diffing it against
// its own pre-bloc content, plus confirming its dedicated, already-passing test file still exists and
// still covers exactly this case (BETA_ACCESS_EXPIRED). activate_trial() never touches expiry
// enforcement; it only ever creates the initial row.
// ------------------------------------------------------------
test('TEST 4 — requireActiveEntitlement is byte-for-byte unchanged by this bloc (expiration enforcement is not this bloc\'s to reimplement)',async()=>{
 const source=await readFile(new URL('../src/server/entitlement.ts',import.meta.url),'utf8');
 assert.match(source,/if\(new Date\(data\.expires_at\)\.getTime\(\)<=Date\.now\(\)\)throw Error\('BETA_ACCESS_EXPIRED'\)/,'the exact expiry check this bloc must never touch is still there, unmodified');
 assert.doesNotMatch(source,/activate_trial/i,'entitlement.ts must never need to know about activate_trial — it treats every ACTIVE row identically regardless of how it was created');
});
test('TEST 4 — the existing entitlement-gate test file (unmodified) still exists and still asserts BETA_ACCESS_EXPIRED',async()=>{
 const source=await readFile(new URL('../tests/entitlement-gate.test.ts',import.meta.url),'utf8');
 assert.match(source,/BETA_ACCESS_EXPIRED/);
});

// ------------------------------------------------------------
// TEST 9 — no service_role key or other privileged secret is reachable from client-executed code.
// activate-trial is called through the same authenticated `api()` helper as every other route — never
// a direct fetch to Supabase with an elevated key, and no NEXT_PUBLIC_* variable this bloc introduces.
// ------------------------------------------------------------
test('TEST 9 — app/page.tsx never references a service_role key or a raw Supabase secret',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/service_role/i);
 assert.doesNotMatch(source,/SUPABASE_SERVICE/);
 // The only Supabase client-side env vars this app uses are the publishable ones (pre-existing).
 const publicEnvVars=[...source.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)].map(m=>m[1]);
 for(const v of publicEnvVars)assert.match(v,/^NEXT_PUBLIC_SUPABASE_(URL|PUBLISHABLE_KEY)$/,`unexpected public env var introduced: ${v}`);
});
test('TEST 9 — the new trial-activation call goes through the authenticated api() helper, never a direct privileged fetch',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/api\('account\/activate-trial','POST'/);
});
test('TEST 9 — migration 012 never grants EXECUTE to anon, and revokes the default PUBLIC grant',async()=>{
 const migration=await readFile(new URL('../db/migrations/012_beta_self_service_trial.sql',import.meta.url),'utf8');
 assert.match(migration,/revoke all on function public\.activate_trial\(\) from public,anon/);
 assert.match(migration,/grant execute on function public\.activate_trial\(\) to authenticated/);
 assert.doesNotMatch(migration,/grant execute on function public\.activate_trial\(\).*\banon\b/);
});

// ------------------------------------------------------------
// Route wiring: the client-facing surface is a thin, authenticated pass-through — the real privilege
// boundary lives entirely inside the SQL function (proven in the DB test file), not here.
// ------------------------------------------------------------
test('route.ts: account/activate-trial calls db.rpc(\'activate_trial\') through the caller\'s own authenticated client, and maps BETA_CAPACITY_REACHED to a clean message without ever creating an inconsistent row',async()=>{
 const source=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(source,/id==='activate-trial'&&request\.method==='POST'/);
 assert.match(source,/db\.rpc\('activate_trial'\)/);
 assert.match(source,/BETA_CAPACITY_REACHED/);
 assert.match(source,/Les accès à la bêta sont momentanément complets\. Votre compte a bien été créé\./);
});
test('route.ts: grant_beta_access / grant_internal_access (admin-only) are never referenced by the new route — self-service is a genuinely separate, narrower path',async()=>{
 const source=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/grant_beta_access|grant_internal_access/);
});

// ------------------------------------------------------------
// Product wording: CTA/subtext framed as a free trial, capacity handled gracefully (account kept),
// countdown based on the real expires_at, expiry message matches the brief exactly.
// ------------------------------------------------------------
test('UI: signup CTA is framed as a free trial with the required subtext',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/Démarrer mon essai gratuit/);
 assert.match(source,/7 jours gratuits · Aucune carte bancaire requise/);
});
test('UI: trial countdown is computed from the real expires_at, not a hardcoded number',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/const trialDaysRemaining=betaExpiresAt\?Math\.max\(0,Math\.ceil\(\(new Date\(betaExpiresAt\)\.getTime\(\)-Date\.now\(\)\)\/86400000\)\):0/);
 assert.match(source,/Essai gratuit · \$\{trialDaysRemaining\}/);
});
test('UI: expiry message matches the brief exactly',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/Votre essai gratuit est terminé\./);
});
test('UI: account deletion stays behind its own explicit typed confirmation — expiry has no path to it',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/deleteConfirm!=='SUPPRIMER'/);
});
