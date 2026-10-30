-- 038 — Signaux SIRENE (src/registry-signals): establishments created recently in one postal code (official register,
-- API Recherche d'entreprises), each looked up on Google Places with a prudent match, saved as NEW candidates that a
-- person reviews (NEW → IGNORED, or NEW → ADDED, which creates the prospect). Nothing is sent, no evidence and no
-- signal is created, FIT and INTENT are untouched.
--  - A run costs one Discovery unit (the existing reservation, same plan and hourly limits as Signal Discovery);
--    refunded only when the run failed and the register answered no request.
--  - Candidates are written by the server only (service role), for the member who launched the run, with a strict
--    list of fields; they never change afterwards except through ignore / add (guard trigger).
--  - Personal data: no officer ("dirigeants") field exists here. Only publicly diffusible register entries are saved
--    (checked by the application, src/registry-signals/sirene.ts). Every field carries its source URL(s) and its
--    confidence ("verifie" | "estime"): the sources and confidence objects are checked here too.
--  - Google content: only the place ID and the match status are stored (Google Maps Platform terms). Rating, reviews,
--    website and opening hours are never written; the cache table accepts register pages only ('sirene:' keys).
-- Rollback: drop the functions below, then the tables registry_signal_candidates, registry_signal_runs and
-- registry_signal_cache (nothing else depends on them; prospects created by "add" stay, like any prospect).
begin;

create table if not exists public.registry_signal_runs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null,
 created_by uuid not null references auth.users(id),
 preset text not null check(preset ~ '^[a-z][a-z0-9_]{1,59}$'),
 postal_code text not null check(postal_code ~ '^[0-9]{5}$'),
 max_results int not null check(max_results between 1 and 50),
 status text not null default 'running' check(status in ('running','completed','failed')),
 metrics jsonb not null default '{}' check(jsonb_typeof(metrics)='object' and length(metrics::text)<=8192),
 error_code text check(error_code is null or error_code ~ '^[A-Z0-9_]{1,60}$'),
 quota_usage_id bigint,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check((status='running')=(completed_at is null)),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,project_id,organization_id)
);
create index if not exists registry_signal_runs_tenant_idx on public.registry_signal_runs(organization_id,project_id,created_at desc);

create table if not exists public.registry_signal_candidates (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null,
 organization_id uuid not null,
 project_id uuid not null,
 siren text not null check(siren ~ '^[0-9]{9}$'),
 siret text not null check(siret ~ '^[0-9]{14}$'),
 denomination text not null check(length(trim(denomination)) between 1 and 200),
 enseignes text[] not null default '{}' check(cardinality(enseignes)<=10),
 activite_principale text not null check(activite_principale ~ '^[0-9]{2}\.[0-9]{2}[A-Z]$'),
 date_creation date not null,
 date_creation_entreprise date,
 adresse text not null check(length(trim(adresse)) between 1 and 300),
 code_postal text not null check(code_postal ~ '^[0-9]{5}$'),
 commune text check(commune is null or length(trim(commune)) between 1 and 120),
 metier_probable text check(metier_probable is null or length(metier_probable) between 2 and 40),
 google_place_id text check(google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,300}$'),
 google_match_status text not null check(google_match_status in ('confirme','non_confirme','absent')),
 google_match_reason text not null check(google_match_reason ~ '^[A-Z0-9_]{1,60}$'),
 sources jsonb not null check(jsonb_typeof(sources)='object' and length(sources::text)<=8192),
 confidence jsonb not null check(jsonb_typeof(confidence)='object' and length(confidence::text)<=4096),
 detected_at timestamptz not null,
 status text not null default 'NEW' check(status in ('NEW','IGNORED','ADDED')),
 prospect_id uuid,
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 purge_after timestamptz,
 created_at timestamptz not null default now(),
 -- A place ID only for a confirmed match: a doubt is never attached to a place.
 check((google_match_status='confirme')=(google_place_id is not null)),
 check(left(siret,9)=siren),
 check(case status
  when 'NEW' then prospect_id is null and decided_by is null and decided_at is null and purge_after is not null
  when 'IGNORED' then prospect_id is null and decided_by is not null and decided_at is not null and purge_after is not null
  else prospect_id is not null and decided_by is not null and decided_at is not null and purge_after is null end),
 foreign key(run_id,project_id,organization_id) references public.registry_signal_runs(id,project_id,organization_id),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id),
 unique(run_id,siret)
);
create index if not exists registry_signal_candidates_run_idx on public.registry_signal_candidates(run_id,date_creation desc);
create index if not exists registry_signal_candidates_tenant_idx on public.registry_signal_candidates(organization_id,project_id,status,created_at desc);
create index if not exists registry_signal_candidates_purge_idx on public.registry_signal_candidates(purge_after) where purge_after is not null;

-- Register pages only (keys 'sirene:<sha256>'), with their expiry: Google content can never be cached here.
create table if not exists public.registry_signal_cache (
 key text primary key check(key ~ '^sirene:[0-9a-f]{64}$'),
 payload jsonb not null check(length(payload::text)<=2000000),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists registry_signal_cache_expiry_idx on public.registry_signal_cache(expires_at);

alter table public.registry_signal_runs enable row level security;
alter table public.registry_signal_candidates enable row level security;
alter table public.registry_signal_cache enable row level security;
do $policies$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='registry_signal_runs' and policyname='registry_signal_runs_read') then
  create policy registry_signal_runs_read on public.registry_signal_runs for select to authenticated using(prospectos_private.is_member(organization_id));
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='registry_signal_candidates' and policyname='registry_signal_candidates_read') then
  create policy registry_signal_candidates_read on public.registry_signal_candidates for select to authenticated using(prospectos_private.is_member(organization_id));
 end if;
end $policies$;
revoke all on public.registry_signal_runs,public.registry_signal_candidates,public.registry_signal_cache from public,anon,authenticated;
grant select on public.registry_signal_runs,public.registry_signal_candidates to authenticated;
-- The cache: the server only (no policy: members never read it).
grant select,insert,update,delete on public.registry_signal_cache to service_role;

-- Found content never changes; the review fields change only inside ignore / add, and only NEW → IGNORED | ADDED.
create or replace function prospectos_private.guard_registry_signal_candidate() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'prospect_id'-'decided_by'-'decided_at'-'purge_after')
    is distinct from (to_jsonb(old)-'status'-'prospect_id'-'decided_by'-'decided_at'-'purge_after') then
  raise exception 'Registry signal candidates are immutable once found' using errcode='42501';
 end if;
 if coalesce(current_setting('prospectos.registry_signal_decision',true),'')<>'on' then
  raise exception 'Registry signal candidates change only through ignore or add' using errcode='42501';
 end if;
 if old.status<>'NEW' or new.status not in ('IGNORED','ADDED') then
  raise exception 'Invalid candidate transition' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_registry_signal_candidate() from public,anon,authenticated;
drop trigger if exists registry_signal_candidate_guard on public.registry_signal_candidates;
create trigger registry_signal_candidate_guard before update on public.registry_signal_candidates for each row execute function prospectos_private.guard_registry_signal_candidate();

-- ------------------------------------------------------------
-- Start: membership, project, quota (one Discovery unit), then the run.
-- ------------------------------------------------------------
create or replace function public.start_registry_signal_run(p_project_id uuid,p_preset text,p_postal_code text,p_max_results int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; usage_id bigint; row public.registry_signal_runs;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if coalesce(p_preset,'') !~ '^[a-z][a-z0-9_]{1,59}$' or coalesce(p_postal_code,'') !~ '^[0-9]{5}$' or p_max_results is null or p_max_results not between 1 and 50 then
  raise exception 'Invalid registry signal input' using errcode='22023';
 end if;
 perform prospectos_private.consume_discovery_quota(tenant,'discovery',true);
 select id into usage_id from prospectos_private.discovery_quota_usage
  where user_id=auth.uid() and organization_id=tenant and action='discovery' and discovery_run_id is null and used_at=now() order by id desc limit 1;
 insert into public.registry_signal_runs(organization_id,project_id,created_by,preset,postal_code,max_results,quota_usage_id)
 values(tenant,p_project_id,auth.uid(),p_preset,p_postal_code,p_max_results,usage_id) returning * into row;
 return to_jsonb(row);
end $$;
revoke all on function public.start_registry_signal_run(uuid,text,text,int) from public,anon;
grant execute on function public.start_registry_signal_run(uuid,text,text,int) to authenticated;

-- ------------------------------------------------------------
-- Save candidates: server only, for the member who launched the run, into a running run. Strict fields; every source
-- an https URL, every confidence 'verifie' or 'estime'; a place ID only for a confirmed match.
-- ------------------------------------------------------------
create or replace function public.save_registry_signal_candidates(p_user_id uuid,p_run_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run public.registry_signal_runs; item jsonb; inserted int:=0; duplicates int:=0; row_id uuid;
 allowed text[]:=array['siren','siret','denomination','enseignes','activite_principale','date_creation','date_creation_entreprise','adresse','code_postal','commune',
  'metier_probable','google_place_id','google_match_status','google_match_reason','sources','confidence','detected_at'];
begin
 if p_user_id is null then raise exception 'Authenticated user required' using errcode='42501'; end if;
 select * into run from public.registry_signal_runs where id=p_run_id for update;
 if not found then raise exception 'Registry signal run not found' using errcode='P0002'; end if;
 if run.created_by<>p_user_id or not exists(select 1 from public.memberships where organization_id=run.organization_id and user_id=p_user_id) then
  raise exception 'Authenticated tenant member required' using errcode='42501';
 end if;
 if run.status<>'running' then raise exception 'Registry signal run is not running' using errcode='22023'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid registry signal candidates' using errcode='22023'; end if;
 if (select count(*) from public.registry_signal_candidates c where c.run_id=run.id)+jsonb_array_length(p_items)>run.max_results then
  raise exception 'Too many registry signal candidates' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where not k=any(allowed)) then raise exception 'Unknown candidate field' using errcode='22023'; end if;
  if coalesce(item->>'code_postal','')<>run.postal_code then raise exception 'Invalid candidate' using errcode='22023'; end if;
  if jsonb_typeof(item->'sources')<>'object' or exists(select 1 from jsonb_each(item->'sources') s where jsonb_typeof(s.value)<>'array' or jsonb_array_length(s.value) not between 1 and 5
     or exists(select 1 from jsonb_array_elements(s.value) u where jsonb_typeof(u)<>'string' or (u#>>'{}') !~ '^https://[^[:space:]@]+$' or length(u#>>'{}')>2048)) then
   raise exception 'Invalid candidate sources' using errcode='22023';
  end if;
  if jsonb_typeof(item->'confidence')<>'object' or exists(select 1 from jsonb_each(item->'confidence') c where jsonb_typeof(c.value)<>'string' or (c.value#>>'{}') not in ('verifie','estime')) then
   raise exception 'Invalid candidate confidence' using errcode='22023';
  end if;
  -- Every stored register field carries its source; Google content other than the place ID and the match never comes in.
  if exists(select 1 from unnest(array['siren','siret','denomination','activite_principale','date_creation','adresse','code_postal']) f where not (item->'sources') ? f or not (item->'confidence') ? f)
     or exists(select 1 from jsonb_object_keys(item->'sources') k where k like 'google.%' and k not in ('google.place_id','google.statut_match')) then
   raise exception 'Invalid candidate sources' using errcode='22023';
  end if;
  if item ? 'enseignes' and (jsonb_typeof(item->'enseignes')<>'array' or exists(select 1 from jsonb_array_elements(item->'enseignes') e where jsonb_typeof(e)<>'string' or length(e#>>'{}') not between 1 and 200)) then
   raise exception 'Invalid candidate' using errcode='22023';
  end if;
  begin
   perform (item->>'date_creation')::date, nullif(item->>'date_creation_entreprise','')::date, (item->>'detected_at')::timestamptz;
  exception when others then raise exception 'Invalid candidate date' using errcode='22023';
  end;
  if (item->>'date_creation')::date>current_date then raise exception 'Invalid candidate date' using errcode='22023'; end if;
  insert into public.registry_signal_candidates(run_id,organization_id,project_id,siren,siret,denomination,enseignes,activite_principale,date_creation,date_creation_entreprise,
   adresse,code_postal,commune,metier_probable,google_place_id,google_match_status,google_match_reason,sources,confidence,detected_at,purge_after)
  values(run.id,run.organization_id,run.project_id,item->>'siren',item->>'siret',trim(item->>'denomination'),
   coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(item->'enseignes') x),'{}'),item->>'activite_principale',(item->>'date_creation')::date,
   nullif(item->>'date_creation_entreprise','')::date,trim(item->>'adresse'),item->>'code_postal',nullif(trim(item->>'commune'),''),nullif(item->>'metier_probable',''),
   nullif(item->>'google_place_id',''),item->>'google_match_status',item->>'google_match_reason',item->'sources',item->'confidence',(item->>'detected_at')::timestamptz,
   now()+interval '180 days')
  on conflict(run_id,siret) do nothing returning id into row_id;
  if row_id is null then duplicates:=duplicates+1; else inserted:=inserted+1; end if;
  row_id:=null;
 end loop;
 return jsonb_build_object('inserted',inserted,'duplicates',duplicates);
end $$;
revoke all on function public.save_registry_signal_candidates(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_registry_signal_candidates(uuid,uuid,jsonb) to service_role;

-- Close a run with its metrics (server only). The refund reads metrics.requests_answered (register requests).
create or replace function public.complete_registry_signal_run(p_run_id uuid,p_status text,p_metrics jsonb,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_status not in ('completed','failed') or jsonb_typeof(coalesce(p_metrics,'{}'))<>'object' then raise exception 'Invalid run completion' using errcode='22023'; end if;
 if p_metrics ? 'requests_answered' and (jsonb_typeof(p_metrics->'requests_answered')<>'number' or (p_metrics->>'requests_answered')::numeric<0) then
  raise exception 'Invalid run completion' using errcode='22023';
 end if;
 update public.registry_signal_runs set status=p_status,metrics=coalesce(p_metrics,'{}'),
  error_code=case when p_status='failed' then coalesce(p_error,'REGISTRY_SIGNALS_FAILED') else null end,completed_at=now()
  where id=p_run_id and status='running';
 get diagnostics n=row_count; return n>0;
end $$;
revoke all on function public.complete_registry_signal_run(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_registry_signal_run(uuid,text,jsonb,text) to service_role;

-- Refund (server only): the run's own unit, only if the run failed and the register answered no request. Once.
create or replace function public.release_failed_registry_signal_run(p_run_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare released int;
begin
 if p_run_id is null then return false; end if;
 update prospectos_private.discovery_quota_usage u set billable=false
  from public.registry_signal_runs r
  where r.id=p_run_id and u.id=r.quota_usage_id and u.organization_id=r.organization_id and u.action='discovery' and u.billable
   and r.status='failed' and jsonb_typeof(r.metrics->'requests_answered')='number' and (r.metrics->>'requests_answered')::numeric=0;
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_failed_registry_signal_run(uuid) from public,anon,authenticated;
grant execute on function public.release_failed_registry_signal_run(uuid) to service_role;

-- Ignore: NEW → IGNORED, nothing else. IGNORED is terminal (a second call returns the row unchanged).
create or replace function public.ignore_registry_signal_candidate(p_candidate_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.registry_signal_candidates;
begin
 select * into c from public.registry_signal_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Registry signal candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 if c.status='IGNORED' then return to_jsonb(c); end if;
 if c.status<>'NEW' then raise exception 'CANDIDATE_ALREADY_ADDED' using errcode='22023'; end if;
 perform set_config('prospectos.registry_signal_decision','on',true);
 update public.registry_signal_candidates set status='IGNORED',decided_by=auth.uid(),decided_at=now() where id=c.id returning * into c;
 perform set_config('prospectos.registry_signal_decision','off',true);
 return to_jsonb(c);
end $$;
revoke all on function public.ignore_registry_signal_candidate(uuid) from public,anon;
grant execute on function public.ignore_registry_signal_candidate(uuid) to authenticated;

-- Add to project (a person's decision): a new prospect named after the register (or the name the person confirms),
-- in the establishment's commune, without a website (Google content is not stored); or an existing prospect of the
-- same project. Nothing else is created: the register facts stay on the candidate, with their sources.
create or replace function public.add_registry_signal_candidate_to_project(p_candidate_id uuid,p_name text default null,p_existing_prospect_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.registry_signal_candidates; p public.prospects; created boolean:=false; nm text;
begin
 select * into c from public.registry_signal_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Registry signal candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 if c.status='ADDED' then return jsonb_build_object('candidate_id',c.id,'prospect_id',c.prospect_id,'created_prospect',false,'already_added',true); end if;
 if c.status<>'NEW' then raise exception 'CANDIDATE_IGNORED' using errcode='22023'; end if;
 if p_existing_prospect_id is not null then
  if nullif(trim(coalesce(p_name,'')),'') is not null then raise exception 'Invalid add input' using errcode='22023'; end if;
  select * into p from public.prospects where id=p_existing_prospect_id and organization_id=c.organization_id and project_id=c.project_id;
  if not found then raise exception 'Prospect not found' using errcode='P0002'; end if;
 else
  nm:=coalesce(nullif(trim(coalesce(p_name,'')),''),c.enseignes[1],c.denomination);
  if length(nm)>200 then raise exception 'Invalid add input' using errcode='22023'; end if;
  insert into public.prospects(organization_id,project_id,name,city,status) values(c.organization_id,c.project_id,nm,initcap(c.commune),'À analyser') returning * into p;
  created:=true;
 end if;
 perform set_config('prospectos.registry_signal_decision','on',true);
 update public.registry_signal_candidates set status='ADDED',prospect_id=p.id,decided_by=auth.uid(),decided_at=now(),purge_after=null where id=c.id;
 perform set_config('prospectos.registry_signal_decision','off',true);
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(c.organization_id,p.id,auth.uid(),'registry_signal.added',jsonb_build_object('candidate_id',c.id,'run_id',c.run_id,'siret',c.siret,'created_prospect',created));
 return jsonb_build_object('candidate_id',c.id,'prospect_id',p.id,'created_prospect',created,'already_added',false);
end $$;
revoke all on function public.add_registry_signal_candidate_to_project(uuid,text,uuid) from public,anon;
grant execute on function public.add_registry_signal_candidate_to_project(uuid,text,uuid) to authenticated;

-- Purge (server only): undecided candidates after 180 days, old empty runs, expired cache pages.
create or replace function public.purge_registry_signals() returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidates int; runs int; pages int;
begin
 delete from public.registry_signal_candidates where status in ('NEW','IGNORED') and purge_after<now();
 get diagnostics candidates=row_count;
 delete from public.registry_signal_runs r where r.status<>'running' and r.created_at<now()-interval '180 days'
  and not exists(select 1 from public.registry_signal_candidates c where c.run_id=r.id);
 get diagnostics runs=row_count;
 delete from public.registry_signal_cache where expires_at<now();
 get diagnostics pages=row_count;
 return jsonb_build_object('candidates',candidates,'runs',runs,'cache',pages);
end $$;
revoke all on function public.purge_registry_signals() from public,anon,authenticated;
grant execute on function public.purge_registry_signals() to service_role;

commit;
