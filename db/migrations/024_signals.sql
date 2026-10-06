-- Signal Engine V1, block S1 (docs/SIGNAL_ENGINE_V1_PLAN.md): the data model of the INTENT dimension.
--
-- A signal is a dated, sourced public fact about a company (a job ad, an appointment, a funding round…) that may make
-- it relevant to contact NOW. It is never evidence: no row here ever creates, changes or verifies an `evidence` row,
-- and the FIT score (scoreProspect) never reads signals. A signal only counts for INTENT once a person verified it.
--
-- 1. public.signals — one sourced fact per prospect: closed type list, exact excerpt (≤ 500), URL, event / publication
--    / observation dates. `source_domain` and `date_basis` are derived by the database; `confidence` is computed by
--    the database from the kind of source and the dates (never sent by a client, never produced by a model).
--    Status: PENDING_REVIEW → VERIFIED | REJECTED (and back to PENDING_REVIEW). "Expired" is never stored: age is
--    read against the type's decay at scoring time. Duplicates: same URL + same excerpt (unique), and the same event
--    seen on several sources (same event_key on the same prospect) is kept once.
-- 2. public.signal_runs — one search for signals (manual or monitoring), with its idempotency key, lease and
--    metrics. S1 creates the table; starting and claiming runs comes with the providers (S2) and monitoring (S9).
-- 3. public.intent_profiles — per project, the user's explicit choices: which signal types count and how much, and
--    the words (roles, topics) that make a signal relevant. Validated here; proposals by AI are accepted by a person.
-- 4. Writes only through SECURITY DEFINER functions (save_signals, review_signal, save_intent_profile) for members of
--    the prospect's organization; members read through RLS; no client can insert, update or delete a row directly.
--    Each save and review appends an audit event. Unreviewed signals are purged after 60 days, rejected ones 30 days
--    after rejection (purge_signals, server only); verified signals are kept while the prospect exists.
--
-- Rollback: drop function public.save_signals(uuid,uuid,jsonb), public.review_signal(uuid,text,text),
-- public.save_intent_profile(uuid,jsonb), public.purge_signals(), prospectos_private.signal_confidence(text,date,timestamptz),
-- prospectos_private.guard_signal(); drop table public.signals, public.signal_runs, public.intent_profiles.
begin;

create table if not exists public.signal_runs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null,
 trigger text not null check(trigger in ('manual','monitor')),
 prospect_ids uuid[] not null check(cardinality(prospect_ids) between 1 and 10),
 status text not null default 'queued' check(status in ('queued','running','completed','partial','failed')),
 idempotency_key text unique check(idempotency_key is null or length(idempotency_key) between 1 and 200),
 lease_until timestamptz,
 attempts int not null default 0 check(attempts between 0 and 3),
 metrics jsonb not null default '{}' check(jsonb_typeof(metrics)='object'),
 error_code text check(error_code is null or length(error_code) between 1 and 60),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 started_at timestamptz,
 completed_at timestamptz,
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,organization_id)
);
create index if not exists signal_runs_tenant_idx on public.signal_runs(organization_id,project_id,created_at desc);
create index if not exists signal_runs_due_idx on public.signal_runs(status,lease_until) where status in ('queued','running');

create table if not exists public.signals (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 prospect_id uuid not null,
 signal_run_id uuid,
 provider text not null check(provider in ('web_search','official_site','bodacc','discovery_recycled','user_provided','test_fixture')),
 signal_type text not null check(signal_type in ('hiring_role','leadership_change','funding','acquisition','new_site','expansion','product_launch',
  'partnership','certification','tech_change','public_contract_won','headcount_growth','incident_cyber','event')),
 title text not null check(length(trim(title)) between 1 and 300),
 excerpt text not null check(length(trim(excerpt)) between 1 and 500),
 source_url text not null check(source_url ~ '^https?://[^[:space:]]+$' and length(source_url)<=2048),
 source_domain text generated always as (lower(substring(source_url from '^https?://([^/:?#]+)'))) stored,
 source_type text not null check(source_type in ('official_website','news','job_board','legal_announcement','public_procurement','search_snippet','user_provided','test_fixture')),
 event_date date,
 published_at timestamptz,
 observed_at timestamptz not null,
 date_basis text generated always as (case when event_date is not null then 'event' when published_at is not null then 'published' else 'observed_only' end) stored,
 confidence numeric(3,2) not null check(confidence between 0 and 1),
 matched_terms text[] not null default '{}' check(cardinality(matched_terms)<=20),
 status text not null default 'PENDING_REVIEW' check(status in ('PENDING_REVIEW','VERIFIED','REJECTED')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 rejection_reason text check(rejection_reason is null or length(rejection_reason)<=300),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 event_key text not null check(length(event_key) between 1 and 200),
 raw_metadata jsonb not null default '{}' check(jsonb_typeof(raw_metadata)='object' and length(raw_metadata::text)<=8192),
 purge_after timestamptz,
 created_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 foreign key(signal_run_id,organization_id) references public.signal_runs(id,organization_id),
 unique(prospect_id,source_url,content_hash),
 check(status<>'VERIFIED' or (reviewed_by is not null and reviewed_at is not null)),
 check(status<>'REJECTED' or reviewed_at is not null),
 check(published_at is null or published_at<=observed_at+interval '1 day')
);
create index if not exists signals_review_idx on public.signals(organization_id,project_id,status,observed_at desc);
create index if not exists signals_prospect_idx on public.signals(prospect_id,status);
create index if not exists signals_event_idx on public.signals(prospect_id,event_key);
create index if not exists signals_purge_idx on public.signals(purge_after) where purge_after is not null;

create table if not exists public.intent_profiles (
 project_id uuid primary key,
 organization_id uuid not null,
 profile jsonb not null check(jsonb_typeof(profile)='object'),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);

alter table public.signal_runs enable row level security;
alter table public.signals enable row level security;
alter table public.intent_profiles enable row level security;
create policy signal_runs_read on public.signal_runs for select to authenticated using(prospectos_private.is_member(organization_id));
create policy signals_read on public.signals for select to authenticated using(prospectos_private.is_member(organization_id));
create policy intent_profiles_read on public.intent_profiles for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.signal_runs,public.signals,public.intent_profiles from public,anon,authenticated;
grant select on public.signal_runs,public.signals,public.intent_profiles to authenticated;

-- How much a signal's source can be trusted, by rule: the kind of source, lowered when the fact carries no date of
-- its own (only the day ProspectOS read it). Mirrored by src/signals/types.ts (signalConfidence), tests pin both.
create or replace function prospectos_private.signal_confidence(p_source_type text, p_event_date date, p_published_at timestamptz) returns numeric
language sql immutable set search_path='' as $$
 select round((case p_source_type
   when 'official_website' then 1.0 when 'legal_announcement' then 1.0 when 'public_procurement' then 1.0
   when 'news' then 0.8 when 'job_board' then 0.8 when 'user_provided' then 0.7 when 'search_snippet' then 0.6 else 0.5 end)
  *(case when p_event_date is null and p_published_at is null then 0.7 else 1.0 end),2)
$$;
revoke all on function prospectos_private.signal_confidence(text,date,timestamptz) from public,anon,authenticated;

-- A signal's source, excerpt and dates are what was observed: once saved, only its review may change.
create or replace function prospectos_private.guard_signal() returns trigger
language plpgsql set search_path='' as $$
begin
 -- source_domain and date_basis are generated from guarded columns (and not yet computed in a BEFORE trigger).
 if (to_jsonb(new)-'status'-'reviewed_by'-'reviewed_at'-'rejection_reason'-'purge_after'-'source_domain'-'date_basis')
    is distinct from (to_jsonb(old)-'status'-'reviewed_by'-'reviewed_at'-'rejection_reason'-'purge_after'-'source_domain'-'date_basis') then
  raise exception 'Signals are immutable once observed: only the review may change' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_signal() from public,anon,authenticated;
drop trigger if exists signal_guard on public.signals;
create trigger signal_guard before update on public.signals for each row execute function prospectos_private.guard_signal();

-- Saves the signals found for one prospect (a provider run, or one signal typed by the user). Strict fields, closed
-- types, a source URL and an exact excerpt for every signal; confidence computed here. A signal already saved (same
-- URL and excerpt) or the same event already known from another source is skipped, never overwritten.
create or replace function public.save_signals(p_prospect_id uuid, p_run_id uuid, p_signals jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid; item jsonb; inserted int:=0; duplicates int:=0; row_id uuid; terms text[]; ed date; pa timestamptz; oa timestamptz;
 allowed text[]:=array['provider','signal_type','title','excerpt','source_url','source_type','event_date','published_at','observed_at','matched_terms','content_hash','event_key','raw_metadata'];
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('signals:'||p_prospect_id::text,0));
 if jsonb_typeof(p_signals)<>'array' or jsonb_array_length(p_signals) not between 1 and 40 then raise exception 'Invalid signals' using errcode='22023'; end if;
 if p_run_id is not null and not exists(select 1 from public.signal_runs r where r.id=p_run_id and r.organization_id=tenant and r.project_id=project and p_prospect_id=any(r.prospect_ids)) then
  raise exception 'Signal run not found' using errcode='P0002';
 end if;
 for item in select value from jsonb_array_elements(p_signals) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where not k=any(allowed)) then raise exception 'Unknown signal field' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(item->'matched_terms','[]'))<>'array' or jsonb_array_length(coalesce(item->'matched_terms','[]'))>20
     or exists(select 1 from jsonb_array_elements(coalesce(item->'matched_terms','[]')) t where jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 80) then
   raise exception 'Invalid signal' using errcode='22023';
  end if;
  select coalesce(array_agg(t),'{}') into terms from jsonb_array_elements_text(coalesce(item->'matched_terms','[]')) t;
  begin
   ed:=nullif(item->>'event_date','')::date; pa:=nullif(item->>'published_at','')::timestamptz; oa:=(item->>'observed_at')::timestamptz;
  exception when others then raise exception 'Invalid signal date' using errcode='22023';
  end;
  if oa is null or oa>now()+interval '5 minutes' then raise exception 'Invalid signal date' using errcode='22023'; end if;
  -- The same event already known for this prospect (from any source, any status but rejected) is not added twice.
  if exists(select 1 from public.signals s where s.prospect_id=p_prospect_id and s.event_key=item->>'event_key' and s.status<>'REJECTED') then
   duplicates:=duplicates+1; continue;
  end if;
  insert into public.signals(organization_id,project_id,prospect_id,signal_run_id,provider,signal_type,title,excerpt,source_url,source_type,
   event_date,published_at,observed_at,confidence,matched_terms,content_hash,event_key,raw_metadata,purge_after)
  values(tenant,project,p_prospect_id,p_run_id,item->>'provider',item->>'signal_type',trim(item->>'title'),trim(item->>'excerpt'),item->>'source_url',item->>'source_type',
   ed,pa,oa,prospectos_private.signal_confidence(item->>'source_type',ed,pa),terms,item->>'content_hash',item->>'event_key',coalesce(item->'raw_metadata','{}'),now()+interval '60 days')
  on conflict(prospect_id,source_url,content_hash) do nothing returning id into row_id;
  if row_id is null then duplicates:=duplicates+1; else inserted:=inserted+1; end if;
  row_id:=null;
 end loop;
 if inserted>0 then
  insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
  values(tenant,p_prospect_id,auth.uid(),'signals.saved',jsonb_build_object('inserted',inserted,'duplicates',duplicates,'signal_run_id',p_run_id));
 end if;
 return jsonb_build_object('inserted',inserted,'duplicates',duplicates);
end $$;
revoke all on function public.save_signals(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_signals(uuid,uuid,jsonb) to authenticated;

-- A person reviews a signal: verify (it now counts for INTENT), reject (with an optional reason), or reset to review.
create or replace function public.review_signal(p_signal_id uuid, p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.signals;
begin
 select * into s from public.signals where id=p_signal_id for update;
 if not found then raise exception 'Signal not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(s.organization_id);
 if p_decision not in ('verify','reject','reset') then raise exception 'Invalid review decision' using errcode='22023'; end if;
 if p_reason is not null and length(p_reason)>300 then raise exception 'Invalid review reason' using errcode='22023'; end if;
 update public.signals set
  status=case p_decision when 'verify' then 'VERIFIED' when 'reject' then 'REJECTED' else 'PENDING_REVIEW' end,
  reviewed_by=case when p_decision='reset' then null else auth.uid() end,
  reviewed_at=case when p_decision='reset' then null else now() end,
  rejection_reason=case when p_decision='reject' then nullif(trim(p_reason),'') else null end,
  purge_after=case p_decision when 'verify' then null when 'reject' then now()+interval '30 days' else now()+interval '60 days' end
 where id=s.id returning * into s;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(s.organization_id,s.prospect_id,auth.uid(),'signal.'||p_decision,jsonb_build_object('signal_id',s.id,'signal_type',s.signal_type));
 return to_jsonb(s);
end $$;
revoke all on function public.review_signal(uuid,text,text) from public,anon;
grant execute on function public.review_signal(uuid,text,text) to authenticated;

-- The project's intent profile: {"types": {<signal_type>: weight 0..50}, "terms": [2..80 chars, at most 30]}.
create or replace function public.save_intent_profile(p_project_id uuid, p_profile jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; r public.intent_profiles;
 types text[]:=array['hiring_role','leadership_change','funding','acquisition','new_site','expansion','product_launch','partnership','certification','tech_change','public_contract_won','headcount_growth','incident_cyber','event'];
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if jsonb_typeof(p_profile)<>'object' or exists(select 1 from jsonb_object_keys(p_profile) k where k not in ('types','terms'))
    or jsonb_typeof(p_profile->'types')<>'object' or jsonb_typeof(coalesce(p_profile->'terms','[]'))<>'array'
    or exists(select 1 from jsonb_each(p_profile->'types') t where not t.key=any(types) or jsonb_typeof(t.value)<>'number' or (t.value#>>'{}')::numeric not between 0 and 50 or (t.value#>>'{}')::numeric<>trunc((t.value#>>'{}')::numeric))
    or jsonb_array_length(coalesce(p_profile->'terms','[]'))>30
    or exists(select 1 from jsonb_array_elements(coalesce(p_profile->'terms','[]')) t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 2 and 80) then
  raise exception 'Invalid intent profile' using errcode='22023';
 end if;
 insert into public.intent_profiles(project_id,organization_id,profile,updated_by,updated_at)
 values(p_project_id,tenant,jsonb_build_object('types',p_profile->'types','terms',coalesce(p_profile->'terms','[]')),auth.uid(),now())
 on conflict(project_id) do update set profile=excluded.profile,updated_by=excluded.updated_by,updated_at=now()
 returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.save_intent_profile(uuid,jsonb) from public,anon;
grant execute on function public.save_intent_profile(uuid,jsonb) to authenticated;

-- Retention (server only; scheduled with monitoring in S9): unreviewed and rejected signals past their date.
create or replace function public.purge_signals() returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 delete from public.signals where purge_after is not null and purge_after<now() and status<>'VERIFIED';
 get diagnostics n=row_count; return n;
end $$;
revoke all on function public.purge_signals() from public,anon,authenticated;
grant execute on function public.purge_signals() to service_role;

commit;
