-- Rollback of 041_icp_import (STAGING ONLY — docs/ICP_IMPORT_E2E.md §D). Not a migration: never applied by any runner.
-- Removes every object 041 created, in dependency order, then the staging history row so that the staging runner sees
-- 041 as not applied. Destroys the imports and the validated ICP profiles (icps.profile…): run it only on staging.
-- Verified by tests/icp-import-rollback-db.mjs: after 041 then this file, the catalogue equals the one before 041.
begin;
drop trigger if exists erase_member_icp_imports on public.memberships;
drop trigger if exists guard_icp_profile on public.icps;
drop table if exists public.icp_imports;
drop function if exists public.start_icp_import(uuid,text,text);
drop function if exists public.complete_icp_import(uuid,text,jsonb,jsonb,jsonb,int,jsonb,text);
drop function if exists public.validate_icp_import(uuid,jsonb,text,jsonb);
drop function if exists public.discard_icp_import(uuid);
drop function if exists public.delete_icp_import(uuid);
drop function if exists public.purge_icp_imports();
drop function if exists prospectos_private.erase_member_icp_imports();
drop function if exists prospectos_private.guard_icp_profile();
drop function if exists prospectos_private.guard_icp_import();
drop function if exists prospectos_private.icp_import_op();
alter table public.icps
 drop column if exists profile, drop column if exists profile_version, drop column if exists profile_import_id,
 drop column if exists projected_offer, drop column if exists projected_criteria,
 drop column if exists profile_validated_at, drop column if exists profile_validated_by;
delete from supabase_migrations.schema_migrations where name='041_icp_import';
commit;
