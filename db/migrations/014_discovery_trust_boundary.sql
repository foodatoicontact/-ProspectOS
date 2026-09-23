-- Discovery trust boundary.
--
-- Before: discovery results (and the classification deciding whether one may become a prospect) were
-- written with the member's own JWT, and `authenticated` held INSERT/UPDATE on discovery_results — so a
-- member could forge or rewrite any row through PostgREST, and accept_discovery_result accepted any row.
--
-- After:
--  * source_class is a dedicated, constrained column — the only authority for acceptance (the jsonb
--    payloads stay as metadata only);
--  * `authenticated` can no longer INSERT or UPDATE discovery_results (SELECT under RLS is unchanged);
--  * results are written only by save_discovery_results, executable by service_role alone (the server,
--    after it authenticated the user), which re-checks the user's membership and takes the tenant from
--    the run — never from the payload;
--  * ignore is a narrow RPC (pending -> ignored, nothing else);
--  * accept_discovery_result refuses anything but source_class = 'COMPANY_CANDIDATE' before any fusion or
--    creation. Rows written before this migration keep source_class NULL (no backfill) and are refused.
begin;

alter table public.discovery_results add column source_class text
 check (source_class is null or source_class in ('COMPANY_CANDIDATE','SIGNAL_SOURCE','IRRELEVANT','UNCERTAIN'));

revoke insert, update on public.discovery_results from authenticated;
drop policy discovery_results_insert on public.discovery_results;
drop policy discovery_results_update on public.discovery_results;

-- Server-only write path. SECURITY DEFINER is required because no client role may write the table any
-- more; execution is restricted to service_role, the user identity is re-verified here (so the
-- privileged server can never write into a tenant the authenticated user does not belong to), and every
-- tenant/run/provider column is taken from the run row, not from the caller's payload.
create function public.save_discovery_results(p_user_id uuid, p_run_id uuid, p_rows jsonb)
returns setof public.discovery_results
language plpgsql security definer set search_path='' as $$
declare run public.discovery_runs; item jsonb;
begin
 if p_user_id is null then raise exception 'Authenticated user required' using errcode='42501'; end if;
 select * into run from public.discovery_runs where id=p_run_id;
 if not found then raise exception 'Discovery run not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.memberships where organization_id=run.organization_id and user_id=p_user_id) then
  raise exception 'Authenticated tenant member required' using errcode='42501';
 end if;
 if run.status<>'running' then raise exception 'Discovery run is not running' using errcode='22023'; end if;
 if jsonb_typeof(p_rows)<>'array' then raise exception 'Discovery rows must be an array' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  return query insert into public.discovery_results(organization_id,project_id,discovery_run_id,company_name,website,phone,address,city,
   source_url,source_title,provider,raw_payload,normalized_payload,dedupe_key,dedupe_status,duplicate_of,reason,source_class)
  values(run.organization_id,run.project_id,run.id,item->>'company_name',item->>'website',item->>'phone',item->>'address',item->>'city',
   item->>'source_url',coalesce(item->>'source_title',''),run.provider,coalesce(item->'raw_payload','{}'::jsonb),coalesce(item->'normalized_payload','{}'::jsonb),
   item->>'dedupe_key',item->>'dedupe_status',(item->>'duplicate_of')::uuid,item->>'reason',item->>'source_class')
  returning *;
 end loop;
end $$;
revoke all on function public.save_discovery_results(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_discovery_results(uuid,uuid,jsonb) to service_role;

-- The only state change a member may make to a result directly.
create function public.ignore_discovery_result(p_result_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.discovery_results;
begin
 select * into r from public.discovery_results where id=p_result_id for update;
 if not found then raise exception 'Discovery result not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(r.organization_id);
 if r.status<>'pending' then raise exception 'Only a pending result can be ignored' using errcode='22023'; end if;
 update public.discovery_results set status='ignored' where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.ignore_discovery_result(uuid) from public,anon;
grant execute on function public.ignore_discovery_result(uuid) to authenticated;

-- Same body as 002_discovery.sql, plus the class gate. The gate sits after the membership check and the
-- idempotent return of an already-accepted result (which creates nothing), and before any fusion into an
-- existing prospect or any creation. CREATE OR REPLACE keeps the existing EXECUTE grants.
create or replace function public.accept_discovery_result(p_result_id uuid,p_force_separate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.discovery_results; p public.prospects; chosen uuid; key text;
begin
 select * into r from public.discovery_results where id=p_result_id for update;
 if not found then raise exception 'Discovery result not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(r.organization_id);
 if r.status='ignored' then raise exception 'Ignored result cannot be accepted' using errcode='22023'; end if;
 if r.status='accepted' then select * into p from public.prospects where id=r.prospect_id and project_id=r.project_id and organization_id=r.organization_id; return to_jsonb(p); end if;
 if r.source_class is distinct from 'COMPANY_CANDIDATE' then raise exception 'CANDIDATE_NOT_ACCEPTABLE' using errcode='22023'; end if;
 if r.dedupe_status='duplicate_candidate' and r.duplicate_of is not null then
  select * into p from public.prospects where id=r.duplicate_of and project_id=r.project_id and organization_id=r.organization_id;
  if not found then raise exception 'Invalid duplicate prospect' using errcode='23503'; end if;
  update public.discovery_results set status='accepted',prospect_id=p.id where id=r.id; return to_jsonb(p);
 end if;
 if r.dedupe_status='merge_review_required' and not p_force_separate then raise exception 'merge_review_required' using errcode='P0001'; end if;
 key := case when p_force_separate then r.dedupe_key||'|separate:'||r.id::text else r.dedupe_key end;
 insert into public.prospects(organization_id,project_id,name,website,city,status,discovery_dedupe_key)
 values(r.organization_id,r.project_id,r.company_name,r.website,r.city,'À analyser',key)
 on conflict(project_id,discovery_dedupe_key) where discovery_dedupe_key is not null do nothing returning id into chosen;
 if chosen is null then select id into chosen from public.prospects where project_id=r.project_id and discovery_dedupe_key=key; end if;
 if r.phone is not null and length(trim(r.phone))>0 then insert into public.channels(organization_id,prospect_id,kind,value,source_url,verified) values(r.organization_id,chosen,'phone',trim(r.phone),r.source_url,false); end if;
 update public.discovery_results set status='accepted',prospect_id=chosen where id=r.id;
 select * into p from public.prospects where id=chosen; return to_jsonb(p);
end $$;

commit;
