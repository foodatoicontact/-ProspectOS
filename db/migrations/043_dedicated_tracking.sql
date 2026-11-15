-- 043 — Veille dédiée, suivi au résultat (src/dedicated, docs/DEDICATED_TRACKING.md). A client of the "veille dédiée"
-- offer receives numbered lists of companies (deliveries) and is paid for by result: each month the higher of a
-- guaranteed minimum and a commission per signed client. The signatures are followed INSIDE ProspectOS, not in an
-- external sheet, so that the history is reliable for both parties.
--
-- 1. public.dedicated_contracts — one per client organization: the guaranteed minimum and the commission (HT, in cents),
--    the window to declare an already-known client (15 days), and the first month a statement is drawn for.
-- 2. public.dedicated_deliveries — numbered deliveries (1, 2, 3… per contract), with their date and scope.
--    public.dedicated_items — the companies delivered: SIREN, official source and its link, delivery date, a reference
--    (L<delivery>-F<position>) and the follow-up status: A_CONTACTER, CONTACTE, DEVIS_ENVOYE, SIGNE, PERDU, DEJA_CLIENT.
--    A SIREN is delivered once per contract (the first delivery is the one that counts for attribution).
-- 3. public.dedicated_journal — APPEND-ONLY: item opened, export, every status change, delivery, statement generated,
--    validated, reminder. A trigger refuses every UPDATE, DELETE and TRUNCATE, for every role, the owner included;
--    no browser role may insert either: only the functions below write it, with the caller as actor.
-- 4. public.dedicated_statements — one per contract and month: the signatures counted, the minimum and commission of the
--    contract at that time, the amount = greatest(minimum, commission × signatures), and the client's validation.
--
-- Who sees what (RLS): a member of the client organization sees its own contract, deliveries, items, statements and
-- journal — never another organization's. The administrator (an ACTIVE INTERNAL entitlement, the existing admin model of
-- migration 013) sees every contract. Nobody writes the tables directly: the functions below decide.
--   admin (authenticated, INTERNAL): dedicated_find_organizations, propose_dedicated_watch (an EXISTING organization, by
--     identifier, with the proposal PDF), replace_dedicated_proposal, create_dedicated_delivery, terminate_dedicated_contract,
--     dedicated_admin_overview
--   client (authenticated, member): accept_dedicated_proposal (the SHA-256 of the latest version), open_dedicated_item,
--     set_dedicated_item_status, export_dedicated_items, validate_dedicated_statement
-- Lifecycle: PROPOSED (space closed, the proposal only) → ACTIVE (accepted: journal with user, time, version and SHA-256 of
-- the PDF; the trial starts on its planned date) → TERMINATED (no new delivery; reading and status updates for 6 months,
-- for the commissions still due; statements after the termination month carry no minimum). No subscription, entitlement
-- or payment is read or written: the veille stays open whatever the ProspectOS subscription.
--   server only (service_role, cron): generate_dedicated_statements, claim_dedicated_reminders, release_dedicated_reminder
-- Rules held by the database, whatever the caller sends:
--   - DEJA_CLIENT is accepted only up to delivered_on + known_client_days (Paris date), with a dated proof whose date is
--     not after the delivery; after that the option is refused ('known_window_closed').
--   - SIGNE requires the date of the first invoice, between the delivery date and today.
--   - An item counted in a statement no longer changes status ('item_in_statement'): the statement stays true.
--   - A statement is validated once, by a member of the client organization, with the exact attestation sentence.
-- Dates are Paris dates (Europe/Paris). The product feature is behind DEDICATED_TRACKING_ENABLED (off by default).
-- Nothing else is touched: no existing table, policy, function, quota, entitlement, evidence or billing object changes.
--
-- Rollback (only while no client uses it — the journal is the evidence of both parties):
--   drop function public.dedicated_find_organizations(text), public.propose_dedicated_watch(uuid,text,int,int,int,date,date,text,text),
--    public.replace_dedicated_proposal(uuid,text,text), public.terminate_dedicated_contract(uuid), public.accept_dedicated_proposal(uuid,text),
--    prospectos_private.dedicated_store_proposal(public.dedicated_contracts,text,text), prospectos_private.dedicated_visible(uuid),
--    prospectos_private.dedicated_require_open(uuid), public.create_dedicated_delivery(uuid,text,jsonb),
--    public.dedicated_admin_overview(), public.open_dedicated_item(uuid), public.set_dedicated_item_status(uuid,text,date,jsonb),
--    public.export_dedicated_items(uuid,uuid,text), public.validate_dedicated_statement(uuid,text),
--    public.generate_dedicated_statements(date), public.claim_dedicated_reminders(), public.release_dedicated_reminder(uuid),
--    prospectos_private.is_internal_admin(), prospectos_private.paris_today(), prospectos_private.dedicated_log(uuid,uuid,uuid,uuid,uuid,text,jsonb),
--    prospectos_private.deny_dedicated_journal_mutation();
--   drop table public.dedicated_journal, public.dedicated_statements, public.dedicated_items, public.dedicated_deliveries,
--    public.dedicated_proposals, public.dedicated_contracts;
begin;

create or replace function prospectos_private.paris_today() returns date
language sql stable set search_path='' as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- The existing admin model (migration 013): an ACTIVE INTERNAL entitlement of the caller themselves.
create or replace function prospectos_private.is_internal_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.account_entitlements e
  where e.user_id=auth.uid() and e.plan='INTERNAL' and e.status='ACTIVE')
$$;
revoke all on function prospectos_private.is_internal_admin() from public,anon;
grant execute on function prospectos_private.is_internal_admin() to authenticated,service_role;

create table if not exists public.dedicated_contracts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 label text not null check(length(trim(label)) between 1 and 160),
 minimum_ht_cents int not null check(minimum_ht_cents between 0 and 10000000),
 commission_ht_cents int not null check(commission_ht_cents between 1 and 10000000),
 known_client_days int not null default 15 check(known_client_days between 1 and 60),
 first_statement_month date not null check(extract(day from first_statement_month)=1),
 -- PROPOSED (the client has not accepted: the space stays closed) → ACTIVE (accepted) → TERMINATED (by the administrator:
 -- no new delivery; reading and status updates stay open for 6 months, for the commissions still due).
 status text not null default 'PROPOSED' check(status in ('PROPOSED','ACTIVE','TERMINATED')),
 trial_starts_on date not null,
 accepted_at timestamptz,
 accepted_by uuid,
 accepted_sha256 text check(accepted_sha256 is null or accepted_sha256 ~ '^[0-9a-f]{64}$'),
 terminated_at timestamptz,
 created_by uuid not null,
 created_at timestamptz not null default now(),
 unique(id,organization_id),
 unique(organization_id,label),
 check((status='PROPOSED')=(accepted_at is null)),
 check((accepted_at is null)=(accepted_by is null) and (accepted_at is null)=(accepted_sha256 is null)),
 check((status='TERMINATED')=(terminated_at is not null))
);

-- The commercial proposal attached by the administrator (the PDF made by `npm run devis`), versioned: the client accepts
-- the latest version, identified by its SHA-256 computed here from the stored bytes.
create table if not exists public.dedicated_proposals (
 contract_id uuid not null,
 organization_id uuid not null,
 version int not null check(version>=1),
 file_name text not null check(file_name ~ '^[A-Za-z0-9._ -]{1,120}\.pdf$'),
 pdf bytea not null check(octet_length(pdf) between 100 and 5242880 and substring(pdf from 1 for 5)='\x255044462d'::bytea),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 primary key(contract_id,version),
 foreign key(contract_id,organization_id) references public.dedicated_contracts(id,organization_id)
);

create table if not exists public.dedicated_deliveries (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null,
 organization_id uuid not null,
 number int not null check(number>=1),
 delivered_on date not null,
 scope text not null check(length(trim(scope)) between 1 and 500),
 created_by uuid not null,
 created_at timestamptz not null default now(),
 unique(contract_id,number),
 unique(id,contract_id,organization_id),
 foreign key(contract_id,organization_id) references public.dedicated_contracts(id,organization_id)
);
create index if not exists dedicated_deliveries_org_idx on public.dedicated_deliveries(organization_id,delivered_on desc);

create table if not exists public.dedicated_items (
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null,
 contract_id uuid not null,
 organization_id uuid not null,
 position int not null check(position>=1),
 reference text not null check(reference ~ '^L[0-9]+-F[0-9]{3,}$'),
 siren text not null check(siren ~ '^[0-9]{9}$'),
 name text not null check(length(trim(name)) between 1 and 200),
 city text check(city is null or length(city)<=120),
 source_label text not null check(length(trim(source_label)) between 1 and 160),
 source_url text not null check(source_url ~ '^https://[^\s]+$' and length(source_url)<=1000),
 delivered_on date not null,
 status text not null default 'A_CONTACTER' check(status in ('A_CONTACTER','CONTACTE','DEVIS_ENVOYE','SIGNE','PERDU','DEJA_CLIENT')),
 status_changed_at timestamptz,
 signed_at timestamptz,
 first_invoice_on date,
 known_proof jsonb,
 statement_id uuid,
 created_at timestamptz not null default now(),
 unique(delivery_id,position),
 unique(contract_id,siren),
 check((status='SIGNE')=(signed_at is not null and first_invoice_on is not null)),
 check((status='DEJA_CLIENT')=(known_proof is not null)),
 foreign key(delivery_id,contract_id,organization_id) references public.dedicated_deliveries(id,contract_id,organization_id)
);
create index if not exists dedicated_items_org_idx on public.dedicated_items(organization_id,delivery_id,position);

create table if not exists public.dedicated_statements (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null,
 organization_id uuid not null,
 month date not null check(extract(day from month)=1),
 signed_count int not null check(signed_count>=0),
 minimum_ht_cents int not null check(minimum_ht_cents>=0),
 commission_ht_cents int not null check(commission_ht_cents>0),
 amount_ht_cents int not null check(amount_ht_cents=greatest(minimum_ht_cents,commission_ht_cents*signed_count)),
 items jsonb not null default '[]'::jsonb,
 generated_at timestamptz not null default now(),
 validated_at timestamptz,
 validated_by uuid,
 reminder_sent_at timestamptz,
 unique(contract_id,month),
 check((validated_at is null)=(validated_by is null)),
 foreign key(contract_id,organization_id) references public.dedicated_contracts(id,organization_id)
);
alter table public.dedicated_items drop constraint if exists dedicated_items_statement_fk;
alter table public.dedicated_items add constraint dedicated_items_statement_fk foreign key(statement_id) references public.dedicated_statements(id);

create table if not exists public.dedicated_journal (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 contract_id uuid not null references public.dedicated_contracts(id),
 delivery_id uuid references public.dedicated_deliveries(id),
 item_id uuid references public.dedicated_items(id),
 statement_id uuid references public.dedicated_statements(id),
 actor_id uuid,
 kind text not null check(kind in ('PROPOSAL_SENT','PROPOSAL_ACCEPTED','CONTRACT_TERMINATED','DELIVERY_CREATED','ITEM_OPENED','EXPORT',
  'STATUS_CHANGED','STATEMENT_GENERATED','STATEMENT_VALIDATED','STATEMENT_REMINDER')),
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists dedicated_journal_org_idx on public.dedicated_journal(organization_id,created_at desc);
create index if not exists dedicated_journal_item_idx on public.dedicated_journal(item_id,created_at desc);

create or replace function prospectos_private.deny_dedicated_journal_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Dedicated journal is append-only' using errcode='42501'; end $$;
drop trigger if exists dedicated_journal_immutable on public.dedicated_journal;
create trigger dedicated_journal_immutable before update or delete on public.dedicated_journal
 for each row execute function prospectos_private.deny_dedicated_journal_mutation();
drop trigger if exists dedicated_journal_no_truncate on public.dedicated_journal;
create trigger dedicated_journal_no_truncate before truncate on public.dedicated_journal
 for each statement execute function prospectos_private.deny_dedicated_journal_mutation();

create or replace function prospectos_private.dedicated_log(p_org uuid,p_contract uuid,p_delivery uuid,p_item uuid,p_statement uuid,p_kind text,p_detail jsonb)
returns void language sql security definer set search_path='' as $$
 insert into public.dedicated_journal(organization_id,contract_id,delivery_id,item_id,statement_id,actor_id,kind,detail)
 values(p_org,p_contract,p_delivery,p_item,p_statement,auth.uid(),p_kind,coalesce(p_detail,'{}'::jsonb))
$$;
revoke all on function prospectos_private.dedicated_log(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;

-- What a member of the client organization may still see of a contract: everything until it is terminated, then 6 months.
create or replace function prospectos_private.dedicated_visible(p_contract uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.dedicated_contracts c where c.id=p_contract and prospectos_private.is_member(c.organization_id)
  and (c.status<>'TERMINATED' or c.terminated_at>now()-interval '6 months'))
$$;
revoke all on function prospectos_private.dedicated_visible(uuid) from public,anon;
grant execute on function prospectos_private.dedicated_visible(uuid) to authenticated;
-- What a member may DO (open, update a status, export, validate): an accepted contract, or a terminated one for 6 months.
create or replace function prospectos_private.dedicated_require_open(p_contract uuid) returns public.dedicated_contracts
language plpgsql stable security definer set search_path='' as $$
declare c public.dedicated_contracts;
begin
 select * into c from public.dedicated_contracts where id=p_contract;
 if not found or not prospectos_private.is_member(c.organization_id) then raise exception 'dedicated_contract_not_found' using errcode='P0002'; end if;
 if c.status='PROPOSED' then raise exception 'dedicated_space_closed' using errcode='P0001'; end if;
 if c.status='TERMINATED' and c.terminated_at<=now()-interval '6 months' then raise exception 'dedicated_space_closed' using errcode='P0001'; end if;
 return c;
end $$;
revoke all on function prospectos_private.dedicated_require_open(uuid) from public,anon,authenticated;

-- Read access: members of the client organization (within the rules above), or the administrator. No direct write.
alter table public.dedicated_proposals enable row level security;
alter table public.dedicated_contracts enable row level security;
alter table public.dedicated_deliveries enable row level security;
alter table public.dedicated_items enable row level security;
alter table public.dedicated_statements enable row level security;
alter table public.dedicated_journal enable row level security;
drop policy if exists dedicated_read on public.dedicated_contracts;
create policy dedicated_read on public.dedicated_contracts for select to authenticated using (prospectos_private.dedicated_visible(id) or prospectos_private.is_internal_admin());
do $$ declare tbl text; begin
 foreach tbl in array array['dedicated_proposals','dedicated_deliveries','dedicated_items','dedicated_statements','dedicated_journal'] loop
  execute format('drop policy if exists dedicated_read on public.%I',tbl);
  execute format('create policy dedicated_read on public.%I for select to authenticated using (prospectos_private.dedicated_visible(contract_id) or prospectos_private.is_internal_admin())',tbl);
 end loop;
end $$;
revoke all on public.dedicated_contracts,public.dedicated_proposals,public.dedicated_deliveries,public.dedicated_items,public.dedicated_statements,public.dedicated_journal from public,anon,authenticated;
grant select on public.dedicated_contracts,public.dedicated_proposals,public.dedicated_deliveries,public.dedicated_items,public.dedicated_statements,public.dedicated_journal to authenticated;

-- ---------------------------------------------------------------- administrator
-- Organizations the administrator can attach a veille to (an EXISTING account: never a new one), found by organization
-- name or by a member's sign-in address; the contract is then attached by the organization's identifier.
create or replace function public.dedicated_find_organizations(p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text:=lower(trim(coalesce(p_query,'')));
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if length(q)<3 then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(x order by x->>'name') from (
  select jsonb_build_object('id',o.id,'name',o.name,'created_at',o.created_at,
   'members',(select jsonb_agg(jsonb_build_object('email',u.email,'role',m.role) order by m.role desc,u.email) from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=o.id)) x
  from public.organizations o
  where position(q in lower(o.name))>0 or exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=o.id and position(q in lower(coalesce(u.email,'')))>0)
  order by o.created_at limit 20) t),'[]'::jsonb);
end $$;
revoke all on function public.dedicated_find_organizations(text) from public,anon;
grant execute on function public.dedicated_find_organizations(text) to authenticated;

create or replace function prospectos_private.dedicated_store_proposal(p_contract public.dedicated_contracts,p_file_name text,p_pdf_base64 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare bytes bytea; v int; h text;
begin
 begin bytes:=decode(regexp_replace(coalesce(p_pdf_base64,''),'\s','','g'),'base64'); exception when others then raise exception 'dedicated_proposal_invalid' using errcode='22023'; end;
 if bytes is null or octet_length(bytes)<100 or octet_length(bytes)>5242880 or substring(bytes from 1 for 5)<>'\x255044462d'::bytea then
  raise exception 'dedicated_proposal_invalid' using errcode='22023'; end if;
 h:=encode(sha256(bytes),'hex');
 select coalesce(max(version),0)+1 into v from public.dedicated_proposals where contract_id=p_contract.id;
 insert into public.dedicated_proposals(contract_id,organization_id,version,file_name,pdf,sha256,created_by)
 values(p_contract.id,p_contract.organization_id,v,trim(p_file_name),bytes,h,auth.uid());
 perform prospectos_private.dedicated_log(p_contract.organization_id,p_contract.id,null,null,null,'PROPOSAL_SENT',
  jsonb_build_object('version',v,'sha256',h,'file_name',trim(p_file_name),'bytes',octet_length(bytes)));
 return jsonb_build_object('version',v,'sha256',h);
end $$;
revoke all on function prospectos_private.dedicated_store_proposal(public.dedicated_contracts,text,text) from public,anon,authenticated;

-- « Proposer une veille »: a contract PROPOSED to an existing organization (by identifier), with its proposal PDF.
create or replace function public.propose_dedicated_watch(p_organization_id uuid,p_label text,p_minimum_ht_cents int,p_commission_ht_cents int,
 p_known_client_days int,p_trial_starts_on date,p_first_statement_month date,p_file_name text,p_pdf_base64 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row public.dedicated_contracts; prop jsonb;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'dedicated_organization_not_found' using errcode='P0002'; end if;
 if p_trial_starts_on is null or p_first_statement_month is null then raise exception 'Invalid proposal dates' using errcode='22023'; end if;
 insert into public.dedicated_contracts(organization_id,label,minimum_ht_cents,commission_ht_cents,known_client_days,first_statement_month,trial_starts_on,created_by)
 values(p_organization_id,trim(p_label),p_minimum_ht_cents,p_commission_ht_cents,coalesce(p_known_client_days,15),p_first_statement_month,p_trial_starts_on,auth.uid())
 returning * into row;
 prop:=prospectos_private.dedicated_store_proposal(row,p_file_name,p_pdf_base64);
 return to_jsonb(row)||jsonb_build_object('proposal',prop);
end $$;
revoke all on function public.propose_dedicated_watch(uuid,text,int,int,int,date,date,text,text) from public,anon;
grant execute on function public.propose_dedicated_watch(uuid,text,int,int,int,date,date,text,text) to authenticated;

-- A new version of the proposal while it is not accepted yet (the client then accepts that version).
create or replace function public.replace_dedicated_proposal(p_contract_id uuid,p_file_name text,p_pdf_base64 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into c from public.dedicated_contracts where id=p_contract_id for update;
 if not found then raise exception 'dedicated_contract_not_found' using errcode='P0002'; end if;
 if c.status<>'PROPOSED' then raise exception 'dedicated_proposal_already_accepted' using errcode='P0001'; end if;
 return prospectos_private.dedicated_store_proposal(c,p_file_name,p_pdf_base64);
end $$;
revoke all on function public.replace_dedicated_proposal(uuid,text,text) from public,anon;
grant execute on function public.replace_dedicated_proposal(uuid,text,text) to authenticated;

-- Termination by the administrator: no new delivery; the client keeps reading and updating statuses for 6 months.
create or replace function public.terminate_dedicated_contract(p_contract_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into c from public.dedicated_contracts where id=p_contract_id for update;
 if not found then raise exception 'dedicated_contract_not_found' using errcode='P0002'; end if;
 if c.status<>'ACTIVE' then raise exception 'dedicated_contract_not_active' using errcode='P0001'; end if;
 update public.dedicated_contracts set status='TERMINATED',terminated_at=now() where id=c.id returning * into c;
 perform prospectos_private.dedicated_log(c.organization_id,c.id,null,null,null,'CONTRACT_TERMINATED',
  jsonb_build_object('access_until',(c.terminated_at+interval '6 months')));
 return jsonb_build_object('id',c.id,'status',c.status,'terminated_at',c.terminated_at,'access_until',c.terminated_at+interval '6 months');
end $$;
revoke all on function public.terminate_dedicated_contract(uuid) from public,anon;
grant execute on function public.terminate_dedicated_contract(uuid) to authenticated;

-- p_items: [{siren,name,city?,source_label,source_url}, …] — 1 to 1000. A SIREN already delivered under this contract is
-- skipped (and reported), never delivered twice. The delivery date is the Paris date of the call: never chosen.
create or replace function public.create_dedicated_delivery(p_contract_id uuid,p_scope text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts; d public.dedicated_deliveries; next_number int; it jsonb; pos int:=0; added int:=0; skipped text[]:='{}';
 today date:=prospectos_private.paris_today(); s text;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into c from public.dedicated_contracts where id=p_contract_id for update;
 if not found then raise exception 'dedicated_contract_not_found' using errcode='P0002'; end if;
 if c.status<>'ACTIVE' then raise exception 'dedicated_contract_not_active' using errcode='P0001'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 1000 then
  raise exception 'Invalid delivery items' using errcode='22023'; end if;
 select coalesce(max(number),0)+1 into next_number from public.dedicated_deliveries where contract_id=c.id;
 insert into public.dedicated_deliveries(contract_id,organization_id,number,delivered_on,scope,created_by)
 values(c.id,c.organization_id,next_number,today,trim(coalesce(p_scope,'')),auth.uid()) returning * into d;
 for it in select value from jsonb_array_elements(p_items) loop
  s:=regexp_replace(coalesce(it->>'siren',''),'\s','','g');
  if exists(select 1 from public.dedicated_items where contract_id=c.id and siren=s) then skipped:=skipped||s; continue; end if;
  pos:=pos+1;
  insert into public.dedicated_items(delivery_id,contract_id,organization_id,position,reference,siren,name,city,source_label,source_url,delivered_on)
  values(d.id,c.id,c.organization_id,pos,'L'||d.number||'-F'||lpad(pos::text,3,'0'),s,trim(coalesce(it->>'name','')),
   nullif(trim(coalesce(it->>'city','')),''),trim(coalesce(it->>'source_label','')),trim(coalesce(it->>'source_url','')),today);
  added:=added+1;
 end loop;
 if added=0 then raise exception 'dedicated_delivery_empty' using errcode='P0001'; end if;
 perform prospectos_private.dedicated_log(c.organization_id,c.id,d.id,null,null,'DELIVERY_CREATED',
  jsonb_build_object('number',d.number,'items',added,'skipped_sirens',to_jsonb(skipped)));
 return jsonb_build_object('id',d.id,'number',d.number,'delivered_on',d.delivered_on,'items',added,'skipped_sirens',to_jsonb(skipped));
end $$;
revoke all on function public.create_dedicated_delivery(uuid,text,jsonb) from public,anon;
grant execute on function public.create_dedicated_delivery(uuid,text,jsonb) to authenticated;

-- Facts for the administrator's dashboard, per contract; counters and alerts are derived in src/dedicated/model.ts.
create or replace function public.dedicated_admin_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'contract',jsonb_build_object('id',c.id,'label',c.label,'organization',o.name,'organization_id',o.id,'minimum_ht_cents',c.minimum_ht_cents,
   'commission_ht_cents',c.commission_ht_cents,'known_client_days',c.known_client_days,'first_statement_month',c.first_statement_month,
   'status',c.status,'trial_starts_on',c.trial_starts_on,'accepted_at',c.accepted_at,'terminated_at',c.terminated_at,
   'proposal',(select jsonb_build_object('version',p.version,'sha256',p.sha256,'file_name',p.file_name) from public.dedicated_proposals p where p.contract_id=c.id order by p.version desc limit 1)),
  'deliveries',(select count(*) from public.dedicated_deliveries d where d.contract_id=c.id),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'reference',i.reference,'name',i.name,'status',i.status,
     'delivered_on',i.delivered_on,'status_changed_at',i.status_changed_at,'signed_at',i.signed_at,
     'opened',exists(select 1 from public.dedicated_journal j where j.item_id=i.id and j.kind='ITEM_OPENED'),
     'first_export_at',(select min(j.created_at) from public.dedicated_journal j where j.contract_id=c.id and j.kind='EXPORT' and j.detail->'item_ids' ? i.id::text),
     'reached',coalesce((select jsonb_object_agg(x.status,x.at) from (select j.detail->>'to' status,max(j.created_at) at from public.dedicated_journal j
        where j.item_id=i.id and j.kind='STATUS_CHANGED' group by 1) x),'{}'::jsonb))
    order by i.delivered_on desc,i.reference) from public.dedicated_items i where i.contract_id=c.id),'[]'::jsonb),
  'statements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'month',s.month,'signed_count',s.signed_count,'amount_ht_cents',s.amount_ht_cents,
     'validated_at',s.validated_at,'reminder_sent_at',s.reminder_sent_at) order by s.month desc) from public.dedicated_statements s where s.contract_id=c.id),'[]'::jsonb)
 ) order by c.created_at) from public.dedicated_contracts c join public.organizations o on o.id=c.organization_id),'[]'::jsonb);
end $$;
revoke all on function public.dedicated_admin_overview() from public,anon;
grant execute on function public.dedicated_admin_overview() to authenticated;

-- ---------------------------------------------------------------- client (member of the client organization)
create or replace function public.open_dedicated_item(p_item_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare i public.dedicated_items;
begin
 select * into i from public.dedicated_items where id=p_item_id;
 if not found or not prospectos_private.is_member(i.organization_id) then raise exception 'dedicated_item_not_found' using errcode='P0002'; end if;
 perform prospectos_private.dedicated_require_open(i.contract_id);
 perform prospectos_private.dedicated_log(i.organization_id,i.contract_id,i.delivery_id,i.id,null,'ITEM_OPENED','{}'::jsonb);
 return true;
end $$;
revoke all on function public.open_dedicated_item(uuid) from public,anon;
grant execute on function public.open_dedicated_item(uuid) to authenticated;

-- p_proof (DEJA_CLIENT only): {kind: devis|facture|commande|contrat|echange, dated_on: 'YYYY-MM-DD', reference: text}.
create or replace function public.set_dedicated_item_status(p_item_id uuid,p_status text,p_first_invoice_on date default null,p_proof jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.dedicated_items; c public.dedicated_contracts; today date:=prospectos_private.paris_today(); proof jsonb:=null; proof_date date;
begin
 select * into i from public.dedicated_items where id=p_item_id for update;
 if not found or not prospectos_private.is_member(i.organization_id) then raise exception 'dedicated_item_not_found' using errcode='P0002'; end if;
 if p_status is null or p_status not in ('A_CONTACTER','CONTACTE','DEVIS_ENVOYE','SIGNE','PERDU','DEJA_CLIENT') then
  raise exception 'dedicated_status_invalid' using errcode='22023'; end if;
 c:=prospectos_private.dedicated_require_open(i.contract_id);
 if i.statement_id is not null then raise exception 'item_in_statement' using errcode='P0001'; end if;
 if p_status=i.status then return jsonb_build_object('id',i.id,'status',i.status,'changed',false); end if;
 if p_status='DEJA_CLIENT' then
  if today>i.delivered_on+c.known_client_days then raise exception 'known_window_closed' using errcode='P0001'; end if;
  begin proof_date:=(p_proof->>'dated_on')::date; exception when others then proof_date:=null; end;
  if p_proof is null or coalesce(p_proof->>'kind','') not in ('devis','facture','commande','contrat','echange') or proof_date is null
     or proof_date>i.delivered_on or length(trim(coalesce(p_proof->>'reference',''))) not between 3 and 200 then
   raise exception 'known_proof_required' using errcode='22023'; end if;
  proof:=jsonb_build_object('kind',p_proof->>'kind','dated_on',proof_date,'reference',trim(p_proof->>'reference'),'declared_at',now());
 end if;
 if p_status='SIGNE' and (p_first_invoice_on is null or p_first_invoice_on<i.delivered_on or p_first_invoice_on>today) then
  raise exception 'first_invoice_required' using errcode='22023'; end if;
 update public.dedicated_items set status=p_status,status_changed_at=now(),
  signed_at=case when p_status='SIGNE' then now() end,first_invoice_on=case when p_status='SIGNE' then p_first_invoice_on end,
  known_proof=proof where id=i.id;
 perform prospectos_private.dedicated_log(i.organization_id,i.contract_id,i.delivery_id,i.id,null,'STATUS_CHANGED',
  jsonb_strip_nulls(jsonb_build_object('from',i.status,'to',p_status,'first_invoice_on',case when p_status='SIGNE' then p_first_invoice_on end,'proof',proof)));
 return jsonb_build_object('id',i.id,'status',p_status,'changed',true);
end $$;
revoke all on function public.set_dedicated_item_status(uuid,text,date,jsonb) from public,anon;
grant execute on function public.set_dedicated_item_status(uuid,text,date,jsonb) to authenticated;

-- The rows of an export (one delivery, or the whole contract) and its journal entry, in one transaction: an export that
-- is not journaled cannot happen through this function.
create or replace function public.export_dedicated_items(p_contract_id uuid,p_delivery_id uuid default null,p_format text default 'csv') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts; rows jsonb;
begin
 c:=prospectos_private.dedicated_require_open(p_contract_id);
 if p_format not in ('csv','pdf') then raise exception 'Invalid export format' using errcode='22023'; end if;
 if p_delivery_id is not null and not exists(select 1 from public.dedicated_deliveries where id=p_delivery_id and contract_id=c.id) then
  raise exception 'dedicated_delivery_not_found' using errcode='P0002'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'delivery_number',d.number,'reference',i.reference,'siren',i.siren,'name',i.name,'city',i.city,
   'source_label',i.source_label,'source_url',i.source_url,'delivered_on',i.delivered_on,'status',i.status) order by d.number,i.position),'[]'::jsonb)
  into rows from public.dedicated_items i join public.dedicated_deliveries d on d.id=i.delivery_id
  where i.contract_id=c.id and (p_delivery_id is null or i.delivery_id=p_delivery_id);
 perform prospectos_private.dedicated_log(c.organization_id,c.id,p_delivery_id,null,null,'EXPORT',
  jsonb_build_object('format',p_format,'count',jsonb_array_length(rows),'item_ids',(select coalesce(jsonb_agg(r->>'id'),'[]'::jsonb) from jsonb_array_elements(rows) r)));
 return jsonb_build_object('contract',c.label,'rows',rows);
end $$;
revoke all on function public.export_dedicated_items(uuid,uuid,text) from public,anon;
grant execute on function public.export_dedicated_items(uuid,uuid,text) to authenticated;

create or replace function public.validate_dedicated_statement(p_statement_id uuid,p_attestation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.dedicated_statements; late boolean;
begin
 select * into s from public.dedicated_statements where id=p_statement_id for update;
 if not found or not prospectos_private.is_member(s.organization_id) then raise exception 'dedicated_statement_not_found' using errcode='P0002'; end if;
 perform prospectos_private.dedicated_require_open(s.contract_id);
 if p_attestation is distinct from 'J''atteste l''exactitude de ce relevé' then raise exception 'attestation_required' using errcode='22023'; end if;
 if s.validated_at is not null then raise exception 'statement_already_validated' using errcode='P0001'; end if;
 late:=prospectos_private.paris_today()>=(s.month+interval '1 month' + interval '4 days')::date;
 update public.dedicated_statements set validated_at=now(),validated_by=auth.uid() where id=s.id;
 perform prospectos_private.dedicated_log(s.organization_id,s.contract_id,null,null,s.id,'STATEMENT_VALIDATED',
  jsonb_build_object('attestation',p_attestation,'month',s.month,'signed_count',s.signed_count,'amount_ht_cents',s.amount_ht_cents,'late',late));
 return jsonb_build_object('id',s.id,'validated',true,'late',late);
end $$;
revoke all on function public.validate_dedicated_statement(uuid,text) from public,anon;
grant execute on function public.validate_dedicated_statement(uuid,text) to authenticated;

-- « J'accepte la proposition »: a member of the organization accepts the LATEST version of the proposal, identified by the
-- SHA-256 the screen showed. Journaled (user, time, version, SHA-256); the space opens and the trial starts on the planned
-- date. Independent of any subscription: no entitlement is read or written, no payment.
create or replace function public.accept_dedicated_proposal(p_contract_id uuid,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts; prop public.dedicated_proposals;
begin
 select * into c from public.dedicated_contracts where id=p_contract_id for update;
 if not found or not prospectos_private.is_member(c.organization_id) then raise exception 'dedicated_contract_not_found' using errcode='P0002'; end if;
 if c.status<>'PROPOSED' then raise exception 'dedicated_proposal_already_accepted' using errcode='P0001'; end if;
 select * into prop from public.dedicated_proposals where contract_id=c.id order by version desc limit 1;
 if not found then raise exception 'dedicated_proposal_missing' using errcode='P0001'; end if;
 if p_sha256 is distinct from prop.sha256 then raise exception 'dedicated_proposal_changed' using errcode='P0001'; end if;
 update public.dedicated_contracts set status='ACTIVE',accepted_at=now(),accepted_by=auth.uid(),accepted_sha256=prop.sha256 where id=c.id returning * into c;
 perform prospectos_private.dedicated_log(c.organization_id,c.id,null,null,null,'PROPOSAL_ACCEPTED',
  jsonb_build_object('version',prop.version,'sha256',prop.sha256,'file_name',prop.file_name,'trial_starts_on',c.trial_starts_on,
   'mention','J''accepte la proposition'));
 return jsonb_build_object('id',c.id,'status',c.status,'accepted_at',c.accepted_at,'trial_starts_on',c.trial_starts_on,'version',prop.version,'sha256',prop.sha256,
  'label',c.label,'organization',(select name from public.organizations where id=c.organization_id));
end $$;
revoke all on function public.accept_dedicated_proposal(uuid,text) from public,anon;
grant execute on function public.accept_dedicated_proposal(uuid,text) to authenticated;

-- ---------------------------------------------------------------- server only (cron)
-- The statement of p_month (first day of a past month) for every contract whose first statement month is reached:
-- every SIGNE item signed before the end of that month and not yet in a statement. Idempotent (one per contract and month).
create or replace function public.generate_dedicated_statements(p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts; month_end timestamptz; picked jsonb; n int; s public.dedicated_statements; made int:=0; minimum int;
begin
 if p_month is null or extract(day from p_month)<>1 or p_month>=date_trunc('month',prospectos_private.paris_today()::timestamp)::date then
  raise exception 'Invalid statement month' using errcode='22023'; end if;
 month_end:=((p_month+interval '1 month')::timestamp at time zone 'Europe/Paris');
 -- Accepted contracts only. After its termination month a contract still gets a statement for the commissions due
 -- (6 months), without guaranteed minimum, and only when there is at least one signature.
 for c in select * from public.dedicated_contracts where first_statement_month<=p_month and status<>'PROPOSED'
   and (status='ACTIVE' or p_month<=(terminated_at+interval '6 months')::date) order by created_at for update loop
  if exists(select 1 from public.dedicated_statements where contract_id=c.id and month=p_month) then continue; end if;
  minimum:=case when c.status='TERMINATED' and p_month>date_trunc('month',c.terminated_at at time zone 'Europe/Paris')::date then 0 else c.minimum_ht_cents end;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'reference',i.reference,'siren',i.siren,'name',i.name,'first_invoice_on',i.first_invoice_on,
    'signed_at',i.signed_at) order by i.signed_at,i.reference),'[]'::jsonb), count(*)
   into picked,n from public.dedicated_items i where i.contract_id=c.id and i.status='SIGNE' and i.statement_id is null and i.signed_at<month_end;
  if minimum=0 and n=0 then continue; end if;
  insert into public.dedicated_statements(contract_id,organization_id,month,signed_count,minimum_ht_cents,commission_ht_cents,amount_ht_cents,items)
  values(c.id,c.organization_id,p_month,n,minimum,c.commission_ht_cents,greatest(minimum,c.commission_ht_cents*n),picked)
  returning * into s;
  update public.dedicated_items set statement_id=s.id where id in (select (x->>'id')::uuid from jsonb_array_elements(picked) x);
  perform prospectos_private.dedicated_log(c.organization_id,c.id,null,null,s.id,'STATEMENT_GENERATED',
   jsonb_build_object('month',p_month,'signed_count',n,'amount_ht_cents',s.amount_ht_cents));
  made:=made+1;
 end loop;
 return jsonb_build_object('month',p_month,'generated',made);
end $$;
revoke all on function public.generate_dedicated_statements(date) from public,anon,authenticated;
grant execute on function public.generate_dedicated_statements(date) to service_role;

-- Statements not validated by the 5th of the following month (Paris date), each claimed once for the reminder to the
-- administrator. A failed send is released so that the next run tries again.
create or replace function public.claim_dedicated_reminders() returns jsonb
language plpgsql security definer set search_path='' as $$
declare claimed jsonb;
begin
 with due as (
  update public.dedicated_statements s set reminder_sent_at=now()
  where s.validated_at is null and s.reminder_sent_at is null and prospectos_private.paris_today()>=(s.month+interval '1 month'+interval '4 days')::date
  returning s.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',due.id,'month',due.month,'signed_count',due.signed_count,'amount_ht_cents',due.amount_ht_cents,
   'contract',c.label,'organization',o.name)),'[]'::jsonb) into claimed
 from due join public.dedicated_contracts c on c.id=due.contract_id join public.organizations o on o.id=due.organization_id;
 insert into public.dedicated_journal(organization_id,contract_id,statement_id,actor_id,kind,detail)
  select s.organization_id,s.contract_id,s.id,null,'STATEMENT_REMINDER',jsonb_build_object('month',s.month)
  from public.dedicated_statements s where s.id in (select (x->>'id')::uuid from jsonb_array_elements(claimed) x);
 return claimed;
end $$;
revoke all on function public.claim_dedicated_reminders() from public,anon,authenticated;
grant execute on function public.claim_dedicated_reminders() to service_role;

create or replace function public.release_dedicated_reminder(p_statement_id uuid) returns boolean
language sql security definer set search_path='' as $$
 update public.dedicated_statements set reminder_sent_at=null where id=p_statement_id and validated_at is null returning true
$$;
revoke all on function public.release_dedicated_reminder(uuid) from public,anon,authenticated;
grant execute on function public.release_dedicated_reminder(uuid) to service_role;

commit;
