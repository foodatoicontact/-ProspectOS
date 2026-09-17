-- Removes the hardcoded Foodatoi fallback from save_discovery_observations.
-- A project without an ICP row no longer silently borrows FOODATOI_CRITERIA:
-- it simply has no criterion it can attach evidence to (criterion-less
-- contextual observations, e.g. a raw phone number, remain unaffected).
-- No table, RLS policy or grant changes — same function signature, replaced in place.
-- NOT applied to any live Supabase project by this change; requires explicit deployment authorization.
begin;

create or replace function public.save_discovery_observations(p_prospect_id uuid,p_observations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid; item jsonb; obs public.prospect_observations; evid uuid; result jsonb:='[]'; criteria text[]; st text; crit text; val boolean;
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant); perform pg_advisory_xact_lock(hashtextextended(p_prospect_id::text,0));
 if jsonb_typeof(p_observations)<>'array' or jsonb_array_length(p_observations)>40 then raise exception 'Invalid observations' using errcode='22023'; end if;
 select array_agg(x->>'key') into criteria from public.icps i cross join jsonb_array_elements(i.criteria) x where i.project_id=project;
 criteria := coalesce(criteria, array[]::text[]);
 for item in select value from jsonb_array_elements(p_observations) loop
  if item <> (select jsonb_object_agg(key,value) from jsonb_each(item) where key=any(array['criterion','observation_type','claim','value','status','source_url','source_title','source_excerpt','source_type','confidence','collected_at','expires_at','content_hash'])) then raise exception 'Unknown observation field' using errcode='22023'; end if;
  st:=item->>'status'; crit:=item->>'criterion'; val:=case when item->'value'='null'::jsonb then null else (item->>'value')::boolean end;
  if st not in ('OBSERVED','UNKNOWN','INFERRED','CONTRADICTED') or length(trim(coalesce(item->>'observation_type',''))) not between 1 and 60 or length(coalesce(item->>'claim',''))>1000 or
     coalesce((item->>'confidence')::double precision,-1) not between 0 and 1 or item->>'source_type' not in ('official_website','search_result','public_directory','test_fixture') or
     coalesce(item->>'source_url','') !~ '^https?://[^[:space:]]+$' or length(coalesce(item->>'source_url',''))>2048 or length(coalesce(item->>'source_title',''))>300 or length(coalesce(item->>'source_excerpt',''))>500 or
     length(coalesce(item->>'content_hash','')) not between 1 and 100 then raise exception 'Invalid observation' using errcode='22023'; end if;
  if st='UNKNOWN' then if val is not null then raise exception 'UNKNOWN requires null value' using errcode='22023'; end if;
  else
   if length(trim(coalesce(item->>'source_excerpt','')))=0 then raise exception 'Evidence fields required' using errcode='22023'; end if;
   if crit is null then
    if val is not null then raise exception 'Context observation requires null value' using errcode='22023'; end if;
   else
    if not (crit=any(criteria)) or val is null then raise exception 'Evidence fields required' using errcode='22023'; end if;
    insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at)
    values(tenant,p_prospect_id,crit,val,case when st='INFERRED' then 'INFERRED_UNCONFIRMED' else 'NOT_VERIFIED' end,item->>'source_url',item->>'source_excerpt',(item->>'collected_at')::timestamptz) returning id into evid;
   end if;
  end if;
  insert into public.prospect_observations(organization_id,prospect_id,criterion,observation_type,claim,value,status,source_url,source_title,source_excerpt,source_type,confidence,collected_at,expires_at,content_hash,evidence_id)
  values(tenant,p_prospect_id,crit,item->>'observation_type',item->>'claim',val,st,item->>'source_url',item->>'source_title',item->>'source_excerpt',item->>'source_type',(item->>'confidence')::double precision,(item->>'collected_at')::timestamptz,(item->>'expires_at')::timestamptz,item->>'content_hash',evid)
  on conflict(prospect_id,source_url,observation_type,content_hash) do update set prospect_id=excluded.prospect_id returning * into obs;
  if obs.evidence_id<>evid and evid is not null then delete from public.evidence where id=evid; end if;
  result:=result||jsonb_build_array(to_jsonb(obs)); evid:=null;
 end loop;
 return result;
end $$;
revoke all on function public.save_discovery_observations(uuid,jsonb) from public,anon;
grant execute on function public.save_discovery_observations(uuid,jsonb) to authenticated;

commit;
