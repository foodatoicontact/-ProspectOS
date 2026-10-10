// The staging-only migration workflow (.github/workflows/staging-migrations.yml + scripts/staging-migrate.sh): manual
// trigger only, the prospectos-staging Environment, the secret read only by the guarded step, inputs passed through
// env (never interpolated into the shell), and the script's guards — exercised here in guard-only mode, which never
// connects to anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=new URL('..',import.meta.url);
const wf=await readFile(new URL('.github/workflows/staging-migrations.yml',root),'utf8');
const script=await readFile(new URL('scripts/staging-migrate.sh',root),'utf8');
const STAGING='ggilyurgopsjrpnvxovl',PROD='vptqxhlxwiljfbkybqej';

test('workflow: manual only, staging Environment, read-only token, one guarded step holding the secret',()=>{
 assert.match(wf,/^on:\n  workflow_dispatch:\n/m);
 assert.doesNotMatch(wf,/^\s*(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m,'no automatic trigger');
 assert.match(wf,/environment: prospectos-staging/);
 assert.match(wf,/permissions:\n  contents: read\n/);
 assert.equal([...wf.matchAll(/secrets\.[A-Z_]+/g)].map(m=>m[0]).join(','),'secrets.SUPABASE_STAGING_DB_URL','one secret, once');
 assert.match(wf,/persist-credentials: false/);
 assert.doesNotMatch(wf,new RegExp(PROD),'the production ref never appears in the workflow');
 // GitHub expressions only in env:, never inside a run: script (no injection through the input).
 for(const run of wf.matchAll(/run: \|?\n?([\s\S]*?)(?=\n      - |\n?$)/g))assert.doesNotMatch(run[1],/\$\{\{/,'no ${{ }} inside run');
 assert.doesNotMatch(wf,/STAGING_MIGRATE_ALLOW_LOCALHOST|STAGING_MIGRATE_GUARD_ONLY/,'test switches are never set by the workflow');
 assert.match(wf,/echo "::add-mask::\$SUPABASE_STAGING_DB_URL"/);
});

test('script: strict shell, stop on first SQL error, reviewed MD5s equal the committed files, URL never printed',async()=>{
 assert.match(script,/^set -euo pipefail$/m);assert.match(script,/ON_ERROR_STOP=1/);
 for(const m of ['027_outreach_intelligence','028_outreach_ai_generation']){
  const md5=createHash('md5').update(await readFile(new URL(`db/migrations/${m}.sql`,root))).digest('hex');
  assert.match(script,new RegExp(`\\[${m}\\]="${md5}"`),m);
 }
 assert.doesNotMatch(script,/echo[^\n]*\$(URL|SUPABASE_STAGING_DB_URL)/,'the connection string is never echoed');
 assert.match(script,/GITHUB_ACTIONS:-\}" != "true"/,'the localhost test switch is ignored on GitHub runners');
 assert.ok(script.indexOf('verify_${m%%_*}"\n  version=')>0,'verified before being recorded');
});

const run=(env:Record<string,string>)=>spawnSync('bash',[new URL('scripts/staging-migrate.sh',root).pathname],{env:{PATH:process.env.PATH!,STAGING_MIGRATE_GUARD_ONLY:'1',...env},encoding:'utf8'});
const ok=(url:string,extra:Record<string,string>={})=>run({CONFIRM_PROJECT_REF:STAGING,SUPABASE_STAGING_DB_URL:url,...extra});
test('guards: the staging project only (direct host or its pooler user); production refused in every form',()=>{
 for(const url of [`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`,`postgresql://postgres.${STAGING}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require`]){
  const r=ok(url);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Guard-only mode: no connection made/);assert.doesNotMatch(r.stdout+r.stderr,/pw@/,'never printed');
 }
 const refused:[string,RegExp,Record<string,string>?][]=[
  [`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`,/PRODUCTION/],
  [`postgresql://postgres.${PROD}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,/PRODUCTION/],
  [`postgresql://postgres.${STAGING}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?options=${PROD}`,/PRODUCTION/],
  [`postgresql://postgres:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,/pooler user/],
  [`postgresql://postgres:pw@db.otherproject.supabase.co:5432/postgres`,/not the staging project/],
  [`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres?host=evil.example`,/only sslmode/],
  [`postgresql://postgres.${STAGING}@127.0.0.1:5432/postgres`,/not the staging project/],
  [`postgresql://postgres.${STAGING}@127.0.0.1:5432/postgres`,/not the staging project/,{STAGING_MIGRATE_ALLOW_LOCALHOST:'1',GITHUB_ACTIONS:'true'}],
  [`host=db.${STAGING}.supabase.co user=postgres`,/plain postgresql/],
  ['',/empty/],
 ];
 for(const [url,re,extra] of refused){const r=ok(url,extra);assert.notEqual(r.status,0,url);assert.match(r.stderr,re,url);assert.doesNotMatch(r.stdout+r.stderr,/pw@/)}
 const wrongConfirm=run({CONFIRM_PROJECT_REF:PROD,SUPABASE_STAGING_DB_URL:`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`});
 assert.notEqual(wrongConfirm.status,0);assert.match(wrongConfirm.stderr,/confirm_project_ref/);
});
