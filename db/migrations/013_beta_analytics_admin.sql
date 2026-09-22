-- Beta Analytics admin dashboard: a single, additive, read-only SECURITY DEFINER function. No table, no
-- column, no RLS policy is touched — every existing tenant_read/tenant_insert/tenant_update/tenant_delete
-- policy and every existing function (activate_trial, grant_beta_access, grant_internal_access,
-- requireActiveEntitlement) is completely unaffected.
--
-- Admin model: reuses the existing account_entitlements.plan='INTERNAL' distinction rather than inventing
-- a new admin flag/table. INTERNAL is already, by construction, reachable only via the admin-only
-- grant_internal_access() (never self-service, never through activate_trial) — the same identity check
-- this schema already trusts everywhere else. No RLS is widened to make this work: instead, this one
-- function is SECURITY DEFINER and checks the caller's OWN plan before reading anything cross-user,
-- exactly the same shape as bootstrap_organization checking auth.uid() before writing. Never grants
-- anything to anon; EXECUTE goes only to authenticated, and authenticated callers who are not INTERNAL
-- get a clean 'Admin access required' exception before any row is ever read.
--
-- Data shape: returns raw, per-user FACTS only (signup/confirmation/last-sign-in, entitlement, first
-- organization, project/discovery-run/prospect counts, last real business-activity timestamp from the
-- existing append-only `events` table). No funnel stage, no percentage, no derived label is computed
-- here — that derivation lives in application code (src/domain/beta-analytics.ts) so the SQL stays a
-- thin, auditable fact source and the interpretation logic stays reviewable/testable in TypeScript.
--
-- "Last business activity" is deliberately `max(events.created_at)` — the same append-only audit trail
-- already used for evidence/prospect/outreach changes — never `auth.users.last_sign_in_at`, which is
-- only ever surfaced separately as "last sign-in" (an authentication fact, not a product-usage fact).
--
-- Multi-org edge case: V0's own UI never lets a user create more than one organization (createProject()
-- only calls create_organization when the user has none), but the RPC itself has no such constraint. A
-- LATERAL join picks at most the user's oldest membership, so a hypothetical extra organization can never
-- inflate or duplicate a user's row in this report.
--
-- Rollback: `drop function if exists public.beta_analytics();` — safe, additive-only removal, reads no
-- data it could ever corrupt.
begin;

create or replace function public.beta_analytics() returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); is_admin boolean; cap int; used int;
begin
 if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select exists(select 1 from public.account_entitlements where user_id=caller and plan='INTERNAL' and status='ACTIVE') into is_admin;
 if not is_admin then raise exception 'Admin access required' using errcode='42501'; end if;

 select capacity into cap from prospectos_private.beta_program where singleton;
 select count(*) into used from public.account_entitlements where plan='BETA';

 return jsonb_build_object(
  'capacity', cap,
  'beta_used', used,
  'users', (
   select coalesce(jsonb_agg(u order by u->>'user_created_at'), '[]'::jsonb) from (
    select jsonb_build_object(
     'user_id', au.id,
     'email', au.email,
     'user_created_at', au.created_at,
     'email_confirmed_at', au.email_confirmed_at,
     'last_sign_in_at', au.last_sign_in_at,
     'plan', ae.plan,
     'status', ae.status,
     'entitlement_starts_at', ae.starts_at,
     'expires_at', ae.expires_at,
     'organization_id', m.organization_id,
     'organization_created_at', o.created_at,
     'project_count', (select count(*) from public.projects p where p.organization_id=m.organization_id),
     'first_project_at', (select min(p.created_at) from public.projects p where p.organization_id=m.organization_id),
     'discovery_run_count', (select count(*) from public.discovery_runs d where d.organization_id=m.organization_id),
     'first_discovery_at', (select min(d.started_at) from public.discovery_runs d where d.organization_id=m.organization_id),
     'prospect_count', (select count(*) from public.prospects pr where pr.organization_id=m.organization_id),
     'last_business_activity_at', (select max(e.created_at) from public.events e where e.actor_id=au.id)
    ) as u
    from auth.users au
    left join public.account_entitlements ae on ae.user_id=au.id
    left join lateral (
     select m2.organization_id from public.memberships m2 where m2.user_id=au.id order by m2.created_at asc limit 1
    ) m on true
    left join public.organizations o on o.id=m.organization_id
    where coalesce(ae.plan,'') <> 'INTERNAL'
   ) x
  )
 );
end $$;
revoke all on function public.beta_analytics() from public,anon;
grant execute on function public.beta_analytics() to authenticated;

commit;
