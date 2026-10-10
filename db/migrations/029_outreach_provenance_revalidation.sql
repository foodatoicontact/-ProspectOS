-- O1/O2 — provenance at the moment of use (staging canary 2026-10-10: a message citing a public content kept being
-- approvable after a person rejected that content). Additive: 027 and 028 are unchanged.
--
-- 027 lets a message cite only public content and signals that are VERIFIED when the message is created. Afterwards a
-- person may reject a cited public content, send it back to review or delete it; a cited signal may be rejected, sent
-- back to review or purged. The message itself is never rewritten (its text and its frozen angle stay as they were) and
-- it may still be edited, discarded or regenerated — but it can no longer be approved (DRAFT → APPROVED) nor copied
-- (APPROVED → USED) while one of its sources is not verified.
--
-- Every UPDATE that moves a message INTO APPROVED or USED re-checks, at that moment, each cited source:
--   public_content_ids: the item still exists, belongs to the message's prospect and organization, and is VERIFIED;
--   signal_ids:         the signal still exists, belongs to the message's prospect and organization, and is VERIFIED.
-- One failing source refuses the whole statement (SQLSTATE P0001, message outreach_source_not_verified; the API answers
-- 409 and asks to regenerate): status, text, provenance and audit trail stay exactly as they were. Nothing is ever
-- re-verified, regenerated or rewritten automatically — a person verifying the source again re-opens approval.
-- Messages citing no public content and no signal (generic, evidence-only, written before 027) are unaffected, and a
-- message already USED keeps its history. Security invoker (the caller's own RLS: a source the caller can no longer
-- read counts as not verified — fail-closed), empty search_path, not callable by clients.
--
-- Rollback: drop trigger if exists outreach_provenance_guard on public.outreach;
-- drop function if exists prospectos_private.guard_outreach_provenance(); — nothing to restore: the trigger only refuses.
begin;

create or replace function prospectos_private.guard_outreach_provenance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare ref text;
begin
 for ref in select jsonb_array_elements_text(case when jsonb_typeof(new.public_content_ids)='array' then new.public_content_ids else '[]' end) loop
  if ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'outreach_source_not_verified' using errcode='P0001', detail='public_content';
  end if;
  if not exists(select 1 from public.prospect_public_content c where c.id=ref::uuid and c.organization_id=new.organization_id
     and c.prospect_id=new.prospect_id and c.status='VERIFIED') then
   raise exception 'outreach_source_not_verified' using errcode='P0001', detail='public_content';
  end if;
 end loop;
 for ref in select jsonb_array_elements_text(case when jsonb_typeof(new.signal_ids)='array' then new.signal_ids else '[]' end) loop
  if ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'outreach_source_not_verified' using errcode='P0001', detail='signal';
  end if;
  if not exists(select 1 from public.signals s where s.id=ref::uuid and s.organization_id=new.organization_id
     and s.prospect_id=new.prospect_id and s.status='VERIFIED') then
   raise exception 'outreach_source_not_verified' using errcode='P0001', detail='signal';
  end if;
 end loop;
 return new;
end $$;
revoke all on function prospectos_private.guard_outreach_provenance() from public,anon,authenticated;

drop trigger if exists outreach_provenance_guard on public.outreach;
create trigger outreach_provenance_guard before update of status on public.outreach for each row
 when (new.status in ('APPROVED','USED') and new.status is distinct from old.status)
 execute function prospectos_private.guard_outreach_provenance();

commit;
