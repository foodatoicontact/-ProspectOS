-- 041 — « Importer mon entreprise » (docs/ICP_IMPORT.md): pre-fill the offer and the ICP from an existing source (a site,
-- a PDF or DOCX file, pasted text). The import is a DRAFT; nothing is used for prospecting until a person validates it.
--
-- 1. public.icp_imports — one row per import: source (URL | PDF | DOCX | TEXT — files are read in memory and never stored),
--    status PENDING → EXTRACTED | FAILED (server, after the extraction) → VALIDATED (a person, validate_icp_import) or
--    DISCARDED (a person). EXTRACTED is the draft. Members read their organization's rows (RLS); nobody writes the table
--    directly — every transition goes through one function, and a trigger refuses any other change, so VALIDATED can only
--    be reached by validate_icp_import called with a signed-in member's identity (auth.uid()), never by the server alone.
-- 2. public.icps — the validated IcpProfile (profile, profile_version, profile_import_id) and the last projection it wrote
--    into the existing model (projected_offer, projected_criteria), so a later re-import can tell what a person changed by
--    hand since. These columns are written by validate_icp_import only (trigger); criteria, weights and the scoring engine
--    are unchanged — the projection only writes the rule fields the user already edits, and only what the user accepted.
-- 3. Limits: an import that calls the AI consumes ONE unit of the existing AI offer quota (consume_ai_offer_quota: hourly
--    and plan limits), whatever the retry; at most 10 URL imports per organization over 24 hours (the dedicated site
--    authorization must not become an open crawler); one import in progress per project at a time.
--
-- Depends only on objects of migrations 001–016 (projects, icps, memberships, require_member, consume_ai_offer_quota).
-- Nothing from 038 (feat/registry-signals): the production order of 038 and 041 does not matter.
-- Rollback: drop the seven functions and two triggers below, drop table public.icp_imports, then
-- alter table public.icps drop column profile, drop column profile_version, drop column profile_import_id,
-- drop column projected_offer, drop column projected_criteria, drop column profile_validated_at, drop column profile_validated_by.
begin;

create table if not exists public.icp_imports (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 source_type text not null check(source_type in ('URL','PDF','DOCX','TEXT')),
 source_ref text not null check(length(source_ref) between 1 and 2048),
 status text not null default 'PENDING' check(status in ('PENDING','EXTRACTED','FAILED','VALIDATED','DISCARDED')),
 extracted jsonb check(extracted is null or (jsonb_typeof(extracted)='object' and length(extracted::text)<=200000)),
 missing_questions jsonb not null default '[]' check(jsonb_typeof(missing_questions)='array' and jsonb_array_length(missing_questions)<=5 and length(missing_questions::text)<=4000),
 warnings jsonb not null default '[]' check(jsonb_typeof(warnings)='array' and jsonb_array_length(warnings)<=10 and length(warnings::text)<=4000),
 token_usage int not null default 0 check(token_usage>=0),
 usage jsonb not null default '{}' check(jsonb_typeof(usage)='object' and length(usage::text)<=2000),
 error text check(error is null or error ~ '^[A-Z0-9_]{1,60}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 validated_at timestamptz,
 validated_by uuid references auth.users(id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,organization_id),
 check(status<>'EXTRACTED' or extracted is not null),
 check(status<>'FAILED' or error is not null),
 check((status='VALIDATED')=(validated_at is not null and validated_by is not null))
);
create index if not exists icp_imports_project_idx on public.icp_imports(organization_id,project_id,created_at desc);
create index if not exists icp_imports_url_day_idx on public.icp_imports(organization_id,created_at) where source_type='URL';
alter table public.icp_imports enable row level security;
drop policy if exists icp_imports_read on public.icp_imports;
create policy icp_imports_read on public.icp_imports for select to authenticated using (prospectos_private.is_member(organization_id));
revoke all on public.icp_imports from public,anon,authenticated,service_role;
grant select on public.icp_imports to authenticated;

alter table public.icps add column if not exists profile jsonb check(profile is null or (jsonb_typeof(profile)='object' and length(profile::text)<=200000));
alter table public.icps add column if not exists profile_version int check(profile_version is null or profile_version between 1 and 99);
alter table public.icps add column if not exists profile_import_id uuid;
alter table public.icps add column if not exists projected_offer text check(projected_offer is null or length(projected_offer)<=10000);
alter table public.icps add column if not exists projected_criteria jsonb check(projected_criteria is null or jsonb_typeof(projected_criteria)='array');
alter table public.icps add column if not exists profile_validated_at timestamptz;
alter table public.icps add column if not exists profile_validated_by uuid references auth.users(id);

-- The operation in progress, as set by one of the functions below for this transaction — honoured only while that
-- function runs: inside a SECURITY DEFINER function current_user is its owner, never a client role. A client that sets
-- the flag itself (set_config is callable by anyone) is still 'authenticated' / 'service_role' / 'anon', and gets ''.
create or replace function prospectos_private.icp_import_op() returns text
language sql stable security invoker set search_path='' as $$
 select case when current_user in ('authenticated','anon','service_role') then '' else coalesce(current_setting('prospectos.icp_import_op',true),'') end
$$;
revoke all on function prospectos_private.icp_import_op() from public,anon;
-- Callable by the client roles on purpose: the guards below run as them on a direct ICP save, and the answer is '' for them.
grant execute on function prospectos_private.icp_import_op() to authenticated,service_role;

-- The one gate: every change of icp_imports goes through a function below, which names its operation for this
-- transaction only. Anything else — a direct update by any role, a transition the operation does not allow — is refused.
create or replace function prospectos_private.guard_icp_import() returns trigger
language plpgsql security invoker set search_path='' as $$
declare op text:=prospectos_private.icp_import_op();
begin
 if TG_OP='DELETE' then raise exception 'icp_imports rows are never deleted' using errcode='42501'; end if;
 if TG_OP='INSERT' then
  if op<>'start' or new.status<>'PENDING' then raise exception 'icp_imports are created by start_icp_import only' using errcode='42501'; end if;
  return new;
 end if;
 if (new.id,new.organization_id,new.project_id,new.source_type,new.source_ref,new.created_by,new.created_at)
    is distinct from (old.id,old.organization_id,old.project_id,old.source_type,old.source_ref,old.created_by,old.created_at) then
  raise exception 'icp_imports identity and source are immutable' using errcode='42501';
 end if;
 if not ((op='complete' and old.status='PENDING' and new.status in ('EXTRACTED','FAILED'))
      or (op='validate' and old.status='EXTRACTED' and new.status='VALIDATED' and auth.uid() is not null and new.validated_by=auth.uid())
      or (op='discard' and old.status in ('EXTRACTED','FAILED') and new.status='DISCARDED' and auth.uid() is not null)) then
  raise exception 'icp_import transition refused' using errcode='42501';
 end if;
 new.updated_at:=now();
 return new;
end $$;
drop trigger if exists guard_icp_import on public.icp_imports;
create trigger guard_icp_import before insert or update or delete on public.icp_imports for each row execute function prospectos_private.guard_icp_import();

-- The validated profile and its projection are written by validate_icp_import only, never by a direct ICP save.
create or replace function prospectos_private.guard_icp_profile() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if prospectos_private.icp_import_op()='validate' then return new; end if;
 if TG_OP='INSERT' then
  if (new.profile,new.profile_version,new.profile_import_id,new.projected_offer,new.projected_criteria,new.profile_validated_at,new.profile_validated_by)
     is distinct from (null::jsonb,null::int,null::uuid,null::text,null::jsonb,null::timestamptz,null::uuid) then
   raise exception 'The ICP profile is written by validate_icp_import only' using errcode='42501';
  end if;
 elsif (new.profile,new.profile_version,new.profile_import_id,new.projected_offer,new.projected_criteria,new.profile_validated_at,new.profile_validated_by)
     is distinct from (old.profile,old.profile_version,old.profile_import_id,old.projected_offer,old.projected_criteria,old.profile_validated_at,old.profile_validated_by) then
  raise exception 'The ICP profile is written by validate_icp_import only' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists guard_icp_profile on public.icps;
create trigger guard_icp_profile before insert or update on public.icps for each row execute function prospectos_private.guard_icp_profile();

-- A member starts an import once the text is ready (an unreadable file never reaches this point, so it costs nothing):
-- one unit of the AI offer quota, the URL daily cap, one import in progress per project.
create or replace function public.start_icp_import(p_project_id uuid,p_source_type text,p_source_ref text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; new_id uuid; url_count int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_source_type is null or p_source_type not in ('URL','PDF','DOCX','TEXT') or p_source_ref is null or length(trim(p_source_ref)) not between 1 and 2048 then
  raise exception 'Invalid import source' using errcode='22023';
 end if;
 if p_source_type='URL' and p_source_ref !~ '^https?://[^[:space:]]+$' then raise exception 'Invalid import source' using errcode='22023'; end if;
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('icp_import:'||tenant::text,0));
 if exists(select 1 from public.icp_imports where project_id=p_project_id and status='PENDING' and created_at>now()-interval '10 minutes') then
  raise exception 'icp_import_in_progress' using errcode='P0001';
 end if;
 if p_source_type='URL' then
  select count(*) into url_count from public.icp_imports where organization_id=tenant and source_type='URL' and created_at>now()-interval '24 hours';
  if url_count>=10 then raise exception 'icp_url_daily_limit' using errcode='P0001'; end if;
 end if;
 perform public.consume_ai_offer_quota(p_project_id);
 perform set_config('prospectos.icp_import_op','start',true);
 insert into public.icp_imports(organization_id,project_id,source_type,source_ref,created_by)
 values(tenant,p_project_id,p_source_type,trim(p_source_ref),actor) returning id into new_id;
 perform set_config('prospectos.icp_import_op','',true);
 return new_id;
end $$;
revoke all on function public.start_icp_import(uuid,text,text) from public,anon;
grant execute on function public.start_icp_import(uuid,text,text) to authenticated;

-- The server records the extraction (service role only): the draft, its questions, its warnings, its real cost.
create or replace function public.complete_icp_import(p_import_id uuid,p_status text,p_extracted jsonb,p_missing jsonb,p_warnings jsonb,p_token_usage int,p_usage jsonb,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_status not in ('EXTRACTED','FAILED') then raise exception 'Invalid import status' using errcode='22023'; end if;
 perform set_config('prospectos.icp_import_op','complete',true);
 update public.icp_imports set status=p_status,
  extracted=case when p_status='EXTRACTED' then p_extracted end,
  missing_questions=coalesce(p_missing,'[]'),warnings=coalesce(p_warnings,'[]'),
  token_usage=greatest(coalesce(p_token_usage,0),0),usage=coalesce(p_usage,'{}'),
  error=case when p_status='FAILED' then p_error end
 where id=p_import_id and status='PENDING';
 get diagnostics n=row_count;
 perform set_config('prospectos.icp_import_op','',true);
 return n>0;
end $$;
revoke all on function public.complete_icp_import(uuid,text,jsonb,jsonb,jsonb,int,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_icp_import(uuid,text,jsonb,jsonb,jsonb,int,jsonb,text) to service_role;

-- A person validates the draft as they reviewed it. p_offer / p_criteria null = keep what the project has (a value the user
-- chose to keep on a re-import is never overwritten). Criteria, when given, follow the existing rules: 1 to 30, unique
-- keys, positive weights summing to 100 — the scoring engine reads them exactly as an ICP saved by hand.
create or replace function public.validate_icp_import(p_import_id uuid,p_profile jsonb,p_offer text,p_criteria jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); imp public.icp_imports; total numeric; n int; keys int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into imp from public.icp_imports where id=p_import_id for update;
 if not found then raise exception 'Import not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(imp.organization_id);
 if imp.status<>'EXTRACTED' then raise exception 'icp_import_not_reviewable' using errcode='P0001'; end if;
 if p_profile is null or jsonb_typeof(p_profile)<>'object' or length(p_profile::text)>200000 then raise exception 'Invalid profile' using errcode='22023'; end if;
 if p_offer is not null and length(p_offer)>10000 then raise exception 'Invalid offer' using errcode='22023'; end if;
 if p_criteria is not null then
  if jsonb_typeof(p_criteria)<>'array' then raise exception 'Invalid criteria' using errcode='22023'; end if;
  -- Types first: a weight that is not a number is refused before anything is summed.
  if exists(select 1 from jsonb_array_elements(p_criteria) c where jsonb_typeof(c)<>'object' or jsonb_typeof(c->'weight') is distinct from 'number'
       or coalesce(length(trim(c->>'key')),0)=0 or coalesce(length(trim(c->>'label')),0)=0) then
   raise exception 'Criteria must be unique and their weights sum to 100' using errcode='22023';
  end if;
  select count(*),count(distinct c->>'key'),coalesce(sum((c->>'weight')::numeric),0) into n,keys,total from jsonb_array_elements(p_criteria) c;
  if n not between 1 and 30 or keys<>n or abs(total-100)>0.001
     or exists(select 1 from jsonb_array_elements(p_criteria) c where (c->>'weight')::numeric<=0) then
   raise exception 'Criteria must be unique and their weights sum to 100' using errcode='22023';
  end if;
 end if;
 perform set_config('prospectos.icp_import_op','validate',true);
 update public.icp_imports set status='VALIDATED',validated_at=now(),validated_by=actor where id=p_import_id;
 insert into public.icps(organization_id,project_id,criteria,profile,profile_version,profile_import_id,projected_offer,projected_criteria,profile_validated_at,profile_validated_by)
 values(imp.organization_id,imp.project_id,coalesce(p_criteria,'[]'),p_profile,1,p_import_id,p_offer,p_criteria,now(),actor)
 on conflict(project_id) do update set
  criteria=coalesce(p_criteria,public.icps.criteria),profile=p_profile,profile_version=1,profile_import_id=p_import_id,
  projected_offer=coalesce(p_offer,public.icps.projected_offer),projected_criteria=coalesce(p_criteria,public.icps.projected_criteria),
  profile_validated_at=now(),profile_validated_by=actor;
 if p_offer is not null then update public.projects set offer=p_offer where id=imp.project_id; end if;
 perform set_config('prospectos.icp_import_op','',true);
 return jsonb_build_object('import_id',p_import_id,'status','VALIDATED','offer_written',p_offer is not null,'criteria_written',p_criteria is not null);
end $$;
revoke all on function public.validate_icp_import(uuid,jsonb,text,jsonb) from public,anon,service_role;
grant execute on function public.validate_icp_import(uuid,jsonb,text,jsonb) to authenticated;

-- A person rejects a draft (or clears a failed import). Nothing is written to the project.
create or replace function public.discard_icp_import(p_import_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare imp public.icp_imports;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into imp from public.icp_imports where id=p_import_id for update;
 if not found then raise exception 'Import not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(imp.organization_id);
 if imp.status not in ('EXTRACTED','FAILED') then return false; end if;
 perform set_config('prospectos.icp_import_op','discard',true);
 update public.icp_imports set status='DISCARDED' where id=p_import_id;
 perform set_config('prospectos.icp_import_op','',true);
 return true;
end $$;
revoke all on function public.discard_icp_import(uuid) from public,anon,service_role;
grant execute on function public.discard_icp_import(uuid) to authenticated;

commit;
