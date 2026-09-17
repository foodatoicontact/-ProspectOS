-- Technical guard for the one endpoint that makes a real, paid LLM call outside the already-quota-
-- protected Discovery pipeline: POST /api/v1/analyze-company (src/server/ai.ts, analyzeOffer). Today
-- it has no quota at all — only a body-length check — so an authenticated user (or a client bug retrying
-- in a loop) can call it an unbounded number of times, each one a real Anthropic/OpenAI request billed
-- to the operator. This migration does NOT touch pricing or billing (no plans, no per-plan limits): it
-- reuses the exact hourly-quota mechanism already proven for 'discovery' and 'analysis' actions, adding
-- a third action, 'ai_offer', on the SAME tenant-scoped, advisory-lock-protected counter.
--
-- Nothing here changes the behavior of the existing 'discovery'/'analysis' actions: the CASE branch for
-- them is untouched, only a new ai_offer_per_hour setting and a new action_name branch are added.
begin;

alter table prospectos_private.discovery_quota_settings
 add column if not exists ai_offer_per_hour int not null default 10 check(ai_offer_per_hour>0);

alter table prospectos_private.discovery_quota_usage
 drop constraint if exists discovery_quota_usage_action_check;
alter table prospectos_private.discovery_quota_usage
 add constraint discovery_quota_usage_action_check check(action in ('discovery','analysis','ai_offer'));

create or replace function prospectos_private.consume_discovery_quota(tenant uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare allowed int; used int;
begin
 perform prospectos_private.require_member(tenant);
 if action_name not in ('discovery','analysis','ai_offer') then raise exception 'Invalid quota action' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':'||action_name,0));
 select case action_name when 'discovery' then runs_per_hour when 'analysis' then analyses_per_hour else ai_offer_per_hour end into allowed
 from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage
 where organization_id=tenant and action=action_name and used_at > now()-interval '1 hour';
 if used >= allowed then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.discovery_quota_usage(organization_id,action) values(tenant,action_name);
end $$;

-- Same shape as consume_analysis_quota: the client only ever supplies a project_id it can already read
-- under RLS. The organization is derived from that project row server-side and never trusted from the
-- payload directly, then checked against real membership before a single unit of quota is consumed.
create or replace function public.consume_ai_offer_quota(p_project_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare tenant uuid;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform prospectos_private.consume_discovery_quota(tenant,'ai_offer');
end $$;
revoke all on function public.consume_ai_offer_quota(uuid) from public,anon;
grant execute on function public.consume_ai_offer_quota(uuid) to authenticated;

commit;
