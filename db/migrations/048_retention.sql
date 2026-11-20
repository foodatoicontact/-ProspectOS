-- 048 — Retention, applied every night (audit 2026-11-11, R1). Two gaps closed:
--
-- 1. Contact details of people were kept as long as the account lived. Decided by the owner on 18 nov. 2026, after the CNIL
--    recommendation for prospecting (3 years after the last contact): when a prospect has had NO activity for 3 years, the
--    contact details of people attached to it are deleted — its channels (e-mail, phone, LinkedIn, WhatsApp, Instagram,
--    form; the company website is kept: it is not a person's data) and its outreach contacts (name, role, e-mail; their
--    candidates and messages follow by cascade). The company record, its evidence and its history stay.
--    Activity = the latest of: the prospect's own update (bumped by every change of the record), its audit events, its
--    channels and contacts added, its outreach candidates' updates.
-- 2. The purge functions already written were never called by any job: purge_signals (024), purge_public_events (045),
--    purge_prospect_lists (046). public.run_retention() calls them all; the cron /api/cron/retention calls it once a night.
--    BODACC announcements are kept 13 months, except those cited by a list of the référentiel (kept with the list, 3 years).
--
-- Server only (service_role). Nothing else is touched: no table, policy, entitlement, billing or evidence object changes;
-- purge_public_events keeps its signature and only learns to keep the announcements a list cites.
--
-- Rollback: drop function public.run_retention(), public.purge_inactive_contacts(int);
--   restore public.purge_public_events(date) from 045_public_events.sql.
begin;

create or replace function public.purge_inactive_contacts(p_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids uuid[];ch int;co int;
begin
 if p_limit is null or p_limit<1 or p_limit>20000 then raise exception 'Invalid limit' using errcode='22023'; end if;
 select coalesce(array_agg(id),'{}') into ids from (
  select p.id from public.prospects p
  where (exists(select 1 from public.channels c where c.prospect_id=p.id and c.kind<>'website')
      or exists(select 1 from public.outreach_contacts oc where oc.prospect_id=p.id))
    and greatest(p.updated_at,p.created_at,
     coalesce((select max(e.created_at) from public.events e where e.prospect_id=p.id),'-infinity'),
     coalesce((select max(c.created_at) from public.channels c where c.prospect_id=p.id),'-infinity'),
     coalesce((select max(oc.created_at) from public.outreach_contacts oc where oc.prospect_id=p.id),'-infinity'),
     coalesce((select max(k.updated_at) from public.outreach_candidates k where k.prospect_id=p.id),'-infinity'))
     < now()-interval '3 years'
  limit p_limit) x;
 delete from public.channels where prospect_id=any(ids) and kind<>'website';get diagnostics ch=row_count;
 delete from public.outreach_contacts where prospect_id=any(ids);get diagnostics co=row_count;
 return jsonb_build_object('prospects',coalesce(array_length(ids,1),0),'channels',ch,'contacts',co);
end $$;

-- Same signature and rules as 045; an announcement cited by a list of the référentiel stays as long as the list.
create or replace function public.purge_public_events(p_before date) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_before is null or p_before>current_date-30 then raise exception 'Invalid purge date' using errcode='22023'; end if;
 delete from public.public_events e where e.published_on<p_before
  and not exists(select 1 from public.prospect_list_items i where i.event_source=e.source and i.event_source_id=e.source_id);
 get diagnostics n=row_count;
 delete from public.public_event_runs where day<p_before;
 delete from public.company_cache where expires_at<now()-interval '90 days';
 return n;
end $$;

create or replace function public.run_retention() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb:='{}';
begin
 r:=r||jsonb_build_object('signals',public.purge_signals());
 r:=r||jsonb_build_object('public_events',public.purge_public_events((current_date-interval '13 months')::date));
 r:=r||jsonb_build_object('prospect_lists',public.purge_prospect_lists());
 r:=r||jsonb_build_object('inactive_contacts',public.purge_inactive_contacts(5000));
 return r;
end $$;

revoke all on function public.purge_inactive_contacts(int),public.purge_public_events(date),public.run_retention() from public,anon,authenticated;
grant execute on function public.purge_inactive_contacts(int),public.purge_public_events(date),public.run_retention() to service_role;

commit;
