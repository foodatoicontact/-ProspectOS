-- 044 — Notification centre (src/notifications): the bell of the v2 shell lists what happened for the user — today the
-- veille dédiée events of its journal (migration 043: proposal, delivery, statement, termination; for the administrator:
-- acceptance, validation, reminder). The notifications themselves are READ from that append-only journal, under its own
-- RLS: nothing is copied, nothing can drift. This migration only keeps, per user, when they last opened the centre, so
-- that « unread » follows the account from one device to another.
--
-- public.user_notification_state(user_id, seen_at): one row per user, readable by that user only (RLS); no browser role
-- writes it directly. public.mark_notifications_seen() (authenticated) sets seen_at to now() for the caller only.
-- Nothing else is touched: no existing table, policy, function, entitlement, billing or evidence object changes.
--
-- Rollback: drop function public.mark_notifications_seen(); drop table public.user_notification_state;
begin;

create table if not exists public.user_notification_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 seen_at timestamptz not null default now()
);
alter table public.user_notification_state enable row level security;
drop policy if exists notification_state_self on public.user_notification_state;
create policy notification_state_self on public.user_notification_state for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.user_notification_state from public,anon,authenticated;
grant select on public.user_notification_state to authenticated;

create or replace function public.mark_notifications_seen() returns timestamptz
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); at timestamptz:=now();
begin
 if actor is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 insert into public.user_notification_state(user_id,seen_at) values(actor,at)
 on conflict(user_id) do update set seen_at=greatest(public.user_notification_state.seen_at,excluded.seen_at);
 return at;
end $$;
revoke all on function public.mark_notifications_seen() from public,anon;
grant execute on function public.mark_notifications_seen() to authenticated;

commit;
