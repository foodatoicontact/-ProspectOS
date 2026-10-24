-- O1 — evidence provenance at the moment of use (end-to-end test 2026-10-24: a message citing evidence a person no
-- longer stands behind stayed approvable and copyable). Additive: 027, 028 and 029 are unchanged in intent.
--
-- 029 re-checks, on every transition into APPROVED or USED, the public content and the signals a message cites. The
-- evidence it cites (evidence_ids, the proofs the factual template quotes) was only checked at insert, for existence
-- (validate_outreach_refs). Afterwards a person may send the underlying observation back to review or contradict it
-- (review_discovery_observation sets the evidence to NOT_VERIFIED / INFERRED_UNCONFIRMED / CONTRADICTED), and a member
-- may change an evidence status directly: the message still quoted that excerpt and could still be approved and copied.
--
-- This migration redefines guard_outreach_provenance() so that it ALSO re-checks, at that moment, each cited evidence:
--   evidence_ids: the evidence still exists, belongs to the message's prospect and organization, and is VERIFIED.
-- Same contract as 029: one failing source refuses the whole statement (SQLSTATE P0001, message
-- outreach_source_not_verified, detail 'evidence'; the API already answers 409 and asks to regenerate); status, text,
-- provenance and audit trail stay exactly as they were; nothing is re-verified, regenerated or rewritten automatically.
-- Messages citing no evidence are unaffected, and a message already USED keeps its history. Security invoker (the
-- caller's own RLS: an evidence the caller can no longer read counts as not verified — fail-closed), empty
-- search_path, not callable by clients. The trigger (029) is unchanged.
--
-- Numbered 036: 035 is taken by feat/self-outreach (its own campaign tables; it does not touch this guard).
-- Rollback: re-apply db/migrations/029_outreach_provenance_revalidation.sql (restores the 029 function body).
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
 for ref in select jsonb_array_elements_text(case when jsonb_typeof(new.evidence_ids)='array' then new.evidence_ids else '[]' end) loop
  if ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'outreach_source_not_verified' using errcode='P0001', detail='evidence';
  end if;
  if not exists(select 1 from public.evidence e where e.id=ref::uuid and e.organization_id=new.organization_id
     and e.prospect_id=new.prospect_id and e.status='VERIFIED') then
   raise exception 'outreach_source_not_verified' using errcode='P0001', detail='evidence';
  end if;
 end loop;
 return new;
end $$;
revoke all on function prospectos_private.guard_outreach_provenance() from public,anon,authenticated;

commit;
