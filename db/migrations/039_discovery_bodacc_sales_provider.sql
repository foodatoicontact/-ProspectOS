-- 039 — Discovery provider 'bodacc_sales': recent business purchases (reprises) published in the BODACC, family
-- « Ventes et cessions », as a DISCOVERY source (src/discovery/providers/bodacc-sales.ts).
--
-- Why: a company that has just bought a business (fonds de commerce, établissement) reviews its contracts, suppliers
-- and tools — a concrete, dated, public reason to be contacted. discovery_runs.provider, discovery_results.provider
-- and start_discovery (021) only accept 'fixture', 'brave' and 'registry': a run with this provider was refused.
--
-- What changes, and nothing else:
--  1. the two provider check constraints also accept 'bodacc_sales';
--  2. start_discovery: the body of 021, with 'bodacc_sales' added to the accepted providers. Quota unchanged: a launch
--     consumes ONE billable Discovery, like the register (a free source never bypasses the Discovery quota), and is
--     given back by release_failed_discovery (021) when the BODACC answered no request;
--  3. run_reusable (022): a reprise search is never served from a teammate's earlier run — announcements are
--     published every day, a 7-day-old answer would hide the newest ones. start_reused_discovery is unchanged (it
--     keeps refusing any provider other than 'brave' and 'registry').
-- RLS, tenant checks (require_member), hourly and plan limits, save_discovery_results (provider copied from the run
-- row, 014) and every other object are untouched. Idempotent: re-running it changes nothing.
--
-- A BODACC notice identifies the BUYING company (legal entities only — a sole trader's notice is never kept, it names
-- a person) and dates the purchase; it is never evidence, never VERIFIED and never scored: that is enforced in the
-- application. Each candidate keeps the official notice URL as its source.
--
-- Rollback (only once no row uses 'bodacc_sales' — delete or archive those runs/results first, otherwise the restored
-- constraints fail): restore both constraints with ('fixture','brave','registry'), re-apply start_discovery exactly as
-- defined in 021_discovery_failed_run_not_billed.sql and run_reusable exactly as defined in 022_team_pro.sql.
begin;

alter table public.discovery_runs drop constraint if exists discovery_runs_provider_check;
alter table public.discovery_runs add constraint discovery_runs_provider_check check (provider in ('fixture','brave','registry','bodacc_sales'));
alter table public.discovery_results drop constraint if exists discovery_results_provider_check;
alter table public.discovery_results add constraint discovery_results_provider_check check (provider in ('fixture','brave','registry','bodacc_sales'));

create or replace function public.start_discovery(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; cap int; row public.discovery_runs;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if length(trim(coalesce(p_query,''))) not between 2 and 250 or length(trim(coalesce(p_location,''))) not between 2 and 120 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if p_provider not in ('fixture','brave','registry','bodacc_sales') or p_max_results is null or p_max_results<1 or p_max_results>100 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
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

create or replace function prospectos_private.run_reusable(r public.discovery_runs,tenant uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select r.organization_id=tenant and r.provider=p_provider and p_provider not in ('fixture','bodacc_sales')
  and r.status='completed' and r.result_count>0
  and coalesce(nullif(r.filters_json->>'reused_from_started_at','')::timestamptz,r.started_at)>now()-interval '7 days'
  and lower(r.query)=lower(trim(p_query)) and lower(r.location)=lower(trim(p_location))
  and prospectos_private.categories_key(r.categories)=prospectos_private.categories_key(p_categories)
  and (r.filters_json->>'max_results')::int=p_max_results
  and (r.filters_json-'max_results'-'reused_from_run_id'-'reused_from_started_at'-'reused_from_user')=(coalesce(p_filters,'{}'::jsonb)-'max_results')
  and coalesce((r.metrics->>'search_requests_failed')::int,0)=0
$$;
revoke all on function prospectos_private.run_reusable(public.discovery_runs,uuid,text,text,jsonb,text,int,jsonb) from public,anon,authenticated;

commit;
