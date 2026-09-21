-- Closes the "no entitlement row = full legacy access" bypass that requireActiveEntitlement() relied on
-- while ProspectOS had exactly one (historical) user. That fallback stopped being acceptable the moment
-- the app's URL became public: an unselected signup could otherwise reach every protected/paid action
-- forever, never expiring and never consuming one of the 10 BETA slots.
--
-- Purely additive and schema-only. Grants NOTHING to anyone automatically:
--   1. widen account_entitlements.plan to also allow 'INTERNAL', alongside the existing 'BETA' — the
--      historical/owner account's own explicit, permanent entitlement, categorically distinct from a
--      time-boxed BETA grant.
--   2. add grant_internal_access(email), the INTERNAL-plan sibling of the existing grant_beta_access
--      (migration 008): identical admin-only security model — revoked from public/anon/authenticated,
--      reachable only via direct SQL as postgres/service_role, never through the app's own
--      PostgREST/RPC surface a logged-in user reaches. No capacity limit (INTERNAL is excluded from
--      grant_beta_access's capacity math simply because that query filters on plan='BETA' — a
--      different plan value is what makes "INTERNAL never consumes a slot" true, not a separate
--      exemption that needs maintaining). Permanent: a 100-year expires_at that application code never
--      actually checks for plan='INTERNAL' (see src/server/entitlement.ts) — present only to satisfy
--      the existing NOT NULL/`expires_at > starts_at` constraints without weakening them for BETA rows.
--
-- Deliberately does NOT insert any row for any user. Identifying "the historical account" inside a
-- migration by guessing a user_id (oldest user, only current owner, etc.) is exactly the kind of guess
-- this hotfix's brief explicitly forbids, and by the time this migration runs a second (public) signup
-- may already exist, making any such heuristic actively unsafe. The one required INTERNAL grant is a
-- manual, one-line SQL statement run by an operator who already knows which email is the historical
-- account — see the RC report for the exact command and the required ordering against the application
-- deploy (grant INTERNAL first, deploy the fail-closed code second).
begin;

alter table public.account_entitlements drop constraint account_entitlements_plan_check;
alter table public.account_entitlements add constraint account_entitlements_plan_check check(plan in ('BETA','INTERNAL'));

create or replace function public.grant_internal_access(p_user_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select id into target from auth.users where email=p_user_email;
 if target is null then raise exception 'User not found for that email' using errcode='P0002'; end if;
 insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
 values(target,'INTERNAL','ACTIVE',now(),now()+interval '100 years',now())
 on conflict(user_id) do update set plan='INTERNAL',status='ACTIVE',starts_at=now(),expires_at=now()+interval '100 years',updated_at=now();
 return jsonb_build_object('user_id',target,'plan','INTERNAL');
end $$;
revoke all on function public.grant_internal_access(text) from public,anon,authenticated;

commit;
