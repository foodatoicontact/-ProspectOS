-- LEGACY_GEO_BACKFILL (NBA v1.3, docs/NEXT_BEST_ACTION.md): Signal-first signals stored before P4 carry no structured
-- place (raw_metadata.location null, or a text without department / region), so NBA reads their place as UNKNOWN even
-- when the stored sentence names it ("aux Ulis (Essonne)", "à Connerré"). Signals are immutable once observed
-- (guard_signal, 024); this migration adds ONE narrow exception to that guard, nothing else:
--
--   a Signal-first signal (raw_metadata.origin = 'signal_discovery') with no structured place may receive, ONCE,
--   raw_metadata.location (the place re-read by src/signal-discovery/legacy-geo.ts with the ingestion's own reader,
--   from the text already stored) together with raw_metadata.location_backfill (version, source, reader, previous
--   location, date). Every other column and every other raw_metadata key stays identical; previous must be the old
--   location exactly; a backfilled or already located signal can never be re-located.
--
-- No grant changes: clients still cannot update signals (no policy, no privilege); the backfill is a data migration
-- run by an operator (scripts/legacy-geo-backfill.ts prints idempotent statements). The review fields keep their rule.
--
-- Rollback: re-create prospectos_private.guard_signal() as in 024 (the backfilled keys stay, as observed data).
begin;

create or replace function prospectos_private.guard_signal() returns trigger
language plpgsql set search_path='' as $$
declare oldloc jsonb; newmeta jsonb; oldmeta jsonb;
begin
 -- source_domain and date_basis are generated from guarded columns (and not yet computed in a BEFORE trigger).
 if (to_jsonb(new)-'status'-'reviewed_by'-'reviewed_at'-'rejection_reason'-'purge_after'-'source_domain'-'date_basis'-'raw_metadata')
    is distinct from (to_jsonb(old)-'status'-'reviewed_by'-'reviewed_at'-'rejection_reason'-'purge_after'-'source_domain'-'date_basis'-'raw_metadata') then
  raise exception 'Signals are immutable once observed: only the review may change' using errcode='42501';
 end if;
 if new.raw_metadata is not distinct from old.raw_metadata then return new; end if;
 -- The one change of raw_metadata ever allowed: LEGACY_GEO_BACKFILL, once.
 oldmeta:=coalesce(old.raw_metadata,'{}'::jsonb);newmeta:=coalesce(new.raw_metadata,'{}'::jsonb);
 oldloc:=coalesce(oldmeta->'location','null'::jsonb);
 if oldmeta->>'origin' is distinct from 'signal_discovery'
    or oldmeta ? 'location_backfill'
    or (jsonb_typeof(oldloc)='object' and (coalesce(jsonb_array_length(case when jsonb_typeof(oldloc->'departments')='array' then oldloc->'departments' end),0)>0
        or coalesce(jsonb_array_length(case when jsonb_typeof(oldloc->'regions')='array' then oldloc->'regions' end),0)>0))
    or (newmeta-'location'-'location_backfill') is distinct from (oldmeta-'location'-'location_backfill')
    or jsonb_typeof(newmeta->'location')<>'object'
    or jsonb_typeof(newmeta->'location'->'departments')<>'array' or jsonb_typeof(newmeta->'location'->'regions')<>'array'
    or jsonb_array_length(newmeta->'location'->'departments')+jsonb_array_length(newmeta->'location'->'regions')=0
    or jsonb_typeof(newmeta->'location_backfill')<>'object'
    or coalesce(newmeta->'location_backfill'->>'version','')!~'^legacy-geo-v[0-9]+$'
    or (newmeta->'location_backfill'->'previous') is distinct from oldloc then
  raise exception 'Signals are immutable once observed: only the review, or one legacy place backfill, may change' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_signal() from public,anon,authenticated;

commit;
