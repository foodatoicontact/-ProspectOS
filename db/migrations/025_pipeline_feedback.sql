-- Signal Engine V1, blocks S7 + S8 (docs/SIGNAL_ENGINE_V1_PLAN.md): which signals a message cited, and what produced
-- answers.
--
-- 1. prospects.status gains 'RDV' (a meeting was booked), between 'Intéressé' and 'Gagné'. Every other status is kept.
-- 2. outreach.signal_ids — the verified signals the "why now" sentence of a message quoted (S7), next to evidence_ids.
-- 3. public.contact_snapshots — "why we contacted them", frozen at the moment of contact (a message marked USED, or the
--    prospect moved to 'Contacté'): FIT and INTENT as shown then, the signals (type, source kind, age) and evidence it
--    rested on. A later recomputation never rewrites it. Written only by record_contact_snapshot (members of the
--    prospect's organization, one snapshot per prospect per 7 days); read by members through RLS; never updated or
--    deleted by a client. The scores are the server's own computation at contact time; they describe the user's own
--    pipeline and are never evidence.
--
-- Rollback: drop function public.record_contact_snapshot(uuid,uuid,text,jsonb); drop table public.contact_snapshots;
-- alter table public.outreach drop column signal_ids; restore prospects_status_check from 006 (only if no row is 'RDV').
begin;

alter table public.prospects drop constraint if exists prospects_status_check;
alter table public.prospects add constraint prospects_status_check
 check (status in ('À analyser','Qualifié','À contacter','Contacté','Réponse','Intéressé','RDV','Gagné','Perdu','Ignoré'));

alter table public.outreach add column if not exists signal_ids jsonb not null default '[]'
 check(jsonb_typeof(signal_ids)='array' and jsonb_array_length(signal_ids)<=20);

create table if not exists public.contact_snapshots (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 prospect_id uuid not null,
 outreach_id uuid,
 trigger text not null check(trigger in ('outreach_used','status_contacted')),
 fit_score int check(fit_score is null or fit_score between 0 and 100),
 fit_estimated int check(fit_estimated is null or fit_estimated between 0 and 100),
 intent_score int not null check(intent_score between 0 and 100),
 intent_estimated int not null check(intent_estimated between 0 and 100),
 signals jsonb not null default '[]' check(jsonb_typeof(signals)='array' and jsonb_array_length(signals)<=20),
 evidence_ids jsonb not null default '[]' check(jsonb_typeof(evidence_ids)='array' and jsonb_array_length(evidence_ids)<=50),
 created_by uuid references auth.users(id),
 contacted_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
create index if not exists contact_snapshots_project_idx on public.contact_snapshots(organization_id,project_id,contacted_at desc);
create index if not exists contact_snapshots_prospect_idx on public.contact_snapshots(prospect_id,contacted_at desc);
alter table public.contact_snapshots enable row level security;
create policy contact_snapshots_read on public.contact_snapshots for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.contact_snapshots from public,anon,authenticated;
grant select on public.contact_snapshots to authenticated;

-- p_snapshot: {"fit_score": int|null, "fit_estimated": int|null, "intent_score": int, "intent_estimated": int,
--              "signals": [{"id": uuid, "type": text, "source_type": text, "age_days": int}], "evidence_ids": [uuid]}
-- Every signal and evidence id must belong to this prospect. Returns {"created": bool, "id": uuid}.
create or replace function public.record_contact_snapshot(p_prospect_id uuid, p_outreach_id uuid, p_trigger text, p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid; existing uuid; row_id uuid; item jsonb;
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('contact-snapshot:'||p_prospect_id::text,0));
 if p_trigger not in ('outreach_used','status_contacted') then raise exception 'Invalid snapshot' using errcode='22023'; end if;
 if p_outreach_id is not null and not exists(select 1 from public.outreach o where o.id=p_outreach_id and o.prospect_id=p_prospect_id and o.organization_id=tenant) then
  raise exception 'Outreach not found' using errcode='P0002';
 end if;
 if jsonb_typeof(p_snapshot)<>'object' or exists(select 1 from jsonb_object_keys(p_snapshot) k where k not in ('fit_score','fit_estimated','intent_score','intent_estimated','signals','evidence_ids'))
    or jsonb_typeof(coalesce(p_snapshot->'signals','[]'))<>'array' or jsonb_typeof(coalesce(p_snapshot->'evidence_ids','[]'))<>'array' then
  raise exception 'Invalid snapshot' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(coalesce(p_snapshot->'signals','[]')) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','type','source_type','age_days'))
     or jsonb_typeof(item->'age_days')<>'number'
     or not exists(select 1 from public.signals s where s.id=(item->>'id')::uuid and s.prospect_id=p_prospect_id and s.signal_type=item->>'type' and s.source_type=item->>'source_type') then
   raise exception 'Invalid snapshot signal' using errcode='22023';
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_snapshot->'evidence_ids','[]')) e
           where not exists(select 1 from public.evidence v where v.id=e::uuid and v.prospect_id=p_prospect_id)) then
  raise exception 'Invalid snapshot evidence' using errcode='22023';
 end if;
 -- One contact is one snapshot: marking the message used and moving the prospect to "Contacté" the same week is the
 -- same contact, frozen once.
 select id into existing from public.contact_snapshots where prospect_id=p_prospect_id and contacted_at>now()-interval '7 days' order by contacted_at desc limit 1;
 if existing is not null then return jsonb_build_object('created',false,'id',existing); end if;
 insert into public.contact_snapshots(organization_id,project_id,prospect_id,outreach_id,trigger,fit_score,fit_estimated,intent_score,intent_estimated,signals,evidence_ids,created_by)
 values(tenant,project,p_prospect_id,p_outreach_id,p_trigger,(p_snapshot->>'fit_score')::int,(p_snapshot->>'fit_estimated')::int,
  coalesce((p_snapshot->>'intent_score')::int,0),coalesce((p_snapshot->>'intent_estimated')::int,0),coalesce(p_snapshot->'signals','[]'),coalesce(p_snapshot->'evidence_ids','[]'),auth.uid())
 returning id into row_id;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(tenant,p_prospect_id,auth.uid(),'contact.snapshot',jsonb_build_object('snapshot_id',row_id,'trigger',p_trigger));
 return jsonb_build_object('created',true,'id',row_id);
end $$;
revoke all on function public.record_contact_snapshot(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.record_contact_snapshot(uuid,uuid,text,jsonb) to authenticated;

commit;
