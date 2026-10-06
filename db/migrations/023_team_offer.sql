-- ProspectOS Équipe (product decision of 2026-10-06): Pro becomes a single-account offer, and teams of 2 to 5
-- accounts buy their own offer, billed per seat like the market (179 € HT / month for 2 accounts, then 60 € per
-- extra account, up to 5 — one graduated Stripe price, quantity = paid seats).
--
-- 1. Entitlements: plan 'TEAM' with `seats` (the number of accounts paid for). A TEAM row always carries its seats.
-- 2. Quotas: a team gets the Pro volumes per paid seat (pro_* × seats), pooled on the organization exactly as in 022.
-- 3. Seats: the team's capacity is its PAID seats (TEAM) or team_max_seats (ENTERPRISE / INTERNAL, unchanged). Only
--    TEAM, ENTERPRISE and INTERNAL may invite: a Pro (single account) owner no longer can. Fewer paid seats than
--    members never removes anyone: new invitations are refused until the team is back under its capacity.
-- 4. Stripe: apply_stripe_subscription_state takes the subscription quantity (p_seats). A TEAM subscription whose
--    quantity is outside [team_min_seats, team_max_seats] grants nothing ('invalid_seats'). The billing account
--    and get_billing_status carry the seats.
--
-- 5. Effective access: get_effective_entitlement() — what the server's access gate (src/server/entitlement.ts) and the
--    account page read. A team member has no entitlement of its own: it works on its owner's plan while that is an
--    active team plan (TEAM / ENTERPRISE / INTERNAL), and is read-only otherwise. Anyone else: its own row, unchanged.
--
-- No production row is rewritten: no PRO subscription exists in production on 2026-10-06 (verified, read-only).
--
-- Rollback: re-create from 022 enforce_plan_limit, get_commercial_usage, team_plan_active, create_team_invitation,
-- accept_team_invitation, list_team; from 017 apply_stripe_subscription_state (11 arguments) and get_billing_status;
-- drop prospectos_private.team_seat_cap(uuid) and public.get_effective_entitlement(); once no TEAM row exists, restore both plan checks and drop the
-- `seats` columns and team_min_seats.
begin;

alter table public.account_entitlements drop constraint if exists account_entitlements_plan_check;
alter table public.account_entitlements add constraint account_entitlements_plan_check check(plan in ('BETA','INTERNAL','PAID','PRO','TEAM','ENTERPRISE'));
alter table public.account_entitlements add column if not exists seats int check(seats is null or seats between 1 and 50);
alter table public.account_entitlements drop constraint if exists account_entitlements_team_seats_check;
alter table public.account_entitlements add constraint account_entitlements_team_seats_check check(plan<>'TEAM' or seats is not null);

alter table prospectos_private.billing_accounts drop constraint if exists billing_accounts_plan_check;
alter table prospectos_private.billing_accounts add constraint billing_accounts_plan_check check(plan is null or plan in ('PAID','PRO','TEAM'));
alter table prospectos_private.billing_accounts add column if not exists seats int check(seats is null or seats between 1 and 50);

alter table prospectos_private.discovery_quota_settings add column if not exists team_min_seats int not null default 2 check(team_min_seats between 1 and 50);

-- Plans that own a team: TEAM (paid seats), ENTERPRISE and INTERNAL (operator plans).
create or replace function prospectos_private.team_plan_active(owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.account_entitlements e where e.user_id=owner and e.plan in ('TEAM','ENTERPRISE','INTERNAL') and e.status='ACTIVE' and e.expires_at>now())
$$;
revoke all on function prospectos_private.team_plan_active(uuid) from public,anon,authenticated;

-- How many accounts the owner's team may hold: its paid seats (TEAM), team_max_seats otherwise.
create or replace function prospectos_private.team_seat_cap(owner uuid) returns int
language sql stable security definer set search_path='' as $$
 select coalesce((select case when e.plan='TEAM' then e.seats end from public.account_entitlements e where e.user_id=owner),
                 (select team_max_seats from prospectos_private.discovery_quota_settings where singleton))
$$;
revoke all on function prospectos_private.team_seat_cap(uuid) from public,anon,authenticated;

-- 022's commercial check: a member works on its owner's TEAM (or operator) plan; TEAM gets the Pro volumes per seat.
create or replace function prospectos_private.enforce_plan_limit(actor uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.account_entitlements; lim int; used int; subj uuid; tm uuid;
begin
 if actor is null or action_name not in ('discovery','analysis','ai_offer') then return; end if;
 select p.subject,p.team into subj,tm from prospectos_private.plan_subject(actor) p;
 -- One pool for the whole team: serialized per team (after the caller's per-user lock, always in that order).
 if tm is not null then perform pg_advisory_xact_lock(hashtextextended('team:'||tm::text||':'||action_name,0)); end if;
 select * into e from public.account_entitlements where user_id=subj;
 -- A member works on the owner's team plan only: once it is not an active team plan, the team is read-only.
 if subj<>actor and (not found or e.plan not in ('TEAM','ENTERPRISE','INTERNAL') or e.status<>'ACTIVE' or e.expires_at<=now()) then
  raise exception 'plan_limit_reached' using errcode='P0001';
 end if;
 if not found or e.plan not in ('BETA','PAID','PRO','TEAM','ENTERPRISE') then return; end if;
 if e.status<>'ACTIVE' or e.expires_at<=now() then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 if e.plan='ENTERPRISE' then
  select case action_name when 'discovery' then discovery_limit when 'analysis' then analysis_limit else ai_offer_limit end
    into lim from prospectos_private.enterprise_limits where user_id=subj;
  if lim is null then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 else
  select case e.plan
          when 'PAID' then case action_name when 'discovery' then paid_discovery_limit when 'analysis' then paid_analysis_limit else paid_ai_offer_limit end
          when 'PRO' then case action_name when 'discovery' then pro_discovery_limit when 'analysis' then pro_analysis_limit else pro_ai_offer_limit end
          when 'TEAM' then coalesce(e.seats,0)*case action_name when 'discovery' then pro_discovery_limit when 'analysis' then pro_analysis_limit else pro_ai_offer_limit end
          else case action_name when 'discovery' then trial_discovery_limit when 'analysis' then trial_analysis_limit else trial_ai_offer_limit end end
    into lim from prospectos_private.discovery_quota_settings where singleton;
 end if;
 if tm is not null then
  select count(*) into used from prospectos_private.discovery_quota_usage
   where organization_id=tm and action=action_name and billable and used_at>=e.starts_at and used_at<e.expires_at;
 else
  select count(*) into used from prospectos_private.discovery_quota_usage
   where user_id=actor and action=action_name and billable and used_at>=e.starts_at and used_at<e.expires_at;
 end if;
 if used>=lim then raise exception '%', case action_name when 'ai_offer' then 'offer_limit_reached' else 'plan_limit_reached' end using errcode='P0001'; end if;
end $$;
revoke all on function prospectos_private.enforce_plan_limit(uuid,text) from public,anon,authenticated;

-- 022's counters, with TEAM: limits = Pro volumes × paid seats, and the seats in the answer.
create or replace function public.get_commercial_usage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); e public.account_entitlements; s prospectos_private.discovery_quota_settings; x prospectos_private.enterprise_limits; d int; a int; o int; dl int; al int; ol int; subj uuid; tm uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select p.subject,p.team into subj,tm from prospectos_private.plan_subject(actor) p;
 select * into e from public.account_entitlements where user_id=subj;
 -- 'team' is added for a team only: a lone account reads exactly 017's answer.
 if not found then return jsonb_build_object('plan',null)||case when tm is not null then jsonb_build_object('team',true) else '{}'::jsonb end; end if;
 if e.plan='INTERNAL' then return jsonb_build_object('plan','INTERNAL','status',e.status)||case when tm is not null then jsonb_build_object('team',true) else '{}'::jsonb end; end if;
 select * into s from prospectos_private.discovery_quota_settings where singleton;
 if e.plan='ENTERPRISE' then
  select * into x from prospectos_private.enterprise_limits where user_id=subj;
  dl:=coalesce(x.discovery_limit,0); al:=coalesce(x.analysis_limit,0); ol:=coalesce(x.ai_offer_limit,0);
 elsif e.plan='TEAM' then dl:=s.pro_discovery_limit*coalesce(e.seats,0); al:=s.pro_analysis_limit*coalesce(e.seats,0); ol:=s.pro_ai_offer_limit*coalesce(e.seats,0);
 elsif e.plan='PRO' then dl:=s.pro_discovery_limit; al:=s.pro_analysis_limit; ol:=s.pro_ai_offer_limit;
 elsif e.plan='PAID' then dl:=s.paid_discovery_limit; al:=s.paid_analysis_limit; ol:=s.paid_ai_offer_limit;
 else dl:=s.trial_discovery_limit; al:=s.trial_analysis_limit; ol:=s.trial_ai_offer_limit;
 end if;
 select count(*) filter(where action='discovery'),count(*) filter(where action='analysis'),count(*) filter(where action='ai_offer') into d,a,o
  from prospectos_private.discovery_quota_usage
  where (case when tm is not null then organization_id=tm else user_id=actor end) and billable and used_at>=e.starts_at and used_at<e.expires_at;
 return jsonb_build_object(
  'plan',e.plan,'status',e.status,'period_start',e.starts_at,'period_end',e.expires_at,
  'active',e.status='ACTIVE' and e.expires_at>now(),
  'discovery_used',d,'discovery_limit',dl,'analysis_used',a,'analysis_limit',al,'ai_offer_used',o,'ai_offer_limit',ol)
  ||case when tm is not null then jsonb_build_object('team',true) else '{}'::jsonb end
  ||case when e.plan='TEAM' then jsonb_build_object('seats',e.seats) else '{}'::jsonb end;
end $$;
revoke all on function public.get_commercial_usage() from public,anon;
grant execute on function public.get_commercial_usage() to authenticated;

-- 022's invitation, with the owner's own seat capacity.
create or replace function public.create_team_invitation(p_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); tm uuid; mail text := lower(trim(coalesce(p_email,''))); cap int; seats int; inv prospectos_private.team_invitations;
begin
 tm:=prospectos_private.require_team_owner();
 if not prospectos_private.team_plan_active(actor) then raise exception 'team_plan_required' using errcode='P0001'; end if;
 if mail !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(mail)>254 then raise exception 'Invalid email' using errcode='22023'; end if;
 if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation token' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('team-seats:'||tm::text,0));
 if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=tm and lower(u.email)=mail) then
  raise exception 'already_member' using errcode='P0001';
 end if;
 -- A new invitation for the same address replaces the pending one (its link stops working).
 update prospectos_private.team_invitations set revoked_at=now() where organization_id=tm and email=mail and accepted_at is null and revoked_at is null;
 cap:=prospectos_private.team_seat_cap(actor);
 seats:=(select count(*) from public.memberships where organization_id=tm)
  +(select count(*) from prospectos_private.team_invitations where organization_id=tm and accepted_at is null and revoked_at is null and expires_at>now());
 if seats>=cap then raise exception 'team_full' using errcode='P0001'; end if;
 insert into prospectos_private.team_invitations(organization_id,email,token_hash,invited_by) values(tm,mail,p_token_hash,actor) returning * into inv;
 return jsonb_build_object('id',inv.id,'email',inv.email,'expires_at',inv.expires_at);
end $$;
revoke all on function public.create_team_invitation(text,text) from public,anon;
grant execute on function public.create_team_invitation(text,text) to authenticated;

create or replace function public.accept_team_invitation(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); mail text; confirmed timestamptz; inv prospectos_private.team_invitations; owner uuid; cap int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into inv from prospectos_private.team_invitations
  where token_hash=coalesce(p_token_hash,'') and accepted_at is null and revoked_at is null and expires_at>now() for update;
 if not found then raise exception 'invitation_invalid' using errcode='P0001'; end if;
 select lower(u.email),u.email_confirmed_at into mail,confirmed from auth.users u where u.id=actor;
 if mail is distinct from inv.email then raise exception 'invitation_email_mismatch' using errcode='42501'; end if;
 if confirmed is null then raise exception 'email_not_confirmed' using errcode='42501'; end if;
 if exists(select 1 from public.memberships where user_id=actor and role='member') then raise exception 'already_in_team' using errcode='P0001'; end if;
 if exists(select 1 from public.memberships where user_id=actor and organization_id=inv.organization_id) then raise exception 'already_member' using errcode='P0001'; end if;
 select o.owner_id into owner from public.organizations o where o.id=inv.organization_id;
 if not prospectos_private.team_plan_active(owner) then raise exception 'team_unavailable' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('team-seats:'||inv.organization_id::text,0));
 cap:=prospectos_private.team_seat_cap(owner);
 if (select count(*) from public.memberships where organization_id=inv.organization_id)>=cap then raise exception 'team_full' using errcode='P0001'; end if;
 insert into public.memberships(organization_id,user_id,role) values(inv.organization_id,actor,'member');
 update prospectos_private.team_invitations set accepted_at=now(),accepted_by=actor where id=inv.id;
 return jsonb_build_object('organization_id',inv.organization_id);
end $$;
revoke all on function public.accept_team_invitation(text) from public,anon;
grant execute on function public.accept_team_invitation(text) to authenticated;

create or replace function public.list_team() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); tm uuid; owner uuid; cap int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select m.organization_id into tm from public.memberships m where m.user_id=actor and m.role='member' order by m.created_at,m.organization_id limit 1;
 if tm is null then tm:=prospectos_private.owned_team(actor); end if;
 if tm is null then return null; end if;
 select o.owner_id into owner from public.organizations o where o.id=tm;
 cap:=prospectos_private.team_seat_cap(owner);
 return jsonb_build_object('organization_id',tm,'is_owner',owner=actor,'max_seats',cap,'plan_active',prospectos_private.team_plan_active(owner),
  'pending',case when owner=actor then (select count(*) from prospectos_private.team_invitations where organization_id=tm and accepted_at is null and revoked_at is null and expires_at>now()) else null end,
  'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'joined_at',m.created_at) order by m.role desc,m.created_at),'[]'::jsonb)
             from public.memberships m left join auth.users u on u.id=m.user_id where m.organization_id=tm));
end $$;
revoke all on function public.list_team() from public,anon;
grant execute on function public.list_team() to authenticated;

-- The entitlement a protected action is checked against. Never another user's row for a non-member; for a team member
-- only the fields the gate needs (plan, status, expiry, seats), never any billing identifier.
create or replace function public.get_effective_entitlement() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); subj uuid; tm uuid; e public.account_entitlements;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select p.subject,p.team into subj,tm from prospectos_private.plan_subject(actor) p;
 select * into e from public.account_entitlements where user_id=subj;
 if not found then return null; end if;
 if subj<>actor and e.plan not in ('TEAM','ENTERPRISE','INTERNAL') then
  return jsonb_build_object('plan',e.plan,'status','EXPIRED','expires_at',e.expires_at,'seats',e.seats,'via_team',true);
 end if;
 return jsonb_build_object('plan',e.plan,'status',e.status,'expires_at',e.expires_at,'seats',e.seats,'via_team',subj<>actor);
end $$;
revoke all on function public.get_effective_entitlement() from public,anon;
grant execute on function public.get_effective_entitlement() to authenticated;

-- 017's webhook state, with the subscription quantity (p_seats, defaulted so a caller without it keeps working).
drop function if exists public.apply_stripe_subscription_state(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,boolean);
create or replace function public.apply_stripe_subscription_state(
 p_event_id text, p_event_type text, p_customer_id text, p_subscription_id text, p_price_id text, p_plan text,
 p_status text, p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean, p_paid boolean, p_seats int default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b prospectos_private.billing_accounts; e public.account_entitlements; result text; v_plan text := p_plan; v_seats int; seats_ok boolean := true;
begin
 if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_event_type is null
    or p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or (p_price_id is not null and p_price_id !~ '^price_[A-Za-z0-9]+$')
    or (p_plan is not null and p_plan not in ('PAID','PRO','TEAM'))
    or (p_seats is not null and p_seats not between 1 and 50)
    or p_status is null or p_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')
    or (p_period_start is not null and p_period_end is not null and p_period_end<=p_period_start) then
  raise exception 'Invalid billing state' using errcode='22023';
 end if;
 -- A team is sold for team_min_seats to team_max_seats accounts; any other quantity grants nothing.
 if v_plan='TEAM' then
  v_seats:=p_seats;
  seats_ok:=v_seats is not null and v_seats between (select team_min_seats from prospectos_private.discovery_quota_settings where singleton)
                                          and (select team_max_seats from prospectos_private.discovery_quota_settings where singleton);
  if not seats_ok then v_plan:=null; v_seats:=null; end if;
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
  update prospectos_private.billing_accounts set stripe_subscription_id=p_subscription_id,stripe_price_id=p_price_id,plan=v_plan,seats=v_seats,
   subscription_status=p_status,current_period_start=p_period_start,current_period_end=p_period_end,
   cancel_at_period_end=coalesce(p_cancel_at_period_end,false),last_event_id=p_event_id,last_event_at=now(),updated_at=now()
  where user_id=b.user_id;
  select * into e from public.account_entitlements where user_id=b.user_id for update;
  if found and e.plan in ('INTERNAL','ENTERPRISE') then
   result:='manual_plan_kept';
  elsif p_status='active' and p_paid then
   if not seats_ok then
    result:='invalid_seats';
   elsif v_plan is null then
    result:='unknown_price';
   elsif p_period_start is null or p_period_end is null then
    raise exception 'Invalid billing period' using errcode='22023';
   elsif found and e.plan=v_plan and e.status='ACTIVE' and e.starts_at=p_period_start and e.expires_at=p_period_end and e.seats is not distinct from v_seats then
    result:='unchanged';
   elsif found and e.plan in ('PAID','PRO','TEAM') and e.status='ACTIVE' and e.expires_at>p_period_end then
    -- Never moves a paid period backwards (a state read before a renewal, applied after it).
    result:='unchanged';
   else
    insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,seats,updated_at)
    values(b.user_id,v_plan,'ACTIVE',p_period_start,p_period_end,v_seats,now())
    on conflict (user_id) do update set plan=excluded.plan,status='ACTIVE',starts_at=excluded.starts_at,expires_at=excluded.expires_at,seats=excluded.seats,updated_at=now();
    result:='granted';
   end if;
  elsif p_status in ('canceled','unpaid','incomplete_expired') then
   if found and e.plan in ('PAID','PRO','TEAM') and e.status='ACTIVE' then
    update public.account_entitlements set status='EXPIRED',updated_at=now() where user_id=b.user_id;
    result:='access_ended';
   else
    result:='status_synced';
   end if;
  else
   -- past_due, incomplete, paused, trialing, or active with an unpaid latest invoice: nothing is extended.
   result:=case when v_plan is null and p_price_id is not null then 'unknown_price' else 'status_synced' end;
  end if;
 end if;
 update prospectos_private.stripe_webhook_events set outcome=result where event_id=p_event_id;
 return jsonb_build_object('outcome',result,'user_id',b.user_id);
end $$;
revoke all on function public.apply_stripe_subscription_state(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,boolean,int) from public,anon,authenticated;
grant execute on function public.apply_stripe_subscription_state(text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,boolean,int) to service_role;

create or replace function public.get_billing_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); b prospectos_private.billing_accounts;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into b from prospectos_private.billing_accounts where user_id=actor;
 if not found then return jsonb_build_object('has_customer',false); end if;
 return jsonb_build_object('has_customer',true,'plan',b.plan,'seats',b.seats,'status',b.subscription_status,
  'cancel_at_period_end',b.cancel_at_period_end,'current_period_end',b.current_period_end);
end $$;
revoke all on function public.get_billing_status() from public,anon;
grant execute on function public.get_billing_status() to authenticated;

commit;
