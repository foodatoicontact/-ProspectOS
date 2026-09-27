-- ProspectOS Bêta commercial quotas (49 € HT / month, 7-day free trial). Additive: no table is created,
-- no row is deleted, no RLS policy is changed, and every existing hourly protection stays exactly in place.
--
-- 1. Plans. account_entitlements.plan also allows 'PAID' — the ProspectOS Bêta subscription. A PAID row
--    stores its CURRENT billing period in the columns that already exist: starts_at = period start,
--    expires_at = period end (the reset date). Renewing a period means moving both forward — done later by
--    the payment integration (not part of this migration: no Stripe code exists yet). BETA stays the 7-day
--    trial ([starts_at, expires_at) = the trial itself); INTERNAL stays unlimited.
-- 2. Limits. Six operator-tunable settings next to the existing hourly ones (private schema, no client
--    grant): trial 20 Discovery / 50 site analyses / 5 AI offer analyses, paid 100 / 250 / 25 per period.
-- 3. Counting. The existing append-only prospectos_private.discovery_quota_usage log is the source of truth.
--    Commercial quotas are counted PER USER (the entitlement holder) inside the current window: migration
--    015 notes any authenticated user can create organizations, so a per-organization count could be
--    multiplied. Analysis rows already carry user_id (015); Discovery and AI offer rows now record it too.
--    Rows written before this migration have no user_id and are not counted (never more restrictive).
--    Technical rate limit ≠ commercial quota: every reservation stays in the log and keeps counting for the
--    hourly anti-abuse limits exactly as before; the new `billable` flag only decides what the customer is
--    charged against the plan. Not billable: a fixture/TEST Discovery (no provider call, no cost), and a
--    site or offer analysis released by the server because it produced no result (see 6).
-- 4. Enforcement. A launch is counted only where it is already reserved today — start_discovery (via
--    consume_discovery_quota) and consume_analysis_quota — inside the same transaction and under a
--    per-user advisory lock, so parallel requests can never both take the last unit. Reading pages, history,
--    reviewing proofs, changing a status or exporting never reach these functions and never count.
--    A refusal raises 'plan_limit_reached' (distinct from the hourly 'quota_exceeded'); nothing is billed
--    beyond the quota — there is no overage.
-- 5. get_commercial_usage(): the caller's own plan, window and counters, derived from auth.uid() only.
-- 6. release_commercial_use(): SERVER ONLY (service_role). A site analysis whose fetch failed before any
--    result, or an offer analysis stopped before the AI provider was called, gives its commercial unit back.
--    Never callable by a member (who could otherwise refund successful work); never touches the hourly log.
-- 7. AI offer analysis idempotence: reserve_offer_analysis() reuses a finished identical analysis (same
--    user, project and text hash) without consuming or calling the AI, refuses a duplicate while the first
--    is still running, and otherwise reserves one unit. complete/abandon close the reservation.
--
-- Rollback: re-create start_discovery (002), consume_discovery_quota (005) and consume_analysis_quota (015)
-- from their previous definitions; drop consume_discovery_quota(uuid,text,boolean), get_commercial_usage(),
-- release_commercial_use(), reserve/complete/abandon_offer_analysis(), enforce_plan_limit() and
-- prospectos_private.offer_analyses; restore the plan check to ('BETA','INTERNAL') once no PAID row exists.
-- The added columns are harmless.
begin;

alter table public.account_entitlements drop constraint if exists account_entitlements_plan_check;
alter table public.account_entitlements add constraint account_entitlements_plan_check check(plan in ('BETA','INTERNAL','PAID'));

alter table prospectos_private.discovery_quota_settings
 add column if not exists trial_discovery_limit int not null default 20 check(trial_discovery_limit>0),
 add column if not exists trial_analysis_limit int not null default 50 check(trial_analysis_limit>0),
 add column if not exists paid_discovery_limit int not null default 100 check(paid_discovery_limit>0),
 add column if not exists paid_analysis_limit int not null default 250 check(paid_analysis_limit>0),
 add column if not exists trial_ai_offer_limit int not null default 5 check(trial_ai_offer_limit>0),
 add column if not exists paid_ai_offer_limit int not null default 25 check(paid_ai_offer_limit>0);
alter table prospectos_private.discovery_quota_usage add column if not exists billable boolean not null default true;

-- The commercial check shared by both reservation paths. Private (no client grant): only the two
-- SECURITY DEFINER reservation functions below call it, with actor = auth.uid().
create or replace function prospectos_private.enforce_plan_limit(actor uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.account_entitlements; lim int; used int;
begin
 if actor is null or action_name not in ('discovery','analysis','ai_offer') then return; end if;
 select * into e from public.account_entitlements where user_id=actor;
 -- No row: the application gate (requireActiveEntitlement) already refuses the action. INTERNAL: unlimited.
 if not found or e.plan not in ('BETA','PAID') then return; end if;
 -- Outside an active window nothing can be consumed (defense in depth behind the application gate).
 if e.status<>'ACTIVE' or e.expires_at<=now() then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 select case when e.plan='PAID' then case action_name when 'discovery' then paid_discovery_limit when 'analysis' then paid_analysis_limit else paid_ai_offer_limit end
             else case action_name when 'discovery' then trial_discovery_limit when 'analysis' then trial_analysis_limit else trial_ai_offer_limit end end
   into lim from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage
  where user_id=actor and action=action_name and billable and used_at>=e.starts_at and used_at<e.expires_at;
 -- The AI offer analysis has its own message ('offer_limit_reached'); Discovery and site analyses share one.
 if used>=lim then raise exception '%', case action_name when 'ai_offer' then 'offer_limit_reached' else 'plan_limit_reached' end using errcode='P0001'; end if;
end $$;
revoke all on function prospectos_private.enforce_plan_limit(uuid,text) from public,anon,authenticated;

-- Same contract as 005 (member check, 'quota_exceeded' on the hourly limit, same organization lock);
-- Discovery and the AI offer analysis now also take a per-user lock, check the plan limit when the use is
-- billable, and record user_id. A non-billable use (fixture Discovery) is still hourly-limited and logged.
create or replace function prospectos_private.consume_discovery_quota(tenant uuid, action_name text, is_billable boolean) returns void
language plpgsql security definer set search_path='' as $$
declare allowed int; used int; actor uuid := auth.uid();
begin
 perform prospectos_private.require_member(tenant);
 if action_name not in ('discovery','analysis','ai_offer') then raise exception 'Invalid quota action' using errcode='22023'; end if;
 if action_name in ('discovery','ai_offer') then
  perform pg_advisory_xact_lock(hashtextextended(action_name||'-user:'||coalesce(actor::text,''),0));
  if is_billable then perform prospectos_private.enforce_plan_limit(actor,action_name); end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':'||action_name,0));
 select case action_name when 'discovery' then runs_per_hour when 'analysis' then analyses_per_hour else ai_offer_per_hour end into allowed
 from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage
 where organization_id=tenant and action=action_name and used_at > now()-interval '1 hour';
 if used >= allowed then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id,billable) values(tenant,action_name,actor,is_billable);
end $$;
revoke all on function prospectos_private.consume_discovery_quota(uuid,text,boolean) from public,anon,authenticated;
-- Every existing caller (consume_ai_offer_quota, 005) keeps its two-argument call: always billable.
create or replace function prospectos_private.consume_discovery_quota(tenant uuid, action_name text) returns void
language sql security definer set search_path='' as $$ select prospectos_private.consume_discovery_quota(tenant,action_name,true) $$;

-- Same body as 002; only the reservation line changes: a fixture/TEST run (no provider request, no cost) is
-- hourly-limited as before but never charged to the customer's plan. The provider recorded here is the one
-- the server executes (DiscoveryService passes provider.id), never a free label.
create or replace function public.start_discovery(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; cap int; row public.discovery_runs;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if length(trim(coalesce(p_query,''))) not between 2 and 250 or length(trim(coalesce(p_location,''))) not between 2 and 120 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if p_provider not in ('fixture','brave') or p_max_results is null or p_max_results<1 or p_max_results>100 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if jsonb_typeof(p_categories)<>'array' or jsonb_array_length(p_categories)>12 or jsonb_typeof(coalesce(p_filters,'{}'))<>'object' then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_categories) x where length(trim(x)) not between 1 and 60) then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 select max_results into cap from prospectos_private.discovery_quota_settings where singleton;
 if p_max_results>cap then raise exception 'max_results_exceeded' using errcode='P0001'; end if;
 perform prospectos_private.consume_discovery_quota(tenant,'discovery',p_provider<>'fixture');
 insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider,filters_json)
 values(tenant,p_project_id,trim(p_query),trim(p_location),p_categories,p_provider,coalesce(p_filters,'{}')||jsonb_build_object('max_results',p_max_results)) returning * into row;
 return to_jsonb(row);
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
declare actor uuid := auth.uid(); e public.account_entitlements; s prospectos_private.discovery_quota_settings; d int; a int; o int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into e from public.account_entitlements where user_id=actor;
 if not found then return jsonb_build_object('plan',null); end if;
 if e.plan='INTERNAL' then return jsonb_build_object('plan','INTERNAL','status',e.status); end if;
 select * into s from prospectos_private.discovery_quota_settings where singleton;
 select count(*) filter(where action='discovery'),count(*) filter(where action='analysis'),count(*) filter(where action='ai_offer') into d,a,o
  from prospectos_private.discovery_quota_usage where user_id=actor and billable and used_at>=e.starts_at and used_at<e.expires_at;
 return jsonb_build_object(
  'plan',e.plan,'status',e.status,'period_start',e.starts_at,'period_end',e.expires_at,
  'active',e.status='ACTIVE' and e.expires_at>now(),
  'discovery_used',d,'discovery_limit',case when e.plan='PAID' then s.paid_discovery_limit else s.trial_discovery_limit end,
  'analysis_used',a,'analysis_limit',case when e.plan='PAID' then s.paid_analysis_limit else s.trial_analysis_limit end,
  'ai_offer_used',o,'ai_offer_limit',case when e.plan='PAID' then s.paid_ai_offer_limit else s.trial_ai_offer_limit end);
end $$;
revoke all on function public.get_commercial_usage() from public,anon;
grant execute on function public.get_commercial_usage() to authenticated;

-- Server-only refund of ONE commercial unit (never the hourly log): the newest billable use of that action by
-- that user in the last 15 minutes. Called by the API with its privileged client, only after it observed that
-- the reserved work produced no result (site fetch failed, offer analysis stopped before the AI call).
create or replace function public.release_commercial_use(p_user_id uuid, p_action text) returns boolean
language plpgsql security definer set search_path='' as $$
declare target bigint;
begin
 if p_user_id is null or p_action is null or p_action not in ('analysis','ai_offer') then raise exception 'Invalid release' using errcode='22023'; end if;
 select id into target from prospectos_private.discovery_quota_usage
  where user_id=p_user_id and action=p_action and billable and used_at>now()-interval '15 minutes'
  order by used_at desc, id desc limit 1 for update;
 if target is null then return false; end if;
 update prospectos_private.discovery_quota_usage set billable=false where id=target;
 return true;
end $$;
revoke all on function public.release_commercial_use(uuid,text) from public,anon,authenticated;
grant execute on function public.release_commercial_use(uuid,text) to service_role;

-- AI offer analysis idempotence. One row per (user, project, text hash): PENDING while the AI call runs,
-- DONE with its result afterwards. Private table, reached only through the three functions below, each
-- scoped to auth.uid() and to a project the caller is a member of.
create table if not exists prospectos_private.offer_analyses (
 user_id uuid not null,
 project_id uuid not null references public.projects(id) on delete cascade,
 text_hash text not null check(text_hash ~ '^[0-9a-f]{64}$'),
 status text not null check(status in ('PENDING','DONE')),
 result jsonb check(result is null or pg_column_size(result)<65536),
 updated_at timestamptz not null default now(),
 primary key(user_id,project_id,text_hash)
);
revoke all on prospectos_private.offer_analyses from public,anon,authenticated;

-- {cached: result} for a finished identical analysis of the last 24 hours (no unit, no AI call);
-- 'offer_analysis_in_progress' while an identical one started less than 2 minutes ago; otherwise one unit is
-- reserved (hourly + commercial limits, through consume_ai_offer_quota) and {reserved: true} is returned.
create or replace function public.reserve_offer_analysis(p_project_id uuid, p_text_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); tenant uuid; r prospectos_private.offer_analyses;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_text_hash is null or p_text_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid text hash' using errcode='22023'; end if;
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('offer:'||actor::text||':'||p_project_id::text||':'||p_text_hash,0));
 select * into r from prospectos_private.offer_analyses where user_id=actor and project_id=p_project_id and text_hash=p_text_hash;
 if found and r.status='DONE' and r.updated_at>now()-interval '24 hours' then return jsonb_build_object('cached',r.result); end if;
 if found and r.status='PENDING' and r.updated_at>now()-interval '2 minutes' then raise exception 'offer_analysis_in_progress' using errcode='P0001'; end if;
 perform public.consume_ai_offer_quota(p_project_id);
 insert into prospectos_private.offer_analyses(user_id,project_id,text_hash,status,result,updated_at) values(actor,p_project_id,p_text_hash,'PENDING',null,now())
 on conflict (user_id,project_id,text_hash) do update set status='PENDING',result=null,updated_at=now();
 delete from prospectos_private.offer_analyses where user_id=actor and updated_at<now()-interval '7 days';
 return jsonb_build_object('reserved',true);
end $$;
create or replace function public.complete_offer_analysis(p_project_id uuid, p_text_hash text, p_result jsonb) returns void
language sql security definer set search_path='' as $$
 update prospectos_private.offer_analyses set status='DONE',result=p_result,updated_at=now()
 where user_id=auth.uid() and project_id=p_project_id and text_hash=p_text_hash and status='PENDING';
$$;
-- Clears the caller's own PENDING reservation after a failure so an identical retry can run. Never refunds.
create or replace function public.abandon_offer_analysis(p_project_id uuid, p_text_hash text) returns void
language sql security definer set search_path='' as $$
 delete from prospectos_private.offer_analyses
 where user_id=auth.uid() and project_id=p_project_id and text_hash=p_text_hash and status='PENDING';
$$;
revoke all on function public.reserve_offer_analysis(uuid,text),public.complete_offer_analysis(uuid,text,jsonb),public.abandon_offer_analysis(uuid,text) from public,anon;
grant execute on function public.reserve_offer_analysis(uuid,text),public.complete_offer_analysis(uuid,text,jsonb),public.abandon_offer_analysis(uuid,text) to authenticated;

commit;
