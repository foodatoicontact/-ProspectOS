-- Signal Engine V1, block S9 (docs/SIGNAL_ENGINE_V1_PLAN.md §10): monitoring — a queue in Postgres, no new
-- infrastructure. A member puts a prospect under monitoring; a daily cron (Vercel Cron → /api/cron/signals, guarded by
-- CRON_SECRET) claims the prospects that are due and looks for new signals (official website when authorized, BODACC
-- by SIREN). Every signal found is still PENDING_REVIEW: monitoring finds, a person verifies.
--
-- 1. public.monitored_prospects — one row per monitored prospect: who asked (created_by, whose membership and activity
--    keep it alive), frequency from the plan, next run, pause reason. Members read through RLS; writes by RPC only.
--    Cap per organization by the asker's effective plan: trial 0, Solo 10, Pro 50, Team 50 × seats, Enterprise and
--    internal 500 (daily instead of weekly).
-- 2. Claiming (service_role only, claim_signal_monitors): due rows locked FOR UPDATE SKIP LOCKED, one signal_run per
--    prospect and per day (idempotency key) with a 10-minute lease. Two crons at once never create a duplicate run; a
--    run whose lease expired is taken again (3 attempts, then failed). A monitor whose asker left the organization, or
--    has not signed in for 30 days, is paused instead of run: no cost without a user.
-- 3. save_signals is split: the checks and the insertion move to prospectos_private.save_signals_core, called by the
--    member path (public.save_signals, unchanged contract) and by the cron path (public.save_monitor_signals,
--    service_role only, bound to a running monitor run and acting as the member who asked).
-- 4. complete_signal_run closes a run with its metrics.
--
-- Rollback: drop functions public.set_prospect_monitoring(uuid,boolean), public.claim_signal_monitors(int),
-- public.save_monitor_signals(uuid,jsonb), public.complete_signal_run(uuid,text,jsonb,text),
-- prospectos_private.save_signals_core(uuid,uuid,uuid,uuid,jsonb,uuid); drop table public.monitored_prospects;
-- re-create public.save_signals from 024.
begin;

create or replace function prospectos_private.save_signals_core(p_tenant uuid, p_project uuid, p_prospect uuid, p_run uuid, p_signals jsonb, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; inserted int:=0; duplicates int:=0; row_id uuid; terms text[]; ed date; pa timestamptz; oa timestamptz;
 allowed text[]:=array['provider','signal_type','title','excerpt','source_url','source_type','event_date','published_at','observed_at','matched_terms','content_hash','event_key','raw_metadata'];
begin
 perform pg_advisory_xact_lock(hashtextextended('signals:'||p_prospect::text,0));
 if jsonb_typeof(p_signals)<>'array' or jsonb_array_length(p_signals) not between 1 and 40 then raise exception 'Invalid signals' using errcode='22023'; end if;
 if p_run is not null and not exists(select 1 from public.signal_runs r where r.id=p_run and r.organization_id=p_tenant and r.project_id=p_project and p_prospect=any(r.prospect_ids)) then
  raise exception 'Signal run not found' using errcode='P0002';
 end if;
 for item in select value from jsonb_array_elements(p_signals) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where not k=any(allowed)) then raise exception 'Unknown signal field' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(item->'matched_terms','[]'))<>'array' or jsonb_array_length(coalesce(item->'matched_terms','[]'))>20
     or exists(select 1 from jsonb_array_elements(coalesce(item->'matched_terms','[]')) t where jsonb_typeof(t)<>'string' or length(t#>>'{}') not between 1 and 80) then
   raise exception 'Invalid signal' using errcode='22023';
  end if;
  select coalesce(array_agg(t),'{}') into terms from jsonb_array_elements_text(coalesce(item->'matched_terms','[]')) t;
  begin
   ed:=nullif(item->>'event_date','')::date; pa:=nullif(item->>'published_at','')::timestamptz; oa:=(item->>'observed_at')::timestamptz;
  exception when others then raise exception 'Invalid signal date' using errcode='22023';
  end;
  if oa is null or oa>now()+interval '5 minutes' then raise exception 'Invalid signal date' using errcode='22023'; end if;
  -- The same event already known for this prospect (from any source, any status but rejected) is not added twice.
  if exists(select 1 from public.signals s where s.prospect_id=p_prospect and s.event_key=item->>'event_key' and s.status<>'REJECTED') then
   duplicates:=duplicates+1; continue;
  end if;
  insert into public.signals(organization_id,project_id,prospect_id,signal_run_id,provider,signal_type,title,excerpt,source_url,source_type,
   event_date,published_at,observed_at,confidence,matched_terms,content_hash,event_key,raw_metadata,purge_after)
  values(p_tenant,p_project,p_prospect,p_run,item->>'provider',item->>'signal_type',trim(item->>'title'),trim(item->>'excerpt'),item->>'source_url',item->>'source_type',
   ed,pa,oa,prospectos_private.signal_confidence(item->>'source_type',ed,pa),terms,item->>'content_hash',item->>'event_key',coalesce(item->'raw_metadata','{}'),now()+interval '60 days')
  on conflict(prospect_id,source_url,content_hash) do nothing returning id into row_id;
  if row_id is null then duplicates:=duplicates+1; else inserted:=inserted+1; end if;
  row_id:=null;
 end loop;
 if inserted>0 then
  insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
  values(p_tenant,p_prospect,p_actor,'signals.saved',jsonb_build_object('inserted',inserted,'duplicates',duplicates,'signal_run_id',p_run));
 end if;
 return jsonb_build_object('inserted',inserted,'duplicates',duplicates);
end $$;
revoke all on function prospectos_private.save_signals_core(uuid,uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;

-- The member path: same contract as 024 (membership, then the shared core acting as the caller).
create or replace function public.save_signals(p_prospect_id uuid, p_run_id uuid, p_signals jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid;
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 return prospectos_private.save_signals_core(tenant,project,p_prospect_id,p_run_id,p_signals,auth.uid());
end $$;
revoke all on function public.save_signals(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_signals(uuid,uuid,jsonb) to authenticated;

create table if not exists public.monitored_prospects (
 prospect_id uuid primary key,
 organization_id uuid not null,
 project_id uuid not null,
 created_by uuid not null references auth.users(id),
 frequency_days int not null check(frequency_days in (1,7)),
 next_run_at timestamptz not null default now(),
 last_run_at timestamptz,
 paused_reason text check(paused_reason is null or paused_reason in ('inactive','member_left')),
 created_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id),
 foreign key(project_id,organization_id) references public.projects(id,organization_id)
);
create index if not exists monitored_prospects_due_idx on public.monitored_prospects(next_run_at) where paused_reason is null;
create index if not exists monitored_prospects_tenant_idx on public.monitored_prospects(organization_id);
alter table public.monitored_prospects enable row level security;
create policy monitored_prospects_read on public.monitored_prospects for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.monitored_prospects from public,anon,authenticated;
grant select on public.monitored_prospects to authenticated;

-- How many prospects an organization may monitor, from the asker's effective plan (trial 0, Solo 10, Pro 50, Team 50
-- per seat, Enterprise / internal 500), and how often.
create or replace function prospectos_private.monitoring_allowance(p_entitlement jsonb) returns table(cap int, frequency_days int)
language sql stable set search_path='' as $$
 select case when p_entitlement is null or p_entitlement->>'status'<>'ACTIVE' or (p_entitlement->>'expires_at')::timestamptz<=now() then 0
   else case p_entitlement->>'plan' when 'PAID' then 10 when 'PRO' then 50 when 'TEAM' then 50*greatest(1,coalesce((p_entitlement->>'seats')::int,1))
   when 'ENTERPRISE' then 500 when 'INTERNAL' then 500 else 0 end end,
  case when p_entitlement->>'plan' in ('ENTERPRISE','INTERNAL') then 1 else 7 end
$$;
revoke all on function prospectos_private.monitoring_allowance(jsonb) from public,anon,authenticated;

-- A member starts or stops monitoring a prospect of its organization. Starting again un-pauses it, on the caller.
create or replace function public.set_prospect_monitoring(p_prospect_id uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid; allowance record; used int; r public.monitored_prospects;
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform pg_advisory_xact_lock(hashtextextended('monitoring:'||tenant::text,0));
 if not coalesce(p_enabled,false) then
  delete from public.monitored_prospects where prospect_id=p_prospect_id;
  if found then insert into public.events(organization_id,prospect_id,actor_id,kind,payload) values(tenant,p_prospect_id,auth.uid(),'monitoring.stopped','{}'); end if;
  return jsonb_build_object('monitored',false);
 end if;
 select * into allowance from prospectos_private.monitoring_allowance(public.get_effective_entitlement());
 select count(*) into used from public.monitored_prospects where organization_id=tenant and prospect_id<>p_prospect_id;
 if used>=allowance.cap then raise exception 'monitoring_limit_reached' using errcode='P0001'; end if;
 insert into public.monitored_prospects(prospect_id,organization_id,project_id,created_by,frequency_days,next_run_at)
 values(p_prospect_id,tenant,project,auth.uid(),allowance.frequency_days,now())
 on conflict(prospect_id) do update set created_by=excluded.created_by,frequency_days=excluded.frequency_days,paused_reason=null,
  next_run_at=least(public.monitored_prospects.next_run_at,now()+make_interval(days=>excluded.frequency_days))
 returning * into r;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload) values(tenant,p_prospect_id,auth.uid(),'monitoring.started',jsonb_build_object('frequency_days',r.frequency_days));
 return jsonb_build_object('monitored',true,'frequency_days',r.frequency_days,'next_run_at',r.next_run_at,'cap',allowance.cap,'used',used+1);
end $$;
revoke all on function public.set_prospect_monitoring(uuid,boolean) from public,anon;
grant execute on function public.set_prospect_monitoring(uuid,boolean) to authenticated;

-- Server only: claims at most p_limit runs. Expired leases first (retried up to 3 attempts, then failed), then due
-- monitors (locked, skipped when another claim holds them). One run per prospect and per day.
create or replace function public.claim_signal_monitors(p_limit int) returns table(run_id uuid, prospect_id uuid, organization_id uuid, created_by uuid)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare m record; rid uuid; taken int:=0;
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid limit' using errcode='22023'; end if;
 update public.signal_runs set status='failed',error_code='LEASE_EXPIRED',completed_at=now()
  where trigger='monitor' and status='running' and lease_until<now() and attempts>=3;
 for m in select r.id,r.prospect_ids[1] pid,r.organization_id org,r.created_by who from public.signal_runs r
   where r.trigger='monitor' and r.status='running' and r.lease_until<now() and r.attempts<3
   order by r.lease_until limit p_limit for update skip locked loop
  update public.signal_runs set attempts=attempts+1,lease_until=now()+interval '10 minutes' where id=m.id;
  run_id:=m.id;prospect_id:=m.pid;organization_id:=m.org;created_by:=m.who;taken:=taken+1;return next;
 end loop;
 -- No cost without a user: the asker left the organization, or has not signed in for 30 days.
 -- A user who came back resumes their paused monitors on their own.
 update public.monitored_prospects mp set paused_reason=null,next_run_at=least(mp.next_run_at,now())
  where mp.paused_reason='inactive' and exists(select 1 from auth.users u where u.id=mp.created_by and coalesce(u.last_sign_in_at,u.created_at)>=now()-interval '30 days');
 update public.monitored_prospects mp set paused_reason='member_left'
  where mp.paused_reason is null and not exists(select 1 from public.memberships ms where ms.organization_id=mp.organization_id and ms.user_id=mp.created_by);
 update public.monitored_prospects mp set paused_reason='inactive'
  where mp.paused_reason is null and exists(select 1 from auth.users u where u.id=mp.created_by and coalesce(u.last_sign_in_at,u.created_at)<now()-interval '30 days');
 for m in select mp.* from public.monitored_prospects mp where mp.paused_reason is null and mp.next_run_at<=now()
   order by mp.next_run_at limit greatest(p_limit-taken,0) for update skip locked loop
  insert into public.signal_runs(organization_id,project_id,trigger,prospect_ids,status,idempotency_key,lease_until,attempts,created_by,started_at)
  values(m.organization_id,m.project_id,'monitor',array[m.prospect_id],'running','monitor:'||m.prospect_id::text||':'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),
   now()+interval '10 minutes',1,m.created_by,now())
  on conflict(idempotency_key) do nothing returning id into rid;
  update public.monitored_prospects set next_run_at=now()+make_interval(days=>m.frequency_days),last_run_at=now() where monitored_prospects.prospect_id=m.prospect_id;
  if rid is not null then run_id:=rid;prospect_id:=m.prospect_id;organization_id:=m.organization_id;created_by:=m.created_by;return next;end if;
  rid:=null;
 end loop;
end $$;
revoke all on function public.claim_signal_monitors(int) from public,anon,authenticated;
grant execute on function public.claim_signal_monitors(int) to service_role;

-- Server only: the signals one running monitor run found, saved as the member who asked for the monitoring.
create or replace function public.save_monitor_signals(p_run_id uuid, p_signals jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.signal_runs;
begin
 select * into r from public.signal_runs where id=p_run_id and trigger='monitor' and status='running' and lease_until>=now();
 if not found then raise exception 'Signal run not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.memberships where organization_id=r.organization_id and user_id=r.created_by) then
  raise exception 'Authenticated tenant member required' using errcode='42501';
 end if;
 return prospectos_private.save_signals_core(r.organization_id,r.project_id,r.prospect_ids[1],r.id,p_signals,r.created_by);
end $$;
revoke all on function public.save_monitor_signals(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_monitor_signals(uuid,jsonb) to service_role;

-- Server only: closes a running run with its metrics (codes and counts only).
create or replace function public.complete_signal_run(p_run_id uuid, p_status text, p_metrics jsonb, p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('completed','partial','failed') or jsonb_typeof(coalesce(p_metrics,'{}'))<>'object' or length(coalesce(p_metrics,'{}')::text)>4096 then
  raise exception 'Invalid run result' using errcode='22023';
 end if;
 update public.signal_runs set status=p_status,metrics=coalesce(p_metrics,'{}'),error_code=left(nullif(p_error,''),60),completed_at=now(),lease_until=null
  where id=p_run_id and status='running';
 return found;
end $$;
revoke all on function public.complete_signal_run(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_signal_run(uuid,text,jsonb,text) to service_role;

commit;
