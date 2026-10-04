-- Discovery provider 'registry': the official company register (API Recherche d'entreprises,
-- annuaire-entreprises.data.gouv.fr, Licence Ouverte 2.0) as a structured DISCOVERY source.
--
-- Why: discovery_runs.provider and discovery_results.provider (002) and start_discovery (002, redefined by 016)
-- only accept 'fixture' or 'brave'; a run started with the register's provider id was refused before anything.
--
-- What changes, and nothing else:
--  1. the two provider check constraints also accept 'registry';
--  2. start_discovery: the same body as 016, with 'registry' added to the accepted providers. The quota line is
--     unchanged: consume_discovery_quota(tenant,'discovery',p_provider<>'fixture') — a register launch is a real
--     launch and consumes exactly ONE billable Discovery, like Brave (product decision: a free provider must not
--     bypass the Discovery quota). Its provider cost is 0: the server never writes a cost-ledger row for it.
-- RLS, tenant checks (require_member), hourly limits, plan limits, save_discovery_results (provider copied from
-- the run row, 014) and every other object are untouched. Idempotent: re-running it changes nothing.
--
-- A register entry identifies a company (SIREN, activity, sites, headcount band); it is never evidence, never a
-- signal and never scored — that is enforced in the application (src/discovery/providers/registry.ts).
--
-- Rollback (only once no row uses 'registry' — delete or archive those runs/results first, otherwise the
-- restored constraints fail):
--   alter table public.discovery_runs drop constraint discovery_runs_provider_check,
--     add constraint discovery_runs_provider_check check (provider in ('fixture','brave'));
--   alter table public.discovery_results drop constraint discovery_results_provider_check,
--     add constraint discovery_results_provider_check check (provider in ('fixture','brave'));
--   then re-apply start_discovery exactly as defined in 016_beta_commercial_quotas.sql.

alter table public.discovery_runs drop constraint if exists discovery_runs_provider_check;
alter table public.discovery_runs add constraint discovery_runs_provider_check check (provider in ('fixture','brave','registry'));
alter table public.discovery_results drop constraint if exists discovery_results_provider_check;
alter table public.discovery_results add constraint discovery_results_provider_check check (provider in ('fixture','brave','registry'));

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
 return to_jsonb(row);
end $$;
