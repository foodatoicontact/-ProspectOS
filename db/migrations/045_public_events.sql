-- 045 — Collecte nationale des événements publics (src/collect, docs/PUBLIC_EVENTS.md). One collection for every client of
-- the veille dédiée: each night the BODACC announcements of the day before are stored ONCE for all of France — creations,
-- new establishments, head-office transfers, business sales — and each client's list becomes a filter on this store
-- (departments, kinds, activity, size). The company record (activity, size, legal form, active, objection to prospecting)
-- is fetched once per SIREN from the API Recherche d'entreprises and shared by every client, refreshed after 30 days.
--
-- Data protection: only legal persons are stored. An announcement about a natural person (sole trader: their name) is
-- never written — the collector drops it and only counts it. The company record keeps no executive and no personal
-- address; for a sole trader (if one ever reaches it) the name is not kept and the company is marked « individual ».
--
-- 1. public.public_events — one row per official announcement (source + source_id unique), with its SIREN, kind, date,
--    department, commune, postal code, the activity text it announces and its official URL.
-- 2. public.company_cache — one row per SIREN, expires_at = fetched_at + 30 days.
-- 3. public.public_event_runs — one row per collection (source, day, counts, status) for the administrator's follow-up.
-- No browser role reads or writes these tables (RLS on, no policy, no grant): only the server (service_role, the cron job)
-- through the functions below; the administrator's screens will read them through admin-only functions.
-- Nothing else is touched: no existing table, policy, function, entitlement, billing or evidence object changes.
--
-- Rollback: drop function public.ingest_public_events(text,date,jsonb,int,int), public.sirens_to_enrich(text[],text[],date,int),
--   public.upsert_company_cache(jsonb), public.purge_public_events(date);
--   drop table public.public_event_runs, public.company_cache, public.public_events;
begin;

create table if not exists public.public_events (
 id bigint generated always as identity primary key,
 source text not null check(source in ('bodacc')),
 source_id text not null check(length(source_id) between 1 and 80),
 kind text not null check(kind in ('CREATION','ETABLISSEMENT','TRANSFERT_SIEGE','VENTE_FONDS')),
 siren text not null check(siren ~ '^[0-9]{9}$'),
 name text check(name is null or length(name)<=200),
 published_on date not null,
 department text check(department is null or department ~ '^([0-9]{2,3}|2[AB])$'),
 commune text check(commune is null or length(commune)<=120),
 postal_code text check(postal_code is null or postal_code ~ '^[0-9]{5}$'),
 activity text check(activity is null or length(activity)<=500),
 source_url text not null check(source_url ~ '^https://[^\s]+$' and length(source_url)<=500),
 collected_at timestamptz not null default now(),
 unique(source,source_id)
);
create index if not exists public_events_dept_idx on public.public_events(department,published_on desc);
create index if not exists public_events_kind_idx on public.public_events(kind,published_on desc);
create index if not exists public_events_siren_idx on public.public_events(siren);

create table if not exists public.company_cache (
 siren text primary key check(siren ~ '^[0-9]{9}$'),
 name text check(name is null or length(name)<=200),
 naf text check(naf is null or naf ~ '^[0-9]{2}\.[0-9]{2}[A-Z]$'),
 legal_form text check(legal_form is null or legal_form ~ '^[0-9]{4}$'),
 employee_band text check(employee_band is null or employee_band ~ '^(NN|[0-9]{2})$'),
 active boolean not null,
 individual boolean not null,
 opposition boolean not null,
 department text check(department is null or department ~ '^([0-9]{2,3}|2[AB])$'),
 commune text check(commune is null or length(commune)<=120),
 fetched_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(not individual or name is null)
);

create table if not exists public.public_event_runs (
 id bigint generated always as identity primary key,
 source text not null,
 day date not null,
 fetched int not null default 0 check(fetched>=0),
 inserted int not null default 0 check(inserted>=0),
 skipped_persons int not null default 0 check(skipped_persons>=0),
 created_at timestamptz not null default now()
);
create index if not exists public_event_runs_day_idx on public.public_event_runs(day desc);

alter table public.public_events enable row level security;
alter table public.company_cache enable row level security;
alter table public.public_event_runs enable row level security;
revoke all on public.public_events,public.company_cache,public.public_event_runs from public,anon,authenticated;

-- p_events: [{source_id,kind,siren,name,published_on,department,commune,postal_code,activity,source_url}, …] — at most
-- 20 000 per call; an announcement already stored is left as it is (the collection can be replayed safely).
create or replace function public.ingest_public_events(p_source text,p_day date,p_events jsonb,p_fetched int,p_skipped_persons int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>20000 then raise exception 'Invalid events' using errcode='22023'; end if;
 with rows as (
  insert into public.public_events(source,source_id,kind,siren,name,published_on,department,commune,postal_code,activity,source_url)
  select p_source,e->>'source_id',e->>'kind',e->>'siren',nullif(left(e->>'name',200),''),(e->>'published_on')::date,nullif(e->>'department',''),
   nullif(left(e->>'commune',120),''),nullif(e->>'postal_code',''),nullif(left(e->>'activity',500),''),e->>'source_url'
  from jsonb_array_elements(p_events) e
  on conflict(source,source_id) do nothing returning 1)
 select count(*) into n from rows;
 insert into public.public_event_runs(source,day,fetched,inserted,skipped_persons) values(p_source,p_day,coalesce(p_fetched,0),n,coalesce(p_skipped_persons,0));
 return jsonb_build_object('inserted',n);
end $$;

-- SIRENs of recent events in the given departments and kinds whose company record is missing or expired — the
-- enrichment only follows what at least one client may receive.
create or replace function public.sirens_to_enrich(p_departments text[],p_kinds text[],p_since date,p_limit int) returns setof text
language sql stable security definer set search_path='' as $$
 select e.siren from public.public_events e left join public.company_cache c on c.siren=e.siren
 where e.published_on>=p_since and (p_departments is null or e.department=any(p_departments)) and (p_kinds is null or e.kind=any(p_kinds))
   and (c.siren is null or c.expires_at<now())
 group by e.siren order by max(e.published_on) desc limit greatest(0,least(coalesce(p_limit,0),5000))
$$;

create or replace function public.upsert_company_cache(p_rows jsonb) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception 'Invalid rows' using errcode='22023'; end if;
 insert into public.company_cache(siren,name,naf,legal_form,employee_band,active,individual,opposition,department,commune,fetched_at,expires_at)
 select r->>'siren',case when (r->>'individual')::boolean then null else nullif(left(r->>'name',200),'') end,nullif(r->>'naf',''),nullif(r->>'legal_form',''),
  nullif(r->>'employee_band',''),(r->>'active')::boolean,(r->>'individual')::boolean,(r->>'opposition')::boolean,nullif(r->>'department',''),
  nullif(left(r->>'commune',120),''),now(),now()+interval '30 days'
 from jsonb_array_elements(p_rows) r
 on conflict(siren) do update set name=excluded.name,naf=excluded.naf,legal_form=excluded.legal_form,employee_band=excluded.employee_band,
  active=excluded.active,individual=excluded.individual,opposition=excluded.opposition,department=excluded.department,commune=excluded.commune,
  fetched_at=excluded.fetched_at,expires_at=excluded.expires_at;
 get diagnostics n=row_count;
 return n;
end $$;

-- Retention: announcements and runs older than p_before are deleted (the veille only looks back a few months).
create or replace function public.purge_public_events(p_before date) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_before is null or p_before>current_date-30 then raise exception 'Invalid purge date' using errcode='22023'; end if;
 delete from public.public_events where published_on<p_before;get diagnostics n=row_count;
 delete from public.public_event_runs where day<p_before;
 delete from public.company_cache where expires_at<now()-interval '90 days';
 return n;
end $$;

revoke all on function public.ingest_public_events(text,date,jsonb,int,int),public.sirens_to_enrich(text[],text[],date,int),
 public.upsert_company_cache(jsonb),public.purge_public_events(date) from public,anon,authenticated;
grant execute on function public.ingest_public_events(text,date,jsonb,int,int),public.sirens_to_enrich(text[],text[],date,int),
 public.upsert_company_cache(jsonb),public.purge_public_events(date) to service_role;

commit;
