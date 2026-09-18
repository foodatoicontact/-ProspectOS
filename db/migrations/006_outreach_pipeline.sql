-- BLOC 3 — Outreach assisté & pipeline commercial. Additive only: no existing column, allowed
-- value, or trigger is removed or narrowed. Idempotent — safe to run more than once.
begin;

-- Draft lifecycle: DRAFT (just generated) -> APPROVED/USED (a human validated or copied it), or
-- DISCARDED (superseded by a regeneration, or explicitly abandoned). Existing rows created before
-- this column existed default to DRAFT — an inert historical label; it never claims a message was
-- approved or sent. Never set to VERIFIED-style meanings: this tracks the DRAFT's own lifecycle,
-- never the prospect's business status (see prospects.status below), and never evidence trust.
alter table public.outreach add column if not exists status text not null default 'DRAFT'
 check (status in ('DRAFT','APPROVED','USED','DISCARDED'));

-- Reuses the existing append-only, tenant-checked audit trigger already trusted for
-- prospects/evidence — no new logging path. A generated draft ("outreach.insert") and any later
-- status/content change ("outreach.update", e.g. a copy marking it USED) become visible in the
-- prospect's history for free.
drop trigger if exists outreach_event on public.outreach;
create trigger outreach_event after insert or update on public.outreach
 for each row execute function prospectos_private.append_event();

-- Two additional human-only pipeline states: a prospect who replied and expressed interest
-- (distinct from a bare "Réponse"), and a prospect deliberately never pursued (distinct from
-- "Perdu", which means contacted then declined). Every existing value stays valid and unchanged —
-- this only widens the set an existing row or the UI may choose from.
alter table public.prospects drop constraint if exists prospects_status_check;
alter table public.prospects add constraint prospects_status_check
 check (status in ('À analyser','Qualifié','À contacter','Contacté','Réponse','Intéressé','Gagné','Perdu','Ignoré'));

commit;
