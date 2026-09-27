-- ProspectOS Bêta commercial quotas (49 € HT / month, 7-day free trial). Additive: no table is created,
-- no row is deleted, no RLS policy is changed, and every existing hourly protection stays exactly in place.
--
-- 1. Plans. account_entitlements.plan also allows 'PAID' — the ProspectOS Bêta subscription. A PAID row
--    stores its CURRENT billing period in the columns that already exist: starts_at = period start,
--    expires_at = period end (the reset date). Renewing a period means moving both forward — done later by
--    the payment integration (not part of this migration: no Stripe code exists yet). BETA stays the 7-day
--    trial ([starts_at, expires_at) = the trial itself); INTERNAL stays unlimited.
-- 2. Limits. Four operator-tunable settings next to the existing hourly ones (private schema, no client
--    grant): trial 20 Discovery / 50 analyses, paid 100 Discovery / 250 analyses per period.
-- 3. Counting. The existing append-only prospectos_private.discovery_quota_usage log is the source of truth.
--    Commercial quotas are counted PER USER (the entitlement holder) inside the current window: migration
--    015 notes any authenticated user can create organizations, so a per-organization count could be
--    multiplied. Analysis rows already carry user_id (015); Discovery rows now record it too. Rows written
--    before this migration have no user_id and are not counted (never more restrictive than before).
-- 4. Enforcement. A launch is counted only where it is already reserved today — start_discovery (via
--    consume_discovery_quota) and consume_analysis_quota — inside the same transaction and under a
--    per-user advisory lock, so parallel requests can never both take the last unit. Reading pages, history,
--    reviewing proofs, changing a status or exporting never reach these functions and never count.
--    A refusal raises 'plan_limit_reached' (distinct from the hourly 'quota_exceeded'); nothing is billed
--    beyond the quota — there is no overage.
-- 5. get_commercial_usage(): the caller's own plan, window and counters, derived from auth.uid() only.
--
-- Rollback: re-create consume_discovery_quota (005) and consume_analysis_quota (015) from their previous
-- definitions, drop get_commercial_usage() and prospectos_private.enforce_plan_limit(), and restore the
-- plan check to ('BETA','INTERNAL') once no PAID row exists. The added settings columns are harmless.
begin;

alter table public.account_entitlements drop constraint if exists account_entitlements_plan_check;
alter table public.account_entitlements add constraint account_entitlements_plan_check check(plan in ('BETA','INTERNAL','PAID'));

alter table prospectos_private.discovery_quota_settings
 add column if not exists trial_discovery_limit int not null default 20 check(trial_discovery_limit>0),
 add column if not exists trial_analysis_limit int not null default 50 check(trial_analysis_limit>0),
 add column if not exists paid_discovery_limit int not null default 100 check(paid_discovery_limit>0),
 add column if not exists paid_analysis_limit int not null default 250 check(paid_analysis_limit>0);

-- The commercial check shared by both reservation paths. Private (no client grant): only the two
-- SECURITY DEFINER reservation functions below call it, with actor = auth.uid().
create or replace function prospectos_private.enforce_plan_limit(actor uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.account_entitlements; lim int; used int;
begin
 if actor is null or action_name not in ('discovery','analysis') then return; end if;
 select * into e from public.account_entitlements where user_id=actor;
 -- No row: the application gate (requireActiveEntitlement) already refuses the action. INTERNAL: unlimited.
 if not found or e.plan not in ('BETA','PAID') then return; end if;
 -- Outside an active window nothing can be consumed (defense in depth behind the application gate).
 if e.status<>'ACTIVE' or e.expires_at<=now() then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 select case when e.plan='PAID' then case action_name when 'discovery' then paid_discovery_limit else paid_analysis_limit end
             else case action_name when 'discovery' then trial_discovery_limit else trial_analysis_limit end end
   into lim from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage
  where user_id=actor and action=action_name and used_at>=e.starts_at and used_at<e.expires_at;
 if used>=lim then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
end $$;
revoke all on function prospectos_private.enforce_plan_limit(uuid,text) from public,anon,authenticated;

-- Same contract as 005 (member check, 'quota_exceeded' on the hourly limit, same organization lock);
-- Discovery now also takes the per-user lock, checks the plan limit and records user_id.
create or replace function prospectos_private.consume_discovery_quota(tenant uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare allowed int; used int; actor uuid := auth.uid();
begin
 perform prospectos_private.require_member(tenant);
 if action_name not in ('discovery','analysis','ai_offer') then raise exception 'Invalid quota action' using errcode='22023'; end if;
 if action_name='discovery' then
  perform pg_advisory_xact_lock(hashtextextended('discovery-user:'||coalesce(actor::text,''),0));
  perform prospectos_private.enforce_plan_limit(actor,'discovery');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':'||action_name,0));
 select case action_name when 'discovery' then runs_per_hour when 'analysis' then analyses_per_hour else ai_offer_per_hour end into allowed
 from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage
 where organization_id=tenant and action=action_name and used_at > now()-interval '1 hour';
 if used >= allowed then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) values(tenant,action_name,actor);
end $$;

-- Same contract as 015 (member check, per-user then per-organization hourly limits under two locks taken in
-- that fixed order); the plan limit is checked under the per-user lock, before anything is recorded.
create or replace function public.consume_analysis_quota(p_prospect_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare tenant uuid; actor uuid := auth.uid(); per_org int; per_user int; used int;
begin
 select organization_id into tenant from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('analysis-user:'||actor::text,0));
 perform prospectos_private.enforce_plan_limit(actor,'analysis');
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':analysis',0));
 select analyses_per_hour,analyses_per_user_per_hour into per_org,per_user from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage where user_id=actor and action='analysis' and used_at > now()-interval '1 hour';
 if used >= per_user then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 select count(*) into used from prospectos_private.discovery_quota_usage where organization_id=tenant and action='analysis' and used_at > now()-interval '1 hour';
 if used >= per_org then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) values(tenant,'analysis',actor);
end $$;

-- The caller's own counters. No parameter: the user is auth.uid(), never a value the browser supplies, so
-- nobody can read another account's usage. Pure read: calling it (page load, refresh) never consumes.
create or replace function public.get_commercial_usage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); e public.account_entitlements; s prospectos_private.discovery_quota_settings; d int; a int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into e from public.account_entitlements where user_id=actor;
 if not found then return jsonb_build_object('plan',null); end if;
 if e.plan='INTERNAL' then return jsonb_build_object('plan','INTERNAL','status',e.status); end if;
 select * into s from prospectos_private.discovery_quota_settings where singleton;
 select count(*) filter(where action='discovery'),count(*) filter(where action='analysis') into d,a
  from prospectos_private.discovery_quota_usage where user_id=actor and used_at>=e.starts_at and used_at<e.expires_at;
 return jsonb_build_object(
  'plan',e.plan,'status',e.status,'period_start',e.starts_at,'period_end',e.expires_at,
  'active',e.status='ACTIVE' and e.expires_at>now(),
  'discovery_used',d,'discovery_limit',case when e.plan='PAID' then s.paid_discovery_limit else s.trial_discovery_limit end,
  'analysis_used',a,'analysis_limit',case when e.plan='PAID' then s.paid_analysis_limit else s.trial_analysis_limit end);
end $$;
revoke all on function public.get_commercial_usage() from public,anon;
grant execute on function public.get_commercial_usage() to authenticated;

commit;
