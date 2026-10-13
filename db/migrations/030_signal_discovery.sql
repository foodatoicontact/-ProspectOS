-- Signal-first Discovery V1, P2 (docs: the Signal-first Discovery V1 plan; pure logic in src/signal-discovery/*).
-- A second way to look for prospects: search public pages for business EVENTS (new_site, expansion) before any
-- prospect exists. Additive only: no existing table, function or migration is changed. Company Discovery (ENTITY /
-- Registry) is untouched.
--
-- 1. public.signal_discovery_runs — one search run. Started by start_signal_discovery (member), which consumes
--    exactly ONE unit of the existing Discovery quota (prospectos_private.consume_discovery_quota: plan limit, hourly
--    limit, per-user and per-organization locks — the same pool as company Discovery). The unit is tied to the run
--    (quota_usage_id). Closed by complete_signal_discovery_run (server only) with its metrics.
-- 2. public.signal_discovery_candidates — the events found: what the search result wrote, as P1 extracted it. Written
--    only by save_signal_discovery_candidates (server only, acting for the member who launched the run). Observed
--    content is immutable: a trigger lets only the review fields change, and only through the two functions below.
--    A candidate is never a prospect, never a signal, never evidence, never an observation, never a score input.
-- 3. ignore_signal_candidate (member): NEW → IGNORED, nothing else; IGNORED is terminal.
-- 4. add_signal_candidate_to_project (member): NEW → ADDED, atomically: a new prospect "À analyser" (a human-confirmed
--    name is REQUIRED when the organization was not resolved; the website is optional and never derived from a name),
--    or an existing prospect of the same project explicitly chosen; then ONE signal through the existing
--    prospectos_private.save_signals_core (provider discovery_recycled, status PENDING_REVIEW by the table default).
--    Nothing here can make a signal VERIFIED: that stays public.review_signal (024), a person's decision.
--    A future event never goes into signals.event_date: the announced date stays in raw_metadata.announced_event; the
--    publication date stays published_at (date_basis = published). One never becomes the other.
-- 5. release_failed_signal_discovery (server only): gives back the run's Discovery unit only when the run failed AND
--    its recorded metrics say that no provider request was answered (requests_answered = 0). Once only.
-- 6. purge_signal_discovery (server only): removes NEW / IGNORED candidates past purge_after (180 days) and old runs
--    left without candidates. Never touches prospects, signals, evidence or outreach (no cascade: the foreign keys
--    point FROM the candidate TO them).
--
-- Rollback: drop functions public.start_signal_discovery(uuid,text,text,jsonb,text,int),
-- public.save_signal_discovery_candidates(uuid,uuid,jsonb), public.complete_signal_discovery_run(uuid,text,jsonb,text),
-- public.release_failed_signal_discovery(uuid), public.ignore_signal_candidate(uuid),
-- public.add_signal_candidate_to_project(uuid,text,text,uuid), public.purge_signal_discovery(),
-- prospectos_private.guard_signal_discovery_candidate(); drop table public.signal_discovery_candidates,
-- public.signal_discovery_runs. Quota rows they consumed stay in the usage log, like every other action.
begin;

create table if not exists public.signal_discovery_runs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null,
 created_by uuid not null references auth.users(id),
 query text not null check(length(trim(query)) between 2 and 250),
 location text not null check(length(trim(location)) between 2 and 120),
 signal_types text[] not null check(cardinality(signal_types) between 1 and 2 and signal_types <@ array['new_site','expansion']::text[]),
 provider text not null check(provider in ('brave','fixture')),
 max_results int not null check(max_results between 1 and 50),
 status text not null default 'running' check(status in ('running','completed','failed')),
 metrics jsonb not null default '{}' check(jsonb_typeof(metrics)='object' and length(metrics::text)<=4096),
 error_code text check(error_code is null or error_code ~ '^[A-Z0-9_]{1,60}$'),
 quota_usage_id bigint,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check((status='running')=(completed_at is null)),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,organization_id),
 unique(id,project_id,organization_id)
);
create index if not exists signal_discovery_runs_tenant_idx on public.signal_discovery_runs(organization_id,project_id,created_at desc);

create table if not exists public.signal_discovery_candidates (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null,
 organization_id uuid not null,
 project_id uuid not null,
 -- Identity, as resolved by P1 (entity.ts). Name and domain are independent; null = "Entreprise à confirmer".
 entity_name text check(entity_name is null or length(trim(entity_name)) between 1 and 120),
 entity_name_status text not null check(entity_name_status in ('RESOLVED','UNRESOLVED')),
 entity_method text check(entity_method is null or entity_method in ('event_subject','headline_and_event','headline_subject')),
 entity_confidence text check(entity_confidence is null or entity_confidence in ('HIGH','MEDIUM')),
 entity_domain text check(entity_domain is null or entity_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and length(entity_domain)<=253),
 entity_domain_status text not null check(entity_domain_status in ('RESOLVED','UNRESOLVED')),
 entity_domain_method text check(entity_domain_method is null or entity_domain_method in ('own_site','domain_in_text')),
 -- The event, as the search result wrote it.
 signal_type text not null check(signal_type in ('new_site','expansion')),
 trigger_text text not null check(length(trim(trigger_text)) between 1 and 200),
 headline text not null check(length(trim(headline)) between 1 and 300),
 excerpt text not null check(length(trim(excerpt)) between 1 and 500),
 excerpt_truncated boolean not null default false,
 excerpt_origin text not null check(excerpt_origin in ('search_result_snippet','search_result_title')),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 source_url text not null check(source_url ~ '^https?://[^[:space:]]+$' and length(source_url)<=2048),
 source_domain text check(source_domain is null or length(source_domain) between 1 and 253),
 source_type text not null check(source_type='search_snippet'),
 source_page_kind text check(source_page_kind is null or source_page_kind in ('official_site','editorial','job_board','marketplace','directory','search_page','individual_profile','unknown')),
 hosting_platform text check(hosting_platform is null or length(hosting_platform) between 1 and 100),
 -- V1 never reads the page itself: the excerpt is the search engine's text.
 observed_on_page boolean not null default false check(observed_on_page=false),
 -- Dates: publication (from the search result's own date field) and the event as written (never one for the other).
 published_at timestamptz,
 event_date_text text check(event_date_text is null or length(trim(event_date_text)) between 1 and 80),
 event_year int check(event_year is null or event_year between 1990 and 2100),
 event_month int check(event_month is null or event_month between 1 and 12),
 event_day int check(event_day is null or event_day between 1 and 31),
 event_month_from int check(event_month_from is null or event_month_from between 1 and 12),
 event_month_to int check(event_month_to is null or event_month_to between 1 and 12),
 event_granularity text check(event_granularity is null or event_granularity in ('DAY','MONTH','PERIOD','YEAR')),
 event_tense text not null check(event_tense in ('FUTURE','PAST','UNKNOWN')),
 -- Where the event happens, as mentioned: never a head office.
 location_text text check(location_text is null or length(trim(location_text)) between 1 and 80),
 location_departments text[] not null default '{}' check(cardinality(location_departments)<=10),
 location_regions text[] not null default '{}' check(cardinality(location_regions)<=5),
 location_basis text check(location_basis is null or location_basis in ('EVENT_MENTION','HEADLINE_MENTION')),
 -- Pre-filter and review order: deterministic, never a probability, never a score.
 icp_match text not null check(icp_match in ('IN','OUT','UNKNOWN')),
 icp_reasons text[] not null default '{}' check(cardinality(icp_reasons)<=10),
 event_key text not null check(length(event_key) between 1 and 200),
 other_sources jsonb not null default '[]' check(jsonb_typeof(other_sources)='array' and jsonb_array_length(other_sources)<=20 and length(other_sources::text)<=16384),
 review_tier smallint not null check(review_tier between 1 and 5),
 raw_metadata jsonb not null default '{}' check(jsonb_typeof(raw_metadata)='object' and length(raw_metadata::text)<=8192),
 -- Review.
 status text not null default 'NEW' check(status in ('NEW','IGNORED','ADDED')),
 prospect_id uuid,
 signal_id uuid references public.signals(id) on delete set null,
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 purge_after timestamptz,
 -- Date shapes: exactly the fields each granularity carries.
 check(case event_granularity
  when 'DAY' then event_month is not null and event_day is not null and event_month_from is null and event_month_to is null
  when 'MONTH' then event_year is not null and event_month is not null and event_day is null and event_month_from is null and event_month_to is null
  when 'PERIOD' then event_year is not null and event_month is null and event_day is null and event_month_from is not null and event_month_to is not null and event_month_from<=event_month_to
  when 'YEAR' then event_year is not null and event_month is null and event_day is null and event_month_from is null and event_month_to is null
  else event_date_text is null and event_year is null and event_month is null and event_day is null and event_month_from is null and event_month_to is null end),
 check(event_granularity is null or event_date_text is not null),
 check((location_text is null)=(location_basis is null)),
 check(entity_name_status='RESOLVED' or (entity_name is null and entity_method is null and entity_confidence is null)),
 check(entity_name_status='UNRESOLVED' or entity_name is not null),
 check(entity_domain_status='RESOLVED' or (entity_domain is null and entity_domain_method is null)),
 check(entity_domain_status='UNRESOLVED' or (entity_domain is not null and entity_domain_method is not null and entity_name is not null)),
 check(hosting_platform is null or entity_domain is null),
 -- Lifecycle: NEW has no decision; IGNORED and ADDED carry who and when; only ADDED points at a prospect.
 check(case status
  when 'NEW' then prospect_id is null and signal_id is null and decided_by is null and decided_at is null and purge_after is not null
  when 'IGNORED' then prospect_id is null and signal_id is null and decided_by is not null and decided_at is not null and purge_after is not null
  else prospect_id is not null and decided_by is not null and decided_at is not null and purge_after is null end),
 foreign key(run_id,project_id,organization_id) references public.signal_discovery_runs(id,project_id,organization_id),
 foreign key(prospect_id,project_id,organization_id) references public.prospects(id,project_id,organization_id),
 unique(run_id,event_key)
);
create index if not exists signal_discovery_candidates_run_idx on public.signal_discovery_candidates(run_id,review_tier);
create index if not exists signal_discovery_candidates_tenant_idx on public.signal_discovery_candidates(organization_id,project_id,status,created_at desc);
create index if not exists signal_discovery_candidates_purge_idx on public.signal_discovery_candidates(purge_after) where purge_after is not null;
create index if not exists signal_discovery_candidates_signal_idx on public.signal_discovery_candidates(signal_id) where signal_id is not null;

alter table public.signal_discovery_runs enable row level security;
alter table public.signal_discovery_candidates enable row level security;
-- Members read their organization's rows; nobody writes directly. (Guarded so that re-applying 030 is harmless.)
do $policies$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='signal_discovery_runs' and policyname='signal_discovery_runs_read') then
  create policy signal_discovery_runs_read on public.signal_discovery_runs for select to authenticated using(prospectos_private.is_member(organization_id));
 end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='signal_discovery_candidates' and policyname='signal_discovery_candidates_read') then
  create policy signal_discovery_candidates_read on public.signal_discovery_candidates for select to authenticated using(prospectos_private.is_member(organization_id));
 end if;
end $policies$;
revoke all on public.signal_discovery_runs,public.signal_discovery_candidates from public,anon,authenticated;
grant select on public.signal_discovery_runs,public.signal_discovery_candidates to authenticated;

-- Observed content never changes. The review fields change only inside ignore / add (transaction-local flag set by
-- those functions), and only NEW → IGNORED or NEW → ADDED — whoever runs the UPDATE, server included.
create or replace function prospectos_private.guard_signal_discovery_candidate() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'prospect_id'-'signal_id'-'decided_by'-'decided_at'-'purge_after')
    is distinct from (to_jsonb(old)-'status'-'prospect_id'-'signal_id'-'decided_by'-'decided_at'-'purge_after') then
  raise exception 'Signal discovery candidates are immutable once found' using errcode='42501';
 end if;
 -- A purged or rejected signal sets signal_id to null (foreign key): the only change allowed outside a decision.
 if new.status=old.status and new.prospect_id is not distinct from old.prospect_id and new.decided_by is not distinct from old.decided_by
    and new.decided_at is not distinct from old.decided_at and new.purge_after is not distinct from old.purge_after
    and new.signal_id is null and old.signal_id is not null then
  return new;
 end if;
 if coalesce(current_setting('prospectos.signal_discovery_decision',true),'')<>'on' then
  raise exception 'Signal discovery candidates change only through ignore or add' using errcode='42501';
 end if;
 if old.status<>'NEW' or new.status not in ('IGNORED','ADDED') then
  raise exception 'Invalid candidate transition' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_signal_discovery_candidate() from public,anon,authenticated;
drop trigger if exists signal_discovery_candidate_guard on public.signal_discovery_candidates;
create trigger signal_discovery_candidate_guard before update on public.signal_discovery_candidates for each row execute function prospectos_private.guard_signal_discovery_candidate();

-- ------------------------------------------------------------
-- Start: membership, project, entitlement and quota (one Discovery unit), then the run. Nothing else is created.
-- ------------------------------------------------------------
create or replace function public.start_signal_discovery(p_project_id uuid,p_query text,p_location text,p_signal_types jsonb,p_provider text,p_max_results int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; cap int; types text[]; usage_id bigint; row public.signal_discovery_runs;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if length(trim(coalesce(p_query,''))) not between 2 and 250 or length(trim(coalesce(p_location,''))) not between 2 and 120 then raise exception 'Invalid signal discovery input' using errcode='22023'; end if;
 if p_provider is null or p_provider not in ('brave','fixture') or p_max_results is null or p_max_results not between 1 and 50 then raise exception 'Invalid signal discovery input' using errcode='22023'; end if;
 if p_signal_types is null or jsonb_typeof(p_signal_types)<>'array' or jsonb_array_length(p_signal_types) not between 1 and 2
    or exists(select 1 from jsonb_array_elements(p_signal_types) t where jsonb_typeof(t)<>'string' or t#>>'{}' not in ('new_site','expansion')) then
  raise exception 'Invalid signal discovery input' using errcode='22023';
 end if;
 select array_agg(distinct t order by t) into types from jsonb_array_elements_text(p_signal_types) t;
 select max_results into cap from prospectos_private.discovery_quota_settings where singleton;
 if p_max_results>cap then raise exception 'max_results_exceeded' using errcode='P0001'; end if;
 -- The existing Discovery reservation: plan limit (billable runs), hourly limit, locks. A fixture run costs nothing
 -- and is still hourly-limited, exactly like company Discovery.
 perform prospectos_private.consume_discovery_quota(tenant,'discovery',p_provider<>'fixture');
 select id into usage_id from prospectos_private.discovery_quota_usage
  where user_id=auth.uid() and organization_id=tenant and action='discovery' and discovery_run_id is null and used_at=now() order by id desc limit 1;
 insert into public.signal_discovery_runs(organization_id,project_id,created_by,query,location,signal_types,provider,max_results,quota_usage_id)
 values(tenant,p_project_id,auth.uid(),trim(p_query),trim(p_location),types,p_provider,p_max_results,usage_id) returning * into row;
 return to_jsonb(row);
end $$;
revoke all on function public.start_signal_discovery(uuid,text,text,jsonb,text,int) from public,anon;
grant execute on function public.start_signal_discovery(uuid,text,text,jsonb,text,int) to authenticated;

-- ------------------------------------------------------------
-- Save candidates: server only, for the member who launched the run, into a running run. Strict fields.
-- ------------------------------------------------------------
create or replace function public.save_signal_discovery_candidates(p_user_id uuid,p_run_id uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run public.signal_discovery_runs; item jsonb; inserted int:=0; duplicates int:=0; row_id uuid; host text; dom text;
 y int; mo int; d int; mf int; mt int; g text; pa timestamptz;
 allowed text[]:=array['entity_name','entity_name_status','entity_method','entity_confidence','entity_domain','entity_domain_status','entity_domain_method',
  'signal_type','trigger_text','headline','excerpt','excerpt_truncated','excerpt_origin','content_hash','source_url','source_domain','source_type','source_page_kind',
  'hosting_platform','observed_on_page','published_at','event_date_text','event_year','event_month','event_day','event_month_from','event_month_to','event_granularity',
  'event_tense','location_text','location_departments','location_regions','location_basis','icp_match','icp_reasons','event_key','other_sources','review_tier','raw_metadata'];
begin
 if p_user_id is null then raise exception 'Authenticated user required' using errcode='42501'; end if;
 select * into run from public.signal_discovery_runs where id=p_run_id for update;
 if not found then raise exception 'Signal discovery run not found' using errcode='P0002'; end if;
 if run.created_by<>p_user_id or not exists(select 1 from public.memberships where organization_id=run.organization_id and user_id=p_user_id) then
  raise exception 'Authenticated tenant member required' using errcode='42501';
 end if;
 if run.status<>'running' then raise exception 'Signal discovery run is not running' using errcode='22023'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Invalid signal discovery candidates' using errcode='22023'; end if;
 if (select count(*) from public.signal_discovery_candidates c where c.run_id=run.id)+jsonb_array_length(p_items)>200 then
  raise exception 'Too many signal discovery candidates' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where not k=any(allowed)) then raise exception 'Unknown candidate field' using errcode='22023'; end if;
  if not ((item->>'signal_type')=any(run.signal_types)) then raise exception 'Invalid candidate' using errcode='22023'; end if;
  if coalesce(item->>'source_type','')<>'search_snippet' or coalesce((item->>'observed_on_page')::boolean,false) then raise exception 'Invalid candidate' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(item) e where e.key in ('location_departments','location_regions','icp_reasons') and (jsonb_typeof(e.value)<>'array'
     or exists(select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 80))) then
   raise exception 'Invalid candidate' using errcode='22023';
  end if;
  if item ? 'other_sources' and (jsonb_typeof(item->'other_sources')<>'array' or exists(select 1 from jsonb_array_elements(item->'other_sources') s
     where jsonb_typeof(s)<>'object' or coalesce(s->>'source_url','') !~ '^https?://[^[:space:]]+$')) then
   raise exception 'Invalid candidate' using errcode='22023';
  end if;
  -- The source domain, when given, is the URL's own host or one of its parent domains: never another site.
  host:=lower(substring(item->>'source_url' from '^https?://([^/:?#]+)')); dom:=lower(item->>'source_domain');
  if dom is not null and not (host=dom or host like '%.'||dom) then raise exception 'Invalid candidate' using errcode='22023'; end if;
  if (item->>'source_url') ~ '^https?://[^/]*@' then raise exception 'Invalid candidate' using errcode='22023'; end if;
  -- Dates: typed, and a full day must exist in the calendar. Never moved from one field to another.
  begin
   y:=(item->>'event_year')::int; mo:=(item->>'event_month')::int; d:=(item->>'event_day')::int;
   mf:=(item->>'event_month_from')::int; mt:=(item->>'event_month_to')::int; g:=item->>'event_granularity';
   pa:=nullif(item->>'published_at','')::timestamptz;
   if y is not null and mo is not null and d is not null then perform make_date(y,mo,d); end if;
  exception when others then raise exception 'Invalid candidate date' using errcode='22023';
  end;
  if pa is not null and pa>now()+interval '1 day' then raise exception 'Invalid candidate date' using errcode='22023'; end if;
  insert into public.signal_discovery_candidates(run_id,organization_id,project_id,entity_name,entity_name_status,entity_method,entity_confidence,
   entity_domain,entity_domain_status,entity_domain_method,signal_type,trigger_text,headline,excerpt,excerpt_truncated,excerpt_origin,content_hash,
   source_url,source_domain,source_type,source_page_kind,hosting_platform,observed_on_page,published_at,event_date_text,event_year,event_month,event_day,
   event_month_from,event_month_to,event_granularity,event_tense,location_text,location_departments,location_regions,location_basis,icp_match,icp_reasons,
   event_key,other_sources,review_tier,raw_metadata,purge_after)
  values(run.id,run.organization_id,run.project_id,nullif(trim(item->>'entity_name'),''),item->>'entity_name_status',item->>'entity_method',item->>'entity_confidence',
   lower(item->>'entity_domain'),item->>'entity_domain_status',item->>'entity_domain_method',item->>'signal_type',trim(item->>'trigger_text'),trim(item->>'headline'),
   item->>'excerpt',coalesce((item->>'excerpt_truncated')::boolean,false),item->>'excerpt_origin',item->>'content_hash',
   item->>'source_url',dom,'search_snippet',item->>'source_page_kind',item->>'hosting_platform',false,pa,item->>'event_date_text',y,mo,d,mf,mt,g,
   item->>'event_tense',item->>'location_text',
   coalesce((select array_agg(x) from jsonb_array_elements_text(item->'location_departments') x),'{}'),
   coalesce((select array_agg(x) from jsonb_array_elements_text(item->'location_regions') x),'{}'),
   item->>'location_basis',item->>'icp_match',coalesce((select array_agg(x) from jsonb_array_elements_text(item->'icp_reasons') x),'{}'),
   item->>'event_key',coalesce(item->'other_sources','[]'),(item->>'review_tier')::smallint,coalesce(item->'raw_metadata','{}'),now()+interval '180 days')
  on conflict(run_id,event_key) do nothing returning id into row_id;
  if row_id is null then duplicates:=duplicates+1; else inserted:=inserted+1; end if;
  row_id:=null;
 end loop;
 return jsonb_build_object('inserted',inserted,'duplicates',duplicates);
end $$;
revoke all on function public.save_signal_discovery_candidates(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_signal_discovery_candidates(uuid,uuid,jsonb) to service_role;

-- Close a run with its metrics (server only). The refund contract reads metrics.requests_answered.
create or replace function public.complete_signal_discovery_run(p_run_id uuid,p_status text,p_metrics jsonb,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_status not in ('completed','failed') or jsonb_typeof(coalesce(p_metrics,'{}'))<>'object' then raise exception 'Invalid run completion' using errcode='22023'; end if;
 if p_metrics ? 'requests_answered' and (jsonb_typeof(p_metrics->'requests_answered')<>'number' or (p_metrics->>'requests_answered')::numeric<0) then
  raise exception 'Invalid run completion' using errcode='22023';
 end if;
 update public.signal_discovery_runs set status=p_status,metrics=coalesce(p_metrics,'{}'),error_code=case when p_status='failed' then coalesce(p_error,'SIGNAL_DISCOVERY_FAILED') else null end,completed_at=now()
  where id=p_run_id and status='running';
 get diagnostics n=row_count; return n>0;
end $$;
revoke all on function public.complete_signal_discovery_run(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_signal_discovery_run(uuid,text,jsonb,text) to service_role;

-- Refund (server only): the run's own unit, only if the run failed and no provider request was answered. Once.
create or replace function public.release_failed_signal_discovery(p_run_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare released int;
begin
 if p_run_id is null then return false; end if;
 update prospectos_private.discovery_quota_usage u set billable=false
  from public.signal_discovery_runs r
  where r.id=p_run_id and u.id=r.quota_usage_id and u.organization_id=r.organization_id and u.action='discovery' and u.billable
   and r.status='failed' and jsonb_typeof(r.metrics->'requests_answered')='number' and (r.metrics->>'requests_answered')::numeric=0;
 get diagnostics released=row_count;
 return released>0;
end $$;
revoke all on function public.release_failed_signal_discovery(uuid) from public,anon,authenticated;
grant execute on function public.release_failed_signal_discovery(uuid) to service_role;

-- ------------------------------------------------------------
-- Ignore: NEW → IGNORED, nothing else. IGNORED is terminal (a second call returns the row unchanged).
-- ------------------------------------------------------------
create or replace function public.ignore_signal_candidate(p_candidate_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.signal_discovery_candidates;
begin
 select * into c from public.signal_discovery_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Signal discovery candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 if c.status='IGNORED' then return to_jsonb(c); end if;
 if c.status<>'NEW' then raise exception 'CANDIDATE_ALREADY_ADDED' using errcode='22023'; end if;
 perform set_config('prospectos.signal_discovery_decision','on',true);
 update public.signal_discovery_candidates set status='IGNORED',decided_by=auth.uid(),decided_at=now() where id=c.id returning * into c;
 perform set_config('prospectos.signal_discovery_decision','off',true);
 return to_jsonb(c);
end $$;
revoke all on function public.ignore_signal_candidate(uuid) from public,anon;
grant execute on function public.ignore_signal_candidate(uuid) to authenticated;

-- ------------------------------------------------------------
-- Add to project: a new prospect (name confirmed by a person when unresolved) or an existing prospect of the same
-- project, then ONE PENDING_REVIEW signal through the existing core. All or nothing.
-- ------------------------------------------------------------
create or replace function public.add_signal_candidate_to_project(p_candidate_id uuid,p_name text default null,p_website text default null,p_existing_prospect_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.signal_discovery_candidates; p public.prospects; created boolean:=false; nm text; site text; ed date; sig jsonb; saved jsonb; sid uuid;
begin
 select * into c from public.signal_discovery_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Signal discovery candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 if c.status='ADDED' then
  return jsonb_build_object('candidate_id',c.id,'prospect_id',c.prospect_id,'signal_id',c.signal_id,'created_prospect',false,'already_added',true);
 end if;
 if c.status<>'NEW' then raise exception 'CANDIDATE_IGNORED' using errcode='22023'; end if;
 if p_existing_prospect_id is not null then
  -- B. An existing prospect, explicitly chosen: same organization AND same project, or nothing.
  if nullif(trim(coalesce(p_name,'')),'') is not null or nullif(trim(coalesce(p_website,'')),'') is not null then raise exception 'Invalid add input' using errcode='22023'; end if;
  select * into p from public.prospects where id=p_existing_prospect_id and organization_id=c.organization_id and project_id=c.project_id;
  if not found then raise exception 'Prospect not found' using errcode='P0002'; end if;
 else
  -- A. A new prospect. The name: the person's confirmation, else the resolved name; an unresolved organization
  -- without a confirmed name is refused. The website: the person's, else the resolved domain; never made from a name.
  nm:=nullif(trim(coalesce(p_name,'')),'');
  if nm is null and c.entity_name_status='RESOLVED' then nm:=c.entity_name; end if;
  if nm is null then raise exception 'ENTITY_NAME_REQUIRED' using errcode='22023'; end if;
  if length(nm)>200 then raise exception 'Invalid add input' using errcode='22023'; end if;
  site:=nullif(trim(coalesce(p_website,'')),'');
  if site is not null and (site !~ '^https?://[^[:space:]/@]+(/[^[:space:]]*)?$' or length(site)>2048) then raise exception 'Invalid website' using errcode='22023'; end if;
  if site is null and c.entity_domain_status='RESOLVED' then site:='https://'||c.entity_domain; end if;
  -- The place of the event is not the prospect's address: city stays empty.
  insert into public.prospects(organization_id,project_id,name,website,status) values(c.organization_id,c.project_id,nm,site,'À analyser') returning * into p;
  created:=true;
 end if;
 -- The signal, in the Signal Engine's own format (src/signal-discovery/rank.ts, toPendingSignal): event_date only for
 -- a PAST event written with its exact day; any other announced date stays in raw_metadata.announced_event.
 if c.event_granularity='DAY' and c.event_year is not null then
  ed:=make_date(c.event_year,c.event_month,c.event_day);
  if ed>=current_date then ed:=null; end if;
 end if;
 sig:=jsonb_build_object(
  'provider','discovery_recycled','signal_type',c.signal_type,
  'title',left(coalesce(c.entity_name||' — ','')||c.headline,300),'excerpt',c.excerpt,'source_url',c.source_url,'source_type','search_snippet',
  'event_date',ed,'published_at',c.published_at,'observed_at',c.created_at,'matched_terms','[]'::jsonb,'content_hash',c.content_hash,'event_key',c.event_key,
  'raw_metadata',jsonb_build_object('origin','signal_discovery','candidate_id',c.id,'run_id',c.run_id,'observed_on_page',false,'excerpt_origin',c.excerpt_origin,
   'announced_event',case when c.event_granularity is null then null else jsonb_build_object('text',c.event_date_text,'year',c.event_year,'month',c.event_month,'day',c.event_day,
    'granularity',c.event_granularity,'months',case when c.event_month_from is null then null else jsonb_build_array(c.event_month_from,c.event_month_to) end,'tense',c.event_tense) end,
   'event_tense',c.event_tense,
   'location',case when c.location_text is null then null else jsonb_build_object('text',c.location_text,'departments',to_jsonb(c.location_departments),'regions',to_jsonb(c.location_regions),'basis',c.location_basis) end,
   'entity_name_status',c.entity_name_status,'entity_domain_status',c.entity_domain_status,'event_key',c.event_key));
 saved:=prospectos_private.save_signals_core(c.organization_id,c.project_id,p.id,null,jsonb_build_array(sig),auth.uid());
 -- The signal now carrying this event for the prospect: the one just saved, or the same event already known.
 select s.id into sid from public.signals s where s.prospect_id=p.id and s.event_key=c.event_key and s.status<>'REJECTED' order by s.created_at limit 1;
 if sid is null then raise exception 'SIGNAL_NOT_SAVED' using errcode='P0001'; end if;
 perform set_config('prospectos.signal_discovery_decision','on',true);
 update public.signal_discovery_candidates set status='ADDED',prospect_id=p.id,signal_id=sid,decided_by=auth.uid(),decided_at=now(),purge_after=null where id=c.id;
 perform set_config('prospectos.signal_discovery_decision','off',true);
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(c.organization_id,p.id,auth.uid(),'signal_discovery.added',jsonb_build_object('candidate_id',c.id,'run_id',c.run_id,'signal_id',sid,'created_prospect',created));
 return jsonb_build_object('candidate_id',c.id,'prospect_id',p.id,'signal_id',sid,'created_prospect',created,'already_added',false,'signal_inserted',(saved->>'inserted')::int>0);
end $$;
revoke all on function public.add_signal_candidate_to_project(uuid,text,text,uuid) from public,anon;
grant execute on function public.add_signal_candidate_to_project(uuid,text,text,uuid) to authenticated;

-- ------------------------------------------------------------
-- Purge (server only): temporary Signal Discovery data only.
-- ------------------------------------------------------------
create or replace function public.purge_signal_discovery() returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidates int; runs int;
begin
 delete from public.signal_discovery_candidates where status in ('NEW','IGNORED') and purge_after<now();
 get diagnostics candidates=row_count;
 delete from public.signal_discovery_runs r where r.status<>'running' and r.created_at<now()-interval '180 days'
  and not exists(select 1 from public.signal_discovery_candidates c where c.run_id=r.id);
 get diagnostics runs=row_count;
 return jsonb_build_object('candidates',candidates,'runs',runs);
end $$;
revoke all on function public.purge_signal_discovery() from public,anon,authenticated;
grant execute on function public.purge_signal_discovery() to service_role;

commit;
