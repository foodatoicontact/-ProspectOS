-- 056 — Cockpit administrateur, socle (docs/ADMIN_COCKPIT.md, décision du propriétaire du 26 nov. 2026).
--
-- 1. public.admin_events — the administrator's feed, APPEND-ONLY (no UPDATE, DELETE or TRUNCATE, for any role, the owner
--    included). One row = one thing that happened, with a REFERENCE to the object it comes from (source_table, source_id),
--    never a copy of it: detail only holds codes (a plan, a Stripe status, an error code), never a name, an e-mail or an
--    amount. Rows are written by triggers on the existing sources and by two server functions, never by a browser:
--      SIGNUP            public.organizations insert (the account's first organization)
--      TRIAL_ENDED       public.account_entitlements BETA whose end date has passed (public.sweep_admin_events, daily)
--      INVOICE_PAID      prospectos_private.billing_accounts updated by the Stripe event invoice.paid (017/023)
--      PAYMENT_FAILED    … by invoice.payment_failed
--      PLAN_CHANGED      … when the subscribed plan changes (first subscription included: from = null)
--      CANCELLATION      … when the subscription is set to end (cancel_at_period_end) or ends (canceled)
--      WATCH_REQUEST     public.contact_requests insert, kind WATCH (the new « veille dédiée » quote form)
--      PROSPECT_REQUEST  public.contact_requests insert, kind PROSPECTS (the « 3 prospects de votre zone » form)
--      PARTNER_APPLIED   public.partner_journal APPLICATION_RECEIVED (052)
--      PARTNER_CREATED   public.partner_journal PARTNER_CREATED (052)
--      COMMISSION_DUE    public.partner_statements insert with payable = true (052)
--      COLLECT_FAILED    public.record_collect_failure, called by the collection jobs when they fail
--    dedupe_key is unique: a replayed Stripe event, a second sweep or a second failure of the same job the same day never
--    makes a second row.
-- 2. public.contact_requests — the two public forms, now stored (owner decision, 26 nov. 2026; privacy policy 3.6 and 3.8):
--    activity, target, department, professional e-mail, optional company and message, the time of consent. Deleted 12 months
--    after they were sent (public.purge_contact_requests, called by public.run_retention). Written by the server only.
-- 3. prospectos_private.admin_push_queue — the push notifications still to send (ntfy, server side): WATCH_REQUEST,
--    PAYMENT_FAILED, CANCELLATION, COMMISSION_DUE. A rows is claimed, sent, then marked SENT, or retried up to 5 times.
--    The message sent carries the kind and a link to the cockpit only: no name, no e-mail, no amount leaves ProspectOS.
--
-- Who sees what (RLS): only the administrator (ACTIVE INTERNAL entitlement, model of 043/052) reads admin_events and
-- contact_requests, through public.admin_feed or a select; no client account, no anonymous visitor reads or writes any of it.
--   admin (authenticated, INTERNAL): admin_feed
--   server only (service_role): submit_contact_request, record_collect_failure, sweep_admin_events, claim_admin_push,
--     finish_admin_push, purge_contact_requests
-- Backfill: SIGNUP for existing organizations, PARTNER_* from the partner journal, COMMISSION_DUE from payable statements and
-- TRIAL_ENDED for trials already over — none of them queued for push. Stripe history before this migration is not rebuilt.
-- Nothing else changes: no existing table gains a column; no policy, entitlement, quota, billing function or evidence
-- object is touched (four AFTER triggers are added on existing tables; they only insert into admin_events).
--
-- Rollback (the feed is a log: dropping it loses it, nothing else depends on it):
--   drop trigger if exists organizations_admin_event on public.organizations;
--   drop trigger if exists billing_accounts_admin_event on prospectos_private.billing_accounts;
--   drop trigger if exists partner_journal_admin_event on public.partner_journal;
--   drop trigger if exists partner_statements_admin_event on public.partner_statements;
--   drop trigger if exists contact_requests_admin_event on public.contact_requests;
--   restore public.run_retention() from 053_partner_applications_retention.sql;
--   drop function public.admin_feed(text[],date,date,bigint,int), public.submit_contact_request(text,text,text,text,text,text,text),
--    public.record_collect_failure(text,text), public.sweep_admin_events(), public.claim_admin_push(int),
--    public.finish_admin_push(bigint,boolean), public.purge_contact_requests(), prospectos_private.admin_emit(text,timestamptz,uuid,uuid,text,text,jsonb,text,boolean),
--    prospectos_private.admin_event_from_org(), prospectos_private.admin_event_from_billing(), prospectos_private.admin_event_from_partner_journal(),
--    prospectos_private.admin_event_from_statement(), prospectos_private.admin_event_from_contact(), prospectos_private.deny_admin_event_mutation();
--   drop table prospectos_private.admin_push_queue, public.admin_events, public.contact_requests;
begin;

create table if not exists public.admin_events (
 id bigint generated always as identity primary key,
 kind text not null check(kind in ('SIGNUP','TRIAL_ENDED','INVOICE_PAID','PAYMENT_FAILED','PLAN_CHANGED','CANCELLATION','WATCH_REQUEST',
  'PROSPECT_REQUEST','PARTNER_APPLIED','PARTNER_CREATED','COMMISSION_DUE','COLLECT_FAILED')),
 occurred_at timestamptz not null,
 organization_id uuid,
 user_id uuid,
 source_table text not null check(source_table in ('organizations','account_entitlements','stripe_webhook_events','contact_requests',
  'partner_journal','partner_applications','partner_statements','cron')),
 source_id text not null check(length(source_id) between 1 and 120),
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object' and octet_length(detail::text)<=400),
 dedupe_key text not null unique check(length(dedupe_key) between 3 and 200),
 created_at timestamptz not null default now()
);
create index if not exists admin_events_time_idx on public.admin_events(occurred_at desc,id desc);
create index if not exists admin_events_kind_idx on public.admin_events(kind,occurred_at desc);
create index if not exists admin_events_org_idx on public.admin_events(organization_id,occurred_at desc) where organization_id is not null;

create table if not exists public.contact_requests (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('PROSPECTS','WATCH')),
 activity text not null check(length(activity) between 3 and 160),
 target text not null default '' check(length(target)<=160),
 department text not null check(department ~ '^([0-9]{2,3}|2[AB])$'),
 email text not null check(email=lower(trim(email)) and length(email)<=200 and email ~ '^[^[:space:]@<>()",;:]+@[^[:space:]@<>()",;:]+\.[a-z]{2,}$'),
 company text not null default '' check(length(company)<=160),
 message text not null default '' check(length(message)<=600),
 consent_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists contact_requests_created_idx on public.contact_requests(created_at);

create table if not exists prospectos_private.admin_push_queue (
 event_id bigint primary key references public.admin_events(id),
 state text not null default 'PENDING' check(state in ('PENDING','SENT','FAILED')),
 attempts int not null default 0 check(attempts between 0 and 5),
 claimed_at timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists admin_push_queue_pending_idx on prospectos_private.admin_push_queue(event_id) where state='PENDING';
revoke all on prospectos_private.admin_push_queue from public,anon,authenticated;

-- Append-only, for every role, the owner included.
create or replace function prospectos_private.deny_admin_event_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'admin_events is append-only' using errcode='42501'; end $$;
drop trigger if exists admin_events_no_update on public.admin_events;
create trigger admin_events_no_update before update or delete on public.admin_events for each row execute function prospectos_private.deny_admin_event_mutation();
drop trigger if exists admin_events_no_truncate on public.admin_events;
create trigger admin_events_no_truncate before truncate on public.admin_events for each statement execute function prospectos_private.deny_admin_event_mutation();

alter table public.admin_events enable row level security;
alter table public.contact_requests enable row level security;
revoke all on public.admin_events,public.contact_requests from public,anon,authenticated;
grant select on public.admin_events,public.contact_requests to authenticated;
drop policy if exists admin_events_admin_read on public.admin_events;
create policy admin_events_admin_read on public.admin_events for select to authenticated using (prospectos_private.is_internal_admin());
drop policy if exists contact_requests_admin_read on public.contact_requests;
create policy contact_requests_admin_read on public.contact_requests for select to authenticated using (prospectos_private.is_internal_admin());

-- The one writer. Returns the new id, or null when that event was already recorded (dedupe_key).
create or replace function prospectos_private.admin_emit(p_kind text,p_at timestamptz,p_org uuid,p_user uuid,p_table text,p_id text,p_detail jsonb,p_key text,p_push boolean)
returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 insert into public.admin_events(kind,occurred_at,organization_id,user_id,source_table,source_id,detail,dedupe_key)
 values(p_kind,coalesce(p_at,now()),p_org,p_user,p_table,p_id,coalesce(p_detail,'{}'::jsonb),p_key)
 on conflict (dedupe_key) do nothing returning id into v;
 if v is not null and p_push and p_kind in ('WATCH_REQUEST','PAYMENT_FAILED','CANCELLATION','COMMISSION_DUE') then
  insert into prospectos_private.admin_push_queue(event_id) values(v);
 end if;
 return v;
end $$;
revoke all on function prospectos_private.admin_emit(text,timestamptz,uuid,uuid,text,text,jsonb,text,boolean) from public,anon,authenticated;

-- The organization of an account: the first one it owns.
create or replace function prospectos_private.admin_org_of(p_user uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select id from public.organizations where owner_id=p_user order by created_at,id limit 1
$$;
revoke all on function prospectos_private.admin_org_of(uuid) from public,anon,authenticated;

-- ── Sources ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function prospectos_private.admin_event_from_org() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform prospectos_private.admin_emit('SIGNUP',new.created_at,new.id,new.owner_id,'organizations',new.id::text,'{}'::jsonb,'signup:'||new.id,true);
 return null;
end $$;
drop trigger if exists organizations_admin_event on public.organizations;
create trigger organizations_admin_event after insert on public.organizations for each row execute function prospectos_private.admin_event_from_org();

-- Billing: the Stripe event that caused the update is the one recorded first by apply_stripe_subscription_state (017/023).
create or replace function prospectos_private.admin_event_from_billing() returns trigger
language plpgsql security definer set search_path='' as $$
declare t text; o uuid; ev text:=new.last_event_id;
begin
 if ev is null or ev is not distinct from old.last_event_id then return null; end if;
 select event_type into t from prospectos_private.stripe_webhook_events where event_id=ev;
 o:=prospectos_private.admin_org_of(new.user_id);
 if t='invoice.paid' then
  perform prospectos_private.admin_emit('INVOICE_PAID',now(),o,new.user_id,'stripe_webhook_events',ev,jsonb_build_object('plan',new.plan,'status',new.subscription_status),'invoice_paid:'||ev,true);
 elsif t='invoice.payment_failed' then
  perform prospectos_private.admin_emit('PAYMENT_FAILED',now(),o,new.user_id,'stripe_webhook_events',ev,jsonb_build_object('plan',new.plan,'status',new.subscription_status),'payment_failed:'||ev,true);
 end if;
 if new.plan is not null and new.plan is distinct from old.plan then
  perform prospectos_private.admin_emit('PLAN_CHANGED',now(),o,new.user_id,'stripe_webhook_events',ev,jsonb_build_object('from',old.plan,'to',new.plan),'plan_changed:'||ev,true);
 end if;
 if (new.cancel_at_period_end and not old.cancel_at_period_end)
    or (new.subscription_status='canceled' and old.subscription_status is distinct from 'canceled') then
  perform prospectos_private.admin_emit('CANCELLATION',now(),o,new.user_id,'stripe_webhook_events',ev,
   jsonb_build_object('plan',coalesce(new.plan,old.plan),'at_period_end',new.subscription_status<>'canceled','period_end',new.current_period_end),'cancellation:'||ev,true);
 end if;
 return null;
end $$;
drop trigger if exists billing_accounts_admin_event on prospectos_private.billing_accounts;
create trigger billing_accounts_admin_event after update on prospectos_private.billing_accounts for each row execute function prospectos_private.admin_event_from_billing();

create or replace function prospectos_private.admin_event_from_partner_journal() returns trigger
language plpgsql security definer set search_path='' as $$
declare app text;
begin
 if new.kind='APPLICATION_RECEIVED' then
  app:=new.detail->>'application_id';
  perform prospectos_private.admin_emit('PARTNER_APPLIED',new.created_at,null,null,'partner_applications',coalesce(app,new.id::text),'{}'::jsonb,'partner_applied:'||new.id,true);
 elsif new.kind='PARTNER_CREATED' then
  perform prospectos_private.admin_emit('PARTNER_CREATED',new.created_at,null,null,'partner_journal',new.id::text,'{}'::jsonb,'partner_created:'||new.id,true);
 end if;
 return null;
end $$;
drop trigger if exists partner_journal_admin_event on public.partner_journal;
create trigger partner_journal_admin_event after insert on public.partner_journal for each row execute function prospectos_private.admin_event_from_partner_journal();

create or replace function prospectos_private.admin_event_from_statement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.payable then
  perform prospectos_private.admin_emit('COMMISSION_DUE',new.created_at,null,null,'partner_statements',new.id::text,
   jsonb_build_object('month',new.month),'commission_due:'||new.id,true);
 end if;
 return null;
end $$;
drop trigger if exists partner_statements_admin_event on public.partner_statements;
create trigger partner_statements_admin_event after insert on public.partner_statements for each row execute function prospectos_private.admin_event_from_statement();

create or replace function prospectos_private.admin_event_from_contact() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform prospectos_private.admin_emit(case new.kind when 'WATCH' then 'WATCH_REQUEST' else 'PROSPECT_REQUEST' end,new.created_at,null,null,
  'contact_requests',new.id::text,'{}'::jsonb,'contact:'||new.id,true);
 return null;
end $$;
drop trigger if exists contact_requests_admin_event on public.contact_requests;
create trigger contact_requests_admin_event after insert on public.contact_requests for each row execute function prospectos_private.admin_event_from_contact();

-- ── Server functions ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.submit_contact_request(p_kind text,p_activity text,p_target text,p_department text,p_email text,p_company text,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contact_requests;
begin
 if p_kind not in ('PROSPECTS','WATCH') then raise exception 'contact_kind_invalid' using errcode='22023'; end if;
 insert into public.contact_requests(kind,activity,target,department,email,company,message,consent_at)
 values(p_kind,trim(p_activity),trim(coalesce(p_target,'')),upper(trim(p_department)),lower(trim(p_email)),trim(coalesce(p_company,'')),trim(coalesce(p_message,'')),now())
 returning * into r;
 return jsonb_build_object('id',r.id);
end $$;

-- A collection job that failed: one row per job and Paris day, whatever the number of retries.
create or replace function public.record_collect_failure(p_job text,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'Europe/Paris')::date; v bigint;
begin
 if p_job !~ '^[a-z0-9-]{2,40}$' or coalesce(p_code,'') !~ '^[A-Z0-9_]{2,60}$' then raise exception 'collect_failure_invalid' using errcode='22023'; end if;
 v:=prospectos_private.admin_emit('COLLECT_FAILED',now(),null,null,'cron',p_job||':'||d,jsonb_build_object('job',p_job,'code',p_code),'collect_failed:'||p_job||':'||d,true);
 return jsonb_build_object('recorded',v is not null);
end $$;

-- Trials that are over (daily). The end of a trial is not a row change: it is read from the entitlement's end date.
create or replace function public.sweep_admin_events() returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int:=0; e record;
begin
 for e in select user_id,expires_at from public.account_entitlements where plan='BETA' and expires_at<=now() loop
  if prospectos_private.admin_emit('TRIAL_ENDED',e.expires_at,prospectos_private.admin_org_of(e.user_id),e.user_id,'account_entitlements',e.user_id::text,
   '{}'::jsonb,'trial_end:'||e.user_id||':'||extract(epoch from e.expires_at)::bigint,true) is not null then n:=n+1; end if;
 end loop;
 return jsonb_build_object('trials_ended',n);
end $$;

-- Push: claim at most p_limit pending notifications (a claim is held 5 minutes), then report each one.
create or replace function public.claim_admin_push(p_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 with c as (
  select q.event_id from prospectos_private.admin_push_queue q
  where q.state='PENDING' and (q.claimed_at is null or q.claimed_at<now()-interval '5 minutes')
  order by q.event_id limit greatest(1,least(coalesce(p_limit,20),50)) for update skip locked
 ), u as (
  update prospectos_private.admin_push_queue q set claimed_at=now(),attempts=q.attempts+1,updated_at=now() from c where q.event_id=c.event_id returning q.event_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'occurred_at',e.occurred_at) order by e.id),'[]'::jsonb) into r
 from u join public.admin_events e on e.id=u.event_id;
 return r;
end $$;

create or replace function public.finish_admin_push(p_event_id bigint,p_sent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s text;
begin
 update prospectos_private.admin_push_queue set
  state=case when p_sent then 'SENT' when attempts>=5 then 'FAILED' else 'PENDING' end,
  claimed_at=case when p_sent then claimed_at else null end,updated_at=now()
 where event_id=p_event_id returning state into s;
 return jsonb_build_object('state',s);
end $$;

create or replace function public.purge_contact_requests() returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 delete from public.contact_requests where created_at<now()-interval '12 months';
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
 r:=r||jsonb_build_object('contact_requests',public.purge_contact_requests());
 return r;
end $$;

revoke all on function public.submit_contact_request(text,text,text,text,text,text,text),public.record_collect_failure(text,text),
 public.sweep_admin_events(),public.claim_admin_push(int),public.finish_admin_push(bigint,boolean),public.purge_contact_requests(),
 public.run_retention() from public,anon,authenticated;
grant execute on function public.submit_contact_request(text,text,text,text,text,text,text),public.record_collect_failure(text,text),
 public.sweep_admin_events(),public.claim_admin_push(int),public.finish_admin_push(bigint,boolean),public.purge_contact_requests(),
 public.run_retention() to service_role;

-- ── Administrator: the feed ─────────────────────────────────────────────────────────────────────────────────────────────
-- Filtered by kinds and Paris dates, newest first, by pages (p_before = the last id of the previous page). Each row is
-- resolved from its source at read time: what the source no longer holds (a request deleted after 12 months) shows as gone.
create or replace function public.admin_feed(p_kinds text[],p_from date,p_to date,p_before bigint,p_limit int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lim int:=greatest(1,least(coalesce(p_limit,50),200)); rows jsonb;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc),'[]'::jsonb) into rows from (
  select jsonb_build_object('id',e.id,'kind',e.kind,'occurred_at',e.occurred_at,'organization_id',e.organization_id,
   'organization',o.name,'source_table',e.source_table,'source_id',e.source_id,'detail',e.detail,
   'source',case
    when e.source_table='contact_requests' then (select jsonb_build_object('activity',c.activity,'department',c.department,'company',nullif(c.company,''))
      from public.contact_requests c where c.id::text=e.source_id)
    when e.source_table='partner_applications' then (select jsonb_build_object('company',a.company) from public.partner_applications a where a.id::text=e.source_id)
    when e.source_table='partner_journal' then (select jsonb_build_object('company',p.company,'code',p.code) from public.partner_journal j
      join public.partners p on p.id=j.partner_id where j.id::text=e.source_id)
    when e.source_table='partner_statements' then (select jsonb_build_object('company',p.company,'balance_cents',s.balance_cents,'paid',exists(select 1 from public.partner_payouts y where y.statement_id=s.id))
      from public.partner_statements s join public.partners p on p.id=s.partner_id where s.id::text=e.source_id)
    else null end) x
  from public.admin_events e left join public.organizations o on o.id=e.organization_id
  where (p_kinds is null or cardinality(p_kinds)=0 or e.kind=any(p_kinds))
    and (p_from is null or e.occurred_at>=(p_from::timestamp at time zone 'Europe/Paris'))
    and (p_to is null or e.occurred_at<((p_to+1)::timestamp at time zone 'Europe/Paris'))
    and (p_before is null or e.id<p_before)
  order by e.id desc limit lim) t;
 return jsonb_build_object('events',rows,'has_more',jsonb_array_length(rows)=lim);
end $$;
revoke all on function public.admin_feed(text[],date,date,bigint,int) from public,anon;
grant execute on function public.admin_feed(text[],date,date,bigint,int) to authenticated;

-- ── Backfill (no push) ──────────────────────────────────────────────────────────────────────────────────────────────────
select prospectos_private.admin_emit('SIGNUP',o.created_at,o.id,o.owner_id,'organizations',o.id::text,'{}'::jsonb,'signup:'||o.id,false) from public.organizations o;
select prospectos_private.admin_emit('PARTNER_APPLIED',j.created_at,null,null,'partner_applications',coalesce(j.detail->>'application_id',j.id::text),'{}'::jsonb,'partner_applied:'||j.id,false)
 from public.partner_journal j where j.kind='APPLICATION_RECEIVED';
select prospectos_private.admin_emit('PARTNER_CREATED',j.created_at,null,null,'partner_journal',j.id::text,'{}'::jsonb,'partner_created:'||j.id,false)
 from public.partner_journal j where j.kind='PARTNER_CREATED';
select prospectos_private.admin_emit('COMMISSION_DUE',s.created_at,null,null,'partner_statements',s.id::text,jsonb_build_object('month',s.month),'commission_due:'||s.id,false)
 from public.partner_statements s where s.payable;
select prospectos_private.admin_emit('TRIAL_ENDED',e.expires_at,prospectos_private.admin_org_of(e.user_id),e.user_id,'account_entitlements',e.user_id::text,'{}'::jsonb,
 'trial_end:'||e.user_id||':'||extract(epoch from e.expires_at)::bigint,false) from public.account_entitlements e where e.plan='BETA' and e.expires_at<=now();

commit;
