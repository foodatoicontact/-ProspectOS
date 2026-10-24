-- ============================================================================================================
-- REPAIR (documentary, idempotent) — Production Discovery legacy drift
-- ============================================================================================================
-- STATUS: ALREADY APPLIED IN PRODUCTION on 2026-10-18 as the Supabase migration
--   version 20261018143445, name repair_discovery_legacy_drift (supabase_migrations.schema_migrations).
-- DO NOT REPLAY IT IN PRODUCTION. This file is the exact record of what was applied (the SQL below is copied
-- verbatim from that ledger row), kept in the repository so the schema history is complete. It is NOT a normal
-- migration: it is not in db/migrations/, no migration runner picks it up, and Preview / staging / a fresh database
-- never need it (they get the canonical schema from db/migrations/001–003).
--
-- WHY. Historical Production never recorded migrations 001–003 in its ledger (it starts at 004): its Discovery
-- tables were created by an earlier, looser script and drifted from the canonical db/migrations/002_discovery.sql:
--  - authenticated could INSERT directly into discovery_runs and prospect_observations (policies
--    discovery_runs_insert, prospect_observations_insert), bypassing the server / RPC trust boundary;
--  - several Discovery columns had nullable or defaulted definitions instead of the canonical NOT NULL / no default;
--  - canonical CHECK constraints, the composite tenant foreign keys (project + organization) and two tenant indexes
--    of 002 were missing or looser.
--
-- WHAT IT DOES (all inside one transaction):
--  1. Read-only guards on the existing data: the repair raises and changes nothing if any existing row would violate
--     a canonical 002 invariant (query / location lengths, nulls, result_count, company name, URLs, result/run and
--     result/prospect tenant consistency) or if prospects_id_project_org_uq is missing.
--  2. Security: REVOKE INSERT ON discovery_runs / prospect_observations FROM authenticated; DROP POLICY IF EXISTS
--     discovery_runs_insert, prospect_observations_insert.
--  3. Column alignment with 002: discovery_runs.location NOT NULL, discovery_runs.started_at NOT NULL,
--     discovery_runs.provider and discovery_results.provider without default.
--  4. Canonical 002 constraints, added NOT VALID then VALIDATED (only when absent; discovery_runs_query_check is
--     replaced by its canonical definition): discovery_runs_query_check, discovery_runs_location_check,
--     discovery_runs_result_count_check, discovery_runs_id_project_id_organization_id_key (unique),
--     discovery_results_company_name_check, discovery_results_source_url_check, discovery_results_website_check.
--  5. Composite tenant foreign keys (project + organization), added NOT VALID then VALIDATED:
--     discovery_results → discovery_runs, discovery_results.duplicate_of → prospects,
--     discovery_results.prospect_id → prospects.
--  6. Indexes (IF NOT EXISTS): discovery_runs_tenant_started_idx, prospect_observations_tenant_created_idx.
--     Legacy indexes are kept.
--
-- DELIBERATELY NOT DONE:
--  - discovery_usage and the legacy columns are NOT dropped (still present in Production; removing them is a separate
--    decision);
--  - discovery_runs_id_project_org_uq is NOT dropped: foreign keys currently depend on it (it now coexists with the
--    canonical discovery_runs_id_project_id_organization_id_key);
--  - no business data was modified: no INSERT, UPDATE or DELETE of any row — only privileges, policies, column
--    definitions, constraints and indexes.
--
-- IDEMPOTENCE. Re-running it on an already repaired database is a no-op in effect (guards pass, REVOKE / DROP IF
-- EXISTS / IF NOT EXISTS / validated constraints), except that discovery_runs_query_check is dropped and re-created
-- with the same definition. Still: do not replay it in Production.
-- ============================================================================================================
-- SQL APPLIED — verbatim copy of supabase_migrations.schema_migrations.statements[1] for version 20261018143445
-- (md5 af0a3fffd45cd9cd09d91e6bc0f86bb2, 8027 bytes: the text between the two markers below, markers excluded).
-- >>> BEGIN APPLIED SQL
begin;

-- Guard: refuse to repair if Production contains rows that violate the canonical
-- db/migrations/002_discovery.sql invariants.
do $$
begin
  if exists (
    select 1 from public.discovery_runs
    where length(trim(query)) < 2 or length(trim(query)) > 250
  ) then raise exception 'repair aborted: discovery_runs.query violates canonical length';
  end if;

  if exists (
    select 1 from public.discovery_runs
    where location is null or length(trim(location)) < 2 or length(trim(location)) > 120
  ) then raise exception 'repair aborted: discovery_runs.location violates canonical invariant';
  end if;

  if exists (
    select 1 from public.discovery_runs
    where provider is null or started_at is null or result_count < 0
  ) then raise exception 'repair aborted: discovery_runs null/negative canonical invariant';
  end if;

  if exists (
    select 1 from public.discovery_results
    where length(trim(company_name)) < 1 or length(trim(company_name)) > 200
       or source_url !~ '^https?://[^[:space:]]+$'
       or (website is not null and website !~ '^https?://[^[:space:]]+$')
  ) then raise exception 'repair aborted: discovery_results canonical checks would fail';
  end if;

  if exists (
    select 1
    from public.discovery_results r
    join public.discovery_runs d on d.id = r.discovery_run_id
    where r.project_id <> d.project_id or r.organization_id <> d.organization_id
  ) then raise exception 'repair aborted: discovery result/run tenant mismatch';
  end if;

  if exists (
    select 1
    from public.discovery_results r
    join public.prospects p on p.id = r.prospect_id
    where r.prospect_id is not null
      and (r.project_id <> p.project_id or r.organization_id <> p.organization_id)
  ) then raise exception 'repair aborted: discovery result/prospect tenant mismatch';
  end if;

  if exists (
    select 1
    from public.discovery_results r
    join public.prospects p on p.id = r.duplicate_of
    where r.duplicate_of is not null
      and (r.project_id <> p.project_id or r.organization_id <> p.organization_id)
  ) then raise exception 'repair aborted: discovery duplicate/prospect tenant mismatch';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.prospects'::regclass
      and contype='u'
      and conname='prospects_id_project_org_uq'
  ) then raise exception 'repair aborted: prospects_id_project_org_uq missing';
  end if;
end $$;

-- Security drift: these direct authenticated INSERT paths are not in the
-- canonical 002 schema and bypass the intended server/RPC trust boundary.
revoke insert on public.discovery_runs from authenticated;
revoke insert on public.prospect_observations from authenticated;
drop policy if exists discovery_runs_insert on public.discovery_runs;
drop policy if exists prospect_observations_insert on public.prospect_observations;

-- Canonical column invariants. Existing rows were checked above.
alter table public.discovery_runs
  alter column location set not null,
  alter column provider drop default,
  alter column started_at set not null;

alter table public.discovery_results
  alter column provider drop default;

-- Tighten legacy checks to the canonical 002 definitions.
alter table public.discovery_runs
  drop constraint if exists discovery_runs_query_check;
alter table public.discovery_runs
  add constraint discovery_runs_query_check
  check (length(trim(query)) between 2 and 250) not valid;
alter table public.discovery_runs validate constraint discovery_runs_query_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_runs'::regclass and conname='discovery_runs_location_check') then
    alter table public.discovery_runs
      add constraint discovery_runs_location_check
      check (length(trim(location)) between 2 and 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_runs'::regclass and conname='discovery_runs_result_count_check') then
    alter table public.discovery_runs
      add constraint discovery_runs_result_count_check
      check (result_count >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_runs'::regclass and conname='discovery_runs_id_project_id_organization_id_key') then
    alter table public.discovery_runs
      add constraint discovery_runs_id_project_id_organization_id_key
      unique (id, project_id, organization_id);
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.discovery_results'::regclass and conname='discovery_results_company_name_check') then
    alter table public.discovery_results
      add constraint discovery_results_company_name_check
      check (length(trim(company_name)) between 1 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_results'::regclass and conname='discovery_results_source_url_check') then
    alter table public.discovery_results
      add constraint discovery_results_source_url_check
      check (source_url ~ '^https?://[^[:space:]]+$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_results'::regclass and conname='discovery_results_website_check') then
    alter table public.discovery_results
      add constraint discovery_results_website_check
      check (website is null or website ~ '^https?://[^[:space:]]+$') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.discovery_results'::regclass and conname='discovery_results_discovery_run_id_project_id_organization_fkey') then
    alter table public.discovery_results
      add constraint discovery_results_discovery_run_id_project_id_organization_fkey
      foreign key (discovery_run_id, project_id, organization_id)
      references public.discovery_runs(id, project_id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_results'::regclass and conname='discovery_results_duplicate_of_project_id_organization_id_fkey') then
    alter table public.discovery_results
      add constraint discovery_results_duplicate_of_project_id_organization_id_fkey
      foreign key (duplicate_of, project_id, organization_id)
      references public.prospects(id, project_id, organization_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.discovery_results'::regclass and conname='discovery_results_prospect_id_project_id_organization_id_fkey') then
    alter table public.discovery_results
      add constraint discovery_results_prospect_id_project_id_organization_id_fkey
      foreign key (prospect_id, project_id, organization_id)
      references public.prospects(id, project_id, organization_id) not valid;
  end if;
end $$;

alter table public.discovery_runs validate constraint discovery_runs_location_check;
alter table public.discovery_runs validate constraint discovery_runs_result_count_check;
alter table public.discovery_results validate constraint discovery_results_company_name_check;
alter table public.discovery_results validate constraint discovery_results_source_url_check;
alter table public.discovery_results validate constraint discovery_results_website_check;
alter table public.discovery_results validate constraint discovery_results_discovery_run_id_project_id_organization_fkey;
alter table public.discovery_results validate constraint discovery_results_duplicate_of_project_id_organization_id_fkey;
alter table public.discovery_results validate constraint discovery_results_prospect_id_project_id_organization_id_fkey;

-- Add canonical-order indexes without dropping legacy indexes yet.
create index if not exists discovery_runs_tenant_started_idx
  on public.discovery_runs(organization_id, project_id, started_at desc);
create index if not exists prospect_observations_tenant_created_idx
  on public.prospect_observations(organization_id, prospect_id, created_at desc);

commit;
-- <<< END APPLIED SQL
