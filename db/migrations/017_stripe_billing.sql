-- Stripe Billing (self-service ProspectOS Bêta 49 € HT / month and ProspectOS Pro B2B 99 € HT / month).
-- Additive: no row is rewritten, no existing column is removed, no policy on an exposed table is changed.
--
-- 1. Plans. account_entitlements.plan keeps its production values — 'BETA' (the 7-day trial, historical
--    name), 'PAID' (ProspectOS Bêta), 'INTERNAL' — and also allows 'PRO' (ProspectOS Pro B2B) and
--    'ENTERPRISE' (quote only, activated by an operator). The mapping to the commercial names
--    (TRIAL / BETA / PRO / ENTERPRISE / INTERNAL) lives in src/domain/plans.ts. The paid period stays where
--    016 put it: starts_at = current period start, expires_at = current period end (the reset date). Stripe
--    drives those two dates now, so quotas reset on the subscription anniversary, never on the 1st.
-- 2. Limits. PRO 300 / 750 / 75 per period, next to the trial and paid settings (private, operator-tunable).
--    ENTERPRISE limits are per customer (prospectos_private.enterprise_limits); an ENTERPRISE entitlement
--    without limits consumes nothing (fail closed).
-- 3. Billing state. prospectos_private.billing_accounts: one row per user (the entitlement holder, as in 016),
--    the Stripe customer created by the server, the current subscription and its synchronized status and
--    period. prospectos_private.stripe_webhook_events: every Stripe event id applied, so a replayed or
--    concurrently delivered event has no second effect (primary key, same transaction as the change).
--    Both tables are private: no grant to anon/authenticated, reached only through the functions below.
-- 4. Functions. SERVER ONLY (service_role): link_stripe_customer, get_billing_account,
--    apply_stripe_subscription_state. MEMBER (authenticated, own row from auth.uid()): get_billing_status —
--    read-only, no Stripe identifier. ADMIN ONLY (direct SQL): grant_enterprise_access. Nobody can choose
--    their own plan: an entitlement changes only when a Stripe event, verified and re-read from Stripe by the
--    server, says the subscription is active AND its latest invoice is paid.
-- 5. Access policy (apply_stripe_subscription_state). active + paid → the plan of the Stripe price, period =
--    the Stripe period (a replay never moves it, never resets the counters twice). past_due / incomplete →
--    nothing is extended: access runs until the end of the period already paid. canceled / unpaid /
--    incomplete_expired → the paid entitlement is EXPIRED: paid actions stop, every business row is kept.
--    cancel_at_period_end → nothing to do: expires_at already is the period end. Unknown price → no access.
--    An INTERNAL or ENTERPRISE entitlement is never touched by Stripe.
-- 6. Account deletion. delete_own_account (body of 016) also refuses while a subscription would keep
--    billing ('active_subscription_blocked'): the customer cancels first ("Gérer mon abonnement"). The
--    billing row is kept after deletion — it only links invoices kept by Stripe — and the auth user row it
--    references is anonymized, never deleted (008), so no reference is left dangling.
--
-- Rollback: re-create enforce_plan_limit, get_commercial_usage and delete_own_account from 016; drop the
-- functions and the three private tables created here; restore the plan check to ('BETA','INTERNAL','PAID')
-- once no PRO/ENTERPRISE row exists. The added settings columns are harmless.
begin;

alter table public.account_entitlements drop constraint if exists account_entitlements_plan_check;
alter table public.account_entitlements add constraint account_entitlements_plan_check check(plan in ('BETA','INTERNAL','PAID','PRO','ENTERPRISE'));

alter table prospectos_private.discovery_quota_settings
 add column if not exists pro_discovery_limit int not null default 300 check(pro_discovery_limit>0),
 add column if not exists pro_analysis_limit int not null default 750 check(pro_analysis_limit>0),
 add column if not exists pro_ai_offer_limit int not null default 75 check(pro_ai_offer_limit>0);

create table if not exists prospectos_private.enterprise_limits (
 user_id uuid primary key references auth.users(id),
 discovery_limit int not null check(discovery_limit>0),
 analysis_limit int not null check(analysis_limit>0),
 ai_offer_limit int not null check(ai_offer_limit>0),
 updated_at timestamptz not null default now()
);
revoke all on prospectos_private.enterprise_limits from public,anon,authenticated;

create table if not exists prospectos_private.billing_accounts (
 user_id uuid primary key references auth.users(id),
 stripe_customer_id text not null unique check(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 stripe_subscription_id text unique check(stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
 stripe_price_id text check(stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
 plan text check(plan is null or plan in ('PAID','PRO')),
 subscription_status text check(subscription_status is null or subscription_status in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
 current_period_start timestamptz,
 current_period_end timestamptz,
 cancel_at_period_end boolean not null default false,
 last_event_id text,
 last_event_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
revoke all on prospectos_private.billing_accounts from public,anon,authenticated;

create table if not exists prospectos_private.stripe_webhook_events (
 event_id text primary key check(event_id ~ '^evt_[A-Za-z0-9]+$'),
 event_type text not null check(length(event_type) between 1 and 100),
 outcome text not null,
 received_at timestamptz not null default now()
);
create index if not exists stripe_webhook_events_received_idx on prospectos_private.stripe_webhook_events(received_at);
revoke all on prospectos_private.stripe_webhook_events from public,anon,authenticated;

-- 016's commercial check, extended to PRO (settings) and ENTERPRISE (per-customer limits). Same locks, same
-- errors, same window [starts_at, expires_at); BETA (trial) and PAID behave exactly as before.
create or replace function prospectos_private.enforce_plan_limit(actor uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.account_entitlements; lim int; used int;
begin
 if actor is null or action_name not in ('discovery','analysis','ai_offer') then return; end if;
 select * into e from public.account_entitlements where user_id=actor;
 if not found or e.plan not in ('BETA','PAID','PRO','ENTERPRISE') then return; end if;
 if e.status<>'ACTIVE' or e.expires_at<=now() then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 if e.plan='ENTERPRISE' then
  select case action_name when 'discovery' then discovery_limit when 'analysis' then analysis_limit else ai_offer_limit end
    into lim from prospectos_private.enterprise_limits where user_id=actor;
  if lim is null then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 else
  select case e.plan
          when 'PAID' then case action_name when 'discovery' then paid_discovery_limit when 'analysis' then paid_analysis_limit else paid_ai_offer_limit end
          when 'PRO' then case action_name when 'discovery' then pro_discovery_limit when 'analysis' then pro_analysis_limit else pro_ai_offer_limit end
          else case action_name when 'discovery' then trial_discovery_limit when 'analysis' then trial_analysis_limit else trial_ai_offer_limit end end
    into lim from prospectos_private.discovery_quota_settings where singleton;
 end if;
 select count(*) into used from prospectos_private.discovery_quota_usage
  where user_id=actor and action=action_name and billable and used_at>=e.starts_at and used_at<e.expires_at;
 if used>=lim then raise exception '%', case action_name when 'ai_offer' then 'offer_limit_reached' else 'plan_limit_reached' end using errcode='P0001'; end if;
end $$;
revoke all on function prospectos_private.enforce_plan_limit(uuid,text) from public,anon,authenticated;

-- Same contract as 016 (own counters from auth.uid(), pure read), with the PRO and ENTERPRISE limits.
create or replace function public.get_commercial_usage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); e public.account_entitlements; s prospectos_private.discovery_quota_settings; x prospectos_private.enterprise_limits; d int; a int; o int; dl int; al int; ol int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into e from public.account_entitlements where user_id=actor;
 if not found then return jsonb_build_object('plan',null); end if;
 if e.plan='INTERNAL' then return jsonb_build_object('plan','INTERNAL','status',e.status); end if;
 select * into s from prospectos_private.discovery_quota_settings where singleton;
 if e.plan='ENTERPRISE' then
  select * into x from prospectos_private.enterprise_limits where user_id=actor;
  dl:=coalesce(x.discovery_limit,0); al:=coalesce(x.analysis_limit,0); ol:=coalesce(x.ai_offer_limit,0);
 elsif e.plan='PRO' then dl:=s.pro_discovery_limit; al:=s.pro_analysis_limit; ol:=s.pro_ai_offer_limit;
 elsif e.plan='PAID' then dl:=s.paid_discovery_limit; al:=s.paid_analysis_limit; ol:=s.paid_ai_offer_limit;
 else dl:=s.trial_discovery_limit; al:=s.trial_analysis_limit; ol:=s.trial_ai_offer_limit;
 end if;
 select count(*) filter(where action='discovery'),count(*) filter(where action='analysis'),count(*) filter(where action='ai_offer') into d,a,o
  from prospectos_private.discovery_quota_usage where user_id=actor and billable and used_at>=e.starts_at and used_at<e.expires_at;
 return jsonb_build_object(
  'plan',e.plan,'status',e.status,'period_start',e.starts_at,'period_end',e.expires_at,
  'active',e.status='ACTIVE' and e.expires_at>now(),
  'discovery_used',d,'discovery_limit',dl,'analysis_used',a,'analysis_limit',al,'ai_offer_used',o,'ai_offer_limit',ol);
end $$;
revoke all on function public.get_commercial_usage() from public,anon;
grant execute on function public.get_commercial_usage() to authenticated;

-- SERVER ONLY. Links the Stripe customer the server just created (idempotency key per user) to the user, once:
-- a second, racing checkout keeps the first stored customer and gets it back. A customer already linked to
-- another user is refused by the unique constraint.
create or replace function public.link_stripe_customer(p_user_id uuid, p_customer_id text) returns text
language plpgsql security definer set search_path='' as $$
declare stored text;
begin
 if p_user_id is null or p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid billing customer' using errcode='22023'; end if;
 insert into prospectos_private.billing_accounts(user_id,stripe_customer_id) values(p_user_id,p_customer_id) on conflict (user_id) do nothing;
 select stripe_customer_id into stored from prospectos_private.billing_accounts where user_id=p_user_id;
 return stored;
end $$;
revoke all on function public.link_stripe_customer(uuid,text) from public,anon,authenticated;
grant execute on function public.link_stripe_customer(uuid,text) to service_role;

-- SERVER ONLY. The billing row of a user the server already authenticated (checkout, portal, account).
create or replace function public.get_billing_account(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(b) from prospectos_private.billing_accounts b where b.user_id=p_user_id;
$$;
revoke all on function public.get_billing_account(uuid) from public,anon,authenticated;
grant execute on function public.get_billing_account(uuid) to service_role;

-- SERVER ONLY. Applies the state of one Stripe subscription, as the server re-read it from Stripe after a
-- verified webhook event. The user is found from the customer the server linked itself — never from event
-- metadata. Returns {outcome, user_id}; 'duplicate' means the event was already applied (no effect at all).
create or replace function public.apply_stripe_subscription_state(
 p_event_id text, p_event_type text, p_customer_id text, p_subscription_id text, p_price_id text, p_plan text,
 p_status text, p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean, p_paid boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b prospectos_private.billing_accounts; e public.account_entitlements; result text;
begin
 if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_event_type is null
    or p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or (p_price_id is not null and p_price_id !~ '^price_[A-Za-z0-9]+$')
    or (p_plan is not null and p_plan not in ('PAID','PRO'))
    or p_status is null or p_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')
    or (p_period_start is not null and p_period_end is not null and p_period_end<=p_period_start) then
  raise exception 'Invalid billing state' using errcode='22023';
 end if;
 insert into prospectos_private.stripe_webhook_events(event_id,event_type,outcome) values(p_event_id,p_event_type,'processing')
 on conflict (event_id) do nothing;
 if not found then return jsonb_build_object('outcome','duplicate'); end if;
 -- Stripe retries for 3 days; 90 days of event ids is far more than any replay window.
 delete from prospectos_private.stripe_webhook_events where received_at<now()-interval '90 days';
 perform pg_advisory_xact_lock(hashtextextended('billing-customer:'||p_customer_id,0));
 select * into b from prospectos_private.billing_accounts where stripe_customer_id=p_customer_id for update;
 if not found then
  result:='unknown_customer';
 elsif b.stripe_subscription_id is not null and b.stripe_subscription_id<>p_subscription_id
       and b.subscription_status in ('active','past_due','unpaid','trialing')
       and p_status in ('canceled','incomplete_expired','incomplete') then
  -- An old or abandoned subscription must never overwrite the current one.
  result:='stale_subscription';
 else
  update prospectos_private.billing_accounts set stripe_subscription_id=p_subscription_id,stripe_price_id=p_price_id,plan=p_plan,
   subscription_status=p_status,current_period_start=p_period_start,current_period_end=p_period_end,
   cancel_at_period_end=coalesce(p_cancel_at_period_end,false),last_event_id=p_event_id,last_event_at=now(),updated_at=now()
  where user_id=b.user_id;
  select * into e from public.account_entitlements where user_id=b.user_id for update;
  if found and e.plan in ('INTERNAL','ENTERPRISE') then
   result:='manual_plan_kept';
  elsif p_status='active' and p_paid then
   if p_plan is null then
    result:='unknown_price';
   elsif p_period_start is null or p_period_end is null then
    raise exception 'Invalid billing period' using errcode='22023';
   elsif found and e.plan=p_plan and e.status='ACTIVE' and e.starts_at=p_period_start and e.expires_at=p_period_end then
    result:='unchanged';
   elsif found and e.plan in ('PAID','PRO') and e.status='ACTIVE' and e.expires_at>p_period_end then
    -- Never moves a paid period backwards (a state read before a renewal, applied after it).
    result:='unchanged';
   else
    insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
    values(b.user_id,p_plan,'ACTIVE',p_period_start,p_period_end,now())
    on conflict (user_id) do update set plan=excluded.plan,status='ACTIVE',starts_at=excluded.starts_at,expires_at=excluded.expires_at,updated_at=now();
    result:='granted';
   end if;
  elsif p_status in ('canceled','unpaid','incomplete_expired') then
   if found and e.plan in ('PAID','PRO') and e.status='ACTIVE' then
    update public.account_entitlements set status='EXPIRED',updated_at=now() where user_id=b.user_id;
    result:='access_ended';
   else
    result:='status_synced';
   end if;
  else
   -- past_due, incomplete, paused, trialing, or active with an unpaid latest invoice: nothing is extended.
   result:=case when p_plan is null and p_price_id is not null then 'unknown_price' else 'status_synced' end;
  end if;
 end if;
 update prospectos_private.stripe_webhook_events set outcome=result where event_id=p_event_id;
 return jsonb_build_object('outcome',result,'user_id',b.user_id);
end $$;
revoke all on function public.apply_stripe_subscription_state(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,boolean) from public,anon,authenticated;
grant execute on function public.apply_stripe_subscription_state(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,boolean) to service_role;

-- MEMBER. The caller's own subscription summary for the account page (warning when past_due, end date when
-- cancelled at period end). From auth.uid() only; no Stripe identifier ever leaves the server.
create or replace function public.get_billing_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); b prospectos_private.billing_accounts;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into b from prospectos_private.billing_accounts where user_id=actor;
 if not found then return jsonb_build_object('has_customer',false); end if;
 return jsonb_build_object('has_customer',true,'plan',b.plan,'status',b.subscription_status,
  'cancel_at_period_end',b.cancel_at_period_end,'current_period_end',b.current_period_end);
end $$;
revoke all on function public.get_billing_status() from public,anon;
grant execute on function public.get_billing_status() to authenticated;

-- ADMIN ONLY (direct SQL, like grant_beta_access / grant_internal_access). Enterprise / White Label contract:
-- contractual dates and custom per-period limits. Never reachable through the application.
create or replace function public.grant_enterprise_access(p_user_email text, p_starts_at timestamptz, p_expires_at timestamptz,
 p_discovery_limit int, p_analysis_limit int, p_ai_offer_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select id into target from auth.users where email=p_user_email;
 if target is null then raise exception 'User not found for that email' using errcode='P0002'; end if;
 if p_starts_at is null or p_expires_at is null or p_expires_at<=p_starts_at then raise exception 'Invalid contract dates' using errcode='22023'; end if;
 insert into prospectos_private.enterprise_limits(user_id,discovery_limit,analysis_limit,ai_offer_limit,updated_at)
 values(target,p_discovery_limit,p_analysis_limit,p_ai_offer_limit,now())
 on conflict (user_id) do update set discovery_limit=excluded.discovery_limit,analysis_limit=excluded.analysis_limit,ai_offer_limit=excluded.ai_offer_limit,updated_at=now();
 insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
 values(target,'ENTERPRISE','ACTIVE',p_starts_at,p_expires_at,now())
 on conflict (user_id) do update set plan='ENTERPRISE',status='ACTIVE',starts_at=excluded.starts_at,expires_at=excluded.expires_at,updated_at=now();
 return jsonb_build_object('user_id',target,'plan','ENTERPRISE','expires_at',p_expires_at);
end $$;
revoke all on function public.grant_enterprise_access(text,timestamptz,timestamptz,int,int,int) from public,anon,authenticated,service_role;

-- Account deletion: body of 016, plus one refusal while a subscription would keep billing a deleted account.
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
 return jsonb_build_object('memberships_removed', true);
end $$;

commit;
