-- 052 — Programme partenaires (src/partners, docs/PARTNERS.md). A partner (an agency, a consultant, an accountant…) brings
-- clients to ProspectOS and receives a commission: by default 30 % of the amount EXCLUDING TAX actually paid by each client
-- brought, for the 12 months that follow that client's first payment. Same logic as the veille dédiée (043): an append-only
-- journal, a monthly statement, strict RLS, and nobody writes the tables directly — the functions below decide.
--
-- 1. public.partners — name, company, SIRET (14 digits, Luhn key checked), e-mail, unique code (A–Z and 0–9, 3 to 20
--    characters), rate (30 by default), status ACTIVE or SUSPENDED. Created by the administrator only. A partner may have a
--    ProspectOS account to read their space (matched on their CONFIRMED e-mail, then bound to that account), never required.
-- 2. Attribution, without any cookie: the code typed at sign-up (pre-filled from ?ref=CODE, kept in sessionStorage only) is
--    stored by Supabase Auth with the account (user_metadata.partner_code). When that account creates its FIRST organization,
--    a trigger sets organizations.referred_by / referred_at — once. Ignored without blocking anything: an unknown code.
--    Refused (and journaled): a suspended partner, the partner's own e-mail or account (self-referral), an account that
--    already had an organization. referred_by / referred_at can no longer change, except through the administrator's
--    set_organization_referral, which journals the change with its reason.
-- 3. public.partner_commissions — the APPEND-ONLY ledger. On Stripe invoice.paid (re-read from Stripe by the server): one
--    line = amount HT paid × the partner's rate, with the Stripe invoice reference, if the invoice was paid within 12 months
--    of the client's first payment. A refund (charge.refunded) adds a NEGATIVE line, proportional to what was refunded
--    (the whole commission for a full refund). One invoice never makes two lines; a replayed refund never makes two lines.
-- 4. public.partner_statements — on the 1st of each month, per partner: clients brought, payments, commissions of the month,
--    cumulative balance. Payable from 50 €; below, the balance is carried over. public.partner_payouts — the administrator
--    marks the latest payable statement as paid, with the date and the transfer reference. No automatic transfer.
-- 5. public.partner_applications — the public form (/partenaires). Validated by hand: the administrator creates the partner.
-- 6. public.partner_journal — APPEND-ONLY: partner created, status changed, attribution made or refused, referral changed
--    by the administrator, statement generated, payout, application received.
--
-- Who sees what (RLS): the administrator (ACTIVE INTERNAL entitlement, model of 013/043) sees everything. A partner reads
-- their own space through partner_space(): their code, counts and amounts, each client as an anonymous identifier only — no
-- name, no e-mail, no organization of a client. No browser role may read the commission ledger or the applications directly.
--   admin (authenticated, INTERNAL): create_partner, set_partner_status, set_organization_referral, mark_partner_statement_paid,
--     partner_admin_overview
--   partner (authenticated): partner_space
--   server only (service_role): record_partner_invoice, record_partner_refund, generate_partner_statements,
--     submit_partner_application, partner_of_user
-- Behind NEXT_PUBLIC_PARTNERS_ENABLED (off by default): nothing calls these functions while it is off, and without a code in
-- an account's metadata the attribution trigger does nothing. Amounts are in euro cents; months are Paris months.
-- Nothing else changes: public.organizations gains two columns and two triggers; no existing policy, function, quota,
-- entitlement, billing table or evidence object is touched.
--
-- Rollback (only while no partner is paid — the ledger is the evidence of both parties):
--   drop trigger organizations_partner_attribution on public.organizations; drop trigger organizations_referral_locked on public.organizations;
--   drop function public.create_partner(text,text,text,text,text,numeric), public.set_partner_status(uuid,text),
--    public.set_organization_referral(uuid,uuid,text), public.mark_partner_statement_paid(uuid,date,text), public.partner_admin_overview(),
--    public.partner_space(), public.record_partner_invoice(text,text,text,timestamptz,bigint,bigint,text),
--    public.record_partner_refund(text,text,text,bigint), public.generate_partner_statements(date),
--    public.submit_partner_application(text,text,text,text,text), public.partner_of_user(uuid),
--    prospectos_private.partner_attribute(), prospectos_private.partner_referral_locked(), prospectos_private.partner_log(uuid,uuid,text,jsonb),
--    prospectos_private.deny_partner_mutation(), prospectos_private.siret_valid(text), prospectos_private.my_partner_id(),
--    prospectos_private.partner_client_ref(uuid,uuid), prospectos_private.paris_month_start(timestamptz);
--   drop table public.partner_payouts, public.partner_statements, public.partner_commissions, public.partner_first_payments,
--    public.partner_journal, public.partner_applications;
--   alter table public.organizations drop column referred_by, drop column referred_at; drop table public.partners;
begin;

-- SIRET: 14 digits and a valid Luhn key (La Poste's establishments, SIREN 356000000, use the sum of the digits modulo 5).
create or replace function prospectos_private.siret_valid(p text) returns boolean
language plpgsql immutable set search_path='' as $$
declare s int:=0; d int; i int;
begin
 if p is null or p !~ '^[0-9]{14}$' then return false; end if;
 if left(p,9)='356000000' then
  for i in 1..14 loop s:=s+substr(p,i,1)::int; end loop; return s%5=0;
 end if;
 for i in 1..14 loop
  d:=substr(p,i,1)::int;
  if i%2=1 then d:=d*2; if d>9 then d:=d-9; end if; end if;
  s:=s+d;
 end loop;
 return s%10=0;
end $$;

create or replace function prospectos_private.paris_month_start(p timestamptz) returns date
language sql stable set search_path='' as $$ select date_trunc('month',p at time zone 'Europe/Paris')::date $$;

create table if not exists public.partners (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 120),
 company text not null check(length(trim(company)) between 2 and 160),
 siret text not null check(prospectos_private.siret_valid(siret)),
 email text not null check(email=lower(trim(email)) and email ~ '^[^[:space:]@<>()",;:]+@[^[:space:]@<>()",;:]+\.[a-z]{2,}$' and length(email)<=254),
 code text not null unique check(code ~ '^[A-Z0-9]{3,20}$'),
 rate_percent numeric(5,2) not null default 30 check(rate_percent>0 and rate_percent<=50),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','SUSPENDED')),
 user_id uuid unique references auth.users(id),
 created_by uuid not null,
 created_at timestamptz not null default now()
);
create unique index if not exists partners_email_uq on public.partners(email);

alter table public.organizations add column if not exists referred_by uuid references public.partners(id);
alter table public.organizations add column if not exists referred_at timestamptz;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='organizations_referral_pair') then
  alter table public.organizations add constraint organizations_referral_pair check((referred_by is null)=(referred_at is null));
 end if;
end $$;
create index if not exists organizations_referred_by_idx on public.organizations(referred_by) where referred_by is not null;

create table if not exists public.partner_journal (
 id bigint generated always as identity primary key,
 partner_id uuid references public.partners(id),
 organization_id uuid references public.organizations(id),
 actor_id uuid,
 kind text not null check(kind in ('PARTNER_CREATED','PARTNER_STATUS','ATTRIBUTED','ATTRIBUTION_REFUSED','REFERRAL_CHANGED',
  'STATEMENT_GENERATED','PAYOUT','APPLICATION_RECEIVED')),
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object' and octet_length(detail::text)<=4000),
 created_at timestamptz not null default now()
);
create index if not exists partner_journal_partner_idx on public.partner_journal(partner_id,created_at desc);

-- The first payment of each referred organization: the start of its 12-month window (never moved once written).
create table if not exists public.partner_first_payments (
 organization_id uuid primary key references public.organizations(id),
 first_paid_at timestamptz not null,
 stripe_invoice_id text not null check(stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
 created_at timestamptz not null default now()
);

create table if not exists public.partner_commissions (
 id bigint generated always as identity primary key,
 partner_id uuid not null references public.partners(id),
 organization_id uuid not null references public.organizations(id),
 kind text not null check(kind in ('COMMISSION','REFUND')),
 stripe_invoice_id text not null check(stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
 stripe_charge_id text check(stripe_charge_id is null or stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9]+$'),
 stripe_event_id text not null check(stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
 -- COMMISSION: what the client paid (with and without tax). REFUND: the cumulative amount refunded on that charge so far.
 paid_amount_cents bigint not null check(paid_amount_cents>=0),
 paid_amount_ht_cents bigint not null check(paid_amount_ht_cents>=0),
 rate_percent numeric(5,2) not null check(rate_percent>0 and rate_percent<=50),
 amount_cents bigint not null,
 occurred_at timestamptz not null,
 created_at timestamptz not null default now(),
 check((kind='COMMISSION' and amount_cents>=0 and stripe_charge_id is null) or (kind='REFUND' and amount_cents<0 and stripe_charge_id is not null))
);
create unique index if not exists partner_commissions_invoice_uq on public.partner_commissions(stripe_invoice_id) where kind='COMMISSION';
create unique index if not exists partner_commissions_refund_uq on public.partner_commissions(stripe_charge_id,paid_amount_cents) where kind='REFUND';
create unique index if not exists partner_commissions_event_uq on public.partner_commissions(stripe_event_id);
create index if not exists partner_commissions_partner_idx on public.partner_commissions(partner_id,occurred_at);

create table if not exists public.partner_statements (
 id uuid primary key default gen_random_uuid(),
 partner_id uuid not null references public.partners(id),
 month date not null check(extract(day from month)=1),
 referred_count int not null check(referred_count>=0),
 paying_clients int not null check(paying_clients>=0),
 payments_count int not null check(payments_count>=0),
 month_commissions_cents bigint not null,
 balance_cents bigint not null,
 threshold_cents bigint not null check(threshold_cents=5000),
 payable boolean not null,
 created_at timestamptz not null default now(),
 unique(partner_id,month),
 check(payable=(balance_cents>=threshold_cents))
);

create table if not exists public.partner_payouts (
 id uuid primary key default gen_random_uuid(),
 partner_id uuid not null references public.partners(id),
 statement_id uuid not null unique references public.partner_statements(id),
 amount_cents bigint not null check(amount_cents>=5000),
 paid_on date not null,
 transfer_reference text not null check(length(trim(transfer_reference)) between 3 and 80),
 created_by uuid not null,
 created_at timestamptz not null default now()
);

create table if not exists public.partner_applications (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 120),
 company text not null check(length(trim(company)) between 2 and 160),
 siret text not null check(prospectos_private.siret_valid(siret)),
 email text not null check(email=lower(trim(email)) and length(email)<=254 and email ~ '^[^[:space:]@<>()",;:]+@[^[:space:]@<>()",;:]+\.[a-z]{2,}$'),
 pitch text not null check(length(trim(pitch)) between 10 and 2000),
 created_at timestamptz not null default now()
);

-- Append-only: the journal, the ledger, the first payments, the statements and the payouts refuse every UPDATE, DELETE and
-- TRUNCATE, for every role, the owner included.
create or replace function prospectos_private.deny_partner_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Partner ledger is append-only' using errcode='42501'; end $$;
do $$ declare tbl text; begin
 foreach tbl in array array['partner_journal','partner_commissions','partner_first_payments','partner_statements','partner_payouts'] loop
  execute format('drop trigger if exists %I on public.%I',tbl||'_immutable',tbl);
  execute format('create trigger %I before update or delete on public.%I for each row execute function prospectos_private.deny_partner_mutation()',tbl||'_immutable',tbl);
  execute format('drop trigger if exists %I on public.%I',tbl||'_no_truncate',tbl);
  execute format('create trigger %I before truncate on public.%I for each statement execute function prospectos_private.deny_partner_mutation()',tbl||'_no_truncate',tbl);
 end loop;
end $$;

create or replace function prospectos_private.partner_log(p_partner uuid,p_org uuid,p_kind text,p_detail jsonb)
returns void language sql security definer set search_path='' as $$
 insert into public.partner_journal(partner_id,organization_id,actor_id,kind,detail) values(p_partner,p_org,auth.uid(),p_kind,coalesce(p_detail,'{}'::jsonb))
$$;
revoke all on function prospectos_private.partner_log(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- referred_by / referred_at never change once set, except through set_organization_referral (administrator, journaled).
create or replace function prospectos_private.partner_referral_locked() returns trigger
language plpgsql set search_path='' as $$
begin
 if (old.referred_by is distinct from new.referred_by or old.referred_at is distinct from new.referred_at)
    and coalesce(current_setting('prospectos.partner_referral_change',true),'')<>'on' then
  raise exception 'organization_referral_locked' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists organizations_referral_locked on public.organizations;
create trigger organizations_referral_locked before update of referred_by,referred_at on public.organizations
 for each row execute function prospectos_private.partner_referral_locked();

-- Attribution at the creation of an account's FIRST organization, from the code its owner gave at sign-up.
create or replace function prospectos_private.partner_attribute() returns trigger
language plpgsql security definer set search_path='' as $$
declare meta jsonb; v_code text; p public.partners; owner_email text; reason text;
begin
 -- Read through to_jsonb: the metadata column of auth.users is never named, so this works whatever its shape.
 select to_jsonb(u) into meta from auth.users u where u.id=new.owner_id;
 v_code:=upper(trim(coalesce(meta->'raw_user_meta_data'->>'partner_code','')));
 if v_code='' then return null; end if;
 if v_code !~ '^[A-Z0-9]{3,20}$' then return null; end if;
 select * into p from public.partners where partners.code=v_code;
 if not found then return null; end if;                 -- unknown code: ignored, the sign-up goes on
 owner_email:=lower(trim(coalesce(meta->>'email','')));
 if p.status<>'ACTIVE' then reason:='partner_suspended';
 elsif owner_email=p.email or p.user_id=new.owner_id then reason:='self_referral';
 elsif exists(select 1 from public.organizations o where o.id<>new.id and o.owner_id=new.owner_id)
    or exists(select 1 from public.memberships m where m.user_id=new.owner_id and m.organization_id<>new.id) then reason:='existing_organization';
 end if;
 if reason is not null then
  perform prospectos_private.partner_log(p.id,new.id,'ATTRIBUTION_REFUSED',jsonb_build_object('reason',reason,'code',v_code));
  return null;
 end if;
 perform set_config('prospectos.partner_referral_change','on',true);
 update public.organizations set referred_by=p.id,referred_at=now() where id=new.id;
 perform set_config('prospectos.partner_referral_change','',true);
 perform prospectos_private.partner_log(p.id,new.id,'ATTRIBUTED',jsonb_build_object('code',v_code));
 return null;
end $$;
revoke all on function prospectos_private.partner_attribute() from public,anon,authenticated;
drop trigger if exists organizations_partner_attribution on public.organizations;
create trigger organizations_partner_attribution after insert on public.organizations
 for each row execute function prospectos_private.partner_attribute();

-- The partner the caller is: bound account, else the partner whose e-mail is the caller's CONFIRMED e-mail (then bound).
create or replace function prospectos_private.my_partner_id() returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; u jsonb;
begin
 if auth.uid() is null then return null; end if;
 select id into pid from public.partners where user_id=auth.uid();
 if found then return pid; end if;
 select to_jsonb(x) into u from auth.users x where x.id=auth.uid();
 if u is null or coalesce(u->>'email_confirmed_at',u->>'confirmed_at') is null then return null; end if;
 select id into pid from public.partners where email=lower(trim(u->>'email')) and user_id is null;
 if found then update public.partners set user_id=auth.uid() where id=pid; end if;
 return pid;
end $$;
revoke all on function prospectos_private.my_partner_id() from public,anon;
grant execute on function prospectos_private.my_partner_id() to authenticated;

-- A client as the partner sees it: an identifier that does not reveal the organization (stable per partner).
create or replace function prospectos_private.partner_client_ref(p_partner uuid,p_org uuid) returns text
language sql immutable set search_path='' as $$ select 'C-'||upper(substr(md5(p_partner::text||':'||p_org::text),1,6)) $$;

-- RLS: the administrator reads everything; a partner reads their own partner row, statements and payouts. The ledger, the
-- journal, the first payments and the applications: administrator only (the partner gets them anonymized via partner_space).
alter table public.partners enable row level security;
alter table public.partner_journal enable row level security;
alter table public.partner_first_payments enable row level security;
alter table public.partner_commissions enable row level security;
alter table public.partner_statements enable row level security;
alter table public.partner_payouts enable row level security;
alter table public.partner_applications enable row level security;
drop policy if exists partner_read on public.partners;
create policy partner_read on public.partners for select to authenticated using (prospectos_private.is_internal_admin() or user_id=auth.uid());
do $$ declare tbl text; begin
 foreach tbl in array array['partner_statements','partner_payouts'] loop
  execute format('drop policy if exists partner_read on public.%I',tbl);
  execute format('create policy partner_read on public.%I for select to authenticated using (prospectos_private.is_internal_admin() or exists(select 1 from public.partners p where p.id=partner_id and p.user_id=auth.uid()))',tbl);
 end loop;
 foreach tbl in array array['partner_journal','partner_first_payments','partner_commissions','partner_applications'] loop
  execute format('drop policy if exists partner_admin_read on public.%I',tbl);
  execute format('create policy partner_admin_read on public.%I for select to authenticated using (prospectos_private.is_internal_admin())',tbl);
 end loop;
end $$;
revoke all on public.partners,public.partner_journal,public.partner_first_payments,public.partner_commissions,public.partner_statements,
 public.partner_payouts,public.partner_applications from public,anon,authenticated;
grant select on public.partners,public.partner_journal,public.partner_first_payments,public.partner_commissions,public.partner_statements,
 public.partner_payouts,public.partner_applications to authenticated;

-- ── Administrator ───────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.create_partner(p_name text,p_company text,p_siret text,p_email text,p_code text,p_rate_percent numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.partners; c text:=upper(trim(coalesce(p_code,''))); e text:=lower(trim(coalesce(p_email,''))); s text:=regexp_replace(coalesce(p_siret,''),'\s','','g');
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if c !~ '^[A-Z0-9]{3,20}$' then raise exception 'partner_code_invalid' using errcode='22023'; end if;
 if not prospectos_private.siret_valid(s) then raise exception 'partner_siret_invalid' using errcode='22023'; end if;
 if exists(select 1 from public.partners where code=c) then raise exception 'partner_code_taken' using errcode='23505'; end if;
 if exists(select 1 from public.partners where email=e) then raise exception 'partner_email_taken' using errcode='23505'; end if;
 insert into public.partners(name,company,siret,email,code,rate_percent,created_by)
 values(trim(p_name),trim(p_company),s,e,c,coalesce(p_rate_percent,30),auth.uid()) returning * into r;
 perform prospectos_private.partner_log(r.id,null,'PARTNER_CREATED',jsonb_build_object('code',r.code,'rate_percent',r.rate_percent));
 return jsonb_build_object('id',r.id,'code',r.code);
end $$;
revoke all on function public.create_partner(text,text,text,text,text,numeric) from public,anon;
grant execute on function public.create_partner(text,text,text,text,text,numeric) to authenticated;

create or replace function public.set_partner_status(p_partner_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_status text;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_status not in ('ACTIVE','SUSPENDED') then raise exception 'partner_status_invalid' using errcode='22023'; end if;
 select status into old_status from public.partners where id=p_partner_id for update;
 if not found then raise exception 'partner_not_found' using errcode='P0002'; end if;
 if old_status=p_status then return jsonb_build_object('status',p_status,'changed',false); end if;
 update public.partners set status=p_status where id=p_partner_id;
 perform prospectos_private.partner_log(p_partner_id,null,'PARTNER_STATUS',jsonb_build_object('from',old_status,'to',p_status));
 return jsonb_build_object('status',p_status,'changed',true);
end $$;
revoke all on function public.set_partner_status(uuid,text) from public,anon;
grant execute on function public.set_partner_status(uuid,text) to authenticated;

-- The only way to change an organization's referral once set: the administrator, with a reason, journaled (from, to).
create or replace function public.set_organization_referral(p_organization_id uuid,p_partner_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.organizations;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'partner_reason_required' using errcode='22023'; end if;
 select * into o from public.organizations where id=p_organization_id for update;
 if not found then raise exception 'partner_organization_not_found' using errcode='P0002'; end if;
 if p_partner_id is not null and not exists(select 1 from public.partners where id=p_partner_id) then raise exception 'partner_not_found' using errcode='P0002'; end if;
 if o.referred_by is not distinct from p_partner_id then return jsonb_build_object('changed',false); end if;
 perform set_config('prospectos.partner_referral_change','on',true);
 update public.organizations set referred_by=p_partner_id,referred_at=case when p_partner_id is null then null else now() end where id=o.id;
 perform set_config('prospectos.partner_referral_change','',true);
 perform prospectos_private.partner_log(coalesce(p_partner_id,o.referred_by),o.id,'REFERRAL_CHANGED',
  jsonb_build_object('from',o.referred_by,'to',p_partner_id,'reason',left(trim(p_reason),300)));
 return jsonb_build_object('changed',true);
end $$;
revoke all on function public.set_organization_referral(uuid,uuid,text) from public,anon;
grant execute on function public.set_organization_referral(uuid,uuid,text) to authenticated;

-- « Payé » : only the partner's LATEST statement (a later one already carries this balance), payable, not yet paid.
create or replace function public.mark_partner_statement_paid(p_statement_id uuid,p_paid_on date,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.partner_statements; pay public.partner_payouts;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into s from public.partner_statements where id=p_statement_id for update;
 if not found then raise exception 'partner_statement_not_found' using errcode='P0002'; end if;
 if exists(select 1 from public.partner_payouts where statement_id=s.id) then raise exception 'partner_statement_already_paid' using errcode='P0001'; end if;
 if not s.payable then raise exception 'partner_statement_below_threshold' using errcode='P0001'; end if;
 if exists(select 1 from public.partner_statements x where x.partner_id=s.partner_id and x.month>s.month) then raise exception 'partner_statement_superseded' using errcode='P0001'; end if;
 if p_paid_on is null or p_paid_on>prospectos_private.paris_today() or p_paid_on<(s.month+interval '1 month')::date then raise exception 'partner_paid_on_invalid' using errcode='22023'; end if;
 if length(trim(coalesce(p_reference,''))) not between 3 and 80 then raise exception 'partner_reference_invalid' using errcode='22023'; end if;
 insert into public.partner_payouts(partner_id,statement_id,amount_cents,paid_on,transfer_reference,created_by)
 values(s.partner_id,s.id,s.balance_cents,p_paid_on,trim(p_reference),auth.uid()) returning * into pay;
 perform prospectos_private.partner_log(s.partner_id,null,'PAYOUT',jsonb_build_object('statement_id',s.id,'month',s.month,'amount_cents',pay.amount_cents,
  'paid_on',p_paid_on,'reference',pay.transfer_reference));
 return jsonb_build_object('id',pay.id,'amount_cents',pay.amount_cents);
end $$;
revoke all on function public.mark_partner_statement_paid(uuid,date,text) from public,anon;
grant execute on function public.mark_partner_statement_paid(uuid,date,text) to authenticated;

create or replace function public.partner_admin_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 return jsonb_build_object(
  'partners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'company',p.company,'siret',p.siret,'email',p.email,'code',p.code,
    'rate_percent',p.rate_percent,'status',p.status,'has_account',p.user_id is not null,'created_at',p.created_at,
    'signups',(select count(*) from public.organizations o where o.referred_by=p.id),
    'paying_clients',(select count(distinct c.organization_id) from public.partner_commissions c where c.partner_id=p.id and c.kind='COMMISSION' and c.amount_cents>0),
    'earned_cents',(select coalesce(sum(c.amount_cents),0) from public.partner_commissions c where c.partner_id=p.id),
    'paid_cents',(select coalesce(sum(x.amount_cents),0) from public.partner_payouts x where x.partner_id=p.id),
    'balance_cents',(select coalesce(sum(c.amount_cents),0) from public.partner_commissions c where c.partner_id=p.id)-(select coalesce(sum(x.amount_cents),0) from public.partner_payouts x where x.partner_id=p.id))
   order by p.created_at desc) from public.partners p),'[]'::jsonb),
  'to_pay',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'partner_id',s.partner_id,'partner',p.company,'code',p.code,'month',s.month,
    'balance_cents',s.balance_cents,'month_commissions_cents',s.month_commissions_cents) order by s.month,p.company)
   from public.partner_statements s join public.partners p on p.id=s.partner_id
   where s.payable and not exists(select 1 from public.partner_payouts x where x.statement_id=s.id)
    and not exists(select 1 from public.partner_statements l where l.partner_id=s.partner_id and l.month>s.month)),'[]'::jsonb),
  'statements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'partner_id',s.partner_id,'month',s.month,'referred_count',s.referred_count,
    'paying_clients',s.paying_clients,'payments_count',s.payments_count,'month_commissions_cents',s.month_commissions_cents,'balance_cents',s.balance_cents,
    'payable',s.payable,'paid',(select jsonb_build_object('paid_on',x.paid_on,'reference',x.transfer_reference,'amount_cents',x.amount_cents) from public.partner_payouts x where x.statement_id=s.id))
   order by s.month desc) from (select * from public.partner_statements order by month desc limit 200) s),'[]'::jsonb),
  'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'company',a.company,'siret',a.siret,'email',a.email,'pitch',a.pitch,'created_at',a.created_at,
    'is_partner',exists(select 1 from public.partners p where p.email=a.email)) order by a.created_at desc) from (select * from public.partner_applications order by created_at desc limit 100) a),'[]'::jsonb)
 );
end $$;
revoke all on function public.partner_admin_overview() from public,anon;
grant execute on function public.partner_admin_overview() to authenticated;

-- ── Partner ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The partner's own space: never a client's name, e-mail or organization — an anonymous reference and amounts only.
create or replace function public.partner_space() returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid; p public.partners; m date:=prospectos_private.paris_month_start(now());
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 pid:=prospectos_private.my_partner_id();
 if pid is null then raise exception 'partner_not_found' using errcode='P0002'; end if;
 select * into p from public.partners where id=pid;
 return jsonb_build_object(
  'partner',jsonb_build_object('name',p.name,'company',p.company,'code',p.code,'rate_percent',p.rate_percent,'status',p.status),
  'signups',(select count(*) from public.organizations o where o.referred_by=p.id),
  'paying_clients',(select count(distinct c.organization_id) from public.partner_commissions c where c.partner_id=p.id and c.kind='COMMISSION' and c.amount_cents>0),
  'month',m,
  'month_commissions_cents',(select coalesce(sum(c.amount_cents),0) from public.partner_commissions c where c.partner_id=p.id and prospectos_private.paris_month_start(c.occurred_at)=m),
  'balance_cents',(select coalesce(sum(c.amount_cents),0) from public.partner_commissions c where c.partner_id=p.id)-(select coalesce(sum(x.amount_cents),0) from public.partner_payouts x where x.partner_id=p.id),
  'threshold_cents',5000,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('client',prospectos_private.partner_client_ref(p.id,c.organization_id),'kind',c.kind,
    'amount_cents',c.amount_cents,'base_ht_cents',case when c.kind='COMMISSION' then c.paid_amount_ht_cents end,'occurred_at',c.occurred_at) order by c.occurred_at desc,c.id desc)
   from (select * from public.partner_commissions where partner_id=p.id order by occurred_at desc,id desc limit 200) c),'[]'::jsonb),
  'statements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'month',s.month,'referred_count',s.referred_count,'paying_clients',s.paying_clients,
    'payments_count',s.payments_count,'month_commissions_cents',s.month_commissions_cents,'balance_cents',s.balance_cents,'payable',s.payable,
    'paid',(select jsonb_build_object('paid_on',x.paid_on,'reference',x.transfer_reference,'amount_cents',x.amount_cents) from public.partner_payouts x where x.statement_id=s.id))
   order by s.month desc) from public.partner_statements s where s.partner_id=p.id),'[]'::jsonb)
 );
end $$;
revoke all on function public.partner_space() from public,anon;
grant execute on function public.partner_space() to authenticated;

-- ── Server only (service_role): Stripe webhook, monthly job, public form, checkout metadata ─────────────────────────────
-- The referring partner of a ProspectOS user (owner of a referred organization), for the Stripe metadata at checkout.
create or replace function public.partner_of_user(p_user_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select o.referred_by from public.organizations o where o.owner_id=p_user_id and o.referred_by is not null order by o.created_at limit 1
$$;
revoke all on function public.partner_of_user(uuid) from public,anon,authenticated;
grant execute on function public.partner_of_user(uuid) to service_role;

-- invoice.paid, as re-read from Stripe by the server: the customer → the ProspectOS user (migration 017) → the organization
-- they own that was referred. One line per invoice, ever. Outcomes: recorded, duplicate, not_referred, outside_window, …
create or replace function public.record_partner_invoice(p_event_id text,p_invoice_id text,p_customer_id text,p_paid_at timestamptz,
 p_amount_paid_cents bigint,p_amount_paid_ht_cents bigint,p_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; o public.organizations; p public.partners; first_at timestamptz; amount bigint;
begin
 if p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_invoice_id !~ '^in_[A-Za-z0-9]+$' or p_paid_at is null
    or p_amount_paid_cents<0 or p_amount_paid_ht_cents<0 or p_amount_paid_ht_cents>p_amount_paid_cents then raise exception 'partner_invoice_invalid' using errcode='22023'; end if;
 if exists(select 1 from public.partner_commissions where stripe_invoice_id=p_invoice_id and kind='COMMISSION') then return jsonb_build_object('outcome','duplicate'); end if;
 if lower(coalesce(p_currency,''))<>'eur' then return jsonb_build_object('outcome','other_currency'); end if;
 select user_id into uid from prospectos_private.billing_accounts where stripe_customer_id=p_customer_id;
 if uid is null then return jsonb_build_object('outcome','unknown_customer'); end if;
 select * into o from public.organizations where owner_id=uid and referred_by is not null order by created_at limit 1;
 if not found then return jsonb_build_object('outcome','not_referred'); end if;
 select * into p from public.partners where id=o.referred_by;
 if p_amount_paid_cents=0 then return jsonb_build_object('outcome','nothing_paid'); end if;
 insert into public.partner_first_payments(organization_id,first_paid_at,stripe_invoice_id) values(o.id,p_paid_at,p_invoice_id) on conflict (organization_id) do nothing;
 select first_paid_at into first_at from public.partner_first_payments where organization_id=o.id;
 if p_paid_at>=first_at+interval '12 months' then return jsonb_build_object('outcome','outside_window'); end if;
 if p_paid_at<o.referred_at then return jsonb_build_object('outcome','before_referral'); end if;
 amount:=round(p_amount_paid_ht_cents*p.rate_percent/100);
 insert into public.partner_commissions(partner_id,organization_id,kind,stripe_invoice_id,stripe_event_id,paid_amount_cents,paid_amount_ht_cents,rate_percent,amount_cents,occurred_at)
 values(p.id,o.id,'COMMISSION',p_invoice_id,p_event_id,p_amount_paid_cents,p_amount_paid_ht_cents,p.rate_percent,amount,p_paid_at)
 on conflict do nothing;
 if not found then return jsonb_build_object('outcome','duplicate'); end if;
 return jsonb_build_object('outcome','recorded','amount_cents',amount,'partner_id',p.id);
end $$;
revoke all on function public.record_partner_invoice(text,text,text,timestamptz,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.record_partner_invoice(text,text,text,timestamptz,bigint,bigint,text) to service_role;

-- charge.refunded: p_refunded_total_cents is the charge's CUMULATIVE refunded amount (Stripe's amount_refunded). The
-- negative lines of that invoice reach −commission × refunded / paid; each event adds only what is missing, so a replay or
-- an older event adds nothing. No commission line for the invoice (not referred, outside the window) → nothing.
create or replace function public.record_partner_refund(p_event_id text,p_charge_id text,p_invoice_id text,p_refunded_total_cents bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.partner_commissions; target bigint; already bigint; delta bigint;
begin
 if p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$' or p_invoice_id !~ '^in_[A-Za-z0-9]+$' or p_refunded_total_cents is null or p_refunded_total_cents<0 then
  raise exception 'partner_refund_invalid' using errcode='22023'; end if;
 if exists(select 1 from public.partner_commissions where stripe_event_id=p_event_id) then return jsonb_build_object('outcome','duplicate'); end if;
 select * into c from public.partner_commissions where stripe_invoice_id=p_invoice_id and kind='COMMISSION' for update;
 if not found or c.amount_cents=0 or c.paid_amount_cents=0 then return jsonb_build_object('outcome','no_commission'); end if;
 target:=-round(c.amount_cents::numeric*least(p_refunded_total_cents,c.paid_amount_cents)/c.paid_amount_cents);
 select coalesce(sum(amount_cents),0) into already from public.partner_commissions where stripe_invoice_id=p_invoice_id and kind='REFUND';
 delta:=target-already;
 if delta>=0 then return jsonb_build_object('outcome','duplicate'); end if;
 insert into public.partner_commissions(partner_id,organization_id,kind,stripe_invoice_id,stripe_charge_id,stripe_event_id,paid_amount_cents,paid_amount_ht_cents,rate_percent,amount_cents,occurred_at)
 values(c.partner_id,c.organization_id,'REFUND',p_invoice_id,p_charge_id,p_event_id,least(p_refunded_total_cents,c.paid_amount_cents),0,c.rate_percent,delta,now())
 on conflict do nothing;
 if not found then return jsonb_build_object('outcome','duplicate'); end if;
 return jsonb_build_object('outcome','recorded','amount_cents',delta);
end $$;
revoke all on function public.record_partner_refund(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.record_partner_refund(text,text,text,bigint) to service_role;

-- The statement of the month that starts at p_month, for every partner with a client or a line; idempotent (one per month).
create or replace function public.generate_partner_statements(p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',p_month)::date; e timestamptz; n int:=0; p record; s public.partner_statements; bal bigint;
begin
 if p_month is null or m>=prospectos_private.paris_month_start(now()) then raise exception 'partner_month_invalid' using errcode='22023'; end if;
 e:=((m+interval '1 month')::timestamp at time zone 'Europe/Paris');
 for p in select x.id from public.partners x where exists(select 1 from public.organizations o where o.referred_by=x.id and o.referred_at<e)
   or exists(select 1 from public.partner_commissions c where c.partner_id=x.id and c.occurred_at<e) loop
  if exists(select 1 from public.partner_statements where partner_id=p.id and month=m) then continue; end if;
  bal:=(select coalesce(sum(amount_cents),0) from public.partner_commissions where partner_id=p.id and occurred_at<e)
      -(select coalesce(sum(amount_cents),0) from public.partner_payouts where partner_id=p.id);
  insert into public.partner_statements(partner_id,month,referred_count,paying_clients,payments_count,month_commissions_cents,balance_cents,threshold_cents,payable)
  select p.id,m,
   (select count(*) from public.organizations o where o.referred_by=p.id and o.referred_at<e),
   (select count(distinct organization_id) from public.partner_commissions where partner_id=p.id and kind='COMMISSION' and amount_cents>0 and prospectos_private.paris_month_start(occurred_at)=m),
   (select count(*) from public.partner_commissions where partner_id=p.id and kind='COMMISSION' and prospectos_private.paris_month_start(occurred_at)=m),
   (select coalesce(sum(amount_cents),0) from public.partner_commissions where partner_id=p.id and prospectos_private.paris_month_start(occurred_at)=m),
   bal,5000,bal>=5000
  on conflict (partner_id,month) do nothing returning * into s;
  if s.id is not null then
   n:=n+1;
   perform prospectos_private.partner_log(p.id,null,'STATEMENT_GENERATED',jsonb_build_object('statement_id',s.id,'month',m,'balance_cents',s.balance_cents,'payable',s.payable));
  end if;
 end loop;
 return jsonb_build_object('month',m,'generated',n);
end $$;
revoke all on function public.generate_partner_statements(date) from public,anon,authenticated;
grant execute on function public.generate_partner_statements(date) to service_role;

create or replace function public.submit_partner_application(p_name text,p_company text,p_siret text,p_email text,p_pitch text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.partner_applications; s text:=regexp_replace(coalesce(p_siret,''),'\s','','g');
begin
 if not prospectos_private.siret_valid(s) then raise exception 'partner_siret_invalid' using errcode='22023'; end if;
 insert into public.partner_applications(name,company,siret,email,pitch) values(trim(p_name),trim(p_company),s,lower(trim(p_email)),trim(p_pitch)) returning * into a;
 perform prospectos_private.partner_log(null,null,'APPLICATION_RECEIVED',jsonb_build_object('application_id',a.id));
 return jsonb_build_object('id',a.id);
end $$;
revoke all on function public.submit_partner_application(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_partner_application(text,text,text,text,text) to service_role;

commit;
