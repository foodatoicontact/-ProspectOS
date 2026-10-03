// Beta report — deleted accounts (migration 018). History is kept (historical signups), but a closed account is
// never an active user, never a running trial and never part of the funnel. Pure tests (no database).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {accountPopulation,activeAccounts,funnelCounts,isDeletedAccount,isRunningTrial,type BetaAnalyticsUser} from '../src/domain/beta-analytics.ts';

const NOW=Date.parse('2026-10-03T12:00:00Z');
const future=new Date(NOW+3*86400000).toISOString(),past=new Date(NOW-86400000).toISOString();
let n=0;
const user=(over:Partial<BetaAnalyticsUser>={}):BetaAnalyticsUser=>({user_id:`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`,email:`u${n}@test`,user_created_at:'2026-09-20T00:00:00Z',email_confirmed_at:null,last_sign_in_at:null,
 plan:'BETA',status:'ACTIVE',entitlement_starts_at:null,expires_at:future,organization_id:null,organization_created_at:null,project_count:0,first_project_at:null,discovery_run_count:0,first_discovery_at:null,prospect_count:0,last_business_activity_at:null,...over});

test('canonical signal: a REVOKED entitlement is a deleted account',()=>{
 assert.equal(isDeletedAccount(user({status:'REVOKED'})),true);
 assert.equal(isDeletedAccount(user()),false);
});
test('secondary guard: a not-yet-repaired anonymized account is shown as deleted; a look-alike email is not',()=>{
 const id='5f1c0a2e-9a7b-4c1d-8e2f-0123456789ab';
 assert.equal(isDeletedAccount(user({email:`deleted+${id}@deleted.invalid`})),true);
 assert.equal(isDeletedAccount(user({email:'deleted+me@deleted.invalid'})),false);
 assert.equal(isDeletedAccount(user({email:`deleted+${id}@example.com`})),false);
});
test('production shape (10 signups, 2 deleted): history kept, active users and funnel exclude the deleted accounts',()=>{
 const org={organization_id:'o',organization_created_at:'2026-09-21T00:00:00Z'};
 const users=[
  ...Array.from({length:5},()=>user({...org,project_count:1,discovery_run_count:1,prospect_count:3})),
  user({...org,project_count:1,discovery_run_count:1}),
  user({...org,project_count:1}),
  user(),
  user({status:'REVOKED',email:'deleted+11111111-1111-4111-8111-111111111111@deleted.invalid'}),
  user({email:'deleted+22222222-2222-4222-8222-222222222222@deleted.invalid'}),
 ];
 assert.deepEqual(accountPopulation(users),{historical_signups:10,active_accounts:8,deleted_accounts:2});
 const c=funnelCounts(activeAccounts(users));
 assert.deepEqual([c.SIGNED_UP,c.TRIAL_ACTIVE,c.ORGANIZATION_CREATED,c.PROJECT_CREATED,c.DISCOVERY_STARTED,c.PROSPECTS_CREATED],[8,8,7,7,6,5]);
});
test('running trial: BETA + ACTIVE + not expired + account not deleted',()=>{
 assert.equal(isRunningTrial(user(),NOW),true);
 assert.equal(isRunningTrial(user({expires_at:past}),NOW),false,'an expired trial is not running even if its status is still ACTIVE');
 assert.equal(isRunningTrial(user({status:'REVOKED'}),NOW),false);
 assert.equal(isRunningTrial(user({email:'deleted+22222222-2222-4222-8222-222222222222@deleted.invalid'}),NOW),false);
 assert.equal(isRunningTrial(user({plan:'PAID'}),NOW),false);
});
test('admin panel: funnel on active accounts, the three population figures, deleted rows kept in the detail table',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/funnelWithPercentages\(activeAccounts\(betaAnalytics\.users\)\)/);
 for(const k of ['historicalSignups','activeAccounts','deletedAccounts'])assert.ok(page.includes(`tr('betaAnalytics.${k}')`),k);
 assert.match(page,/isRunningTrial\(u\)/);
 assert.match(page,/isDeletedAccount\(u\)\?tr\('betaAnalytics\.deletedStage'\)/);
 assert.match(page,/betaAnalytics\.users\.map\(u=>/,'every account, deleted included, is still listed for audit');
});
test('capacity is never decided by the email convention: the SQL seat count reads the REVOKED status only',async()=>{
 const m=await readFile(new URL('../db/migrations/018_deleted_accounts_release_beta_capacity.sql',import.meta.url),'utf8');
 const code=m.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
 assert.match(code,/where plan='BETA' and status<>'REVOKED'/);
 assert.doesNotMatch(code,/deleted\.invalid|user_metadata|raw_user_meta_data/);
 assert.equal((code.match(/prospectos_private\.beta_seats_used\(\);/g)??[]).length,3,'activate_trial, grant_beta_access and beta_analytics share the one seat rule');
 assert.match(code,/update public\.account_entitlements set status='REVOKED',updated_at=now\(\) where user_id=actor and plan='BETA'/,'only seat-holding BETA rows; paid plans keep their Stripe lifecycle');
 assert.doesNotMatch(code,/delete from public\.account_entitlements|delete from auth\.users|disable trigger|policy/i);
});
