-- Commercial metering/plans/entitlements engine (PR2). Strictly additive: no existing table, function,
-- grant, or RLS policy from 002/004/005 is altered in a way that changes its behavior for existing
-- callers. No Stripe code, no webhook, no secret — only the internal state ProspectOS needs to decide
-- authorization itself. Stripe will later just write into organization_subscriptions; it must never be
-- the runtime source of truth.
--
-- COMMERCIAL vs TECHNICAL QUOTAS — kept strictly separate, on purpose:
--   prospectos_private.discovery_quota_settings/usage (002) and ai_offer_per_hour (005) are HOURLY
--   technical rate limiters protecting against runaway cost/abuse, independent of any plan. They are
--   NOT touched, renamed, or reinterpreted here.
--   public.commercial_plans / organization_subscriptions / prospectos_private.commercial_usage (this
--   migration) are MONTHLY business entitlements tied to a plan (free/solo/pro/business). A single
--   commercially-metered operation (Discovery run, AI offer analysis) must pass BOTH gates before the
--   expensive work runs — see the *_metered / consume_ai_operation orchestrators below.
begin;

-- ==================================================================================================
-- A. PLANS — data-driven, never hardcoded in frontend/backend. `entitlements` is a free-form escape
-- hatch for FUTURE limits that don't yet need enforcement, so a new one can ship without a destructive
-- migration; the three metrics actually enforced in V1 stay first-class integer columns since they sit
-- on the hot path of an atomic consumption primitive (arithmetic on jsonb there would be slower and
-- harder to CHECK-constrain safely).
-- ==================================================================================================
create table if not exists public.commercial_plans (
 code text primary key check(code in ('free','solo','pro','business')),
 name text not null check(length(trim(name)) between 1 and 80),
 active boolean not null default true,
 discoveries_per_period int not null check(discoveries_per_period>=0),
 prospects_per_period int not null check(prospects_per_period>=0),
 ai_operations_per_period int not null check(ai_operations_per_period>=0),
 seats int not null check(seats>=1),
 entitlements jsonb not null default '{}' check(jsonb_typeof(entitlements)='object'),
 created_at timestamptz not null default now()
);
insert into public.commercial_plans(code,name,discoveries_per_period,prospects_per_period,ai_operations_per_period,seats) values
 ('free','Free',3,25,5,1),
 ('solo','Solo',20,250,50,1),
 ('pro','Pro',100,1500,250,3),
 ('business','Business',300,5000,1000,10)
on conflict(code) do nothing;

alter table public.commercial_plans enable row level security;
-- Plans are a global catalog, not tenant data: readable by any authenticated user, writable by none.
drop policy if exists commercial_plans_read on public.commercial_plans;
create policy commercial_plans_read on public.commercial_plans for select to authenticated using(true);
revoke all on public.commercial_plans from public,anon,authenticated;
grant select on public.commercial_plans to authenticated;

-- ==================================================================================================
-- B. ORGANIZATION SUBSCRIPTION — at most one commercial state per organization, enforced by the
-- UNIQUE(organization_id) constraint itself (not just application logic). No client-writable path
-- exists anywhere below: every column, including the plan, is set exclusively by SECURITY DEFINER
-- functions. external_* columns are nullable placeholders for a future Stripe integration; nothing
-- here depends on Stripe, calls Stripe, or stores a Stripe secret.
-- ==================================================================================================
create table if not exists public.organization_subscriptions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null unique references public.organizations(id),
 plan_code text not null references public.commercial_plans(code),
 status text not null default 'active' check(status in ('active','canceled','past_due')),
 current_period_start timestamptz not null,
 current_period_end timestamptz not null check(current_period_end>current_period_start),
 external_provider text,
 external_customer_id text,
 external_subscription_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.organization_subscriptions enable row level security;
drop policy if exists organization_subscriptions_read on public.organization_subscriptions;
create policy organization_subscriptions_read on public.organization_subscriptions for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.organization_subscriptions from public,anon,authenticated;
grant select on public.organization_subscriptions to authenticated;

-- ==================================================================================================
-- C. COMMERCIAL USAGE — private, exactly like discovery_quota_usage: never directly readable or
-- writable by anon/authenticated, only through SECURITY DEFINER functions. Usage rows are never
-- deleted or rewritten on period rollover (auditable history); the CURRENT period's consumption is
-- always computed as a time-window filter against the subscription's live current_period_start, so a
-- new period always starts at zero without touching old rows (C13).
-- ==================================================================================================
create table if not exists prospectos_private.commercial_usage (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 subscription_id uuid not null references public.organization_subscriptions(id),
 metric text not null check(metric in ('discovery','prospect','ai_operation')),
 amount int not null check(amount>0),
 used_at timestamptz not null default now()
);
create index if not exists commercial_usage_idx on prospectos_private.commercial_usage(organization_id,metric,used_at desc);
revoke all on prospectos_private.commercial_usage from public,anon,authenticated;

-- ==================================================================================================
-- D. RESOLUTION — lazy FREE creation (chosen over "create at organization creation time" so it also
-- self-heals any organization that predates this migration, with no backfill step and no window where
-- an org has no resolvable plan) + monthly rollover. The UNIQUE(organization_id) constraint plus
-- INSERT ... ON CONFLICT DO NOTHING makes the first-ever resolution race-safe without needing an
-- advisory lock: two concurrent first calls for a brand-new organization can't both insert a row: one
-- wins, the other observes the conflict and re-reads. Once the row exists, SELECT ... FOR UPDATE
-- serializes concurrent rollovers. Rollover advances current_period_start/end by whole calendar months
-- (via Postgres's own `+ interval '1 month'`, which already handles variable month lengths/DST
-- correctly) until the window covers "now", so an organization untouched for several months lands on
-- the right period in one resolution, not a stale one.
-- ==================================================================================================
create or replace function prospectos_private.resolve_active_subscription(p_tenant uuid) returns public.organization_subscriptions
language plpgsql security definer set search_path='' as $$
declare sub public.organization_subscriptions; original_start timestamptz;
begin
 select * into sub from public.organization_subscriptions where organization_id=p_tenant for update;
 if not found then
  -- date_trunc on a timestamptz truncates in the SESSION's timezone, which is not guaranteed constant
  -- across connections/poolers. Forcing UTC here makes the very first period boundary deterministic
  -- regardless of the session's `timezone` GUC — the only place this matters, since every later rollover
  -- compares timestamptz instants directly (already timezone-agnostic).
  insert into public.organization_subscriptions(organization_id,plan_code,status,current_period_start,current_period_end)
  values(p_tenant,'free','active',
   date_trunc('month',now() at time zone 'utc') at time zone 'utc',
   date_trunc('month',now() at time zone 'utc') at time zone 'utc' + interval '1 month')
  on conflict(organization_id) do nothing
  returning * into sub;
  if sub.id is null then
   select * into sub from public.organization_subscriptions where organization_id=p_tenant for update;
  end if;
 end if;
 original_start := sub.current_period_start;
 while sub.current_period_end <= now() loop
  sub.current_period_start := sub.current_period_end;
  sub.current_period_end := sub.current_period_end + interval '1 month';
 end loop;
 if sub.current_period_start <> original_start then
  update public.organization_subscriptions set current_period_start=sub.current_period_start,current_period_end=sub.current_period_end,updated_at=now() where id=sub.id;
 end if;
 return sub;
end $$;
revoke all on function prospectos_private.resolve_active_subscription(uuid) from public,anon,authenticated;

-- ==================================================================================================
-- E. ATOMIC CONSUMPTION — the one place that ever writes commercial_usage. Concurrency safety comes
-- from perform pg_advisory_xact_lock(...) keyed per (tenant, metric) BEFORE the SELECT sum: this
-- serializes every consumption attempt for the same organization+metric, so the classic
-- "SELECT usage; INSERT usage" race (two concurrent transactions both reading the same stale `used`
-- before either inserts) cannot happen — exactly the same proven pattern as
-- prospectos_private.consume_discovery_quota, applied to a second, independent counter family.
-- Partial-fill semantics: returns the number of units actually granted (0..p_amount), NEVER more than
-- the plan allows and NEVER negative. Callers decide what a partial grant means for their metric — see
-- the orchestrators below. p_amount<=0 and unknown metrics are rejected before anything is touched.
-- ==================================================================================================
create or replace function prospectos_private.consume_commercial_entitlement(p_tenant uuid,p_metric text,p_amount int) returns int
language plpgsql security definer set search_path='' as $$
declare sub public.organization_subscriptions; plan public.commercial_plans; limit_val int; used int; remaining int; granted int;
begin
 if p_amount is null or p_amount<=0 then raise exception 'Invalid amount' using errcode='22023'; end if;
 if p_metric not in ('discovery','prospect','ai_operation') then raise exception 'Invalid metric' using errcode='22023'; end if;
 perform prospectos_private.require_member(p_tenant);
 sub := prospectos_private.resolve_active_subscription(p_tenant);
 select * into plan from public.commercial_plans where code=sub.plan_code and active;
 if plan.code is null then raise exception 'Plan not found or inactive' using errcode='P0002'; end if;
 limit_val := case p_metric when 'discovery' then plan.discoveries_per_period when 'prospect' then plan.prospects_per_period else plan.ai_operations_per_period end;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':commercial:'||p_metric,0));
 select coalesce(sum(amount),0) into used from prospectos_private.commercial_usage
  where organization_id=p_tenant and metric=p_metric and used_at>=sub.current_period_start;
 remaining := greatest(limit_val-used,0);
 granted := least(p_amount,remaining);
 if granted>0 then
  insert into prospectos_private.commercial_usage(organization_id,subscription_id,metric,amount) values(p_tenant,sub.id,p_metric,granted);
 end if;
 return granted;
end $$;
revoke all on function prospectos_private.consume_commercial_entitlement(uuid,text,int) from public,anon,authenticated;

-- ==================================================================================================
-- F. ORCHESTRATORS — double guard (commercial + technical) as ONE atomic statement per operation, not
-- two independent RPCs. Because both consumptions happen inside the SAME function body with no
-- exception handler / savepoint around them, they share the SAME transaction: if the technical check
-- (inside the existing, UNCHANGED start_discovery / consume_ai_offer_quota) raises after the
-- commercial unit was already inserted, the whole transaction aborts and Postgres rolls back BOTH — the
-- commercial insert never commits. Symmetrically, if the commercial check itself refuses, the technical
-- function is never even called. There is no window where one guard's consumption is durably committed
-- while the other's failed: "consumed" and "authorized" happen atomically together, by construction —
-- no manual refund/rollback logic needed, and none is written. Order (commercial checked first) is a
-- deliberate but not load-bearing choice: it only affects which error a caller sees when both would
-- refuse (a monthly-entitlement message takes priority over an hourly-rate one), not correctness.
-- ==================================================================================================
create or replace function public.start_discovery_metered(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; granted int; result jsonb;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 granted := prospectos_private.consume_commercial_entitlement(tenant,'discovery',1);
 if granted<1 then raise exception 'commercial_entitlement_exceeded' using errcode='P0001'; end if;
 result := public.start_discovery(p_project_id,p_query,p_location,p_categories,p_provider,p_max_results,p_filters);
 return result;
end $$;
revoke all on function public.start_discovery_metered(uuid,text,text,jsonb,text,integer,jsonb) from public,anon;
grant execute on function public.start_discovery_metered(uuid,text,text,jsonb,text,integer,jsonb) to authenticated;

-- AI_OPERATION: audited mapping (see docs/COMMERCIAL_METERING.md) — the ONLY endpoint in this codebase
-- that makes a real LLM call is POST /api/v1/analyze-company (src/server/ai.ts, analyzeOffer), already
-- technically guarded by consume_ai_offer_quota (005). The Discovery per-page analysis
-- (CompanyAnalysisService.analyze_company, consume_analysis_quota) is deterministic HTML/regex
-- extraction — no LLM call — and is deliberately NOT metered as ai_operation here.
create or replace function public.consume_ai_operation(p_project_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare tenant uuid; granted int;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 granted := prospectos_private.consume_commercial_entitlement(tenant,'ai_operation',1);
 if granted<1 then raise exception 'commercial_entitlement_exceeded' using errcode='P0001'; end if;
 perform public.consume_ai_offer_quota(p_project_id);
end $$;
revoke all on function public.consume_ai_operation(uuid) from public,anon;
grant execute on function public.consume_ai_operation(uuid) to authenticated;

-- PROSPECT: no technical counterpart exists (max_results is a per-call transport cap, not a per-period
-- one) — single guard. Partial-fill: returns how many of the requested candidates may actually be
-- persisted this period, so the caller can cap its own array before inserting discovery_results and
-- never create a temporary overshoot (see docs, section "prospect limit").
create or replace function public.consume_prospect_entitlement(p_project_id uuid,p_amount int) returns int
language plpgsql security definer set search_path='' as $$
declare tenant uuid;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 return prospectos_private.consume_commercial_entitlement(tenant,'prospect',p_amount);
end $$;
revoke all on function public.consume_prospect_entitlement(uuid,int) from public,anon;
grant execute on function public.consume_prospect_entitlement(uuid,int) to authenticated;

-- ==================================================================================================
-- G. READ — powers GET /api/v1/billing/usage. Same tenant-derivation rule as every write path: only a
-- project_id is accepted, never an organization_id.
-- ==================================================================================================
create or replace function public.get_commercial_usage(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; sub public.organization_subscriptions; plan public.commercial_plans;
 used_discovery int; used_prospect int; used_ai int; seats_used int;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 sub := prospectos_private.resolve_active_subscription(tenant);
 select * into plan from public.commercial_plans where code=sub.plan_code;
 select coalesce(sum(amount),0) into used_discovery from prospectos_private.commercial_usage where organization_id=tenant and metric='discovery' and used_at>=sub.current_period_start;
 select coalesce(sum(amount),0) into used_prospect from prospectos_private.commercial_usage where organization_id=tenant and metric='prospect' and used_at>=sub.current_period_start;
 select coalesce(sum(amount),0) into used_ai from prospectos_private.commercial_usage where organization_id=tenant and metric='ai_operation' and used_at>=sub.current_period_start;
 select count(*) into seats_used from public.memberships where organization_id=tenant;
 return jsonb_build_object(
  'plan',sub.plan_code,
  'period',jsonb_build_object('start',sub.current_period_start,'end',sub.current_period_end),
  'usage',jsonb_build_object(
   'discoveries',jsonb_build_object('used',used_discovery,'limit',plan.discoveries_per_period,'remaining',greatest(plan.discoveries_per_period-used_discovery,0)),
   'prospects',jsonb_build_object('used',used_prospect,'limit',plan.prospects_per_period,'remaining',greatest(plan.prospects_per_period-used_prospect,0)),
   'ai_operations',jsonb_build_object('used',used_ai,'limit',plan.ai_operations_per_period,'remaining',greatest(plan.ai_operations_per_period-used_ai,0))
  ),
  'seats',jsonb_build_object('used',seats_used,'limit',plan.seats,'remaining',greatest(plan.seats-seats_used,0))
 );
end $$;
revoke all on function public.get_commercial_usage(uuid) from public,anon;
grant execute on function public.get_commercial_usage(uuid) to authenticated;

-- ==================================================================================================
-- H. CLOSE THE OLD DIRECT ENTRY POINTS — start_discovery and consume_ai_offer_quota remain fully
-- defined and unchanged (still exercised by tests/ai-quota-db.mjs and by the new orchestrators calling
-- them internally, which works because a SECURITY DEFINER function's internal calls run under its
-- owner's privileges, not the original caller's). But left directly grantable to `authenticated`, they
-- would let any client bypass the commercial guard entirely by calling the technical RPC straight from
-- PostgREST. Only the metered orchestrators are meant to be called by the application from now on.
-- ==================================================================================================
revoke execute on function public.start_discovery(uuid,text,text,jsonb,text,integer,jsonb) from authenticated;
revoke execute on function public.consume_ai_offer_quota(uuid) from authenticated;

commit;
