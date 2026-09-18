-- BLOC 3 — red-team fixes M1 (at most one live DRAFT per prospect, enforced in the database,
-- immune to two concurrent generations) and M2 (USED/DISCARDED outreach rows are terminal: neither
-- their status nor their content can be mutated again, enforced in the database as well as the API).
-- Additive/idempotent only: no existing column, allowed value, or trigger is removed.
begin;

-- M1: a partial unique index is the standard, minimal Postgres primitive for "at most one row per
-- key matching a condition" — no advisory lock, no new table, no rewritten insert flow. The existing
-- discard-then-insert sequence in the API is unchanged; this index is what actually prevents two
-- concurrent generations from both ending up with a live DRAFT, whichever one loses the race gets a
-- clean unique-violation (23505) that the API turns into a controlled 409, never a raw SQL exception.
create unique index if not exists outreach_one_draft_per_prospect
 on public.outreach(organization_id,prospect_id) where status='DRAFT';

-- M2: reuses the existing prospects/evidence immutability guard instead of inventing a parallel
-- mechanism. Adds one outreach-specific branch: once a draft is USED or DISCARDED, neither its
-- status nor its content may change again — DRAFT and APPROVED remain fully editable (APPROVED is
-- kept exactly as safe as DRAFT here: this patch introduces no new UI or transition for it, only
-- defines that reaching it never unlocks anything a DRAFT couldn't already do, and never re-locks
-- less than USED/DISCARDED already did).
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
 end if;
 if TG_TABLE_NAME = 'outreach' and TG_OP = 'UPDATE' then
  if old.status in ('USED','DISCARDED') and (new.status is distinct from old.status or new.content is distinct from old.content) then
   raise exception 'A finalized outreach draft (USED/DISCARDED) is immutable' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_record() from public;
drop trigger if exists outreach_guard on public.outreach;
create trigger outreach_guard before insert or update on public.outreach
 for each row execute function prospectos_private.guard_record();

commit;
