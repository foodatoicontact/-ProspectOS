-- Next Best Action V1 (docs/NEXT_BEST_ACTION.md). Additive only: no existing table, column, value, policy or function is
-- changed. Nothing here sends, posts or contacts anyone.
--
-- 1. public.nba_actions — one recommendation for one prospect, as it was computed (src/nba/engine.ts): the action
--    (CONTACT / ENGAGE / WATCH / WAIT / DISMISS), the rule that decided it, every score with its lines, the explanation
--    (each sentence: fact / inference / unknown / rule, with the ids of its proof), the target role (a person only when
--    a VERIFIED public content names its author), the prepared draft, the config version. That snapshot is IMMUTABLE
--    (trigger): a later recomputation creates a new row, it never rewrites an old one.
--    Only the human side changes: state (PENDING → APPROVED / DONE / SNOOZED / REJECTED, EXPIRED by time), the action
--    the person actually took, the outcome. One open (PENDING / SNOOZED / APPROVED) action per prospect.
-- 2. public.nba_action_events — every state change, who, when, why: the history of human decisions, append-only.
-- 3. Functions (members of the prospect's organization; security definer, empty search_path):
--    save_nba_actions — stores computed recommendations; every referenced signal, public content and evidence must
--      belong to that prospect (a REJECTED signal or an unreviewed public content is refused);
--    decide_nba_action — the human decision, transitions checked here;
--    record_nba_outcome — what happened after a DONE action (feedback loop, no model);
--    refresh_nba_states — EXPIRED when the reason stopped counting, SNOOZED back to PENDING when the snooze ends.
--    No client writes the tables directly; members read through RLS.
--
-- Rollback: drop function public.save_nba_actions(uuid,jsonb), public.decide_nba_action(uuid,text,text,timestamptz,text),
-- public.record_nba_outcome(uuid,text,text), public.refresh_nba_states(uuid), prospectos_private.guard_nba_action();
-- drop table public.nba_action_events, public.nba_actions.
begin;

create table if not exists public.nba_actions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 prospect_id uuid not null,
 recommended_action text not null check(recommended_action in ('CONTACT','ENGAGE','WATCH','WAIT','DISMISS')),
 rule text not null check(rule ~ '^[A-Z_]{3,40}$'),
 state text not null default 'PENDING' check(state in ('PENDING','APPROVED','DONE','SNOOZED','REJECTED','EXPIRED')),
 opportunity_score int not null check(opportunity_score between 0 and 100),
 fit_score int check(fit_score is null or fit_score between 0 and 100),
 fit_basis text not null check(fit_basis in ('verified','estimated','unknown')),
 intent_score int not null check(intent_score between 0 and 100),
 timing_score int not null check(timing_score between 0 and 100),
 freshness_score int not null check(freshness_score between 0 and 100),
 evidence_quality_score int not null check(evidence_quality_score between 0 and 100),
 scores jsonb not null check(jsonb_typeof(scores)='object' and length(scores::text)<=16384),
 primary_kind text check(primary_kind is null or primary_kind in ('signal','conversation')),
 primary_signal_type text check(primary_signal_type is null or primary_signal_type ~ '^[A-Z_]{3,40}$'),
 primary_evidence_status text check(primary_evidence_status is null or primary_evidence_status in ('VERIFIED','INFERRED')),
 signal_age_days int check(signal_age_days is null or signal_age_days>=0),
 primary_detail jsonb check(primary_detail is null or (jsonb_typeof(primary_detail)='object' and length(primary_detail::text)<=4096)),
 signal_ids jsonb not null default '[]' check(jsonb_typeof(signal_ids)='array' and jsonb_array_length(signal_ids)<=20),
 public_content_ids jsonb not null default '[]' check(jsonb_typeof(public_content_ids)='array' and jsonb_array_length(public_content_ids)<=5),
 evidence_ids jsonb not null default '[]' check(jsonb_typeof(evidence_ids)='array' and jsonb_array_length(evidence_ids)<=50),
 target jsonb not null check(jsonb_typeof(target)='object' and length(target::text)<=2048),
 explanation jsonb not null check(jsonb_typeof(explanation)='object' and length(explanation::text)<=16384),
 prepared_content jsonb not null default '{"kind":"none","reason":"NOT_PREPARED"}' check(jsonb_typeof(prepared_content)='object' and length(prepared_content::text)<=8192),
 fingerprint text not null check(length(fingerprint) between 3 and 120),
 config_version text not null check(config_version ~ '^[a-z0-9._-]{1,40}$'),
 computed_at timestamptz not null,
 expires_at timestamptz not null,
 snoozed_until timestamptz,
 human_action text check(human_action is null or human_action in ('CONTACT','ENGAGE','WATCH','WAIT','DISMISS','OTHER')),
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 outcome text check(outcome is null or outcome in ('NO_RESPONSE','REPLIED','POSITIVE','MEETING','OPPORTUNITY','PAID','NOT_INTERESTED')),
 outcome_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id) on delete cascade,
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,organization_id),
 check((state='SNOOZED')=(snoozed_until is not null)),
 check(outcome is null or state='DONE'),
 check((outcome is null)=(outcome_at is null)),
 check(expires_at>computed_at)
);
-- One open recommendation per prospect: a new one replaces a PENDING / SNOOZED one (EXPIRED, "superseded"), never an
-- APPROVED one (a person already said yes to it).
create unique index if not exists nba_actions_one_open on public.nba_actions(prospect_id) where state in ('PENDING','SNOOZED','APPROVED');
create index if not exists nba_actions_queue_idx on public.nba_actions(organization_id,project_id,state,recommended_action,opportunity_score desc);
create index if not exists nba_actions_prospect_idx on public.nba_actions(prospect_id,created_at desc);
alter table public.nba_actions enable row level security;
drop policy if exists nba_actions_read on public.nba_actions;
create policy nba_actions_read on public.nba_actions for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.nba_actions from public,anon,authenticated;
grant select on public.nba_actions to authenticated;

create table if not exists public.nba_action_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 action_id uuid not null,
 from_state text check(from_state is null or from_state in ('PENDING','APPROVED','DONE','SNOOZED','REJECTED','EXPIRED')),
 to_state text not null check(to_state in ('PENDING','APPROVED','DONE','SNOOZED','REJECTED','EXPIRED')),
 kind text not null check(kind in ('created','decision','expired','superseded','unsnoozed','outcome')),
 recommended_action text not null check(recommended_action in ('CONTACT','ENGAGE','WATCH','WAIT','DISMISS')),
 human_action text check(human_action is null or human_action in ('CONTACT','ENGAGE','WATCH','WAIT','DISMISS','OTHER')),
 outcome text check(outcome is null or outcome in ('NO_RESPONSE','REPLIED','POSITIVE','MEETING','OPPORTUNITY','PAID','NOT_INTERESTED')),
 reason text check(reason is null or length(reason)<=500),
 actor_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(action_id,organization_id) references public.nba_actions(id,organization_id) on delete cascade
);
create index if not exists nba_action_events_action_idx on public.nba_action_events(action_id,created_at);
alter table public.nba_action_events enable row level security;
drop policy if exists nba_action_events_read on public.nba_action_events;
create policy nba_action_events_read on public.nba_action_events for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.nba_action_events from public,anon,authenticated;
grant select on public.nba_action_events to authenticated;

-- What was computed never changes: only the human side may.
create or replace function prospectos_private.guard_nba_action() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'state'-'snoozed_until'-'human_action'-'decided_by'-'decided_at'-'outcome'-'outcome_at'-'updated_at')
    is distinct from (to_jsonb(old)-'state'-'snoozed_until'-'human_action'-'decided_by'-'decided_at'-'outcome'-'outcome_at'-'updated_at') then
  raise exception 'A recommendation is immutable once computed: only the human decision may change' using errcode='42501';
 end if;
 if old.state in ('DONE','REJECTED','EXPIRED') and new.state is distinct from old.state then
  raise exception 'Terminal recommendation state' using errcode='42501';
 end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function prospectos_private.guard_nba_action() from public,anon,authenticated;
drop trigger if exists nba_action_guard on public.nba_actions;
create trigger nba_action_guard before update on public.nba_actions for each row execute function prospectos_private.guard_nba_action();

-- p_items: [{prospect_id, recommended_action, rule, scores:{fit:{score,basis,...},intent:{score},timing:{score},freshness:{score},
--   evidence_quality:{score},opportunity:{score}}, primary:null|{kind,...}, signal_ids, public_content_ids, evidence_ids,
--   target, explanation, prepared_content, fingerprint, config_version, computed_at, expires_at}]
-- Returns {"created": n, "unchanged": n, "superseded": n, "kept_approved": n}.
create or replace function public.save_nba_actions(p_project_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; item jsonb; pid uuid; open_row record; created int:=0; unchanged int:=0; superseded int:=0; kept int:=0; new_id uuid;
 sc jsonb; prim jsonb; computed timestamptz; expires timestamptz;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>500 then raise exception 'Invalid recommendations' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in
     ('prospect_id','recommended_action','rule','scores','primary','signal_ids','public_content_ids','evidence_ids','target','explanation','prepared_content','fingerprint','config_version','computed_at','expires_at'))
  then raise exception 'Invalid recommendation' using errcode='22023'; end if;
  pid:=(item->>'prospect_id')::uuid;
  if not exists(select 1 from public.prospects p where p.id=pid and p.project_id=p_project_id and p.organization_id=tenant) then
   raise exception 'Prospect not found' using errcode='P0002'; end if;
  sc:=item->'scores';prim:=item->'primary';
  if jsonb_typeof(sc)<>'object' or jsonb_typeof(sc->'opportunity')<>'object' or jsonb_typeof(sc->'fit')<>'object' then raise exception 'Invalid scores' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(item->'signal_ids','[]'))<>'array' or jsonb_typeof(coalesce(item->'public_content_ids','[]'))<>'array' or jsonb_typeof(coalesce(item->'evidence_ids','[]'))<>'array' then
   raise exception 'Invalid references' using errcode='22023'; end if;
  -- Every proof belongs to this prospect; a rejected signal or an unreviewed public content is never a reason.
  if exists(select 1 from jsonb_array_elements_text(coalesce(item->'signal_ids','[]')) s
            where not exists(select 1 from public.signals x where x.id=s::uuid and x.prospect_id=pid and x.organization_id=tenant and x.status<>'REJECTED')) then
   raise exception 'Invalid signal reference' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(item->'public_content_ids','[]')) c
            where not exists(select 1 from public.prospect_public_content x where x.id=c::uuid and x.prospect_id=pid and x.organization_id=tenant and x.status='VERIFIED')) then
   raise exception 'Invalid public content reference' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(item->'evidence_ids','[]')) e
            where not exists(select 1 from public.evidence x where x.id=e::uuid and x.prospect_id=pid and x.organization_id=tenant)) then
   raise exception 'Invalid evidence reference' using errcode='22023'; end if;
  if prim is not null and jsonb_typeof(prim)='object' and prim->>'kind'='signal' and not ((item->'signal_ids') ? (prim->>'signal_id')) then
   raise exception 'Invalid primary signal' using errcode='22023'; end if;
  if prim is not null and jsonb_typeof(prim)='object' and prim->>'kind'='conversation' and not ((item->'public_content_ids') ? (prim->>'content_id')) then
   raise exception 'Invalid primary content' using errcode='22023'; end if;
  computed:=(item->>'computed_at')::timestamptz;expires:=(item->>'expires_at')::timestamptz;
  if computed>now()+interval '5 minutes' or computed<now()-interval '1 day' then raise exception 'Invalid computation time' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nba:'||pid::text,0));
  select id,state,fingerprint,recommended_action into open_row from public.nba_actions where prospect_id=pid and state in ('PENDING','SNOOZED','APPROVED');
  if found then
   if open_row.fingerprint=item->>'fingerprint' then unchanged:=unchanged+1; continue; end if;
   if open_row.state='APPROVED' then kept:=kept+1; continue; end if;
   update public.nba_actions set state='EXPIRED',snoozed_until=null where id=open_row.id;
   insert into public.nba_action_events(organization_id,action_id,from_state,to_state,kind,recommended_action,reason,actor_id)
   values(tenant,open_row.id,open_row.state,'EXPIRED','superseded',open_row.recommended_action,'Nouvelle recommandation calculée',auth.uid());
   superseded:=superseded+1;
  end if;
  insert into public.nba_actions(organization_id,project_id,prospect_id,recommended_action,rule,opportunity_score,fit_score,fit_basis,intent_score,timing_score,
   freshness_score,evidence_quality_score,scores,primary_kind,primary_signal_type,primary_evidence_status,signal_age_days,primary_detail,signal_ids,public_content_ids,
   evidence_ids,target,explanation,prepared_content,fingerprint,config_version,computed_at,expires_at,created_by)
  values(tenant,p_project_id,pid,item->>'recommended_action',item->>'rule',(sc->'opportunity'->>'score')::int,(sc->'fit'->>'score')::int,coalesce(sc->'fit'->>'basis','unknown'),
   (sc->'intent'->>'score')::int,(sc->'timing'->>'score')::int,(sc->'freshness'->>'score')::int,(sc->'evidence_quality'->>'score')::int,sc,
   case when jsonb_typeof(prim)='object' then prim->>'kind' end,
   case when jsonb_typeof(prim)='object' and prim->>'kind'='signal' then prim->>'commercial_type' end,
   case when jsonb_typeof(prim)='object' and prim->>'kind'='signal' then prim->>'evidence_status' end,
   case when jsonb_typeof(prim)='object' then (prim->>'age_days')::int end,
   case when jsonb_typeof(prim)='object' then prim end,
   coalesce(item->'signal_ids','[]'),coalesce(item->'public_content_ids','[]'),coalesce(item->'evidence_ids','[]'),item->'target',item->'explanation',
   coalesce(item->'prepared_content','{"kind":"none","reason":"NOT_PREPARED"}'),item->>'fingerprint',item->>'config_version',computed,expires,auth.uid())
  returning id into new_id;
  insert into public.nba_action_events(organization_id,action_id,from_state,to_state,kind,recommended_action,actor_id)
  values(tenant,new_id,null,'PENDING','created',item->>'recommended_action',auth.uid());
  created:=created+1;
 end loop;
 return jsonb_build_object('created',created,'unchanged',unchanged,'superseded',superseded,'kept_approved',kept);
end $$;
revoke all on function public.save_nba_actions(uuid,jsonb) from public,anon;
grant execute on function public.save_nba_actions(uuid,jsonb) to authenticated;

-- The human decision. Transitions (same table as src/nba/engine.ts TRANSITIONS): PENDING → APPROVED / DONE / SNOOZED /
-- REJECTED; APPROVED → DONE / REJECTED; SNOOZED → PENDING / REJECTED. DONE, REJECTED, EXPIRED are terminal.
-- p_human_action: what the person actually did (may differ from the recommendation — that difference is the feedback).
create or replace function public.decide_nba_action(p_action_id uuid, p_decision text, p_reason text default null, p_snooze_until timestamptz default null, p_human_action text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record;
begin
 select * into a from public.nba_actions where id=p_action_id for update;
 if a.id is null then raise exception 'Recommendation not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(a.organization_id);
 if p_decision not in ('APPROVED','DONE','SNOOZED','REJECTED','PENDING') then raise exception 'Invalid decision' using errcode='22023'; end if;
 if p_reason is not null and length(p_reason)>500 then raise exception 'Invalid reason' using errcode='22023'; end if;
 if p_human_action is not null and p_human_action not in ('CONTACT','ENGAGE','WATCH','WAIT','DISMISS','OTHER') then raise exception 'Invalid human action' using errcode='22023'; end if;
 if a.state in ('PENDING','SNOOZED','APPROVED') and a.expires_at<=now() and p_decision<>'REJECTED' then raise exception 'RECOMMENDATION_EXPIRED' using errcode='22023'; end if;
 if not ((a.state='PENDING' and p_decision in ('APPROVED','DONE','SNOOZED','REJECTED'))
      or (a.state='APPROVED' and p_decision in ('DONE','REJECTED'))
      or (a.state='SNOOZED' and p_decision in ('PENDING','REJECTED'))) then
  raise exception 'INVALID_TRANSITION' using errcode='22023'; end if;
 if p_decision='SNOOZED' and (p_snooze_until is null or p_snooze_until<=now() or p_snooze_until>now()+interval '90 days') then
  raise exception 'Invalid snooze' using errcode='22023'; end if;
 update public.nba_actions set state=p_decision,snoozed_until=case when p_decision='SNOOZED' then p_snooze_until end,
  human_action=coalesce(p_human_action,human_action),decided_by=auth.uid(),decided_at=now() where id=a.id;
 insert into public.nba_action_events(organization_id,action_id,from_state,to_state,kind,recommended_action,human_action,reason,actor_id)
 values(a.organization_id,a.id,a.state,p_decision,'decision',a.recommended_action,p_human_action,p_reason,auth.uid());
 return jsonb_build_object('id',a.id,'state',p_decision);
end $$;
revoke all on function public.decide_nba_action(uuid,text,text,timestamptz,text) from public,anon;
grant execute on function public.decide_nba_action(uuid,text,text,timestamptz,text) to authenticated;

-- What happened after the action was DONE. Kept for analysis (which signals, scores, actions convert); no model.
create or replace function public.record_nba_outcome(p_action_id uuid, p_outcome text, p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record;
begin
 select * into a from public.nba_actions where id=p_action_id for update;
 if a.id is null then raise exception 'Recommendation not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(a.organization_id);
 if p_outcome not in ('NO_RESPONSE','REPLIED','POSITIVE','MEETING','OPPORTUNITY','PAID','NOT_INTERESTED') then raise exception 'Invalid outcome' using errcode='22023'; end if;
 if a.state<>'DONE' then raise exception 'OUTCOME_REQUIRES_DONE' using errcode='22023'; end if;
 if p_note is not null and length(p_note)>500 then raise exception 'Invalid reason' using errcode='22023'; end if;
 update public.nba_actions set outcome=p_outcome,outcome_at=now() where id=a.id;
 insert into public.nba_action_events(organization_id,action_id,from_state,to_state,kind,recommended_action,human_action,outcome,reason,actor_id)
 values(a.organization_id,a.id,'DONE','DONE','outcome',a.recommended_action,a.human_action,p_outcome,p_note,auth.uid());
 return jsonb_build_object('id',a.id,'outcome',p_outcome);
end $$;
revoke all on function public.record_nba_outcome(uuid,text,text) from public,anon;
grant execute on function public.record_nba_outcome(uuid,text,text) to authenticated;

-- Time: an open recommendation whose reason stopped counting is EXPIRED; a snooze that ended returns to PENDING.
create or replace function public.refresh_nba_states(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; r record; expired int:=0; woke int:=0;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 for r in select id,state,recommended_action from public.nba_actions where project_id=p_project_id and organization_id=tenant
          and state in ('PENDING','SNOOZED','APPROVED') and expires_at<=now() for update loop
  update public.nba_actions set state='EXPIRED',snoozed_until=null where id=r.id;
  insert into public.nba_action_events(organization_id,action_id,from_state,to_state,kind,recommended_action,reason,actor_id)
  values(tenant,r.id,r.state,'EXPIRED','expired',r.recommended_action,'La raison d’agir ne compte plus',auth.uid());
  expired:=expired+1;
 end loop;
 for r in select id,recommended_action from public.nba_actions where project_id=p_project_id and organization_id=tenant and state='SNOOZED' and snoozed_until<=now() for update loop
  update public.nba_actions set state='PENDING',snoozed_until=null where id=r.id;
  insert into public.nba_action_events(organization_id,action_id,from_state,to_state,kind,recommended_action,reason,actor_id)
  values(tenant,r.id,'SNOOZED','PENDING','unsnoozed',r.recommended_action,'Fin du report',auth.uid());
  woke:=woke+1;
 end loop;
 return jsonb_build_object('expired',expired,'unsnoozed',woke);
end $$;
revoke all on function public.refresh_nba_states(uuid) from public,anon;
grant execute on function public.refresh_nba_states(uuid) to authenticated;

commit;
