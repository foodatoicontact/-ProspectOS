-- 053 — Programme partenaires, conservation (politique de confidentialité, section 13, décision du propriétaire du 25 nov. 2026):
-- a partner application that was not accepted is deleted at the latest 6 months after it was sent. « Accepted » is read
-- from the facts the database holds: a partner exists with the application's e-mail (created by the administrator from
-- it). Applications of accepted partners stay for the duration of the partnership (the partner row holds the same data).
--
-- public.purge_partner_applications() deletes them (server only), and public.run_retention() — the nightly job of migration
-- 048 — now calls it too. The journal entry of an application (APPLICATION_RECEIVED) only holds its identifier: no
-- personal data remains once the application is deleted. Nothing else changes: same retention for everything else, no
-- table, policy, entitlement, billing or evidence object touched.
--
-- Rollback: restore public.run_retention() from 048_retention.sql; drop function public.purge_partner_applications();
begin;

create or replace function public.purge_partner_applications() returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 delete from public.partner_applications a
 where a.created_at<now()-interval '6 months'
   and not exists(select 1 from public.partners p where p.email=a.email);
 get diagnostics n=row_count;
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
 r:=r||jsonb_build_object('partner_applications',public.purge_partner_applications());
 return r;
end $$;

revoke all on function public.purge_partner_applications(),public.run_retention() from public,anon,authenticated;
grant execute on function public.purge_partner_applications(),public.run_retention() to service_role;

commit;
