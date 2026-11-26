-- 059 — Cockpit administrateur, écran Clients (docs/ADMIN_COCKPIT.md, décision du propriétaire du 26 nov. 2026): one sheet
-- per organization — its offer and dates, its usage, its Stripe billing (links), its veille dédiée, its partner of origin,
-- and the administrator's notes, timestamped.
--
-- 1. public.admin_notes — the administrator's notes on an organization: APPEND-ONLY (no UPDATE, DELETE or TRUNCATE, for any
--    role, the owner included), each with its author and time. Written through public.admin_add_note only.
-- 2. public.admin_clients(p_query,p_limit,p_offset) — the list: name, creation, plan and its end, members, last activity,
--    partner of origin, veille dédiée, notes count; searched by organization name or owner e-mail.
-- 3. public.admin_client(p_org) — one sheet: the organization and its owner's e-mail, the owner's entitlement, the Stripe
--    customer and subscription as stored (017/023: ids, status, period, cancellation), usage counts (projects, prospects,
--    searches and AI calls over 30 days and in all, last activity), the veille dédiée contracts and deliveries, the partner
--    of origin, the notes and the organization's latest events of the feed (056). The invoices themselves are read from
--    Stripe by the server (src/cockpit/clients.ts), never stored.
--
-- Who may do what: the administrator only (ACTIVE INTERNAL entitlement): every function checks it, RLS hides every note
-- from anyone else, no client account and no anonymous visitor reads or writes any of it. No CRM function for clients.
-- Nothing else changes: no existing table, policy, entitlement, billing or evidence object is touched.
--
-- Rollback: drop function public.admin_clients(text,int,int), public.admin_client(uuid), public.admin_add_note(uuid,text),
--   prospectos_private.deny_admin_note_mutation(); drop table public.admin_notes;
begin;

create table if not exists public.admin_notes (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 author_id uuid not null references auth.users(id),
 body text not null check(length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists admin_notes_org_idx on public.admin_notes(organization_id,created_at desc);

create or replace function prospectos_private.deny_admin_note_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'admin_notes is append-only' using errcode='42501'; end $$;
drop trigger if exists admin_notes_no_update on public.admin_notes;
create trigger admin_notes_no_update before update or delete on public.admin_notes for each row execute function prospectos_private.deny_admin_note_mutation();
drop trigger if exists admin_notes_no_truncate on public.admin_notes;
create trigger admin_notes_no_truncate before truncate on public.admin_notes for each statement execute function prospectos_private.deny_admin_note_mutation();

alter table public.admin_notes enable row level security;
revoke all on public.admin_notes from public,anon,authenticated;
grant select on public.admin_notes to authenticated;
drop policy if exists admin_notes_admin_read on public.admin_notes;
create policy admin_notes_admin_read on public.admin_notes for select to authenticated using (prospectos_private.is_internal_admin());

create or replace function public.admin_add_note(p_org uuid,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.admin_notes;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if not exists(select 1 from public.organizations where id=p_org) then raise exception 'admin_client_not_found' using errcode='P0002'; end if;
 insert into public.admin_notes(organization_id,author_id,body) values(p_org,auth.uid(),trim(p_body)) returning * into n;
 return jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at);
end $$;

-- The list. p_query: part of the organization's name or of its owner's e-mail (at most 80 characters).
create or replace function public.admin_clients(p_query text,p_limit int,p_offset int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=nullif(trim(coalesce(p_query,'')),''); lim int:=greatest(1,least(coalesce(p_limit,50),200)); off int:=greatest(0,least(coalesce(p_offset,0),100000)); r jsonb; total int;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if q is not null and length(q)>80 then raise exception 'admin_query_invalid' using errcode='22023'; end if;
 select count(*) into total from public.organizations o join auth.users u on u.id=o.owner_id
  where q is null or o.name ilike '%'||q||'%' or u.email ilike '%'||q||'%';
 select coalesce(jsonb_agg(x order by (x->>'created_at') desc),'[]'::jsonb) into r from (
  select jsonb_build_object('id',o.id,'name',o.name,'created_at',o.created_at,'owner_email',u.email,
   'plan',e.plan,'status',e.status,'expires_at',e.expires_at,'seats',e.seats,
   'subscription_status',b.subscription_status,'cancel_at_period_end',coalesce(b.cancel_at_period_end,false),
   'members',(select count(*) from public.memberships m where m.organization_id=o.id),
   'last_activity',(select max(ev.created_at) from public.events ev where ev.organization_id=o.id),
   'partner',(select p.company from public.partners p where p.id=o.referred_by),
   'dedicated',(select c.status from public.dedicated_contracts c where c.organization_id=o.id order by c.created_at desc limit 1),
   'notes',(select count(*) from public.admin_notes n where n.organization_id=o.id)) x
  from public.organizations o join auth.users u on u.id=o.owner_id
  left join public.account_entitlements e on e.user_id=o.owner_id
  left join prospectos_private.billing_accounts b on b.user_id=o.owner_id
  where q is null or o.name ilike '%'||q||'%' or u.email ilike '%'||q||'%'
  order by o.created_at desc limit lim offset off) t;
 return jsonb_build_object('clients',r,'total',total);
end $$;

create or replace function public.admin_client(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.organizations; r jsonb;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into o from public.organizations where id=p_org;
 if not found then raise exception 'admin_client_not_found' using errcode='P0002'; end if;
 select jsonb_build_object(
  'organization',jsonb_build_object('id',o.id,'name',o.name,'created_at',o.created_at,'owner_email',(select email from auth.users where id=o.owner_id),
   'members',(select count(*) from public.memberships m where m.organization_id=o.id)),
  'entitlement',(select jsonb_build_object('plan',e.plan,'status',e.status,'starts_at',e.starts_at,'expires_at',e.expires_at,'seats',e.seats)
    from public.account_entitlements e where e.user_id=o.owner_id),
  'billing',(select jsonb_build_object('customer_id',b.stripe_customer_id,'subscription_id',b.stripe_subscription_id,'plan',b.plan,'status',b.subscription_status,
    'current_period_start',b.current_period_start,'current_period_end',b.current_period_end,'cancel_at_period_end',b.cancel_at_period_end,'seats',b.seats)
    from prospectos_private.billing_accounts b where b.user_id=o.owner_id),
  'usage',jsonb_build_object(
   'projects',(select count(*) from public.projects p where p.organization_id=o.id),
   'prospects',(select count(*) from public.prospects p where p.organization_id=o.id),
   'searches_30d',(select count(*) from public.discovery_runs d where d.organization_id=o.id and d.started_at>=now()-interval '30 days'),
   'searches',(select count(*) from public.discovery_runs d where d.organization_id=o.id),
   'ai_calls_30d',(select count(*) from public.api_usage_events a where a.organization_id=o.id and a.operation='offer_analysis' and a.created_at>=now()-interval '30 days'),
   'last_activity',(select max(ev.created_at) from public.events ev where ev.organization_id=o.id)),
  'dedicated',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'status',c.status,'accepted_at',c.accepted_at,'terminated_at',c.terminated_at,
    'deliveries',(select count(*) from public.dedicated_deliveries d where d.contract_id=c.id),
    'last_delivery',(select max(d.delivered_on) from public.dedicated_deliveries d where d.contract_id=c.id)) order by c.created_at desc),'[]'::jsonb)
    from public.dedicated_contracts c where c.organization_id=o.id),
  'partner',(select jsonb_build_object('company',p.company,'code',p.code,'referred_at',o.referred_at) from public.partners p where p.id=o.referred_by),
  'notes',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at,'author',(select email from auth.users where id=n.author_id)) order by n.created_at desc,n.id desc),'[]'::jsonb)
    from public.admin_notes n where n.organization_id=o.id),
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'occurred_at',x.occurred_at,'detail',x.detail,'source_table',x.source_table,'source_id',x.source_id) order by x.id desc),'[]'::jsonb)
    from (select * from public.admin_events a where a.organization_id=o.id order by a.id desc limit 30) x)
 ) into r;
 return r;
end $$;

revoke all on function public.admin_add_note(uuid,text),public.admin_clients(text,int,int),public.admin_client(uuid) from public,anon;
grant execute on function public.admin_add_note(uuid,text),public.admin_clients(text,int,int),public.admin_client(uuid) to authenticated;

commit;
