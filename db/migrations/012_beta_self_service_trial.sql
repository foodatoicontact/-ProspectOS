-- Self-service 7-day free trial activation. Purely additive: no table, column, or existing function
-- (grant_beta_access, grant_internal_access, requireActiveEntitlement) is touched. The manual, email-
-- driven admin path (migration 008) stays fully intact and callable exactly as before — this only adds
-- a second, narrower path a logged-in user can trigger for themselves.
--
-- Security: activate_trial() takes NO parameters. It derives the beneficiary exclusively from auth.uid()
-- inside the function body — a caller can never target another account, and the browser can never
-- supply an email/user_id/plan/status/expires_at that this function would trust. This is the self-
-- service mechanism the brief asks for instead of widening grant_beta_access's own permissions (which
-- stays admin-only, revoked from authenticated, exactly as migration 008 left it).
--
-- Idempotency/concurrency: mirrors grant_beta_access's own proven structure exactly — same advisory
-- lock key ('beta_program_capacity'), so a self-service activation and a manual admin grant racing for
-- the last slot are serialized against the SAME counter, never counted separately. If a row already
-- exists for this user (ACTIVE, EXPIRED, or REVOKED — any status), the function returns it completely
-- unchanged: no re-extension of expires_at, no second trial on the same account, ever, however many
-- times it is called (double click, retry, refresh, or a later login all resolve to the same read).
-- Only a user with zero prior account_entitlements row can ever consume a new capacity slot.
--
-- Rollback: `drop function if exists public.activate_trial();` — safe, additive-only removal; no data
-- this function created needs to be reverted (existing account_entitlements rows are ordinary BETA rows,
-- indistinguishable from and as valid as ones grant_beta_access would have created).
begin;

create or replace function public.activate_trial() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); cap int; used int; already boolean; row_plan text; row_status text; row_expires timestamptz;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('beta_program_capacity'));
 select exists(select 1 from public.account_entitlements where user_id=actor) into already;
 if not already then
  select capacity into cap from prospectos_private.beta_program where singleton;
  select count(*) into used from public.account_entitlements where plan='BETA';
  if used>=cap then raise exception 'BETA_CAPACITY_REACHED' using errcode='P0001'; end if;
  insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
  values(actor,'BETA','ACTIVE',now(),now()+interval '7 days',now());
 end if;
 select plan,status,expires_at into row_plan,row_status,row_expires from public.account_entitlements where user_id=actor;
 return jsonb_build_object('plan',row_plan,'status',row_status,'expires_at',row_expires);
end $$;
revoke all on function public.activate_trial() from public,anon;
grant execute on function public.activate_trial() to authenticated;

commit;
