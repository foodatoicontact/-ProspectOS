-- 057 — ProspectOS installable (PWA) : notifications push web et invitation à installer (docs/PWA.md, décision du
-- propriétaire du 26 nov. 2026). Builds on 056 (the administrator's feed).
--
-- 1. public.push_subscriptions — one row per device that said yes: the Web Push endpoint and its two public keys (what the
--    browser gives; no name, no e-mail). Written and deleted by the account itself through two functions, never read by a
--    browser. A subscription the push service declares gone (404/410) is deleted by the server.
-- 2. public.user_app_settings — per account: which notifications it wants (new veille delivery, new signals on a monitored
--    prospect, end of trial; all three on once the person has consented) and whether it refused the install invitation
--    (« Ne plus afficher », stored on the account so every device stops asking).
-- 3. prospectos_private.user_push_queue — the notifications to send, one per account and event (dedupe_key unique):
--      DELIVERY      a veille delivery is created for an organization → each of its members who wants it
--      SIGNALS       a monitoring run (trigger 'monitor') finds signals → the person who monitors, at most once a day
--      TRIAL_ENDED   a trial has ended (public.sweep_admin_events, daily, from 056) → the account, once
--    Only accounts with at least one subscription and the kind switched on are queued. The message carries a short generic
--    text and a link into the app, never a company name or the content of a signal.
-- 4. public.admin_events (056) gains four kinds, measured for the cockpit: INSTALL_PROMPT_SHOWN, INSTALL_PROMPT_REFUSED,
--    APP_INSTALLED, PUSH_ENABLED (source_table 'app'; source_id = the account; detail = the platform only). Recorded by the
--    signed-in account through public.record_app_event, bounded per device (an identifier drawn at random by that device).
--
-- Who may do what: the account itself (authenticated): app_settings, set_push_preferences, save_push_subscription,
-- delete_push_subscription, refuse_install_prompt, record_app_event — each on its own row only. Server only (service_role):
-- claim_user_push, finish_user_push, drop_push_subscription, drop_user_push_subscriptions (account deletion). No browser reads a subscription, the queue or another account.
-- Nothing else changes: no evidence, billing, entitlement, quota or existing policy is touched; three AFTER triggers are
-- added (dedicated_deliveries, signals, account_entitlements via the sweep) and they only queue notifications.
--
-- Rollback: drop trigger if exists dedicated_deliveries_user_push on public.dedicated_deliveries;
--   drop trigger if exists signals_user_push on public.signals; restore public.sweep_admin_events() and the admin_events
--   checks from 056; drop function public.app_settings(), public.set_push_preferences(boolean,boolean,boolean),
--   public.save_push_subscription(text,text,text,text), public.delete_push_subscription(text), public.refuse_install_prompt(),
--   public.record_app_event(text,text,text), public.claim_user_push(int), public.finish_user_push(bigint,boolean),
--   public.drop_push_subscription(text), public.drop_user_push_subscriptions(uuid), prospectos_private.queue_user_push(uuid,text,text,text),
--   prospectos_private.user_push_from_delivery(), prospectos_private.user_push_from_signal();
--   drop table prospectos_private.user_push_queue, public.push_subscriptions, public.user_app_settings;
begin;

create table if not exists public.user_app_settings (
 user_id uuid primary key references auth.users(id),
 push_delivery boolean not null default true,
 push_signals boolean not null default true,
 push_trial boolean not null default true,
 install_prompt_refused_at timestamptz,
 updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 endpoint text not null unique check(endpoint ~ '^https://[^[:space:]]+$' and length(endpoint)<=1000),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{16,32}$'),
 platform text not null default 'other' check(platform in ('ios','android','desktop','other')),
 created_at timestamptz not null default now(),
 last_sent_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists prospectos_private.user_push_queue (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('DELIVERY','SIGNALS','TRIAL_ENDED')),
 url text not null check(url ~ '^/[A-Za-z0-9/_?=&#.-]*$' and length(url)<=200),
 dedupe_key text not null unique check(length(dedupe_key) between 3 and 200),
 state text not null default 'PENDING' check(state in ('PENDING','SENT','FAILED','SKIPPED')),
 attempts int not null default 0 check(attempts between 0 and 5),
 claimed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists user_push_queue_pending_idx on prospectos_private.user_push_queue(id) where state='PENDING';
revoke all on prospectos_private.user_push_queue from public,anon,authenticated;

alter table public.user_app_settings enable row level security;
alter table public.push_subscriptions enable row level security;
revoke all on public.user_app_settings,public.push_subscriptions from public,anon,authenticated;

-- The feed of 056 gains the four measured events of the app.
alter table public.admin_events drop constraint if exists admin_events_kind_check;
alter table public.admin_events add constraint admin_events_kind_check check(kind in ('SIGNUP','TRIAL_ENDED','INVOICE_PAID','PAYMENT_FAILED',
 'PLAN_CHANGED','CANCELLATION','WATCH_REQUEST','PROSPECT_REQUEST','PARTNER_APPLIED','PARTNER_CREATED','COMMISSION_DUE','COLLECT_FAILED',
 'INSTALL_PROMPT_SHOWN','INSTALL_PROMPT_REFUSED','APP_INSTALLED','PUSH_ENABLED'));
alter table public.admin_events drop constraint if exists admin_events_source_table_check;
alter table public.admin_events add constraint admin_events_source_table_check check(source_table in ('organizations','account_entitlements',
 'stripe_webhook_events','contact_requests','partner_journal','partner_applications','partner_statements','cron','app'));

-- ── Queue ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Queues one notification for one account if it has a device subscribed and wants that kind. Returns whether it was queued.
create or replace function prospectos_private.queue_user_push(p_user uuid,p_kind text,p_url text,p_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.user_app_settings; v bigint;
begin
 if p_user is null or not exists(select 1 from public.push_subscriptions where user_id=p_user) then return false; end if;
 select * into s from public.user_app_settings where user_id=p_user;
 if not found then return false; end if;
 if (p_kind='DELIVERY' and not s.push_delivery) or (p_kind='SIGNALS' and not s.push_signals) or (p_kind='TRIAL_ENDED' and not s.push_trial) then return false; end if;
 insert into prospectos_private.user_push_queue(user_id,kind,url,dedupe_key) values(p_user,p_kind,p_url,p_key)
 on conflict (dedupe_key) do nothing returning id into v;
 return v is not null;
end $$;
revoke all on function prospectos_private.queue_user_push(uuid,text,text,text) from public,anon,authenticated;

create or replace function prospectos_private.user_push_from_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare m record;
begin
 for m in select user_id from public.memberships where organization_id=new.organization_id loop
  perform prospectos_private.queue_user_push(m.user_id,'DELIVERY','/app#veille','delivery:'||new.id||':'||m.user_id);
 end loop;
 return null;
end $$;
drop trigger if exists dedicated_deliveries_user_push on public.dedicated_deliveries;
create trigger dedicated_deliveries_user_push after insert on public.dedicated_deliveries for each row execute function prospectos_private.user_push_from_delivery();

-- Signals found by monitoring (never by a search the person ran themselves): one notification a day at most.
create or replace function prospectos_private.user_push_from_signal() returns trigger
language plpgsql security definer set search_path='' as $$
declare who uuid;
begin
 if new.signal_run_id is null then return null; end if;
 select r.created_by into who from public.signal_runs r where r.id=new.signal_run_id and r.trigger='monitor';
 if who is null then return null; end if;
 perform prospectos_private.queue_user_push(who,'SIGNALS','/app#aujourdhui','signals:'||who||':'||(now() at time zone 'Europe/Paris')::date);
 return null;
end $$;
drop trigger if exists signals_user_push on public.signals;
create trigger signals_user_push after insert on public.signals for each row execute function prospectos_private.user_push_from_signal();

-- 056's daily sweep, plus the end-of-trial notification (only for a trial that ended in the last 3 days: an old trial is
-- recorded in the feed but never announced).
create or replace function public.sweep_admin_events() returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int:=0; p int:=0; e record;
begin
 for e in select user_id,expires_at from public.account_entitlements where plan='BETA' and expires_at<=now() loop
  if prospectos_private.admin_emit('TRIAL_ENDED',e.expires_at,prospectos_private.admin_org_of(e.user_id),e.user_id,'account_entitlements',e.user_id::text,
   '{}'::jsonb,'trial_end:'||e.user_id||':'||extract(epoch from e.expires_at)::bigint,true) is not null then n:=n+1; end if;
  if e.expires_at>now()-interval '3 days' and prospectos_private.queue_user_push(e.user_id,'TRIAL_ENDED','/app#offres',
   'trial_end:'||e.user_id||':'||extract(epoch from e.expires_at)::bigint) then p:=p+1; end if;
 end loop;
 return jsonb_build_object('trials_ended',n,'trial_pushes',p);
end $$;
revoke all on function public.sweep_admin_events() from public,anon,authenticated;
grant execute on function public.sweep_admin_events() to service_role;

-- ── The account itself ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.app_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); s public.user_app_settings;
begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into s from public.user_app_settings where user_id=me;
 return jsonb_build_object('install_prompt_refused',s.install_prompt_refused_at is not null,
  'push',jsonb_build_object('delivery',coalesce(s.push_delivery,true),'signals',coalesce(s.push_signals,true),'trial',coalesce(s.push_trial,true)),
  'devices',(select count(*) from public.push_subscriptions where user_id=me));
end $$;

create or replace function public.set_push_preferences(p_delivery boolean,p_signals boolean,p_trial boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.user_app_settings(user_id,push_delivery,push_signals,push_trial) values(me,coalesce(p_delivery,true),coalesce(p_signals,true),coalesce(p_trial,true))
 on conflict (user_id) do update set push_delivery=excluded.push_delivery,push_signals=excluded.push_signals,push_trial=excluded.push_trial,updated_at=now();
 return public.app_settings();
end $$;

-- Consent on this device: the browser's subscription, saved for the signed-in account. An endpoint already saved for
-- another account (a shared device) moves to this one: a device notifies one account only.
create or replace function public.save_push_subscription(p_endpoint text,p_p256dh text,p_auth text,p_platform text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if (select count(*) from public.push_subscriptions where user_id=me and endpoint<>p_endpoint)>=10 then raise exception 'push_device_limit' using errcode='22023'; end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,platform) values(me,p_endpoint,p_p256dh,p_auth,coalesce(nullif(p_platform,''),'other'))
 on conflict (endpoint) do update set user_id=me,p256dh=excluded.p256dh,auth=excluded.auth,platform=excluded.platform,created_at=now();
 insert into public.user_app_settings(user_id) values(me) on conflict (user_id) do nothing;
 return public.app_settings();
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 delete from public.push_subscriptions where user_id=me and endpoint=p_endpoint;
 return public.app_settings();
end $$;

create or replace function public.refuse_install_prompt() returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.user_app_settings(user_id,install_prompt_refused_at) values(me,now())
 on conflict (user_id) do update set install_prompt_refused_at=coalesce(public.user_app_settings.install_prompt_refused_at,now()),updated_at=now();
 return public.app_settings();
end $$;

-- The four measured events. p_device: an identifier drawn at random by the device (no fingerprint); bounded so a device
-- cannot flood the feed: an invitation is shown at most 3 times per device, the rest at most once per device.
create or replace function public.record_app_event(p_kind text,p_device text,p_platform text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); k text; n int; v bigint;
begin
 if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_device !~ '^[A-Za-z0-9-]{16,40}$' or coalesce(p_platform,'') not in ('ios','android','desktop','other') then raise exception 'app_event_invalid' using errcode='22023'; end if;
 k:=case p_kind when 'invitation_affichee' then 'INSTALL_PROMPT_SHOWN' when 'invitation_refusee' then 'INSTALL_PROMPT_REFUSED'
  when 'app_installee' then 'APP_INSTALLED' when 'notifications_activees' then 'PUSH_ENABLED' end;
 if k is null then raise exception 'app_event_invalid' using errcode='22023'; end if;
 if k='INSTALL_PROMPT_SHOWN' then
  select count(*) into n from public.admin_events where kind=k and dedupe_key like 'app:'||k||':'||p_device||':%';
  if n>=3 then return jsonb_build_object('recorded',false); end if;
  v:=prospectos_private.admin_emit(k,now(),prospectos_private.admin_org_of(me),me,'app',me::text,jsonb_build_object('platform',p_platform),'app:'||k||':'||p_device||':'||(n+1),false);
 else
  v:=prospectos_private.admin_emit(k,now(),prospectos_private.admin_org_of(me),me,'app',me::text,jsonb_build_object('platform',p_platform),'app:'||k||':'||p_device,false);
 end if;
 return jsonb_build_object('recorded',v is not null);
end $$;

revoke all on function public.app_settings(),public.set_push_preferences(boolean,boolean,boolean),public.save_push_subscription(text,text,text,text),
 public.delete_push_subscription(text),public.refuse_install_prompt(),public.record_app_event(text,text,text) from public,anon;
grant execute on function public.app_settings(),public.set_push_preferences(boolean,boolean,boolean),public.save_push_subscription(text,text,text,text),
 public.delete_push_subscription(text),public.refuse_install_prompt(),public.record_app_event(text,text,text) to authenticated;

-- ── Server ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Claims at most p_limit notifications (held 5 minutes), each with the account's subscriptions. A notification whose
-- account has no subscription any more is closed as SKIPPED.
create or replace function public.claim_user_push(p_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 update prospectos_private.user_push_queue q set state='SKIPPED',updated_at=now()
 where q.state='PENDING' and not exists(select 1 from public.push_subscriptions s where s.user_id=q.user_id);
 with c as (
  select q.id from prospectos_private.user_push_queue q
  where q.state='PENDING' and (q.claimed_at is null or q.claimed_at<now()-interval '5 minutes')
  order by q.id limit greatest(1,least(coalesce(p_limit,50),100)) for update skip locked
 ), u as (
  update prospectos_private.user_push_queue q set claimed_at=now(),attempts=q.attempts+1,updated_at=now() from c where q.id=c.id returning q.id,q.user_id,q.kind,q.url
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'kind',u.kind,'url',u.url,'subscriptions',
   (select coalesce(jsonb_agg(jsonb_build_object('endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb) from public.push_subscriptions s where s.user_id=u.user_id)
  ) order by u.id),'[]'::jsonb) into r from u;
 return r;
end $$;

create or replace function public.finish_user_push(p_id bigint,p_sent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s text;
begin
 update prospectos_private.user_push_queue set
  state=case when p_sent then 'SENT' when attempts>=5 then 'FAILED' else 'PENDING' end,
  claimed_at=case when p_sent then claimed_at else null end,updated_at=now()
 where id=p_id returning state into s;
 if p_sent then update public.push_subscriptions set last_sent_at=now() where user_id=(select user_id from prospectos_private.user_push_queue where id=p_id); end if;
 return jsonb_build_object('state',s);
end $$;

-- The push service said this subscription no longer exists (404/410): it is deleted.
create or replace function public.drop_push_subscription(p_endpoint text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 delete from public.push_subscriptions where endpoint=p_endpoint;
 return found;
end $$;

-- Account deletion (the route of /account/delete, before the anonymization): every device of the account stops receiving.
create or replace function public.drop_user_push_subscriptions(p_user uuid) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 delete from public.push_subscriptions where user_id=p_user;
 get diagnostics n=row_count;
 update prospectos_private.user_push_queue set state='SKIPPED',updated_at=now() where user_id=p_user and state='PENDING';
 return n;
end $$;

revoke all on function public.claim_user_push(int),public.finish_user_push(bigint,boolean),public.drop_push_subscription(text),
 public.drop_user_push_subscriptions(uuid) from public,anon,authenticated;
grant execute on function public.claim_user_push(int),public.finish_user_push(bigint,boolean),public.drop_push_subscription(text),
 public.drop_user_push_subscriptions(uuid) to service_role;

commit;
