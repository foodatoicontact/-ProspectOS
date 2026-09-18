-- Account / privacy / beta-access bloc. Additive only — no existing column, policy, grant, or
-- trigger removed or narrowed. No change to RLS on any existing table. No change to the append-only
-- events invariant (events are never inserted/updated/deleted by anything added here beyond the one
-- narrowly-scoped export-audit RPC, which only ever INSERTs — exactly like every existing trigger).
--
-- Account deletion in this bloc means: membership removal (with a last-owner safety block) plus a
-- server-side (never client-exposed) anonymization of the auth.users row — email scrambled, password
-- randomized and discarded, account banned. It is deliberately NEVER a literal `DELETE FROM
-- auth.users`: organizations.owner_id, evidence.verified_by and events.actor_id all reference
-- auth.users with no ON DELETE clause (NO ACTION), and evidence.verified_by cannot be nulled while
-- status is VERIFIED/CONTRADICTED without weakening evidence-first, and events cannot be touched at
-- all without weakening the append-only invariant. Anonymizing the referenced row in place satisfies
-- "the personal data is gone" without ever violating those FKs or invariants. Deleting an entire
-- organization (its own events included) is explicitly deferred — see docs — since it cannot be done
-- without a change to the append-only trigger, which this bloc does not touch.
begin;

-- One entitlement row per user (never per-organization: the beta offer is "10 people, 7 days each",
-- not a per-tenant plan). Absence of a row means "not part of the time-boxed program" — an existing
-- or future non-beta account is never affected by anything here. Mutated exclusively through
-- grant_beta_access() below; no INSERT/UPDATE/DELETE grant to authenticated at all, mirroring the
-- exact pattern already used for memberships (self-read-only, mutation only via a SECURITY DEFINER
-- function) — this is what makes expires_at impossible for a client to forge or extend.
create table if not exists public.account_entitlements (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id),
 plan text not null check(plan in ('BETA')),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','EXPIRED','REVOKED')),
 starts_at timestamptz not null default now(),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(expires_at > starts_at)
);
alter table public.account_entitlements enable row level security;
drop policy if exists account_entitlements_self on public.account_entitlements;
create policy account_entitlements_self on public.account_entitlements for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.account_entitlements from public,anon,authenticated;
grant select on public.account_entitlements to authenticated;

-- Global beta capacity, centralized and configurable (never hardcoded in application code, never a
-- client-writable value): "10" lives here as data, not as a constant baked into the product forever.
create table if not exists prospectos_private.beta_program (
 singleton boolean primary key default true check(singleton),
 capacity int not null default 10 check(capacity>0)
);
insert into prospectos_private.beta_program(singleton) values(true) on conflict(singleton) do nothing;
revoke all on prospectos_private.beta_program from public,anon,authenticated;

-- Admin-only activation, deliberately NOT granted to `authenticated` — it is callable only by
-- whoever can run SQL directly against the project (the Supabase SQL editor, or an operator with a
-- direct DB connection), never through the app's own PostgREST/RPC surface a logged-in user reaches.
-- This is the "simplest safe V1" the brief asks for instead of an admin dashboard: one documented
-- SQL statement per grant (see docs/ACCOUNT_PRIVACY_BETA.md).
--
-- Capacity is enforced as "10 people, ever" (not "10 concurrently active slots that free up on
-- expiry"): a user who already has a row (re-activation/extension) never consumes a new slot: only a
-- brand-new user_id counts against capacity. The advisory lock serializes every concurrent call to
-- this function on the same key, so two simultaneous activations can never both observe room for the
-- last slot — the second one always re-reads the post-lock, up-to-date count.
create or replace function public.grant_beta_access(p_user_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; cap int; used int; already boolean;
begin
 perform pg_advisory_xact_lock(hashtext('beta_program_capacity'));
 select id into target from auth.users where email=p_user_email;
 if target is null then raise exception 'User not found for that email' using errcode='P0002'; end if;
 select exists(select 1 from public.account_entitlements where user_id=target) into already;
 if not already then
  select capacity into cap from prospectos_private.beta_program where singleton;
  select count(*) into used from public.account_entitlements where plan='BETA';
  if used>=cap then raise exception 'BETA_CAPACITY_REACHED' using errcode='P0001'; end if;
 end if;
 insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at)
 values(target,'BETA','ACTIVE',now(),now()+interval '7 days',now())
 on conflict(user_id) do update set plan='BETA',status='ACTIVE',starts_at=now(),expires_at=now()+interval '7 days',updated_at=now();
 return jsonb_build_object('user_id',target,'expires_at',now()+interval '7 days');
end $$;
revoke all on function public.grant_beta_access(text) from public,anon,authenticated;

-- Self-service membership cleanup for "Supprimer mon compte" (CASE A/B). Atomic and all-or-nothing:
-- if ANY organization this user owns would be left without an owner while it still has other
-- members or business data (CASE C), nothing at all is deleted and the whole call fails with
-- last_owner_blocked — never a partial deletion across several organizations. Derives the acting
-- user exclusively from auth.uid(); never accepts a target user id from the caller.
create or replace function public.delete_own_account() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); blocked jsonb := '[]'::jsonb; m record; other_owners int; other_members int; biz_count int;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 for m in select organization_id, role from public.memberships where user_id=actor loop
  if m.role='owner' then
   select count(*) into other_owners from public.memberships where organization_id=m.organization_id and role='owner' and user_id<>actor;
   if other_owners=0 then
    select count(*) into other_members from public.memberships where organization_id=m.organization_id and user_id<>actor;
    select count(*) into biz_count from public.projects where organization_id=m.organization_id;
    if other_members>0 or biz_count>0 then blocked := blocked || jsonb_build_array(m.organization_id); end if;
   end if;
  end if;
 end loop;
 if jsonb_array_length(blocked)>0 then
  raise exception 'last_owner_blocked' using errcode='P0001', detail=blocked::text;
 end if;
 delete from public.memberships where user_id=actor;
 return jsonb_build_object('memberships_removed', true);
end $$;
revoke all on function public.delete_own_account() from public,anon;
grant execute on function public.delete_own_account() to authenticated;

-- CASE C's alternative resolution, buildable cleanly on the existing role model (no schema change
-- needed): promotes an EXISTING member to owner. Never touches the caller's own membership, so it
-- can never leave an organization ownerless even if called redundantly. No UI wires this yet in this
-- bloc (V0 has no invite flow, so no organization can have a second member to transfer to today) —
-- it exists so CASE C has a real resolution path the moment an invite system ships.
create or replace function public.transfer_organization_ownership(p_organization_id uuid, p_new_owner_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not exists(select 1 from public.memberships where organization_id=p_organization_id and user_id=actor and role='owner') then
  raise exception 'Only an existing owner can transfer ownership' using errcode='42501';
 end if;
 if not exists(select 1 from public.memberships where organization_id=p_organization_id and user_id=p_new_owner_user_id) then
  raise exception 'Target must already be a member of this organization' using errcode='22023';
 end if;
 update public.memberships set role='owner' where organization_id=p_organization_id and user_id=p_new_owner_user_id;
end $$;
revoke all on function public.transfer_organization_ownership(uuid,uuid) from public,anon;
grant execute on function public.transfer_organization_ownership(uuid,uuid) to authenticated;

-- Best-effort export audit: one append-only event per export, no export content stored. Reuses the
-- events table exactly as designed (organization-scoped, actor-attributed, append-only — this
-- function only ever INSERTs, same as every existing trigger). prospect_id is legitimately NULL
-- here: the schema already allows it, this is an account-level event, not tied to one prospect.
create or replace function public.log_account_export() returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); tenant uuid;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select organization_id into tenant from public.memberships where user_id=actor limit 1;
 if tenant is not null then
  insert into public.events(organization_id,prospect_id,actor_id,kind,payload) values(tenant,null,actor,'account.export_requested','{}'::jsonb);
 end if;
end $$;
revoke all on function public.log_account_export() from public,anon;
grant execute on function public.log_account_export() to authenticated;

commit;
