-- Read-only snapshot of the PRODUCTION body of public.start_discovery(uuid,text,text,jsonb,text,integer,jsonb),
-- read 2026-09-27 (pg_get_functiondef; SECURITY DEFINER, SET search_path TO '', plpgsql, RETURNS jsonb, CRLF normalized).
declare
  tenant uuid;
  cap int;
  row public.discovery_runs;
begin
  select organization_id
  into tenant
  from public.projects
  where id = p_project_id;

  if tenant is null then
    raise exception 'Project not found'
      using errcode='P0002';
  end if;

  perform prospectos_private.require_member(tenant);

  if length(trim(coalesce(p_query,''))) not between 2 and 250
     or length(trim(coalesce(p_location,''))) not between 2 and 120
  then
    raise exception 'Invalid discovery input'
      using errcode='22023';
  end if;

  if p_provider not in ('fixture','brave')
     or p_max_results is null
     or p_max_results < 1
     or p_max_results > 100
  then
    raise exception 'Invalid discovery input'
      using errcode='22023';
  end if;

  if jsonb_typeof(p_categories) <> 'array'
     or jsonb_array_length(p_categories) > 12
     or jsonb_typeof(coalesce(p_filters,'{}')) <> 'object'
  then
    raise exception 'Invalid discovery input'
      using errcode='22023';
  end if;

  if exists(
    select 1
    from jsonb_array_elements_text(p_categories) x
    where length(trim(x)) not between 1 and 60
  ) then
    raise exception 'Invalid discovery input'
      using errcode='22023';
  end if;

  select max_results
  into cap
  from prospectos_private.discovery_quota_settings
  where singleton;

  if p_max_results > cap then
    raise exception 'max_results_exceeded'
      using errcode='P0001';
  end if;

  perform prospectos_private.consume_discovery_quota(
    tenant,
    'discovery'
  );

  insert into public.discovery_runs(
    organization_id,
    project_id,
    query,
    location,
    categories,
    provider,
    filters_json
  )
  values(
    tenant,
    p_project_id,
    trim(p_query),
    trim(p_location),
    p_categories,
    p_provider,
    coalesce(p_filters,'{}')
      || jsonb_build_object('max_results',p_max_results)
  )
  returning * into row;

  return to_jsonb(row);
end
