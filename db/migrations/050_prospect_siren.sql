-- 050 — The SIREN on the prospect record (owner request, 18 nov. 2026: ProspectOS enriches what it already knows, like a
-- CRM, instead of starting again at each search). Until now the SIREN was known at search time (register results:
-- dedupe key « siren:<n> ») and when the public registers identified a prospect (REGISTRY_IDENTITY observation), but it was
-- not kept on the record: a company found again was recognised only by its website, its phone or its name.
--
-- 1. public.prospects.siren — nullable, 9 digits, unique within a project (one company, one record per project).
-- 2. Filled automatically, never guessed:
--    - when a prospect is created from a register result (its dedupe key « siren:<n> »);
--    - when the public registers identify it (src/discovery/public-records.ts writes it, as the member who ran it, like
--      the city: only while the record has none);
--    in both cases only if no other prospect of the project already has that SIREN (the record is never moved).
--    A member can also set it by hand (the usual update right on prospects; the format is checked).
-- 3. Backfill from the same two sources, for a prospect whose source gives exactly one SIREN not taken in its project.
-- The search side (src/discovery: deduplication.ts and the « already seen » matching) reads it: the same SIREN is the same company,
-- two different SIRENs are two companies — whatever the websites or the names say.
-- Nothing else is touched: no policy, entitlement, billing or evidence object changes; one trigger (before insert on
-- prospects) only fills the new column.
--
-- Rollback: drop trigger prospects_siren_from_key on public.prospects; drop function prospectos_private.siren_from_dedupe_key();
--   drop index public.prospects_project_siren_idx; alter table public.prospects drop column siren;
begin;

alter table public.prospects add column if not exists siren text;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='prospects_siren_format') then
  alter table public.prospects add constraint prospects_siren_format check(siren is null or siren ~ '^[0-9]{9}$');
 end if;
end $$;
create unique index if not exists prospects_project_siren_idx on public.prospects(project_id,siren) where siren is not null;

-- A register result's dedupe key « siren:<n> » (with « |separate:… » when kept apart on purpose: then no SIREN, the
-- person decided it is another record).
create or replace function prospectos_private.siren_from_dedupe_key() returns trigger language plpgsql security invoker set search_path='' as $$
declare s text;
begin
 if new.siren is null and new.discovery_dedupe_key ~ '^siren:[0-9]{9}$' then
  s:=substr(new.discovery_dedupe_key,7,9);
  if not exists(select 1 from public.prospects p where p.project_id=new.project_id and p.siren=s and p.id<>new.id) then new.siren:=s; end if;
 end if;
 return new;
end $$;
revoke all on function prospectos_private.siren_from_dedupe_key() from public,anon,authenticated;
drop trigger if exists prospects_siren_from_key on public.prospects;
create trigger prospects_siren_from_key before insert on public.prospects for each row execute function prospectos_private.siren_from_dedupe_key();

-- Backfill: one SIREN per prospect from its own sources, the first record of a project keeping it when two claim the
-- same company (the other stays without, as today). Written as the table owner: the audit trigger of prospects needs a
-- member, so it is switched off for this one statement only.
alter table public.prospects disable trigger user;
with src as (
 select p.id,p.project_id,p.created_at,
  coalesce(case when p.discovery_dedupe_key ~ '^siren:[0-9]{9}$' then substr(p.discovery_dedupe_key,7,9) end,
   (select min(right(o.source_url,9)) from public.prospect_observations o where o.prospect_id=p.id and o.observation_type='REGISTRY_IDENTITY'
     and o.source_url ~ '^https://annuaire-entreprises\.data\.gouv\.fr/entreprise/[0-9]{9}$'
    having count(distinct right(o.source_url,9))=1)) s
 from public.prospects p where p.siren is null
), ranked as (
 select id,s,row_number() over(partition by project_id,s order by created_at,id) n from src
 where s is not null and not exists(select 1 from public.prospects q where q.project_id=src.project_id and q.siren=src.s)
)
update public.prospects p set siren=r.s from ranked r where p.id=r.id and r.n=1;
alter table public.prospects enable trigger user;

commit;
