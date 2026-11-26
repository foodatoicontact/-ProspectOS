-- 055 — Reclassement des « reprises » de la base nationale et statut des annonces annulées ou rectifiées (owner decision,
-- 25 nov. 2026; src/domain/bodacc-purchase.ts, docs/BODACC_RACHATS.md). Until 25 nov. 2026 the collection stored every
-- « Ventes et cessions » notice as VENTE_FONDS; 62 % of them were mergers, contributions or court-ordered sales.
--
-- 1. public.public_events.kind — four more values for the sale family: FUSION (merger, split, cross-border transformation),
--    APPORT (contribution, donation, attribution), VENTE_JUDICIAIRE (sale ordered in a collective proceeding) and
--    INDETERMINE (no rule could sort it: shown only to the administrator, for a manual review). VENTE_FONDS keeps meaning
--    « rachat confirmé ». No client pool, list or delivery reads these new kinds (their kinds are fixed lists).
-- 2. public.public_events.status — ACTIVE, ANNULEE (a later BODACC notice cancels it), RECTIFIEE (a later notice corrects it:
--    the correction is the event to use) or AVIS_ANNULATION (the row is itself a notice of cancellation, stored before
--    25 nov. 2026). status_source_id / status_url point at the other notice: the one that cancels or corrects this one, or,
--    for an AVIS_ANNULATION, the notice it cancels. Only ACTIVE rows are ever proposed.
--    public.public_events.sale_rule — the id of the rule that sorted a sale notice (never any text of the notice).
-- 3. public.public_event_reclassifications — the audit: every change of kind, rule or status, with the old and the new value,
--    the batch, who made it and when. Append-only for the browser (no access at all); a revert only stamps reverted_at.
-- 4. public.public_event_supersessions — the cancellations and corrections known (from the collection or a batch), applied
--    to the event they target as soon as it is stored, whatever the order the notices arrive in.
-- 5. Server functions (service_role): reclassify_public_events(batch, rows) and supersede_public_events(batch, rows) — the
--    one-off reclassification, audited; revert_public_event_batch(batch) — puts back the old values of a batch;
--    ingest_public_events(…, p_supersessions) — the collection, now with the rule and the cancellations/corrections.
-- 6. Administrator functions: admin_lead_pool and admin_company as in 049, reading ACTIVE rows only (the pool) and showing
--    the status (the company sheet); admin_events_to_review(limit) — the INDETERMINE rows to read by hand.
-- Nothing is deleted. No delivery (dedicated_items), journal, list item, reservation, entitlement, billing or evidence row is
-- touched.
--
-- Rollback: select public.revert_public_event_batch(<batch>) for each batch applied; then
--   drop function public.reclassify_public_events(uuid,jsonb), public.supersede_public_events(uuid,jsonb),
--   public.revert_public_event_batch(uuid), public.admin_events_to_review(int), public.ingest_public_events(text,date,jsonb,int,int,jsonb,jsonb);
--   re-run ingest_public_events and its grants from 054, admin_lead_pool and admin_company from 049;
--   drop table public.public_event_supersessions, public.public_event_reclassifications;
--   alter table public.public_events drop column status, drop column status_source_id, drop column status_url, drop column sale_rule;
--   restore the kind check of 046 (only once no row holds a new kind).
begin;

alter table public.public_events drop constraint if exists public_events_kind_check;
alter table public.public_events add constraint public_events_kind_check
 check(kind in ('CREATION','ETABLISSEMENT','TRANSFERT_SIEGE','VENTE_FONDS','PROCEDURE_COLLECTIVE','INSPECTION_ICPE','FUSION','APPORT','VENTE_JUDICIAIRE','INDETERMINE'));
alter table public.public_events add column if not exists status text not null default 'ACTIVE';
alter table public.public_events add column if not exists status_source_id text;
alter table public.public_events add column if not exists status_url text;
alter table public.public_events add column if not exists sale_rule text;
alter table public.public_events drop constraint if exists public_events_status_check;
alter table public.public_events add constraint public_events_status_check check(
 status in ('ACTIVE','ANNULEE','RECTIFIEE','AVIS_ANNULATION')
 and (status='ACTIVE')=(status_source_id is null)
 and (status_source_id is null or length(status_source_id) between 1 and 80)
 and (status_url is null or (status_url ~ '^https://[^\s]+$' and length(status_url)<=500)));
alter table public.public_events drop constraint if exists public_events_sale_rule_check;
alter table public.public_events add constraint public_events_sale_rule_check check(sale_rule is null or sale_rule ~ '^[a-z_]{1,40}$');
create index if not exists public_events_status_idx on public.public_events(status) where status<>'ACTIVE';

create table if not exists public.public_event_reclassifications (
 id bigint generated always as identity primary key,
 batch_id uuid,
 event_id bigint not null references public.public_events(id) on delete cascade,
 source_id text not null,
 old_kind text not null, new_kind text not null,
 old_rule text, new_rule text,
 old_status text not null, new_status text not null,
 old_status_source_id text, new_status_source_id text,
 old_status_url text, new_status_url text,
 actor text not null check(actor in ('batch','collect')),
 reclassified_at timestamptz not null default now(),
 reverted_at timestamptz
);
create index if not exists public_event_reclassifications_batch_idx on public.public_event_reclassifications(batch_id);

create table if not exists public.public_event_supersessions (
 id bigint generated always as identity primary key,
 source text not null,
 target_source_id text not null check(length(target_source_id) between 1 and 80),
 status text not null check(status in ('ANNULEE','RECTIFIEE')),
 by_source_id text not null check(length(by_source_id) between 1 and 80),
 by_url text check(by_url is null or (by_url ~ '^https://[^\s]+$' and length(by_url)<=500)),
 batch_id uuid,
 created_at timestamptz not null default now(),
 reverted_at timestamptz,
 unique(source,target_source_id,by_source_id)
);
create index if not exists public_event_supersessions_target_idx on public.public_event_supersessions(source,target_source_id) where reverted_at is null;

alter table public.public_event_reclassifications enable row level security;
alter table public.public_event_supersessions enable row level security;
revoke all on public.public_event_reclassifications,public.public_event_supersessions from public,anon,authenticated;

-- Applies the known cancellations and corrections to the events they target (only rows still ACTIVE, or RECTIFIEE when a
-- cancellation arrives: a cancellation wins). Every change is audited. Returns the number of events changed.
create or replace function prospectos_private.apply_public_event_supersessions(p_source text,p_actor text,p_batch uuid) returns int
language plpgsql security definer set search_path='' as $$
declare n int;
begin
 with s as (
  select distinct on (x.target_source_id) x.target_source_id,x.status,x.by_source_id,x.by_url from public.public_event_supersessions x
  where x.source=p_source and x.reverted_at is null
  order by x.target_source_id,(x.status='ANNULEE') desc,x.created_at desc
 ), old as (
  select e.id,e.source_id,e.kind,e.sale_rule,e.status,e.status_source_id,e.status_url,s.status ns,s.by_source_id nb,s.by_url nu
  from public.public_events e join s on e.source=p_source and e.source_id=s.target_source_id
  where e.status='ACTIVE' or (e.status='RECTIFIEE' and s.status='ANNULEE')
  for update of e
 ), upd as (
  update public.public_events e set status=o.ns,status_source_id=o.nb,status_url=o.nu from old o where e.id=o.id returning e.id
 ), audit as (
  insert into public.public_event_reclassifications(batch_id,event_id,source_id,old_kind,new_kind,old_rule,new_rule,old_status,new_status,
   old_status_source_id,new_status_source_id,old_status_url,new_status_url,actor)
  select p_batch,o.id,o.source_id,o.kind,o.kind,o.sale_rule,o.sale_rule,o.status,o.ns,o.status_source_id,o.nb,o.status_url,o.nu,p_actor
  from old o join upd u on u.id=o.id returning 1)
 select count(*) into n from audit;
 return n;
end $$;
revoke all on function prospectos_private.apply_public_event_supersessions(text,text,uuid) from public,anon,authenticated;

-- p_rows: [{source_id, kind, rule}] — sale notices only: a row is changed only if its kind is a sale kind, and only to a sale
-- kind. A row already holding these values is left as it is (a batch can be replayed). Returns the rows changed.
create or replace function public.reclassify_public_events(p_batch uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int; sale text[]:=array['VENTE_FONDS','FUSION','APPORT','VENTE_JUDICIAIRE','INDETERMINE'];
begin
 if p_batch is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>20000 then raise exception 'Invalid reclassification' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where not (r->>'kind')=any(sale) or coalesce(r->>'rule','') !~ '^[a-z_]{1,40}$' or coalesce(r->>'source_id','')='') then
  raise exception 'Invalid reclassification' using errcode='22023'; end if;
 with r as (select distinct on (x->>'source_id') x->>'source_id' source_id,x->>'kind' kind,x->>'rule' rule from jsonb_array_elements(p_rows) x),
 old as (select e.id,e.source_id,e.kind,e.sale_rule,e.status,e.status_source_id,e.status_url,r.kind new_kind,r.rule new_rule
  from public.public_events e join r on r.source_id=e.source_id
  where e.source='bodacc' and e.kind=any(sale) and (e.kind is distinct from r.kind or e.sale_rule is distinct from r.rule) for update of e),
 upd as (update public.public_events e set kind=o.new_kind,sale_rule=o.new_rule from old o where e.id=o.id returning e.id),
 audit as (insert into public.public_event_reclassifications(batch_id,event_id,source_id,old_kind,new_kind,old_rule,new_rule,old_status,new_status,
   old_status_source_id,new_status_source_id,old_status_url,new_status_url,actor)
  select p_batch,o.id,o.source_id,o.kind,o.new_kind,o.sale_rule,o.new_rule,o.status,o.status,o.status_source_id,o.status_source_id,o.status_url,o.status_url,'batch'
  from old o join upd u on u.id=o.id returning 1)
 select count(*) into n from audit;
 return jsonb_build_object('batch_id',p_batch,'changed',n);
end $$;

-- p_rows: [{target_source_id, status: ANNULEE|RECTIFIEE|AVIS_ANNULATION, by_source_id, by_url}]. ANNULEE and RECTIFIEE are
-- recorded as supersessions (applied now and to any later copy of the target); AVIS_ANNULATION marks a stored notice of
-- cancellation, by_source_id/by_url then being the notice it cancels. Audited; returns the rows changed.
create or replace function public.supersede_public_events(p_batch uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int; m int;
begin
 if p_batch is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>20000 then raise exception 'Invalid supersession' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where not (r->>'status')=any(array['ANNULEE','RECTIFIEE','AVIS_ANNULATION'])
   or coalesce(r->>'target_source_id','')='' or coalesce(r->>'by_source_id','')='' or coalesce(r->>'by_url','https://x') !~ '^https://[^\s]+$') then
  raise exception 'Invalid supersession' using errcode='22023'; end if;
 insert into public.public_event_supersessions(source,target_source_id,status,by_source_id,by_url,batch_id)
 select 'bodacc',r->>'target_source_id',r->>'status',r->>'by_source_id',r->>'by_url',p_batch from jsonb_array_elements(p_rows) r
 where r->>'status'<>'AVIS_ANNULATION'
 on conflict(source,target_source_id,by_source_id) do update set status=excluded.status,by_url=excluded.by_url,batch_id=excluded.batch_id,reverted_at=null
  where public.public_event_supersessions.reverted_at is not null;
 n:=prospectos_private.apply_public_event_supersessions('bodacc','batch',p_batch);
 with r as (select x->>'target_source_id' t,x->>'by_source_id' b,x->>'by_url' u from jsonb_array_elements(p_rows) x where x->>'status'='AVIS_ANNULATION'),
 old as (select e.id,e.source_id,e.kind,e.sale_rule,e.status,e.status_source_id,e.status_url,r.b,r.u from public.public_events e join r on r.t=e.source_id
  where e.source='bodacc' and e.status='ACTIVE' for update of e),
 upd as (update public.public_events e set status='AVIS_ANNULATION',status_source_id=o.b,status_url=o.u from old o where e.id=o.id returning e.id),
 audit as (insert into public.public_event_reclassifications(batch_id,event_id,source_id,old_kind,new_kind,old_rule,new_rule,old_status,new_status,
   old_status_source_id,new_status_source_id,old_status_url,new_status_url,actor)
  select p_batch,o.id,o.source_id,o.kind,o.kind,o.sale_rule,o.sale_rule,o.status,'AVIS_ANNULATION',o.status_source_id,o.b,o.status_url,o.u,'batch'
  from old o join upd u on u.id=o.id returning 1)
 select count(*) into m from audit;
 return jsonb_build_object('batch_id',p_batch,'changed',n+m);
end $$;

-- Puts back, for every change of the batch not yet reverted, the old kind, rule and status (newest change first), and
-- withdraws the batch's supersessions. The audit rows stay, stamped reverted_at. Returns the rows put back.
create or replace function public.revert_public_event_batch(p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; n int:=0;
begin
 if p_batch is null then raise exception 'Invalid batch' using errcode='22023'; end if;
 for a in select * from public.public_event_reclassifications where batch_id=p_batch and reverted_at is null order by id desc loop
  update public.public_events set kind=a.old_kind,sale_rule=a.old_rule,status=a.old_status,status_source_id=a.old_status_source_id,status_url=a.old_status_url
  where id=a.event_id;
  update public.public_event_reclassifications set reverted_at=now() where id=a.id;
  n:=n+1;
 end loop;
 update public.public_event_supersessions set reverted_at=now() where batch_id=p_batch and reverted_at is null;
 return jsonb_build_object('batch_id',p_batch,'reverted',n);
end $$;

-- The collection, as in 054, plus: each event may carry its sale rule; p_supersessions lists the cancellations and
-- corrections read that night ([{target_source_id, status: ANNULEE|RECTIFIEE, by_source_id, by_url}]), recorded and applied
-- to their target if it is stored (now or later). A notice of cancellation is never stored as an event.
drop function if exists public.ingest_public_events(text,date,jsonb,int,int,jsonb);
create or replace function public.ingest_public_events(p_source text,p_day date,p_events jsonb,p_fetched int,p_skipped_persons int,
 p_sale_rules jsonb default '{}'::jsonb,p_supersessions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int; rules jsonb:=coalesce(p_sale_rules,'{}'::jsonb); sup jsonb:=coalesce(p_supersessions,'[]'::jsonb); applied int:=0;
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>20000 then raise exception 'Invalid events' using errcode='22023'; end if;
 if jsonb_typeof(rules)<>'object' or (select count(*) from jsonb_object_keys(rules))>32
  or exists(select 1 from jsonb_each(rules) r where r.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(r.value)<>'number'
   or (r.value)::numeric<0 or (r.value)::numeric>100000 or (r.value)::numeric<>trunc((r.value)::numeric))
 then raise exception 'Invalid sale rules' using errcode='22023'; end if;
 if jsonb_typeof(sup)<>'array' or jsonb_array_length(sup)>5000 or exists(select 1 from jsonb_array_elements(sup) r
   where not (r->>'status')=any(array['ANNULEE','RECTIFIEE']) or coalesce(r->>'target_source_id','')='' or coalesce(r->>'by_source_id','')=''
   or length(r->>'target_source_id')>80 or length(r->>'by_source_id')>80 or coalesce(r->>'by_url','https://x') !~ '^https://[^\s]+$')
 then raise exception 'Invalid supersessions' using errcode='22023'; end if;
 with rows as (
  insert into public.public_events(source,source_id,kind,siren,name,published_on,department,commune,postal_code,activity,source_url,sale_rule)
  select p_source,e->>'source_id',e->>'kind',e->>'siren',nullif(left(e->>'name',200),''),(e->>'published_on')::date,nullif(e->>'department',''),
   nullif(left(e->>'commune',120),''),nullif(e->>'postal_code',''),nullif(left(e->>'activity',500),''),e->>'source_url',nullif(e->>'sale_rule','')
  from jsonb_array_elements(p_events) e
  on conflict(source,source_id) do nothing returning 1)
 select count(*) into n from rows;
 insert into public.public_event_supersessions(source,target_source_id,status,by_source_id,by_url)
 select p_source,r->>'target_source_id',r->>'status',r->>'by_source_id',nullif(r->>'by_url','') from jsonb_array_elements(sup) r
 on conflict(source,target_source_id,by_source_id) do update set status=excluded.status,by_url=excluded.by_url,reverted_at=null
  where public.public_event_supersessions.reverted_at is not null;
 applied:=prospectos_private.apply_public_event_supersessions(p_source,'collect',null);
 insert into public.public_event_runs(source,day,fetched,inserted,skipped_persons,sale_rules)
  values(p_source,p_day,coalesce(p_fetched,0),n,coalesce(p_skipped_persons,0),rules);
 return jsonb_build_object('inserted',n,'superseded',applied);
end $$;

-- The sorted pool of one client (049), on ACTIVE rows only: a cancelled or corrected notice is never proposed.
create or replace function public.admin_lead_pool(p_contract_id uuid,p_days int,p_limit int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.lead_profiles;rows jsonb;waiting int;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into p from public.lead_profiles where contract_id=p_contract_id;
 if not found then raise exception 'lead_profile_missing' using errcode='P0001'; end if;
 if p_days is null or p_days<1 or p_days>400 or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid pool request' using errcode='22023'; end if;
 with ev as (
  select e.* from public.public_events e
  where e.published_on>=current_date-p_days and e.kind=any(p.kinds) and e.status='ACTIVE'
 ), cand as (
  select ev.siren,min(prospectos_private.lead_kind_rank(ev.kind)) best_rank,max(ev.published_on) last_on,count(*) events,
   (array_agg(ev.kind order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] kind,
   (array_agg(ev.source_url order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] source_url,
   (array_agg(ev.published_on order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] event_on,
   (array_agg(coalesce(ev.department,c.department) order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] department,
   (array_agg(coalesce(ev.commune,c.commune) order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] commune,
   (array_agg(ev.activity order by prospectos_private.lead_kind_rank(ev.kind),ev.published_on desc))[1] activity
  from ev join public.company_cache c on c.siren=ev.siren
  where c.active and not c.individual and not c.opposition and coalesce(ev.department,c.department)=any(p.departments)
    and (cardinality(p.naf_prefixes)=0 or exists(select 1 from unnest(p.naf_prefixes) n where c.naf like n||'%'))
    and not exists(select 1 from public.dedicated_items i where i.contract_id=p.contract_id and i.siren=ev.siren)
    and not exists(select 1 from public.lead_assignments a where a.siren=ev.siren and a.trade_key=p.trade_key and a.released_at is null and a.contract_id<>p.contract_id)
  group by ev.siren
 )
 select coalesce(jsonb_agg(jsonb_build_object('siren',x.siren,'name',c.name,'naf',c.naf,'employee_band',c.employee_band,'department',x.department,'commune',x.commune,
   'kind',x.kind,'event_on',x.event_on,'source_url',x.source_url,'activity',x.activity,'events',x.events,
   'reserved',exists(select 1 from public.lead_assignments a where a.siren=x.siren and a.trade_key=p.trade_key and a.released_at is null and a.contract_id=p.contract_id),
   'other_trades',(select count(distinct a.trade_key) from public.lead_assignments a where a.siren=x.siren and a.released_at is null and a.trade_key<>p.trade_key),
   'lists',(select count(distinct i.list_id) from public.prospect_list_items i where i.siren=x.siren))
   order by x.best_rank,x.last_on desc,c.employee_band desc nulls last,x.siren),'[]')
 into rows from (select * from cand order by best_rank,last_on desc,siren limit p_limit) x join public.company_cache c on c.siren=x.siren;
 select count(distinct e.siren) into waiting from public.public_events e left join public.company_cache c on c.siren=e.siren
 where e.published_on>=current_date-p_days and e.kind=any(p.kinds) and e.status='ACTIVE' and e.department=any(p.departments) and c.siren is null;
 return jsonb_build_object('profile',to_jsonb(p)-'updated_by','leads',rows,'waiting_enrichment',waiting);
end $$;

-- One company (049), its events now with their status and the notice that cancels or corrects them.
create or replace function public.admin_company(p_siren text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_siren is null or p_siren!~'^[0-9]{9}$' then raise exception 'Invalid SIREN' using errcode='22023'; end if;
 return jsonb_build_object(
  'siren',p_siren,
  'company',(select to_jsonb(c)-'fetched_at'-'expires_at' from public.company_cache c where c.siren=p_siren),
  'events',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'published_on',e.published_on,'department',e.department,'commune',e.commune,'activity',e.activity,'source_url',e.source_url,
    'status',e.status,'status_url',e.status_url,'sale_rule',e.sale_rule)
    order by e.published_on desc) from public.public_events e where e.siren=p_siren),'[]'),
  'lists',coalesce((select jsonb_agg(jsonb_build_object('code',l.code,'title',l.title,'produced_on',l.produced_on) order by l.produced_on desc)
    from public.prospect_lists l where exists(select 1 from public.prospect_list_items i where i.list_id=l.id and i.siren=p_siren)),'[]'),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'trade_key',a.trade_key,'contract_id',a.contract_id,'client',k.label,'source',a.source,
    'assigned_at',a.assigned_at,'released_at',a.released_at,'status',i.status,'delivered_on',i.delivered_on) order by a.assigned_at desc)
    from public.lead_assignments a join public.dedicated_contracts k on k.id=a.contract_id left join public.dedicated_items i on i.id=a.dedicated_item_id where a.siren=p_siren),'[]'));
end $$;

-- The sale notices no rule could sort (INDETERMINE, still ACTIVE), newest first, for the administrator to read by hand.
create or replace function public.admin_events_to_review(p_limit int) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid review request' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('source_id',x.source_id,'siren',x.siren,'name',coalesce(c.name,x.name),'published_on',x.published_on,
   'department',x.department,'commune',x.commune,'activity',x.activity,'source_url',x.source_url,'sale_rule',x.sale_rule) order by x.published_on desc,x.source_id)
  from (select * from public.public_events e where e.kind='INDETERMINE' and e.status='ACTIVE' order by e.published_on desc,e.source_id limit p_limit) x
  left join public.company_cache c on c.siren=x.siren),'[]'::jsonb);
end $$;

revoke all on function public.reclassify_public_events(uuid,jsonb),public.supersede_public_events(uuid,jsonb),public.revert_public_event_batch(uuid),
 public.ingest_public_events(text,date,jsonb,int,int,jsonb,jsonb),public.admin_events_to_review(int) from public,anon,authenticated;
grant execute on function public.reclassify_public_events(uuid,jsonb),public.supersede_public_events(uuid,jsonb),public.revert_public_event_batch(uuid),
 public.ingest_public_events(text,date,jsonb,int,int,jsonb,jsonb) to service_role;
grant execute on function public.admin_events_to_review(int) to authenticated;

commit;
