-- 049 — Base entreprises de la veille: one company base by SIREN that grows instead of restarting from zero (owner request,
-- 18 nov. 2026). Everything already collected is joined by SIREN — the nightly BODACC collection (public_events), the
-- company record (company_cache), the référentiel lists (prospect_lists), the deliveries and what each client did with
-- them (dedicated_items: contacted, quote, signed, lost) — and leads are shared out between the clients of the veille:
--
-- 1. public.lead_profiles — what one client of the veille receives (one per contract): its trade (métier: e.g.
--    « sécurité incendie », « référencement IA »), departments, event kinds and NAF prefixes.
-- 2. public.lead_assignments — a lead reserved for a client. EXCLUSIVE PER TRADE (owner decision, 18 nov. 2026): while it
--    is reserved, no other client of the same trade can receive the company; a client of another trade can (Détec and
--    Capston may both receive the same hotel). A delivery reserves its companies automatically; delivering a company
--    reserved for another client of the same trade is refused.
-- 3. Administrator functions (INTERNAL ACTIVE only): set a profile, read the sorted pool of a client (business sales and
--    head-office moves first, then establishments, then creations; most recent first), reserve and release leads, read
--    one company's whole history.
-- Companies only, as in 045/046: the pool reads company_cache, where a sole trader has no name and an objecting company
-- is flagged — neither is ever proposed. No browser role reads or writes the tables; the client sees nothing new.
-- Nothing else is touched: no existing table, policy, entitlement, billing or evidence object changes; one trigger is
-- added on dedicated_items (insert only) to reserve what is delivered.
--
-- Rollback: drop trigger dedicated_items_reserve_lead on public.dedicated_items;
--   drop function prospectos_private.reserve_delivered_lead(), public.admin_set_lead_profile(uuid,text,text,text[],text[],text[]),
--   public.admin_lead_pool(uuid,int,int), public.admin_assign_leads(uuid,text[]), public.admin_release_lead(uuid),
--   public.admin_company(text), prospectos_private.lead_kind_rank(text);
--   drop table public.lead_assignments, public.lead_profiles;
begin;

create table if not exists public.lead_profiles (
 contract_id uuid primary key references public.dedicated_contracts(id) on delete cascade,
 trade_key text not null check(trade_key ~ '^[a-z0-9-]{2,40}$'),
 trade_label text not null check(length(trim(trade_label)) between 2 and 80),
 departments text[] not null check(cardinality(departments) between 1 and 120 and array_to_string(departments,',') ~ '^((\d{2,3}|2[AB]),)*(\d{2,3}|2[AB])$'),
 kinds text[] not null check(cardinality(kinds)>=1 and kinds <@ array['CREATION','ETABLISSEMENT','TRANSFERT_SIEGE','VENTE_FONDS','PROCEDURE_COLLECTIVE','INSPECTION_ICPE']),
 naf_prefixes text[] not null default '{}' check(cardinality(naf_prefixes)<=40 and (cardinality(naf_prefixes)=0 or array_to_string(naf_prefixes,',') ~ '^(\d{2}(\.\d{1,2}[A-Z]?)?,)*\d{2}(\.\d{1,2}[A-Z]?)?$')),
 updated_by uuid not null,
 updated_at timestamptz not null default now()
);

create table if not exists public.lead_assignments (
 id uuid primary key default gen_random_uuid(),
 siren text not null check(siren ~ '^[0-9]{9}$'),
 trade_key text not null check(trade_key ~ '^[a-z0-9-]{2,40}$'),
 contract_id uuid not null references public.dedicated_contracts(id) on delete cascade,
 source text not null check(source in ('RESERVED','DELIVERY')),
 dedicated_item_id uuid references public.dedicated_items(id) on delete set null,
 assigned_by uuid,
 assigned_at timestamptz not null default now(),
 released_at timestamptz,
 released_by uuid
);
-- Exclusivity: one live reservation per company and trade.
create unique index if not exists lead_assignments_live_idx on public.lead_assignments(siren,trade_key) where released_at is null;
create index if not exists lead_assignments_contract_idx on public.lead_assignments(contract_id,assigned_at desc);

alter table public.lead_profiles enable row level security;
alter table public.lead_assignments enable row level security;
revoke all on public.lead_profiles,public.lead_assignments from public,anon,authenticated;

create or replace function prospectos_private.lead_kind_rank(k text) returns int language sql immutable set search_path='' as $$
 select case k when 'VENTE_FONDS' then 1 when 'TRANSFERT_SIEGE' then 2 when 'ETABLISSEMENT' then 3 when 'CREATION' then 4 else 5 end
$$;

revoke all on function prospectos_private.lead_kind_rank(text) from public,anon,authenticated;

-- Profile of one client; setting it reserves, for this trade, every company already delivered to the client (on conflict:
-- left as it is — what another client of the trade already holds is reported, not taken).
create or replace function public.admin_set_lead_profile(p_contract_id uuid,p_trade_key text,p_trade_label text,p_departments text[],p_kinds text[],p_naf_prefixes text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts;n int;conflicts jsonb;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into c from public.dedicated_contracts where id=p_contract_id;
 if not found then raise exception 'lead_contract_not_found' using errcode='P0002'; end if;
 if p_trade_key is null or p_trade_label is null or coalesce(cardinality(p_departments),0)=0 or coalesce(cardinality(p_kinds),0)=0 then
  raise exception 'Invalid lead profile' using errcode='22023';
 end if;
 if exists(select 1 from public.lead_profiles where contract_id=c.id and trade_key<>lower(trim(p_trade_key)))
    and exists(select 1 from public.lead_assignments where contract_id=c.id and released_at is null) then
  raise exception 'lead_trade_locked' using errcode='P0001';
 end if;
 insert into public.lead_profiles(contract_id,trade_key,trade_label,departments,kinds,naf_prefixes,updated_by)
 values(c.id,lower(trim(p_trade_key)),trim(p_trade_label),(select array_agg(distinct upper(trim(d)) order by upper(trim(d))) from unnest(p_departments) d),
  (select array_agg(distinct k order by k) from unnest(p_kinds) k),coalesce((select array_agg(distinct trim(np) order by trim(np)) from unnest(p_naf_prefixes) np),'{}'),auth.uid())
 on conflict(contract_id) do update set trade_key=excluded.trade_key,trade_label=excluded.trade_label,departments=excluded.departments,kinds=excluded.kinds,
  naf_prefixes=excluded.naf_prefixes,updated_by=excluded.updated_by,updated_at=now();
 insert into public.lead_assignments(siren,trade_key,contract_id,source,dedicated_item_id,assigned_by,assigned_at)
 select i.siren,lower(trim(p_trade_key)),c.id,'DELIVERY',i.id,auth.uid(),i.created_at from public.dedicated_items i
 where i.contract_id=c.id and not exists(select 1 from public.lead_assignments a where a.siren=i.siren and a.trade_key=lower(trim(p_trade_key)) and a.released_at is null);
 get diagnostics n=row_count;
 select coalesce(jsonb_agg(i.siren order by i.siren),'[]') into conflicts from public.dedicated_items i
 where i.contract_id=c.id and exists(select 1 from public.lead_assignments a where a.siren=i.siren and a.trade_key=lower(trim(p_trade_key)) and a.released_at is null and a.contract_id<>c.id);
 return jsonb_build_object('contract_id',c.id,'reserved_from_deliveries',n,'held_by_another_client',conflicts);
end $$;

-- The sorted pool of one client: active companies of its departments, event kinds and NAF prefixes, never opposed to
-- prospecting, never a sole trader, not yet delivered to it and not reserved for another client of its trade.
create or replace function public.admin_lead_pool(p_contract_id uuid,p_days int,p_limit int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.lead_profiles;rows jsonb;waiting int;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into p from public.lead_profiles where contract_id=p_contract_id;
 if not found then raise exception 'lead_profile_missing' using errcode='P0001'; end if;
 if p_days is null or p_days<1 or p_days>400 or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid pool request' using errcode='22023'; end if;
 with ev as (
  select e.* from public.public_events e
  where e.published_on>=current_date-p_days and e.kind=any(p.kinds)
 ), cand as (
  select ev.siren,min(prospectos_private.lead_kind_rank(ev.kind)) best_rank,max(ev.published_on) last_on,count(*) events,
   (array_agg(ev.kind order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] kind,
   (array_agg(ev.source_url order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] source_url,
   (array_agg(ev.published_on order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] event_on,
   (array_agg(coalesce(ev.department,c.department) order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] department,
   (array_agg(coalesce(ev.commune,c.commune) order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] commune,
   (array_agg(ev.activity order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] activity
  from ev join public.company_cache c on c.siren=ev.siren
  where c.active and not c.individual and not c.opposition and coalesce(ev.department,c.department)=any(p.departments)
    and (cardinality(p.naf_prefixes)=0 or exists(select 1 from unnest(p.naf_prefixes) n where c.naf like n||'%'))
    and not exists(select 1 from public.dedicated_items i where i.contract_id=p.contract_id and i.siren=ev.siren)
    and not exists(select 1 from public.lead_assignments a where a.siren=ev.siren and a.trade_key=p.trade_key and a.released_at is null and a.contract_id<>p.contract_id)
  group by ev.siren
 )
 select coalesce(jsonb_agg(jsonb_build_object('siren',x.siren,'name',c.name,'naf',c.naf,'employee_band',c.employee_band,'department',x.department,'commune',x.commune,
   'kind',x.kind,'event_on',x.event_on,'source_url',x.source_url,'activity',x.activity,'events',x.events,
   'reserved',exists(select 1 from public.lead_assignments a where a.siren=x.siren and a.trade_key=p.trade_key and a.released_at is null and a.contract_id=p.contract_id),
   'other_trades',(select count(distinct a.trade_key) from public.lead_assignments a where a.siren=x.siren and a.released_at is null and a.trade_key<>p.trade_key),
   'lists',(select count(distinct i.list_id) from public.prospect_list_items i where i.siren=x.siren))
   order by x.best_rank,x.last_on desc,c.employee_band desc nulls last,x.siren),'[]')
 into rows from (select * from cand order by best_rank,last_on desc,siren limit p_limit) x join public.company_cache c on c.siren=x.siren;
 -- Companies of the profile still waiting for their record (the nightly enrichment): not proposed yet, only counted.
 select count(distinct e.siren) into waiting from public.public_events e left join public.company_cache c on c.siren=e.siren
 where e.published_on>=current_date-p_days and e.kind=any(p.kinds) and e.department=any(p.departments) and c.siren is null;
 return jsonb_build_object('profile',to_jsonb(p)-'updated_by','leads',rows,'waiting_enrichment',waiting);
end $$;

-- Reserve leads for a client: what another client of the same trade holds is reported, never taken.
create or replace function public.admin_assign_leads(p_contract_id uuid,p_sirens text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.lead_profiles;n int;taken jsonb;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into p from public.lead_profiles where contract_id=p_contract_id;
 if not found then raise exception 'lead_profile_missing' using errcode='P0001'; end if;
 if p_sirens is null or cardinality(p_sirens) not between 1 and 500 or exists(select 1 from unnest(p_sirens) s where s!~'^[0-9]{9}$') then
  raise exception 'Invalid SIREN list' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(distinct s),'[]') into taken from unnest(p_sirens) s
 where exists(select 1 from public.lead_assignments a where a.siren=s and a.trade_key=p.trade_key and a.released_at is null and a.contract_id<>p.contract_id);
 insert into public.lead_assignments(siren,trade_key,contract_id,source,assigned_by)
 select distinct s,p.trade_key,p.contract_id,'RESERVED',auth.uid() from unnest(p_sirens) s
 where not exists(select 1 from public.lead_assignments a where a.siren=s and a.trade_key=p.trade_key and a.released_at is null)
 on conflict do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('reserved',n,'held_by_another_client',taken);
end $$;

-- Release a reservation (e.g. the client will not use it): the company goes back to the pool of its trade. A delivered
-- lead is released only by the administrator, explicitly, and stays in the client's own space.
create or replace function public.admin_release_lead(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.lead_assignments;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 update public.lead_assignments set released_at=now(),released_by=auth.uid() where id=p_assignment_id and released_at is null returning * into a;
 if not found then raise exception 'lead_assignment_not_found' using errcode='P0002'; end if;
 return jsonb_build_object('id',a.id,'released_at',a.released_at);
end $$;

-- One company, everything known about it: record, official events, lists, reservations and what each client did with it.
create or replace function public.admin_company(p_siren text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_siren is null or p_siren!~'^[0-9]{9}$' then raise exception 'Invalid SIREN' using errcode='22023'; end if;
 return jsonb_build_object(
  'siren',p_siren,
  'company',(select to_jsonb(c)-'fetched_at'-'expires_at' from public.company_cache c where c.siren=p_siren),
  'events',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'published_on',e.published_on,'department',e.department,'commune',e.commune,'activity',e.activity,'source_url',e.source_url)
    order by e.published_on desc) from public.public_events e where e.siren=p_siren),'[]'),
  'lists',coalesce((select jsonb_agg(jsonb_build_object('code',l.code,'title',l.title,'produced_on',l.produced_on) order by l.produced_on desc)
    from public.prospect_lists l where exists(select 1 from public.prospect_list_items i where i.list_id=l.id and i.siren=p_siren)),'[]'),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'trade_key',a.trade_key,'contract_id',a.contract_id,'client',k.label,'source',a.source,
    'assigned_at',a.assigned_at,'released_at',a.released_at,'status',i.status,'delivered_on',i.delivered_on) order by a.assigned_at desc)
    from public.lead_assignments a join public.dedicated_contracts k on k.id=a.contract_id left join public.dedicated_items i on i.id=a.dedicated_item_id where a.siren=p_siren),'[]'));
end $$;

-- A delivery reserves its companies for the client's trade; delivering a company reserved for another client of the same
-- trade is refused (the exclusivity holds whatever the way the list was made). Without a profile: nothing changes.
create or replace function prospectos_private.reserve_delivered_lead() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.lead_profiles;
begin
 select * into p from public.lead_profiles where contract_id=new.contract_id;
 if not found then return new; end if;
 if exists(select 1 from public.lead_assignments a where a.siren=new.siren and a.trade_key=p.trade_key and a.released_at is null and a.contract_id<>new.contract_id) then
  raise exception 'lead_reserved_for_other_client: %',new.siren using errcode='P0001';
 end if;
 update public.lead_assignments set dedicated_item_id=new.id,source='DELIVERY'
  where siren=new.siren and trade_key=p.trade_key and contract_id=new.contract_id and released_at is null;
 if not found then
  insert into public.lead_assignments(siren,trade_key,contract_id,source,dedicated_item_id,assigned_by) values(new.siren,p.trade_key,new.contract_id,'DELIVERY',new.id,auth.uid());
 end if;
 return new;
end $$;
revoke all on function prospectos_private.reserve_delivered_lead() from public,anon,authenticated;
drop trigger if exists dedicated_items_reserve_lead on public.dedicated_items;
create trigger dedicated_items_reserve_lead after insert on public.dedicated_items for each row execute function prospectos_private.reserve_delivered_lead();

revoke all on function public.admin_set_lead_profile(uuid,text,text,text[],text[],text[]),public.admin_lead_pool(uuid,int,int),
 public.admin_assign_leads(uuid,text[]),public.admin_release_lead(uuid),public.admin_company(text) from public,anon;
grant execute on function public.admin_set_lead_profile(uuid,text,text,text[],text[],text[]),public.admin_lead_pool(uuid,int,int),
 public.admin_assign_leads(uuid,text[]),public.admin_release_lead(uuid),public.admin_company(text) to authenticated;

commit;
