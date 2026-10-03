-- Deleted accounts no longer hold a beta seat.
--
-- Bug: delete_own_account() removed the memberships and the server then anonymized the auth user, but the
-- account's account_entitlements row was left untouched (plan BETA, status ACTIVE). Beta capacity is counted
-- as "BETA rows, ever" (008/012), so every deleted account kept consuming one of the capacity seats forever,
-- and the admin report kept showing it as an active trial.
--
-- Canonical deletion signal: account_entitlements.status = 'REVOKED', written by delete_own_account() itself,
-- in the same transaction as the membership removal (server-side, SECURITY DEFINER, actor = auth.uid()). No
-- other code path sets REVOKED today (008 reserved the value; Stripe sync only ever writes ACTIVE/EXPIRED on
-- PAID/PRO rows). The row is kept, never deleted: history, audit, events and evidence references stay intact.
-- user_metadata.deleted (set by anonymizeAuthUser) is NOT used: a signed-in user can write their own
-- user_metadata, so it could be forged to free a seat.
--
-- Capacity semantics are otherwise unchanged: a seat is still "a BETA trial ever granted" (an expired trial
-- keeps its seat, as decided in 008), except that a closed account gives its seat back.
--
-- Changes (one rule, applied everywhere the seat count is read):
-- 1. prospectos_private.beta_seats_used(): BETA rows that are not REVOKED.
-- 2. activate_trial(), grant_beta_access(), beta_analytics(): use it (bodies otherwise identical to 012/008/013).
--    grant_beta_access() also re-checks capacity before re-granting a REVOKED row, so a closed account can
--    never silently take a seat back.
-- 3. delete_own_account(): body of 017 + REVOKED on the actor's BETA entitlement. Only BETA rows hold a seat;
--    PAID/PRO rows keep their Stripe lifecycle unchanged (the period-end event still ends them), and
--    INTERNAL/ENTERPRISE rows are manual plans outside the beta capacity.
--
-- Existing data: rows of accounts deleted before this migration are still ACTIVE. They are repaired by the
-- separate, reviewed script db/repairs/018_revoke_deleted_accounts_entitlements.sql (run only on explicit GO).
--
-- Rollback: re-create activate_trial (012), grant_beta_access (008), beta_analytics (013) and
-- delete_own_account (017); drop function prospectos_private.beta_seats_used(). REVOKED rows can stay as they
-- are (they deny access exactly like before, through requireActiveEntitlement).
begin;

create or replace function prospectos_private.beta_seats_used() returns int
language sql stable security definer set search_path='' as $$
 select count(*)::int from public.account_entitlements where plan='BETA' and status<>'REVOKED'
$$;
revoke all on function prospectos_private.beta_seats_used() from public,anon,authenticated;

create or replace function public.activate_trial() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); cap int; used int; already boolean; row_plan text; row_status text; row_expires timestamptz;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('beta_program_capacity'));
 select exists(select 1 from public.account_entitlements where user_id=actor) into already;
 if not already then
  select capacity into cap from prospectos_private.beta_program where singleton;
  used := prospectos_private.beta_seats_used();
  if used>=cap then raise exception 'BETA_CAPACITY_REACHED' using errcode='P0001'; end if;
  insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
  values(actor,'BETA','ACTIVE',now(),now()+interval '7 days',now());
 end if;
 select plan,status,expires_at into row_plan,row_status,row_expires from public.account_entitlements where user_id=actor;
 return jsonb_build_object('plan',row_plan,'status',row_status,'expires_at',row_expires);
end $$;
revoke all on function public.activate_trial() from public,anon;
grant execute on function public.activate_trial() to authenticated;

create or replace function public.grant_beta_access(p_user_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; cap int; used int; already boolean;
begin
 perform pg_advisory_xact_lock(hashtext('beta_program_capacity'));
 select id into target from auth.users where email=p_user_email;
 if target is null then raise exception 'User not found for that email' using errcode='P0002'; end if;
 select exists(select 1 from public.account_entitlements where user_id=target and status<>'REVOKED') into already;
 if not already then
  select capacity into cap from prospectos_private.beta_program where singleton;
  used := prospectos_private.beta_seats_used();
  if used>=cap then raise exception 'BETA_CAPACITY_REACHED' using errcode='P0001'; end if;
 end if;
 insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
 values(target,'BETA','ACTIVE',now(),now()+interval '7 days',now())
 on conflict(user_id) do update set plan='BETA',status='ACTIVE',starts_at=now(),expires_at=now()+interval '7 days',updated_at=now();
 return jsonb_build_object('user_id',target,'expires_at',now()+interval '7 days');
end $$;
revoke all on function public.grant_beta_access(text) from public,anon,authenticated;

create or replace function public.beta_analytics() returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); is_admin boolean; cap int; used int;
begin
 if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select exists(select 1 from public.account_entitlements where user_id=caller and plan='INTERNAL' and status='ACTIVE') into is_admin;
 if not is_admin then raise exception 'Admin access required' using errcode='42501'; end if;

 select capacity into cap from prospectos_private.beta_program where singleton;
 used := prospectos_private.beta_seats_used();

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

-- Account deletion: body of 017, plus the canonical REVOKED marker on the actor's own BETA entitlement.
create or replace function public.delete_own_account() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); blocked jsonb := '[]'::jsonb; m record; other_owners int; other_members int; biz_count int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if exists(select 1 from prospectos_private.billing_accounts where user_id=actor and not cancel_at_period_end
           and subscription_status in ('active','trialing','past_due','unpaid','incomplete','paused')) then
  raise exception 'active_subscription_blocked' using errcode='P0001';
 end if;
 for m in select organization_id, role from public.memberships where user_id=actor loop
  if m.role='owner' then
   select count(*) into other_owners from public.memberships where organization_id=m.organization_id and role='owner' and user_id<>actor;
   if other_owners=0 then
    select count(*) into other_members from public.memberships where organization_id=m.organization_id and user_id<>actor;
    select count(*) into biz_count from public.projects where organization_id=m.organization_id;
    if other_members>0 or biz_count>0 then blocked := blocked || jsonb_build_array(m.organization_id); end if;
   end if;
  end if;
 end loop;
 if jsonb_array_length(blocked)>0 then
  raise exception 'last_owner_blocked' using errcode='P0001', detail=blocked::text;
 end if;
 delete from prospectos_private.offer_analyses where user_id=actor;
 delete from public.memberships where user_id=actor;
 update public.account_entitlements set status='REVOKED',updated_at=now() where user_id=actor and plan='BETA' and status<>'REVOKED';
 return jsonb_build_object('memberships_removed', true);
end $$;
revoke all on function public.delete_own_account() from public,anon;
grant execute on function public.delete_own_account() to authenticated;

commit;
