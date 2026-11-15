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
--   admin (authenticated, INTERNAL): create_dedicated_contract, create_dedicated_delivery, dedicated_admin_overview
--   client (authenticated, member): open_dedicated_item, set_dedicated_item_status, export_dedicated_items,
--                                    validate_dedicated_statement
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
--   drop function public.create_dedicated_contract(text,text,int,int,int,date), public.create_dedicated_delivery(uuid,text,jsonb),
--    public.dedicated_admin_overview(), public.open_dedicated_item(uuid), public.set_dedicated_item_status(uuid,text,date,jsonb),
--    public.export_dedicated_items(uuid,uuid,text), public.validate_dedicated_statement(uuid,text),
--    public.generate_dedicated_statements(date), public.claim_dedicated_reminders(), public.release_dedicated_reminder(uuid),
--    prospectos_private.is_internal_admin(), prospectos_private.paris_today(), prospectos_private.dedicated_log(uuid,uuid,uuid,uuid,uuid,text,jsonb),
--    prospectos_private.deny_dedicated_journal_mutation();
--   drop table public.dedicated_journal, public.dedicated_statements, public.dedicated_items, public.dedicated_deliveries,
--    public.dedicated_contracts;
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
 created_by uuid not null,
 created_at timestamptz not null default now(),
 unique(id,organization_id),
 unique(organization_id,label)
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
 contract_id uuid references public.dedicated_contracts(id),
 delivery_id uuid references public.dedicated_deliveries(id),
 item_id uuid references public.dedicated_items(id),
 statement_id uuid references public.dedicated_statements(id),
 actor_id uuid,
 kind text not null check(kind in ('CONTRACT_CREATED','DELIVERY_CREATED','ITEM_OPENED','EXPORT','STATUS_CHANGED',
  'STATEMENT_GENERATED','STATEMENT_VALIDATED','STATEMENT_REMINDER')),
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

-- Read access: members of the client organization, or the administrator. No direct write for any browser role.
alter table public.dedicated_contracts enable row level security;
alter table public.dedicated_deliveries enable row level security;
alter table public.dedicated_items enable row level security;
alter table public.dedicated_statements enable row level security;
alter table public.dedicated_journal enable row level security;
do $$ declare tbl text; begin
 foreach tbl in array array['dedicated_contracts','dedicated_deliveries','dedicated_items','dedicated_statements','dedicated_journal'] loop
  execute format('drop policy if exists dedicated_read on public.%I',tbl);
  execute format('create policy dedicated_read on public.%I for select to authenticated using (prospectos_private.is_member(organization_id) or prospectos_private.is_internal_admin())',tbl);
 end loop;
end $$;
revoke all on public.dedicated_contracts,public.dedicated_deliveries,public.dedicated_items,public.dedicated_statements,public.dedicated_journal from public,anon,authenticated;
grant select on public.dedicated_contracts,public.dedicated_deliveries,public.dedicated_items,public.dedicated_statements,public.dedicated_journal to authenticated;

-- ---------------------------------------------------------------- administrator
create or replace function public.create_dedicated_contract(p_client_email text,p_label text,p_minimum_ht_cents int,p_commission_ht_cents int,
 p_known_client_days int default 15,p_first_statement_month date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; row public.dedicated_contracts;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select m.organization_id into tenant from auth.users u join public.memberships m on m.user_id=u.id and m.role='owner'
  where lower(u.email)=lower(trim(coalesce(p_client_email,''))) order by m.created_at,m.organization_id limit 1;
 if tenant is null then raise exception 'dedicated_client_not_found' using errcode='P0002'; end if;
 insert into public.dedicated_contracts(organization_id,label,minimum_ht_cents,commission_ht_cents,known_client_days,first_statement_month,created_by)
 values(tenant,trim(p_label),p_minimum_ht_cents,p_commission_ht_cents,coalesce(p_known_client_days,15),
  coalesce(p_first_statement_month,date_trunc('month',prospectos_private.paris_today()::timestamp)::date),auth.uid()) returning * into row;
 perform prospectos_private.dedicated_log(tenant,row.id,null,null,null,'CONTRACT_CREATED',
  jsonb_build_object('minimum_ht_cents',row.minimum_ht_cents,'commission_ht_cents',row.commission_ht_cents,'known_client_days',row.known_client_days,
   'first_statement_month',row.first_statement_month));
 return to_jsonb(row);
end $$;
revoke all on function public.create_dedicated_contract(text,text,int,int,int,date) from public,anon;
grant execute on function public.create_dedicated_contract(text,text,int,int,int,date) to authenticated;

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
  'contract',jsonb_build_object('id',c.id,'label',c.label,'organization',o.name,'minimum_ht_cents',c.minimum_ht_cents,
   'commission_ht_cents',c.commission_ht_cents,'known_client_days',c.known_client_days,'first_statement_month',c.first_statement_month),
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
 if i.statement_id is not null then raise exception 'item_in_statement' using errcode='P0001'; end if;
 if p_status=i.status then return jsonb_build_object('id',i.id,'status',i.status,'changed',false); end if;
 select * into c from public.dedicated_contracts where id=i.contract_id;
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
 select * into c from public.dedicated_contracts where id=p_contract_id;
 if not found or not prospectos_private.is_member(c.organization_id) then raise exception 'dedicated_contract_not_found' using errcode='P0002'; end if;
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

-- ---------------------------------------------------------------- server only (cron)
-- The statement of p_month (first day of a past month) for every contract whose first statement month is reached:
-- every SIGNE item signed before the end of that month and not yet in a statement. Idempotent (one per contract and month).
create or replace function public.generate_dedicated_statements(p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.dedicated_contracts; month_end timestamptz; picked jsonb; n int; s public.dedicated_statements; made int:=0;
begin
 if p_month is null or extract(day from p_month)<>1 or p_month>=date_trunc('month',prospectos_private.paris_today()::timestamp)::date then
  raise exception 'Invalid statement month' using errcode='22023'; end if;
 month_end:=((p_month+interval '1 month')::timestamp at time zone 'Europe/Paris');
 for c in select * from public.dedicated_contracts where first_statement_month<=p_month order by created_at for update loop
  if exists(select 1 from public.dedicated_statements where contract_id=c.id and month=p_month) then continue; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'reference',i.reference,'siren',i.siren,'name',i.name,'first_invoice_on',i.first_invoice_on,
    'signed_at',i.signed_at) order by i.signed_at,i.reference),'[]'::jsonb), count(*)
   into picked,n from public.dedicated_items i where i.contract_id=c.id and i.status='SIGNE' and i.statement_id is null and i.signed_at<month_end;
  insert into public.dedicated_statements(contract_id,organization_id,month,signed_count,minimum_ht_cents,commission_ht_cents,amount_ht_cents,items)
  values(c.id,c.organization_id,p_month,n,c.minimum_ht_cents,c.commission_ht_cents,greatest(c.minimum_ht_cents,c.commission_ht_cents*n),picked)
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
