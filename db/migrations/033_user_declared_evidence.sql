-- UI-4 — USER_DECLARED evidence: an ICP criterion completed from what a person knows, WITHOUT a source.
-- Principle: USER_DECLARED ≠ VERIFIED. A declaration can help the estimated FIT (src/domain/fit-estimate.ts, manual
-- confidence 0.7); it is never a verified proof: scoreProspect (the verified FIT, CONTACT, Outreach) reads VERIFIED rows
-- with a real source only, so nothing here changes what is verified or quoted.
--
-- Additive and compatible with every existing row:
--  - evidence.status accepts 'USER_DECLARED' (the status check is re-created with the four existing values + this one);
--  - declared_by: the authenticated person who declared it, stamped by the guard trigger from auth.uid() — never sent by
--    the client, never verified_by (whose meaning, "a person checked the SOURCE", stays intact and stays null here);
--  - note: an optional short note (≤ 280), only on a declaration;
--  - shape: a declaration has a boolean value and an author, and NO source (source_url and excerpt are null): it is
--    never represented with a made-up, internal or borrowed URL.
-- Existing rows: status unchanged, declared_by and note null — every new check holds for them by construction.
--
-- Re-applicable: columns IF NOT EXISTS, every constraint dropped (if present) then re-created, the guard CREATE OR REPLACE.
-- Rollback (only while no USER_DECLARED row exists): drop the three constraints and the two columns, re-create the
-- status check without 'USER_DECLARED', and re-create prospectos_private.guard_record() as in 007.
begin;

alter table public.evidence add column if not exists declared_by uuid references auth.users(id);
alter table public.evidence add column if not exists note text;

-- The status check was created unnamed in db/schema.sql (evidence_status_check); find it by its definition so a
-- database where it carries another name is handled the same way.
do $$
declare c record;
begin
 for c in select conname from pg_constraint
  where conrelid='public.evidence'::regclass and contype='c'
   and pg_get_constraintdef(oid) like '%NOT_VERIFIED%' and pg_get_constraintdef(oid) like '%INFERRED_UNCONFIRMED%'
   and pg_get_constraintdef(oid) not like '%verified_by%'
 loop execute format('alter table public.evidence drop constraint %I',c.conname); end loop;
end $$;
alter table public.evidence add constraint evidence_status_check
 check(status in ('NOT_VERIFIED','VERIFIED','CONTRADICTED','INFERRED_UNCONFIRMED','USER_DECLARED'));

alter table public.evidence drop constraint if exists evidence_user_declared_shape;
alter table public.evidence add constraint evidence_user_declared_shape
 check(status<>'USER_DECLARED' or (value is not null and declared_by is not null and source_url is null and excerpt is null));
alter table public.evidence drop constraint if exists evidence_declared_by_only_declared;
alter table public.evidence add constraint evidence_declared_by_only_declared
 check(declared_by is null or status='USER_DECLARED');
alter table public.evidence drop constraint if exists evidence_note_only_declared;
alter table public.evidence add constraint evidence_note_only_declared
 check(note is null or (status='USER_DECLARED' and length(trim(note)) between 1 and 280));

-- The guard of 007, plus: a declaration needs a signed-in person and records who; any other status carries no author.
create or replace function prospectos_private.guard_record() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP = 'UPDATE' and (new.id <> old.id or new.organization_id <> old.organization_id) then
 raise exception 'Identity and tenant are immutable' using errcode='42501'; end if;
 if TG_TABLE_NAME = 'prospects' then new.updated_at := now(); end if;
 if TG_TABLE_NAME = 'evidence' then
  if new.status in ('VERIFIED','CONTRADICTED') then
   if auth.uid() is null then raise exception 'Human authentication required' using errcode='42501'; end if;
   new.verified_by := auth.uid();
  else new.verified_by := null; end if;
  if new.status = 'USER_DECLARED' then
   if auth.uid() is null then raise exception 'Human authentication required' using errcode='42501'; end if;
   new.declared_by := auth.uid();
  else new.declared_by := null; end if;
 end if;
 if TG_TABLE_NAME = 'outreach' and TG_OP = 'UPDATE' then
  if old.status in ('USED','DISCARDED') and (new.status is distinct from old.status or new.content is distinct from old.content) then
   raise exception 'A finalized outreach draft (USED/DISCARDED) is immutable' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_record() from public;

commit;
