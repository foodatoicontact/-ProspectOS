-- 058 — Les cédants dans les reprises (BODACC « Ventes et cessions »), décision du propriétaire du 26 nov. 2026
-- (src/domain/bodacc-seller.ts, docs/BODACC_RACHATS.md). Use case: franchise recruiters looking for restaurateurs who have
-- just sold their business.
--
-- 1. public.public_events gains, for a sale (VENTE_FONDS) only:
--      seller_kind   'PM' (a company identified by its SIREN), 'PP' (a natural person: nothing else is stored, the sale
--                    shows « cédant : personne physique, non affiché »), 'UNKNOWN' (the notice does not say), or null
--                    (not read yet);
--      seller_siren  the company's SIREN, for 'PM' only (checked: never set for any other kind).
--    Nothing else of the seller is stored: no name, no address, no text — the company's name, activity (NAF) and place
--    come from the company register (public.company_cache), like any company. The BODACC link is the sale's source_url.
-- 2. public.ingest_public_events (055's body) stores those two fields from the nightly collection.
-- 3. public.set_public_event_sellers — the backfill of the sales already stored (server only): fills a sale's seller once,
--    never overwrites a seller already read.
-- 4. public.sirens_to_enrich also returns the sellers ('PM') of the sales, in every department (a few dozen a day): the
--    register tells their name, activity and place, and whether the « company » is in fact a sole trader (individual),
--    in which case it is never shown.
-- 5. public.sale_sellers — the search « Entreprises ayant cédé un fonds » (server only, called by the BODACC search
--    provider): the companies that sold a business in the given departments and period, optionally of given NAF codes
--    (56 = restauration). Only ACTIVE sales of kind VENTE_FONDS (055: mergers, contributions, forced sales, undetermined
--    and cancelled notices are excluded), only sellers the register knows as companies (never individual), never a company
--    that objects to prospecting. One row per seller: its latest sale.
--
-- 6. The sales history: prospectos_private.sale_backfill_days and public.sale_days_to_backfill / mark_sale_backfill_day —
--    the nightly job app/api/cron/sales-backfill reads again the « vente » days of the last 180 days (weekdays, a few a
--    night), so the search covers its period and every stored sale gets its seller (a sale read again only gains its
--    seller: ingest_public_events never changes anything else of a stored row).
-- Nothing else changes: no policy, entitlement, billing or evidence object is touched; no existing row loses data.
-- Rollback: restore ingest_public_events from 055 and sirens_to_enrich from 045; drop function public.set_public_event_sellers(jsonb),
--   public.sale_sellers(text[],date,text[],int), public.sale_days_to_backfill(date,date,int), public.mark_sale_backfill_day(date,int);
--   drop table prospectos_private.sale_backfill_days; alter table public.public_events drop column seller_kind, drop column seller_siren;
begin;

alter table public.public_events add column if not exists seller_kind text;
alter table public.public_events add column if not exists seller_siren text;
alter table public.public_events drop constraint if exists public_events_seller_check;
alter table public.public_events add constraint public_events_seller_check check(
 (seller_kind is null or seller_kind in ('PM','PP','UNKNOWN'))
 and (seller_kind is null or kind in ('VENTE_FONDS','FUSION','APPORT','VENTE_JUDICIAIRE','INDETERMINE'))
 and ((seller_kind='PM')=(seller_siren is not null))
 and (seller_siren is null or seller_siren ~ '^[0-9]{9}$'));
create index if not exists public_events_seller_idx on public.public_events(seller_siren) where seller_siren is not null;

create or replace function public.ingest_public_events(p_source text,p_day date,p_events jsonb,p_fetched int,p_skipped_persons int,
 p_sale_rules jsonb default '{}'::jsonb,p_supersessions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int; rules jsonb:=coalesce(p_sale_rules,'{}'::jsonb); sup jsonb:=coalesce(p_supersessions,'[]'::jsonb); applied int:=0;
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>20000 then raise exception 'Invalid events' using errcode='22023'; end if;
 if jsonb_typeof(rules)<>'object' or (select count(*) from jsonb_object_keys(rules))>32
  or exists(select 1 from jsonb_each(rules) r where r.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(r.value)<>'number'
   or (r.value)::numeric<0 or (r.value)::numeric>100000 or (r.value)::numeric<>trunc((r.value)::numeric))
 then raise exception 'Invalid sale rules' using errcode='22023'; end if;
 if jsonb_typeof(sup)<>'array' or jsonb_array_length(sup)>5000 or exists(select 1 from jsonb_array_elements(sup) r
   where not (r->>'status')=any(array['ANNULEE','RECTIFIEE']) or coalesce(r->>'target_source_id','')='' or coalesce(r->>'by_source_id','')=''
   or length(r->>'target_source_id')>80 or length(r->>'by_source_id')>80 or coalesce(r->>'by_url','https://x') !~ '^https://[^\s]+$')
 then raise exception 'Invalid supersessions' using errcode='22023'; end if;
 with rows as (
  insert into public.public_events(source,source_id,kind,siren,name,published_on,department,commune,postal_code,activity,source_url,sale_rule,seller_kind,seller_siren)
  select p_source,e->>'source_id',e->>'kind',e->>'siren',nullif(left(e->>'name',200),''),(e->>'published_on')::date,nullif(e->>'department',''),
   nullif(left(e->>'commune',120),''),nullif(e->>'postal_code',''),nullif(left(e->>'activity',500),''),e->>'source_url',nullif(e->>'sale_rule',''),
   nullif(e->>'seller_kind',''),case when e->>'seller_kind'='PM' then nullif(e->>'seller_siren','') end
  from jsonb_array_elements(p_events) e
  -- A sale read again (the backfill below) gives its seller to the row already stored, once; nothing else is changed.
  on conflict(source,source_id) do update set seller_kind=excluded.seller_kind,seller_siren=excluded.seller_siren
   where public.public_events.seller_kind is null and excluded.seller_kind is not null
  returning (xmax=0) inserted)
 select count(*) filter (where inserted) into n from rows;
 insert into public.public_event_supersessions(source,target_source_id,status,by_source_id,by_url)
 select p_source,r->>'target_source_id',r->>'status',r->>'by_source_id',nullif(r->>'by_url','') from jsonb_array_elements(sup) r
 on conflict(source,target_source_id,by_source_id) do update set status=excluded.status,by_url=excluded.by_url,reverted_at=null
  where public.public_event_supersessions.reverted_at is not null;
 applied:=prospectos_private.apply_public_event_supersessions(p_source,'collect',null);
 insert into public.public_event_runs(source,day,fetched,inserted,skipped_persons,sale_rules)
  values(p_source,p_day,coalesce(p_fetched,0),n,coalesce(p_skipped_persons,0),rules);
 return jsonb_build_object('inserted',n,'superseded',applied);
end $$;

-- The sales history (owner decision, 26 nov. 2026): the BODACC « vente » days of the last 180 days are read again, a few per
-- night (app/api/cron/sales-backfill), so the search covers the period it offers and every stored sale gets its seller.
-- One row per day read; a day is read once.
create table if not exists prospectos_private.sale_backfill_days (
 day date primary key,
 fetched int not null check(fetched>=0),
 done_at timestamptz not null default now()
);
revoke all on prospectos_private.sale_backfill_days from public,anon,authenticated;
create or replace function public.sale_days_to_backfill(p_since date,p_until date,p_limit int) returns setof date
language sql stable security definer set search_path='' as $$
 select d::date from generate_series(p_until,p_since,interval '-1 day') d
 where p_since>=current_date-400 and p_until<current_date and extract(isodow from d) between 1 and 5
   and not exists(select 1 from prospectos_private.sale_backfill_days b where b.day=d::date)
 order by d desc limit greatest(0,least(coalesce(p_limit,0),60))
$$;
create or replace function public.mark_sale_backfill_day(p_day date,p_fetched int) returns void
language sql security definer set search_path='' as $$
 insert into prospectos_private.sale_backfill_days(day,fetched) values(p_day,greatest(coalesce(p_fetched,0),0))
 on conflict(day) do update set fetched=excluded.fetched,done_at=now()
$$;

-- The backfill: [{source_id, seller_kind, seller_siren}] — a sale's seller is set once, never overwritten.
create or replace function public.set_public_event_sellers(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>20000 then raise exception 'Invalid sellers' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where not coalesce(r->>'seller_kind','')=any(array['PM','PP','UNKNOWN'])
   or ((r->>'seller_kind')='PM')<>(coalesce(r->>'seller_siren','') ~ '^[0-9]{9}$') or ((r->>'seller_kind')<>'PM' and r ? 'seller_siren' and r->>'seller_siren' is not null))
 then raise exception 'Invalid sellers' using errcode='22023'; end if;
 update public.public_events e set seller_kind=r->>'seller_kind',seller_siren=case when r->>'seller_kind'='PM' then r->>'seller_siren' end
 from jsonb_array_elements(p_rows) r
 where e.source='bodacc' and e.source_id=r->>'source_id' and e.seller_kind is null
   and e.kind in ('VENTE_FONDS','FUSION','APPORT','VENTE_JUDICIAIRE','INDETERMINE');
 get diagnostics n=row_count;
 return jsonb_build_object('updated',n);
end $$;

-- 045's selection, plus the sellers of the sales (every department; the register tells whether each is really a company).
create or replace function public.sirens_to_enrich(p_departments text[],p_kinds text[],p_since date,p_limit int) returns setof text
language sql stable security definer set search_path='' as $$
 with wanted as (
  select e.siren,e.published_on from public.public_events e
  where e.published_on>=p_since and (p_departments is null or e.department=any(p_departments)) and (p_kinds is null or e.kind=any(p_kinds))
  union all
  select e.seller_siren,e.published_on from public.public_events e
  where e.seller_siren is not null and e.kind='VENTE_FONDS' and e.published_on>=p_since and (p_kinds is null or 'VENTE_FONDS'=any(p_kinds))
 )
 select w.siren from wanted w left join public.company_cache c on c.siren=w.siren
 where c.siren is null or c.expires_at<now()
 group by w.siren order by max(w.published_on) desc limit greatest(0,least(coalesce(p_limit,0),5000))
$$;

-- « Entreprises ayant cédé un fonds »: p_departments (required, at most 130), p_since (at most 400 days back),
-- p_naf_prefixes ('56', '56.10', '56.10A'…; empty = every activity).
create or replace function public.sale_sellers(p_departments text[],p_since date,p_naf_prefixes text[],p_limit int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lim int:=greatest(1,least(coalesce(p_limit,100),500)); r jsonb;
begin
 if p_departments is null or cardinality(p_departments) not between 1 and 130 or exists(select 1 from unnest(p_departments) d where d !~ '^([0-9]{2,3}|2[AB])$')
  or p_since is null or p_since<current_date-400 or p_since>current_date
  or exists(select 1 from unnest(coalesce(p_naf_prefixes,'{}'::text[])) n where n !~ '^[0-9]{2}(\.[0-9]{1,2}[A-Z]?)?$') or cardinality(coalesce(p_naf_prefixes,'{}'::text[]))>20
 then raise exception 'Invalid seller search' using errcode='22023'; end if;
 with sales as (
  select distinct on (e.seller_siren) e.seller_siren,e.source_id,e.published_on,e.source_url,e.activity,e.department sale_department,e.commune sale_commune
  from public.public_events e
  where e.kind='VENTE_FONDS' and e.status='ACTIVE' and e.seller_kind='PM' and e.published_on>=p_since and e.department=any(p_departments)
  order by e.seller_siren,e.published_on desc,e.id desc
 )
 select coalesce(jsonb_agg(x order by (x->'sale'->>'published') desc,x->>'siren'),'[]'::jsonb) into r from (
  select jsonb_build_object('siren',s.seller_siren,'name',c.name,'naf',c.naf,'department',c.department,'commune',c.commune,'active',c.active,
   'sale',jsonb_build_object('notice_id',s.source_id,'published',s.published_on,'url',s.source_url,'activity',s.activity,'department',s.sale_department,'commune',s.sale_commune)) x
  from sales s join public.company_cache c on c.siren=s.seller_siren
  where not c.individual and not c.opposition and c.name is not null
    and (cardinality(coalesce(p_naf_prefixes,'{}'::text[]))=0 or exists(select 1 from unnest(p_naf_prefixes) n where c.naf like n||'%'))
  order by s.published_on desc,s.seller_siren limit lim) t;
 return r;
end $$;

revoke all on function public.ingest_public_events(text,date,jsonb,int,int,jsonb,jsonb),public.set_public_event_sellers(jsonb),
 public.sirens_to_enrich(text[],text[],date,int),public.sale_sellers(text[],date,text[],int),public.sale_days_to_backfill(date,date,int),
 public.mark_sale_backfill_day(date,int) from public,anon,authenticated;
grant execute on function public.ingest_public_events(text,date,jsonb,int,int,jsonb,jsonb),public.set_public_event_sellers(jsonb),
 public.sirens_to_enrich(text[],text[],date,int),public.sale_sellers(text[],date,text[],int),public.sale_days_to_backfill(date,date,int),
 public.mark_sale_backfill_day(date,int) to service_role;

commit;
