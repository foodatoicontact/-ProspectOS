// The generic staging migration tool (.github/workflows/staging-migrations.yml + scripts/staging-migrate.sh): manual
// trigger only, the prospectos-staging Environment, the secret read only by the guarded step, inputs passed through env
// (never interpolated into a shell), the migrations taken from the selected ref pinned to its SHA while the runner comes
// from the workflow's own commit, and the script's guards — exercised here in guard-only mode, which never connects.
// The database behaviour (discovery, lock, history, rollback) is proved on a real PostgreSQL: tests/staging-migrate-realpg.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync,execSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root=new URL('..',import.meta.url);
const wf=await readFile(new URL('.github/workflows/staging-migrations.yml',root),'utf8');
const script=await readFile(new URL('scripts/staging-migrate.sh',root),'utf8');
const STAGING='ggilyurgopsjrpnvxovl',PROD='vptqxhlxwiljfbkybqej';

test('workflow: manual only, staging Environment, read-only token, one guarded step holding the secret',()=>{
 assert.match(wf,/^on:\n  workflow_dispatch:\n/m);
 assert.doesNotMatch(wf,/^\s*(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m,'no automatic trigger');
 assert.match(wf,/environment: prospectos-staging/);
 assert.match(wf,/permissions:\n  contents: read\n/);
 assert.match(wf,/concurrency:\n  group: staging-migrations\n  cancel-in-progress: false/);
 assert.equal([...wf.matchAll(/secrets\.[A-Z_]+/g)].map(m=>m[0]).join(','),'secrets.SUPABASE_STAGING_DB_URL','one secret, once');
 assert.equal([...wf.matchAll(/persist-credentials: false/g)].length,2);
 assert.doesNotMatch(wf,new RegExp(PROD),'the production ref never appears in the workflow');
 for(const run of wf.matchAll(/run: \|?\n?([\s\S]*?)(?=\n      - |\n?$)/g))assert.doesNotMatch(run[1],/\$\{\{/,'no ${{ }} inside run');
 assert.doesNotMatch(wf,/STAGING_MIGRATE_ALLOW_LOCALHOST|STAGING_MIGRATE_GUARD_ONLY/,'test switches are never set by the workflow');
 assert.match(wf,/echo "::add-mask::\$SUPABASE_STAGING_DB_URL"/);
});

test('workflow: the migrations come from the selected ref, pinned to its SHA; the runner from the workflow’s own commit',()=>{
 for(const k of ['ref','expected_sha','confirm_project_ref'])assert.match(wf,new RegExp(`\\n      ${k}:\\n        description: [^\\n]+\\n        required: true\\n        type: string`),k);
 const validate=wf.slice(wf.indexOf('Validate inputs'),wf.indexOf('Checkout the runner'));
 assert.match(validate,/INPUT_REF: \$\{\{ inputs\.ref \}\}/);assert.match(validate,/\^\[0-9a-f\]\{40\}\$/);assert.match(validate,/\*\.\.\*/);
 assert.ok(wf.indexOf('Validate inputs')<wf.indexOf('actions/checkout'),'inputs validated before any checkout');
 const tool=wf.slice(wf.indexOf('Checkout the runner'),wf.indexOf('Checkout the migrations'));
 assert.match(tool,/path: tool/);assert.doesNotMatch(tool,/ref:/,'the runner is the workflow’s own commit');
 const target=wf.slice(wf.indexOf('Checkout the migrations'),wf.indexOf('PostgreSQL client'));
 assert.match(target,/ref: \$\{\{ inputs\.ref \}\}/);assert.match(target,/path: target/);
 assert.match(wf,/EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}/);assert.match(wf,/STAGING_MIGRATE_TARGET: target/);assert.match(wf,/bash tool\/scripts\/staging-migrate\.sh/);
});

test('script: generic (no migration name or MD5 hard-coded), strict shell, one session holding an advisory lock, atomic apply + record',async()=>{
 assert.match(script,/^set -euo pipefail$/m);assert.match(script,/ON_ERROR_STOP=1/);
 assert.doesNotMatch(script,/0(2[7-9])_[a-z]/,'no migration name in the runner');assert.doesNotMatch(script,/[0-9a-f]{32}/,'no pinned checksum');
 assert.match(script,/pg_try_advisory_lock\(hashtextextended\('\$LOCK_KEY',0\)\)/);assert.match(script,/LOCK_KEY="prospectos:staging-migrations"/);
 assert.equal([...script.matchAll(/"\$\{PSQL\[@\]\}" "\$\{VARS\[@\]\}" -f "\$DRIVER"/g)].length,1,'all migrations run through ONE psql session');
 const driver=script.slice(script.indexOf('echo "begin;"'),script.indexOf('echo "commit;"'));
 assert.match(driver,/\\\\ir body_\$i\.sql/);assert.match(driver,/check_\$i\.sql/);assert.match(driver,/insert into supabase_migrations\.schema_migrations/,'recorded inside the same transaction');
 assert.doesNotMatch(script,/echo[^\n]*\$(URL|SUPABASE_STAGING_DB_URL)/,'the connection string is never echoed');
 assert.doesNotMatch(script,/\| *(head|tail)\b/,'no SIGPIPE-prone pipe under pipefail');
 assert.match(script,/"\$ON_GITHUB" = 0 \]/,'the localhost switch is ignored on GitHub runners');
 // The checks of 027/028 live with the migrations, not in the runner.
 for(const m of ['027_outreach_intelligence','028_outreach_ai_generation','029_outreach_provenance_revalidation'])assert.match(await readFile(new URL(`db/migrations/checks/${m}.sql`,root),'utf8'),/raise exception 'check 0(2[789])/);
});

test('migrations 027/028 keep the reviewed content (integrity pinned here, not in the runner)',async()=>{
 const md5=async(m:string)=>createHash('md5').update(await readFile(new URL(`db/migrations/${m}.sql`,root))).digest('hex');
 assert.equal(await md5('027_outreach_intelligence'),'1caaaf71c29cc52dbefe2422e2bf22fd');
 assert.equal(await md5('028_outreach_ai_generation'),'b921ad6e79d21cd229e17abecc8482e9');
});

const sh=new URL('scripts/staging-migrate.sh',root).pathname;
const run=(env:Record<string,string>)=>spawnSync('bash',[sh],{env:{PATH:process.env.PATH!,STAGING_MIGRATE_GUARD_ONLY:'1',...env},encoding:'utf8'});
const ok=(url:string,extra:Record<string,string>={})=>run({CONFIRM_PROJECT_REF:STAGING,SUPABASE_STAGING_DB_URL:url,...extra});
const DIRECT=`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres?sslmode=require`;
test('guards: the staging project only (direct host or its pooler user); production refused in every form; sslmode on GitHub',()=>{
 for(const url of [DIRECT,`postgresql://postgres.${STAGING}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require`,`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`]){
  const r=ok(url);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Guard-only mode: no connection made/);assert.doesNotMatch(r.stdout+r.stderr,/pw@/,'never printed');
 }
 const refused:[string,RegExp,Record<string,string>?][]=[
  [`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`,/PRODUCTION/],
  [`postgresql://postgres.${PROD}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,/PRODUCTION/],
  [`postgresql://postgres.${STAGING}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?options=${PROD}`,/PRODUCTION/],
  [`postgresql://postgres:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,/pooler user/],
  [`postgresql://postgres:pw@db.otherproject.supabase.co:5432/postgres`,/not the staging project/],
  [`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres?host=evil.example`,/only sslmode/],
  [`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres?sslmode=disable`,/only sslmode/],
  [`postgresql://postgres.${STAGING}@127.0.0.1:5432/postgres`,/not the staging project/],
  [`postgresql://postgres.${STAGING}@127.0.0.1:5432/postgres?sslmode=require`,/not the staging project/,{STAGING_MIGRATE_ALLOW_LOCALHOST:'1',GITHUB_ACTIONS:'true',EXPECTED_SHA:'x'}],
  [`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`,/sslmode=require/,{GITHUB_ACTIONS:'true'}],
  [DIRECT,/EXPECTED_SHA is required/,{GITHUB_ACTIONS:'true'}],
  [`host=db.${STAGING}.supabase.co user=postgres`,/plain postgresql/],
  ['',/empty/],
 ];
 for(const [url,re,extra] of refused){const r=ok(url,extra);assert.notEqual(r.status,0,url);assert.match(r.stderr,re,url);assert.doesNotMatch(r.stdout+r.stderr,/pw@/)}
 const wrongConfirm=run({CONFIRM_PROJECT_REF:PROD,SUPABASE_STAGING_DB_URL:DIRECT});
 assert.notEqual(wrongConfirm.status,0);assert.match(wrongConfirm.stderr,/confirm_project_ref/);
});

test('ref pinning: the target checkout must be exactly EXPECTED_SHA; its migrations are discovered (no runner change)',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'staging-ref-'));
 // The fixture is numbered after the newest real migration, so the test never depends on which migrations exist.
 const real=(await readdir(new URL('db/migrations/',root))).filter(f=>/^[0-9]{3}_[a-z0-9_]+\.sql$/.test(f));
 const next=String(Math.max(...real.map(f=>Number(f.slice(0,3))))+1).padStart(3,'0');
 execSync(`cp -r ${new URL('db',root).pathname} ${dir}/ && printf 'begin;\\nselect 1;\\ncommit;\\n' > ${dir}/db/migrations/${next}_future.sql && git -C ${dir} init -q && git -C ${dir} add -A && git -C ${dir} -c user.email=t@t -c user.name=t commit -qm ref`);
 const sha=execSync(`git -C ${dir} rev-parse HEAD`,{encoding:'utf8'}).trim();
 const good=ok(DIRECT,{STAGING_MIGRATE_TARGET:dir,EXPECTED_SHA:sha});assert.equal(good.status,0,good.stderr);
 assert.match(good.stdout,new RegExp(`commit ${sha}, ${real.length+1} migration files`),'every real migration and the new one are found');
 const bad=ok(DIRECT,{STAGING_MIGRATE_TARGET:dir,EXPECTED_SHA:'0'.repeat(40)});assert.notEqual(bad.status,0);assert.match(bad.stderr,/is not the expected commit/);
 execSync(`printf 'select 1;\\n' > ${dir}/db/migrations/${next}_dup.sql`);
 const dup=ok(DIRECT,{STAGING_MIGRATE_TARGET:dir});assert.notEqual(dup.status,0);assert.match(dup.stderr,new RegExp(`two migration files use number ${next}`));
});
