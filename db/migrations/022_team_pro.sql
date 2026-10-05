-- ProspectOS Pro team: up to 5 accounts on ONE shared workspace, ONE pooled quota, and no search paid twice
-- (product decisions of 2026-10-05).
--
-- The workspace is already shared by construction: every business table is readable and writable by the members
-- of its organization (schema.sql, is_member). What was missing is a way in, a seat limit, one quota for the team
-- and the reuse of a teammate's identical search.
--
-- 1. Invitations (owner of an organization whose own plan is Pro, Entreprise or Internal and active):
--    create_team_invitation(email, token_hash) — the server draws the token, only its SHA-256 is stored, in a
--    private table no client can read. accept_team_invitation(token_hash) — the link is not enough: the account's
--    CONFIRMED e-mail must be the invited one. Valid 7 days, single use, revocable. 5 accounts at most (settings
--    team_max_seats), pending invitations included, under a per-team lock. Joining never creates an entitlement,
--    so it never takes a free-trial seat. remove_team_member / leave_team / list_team / list_team_invitations.
-- 2. Pooled quota: prospectos_private.plan_subject(actor) — a member is billed on the owner's plan, and a team's
--    usage is counted by organization (owner + members), under a per-team lock taken after the per-user one.
--    enforce_plan_limit and get_commercial_usage are 017's bodies with that subject; a lone account is unchanged.
--    When the owner's plan is no longer an active team plan, members are read-only: their data stays readable,
--    nothing new is counted on the team (plan_limit_reached).
-- 3. Reuse: find_reusable_discovery / start_reused_discovery — the same source, query, zone and sectors (case, spaces
--    and order aside), size and EVERY other search filter (headcount, mode…), run in the SAME organization less than
--    7 days ago (measured from the original search), completed with results and without any failed request. The new
--    run records its source and consumes the hourly log only (never billable). Which modes may reuse at all is the
--    application's decision (src/discovery/api.ts).
--
-- Rollback: re-create enforce_plan_limit and get_commercial_usage from 017; drop the functions created here and
-- prospectos_private.team_invitations; alter table prospectos_private.discovery_quota_settings drop column
-- team_max_seats. Memberships created by invitations can stay (role 'member', readable through is_member).
begin;

alter table prospectos_private.discovery_quota_settings add column if not exists team_max_seats int not null default 5 check(team_max_seats between 1 and 50);

create table if not exists prospectos_private.team_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 email text not null check(email=lower(email) and length(email) between 3 and 254),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 invited_by uuid not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 accepted_at timestamptz, accepted_by uuid, revoked_at timestamptz
);
create index if not exists team_invitations_org_idx on prospectos_private.team_invitations(organization_id);
revoke all on prospectos_private.team_invitations from public,anon,authenticated;

-- A TEAM member is a 'member' who joined through an accepted invitation (this migration). Any other 'member' row
-- (none exists in production; the schema allowed them) keeps the previous behaviour: billed on its own plan.
create or replace function prospectos_private.is_team_member(tenant uuid, who uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m where m.organization_id=tenant and m.user_id=who and m.role='member')
    and exists(select 1 from prospectos_private.team_invitations i where i.organization_id=tenant and i.accepted_by=who and i.accepted_at is not null)
$$;
revoke all on function prospectos_private.is_team_member(uuid,uuid) from public,anon,authenticated;

-- Who pays for an action of `actor`, and which team's pool it counts in.
--  team member                                   → the team owner, pooled on that organization;
--  owner of an organization that has team members → themself, pooled on that organization;
--  anyone else                                   → themself, per user (exactly as before).
create or replace function prospectos_private.plan_subject(actor uuid, out subject uuid, out team uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 subject:=actor; team:=null;
 if actor is null then return; end if;
 select m.organization_id,o.owner_id into team,subject from public.memberships m join public.organizations o on o.id=m.organization_id
  where m.user_id=actor and m.role='member' and prospectos_private.is_team_member(m.organization_id,actor) order by m.created_at,m.organization_id limit 1;
 if team is not null then return; end if;
 subject:=actor;
 select o.id into team from public.organizations o
  where o.owner_id=actor and exists(select 1 from public.memberships m where m.organization_id=o.id and m.role='member' and prospectos_private.is_team_member(o.id,m.user_id))
  order by o.created_at,o.id limit 1;
end $$;
revoke all on function prospectos_private.plan_subject(uuid) from public,anon,authenticated;

create or replace function prospectos_private.team_plan_active(owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.account_entitlements e where e.user_id=owner and e.plan in ('PRO','ENTERPRISE','INTERNAL') and e.status='ACTIVE' and e.expires_at>now())
$$;
revoke all on function prospectos_private.team_plan_active(uuid) from public,anon,authenticated;

-- 017's commercial check, with the plan subject. A lone account (subject=actor, no team) behaves exactly as in 017.
create or replace function prospectos_private.enforce_plan_limit(actor uuid, action_name text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.account_entitlements; lim int; used int; subj uuid; tm uuid;
begin
 if actor is null or action_name not in ('discovery','analysis','ai_offer') then return; end if;
 select p.subject,p.team into subj,tm from prospectos_private.plan_subject(actor) p;
 -- One pool for the whole team: serialized per team (after the caller's per-user lock, always in that order).
 if tm is not null then perform pg_advisory_xact_lock(hashtextextended('team:'||tm::text||':'||action_name,0)); end if;
 select * into e from public.account_entitlements where user_id=subj;
 -- A member works on the owner's team plan only: once it is not an active team plan, the team is read-only.
 if subj<>actor and (not found or e.plan not in ('PRO','ENTERPRISE','INTERNAL') or e.status<>'ACTIVE' or e.expires_at<=now()) then
  raise exception 'plan_limit_reached' using errcode='P0001';
 end if;
 if not found or e.plan not in ('BETA','PAID','PRO','ENTERPRISE') then return; end if;
 if e.status<>'ACTIVE' or e.expires_at<=now() then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 if e.plan='ENTERPRISE' then
  select case action_name when 'discovery' then discovery_limit when 'analysis' then analysis_limit else ai_offer_limit end
    into lim from prospectos_private.enterprise_limits where user_id=subj;
  if lim is null then raise exception 'plan_limit_reached' using errcode='P0001'; end if;
 else
  select case e.plan
          when 'PAID' then case action_name when 'discovery' then paid_discovery_limit when 'analysis' then paid_analysis_limit else paid_ai_offer_limit end
          when 'PRO' then case action_name when 'discovery' then pro_discovery_limit when 'analysis' then pro_analysis_limit else pro_ai_offer_limit end
          else case action_name when 'discovery' then trial_discovery_limit when 'analysis' then trial_analysis_limit else trial_ai_offer_limit end end
    into lim from prospectos_private.discovery_quota_settings where singleton;
 end if;
 if tm is not null then
  select count(*) into used from prospectos_private.discovery_quota_usage
   where organization_id=tm and action=action_name and billable and used_at>=e.starts_at and used_at<e.expires_at;
 else
  select count(*) into used from prospectos_private.discovery_quota_usage
   where user_id=actor and action=action_name and billable and used_at>=e.starts_at and used_at<e.expires_at;
 end if;
 if used>=lim then raise exception '%', case action_name when 'ai_offer' then 'offer_limit_reached' else 'plan_limit_reached' end using errcode='P0001'; end if;
end $$;
revoke all on function prospectos_private.enforce_plan_limit(uuid,text) from public,anon,authenticated;

-- 017's own counters, with the plan subject: a member sees the team's pool on the owner's plan ('team': true).
create or replace function public.get_commercial_usage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); e public.account_entitlements; s prospectos_private.discovery_quota_settings; x prospectos_private.enterprise_limits; d int; a int; o int; dl int; al int; ol int; subj uuid; tm uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select p.subject,p.team into subj,tm from prospectos_private.plan_subject(actor) p;
 select * into e from public.account_entitlements where user_id=subj;
 -- 'team' is added for a team only: a lone account reads exactly 017's answer.
 if not found then return jsonb_build_object('plan',null)||case when tm is not null then jsonb_build_object('team',true) else '{}'::jsonb end; end if;
 if e.plan='INTERNAL' then return jsonb_build_object('plan','INTERNAL','status',e.status)||case when tm is not null then jsonb_build_object('team',true) else '{}'::jsonb end; end if;
 select * into s from prospectos_private.discovery_quota_settings where singleton;
 if e.plan='ENTERPRISE' then
  select * into x from prospectos_private.enterprise_limits where user_id=subj;
  dl:=coalesce(x.discovery_limit,0); al:=coalesce(x.analysis_limit,0); ol:=coalesce(x.ai_offer_limit,0);
 elsif e.plan='PRO' then dl:=s.pro_discovery_limit; al:=s.pro_analysis_limit; ol:=s.pro_ai_offer_limit;
 elsif e.plan='PAID' then dl:=s.paid_discovery_limit; al:=s.paid_analysis_limit; ol:=s.paid_ai_offer_limit;
 else dl:=s.trial_discovery_limit; al:=s.trial_analysis_limit; ol:=s.trial_ai_offer_limit;
 end if;
 select count(*) filter(where action='discovery'),count(*) filter(where action='analysis'),count(*) filter(where action='ai_offer') into d,a,o
  from prospectos_private.discovery_quota_usage
  where (case when tm is not null then organization_id=tm else user_id=actor end) and billable and used_at>=e.starts_at and used_at<e.expires_at;
 return jsonb_build_object(
  'plan',e.plan,'status',e.status,'period_start',e.starts_at,'period_end',e.expires_at,
  'active',e.status='ACTIVE' and e.expires_at>now(),
  'discovery_used',d,'discovery_limit',dl,'analysis_used',a,'analysis_limit',al,'ai_offer_used',o,'ai_offer_limit',ol)
  ||case when tm is not null then jsonb_build_object('team',true) else '{}'::jsonb end;
end $$;
revoke all on function public.get_commercial_usage() from public,anon;
grant execute on function public.get_commercial_usage() to authenticated;

-- ——— team membership ———
create or replace function prospectos_private.owned_team(actor uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select m.organization_id from public.memberships m where m.user_id=actor and m.role='owner' order by m.created_at,m.organization_id limit 1
$$;
revoke all on function prospectos_private.owned_team(uuid) from public,anon,authenticated;

create or replace function prospectos_private.require_team_owner() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); tm uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if exists(select 1 from public.memberships where user_id=actor and role='member') then raise exception 'team_owner_required' using errcode='42501'; end if;
 tm:=prospectos_private.owned_team(actor);
 if tm is null then raise exception 'team_owner_required' using errcode='42501'; end if;
 return tm;
end $$;
revoke all on function prospectos_private.require_team_owner() from public,anon,authenticated;

create or replace function public.create_team_invitation(p_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); tm uuid; mail text := lower(trim(coalesce(p_email,''))); cap int; seats int; inv prospectos_private.team_invitations;
begin
 tm:=prospectos_private.require_team_owner();
 if not prospectos_private.team_plan_active(actor) then raise exception 'team_plan_required' using errcode='P0001'; end if;
 if mail !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(mail)>254 then raise exception 'Invalid email' using errcode='22023'; end if;
 if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation token' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('team-seats:'||tm::text,0));
 if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=tm and lower(u.email)=mail) then
  raise exception 'already_member' using errcode='P0001';
 end if;
 -- A new invitation for the same address replaces the pending one (its link stops working).
 update prospectos_private.team_invitations set revoked_at=now() where organization_id=tm and email=mail and accepted_at is null and revoked_at is null;
 select team_max_seats into cap from prospectos_private.discovery_quota_settings where singleton;
 seats:=(select count(*) from public.memberships where organization_id=tm)
  +(select count(*) from prospectos_private.team_invitations where organization_id=tm and accepted_at is null and revoked_at is null and expires_at>now());
 if seats>=cap then raise exception 'team_full' using errcode='P0001'; end if;
 insert into prospectos_private.team_invitations(organization_id,email,token_hash,invited_by) values(tm,mail,p_token_hash,actor) returning * into inv;
 return jsonb_build_object('id',inv.id,'email',inv.email,'expires_at',inv.expires_at);
end $$;
revoke all on function public.create_team_invitation(text,text) from public,anon;
grant execute on function public.create_team_invitation(text,text) to authenticated;

create or replace function public.accept_team_invitation(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); mail text; confirmed timestamptz; inv prospectos_private.team_invitations; owner uuid; cap int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into inv from prospectos_private.team_invitations
  where token_hash=coalesce(p_token_hash,'') and accepted_at is null and revoked_at is null and expires_at>now() for update;
 if not found then raise exception 'invitation_invalid' using errcode='P0001'; end if;
 select lower(u.email),u.email_confirmed_at into mail,confirmed from auth.users u where u.id=actor;
 if mail is distinct from inv.email then raise exception 'invitation_email_mismatch' using errcode='42501'; end if;
 if confirmed is null then raise exception 'email_not_confirmed' using errcode='42501'; end if;
 if exists(select 1 from public.memberships where user_id=actor and role='member') then raise exception 'already_in_team' using errcode='P0001'; end if;
 if exists(select 1 from public.memberships where user_id=actor and organization_id=inv.organization_id) then raise exception 'already_member' using errcode='P0001'; end if;
 select o.owner_id into owner from public.organizations o where o.id=inv.organization_id;
 if not prospectos_private.team_plan_active(owner) then raise exception 'team_unavailable' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('team-seats:'||inv.organization_id::text,0));
 select team_max_seats into cap from prospectos_private.discovery_quota_settings where singleton;
 if (select count(*) from public.memberships where organization_id=inv.organization_id)>=cap then raise exception 'team_full' using errcode='P0001'; end if;
 insert into public.memberships(organization_id,user_id,role) values(inv.organization_id,actor,'member');
 update prospectos_private.team_invitations set accepted_at=now(),accepted_by=actor where id=inv.id;
 return jsonb_build_object('organization_id',inv.organization_id);
end $$;
revoke all on function public.accept_team_invitation(text) from public,anon;
grant execute on function public.accept_team_invitation(text) to authenticated;

-- The caller's team: its members (e-mail, role), for every member; seats and whether the owner's plan is active.
create or replace function public.list_team() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); tm uuid; owner uuid; cap int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select m.organization_id into tm from public.memberships m where m.user_id=actor and m.role='member' order by m.created_at,m.organization_id limit 1;
 if tm is null then tm:=prospectos_private.owned_team(actor); end if;
 if tm is null then return null; end if;
 select o.owner_id into owner from public.organizations o where o.id=tm;
 select team_max_seats into cap from prospectos_private.discovery_quota_settings where singleton;
 return jsonb_build_object('organization_id',tm,'is_owner',owner=actor,'max_seats',cap,'plan_active',prospectos_private.team_plan_active(owner),
  'pending',case when owner=actor then (select count(*) from prospectos_private.team_invitations where organization_id=tm and accepted_at is null and revoked_at is null and expires_at>now()) else null end,
  'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'joined_at',m.created_at) order by m.role desc,m.created_at),'[]'::jsonb)
             from public.memberships m left join auth.users u on u.id=m.user_id where m.organization_id=tm));
end $$;
revoke all on function public.list_team() from public,anon;
grant execute on function public.list_team() to authenticated;

create or replace function public.list_team_invitations() returns table(id uuid, email text, expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare tm uuid;
begin
 tm:=prospectos_private.require_team_owner();
 return query select i.id,i.email,i.expires_at from prospectos_private.team_invitations i
  where i.organization_id=tm and i.accepted_at is null and i.revoked_at is null and i.expires_at>now() order by i.created_at;
end $$;
revoke all on function public.list_team_invitations() from public,anon;
grant execute on function public.list_team_invitations() to authenticated;

create or replace function public.revoke_team_invitation(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare tm uuid; n int;
begin
 tm:=prospectos_private.require_team_owner();
 update prospectos_private.team_invitations set revoked_at=now() where id=p_id and organization_id=tm and accepted_at is null and revoked_at is null;
 get diagnostics n=row_count; return n>0;
end $$;
revoke all on function public.revoke_team_invitation(uuid) from public,anon;
grant execute on function public.revoke_team_invitation(uuid) to authenticated;

create or replace function public.remove_team_member(p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare tm uuid;
begin
 tm:=prospectos_private.require_team_owner();
 delete from public.memberships where organization_id=tm and user_id=p_user_id and role='member';
 if not found then raise exception 'team_member_required' using errcode='P0001'; end if;
 return true;
end $$;
revoke all on function public.remove_team_member(uuid) from public,anon;
grant execute on function public.remove_team_member(uuid) to authenticated;

create or replace function public.leave_team() returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 delete from public.memberships m where m.user_id=actor and m.role='member' and prospectos_private.is_team_member(m.organization_id,actor);
 if not found then raise exception 'team_member_required' using errcode='P0001'; end if;
 return true;
end $$;
revoke all on function public.leave_team() from public,anon;
grant execute on function public.leave_team() to authenticated;

-- ——— reuse of a teammate's identical search ———
create or replace function prospectos_private.categories_key(c jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(x order by x),'[]'::jsonb)
 from (select distinct lower(trim(v)) x from jsonb_array_elements_text(case when jsonb_typeof(c)='array' then c else '[]'::jsonb end) v) s
$$;
revoke all on function prospectos_private.categories_key(jsonb) from public,anon,authenticated;

create or replace function prospectos_private.run_reusable(r public.discovery_runs,tenant uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select r.organization_id=tenant and r.provider=p_provider and p_provider<>'fixture'
  and r.status='completed' and r.result_count>0
  and coalesce(nullif(r.filters_json->>'reused_from_started_at','')::timestamptz,r.started_at)>now()-interval '7 days'
  and lower(r.query)=lower(trim(p_query)) and lower(r.location)=lower(trim(p_location))
  and prospectos_private.categories_key(r.categories)=prospectos_private.categories_key(p_categories)
  and (r.filters_json->>'max_results')::int=p_max_results
  and (r.filters_json-'max_results'-'reused_from_run_id'-'reused_from_started_at'-'reused_from_user')=(coalesce(p_filters,'{}'::jsonb)-'max_results')
  and coalesce((r.metrics->>'search_requests_failed')::int,0)=0
$$;
revoke all on function prospectos_private.run_reusable(public.discovery_runs,uuid,text,text,jsonb,text,int,jsonb) from public,anon,authenticated;

create or replace function public.find_reusable_discovery(p_project_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid; src public.discovery_runs; by_user uuid;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 select r.* into src from public.discovery_runs r
  where r.organization_id=tenant and prospectos_private.run_reusable(r,tenant,p_query,p_location,p_categories,p_provider,p_max_results,p_filters)
  order by r.started_at desc,r.id limit 1;
 if not found then return null; end if;
 by_user:=coalesce(nullif(src.filters_json->>'reused_from_user','')::uuid,(select u.user_id from prospectos_private.discovery_quota_usage u where u.discovery_run_id=src.id limit 1));
 return jsonb_build_object('run_id',src.id,
  'started_at',coalesce(nullif(src.filters_json->>'reused_from_started_at','')::timestamptz,src.started_at),
  'by_email',(select email from auth.users where id=by_user));
end $$;
revoke all on function public.find_reusable_discovery(uuid,text,text,jsonb,text,int,jsonb) from public,anon;
grant execute on function public.find_reusable_discovery(uuid,text,text,jsonb,text,int,jsonb) to authenticated;

-- start_discovery (021) for a reused search: same validation, the source re-checked here, the hourly log only.
create or replace function public.start_reused_discovery(p_project_id uuid,p_source_run_id uuid,p_query text,p_location text,p_categories jsonb,p_provider text,p_max_results int,p_filters jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; cap int; src public.discovery_runs; row public.discovery_runs; by_user uuid;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if length(trim(coalesce(p_query,''))) not between 2 and 250 or length(trim(coalesce(p_location,''))) not between 2 and 120 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if p_provider not in ('brave','registry') or p_max_results is null or p_max_results<1 or p_max_results>100 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 if jsonb_typeof(p_categories)<>'array' or jsonb_array_length(p_categories)>12 or jsonb_typeof(coalesce(p_filters,'{}'))<>'object' then raise exception 'Invalid discovery input' using errcode='22023'; end if;
 select max_results into cap from prospectos_private.discovery_quota_settings where singleton;
 if p_max_results>cap then raise exception 'max_results_exceeded' using errcode='P0001'; end if;
 select r.* into src from public.discovery_runs r where r.id=p_source_run_id;
 if not found or not prospectos_private.run_reusable(src,tenant,p_query,p_location,p_categories,p_provider,p_max_results,p_filters) then
  raise exception 'reuse_not_allowed' using errcode='P0001';
 end if;
 perform prospectos_private.consume_discovery_quota(tenant,'discovery',false);
 by_user:=coalesce(nullif(src.filters_json->>'reused_from_user','')::uuid,(select u.user_id from prospectos_private.discovery_quota_usage u where u.discovery_run_id=src.id limit 1));
 insert into public.discovery_runs(organization_id,project_id,query,location,categories,provider,filters_json)
 values(tenant,p_project_id,trim(p_query),trim(p_location),p_categories,p_provider,
  coalesce(p_filters,'{}')||jsonb_build_object('max_results',p_max_results,'reused_from_run_id',src.id,
   'reused_from_started_at',coalesce(nullif(src.filters_json->>'reused_from_started_at','')::timestamptz,src.started_at))
  ||case when by_user is null then '{}'::jsonb else jsonb_build_object('reused_from_user',by_user) end) returning * into row;
 update prospectos_private.discovery_quota_usage set discovery_run_id=row.id
  where id=(select id from prospectos_private.discovery_quota_usage
   where user_id=auth.uid() and action='discovery' and discovery_run_id is null and used_at=now() order by id desc limit 1);
 return to_jsonb(row);
end $$;
revoke all on function public.start_reused_discovery(uuid,uuid,text,text,jsonb,text,int,jsonb) from public,anon;
grant execute on function public.start_reused_discovery(uuid,uuid,text,text,jsonb,text,int,jsonb) to authenticated;

commit;
