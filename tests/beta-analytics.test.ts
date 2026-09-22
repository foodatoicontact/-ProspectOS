import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {funnelStage,funnelCounts,funnelWithPercentages,daysRemaining,lastBusinessActivity,FUNNEL_STAGES,FUNNEL_STAGE_LABELS,type BetaAnalyticsUser} from '../src/domain/beta-analytics.ts';

// ============================================================
// Pure derivation layer over public.beta_analytics()'s raw facts. RLS/authorization/no-leak/real-DB
// correctness is proven against a real Postgres in tests/beta-analytics-admin-db.mjs (run via
// `npm run test:beta-analytics-db`) — this file covers exactly what a real Postgres run doesn't need
// to re-prove: the funnel-stage/days-remaining/percentage math itself, in isolation, with fixtures.
// ============================================================

function user(overrides:Partial<BetaAnalyticsUser>):BetaAnalyticsUser{
 return {
  user_id:'u',email:'u@test',user_created_at:'2026-01-01T00:00:00Z',email_confirmed_at:null,last_sign_in_at:null,
  plan:null,status:null,entitlement_starts_at:null,expires_at:null,
  organization_id:null,organization_created_at:null,
  project_count:0,first_project_at:null,
  discovery_run_count:0,first_discovery_at:null,
  prospect_count:0,last_business_activity_at:null,
  ...overrides,
 };
}

// ------------------------------------------------------------
// funnelStage — checked from the most advanced stage down, each guard schema-guaranteed monotonic.
// ------------------------------------------------------------
test('funnelStage: no plan, no organization -> SIGNED_UP',()=>{
 assert.equal(funnelStage(user({})),'SIGNED_UP');
});
test('funnelStage: BETA plan, no organization -> TRIAL_ACTIVE (a milestone ever reached, not current status)',()=>{
 assert.equal(funnelStage(user({plan:'BETA'})),'TRIAL_ACTIVE');
});
test('funnelStage: an EXPIRED BETA user still shows TRIAL_ACTIVE (the milestone was reached; current expiry is a separate column)',()=>{
 assert.equal(funnelStage(user({plan:'BETA',status:'EXPIRED'})),'TRIAL_ACTIVE');
});
test('funnelStage: organization exists, zero projects -> ORGANIZATION_CREATED',()=>{
 assert.equal(funnelStage(user({plan:'BETA',organization_id:'o1'})),'ORGANIZATION_CREATED');
});
test('funnelStage: at least one project, zero discovery runs -> PROJECT_CREATED',()=>{
 assert.equal(funnelStage(user({plan:'BETA',organization_id:'o1',project_count:1})),'PROJECT_CREATED');
});
test('funnelStage: at least one discovery run, zero prospects -> DISCOVERY_STARTED',()=>{
 assert.equal(funnelStage(user({plan:'BETA',organization_id:'o1',project_count:1,discovery_run_count:2})),'DISCOVERY_STARTED');
});
test('funnelStage: at least one prospect -> PROSPECTS_CREATED, the most advanced stage',()=>{
 assert.equal(funnelStage(user({plan:'BETA',organization_id:'o1',project_count:1,discovery_run_count:2,prospect_count:3})),'PROSPECTS_CREATED');
});
test('funnelStage: an INTERNAL plan with real activity still resolves purely from the facts, not the plan label',()=>{
 assert.equal(funnelStage(user({plan:'INTERNAL',prospect_count:5})),'PROSPECTS_CREATED');
});

// ------------------------------------------------------------
// daysRemaining — never negative, never fabricated for null, rounds up (a few hours left still reads
// as "1 day", never "0" which would falsely suggest expiry is imminent-today when it isn't yet).
// ------------------------------------------------------------
test('daysRemaining: null expires_at -> null (never a fabricated 0)',()=>{
 assert.equal(daysRemaining(null),null);
});
test('daysRemaining: exactly 3 days in the future -> 3',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z');
 assert.equal(daysRemaining('2026-01-04T00:00:00Z',now),3);
});
test('daysRemaining: a few hours in the future rounds up to 1, never 0',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z');
 assert.equal(daysRemaining('2026-01-01T03:00:00Z',now),1);
});
test('daysRemaining: already in the past -> 0, never negative',()=>{
 const now=Date.parse('2026-01-10T00:00:00Z');
 assert.equal(daysRemaining('2026-01-01T00:00:00Z',now),0);
});

// ------------------------------------------------------------
// lastBusinessActivity — a pure passthrough of the real events-sourced fact; never falls back to
// last_sign_in_at, which this module doesn't even read for this purpose.
// ------------------------------------------------------------
test('lastBusinessActivity: returns last_business_activity_at exactly, null stays null',()=>{
 assert.equal(lastBusinessActivity(user({last_business_activity_at:null})),null);
 assert.equal(lastBusinessActivity(user({last_business_activity_at:'2026-02-01T00:00:00Z',last_sign_in_at:'2026-03-01T00:00:00Z'})),'2026-02-01T00:00:00Z');
});

// ------------------------------------------------------------
// funnelCounts / funnelWithPercentages — cumulative funnel semantics: a user further along is counted
// at every earlier stage too, and percentages are pilotage-only, never a significance claim.
// ------------------------------------------------------------
test('funnelCounts: cumulative — a PROSPECTS_CREATED user is counted at every earlier stage as well',()=>{
 const users=[user({plan:'BETA',organization_id:'o1',project_count:1,discovery_run_count:1,prospect_count:1})];
 const counts=funnelCounts(users);
 for(const stage of FUNNEL_STAGES)assert.equal(counts[stage],1,`${stage} must count the one user who reached PROSPECTS_CREATED`);
});
test('funnelCounts: a SIGNED_UP-only user counts at SIGNED_UP but nowhere further',()=>{
 const counts=funnelCounts([user({})]);
 assert.equal(counts.SIGNED_UP,1);
 assert.equal(counts.TRIAL_ACTIVE,0);
 assert.equal(counts.PROSPECTS_CREATED,0);
});
test('funnelWithPercentages: mixed sample — counts, pct_of_signups and pct_of_previous all correct',()=>{
 const users=[
  user({user_id:'a'}), // SIGNED_UP
  user({user_id:'b',plan:'BETA'}), // TRIAL_ACTIVE
  user({user_id:'c',plan:'BETA',organization_id:'o1'}), // ORGANIZATION_CREATED
  user({user_id:'d',plan:'BETA',organization_id:'o1',project_count:1,discovery_run_count:1,prospect_count:1}), // PROSPECTS_CREATED
 ];
 const rows=funnelWithPercentages(users);
 const byStage=Object.fromEntries(rows.map(r=>[r.stage,r]));
 assert.equal(byStage.SIGNED_UP.count,4,'all 4 users reached at least SIGNED_UP');
 assert.equal(byStage.TRIAL_ACTIVE.count,3);
 assert.equal(byStage.ORGANIZATION_CREATED.count,2);
 assert.equal(byStage.PROJECT_CREATED.count,1);
 assert.equal(byStage.PROSPECTS_CREATED.count,1);
 assert.equal(byStage.SIGNED_UP.pct_of_signups,100);
 assert.equal(byStage.PROSPECTS_CREATED.pct_of_signups,25);
 assert.equal(byStage.TRIAL_ACTIVE.pct_of_previous,75,'3 of the 4 signups (pct_of_previous baseline) reached TRIAL_ACTIVE');
});
test('funnelWithPercentages: empty sample never divides by zero — percentages are null, not NaN/Infinity',()=>{
 const rows=funnelWithPercentages([]);
 for(const r of rows){assert.equal(r.count,0);assert.equal(r.pct_of_signups,null);assert.equal(r.pct_of_previous,null)}
});
test('FUNNEL_STAGE_LABELS: every stage has a French label, no stage missing',()=>{
 for(const stage of FUNNEL_STAGES)assert.equal(typeof FUNNEL_STAGE_LABELS[stage],'string');
});

// ------------------------------------------------------------
// Security/authorization model: the admin gate lives entirely in the SQL function (proven in the DB
// test), never re-implemented or duplicated on the client — and the route never trusts a
// client-supplied plan/role to decide access.
// ------------------------------------------------------------
test('migration 013: beta_analytics() checks the caller\'s OWN INTERNAL+ACTIVE entitlement before reading any cross-user data',async()=>{
 const migration=await readFile(new URL('../db/migrations/013_beta_analytics_admin.sql',import.meta.url),'utf8');
 assert.match(migration,/plan='INTERNAL' and status='ACTIVE'/);
 assert.match(migration,/raise exception 'Admin access required'/);
 assert.match(migration,/revoke all on function public\.beta_analytics\(\) from public,anon/);
 assert.match(migration,/grant execute on function public\.beta_analytics\(\) to authenticated/);
 assert.doesNotMatch(migration,/grant execute on function public\.beta_analytics\(\).*\banon\b/);
});
test('migration 013: last_business_activity_at is sourced from the append-only events table, never auth.users.last_sign_in_at',async()=>{
 const migration=await readFile(new URL('../db/migrations/013_beta_analytics_admin.sql',import.meta.url),'utf8');
 assert.match(migration,/last_business_activity_at['"]?,\s*\(select max\(e\.created_at\) from public\.events e/);
});
test('migration 013 is purely additive: no table/policy DDL, so it cannot weaken any existing RLS',async()=>{
 const migration=await readFile(new URL('../db/migrations/013_beta_analytics_admin.sql',import.meta.url),'utf8');
 assert.doesNotMatch(migration,/alter table|create policy|drop policy|create table/i);
});
test('route.ts: GET admin/beta-analytics calls db.rpc(\'beta_analytics\') through the caller\'s own authenticated client and maps the admin refusal to a clean 403',async()=>{
 const source=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(source,/resource==='admin'&&id==='beta-analytics'&&request\.method==='GET'/);
 assert.match(source,/db\.rpc\('beta_analytics'\)/);
 assert.match(source,/Admin access required/);
 assert.match(source,/,403\)/);
});
test('route.ts: the new admin route never introduces a service_role or bypasses the caller\'s own authenticatedDb client',async()=>{
 const source=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/service_role/i);
});
test('app/page.tsx: the Beta Analytics nav item is display-gated on entitlementPlan===\'INTERNAL\' (the real gate stays server-side in beta_analytics())',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/entitlementPlan==='INTERNAL'\?\[\['beta-analytics'/);
});
test('app/page.tsx: loadBetaAnalytics calls the admin route through the authenticated api() helper, never a direct privileged fetch',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/api\('admin\/beta-analytics'\)/);
});
test('app/page.tsx: no business activity renders literally "Aucune activité métier", never a fallback to a login timestamp',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/Aucune activité métier/);
});
test('app/page.tsx: the small-sample funnel caveat is shown to the user, never presented as statistically significant',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/non statistiquement significatifs/);
});
test('src/server/entitlement.ts (the sole access gate) never references the new admin function — this bloc adds a separate, narrower authorization path, not a change to the existing gate',async()=>{
 const source=await readFile(new URL('../src/server/entitlement.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/beta_analytics/,'requireActiveEntitlement must never need to know about the new admin function');
 assert.match(source,/if\(data\.plan==='INTERNAL'\)return;/,'the pre-existing INTERNAL exemption this bloc must never touch is still there, unmodified');
});
