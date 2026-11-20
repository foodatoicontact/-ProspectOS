-- 046 — Référentiel des listes (src/collect, docs/RGPD_REFERENTIEL.md). Every list produced for a client (a delivery of the
-- veille dédiée, a one-off list) enriches ProspectOS instead of staying an isolated PDF: the companies and their dated,
-- sourced events join the shared store of migration 045, and the list keeps which companies it held, in which order.
-- The store then knows what is already known about a company, and which client already received it.
--
-- Companies only — never a natural person: no executive, no sole trader, no personal address. An item whose company is a
-- sole trader or objects to commercial prospecting (statut de diffusion / opposition) is NOT stored: it is only counted.
--
-- 1. public_events gains two kinds and one source: PROCEDURE_COLLECTIVE (safeguard, receivership, plan — BODACC) and
--    INSPECTION_ICPE (classified installations — Géorisques).
-- 2. public.prospect_lists — one row per list: code, title, purpose, zone, client label (a company or a neutral label,
--    never a person), production date, counts, retention date (3 years).
-- 3. public.prospect_list_items — the companies of a list, in its order, each with the event that justified it.
-- 4. import_prospect_list(jsonb) (server only): stores a list, its companies (company_cache) and events (public_events),
--    idempotent on the list code. admin_prospect_lists() (INTERNAL only): the lists and their counts.
--    purge_prospect_lists() (server only): deletes the lists past their retention date.
-- No browser role reads or writes these tables. Nothing else is touched.
--
-- Rollback: drop function public.import_prospect_list(jsonb), public.admin_prospect_lists(), public.purge_prospect_lists();
--   drop table public.prospect_list_items, public.prospect_lists; restore the two checks of public_events (045).
begin;

alter table public.public_events drop constraint if exists public_events_source_check;
alter table public.public_events add constraint public_events_source_check check(source in ('bodacc','georisques'));
alter table public.public_events drop constraint if exists public_events_kind_check;
alter table public.public_events add constraint public_events_kind_check
 check(kind in ('CREATION','ETABLISSEMENT','TRANSFERT_SIEGE','VENTE_FONDS','PROCEDURE_COLLECTIVE','INSPECTION_ICPE'));

create table if not exists public.prospect_lists (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code ~ '^[a-z0-9-]{3,80}$'),
 title text not null check(length(trim(title)) between 1 and 200),
 purpose text check(purpose is null or length(purpose)<=500),
 zone text check(zone is null or length(zone)<=200),
 client_label text check(client_label is null or length(client_label)<=160),
 client_organization_id uuid references public.organizations(id) on delete set null,
 produced_on date not null,
 items int not null default 0 check(items>=0),
 excluded int not null default 0 check(excluded>=0),
 keep_until date not null,
 created_at timestamptz not null default now()
);
create table if not exists public.prospect_list_items (
 list_id uuid not null references public.prospect_lists(id) on delete cascade,
 position int not null check(position>=1),
 siren text not null check(siren ~ '^[0-9]{9}$'),
 event_source text,
 event_source_id text,
 primary key(list_id,position)
);
create index if not exists prospect_list_items_siren_idx on public.prospect_list_items(siren);

alter table public.prospect_lists enable row level security;
alter table public.prospect_list_items enable row level security;
revoke all on public.prospect_lists,public.prospect_list_items from public,anon,authenticated;

-- p_list: {code,title,purpose?,zone?,client_label?,client_organization_id?,produced_on,
--   items:[{siren, company:{name,naf,legal_form,employee_band,active,individual,opposition,department,commune},
--           event?:{source,source_id,kind,published_on,name?,department?,commune?,postal_code?,activity?,source_url}}]}
-- Items keep the list's order; a sole trader or a company objecting to prospecting is left out (counted in `excluded`).
create or replace function public.import_prospect_list(p_list jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.prospect_lists; it jsonb; c jsonb; e jsonb; pos int:=0; kept int:=0; skipped int:=0;
begin
 if p_list is null or jsonb_typeof(p_list->'items')<>'array' or jsonb_array_length(p_list->'items')>5000 then raise exception 'Invalid list' using errcode='22023'; end if;
 select * into l from public.prospect_lists where code=p_list->>'code';
 if found then return jsonb_build_object('id',l.id,'code',l.code,'items',l.items,'excluded',l.excluded,'already',true); end if;
 insert into public.prospect_lists(code,title,purpose,zone,client_label,client_organization_id,produced_on,keep_until)
 values(p_list->>'code',p_list->>'title',nullif(p_list->>'purpose',''),nullif(p_list->>'zone',''),nullif(p_list->>'client_label',''),
  nullif(p_list->>'client_organization_id','')::uuid,(p_list->>'produced_on')::date,((p_list->>'produced_on')::date+interval '3 years')::date) returning * into l;
 for it in select value from jsonb_array_elements(p_list->'items') loop
  c:=it->'company';e:=it->'event';
  if c is null or coalesce((c->>'individual')::boolean,true) or coalesce((c->>'opposition')::boolean,true) then skipped:=skipped+1; continue; end if;
  insert into public.company_cache(siren,name,naf,legal_form,employee_band,active,individual,opposition,department,commune,fetched_at,expires_at)
  values(it->>'siren',nullif(left(c->>'name',200),''),nullif(c->>'naf',''),nullif(c->>'legal_form',''),nullif(c->>'employee_band',''),
   coalesce((c->>'active')::boolean,true),false,false,nullif(c->>'department',''),nullif(left(c->>'commune',120),''),now(),now()+interval '30 days')
  on conflict(siren) do update set name=excluded.name,naf=excluded.naf,legal_form=excluded.legal_form,employee_band=excluded.employee_band,active=excluded.active,
   individual=false,opposition=false,department=excluded.department,commune=excluded.commune,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at;
  if e is not null then
   insert into public.public_events(source,source_id,kind,siren,name,published_on,department,commune,postal_code,activity,source_url)
   values(e->>'source',e->>'source_id',e->>'kind',it->>'siren',nullif(left(e->>'name',200),''),(e->>'published_on')::date,nullif(e->>'department',''),
    nullif(left(e->>'commune',120),''),nullif(e->>'postal_code',''),nullif(left(e->>'activity',500),''),e->>'source_url')
   on conflict(source,source_id) do nothing;
  end if;
  pos:=pos+1;
  insert into public.prospect_list_items(list_id,position,siren,event_source,event_source_id) values(l.id,pos,it->>'siren',e->>'source',e->>'source_id');
  kept:=kept+1;
 end loop;
 update public.prospect_lists set items=kept,excluded=skipped where id=l.id;
 return jsonb_build_object('id',l.id,'code',l.code,'items',kept,'excluded',skipped,'already',false);
end $$;

create or replace function public.admin_prospect_lists() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'code',l.code,'title',l.title,'purpose',l.purpose,'zone',l.zone,'client_label',l.client_label,
   'produced_on',l.produced_on,'items',l.items,'excluded',l.excluded,'keep_until',l.keep_until) order by l.produced_on desc,l.code) from public.prospect_lists l),'[]'::jsonb);
end $$;

create or replace function public.purge_prospect_lists() returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 delete from public.prospect_lists where keep_until<current_date;get diagnostics n=row_count;
 return n;
end $$;

revoke all on function public.import_prospect_list(jsonb),public.admin_prospect_lists(),public.purge_prospect_lists() from public,anon,authenticated;
grant execute on function public.import_prospect_list(jsonb),public.purge_prospect_lists() to service_role;
grant execute on function public.admin_prospect_lists() to authenticated;

commit;
