// The production migration tool (.github/workflows/production-migrations.yml + scripts/production-migrate.sh): manual
// trigger only, staging verified first in its own Environment, production behind the prospectos-production Environment
// (the approval step), each secret read once by its guarded step, inputs passed through env (never interpolated into a
// shell), the migrations taken from the selected ref pinned to its SHA while the runner comes from the workflow's own
// commit. The database behaviour is proved on a real PostgreSQL: tests/production-migrate-realpg.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const root=new URL('..',import.meta.url);
const wf=await readFile(new URL('.github/workflows/production-migrations.yml',root),'utf8');
const script=await readFile(new URL('scripts/production-migrate.sh',root),'utf8');
const STAGING='ggilyurgopsjrpnvxovl',PROD='vptqxhlxwiljfbkybqej';
const job=(name:string)=>{const i=wf.indexOf(`\n  ${name}:\n`);assert.ok(i>0,name);const rest=wf.slice(i+1);const j=rest.slice(1).search(/\n  [a-z-]+:\n/);return j<0?rest:rest.slice(0,j+1)};

test('workflow: manual only, read-only token, no concurrent run, no automatic trigger',()=>{
 assert.match(wf,/^on:\n  workflow_dispatch:\n/m);
 assert.doesNotMatch(wf,/^\s*(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
 assert.match(wf,/permissions:\n  contents: read\n/);
 assert.match(wf,/concurrency:\n  group: production-migrations\n  cancel-in-progress: false/);
 assert.match(wf,/mode:\n        description: [^\n]+\n        required: true\n        type: choice\n        options: \[dry-run, apply\]/);
 for(const run of wf.matchAll(/run: \|?\n?([\s\S]*?)(?=\n      - |\n  [a-z-]+:\n|\n?$)/g))assert.doesNotMatch(run[1],/\$\{\{/,'no ${{ }} inside run');
 assert.doesNotMatch(wf,/PRODUCTION_MIGRATE_ALLOW_LOCALHOST|PRODUCTION_MIGRATE_GUARD_ONLY/,'test switches are never set by the workflow');
});
test('workflow: staging is verified first in its own Environment; production waits for it behind prospectos-production',()=>{
 const s=job('verify-staging'),p=job('production');
 assert.match(s,/environment: prospectos-staging/);assert.match(p,/environment: prospectos-production/);assert.match(p,/needs: verify-staging/);
 assert.equal([...s.matchAll(/secrets\.[A-Z_]+/g)].map(m=>m[0]).join(','),'secrets.SUPABASE_STAGING_DB_URL');
 assert.equal([...p.matchAll(/secrets\.[A-Z_]+/g)].map(m=>m[0]).join(','),'secrets.SUPABASE_PRODUCTION_DB_URL');
 assert.match(s,/PRODUCTION_MIGRATE_MODE: verify-staging/);assert.match(s,new RegExp(`CONFIRM_PROJECT_REF: ${STAGING}`));
 assert.match(p,/PRODUCTION_MIGRATE_MODE: \$\{\{ inputs\.mode \}\}/);assert.match(p,/CONFIRM_PROJECT_REF: \$\{\{ inputs\.confirm_project_ref \}\}/);
 assert.match(s,/echo "::add-mask::\$SUPABASE_STAGING_DB_URL"/);assert.match(p,/echo "::add-mask::\$SUPABASE_PRODUCTION_DB_URL"/);
 for(const j of [s,p]){
  assert.equal([...j.matchAll(/persist-credentials: false/g)].length,2);
  assert.ok(j.indexOf('Validate inputs')<j.indexOf('actions/checkout'),'inputs validated before any checkout');
  const tool=j.slice(j.indexOf('Checkout the runner'),j.indexOf('Checkout the migrations'));assert.match(tool,/path: tool/);assert.doesNotMatch(tool,/ref:/);
  assert.match(j,/ref: \$\{\{ inputs\.ref \}\}/);assert.match(j,/EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}/);assert.match(j,/bash tool\/scripts\/production-migrate\.sh/);
 }
});
test('script: strict shell, explicit list, staging-first check, one locked session, atomic apply + record, dry-run rolls back',()=>{
 assert.match(script,/^set -euo pipefail$/m);assert.match(script,/ON_ERROR_STOP=1/);
 assert.doesNotMatch(script,/[0-9]{3}_[a-z]+_[a-z]/,'no migration name in the runner');assert.doesNotMatch(script,/[0-9a-f]{32}/,'no pinned checksum');
 assert.match(script,/LOCK_KEY="prospectos:production-migrations"/);assert.match(script,/pg_try_advisory_lock/);
 assert.equal([...script.matchAll(/"\$\{PSQL\[@\]\}" "\$\{VARS\[@\]\}" -f "\$DRIVER"/g)].length,1);
 assert.match(script,/END="commit;"; \[ "\$MODE" = "dry-run" \] && END="rollback;"/);
 assert.match(script,/STAGING_RUNNER="prospectos-staging-migrate"/);assert.match(script,/differs from this commit's file/);
 assert.match(script,/already recorded on production: nothing applied/);
 assert.doesNotMatch(script,/echo[^\n]*\$(URL|SUPABASE_[A-Z_]*DB_URL)/,'the connection string is never echoed');
 assert.match(script,/"\$ON_GITHUB" = 0 \]/,'the localhost switch is ignored on GitHub runners');
});
const sh=new URL('scripts/production-migrate.sh',root).pathname;
const run=(env:Record<string,string>)=>spawnSync('bash',[sh],{env:{PATH:process.env.PATH!,PRODUCTION_MIGRATE_GUARD_ONLY:'1',...env},encoding:'utf8'});
test('guards (no connection): each mode reaches only its own project; the other project refused in every form',()=>{
 const P=`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres?sslmode=require`,S=`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres?sslmode=require`;
 const ok=run({PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:P,MIGRATIONS:'036_outreach_evidence_revalidation'});
 assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/Guard-only mode: no connection made/);assert.doesNotMatch(ok.stdout+ok.stderr,/pw@/);
 const v=run({PRODUCTION_MIGRATE_MODE:'verify-staging',CONFIRM_PROJECT_REF:STAGING,SUPABASE_STAGING_DB_URL:S,MIGRATIONS:'036_outreach_evidence_revalidation'});assert.equal(v.status,0,v.stderr);
 const bad:[Record<string,string>,RegExp][]=[
  [{PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:STAGING,SUPABASE_PRODUCTION_DB_URL:P,MIGRATIONS:'036_outreach_evidence_revalidation'},/confirm_project_ref/],
  [{PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:S,MIGRATIONS:'036_outreach_evidence_revalidation'},/other project/],
  [{PRODUCTION_MIGRATE_MODE:'verify-staging',CONFIRM_PROJECT_REF:STAGING,SUPABASE_STAGING_DB_URL:P,MIGRATIONS:'036_outreach_evidence_revalidation'},/other project/],
  [{PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:`postgresql://postgres:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,MIGRATIONS:'036_outreach_evidence_revalidation'},/pooler user/],
  [{PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:`${P}&host=evil.example`,MIGRATIONS:'036_outreach_evidence_revalidation'},/only sslmode/],
  [{PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:P,MIGRATIONS:'all'},/NNN_name/],
  [{PRODUCTION_MIGRATE_MODE:'push',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:P,MIGRATIONS:'036_outreach_evidence_revalidation'},/MODE must be/],
  [{PRODUCTION_MIGRATE_MODE:'apply',CONFIRM_PROJECT_REF:PROD,SUPABASE_PRODUCTION_DB_URL:P,MIGRATIONS:'036_outreach_evidence_revalidation',GITHUB_ACTIONS:'true'},/EXPECTED_SHA is required/],
 ];
 for(const [env,re] of bad){const r=run(env);assert.notEqual(r.status,0,JSON.stringify(env));assert.match(r.stderr,re);assert.doesNotMatch(r.stdout+r.stderr,/pw@/)}
});
