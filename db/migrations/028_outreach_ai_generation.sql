-- O1/O2 — AI outreach generation: its own unit and its own cost operation. Additive.
--
-- 1. Units. One AI attempt (Generate or Regenerate "with AI") = one unit, reserved BEFORE the provider is called by
--    public.reserve_ai_outreach (caller must be a member of the prospect's organization; the unit is counted on the
--    caller's plan subject — the team owner for a team member, as for the other plan quotas — over the entitlement
--    period, plus a per-user hourly limit). The rule-based fallback of a failed attempt belongs to that same attempt:
--    no second unit. public.finish_ai_outreach closes the attempt once, by its author, with its outcome (AI_VALID or
--    FALLBACK + reason code) and the message it produced: the audit of every attempt, valid or not.
--    Save, edit, approve and copy never reserve anything; a rule-based generation without an AI attempt neither.
-- 2. Limits are an operator decision: prospectos_private.ai_outreach_limits (plan → period limit, per-hour limit) is
--    EMPTY here. A plan without a row gets no AI attempt (ai_outreach_not_configured) — the rule-based message stays
--    available. No number is invented by this migration.
-- 3. Cost ledger: operation 'outreach_generation' (api_usage_events, provider_pricing, resolve_provider_cost). Priced
--    with the provider's existing per-token prices for the same model (migration 010): a token costs the same whatever
--    it is used for; no new price is introduced.
--
-- Rollback: drop function public.reserve_ai_outreach(uuid), public.finish_ai_outreach(uuid,text,text,uuid);
-- drop table prospectos_private.ai_outreach_usage, prospectos_private.ai_outreach_limits; delete from
-- prospectos_private.provider_pricing where operation='outreach_generation'; once no api_usage_events row uses it,
-- restore both operation checks and resolve_provider_cost from 010.
begin;

create table if not exists prospectos_private.ai_outreach_limits (
 plan text primary key check(plan in ('BETA','INTERNAL','PAID','PRO','TEAM','ENTERPRISE')),
 period_limit int not null check(period_limit>0),
 per_hour int not null check(per_hour>0),
 updated_at timestamptz not null default now()
);
revoke all on prospectos_private.ai_outreach_limits from public,anon,authenticated;

create table if not exists prospectos_private.ai_outreach_usage (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 prospect_id uuid not null,
 user_id uuid not null references auth.users(id),
 subject_id uuid not null references auth.users(id),
 outcome text check(outcome in ('AI_VALID','FALLBACK')),
 fallback_reason text check(fallback_reason is null or fallback_reason ~ '^[A-Z_]{1,60}$'),
 outreach_id uuid,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id) on delete cascade,
 check(outcome is null or finished_at is not null),
 check(outcome is distinct from 'AI_VALID' or fallback_reason is null)
);
create index if not exists ai_outreach_usage_subject_idx on prospectos_private.ai_outreach_usage(subject_id,created_at);
create index if not exists ai_outreach_usage_user_idx on prospectos_private.ai_outreach_usage(user_id,created_at);
revoke all on prospectos_private.ai_outreach_usage from public,anon,authenticated;

create or replace function public.reserve_ai_outreach(p_prospect_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; subj uuid; e public.account_entitlements; lim prospectos_private.ai_outreach_limits; used int; row_id uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select organization_id into tenant from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 select p.subject into subj from prospectos_private.plan_subject(actor) p;
 select * into e from public.account_entitlements where user_id=subj;
 -- Same access rule as get_effective_entitlement (023): a team member only rides a team / enterprise / internal plan.
 if not found or e.status<>'ACTIVE' or e.expires_at<=now() or (subj<>actor and e.plan not in ('TEAM','ENTERPRISE','INTERNAL')) then
  raise exception 'ai_outreach_not_available' using errcode='P0001';
 end if;
 select * into lim from prospectos_private.ai_outreach_limits where plan=e.plan;
 if not found then raise exception 'ai_outreach_not_configured' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-outreach:'||subj::text,0));
 select count(*) into used from prospectos_private.ai_outreach_usage where subject_id=subj and created_at>=e.starts_at and created_at<e.expires_at;
 if used>=lim.period_limit then raise exception 'ai_outreach_limit_reached' using errcode='P0001'; end if;
 select count(*) into used from prospectos_private.ai_outreach_usage where user_id=actor and created_at>now()-interval '1 hour';
 if used>=lim.per_hour then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.ai_outreach_usage(organization_id,prospect_id,user_id,subject_id) values(tenant,p_prospect_id,actor,subj) returning id into row_id;
 return row_id;
end $$;
revoke all on function public.reserve_ai_outreach(uuid) from public,anon;
grant execute on function public.reserve_ai_outreach(uuid) to authenticated;

create or replace function public.finish_ai_outreach(p_usage_id uuid, p_outcome text, p_reason text, p_outreach_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r prospectos_private.ai_outreach_usage;
begin
 select * into r from prospectos_private.ai_outreach_usage where id=p_usage_id and user_id=auth.uid() for update;
 if not found then raise exception 'AI outreach attempt not found' using errcode='P0002'; end if;
 if r.outcome is not null then raise exception 'AI outreach attempt already closed' using errcode='22023'; end if;
 if p_outcome not in ('AI_VALID','FALLBACK') or (p_outcome='AI_VALID' and p_reason is not null) or (p_reason is not null and p_reason !~ '^[A-Z_]{1,60}$') then
  raise exception 'Invalid AI outreach outcome' using errcode='22023';
 end if;
 if p_outreach_id is not null and not exists(select 1 from public.outreach o where o.id=p_outreach_id and o.organization_id=r.organization_id and o.prospect_id=r.prospect_id) then
  raise exception 'Invalid AI outreach outcome' using errcode='22023';
 end if;
 update prospectos_private.ai_outreach_usage set outcome=p_outcome,fallback_reason=p_reason,outreach_id=p_outreach_id,finished_at=now() where id=r.id returning * into r;
 return jsonb_build_object('id',r.id,'outcome',r.outcome,'fallback_reason',r.fallback_reason,'outreach_id',r.outreach_id);
end $$;
revoke all on function public.finish_ai_outreach(uuid,text,text,uuid) from public,anon;
grant execute on function public.finish_ai_outreach(uuid,text,text,uuid) to authenticated;

alter table public.api_usage_events drop constraint if exists api_usage_events_operation_check;
alter table public.api_usage_events add constraint api_usage_events_operation_check check(operation in ('search','offer_analysis','outreach_generation'));
alter table prospectos_private.provider_pricing drop constraint if exists provider_pricing_operation_check;
alter table prospectos_private.provider_pricing add constraint provider_pricing_operation_check check(operation in ('search','offer_analysis','outreach_generation'));

-- 010's body; only the accepted operations change.
create or replace function public.resolve_provider_cost(p_provider text,p_operation text,p_model text,p_quantities jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q jsonb; total bigint:=0; versions text[]:=array[]::text[]; found_price bigint; found_version text; any_priced boolean:=false;
begin
 if p_provider not in ('brave','anthropic','openai') or p_operation not in ('search','offer_analysis','outreach_generation') then raise exception 'Invalid provider/operation' using errcode='22023'; end if;
 if jsonb_typeof(p_quantities)<>'array' then raise exception 'Invalid quantities' using errcode='22023'; end if;
 for q in select value from jsonb_array_elements(p_quantities) loop
  if (q->>'quantity')::numeric <= 0 then continue; end if;
  select price_per_unit_micros,version into found_price,found_version from prospectos_private.provider_pricing
   where provider=p_provider and operation=p_operation and unit_type=(q->>'unit_type')
     and (model=p_model or model is null) and effective_from<=now() and (effective_to is null or effective_to>now())
   order by (model is null),effective_from desc limit 1;
  if not found then return null; end if;
  total := total + round(found_price * (q->>'quantity')::numeric);
  versions := array_append(versions, found_version); any_priced := true;
 end loop;
 if not any_priced then return null; end if;
 return jsonb_build_object('estimated_cost_micros',total,'pricing_version',(select string_agg(distinct v,'+' order by v) from unnest(versions) v));
end $$;
revoke all on function public.resolve_provider_cost(text,text,text,jsonb) from public,anon,authenticated;

-- The same model's existing per-token prices (010), now also listed for outreach_generation: every active
-- offer_analysis Anthropic row is copied with its own price, version and dates — nothing new is priced.
insert into prospectos_private.provider_pricing(provider,operation,model,unit_type,price_per_unit_micros,currency,version,effective_from,effective_to)
select p.provider,'outreach_generation',p.model,p.unit_type,p.price_per_unit_micros,p.currency,p.version,p.effective_from,p.effective_to
from prospectos_private.provider_pricing p
where p.provider='anthropic' and p.operation='offer_analysis'
 and not exists(select 1 from prospectos_private.provider_pricing x where x.provider=p.provider and x.operation='outreach_generation'
  and x.model is not distinct from p.model and x.unit_type=p.unit_type and x.version=p.version);

commit;
