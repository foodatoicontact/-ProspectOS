import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';

// Client + route wiring of the automatic beta access. The database guarantees (capacity lock,
// idempotence, no second free period, INTERNAL/PAID untouched, no client write) are proven in
// tests/beta-auto-activation-db.mjs and, with real parallel sessions, tests/beta-trial-concurrency-realpg.sh.
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');

test('a session that arrives without login() — confirmation link, restored session — claims the trial too', () => {
 const listener=page.slice(page.indexOf('auth.auth.onAuthStateChange('));
 const body=listener.slice(0,listener.indexOf('return()=>data.subscription.unsubscribe()'));
 assert.match(body,/if\(event==='SIGNED_IN'\|\|event==='INITIAL_SESSION'\)\{const t=session\.access_token;setTimeout\(\(\)=>\{void loadAccount\(t\)\},0\)\}/);
 assert.doesNotMatch(body,/TOKEN_REFRESHED/,'a routine token refresh never re-attempts activation');
 assert.ok(body.indexOf('loadAccount')>body.indexOf('if(session)'),'only ever with an authenticated session');
});

test('loadAccount claims only when there is no entitlement, and sends no identity at all', () => {
 const fn=page.slice(page.indexOf('async function loadAccount('),page.indexOf('// BYOK Anthropic'));
 assert.match(fn,/if\(!entitlement\)\{try\{const activated=await api\('account\/activate-trial','POST',\{\},t\)/);
 assert.doesNotMatch(fn,/grant_beta_access|user_id|userEmail|email/,'no user id or email ever travels with the claim');
 assert.match(fn,/code==='BETA_CAPACITY_REACHED'\)setNotice\(e\.message\)/,'capacity full: the normal gate state, no crash');
});

test('a sign-up awaiting email confirmation never claims a slot (no session yet)', () => {
 const fn=page.slice(page.indexOf('async function login('));
 const noSession=fn.indexOf("if(!result.data.session){setNotice(tr('login.confirmEmail'));return}");
 assert.ok(noSession>0&&noSession<fn.indexOf('await loadAccount(t)'),'returns before loadAccount when there is no session');
});

test('activate-trial route: auth.uid()-only RPC, no argument, capacity full is a 409 — never a 500', () => {
 const handler=route.slice(route.indexOf("if(id==='activate-trial'&&request.method==='POST'){"));
 const block=handler.slice(0,handler.indexOf("if(id==='delete'"));
 assert.match(block,/await db\.rpc\('activate_trial'\)/);
 assert.doesNotMatch(block,/rpc\('activate_trial',|body\.|grant_beta_access|createAdminClient/,'nothing from the request reaches the RPC; never the privileged client');
 assert.match(block,/BETA_CAPACITY_REACHED'\)\)return json\(\{[^}]*code:'BETA_CAPACITY_REACHED'\},409\)/);
});

test('grant_beta_access and the service-role key are unreachable from client code and absent from the bundle', () => {
 const files=(dir:string):string[]=>readdirSync(new URL(dir,import.meta.url),{withFileTypes:true,recursive:true}).filter(e=>e.isFile()&&/\.(ts|tsx)$/.test(e.name)).map(e=>join(e.parentPath,e.name));
 for(const f of [...files('../app/'),...files('../src/')]){
  const src=readFileSync(f,'utf8');if(!/^['"]use client['"]/m.test(src))continue;
  assert.doesNotMatch(src,/grant_beta_access|grant_internal_access|SUPABASE_SERVICE_ROLE_KEY/,`${f}`);
 }
 const staticDir=new URL('../.next/static/',import.meta.url);
 if(existsSync(staticDir))for(const f of readdirSync(staticDir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.js')))
  assert.doesNotMatch(readFileSync(join(f.parentPath,f.name),'utf8'),/grant_beta_access|grant_internal_access|SUPABASE_SERVICE_ROLE_KEY/,`bundle ${f.name}`);
});

test('no migration and no change to the activation SQL in this bloc', () => {
 const m=readFileSync(new URL('../db/migrations/012_beta_self_service_trial.sql',import.meta.url),'utf8');
 assert.match(m,/create or replace function public\.activate_trial\(\) returns jsonb/);
 assert.match(m,/perform pg_advisory_xact_lock\(hashtext\('beta_program_capacity'\)\);/);
 assert.match(m,/revoke all on function public\.activate_trial\(\) from public,anon;\ngrant execute on function public\.activate_trial\(\) to authenticated;/);
});
