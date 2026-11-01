-- 040 — Morning recap email (src/digest/morning.ts, app/api/cron/morning-digest): each morning, a member who CHOSE to
-- receive it gets one plain-text email listing the new signals the nightly monitoring found on the prospects they follow,
-- each with its source. No email on a day with nothing new. Unsubscribe in one click from every email.
--
-- 1. public.morning_digest_subscriptions — one row per user who ever answered: enabled (off by default, nothing is ever
--    enabled for someone), when they consented / unsubscribed, when the cron last claimed, checked and sent. Members read
--    their own row (RLS); writes go through the functions below only.
-- 2. public.set_morning_digest(enabled) — the member's own choice (authenticated). Enabling records consented_at.
-- 3. Server only (service_role): claim_morning_digests(limit, day_start) claims the subscribers not yet claimed today
--    (FOR UPDATE SKIP LOCKED, so two crons never send twice) with their sign-in email — never a closed account (its
--    email anonymized by the account deletion) nor an account without any organization; morning_digest_signals(user, since,
--    limit) lists the PENDING_REVIEW signals created since then in the organizations the user is a member of — company
--    data only (prospect, project, title, excerpt, official source); mark_morning_digest(user, checked_at, sent) records
--    the result; unsubscribe_morning_digest(user) is the one-click unsubscribe, called by the server after it checked the
--    signed link.
-- Nothing else is touched: no evidence, observation, signal, policy of another table, entitlement or billing. Deleting
-- the auth user deletes the row (on delete cascade); closing the account in ProspectOS (anonymization) stops the claims.
--
-- Rollback: drop the five functions, then drop table public.morning_digest_subscriptions (nothing depends on it).
begin;

create table if not exists public.morning_digest_subscriptions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 consented_at timestamptz,
 unsubscribed_at timestamptz,
 claimed_at timestamptz,
 last_checked_at timestamptz,
 last_sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(not enabled or consented_at is not null)
);
create index if not exists morning_digest_due_idx on public.morning_digest_subscriptions(claimed_at) where enabled;
alter table public.morning_digest_subscriptions enable row level security;
drop policy if exists morning_digest_own_read on public.morning_digest_subscriptions;
create policy morning_digest_own_read on public.morning_digest_subscriptions for select to authenticated using (user_id=auth.uid());
revoke all on public.morning_digest_subscriptions from public,anon,authenticated;
grant select on public.morning_digest_subscriptions to authenticated;

create or replace function public.set_morning_digest(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); row public.morning_digest_subscriptions;
begin
 if me is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 if p_enabled is null then raise exception 'Invalid choice' using errcode='22023'; end if;
 insert into public.morning_digest_subscriptions as s(user_id,enabled,consented_at,unsubscribed_at,last_checked_at)
 values(me,p_enabled,case when p_enabled then now() end,case when p_enabled then null else now() end,case when p_enabled then now() end)
 on conflict(user_id) do update set enabled=p_enabled,
  consented_at=case when p_enabled then now() else s.consented_at end,
  unsubscribed_at=case when p_enabled then null else now() end,
  -- Enabling again starts from now: an old backlog of signals is never mailed in one go.
  last_checked_at=case when p_enabled and not s.enabled then now() else s.last_checked_at end,
  updated_at=now()
 returning * into row;
 return jsonb_build_object('enabled',row.enabled,'consented_at',row.consented_at);
end $$;
revoke all on function public.set_morning_digest(boolean) from public,anon;
grant execute on function public.set_morning_digest(boolean) to authenticated;

create or replace function public.claim_morning_digests(p_limit int,p_day_start timestamptz)
returns table(user_id uuid,email text,since timestamptz,claimed_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 500 or p_day_start is null or p_day_start>now() then raise exception 'Invalid claim' using errcode='22023'; end if;
 return query
 with due as (
  select s.user_id from public.morning_digest_subscriptions s
  join auth.users u on u.id=s.user_id
  where s.enabled and (s.claimed_at is null or s.claimed_at<p_day_start)
   -- A closed account (delete_own_account + anonymization: email deleted+<id>@deleted.invalid, memberships removed)
   -- is never claimed, nor an account that belongs to no organization any more.
   and u.email is not null and u.email not like '%@deleted.invalid'
   and exists(select 1 from public.memberships m where m.user_id=s.user_id)
  order by s.claimed_at nulls first limit p_limit for update skip locked
 ), claimed as (
  update public.morning_digest_subscriptions s set claimed_at=now(),updated_at=now() from due where s.user_id=due.user_id
  returning s.user_id,coalesce(s.last_checked_at,s.consented_at) since,s.claimed_at
 )
 select c.user_id,u.email::text,c.since,c.claimed_at from claimed c join auth.users u on u.id=c.user_id where u.email is not null;
end $$;
revoke all on function public.claim_morning_digests(int,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_morning_digests(int,timestamptz) to service_role;

create or replace function public.morning_digest_signals(p_user uuid,p_since timestamptz,p_limit int)
returns table(signal_id uuid,project_name text,prospect_name text,signal_type text,title text,excerpt text,source_url text,published_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select s.id,pr.name,p.name,s.signal_type,s.title,s.excerpt,s.source_url,s.published_at,s.created_at
 from public.signals s
 join public.prospects p on p.id=s.prospect_id
 join public.projects pr on pr.id=s.project_id
 where p_user is not null and p_since is not null
  and s.organization_id in (select m.organization_id from public.memberships m where m.user_id=p_user)
  and exists(select 1 from public.morning_digest_subscriptions d where d.user_id=p_user and d.enabled)
  and s.status='PENDING_REVIEW' and s.created_at>p_since
 order by s.created_at desc
 limit least(greatest(coalesce(p_limit,20),1),30)
$$;
revoke all on function public.morning_digest_signals(uuid,timestamptz,int) from public,anon,authenticated;
grant execute on function public.morning_digest_signals(uuid,timestamptz,int) to service_role;

create or replace function public.mark_morning_digest(p_user uuid,p_checked_at timestamptz,p_sent boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 update public.morning_digest_subscriptions set last_checked_at=p_checked_at,last_sent_at=case when p_sent then now() else last_sent_at end,updated_at=now()
 where user_id=p_user and enabled and p_checked_at is not null and p_checked_at<=now();
 get diagnostics n=row_count;
 return n>0;
end $$;
revoke all on function public.mark_morning_digest(uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.mark_morning_digest(uuid,timestamptz,boolean) to service_role;

create or replace function public.unsubscribe_morning_digest(p_user uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 update public.morning_digest_subscriptions set enabled=false,unsubscribed_at=now(),updated_at=now() where user_id=p_user and enabled;
 get diagnostics n=row_count;
 return n>0;
end $$;
revoke all on function public.unsubscribe_morning_digest(uuid) from public,anon,authenticated;
grant execute on function public.unsubscribe_morning_digest(uuid) to service_role;

commit;
