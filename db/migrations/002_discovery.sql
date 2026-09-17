-- Incremental discovery engine schema. Apply after db/schema.sql.
begin;

alter table public.prospects add column discovery_dedupe_key text;
create unique index prospects_project_discovery_dedupe_key_uq
  on public.prospects(project_id, discovery_dedupe_key) where discovery_dedupe_key is not null;
alter table public.prospects add constraint prospects_id_project_org_uq unique(id,project_id,organization_id);
alter table public.evidence add constraint evidence_id_prospect_org_uq unique(id,prospect_id,organization_id);

create table public.discovery_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
 query text not null check(length(trim(query)) between 2 and 250), location text not null check(length(trim(location)) between 2 and 120),
 categories jsonb not null default '[]', provider text not null check(provider in ('fixture','brave')),
 filters_json jsonb not null default '{}', status text not null default 'running' check(status in ('running','completed','failed')),
 started_at timestamptz not null default now(), completed_at timestamptz, result_count int not null default 0 check(result_count >= 0),
 error_message text, metrics jsonb not null default '{}',
 check(jsonb_typeof(categories)='array'), check(jsonb_typeof(filters_json)='object'), check(jsonb_typeof(metrics)='object'),
 foreign key(project_id,organization_id) references public.projects(id,organization_id), unique(id,organization_id), unique(id,project_id,organization_id)
);
create table public.discovery_results (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null, discovery_run_id uuid not null,
 company_name text not null check(length(trim(company_name)) between 1 and 200), website text, phone text, address text, city text,
 source_url text not null, source_title text not null default '', provider text not null check(provider in ('fixture','brave')),
 external_id text, raw_payload jsonb not null default '{}', normalized_payload jsonb not null default '{}', dedupe_key text not null,
 dedupe_status text not null check(dedupe_status in ('unique','duplicate_candidate','merge_review_required')),
 duplicate_of uuid, status text not null default 'pending' check(status in ('pending','accepted','ignored')),
 prospect_id uuid, reason text, created_at timestamptz not null default now(),
 check(website is null or website ~ '^https?://[^[:space:]]+$'), check(source_url ~ '^https?://[^[:space:]]+$'),
 check(jsonb_typeof(raw_payload)='object'), check(jsonb_typeof(normalized_payload)='object'),
 foreign key(discovery_run_id,project_id,organization_id) references public.discovery_runs(id,project_id,organization_id),
 foreign key(duplicate_of,project_id,organization_id) references public.prospects(id,project_id,organization_id),
 foreign key(prospect_id,project_id,organization_id) references public.prospects(id,project_id,organization_id)
);
create table public.prospect_observations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, prospect_id uuid not null,
 criterion text, observation_type text not null check(length(trim(observation_type)) between 1 and 60),
 claim text not null check(length(claim)<=1000), value boolean,
 status text not null check(status in ('OBSERVED','UNKNOWN','INFERRED','CONTRADICTED')),
 source_url text not null check(source_url ~ '^https?://[^[:space:]]+$'), source_title text not null check(length(source_title)<=300),
 source_excerpt text not null check(length(source_excerpt)<=500), source_type text not null check(source_type in ('official_website','search_result','public_directory','test_fixture')),
 confidence double precision not null check(confidence between 0 and 1), collected_at timestamptz not null, expires_at timestamptz not null,
 content_hash text not null check(length(content_hash) between 1 and 100), evidence_id uuid,
 review_status text not null default 'NOT_VERIFIED' check(review_status in ('NOT_VERIFIED','VERIFIED','CONTRADICTED')), created_at timestamptz not null default now(),
 check(status <> 'UNKNOWN' or (value is null and evidence_id is null)),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id),
 foreign key(evidence_id,prospect_id,organization_id) references public.evidence(id,prospect_id,organization_id),
 unique(id,prospect_id,organization_id), unique(prospect_id,source_url,observation_type,content_hash)
);
create index discovery_runs_tenant_idx on public.discovery_runs(organization_id,project_id,started_at desc);
create index discovery_results_run_idx on public.discovery_results(organization_id,discovery_run_id);
create index prospect_observations_prospect_idx on public.prospect_observations(organization_id,prospect_id,created_at desc);

create table prospectos_private.discovery_quota_settings (
 singleton boolean primary key default true check(singleton), runs_per_hour int not null default 10 check(runs_per_hour>0),
 max_results int not null default 20 check(max_results between 1 and 100), analyses_per_hour int not null default 20 check(analyses_per_hour>0)
);
insert into prospectos_private.discovery_quota_settings(singleton) values(true);
create table prospectos_private.discovery_quota_usage (
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id),
 action text not null check(action in ('discovery','analysis')), used_at timestamptz not null default now()
);
create index discovery_quota_usage_idx on prospectos_private.discovery_quota_usage(organization_id,action,used_at desc);
revoke all on prospectos_private.discovery_quota_settings, prospectos_private.discovery_quota_usage from public,anon,authenticated;

create function prospectos_private.require_member(tenant uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.memberships where organization_id=tenant and user_id=auth.uid()) then
  raise exception 'Authenticated tenant member required' using errcode='42501';
 end if;
end $$;
revoke all on function prospectos_private.require_member(uuid) from public,anon,authenticated;

create function prospectos_private.consume_discovery_quota(tenant uuid, action_name text) returns void language plpgsql security definer set search_path='' as $$
declare allowed int; used int;
begin
 perform prospectos_private.require_member(tenant);
 if action_name not in ('discovery','analysis') then raise exception 'Invalid quota action' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':'||action_name,0));
 select case action_name when 'discovery' then runs_per_hour else analyses_per_hour end into allowed
 from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage
 where organization_id=tenant and action=action_name and used_at > now()-interval '1 hour';
 if used >= allowed then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.discovery_quota_usage(organization_id,action) values(tenant,action_name);
end $$;
revoke all on function prospectos_private.consume_discovery_quota(uuid,text) from public,anon,authenticated;

alter table public.discovery_runs enable row level security;
create policy discovery_runs_read on public.discovery_runs for select to authenticated using(prospectos_private.is_member(organization_id));
create policy discovery_runs_update on public.discovery_runs for update to authenticated using(prospectos_private.is_member(organization_id)) with check(prospectos_private.is_member(organization_id));
alter table public.discovery_results enable row level security;
create policy discovery_results_read on public.discovery_results for select to authenticated using(prospectos_private.is_member(organization_id));
create policy discovery_results_insert on public.discovery_results for insert to authenticated with check(prospectos_private.is_member(organization_id));
create policy discovery_results_update on public.discovery_results for update to authenticated using(prospectos_private.is_member(organization_id)) with check(prospectos_private.is_member(organization_id));
alter table public.prospect_observations enable row level security;
create policy prospect_observations_read on public.prospect_observations for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.discovery_runs,public.discovery_results,public.prospect_observations from public,anon,authenticated;
grant select,update on public.discovery_runs to authenticated;
grant select,insert,update on public.discovery_results to authenticated;
grant select on public.prospect_observations to authenticated;

create function public.start_discovery(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; cap int; row public.discovery_runs;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if length(trim(coalesce(p_query,''))) not between 2 and 250 or length(trim(coalesce(p_location,''))) not between 2 and 120 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if p_provider not in ('fixture','brave') or p_max_results is null or p_max_results<1 or p_max_results>100 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if jsonb_typeof(p_categories)<>'array' or jsonb_array_length(p_categories)>12 or jsonb_typeof(coalesce(p_filters,'{}'))<>'object' then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_categories) x where length(trim(x)) not between 1 and 60) then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 select max_results into cap from prospectos_private.discovery_quota_settings where singleton;
 if p_max_results>cap then raise exception 'max_results_exceeded' using errcode='P0001'; end if;
 perform prospectos_private.consume_discovery_quota(tenant,'discovery');
 insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider,filters_json)
 values(tenant,p_project_id,trim(p_query),trim(p_location),p_categories,p_provider,coalesce(p_filters,'{}')||jsonb_build_object('max_results',p_max_results)) returning * into row;
 return to_jsonb(row);
end $$;

create function public.consume_analysis_quota(p_prospect_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare tenant uuid;
begin
 select organization_id into tenant from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform prospectos_private.consume_discovery_quota(tenant,'analysis');
end $$;

create function public.accept_discovery_result(p_result_id uuid,p_force_separate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.discovery_results; p public.prospects; chosen uuid; key text;
begin
 select * into r from public.discovery_results where id=p_result_id for update;
 if not found then raise exception 'Discovery result not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(r.organization_id);
 if r.status='ignored' then raise exception 'Ignored result cannot be accepted' using errcode='22023'; end if;
 if r.status='accepted' then select * into p from public.prospects where id=r.prospect_id and project_id=r.project_id and organization_id=r.organization_id; return to_jsonb(p); end if;
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

create function public.save_discovery_observations(p_prospect_id uuid,p_observations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid; item jsonb; obs public.prospect_observations; evid uuid; result jsonb:='[]'; criteria text[]; st text; crit text; val boolean;
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant); perform pg_advisory_xact_lock(hashtextextended(p_prospect_id::text,0));
 if jsonb_typeof(p_observations)<>'array' or jsonb_array_length(p_observations)>40 then raise exception 'Invalid observations' using errcode='22023'; end if;
 select array_agg(x->>'key') into criteria from public.icps i cross join jsonb_array_elements(i.criteria) x where i.project_id=project;
 if criteria is null then criteria:=array['food','region','phone_orders','social_orders','platforms','weak_collect','audience','internal_delivery']; end if;
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

create function public.review_discovery_observation(p_observation_id uuid,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.prospect_observations; estate text; review text;
begin
 select * into o from public.prospect_observations where id=p_observation_id for update;
 if not found then raise exception 'Observation not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(o.organization_id);
 if p_decision not in ('confirm','contradict','unverify') then raise exception 'Invalid review decision' using errcode='22023'; end if;
 if p_decision='confirm' and (o.status='UNKNOWN' or o.value is null or o.evidence_id is null or length(trim(o.source_excerpt))=0) then raise exception 'Observation cannot be confirmed' using errcode='22023'; end if;
 estate:=case p_decision when 'confirm' then 'VERIFIED' when 'contradict' then 'CONTRADICTED' else case when o.status='INFERRED' then 'INFERRED_UNCONFIRMED' else 'NOT_VERIFIED' end end;
 review:=case p_decision when 'confirm' then 'VERIFIED' when 'contradict' then 'CONTRADICTED' else 'NOT_VERIFIED' end;
 if o.evidence_id is not null then update public.evidence set status=estate where id=o.evidence_id and prospect_id=o.prospect_id and organization_id=o.organization_id; end if;
 update public.prospect_observations set review_status=review where id=o.id returning * into o;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload) values(o.organization_id,o.prospect_id,auth.uid(),'observation.'||p_decision,jsonb_build_object('observation_id',o.id,'evidence_id',o.evidence_id));
 return to_jsonb(o);
end $$;

do $$ declare fn text; begin
 foreach fn in array array[
  'public.start_discovery(uuid,text,text,jsonb,text,integer,jsonb)',
  'public.consume_analysis_quota(uuid)',
  'public.accept_discovery_result(uuid,boolean)',
  'public.save_discovery_observations(uuid,jsonb)',
  'public.review_discovery_observation(uuid,text)'
 ] loop execute 'revoke all on function '||fn||' from public,anon'; execute 'grant execute on function '||fn||' to authenticated'; end loop;
end $$;
commit;
