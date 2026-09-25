-- Dynamic safe website analysis: per-user analysis quota and analysis audit log.
--
-- 1. Per-user quota. The analysis quota was per organization only (20/hour), and any authenticated user
--    can create organizations: N organizations multiplied the quota. An analysis now needs room in BOTH
--    the organization's quota and the requesting user's own quota, checked and recorded in one
--    transaction under two advisory locks taken in a fixed order (user, then organization), so parallel
--    requests can never both pass the last free slot. Only analysis rows carry user_id; discovery and AI
--    quotas are unchanged.
-- 2. Audit log. One row per analysis attempt on a real website (authorized or refused): who, which
--    prospect, which host, under which authority (dynamic_discovery / static_allowlist), outcome and page
--    counts. Never page content, never a URL path, never an address, header, cookie or key. Written only
--    by the server (service_role RPCs that re-check membership, like save_discovery_results); readable by
--    the members of the organization; nobody can edit or delete a row through the API.
begin;

alter table prospectos_private.discovery_quota_usage add column user_id uuid;
create index discovery_quota_usage_user_idx on prospectos_private.discovery_quota_usage(user_id,action,used_at desc) where user_id is not null;
alter table prospectos_private.discovery_quota_settings add column analyses_per_user_per_hour int not null default 20 check(analyses_per_user_per_hour>0);

-- Same contract as 002 (member check, 'quota_exceeded' on refusal, reservation before any fetch); the
-- organization lock key is the one consume_discovery_quota uses for 'analysis'. CREATE OR REPLACE keeps
-- the existing EXECUTE grant to authenticated.
create or replace function public.consume_analysis_quota(p_prospect_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare tenant uuid; actor uuid := auth.uid(); per_org int; per_user int; used int;
begin
 select organization_id into tenant from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('analysis-user:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':analysis',0));
 select analyses_per_hour,analyses_per_user_per_hour into per_org,per_user from prospectos_private.discovery_quota_settings where singleton;
 select count(*) into used from prospectos_private.discovery_quota_usage where user_id=actor and action='analysis' and used_at > now()-interval '1 hour';
 if used >= per_user then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 select count(*) into used from prospectos_private.discovery_quota_usage where organization_id=tenant and action='analysis' and used_at > now()-interval '1 hour';
 if used >= per_org then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) values(tenant,'analysis',actor);
end $$;

create table public.website_analysis_audit (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 prospect_id uuid not null,
 user_id uuid not null,
 host text check(host is null or (length(host) between 1 and 253 and host ~ '^[a-z0-9.-]+$')),
 authorization_mode text check(authorization_mode is null or authorization_mode in ('dynamic_discovery','static_allowlist')),
 outcome text not null check(outcome in ('STARTED','ANALYZED','ANALYSIS_FAILED','ROBOTS_DENIED','QUOTA_EXCEEDED','OFFICIAL_WEBSITE_REQUIRED','SOURCE_POLICY_REQUIRED','DYNAMIC_ANALYSIS_DISABLED','DISCOVERY_CAPABILITY_INVALID','WEBSITE_MISMATCH')),
 pages_analyzed int check(pages_analyzed is null or pages_analyzed between 0 and 10),
 failed_pages int check(failed_pages is null or failed_pages between 0 and 10),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check((outcome in ('STARTED','ANALYZED','ANALYSIS_FAILED','ROBOTS_DENIED','QUOTA_EXCEEDED')) = (authorization_mode is not null))
);
create index website_analysis_audit_org_idx on public.website_analysis_audit(organization_id,created_at desc);
alter table public.website_analysis_audit enable row level security;
create policy website_analysis_audit_read on public.website_analysis_audit for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.website_analysis_audit from public,anon,authenticated;
grant select on public.website_analysis_audit to authenticated;

-- Server-only: p_user_id is the identity the server verified from the request's JWT; the tenant is taken
-- from the prospect, never from the caller, and the user must be a member of it.
create function public.record_website_analysis(p_user_id uuid,p_prospect_id uuid,p_host text,p_mode text,p_outcome text) returns uuid
language plpgsql security definer set search_path='' as $$
declare tenant uuid; row_id uuid;
begin
 if p_user_id is null then raise exception 'Authenticated user required' using errcode='42501'; end if;
 select organization_id into tenant from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.memberships where organization_id=tenant and user_id=p_user_id) then
  raise exception 'Authenticated tenant member required' using errcode='42501';
 end if;
 insert into public.website_analysis_audit(organization_id,prospect_id,user_id,host,authorization_mode,outcome,completed_at)
 values(tenant,p_prospect_id,p_user_id,p_host,p_mode,p_outcome,case when p_outcome='STARTED' then null else now() end) returning id into row_id;
 return row_id;
end $$;

-- Closes a STARTED attempt exactly once, by the user who opened it.
create function public.complete_website_analysis(p_audit_id uuid,p_user_id uuid,p_outcome text,p_pages int,p_failed int) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_outcome not in ('ANALYZED','ANALYSIS_FAILED','ROBOTS_DENIED','QUOTA_EXCEEDED') then raise exception 'Invalid outcome' using errcode='22023'; end if;
 update public.website_analysis_audit set outcome=p_outcome,pages_analyzed=p_pages,failed_pages=p_failed,completed_at=now()
 where id=p_audit_id and user_id=p_user_id and outcome='STARTED';
 if not found then raise exception 'Audit entry not found' using errcode='P0002'; end if;
end $$;

revoke all on function public.record_website_analysis(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_website_analysis(uuid,uuid,text,int,int) from public,anon,authenticated;
grant execute on function public.record_website_analysis(uuid,uuid,text,text,text) to service_role;
grant execute on function public.complete_website_analysis(uuid,uuid,text,int,int) to service_role;

commit;
