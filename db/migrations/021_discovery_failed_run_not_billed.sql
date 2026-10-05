-- A Discovery run whose source answered NO request is not billed (product decision, 2026-10-05).
--
-- Until now a launch consumed one Discovery unit in start_discovery, whatever happened next. A run that fails
-- because its source never answered (register or search API down, every request refused) delivered nothing,
-- so its unit is given back. A run that delivered results — even incomplete ones — stays billed.
--
-- 1. discovery_quota_usage.discovery_run_id: the run a discovery unit was consumed for. start_discovery sets it in
--    the same transaction (body of 019 + one update). Older rows stay null (never released). No foreign key: the
--    usage log outlives deleted projects and runs, exactly like before.
-- 2. release_failed_discovery(run): SERVER ONLY (service_role, like release_commercial_use in 016). Marks that
--    run's unit billable=false if — and only if — the run is failed. The row stays in the log, so the hourly
--    anti-abuse limits are unchanged. Idempotent: a second call returns false. The server calls it only when the
--    provider report shows that no request was answered (src/discovery/services.ts).
--
-- Rollback: re-create start_discovery from 019; drop function public.release_failed_discovery(uuid);
-- alter table prospectos_private.discovery_quota_usage drop column discovery_run_id.
begin;

alter table prospectos_private.discovery_quota_usage add column if not exists discovery_run_id uuid;
create index if not exists discovery_quota_usage_run_idx on prospectos_private.discovery_quota_usage(discovery_run_id) where discovery_run_id is not null;

create or replace function public.start_discovery(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; cap int; row public.discovery_runs;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if length(trim(coalesce(p_query,''))) not between 2 and 250 or length(trim(coalesce(p_location,''))) not between 2 and 120 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if p_provider not in ('fixture','brave','registry') or p_max_results is null or p_max_results<1 or p_max_results>100 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if jsonb_typeof(p_categories)<>'array' or jsonb_array_length(p_categories)>12 or jsonb_typeof(coalesce(p_filters,'{}'))<>'object' then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_categories) x where length(trim(x)) not between 1 and 60) then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 select max_results into cap from prospectos_private.discovery_quota_settings where singleton;
 if p_max_results>cap then raise exception 'max_results_exceeded' using errcode='P0001'; end if;
 perform prospectos_private.consume_discovery_quota(tenant,'discovery',p_provider<>'fixture');
 insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider,filters_json)
 values(tenant,p_project_id,trim(p_query),trim(p_location),p_categories,p_provider,coalesce(p_filters,'{}')||jsonb_build_object('max_results',p_max_results)) returning * into row;
 -- 021: tie this launch's quota unit (inserted just above by consume_discovery_quota, same transaction, so the
 -- same now() and the same actor) to its run, so a run that got no answer can give back exactly its own unit.
 update prospectos_private.discovery_quota_usage set discovery_run_id=row.id
  where id=(select id from prospectos_private.discovery_quota_usage
   where user_id=auth.uid() and action='discovery' and discovery_run_id is null and used_at=now() order by id desc limit 1);
 return to_jsonb(row);
end $$;

create or replace function public.release_failed_discovery(p_run_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare released int;
begin
 if p_run_id is null then return false; end if;
 update prospectos_private.discovery_quota_usage u set billable=false
  where u.discovery_run_id=p_run_id and u.action='discovery' and u.billable
   and exists(select 1 from public.discovery_runs r where r.id=p_run_id and r.status='failed');
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_failed_discovery(uuid) from public,anon,authenticated;
grant execute on function public.release_failed_discovery(uuid) to service_role;

commit;
