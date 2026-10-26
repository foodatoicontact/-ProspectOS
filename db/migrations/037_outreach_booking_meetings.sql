-- Self-Outreach — booking link and meetings (docs/SELF_OUTREACH.md §9). Goal: measure what the engine is for, meetings
-- in a calendar, and shorten the path from a positive reply to a booked slot without ever answering automatically.
--
-- 1. public.outreach_campaigns.booking_url — the campaign's own scheduling page (https only, set by a member).
-- 2. outreach_messages kind BOOKING (sequence 3): ONE reply per candidate carrying the booking link, drafted only when a
--    person has set the outcome POSITIVE on a REPLIED candidate. It follows the same rules as every message: a person
--    approves it, the approved text must still contain the campaign's booking link, suppression is checked at approval,
--    at claim and right before SMTP, and it is re-checked that the outcome is still POSITIVE at each of those steps. It
--    is sent in the prospect's thread (In-Reply-To = the prospect's own reply when its Message-ID is known). It does not
--    consume the daily cap of NEW outreach: its volume is bounded by the positive replies themselves (one per candidate).
--    A follow-up is never drafted after a reply (unchanged), so FOLLOW_UP and BOOKING never coexist on a candidate.
-- 3. public.outreach_meetings — a meeting recorded by a person (MANUAL source only in this version): SCHEDULED, then
--    HELD / NO_SHOW (only once its time has passed) or CANCELLED. One SCHEDULED meeting per candidate. HELD sets the
--    candidate's DEMO milestone (demo_at) to the meeting time if it was not already set. A meeting needs a real reply
--    (reply_status REPLIED): no meeting is ever invented from a send.
-- 4. outreach_metrics keeps every existing key unchanged and adds 'meetings' and 'last_30_days'.
-- 5. set_outreach_outcome: an outcome other than POSITIVE cancels a pending BOOKING draft (nothing else changes).
--
-- Replaced functions (same signature, same grants, bodies copied from 035 with only the BOOKING branches added):
-- review_outreach_message, set_outreach_outcome, outreach_metrics, claim_outreach_sends, outreach_send_permitted.
-- Not touched: evidence, signals, billing, entitlements, memberships, suppressions' rules, complete_outreach_send,
-- record_outreach_inbound, follow-up functions.
--
-- Rollback: drop function public.create_outreach_booking_reply(uuid,text,text), public.set_outreach_campaign_booking(uuid,text),
-- public.record_outreach_meeting(uuid,timestamptz), public.set_outreach_meeting_status(uuid,text); drop table
-- public.outreach_meetings; update public.outreach_messages set send_status='CANCELLED' where kind='BOOKING' and
-- send_status in ('DRAFT','READY'); re-run the five function bodies of 035; restore the kind / sequence checks of 035 only
-- once no BOOKING row remains; alter table public.outreach_campaigns drop column booking_url.
begin;

-- ------------------------------------------------------------
-- Schema
-- ------------------------------------------------------------
alter table public.outreach_campaigns add column if not exists booking_url text;
alter table public.outreach_campaigns drop constraint if exists outreach_campaigns_booking_url_check;
alter table public.outreach_campaigns add constraint outreach_campaigns_booking_url_check
 -- https, a host, an optional path of URL characters only, and no trailing punctuation (a sentence's full stop after the
 -- link must never become part of it — the same reading as src/self-outreach/booking.ts and the fact guard).
 check(booking_url is null or (length(booking_url) between 12 and 300 and booking_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[A-Za-z0-9._~%/?#&=+@:-]*)?$'
  and booking_url !~ '[.,;:!?]$'));

alter table public.outreach_messages drop constraint if exists outreach_messages_kind_check;
alter table public.outreach_messages add constraint outreach_messages_kind_check check(kind in ('INITIAL','FOLLOW_UP','BOOKING'));
alter table public.outreach_messages drop constraint if exists outreach_messages_sequence_check;
alter table public.outreach_messages add constraint outreach_messages_sequence_check check(sequence between 0 and 3);
alter table public.outreach_messages drop constraint if exists outreach_messages_booking_sequence_check;
alter table public.outreach_messages add constraint outreach_messages_booking_sequence_check check((sequence=3)=(kind='BOOKING'));

create table if not exists public.outreach_meetings (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 candidate_id uuid not null,
 scheduled_for timestamptz not null,
 status text not null default 'SCHEDULED' check(status in ('SCHEDULED','HELD','NO_SHOW','CANCELLED')),
 source text not null default 'MANUAL' check(source in ('MANUAL')),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 status_by uuid references auth.users(id),
 status_at timestamptz,
 foreign key(candidate_id,organization_id) references public.outreach_candidates(id,organization_id) on delete cascade,
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 check((status='SCHEDULED')=(status_at is null))
);
create unique index if not exists outreach_meetings_one_scheduled on public.outreach_meetings(candidate_id) where status='SCHEDULED';
create index if not exists outreach_meetings_project_idx on public.outreach_meetings(project_id,scheduled_for);
alter table public.outreach_meetings enable row level security;
drop policy if exists outreach_meetings_read on public.outreach_meetings;
create policy outreach_meetings_read on public.outreach_meetings for select to authenticated using(prospectos_private.self_outreach_member(organization_id));
revoke all on public.outreach_meetings from public,anon,authenticated;
grant select on public.outreach_meetings to authenticated;

-- ------------------------------------------------------------
-- Members: booking link, booking reply draft, meetings
-- ------------------------------------------------------------
create or replace function public.set_outreach_campaign_booking(p_campaign_id uuid,p_booking_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.outreach_campaigns; u text:=nullif(trim(p_booking_url),'');
begin
 select * into c from public.outreach_campaigns where id=p_campaign_id for update;
 if not found then raise exception 'Campaign not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 perform prospectos_private.require_self_outreach_org(c.organization_id);
 update public.outreach_campaigns set booking_url=u where id=c.id;
 perform prospectos_private.outreach_event(c.organization_id,c.project_id,null,null,'campaign.booking_url',null,null,jsonb_build_object('set',u is not null));
 return jsonb_build_object('campaign_id',c.id,'booking_url',u);
end $$;
revoke all on function public.set_outreach_campaign_booking(uuid,text) from public,anon;
grant execute on function public.set_outreach_campaign_booking(uuid,text) to authenticated;

-- One BOOKING draft per candidate. A cancelled / rejected draft that was never sent is re-opened with the new text (the
-- unique (candidate, sequence) slot is reused); an approved or sent one is never touched.
create or replace function public.create_outreach_booking_reply(p_candidate_id uuid,p_subject text,p_content text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.outreach_candidates; c public.outreach_campaigns; e text; prev public.outreach_messages; row public.outreach_messages;
begin
 select * into k from public.outreach_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(k.organization_id);
 perform prospectos_private.require_self_outreach_org(k.organization_id);
 select * into c from public.outreach_campaigns where id=k.campaign_id;
 if c.status<>'ACTIVE' then raise exception 'outreach_campaign_not_active' using errcode='22023'; end if;
 if c.booking_url is null then raise exception 'outreach_booking_url_missing' using errcode='22023'; end if;
 if k.status<>'REPLIED' or k.reply_status<>'REPLIED' or k.outcome is distinct from 'POSITIVE' then raise exception 'outreach_candidate_not_bookable' using errcode='22023'; end if;
 select email into e from public.outreach_contacts where id=k.contact_id;
 if prospectos_private.outreach_is_suppressed_email(e) then raise exception 'outreach_email_suppressed' using errcode='42501'; end if;
 if p_content is null or length(trim(p_content)) not between 20 and 2000 or p_subject is null or length(trim(p_subject)) not between 3 and 140 then raise exception 'Invalid content' using errcode='22023'; end if;
 if position(c.booking_url in p_content)=0 then raise exception 'outreach_booking_link_missing' using errcode='22023'; end if;
 if prospectos_private.outreach_text_refused(p_content) or prospectos_private.outreach_text_refused(p_subject) then raise exception 'outreach_text_refused' using errcode='22023'; end if;
 select * into prev from public.outreach_messages where candidate_id=k.id and sequence=3 for update;
 if found then
  if prev.review_status='PENDING' and prev.send_status='DRAFT' then return to_jsonb(prev)||jsonb_build_object('already',true); end if;
  if prev.send_status<>'CANCELLED' or prev.sent_at is not null or prev.review_status='APPROVED' then raise exception 'outreach_booking_already_sent' using errcode='22023'; end if;
  update public.outreach_messages set subject=trim(p_subject),generated_content=p_content,human_edit=null,final_content=null,review_status='PENDING',send_status='DRAFT',
   approved_by=null,approved_at=null,rfc_message_id=null,scheduled_for=now(),next_attempt_at=null,attempts=0,last_error_code=null,to_email=e,updated_at=now() where id=prev.id returning * into row;
 else
  insert into public.outreach_messages(organization_id,project_id,candidate_id,sequence,kind,to_email,subject,generated_content,evidence_refs,generation_meta,scheduled_for)
  values(k.organization_id,k.project_id,k.id,3,'BOOKING',e,trim(p_subject),p_content,'{}'::jsonb,jsonb_build_object('generator','self_outreach_booking_v1'),now()) returning * into row;
 end if;
 perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,row.id,'booking.drafted',null,'DRAFT','{}');
 return to_jsonb(row);
end $$;
revoke all on function public.create_outreach_booking_reply(uuid,text,text) from public,anon;
grant execute on function public.create_outreach_booking_reply(uuid,text,text) to authenticated;

create or replace function public.record_outreach_meeting(p_candidate_id uuid,p_scheduled_for timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.outreach_candidates; row public.outreach_meetings;
begin
 select * into k from public.outreach_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(k.organization_id);
 perform prospectos_private.require_self_outreach_org(k.organization_id);
 if k.reply_status<>'REPLIED' then raise exception 'outreach_meeting_needs_reply' using errcode='22023'; end if;
 if p_scheduled_for is null or p_scheduled_for<now()-interval '60 days' or p_scheduled_for>now()+interval '365 days' then raise exception 'outreach_meeting_invalid_time' using errcode='22023'; end if;
 insert into public.outreach_meetings(organization_id,project_id,candidate_id,scheduled_for,created_by) values(k.organization_id,k.project_id,k.id,p_scheduled_for,auth.uid()) returning * into row;
 perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'meeting.scheduled',null,'SCHEDULED',jsonb_build_object('meeting_id',row.id));
 return to_jsonb(row);
end $$;
revoke all on function public.record_outreach_meeting(uuid,timestamptz) from public,anon;
grant execute on function public.record_outreach_meeting(uuid,timestamptz) to authenticated;

create or replace function public.set_outreach_meeting_status(p_meeting_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mt public.outreach_meetings; k public.outreach_candidates;
begin
 select * into mt from public.outreach_meetings where id=p_meeting_id for update;
 if not found then raise exception 'Meeting not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(mt.organization_id);
 perform prospectos_private.require_self_outreach_org(mt.organization_id);
 if p_status not in ('HELD','NO_SHOW','CANCELLED') then raise exception 'Invalid status' using errcode='22023'; end if;
 if mt.status<>'SCHEDULED' then raise exception 'outreach_meeting_not_scheduled' using errcode='22023'; end if;
 if p_status in ('HELD','NO_SHOW') and mt.scheduled_for>now() then raise exception 'outreach_meeting_in_future' using errcode='22023'; end if;
 update public.outreach_meetings set status=p_status,status_by=auth.uid(),status_at=now() where id=mt.id;
 if p_status='HELD' then
  select * into k from public.outreach_candidates where id=mt.candidate_id for update;
  update public.outreach_candidates set demo_at=coalesce(demo_at,mt.scheduled_for),updated_at=now() where id=k.id;
  if k.demo_at is null then perform prospectos_private.outreach_event(mt.organization_id,mt.project_id,mt.candidate_id,null,'milestone.demo',null,null,jsonb_build_object('meeting_id',mt.id)); end if;
 end if;
 perform prospectos_private.outreach_event(mt.organization_id,mt.project_id,mt.candidate_id,null,'meeting.'||lower(p_status),'SCHEDULED',p_status,jsonb_build_object('meeting_id',mt.id));
 return jsonb_build_object('meeting_id',mt.id,'status',p_status);
end $$;
revoke all on function public.set_outreach_meeting_status(uuid,text) from public,anon;
grant execute on function public.set_outreach_meeting_status(uuid,text) to authenticated;

-- ------------------------------------------------------------
-- Replaced (035 bodies + BOOKING branches)
-- ------------------------------------------------------------
create or replace function public.review_outreach_message(p_message_id uuid,p_decision text,p_subject text,p_content text,p_message_domain text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.outreach_messages; k public.outreach_candidates; txt text; prev text; link text;
begin
 select * into m from public.outreach_messages where id=p_message_id for update;
 if not found then raise exception 'Message not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(m.organization_id);
 perform prospectos_private.require_self_outreach_org(m.organization_id);
 select * into k from public.outreach_candidates where id=m.candidate_id for update;
 if p_decision not in ('APPROVE','EDIT','REJECT') then raise exception 'Invalid decision' using errcode='22023'; end if;
 if m.review_status<>'PENDING' or m.send_status<>'DRAFT' then raise exception 'outreach_message_not_reviewable' using errcode='22023'; end if;
 if m.kind='INITIAL' and k.status<>'NEEDS_REVIEW' then raise exception 'outreach_candidate_not_in_review' using errcode='22023'; end if;
 if m.kind='FOLLOW_UP' and (k.status<>'SENT' or k.reply_status<>'NONE') then raise exception 'outreach_candidate_not_followable' using errcode='22023'; end if;
 if m.kind='BOOKING' and p_decision<>'REJECT' and (k.status<>'REPLIED' or k.reply_status<>'REPLIED' or k.outcome is distinct from 'POSITIVE') then raise exception 'outreach_candidate_not_bookable' using errcode='22023'; end if;
 if p_decision='REJECT' then
  update public.outreach_messages set review_status='REJECTED',send_status='CANCELLED',updated_at=now() where id=m.id;
  if m.kind='INITIAL' then
   update public.outreach_candidates set status='REJECTED',review_status='REJECTED',updated_at=now() where id=k.id;
   perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'candidate.rejected',k.status,'REJECTED','{}');
  elsif m.kind='BOOKING' then perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'booking.rejected','DRAFT','CANCELLED','{}');
  else perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'followup.rejected','DRAFT','CANCELLED','{}'); end if;
  return jsonb_build_object('status','REJECTED');
 end if;
 if m.kind='BOOKING' then select booking_url into link from public.outreach_campaigns where id=k.campaign_id; end if;
 if p_decision='EDIT' then
  if p_content is null or length(trim(p_content)) not between 20 and 2000 then raise exception 'Invalid content' using errcode='22023'; end if;
  if prospectos_private.outreach_text_refused(p_content) then raise exception 'outreach_text_refused' using errcode='22023'; end if;
  if m.kind='BOOKING' and (link is null or position(link in p_content)=0) then raise exception 'outreach_booking_link_missing' using errcode='22023'; end if;
  update public.outreach_messages set human_edit=p_content,subject=coalesce(nullif(trim(p_subject),''),subject),updated_at=now() where id=m.id;
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'message.edited',null,null,'{}');
  return jsonb_build_object('status','EDITED');
 end if;
 -- APPROVE
 if prospectos_private.outreach_is_suppressed_email(m.to_email) then raise exception 'outreach_email_suppressed' using errcode='42501'; end if;
 if p_message_domain is null or p_message_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Invalid message domain' using errcode='22023'; end if;
 txt:=coalesce(m.human_edit,m.generated_content);
 if prospectos_private.outreach_text_refused(txt) or prospectos_private.outreach_text_refused(m.subject) then raise exception 'outreach_text_refused' using errcode='22023'; end if;
 -- The campaign's link may have changed since the draft: the approved text must carry the CURRENT one.
 if m.kind='BOOKING' and (link is null or position(link in txt)=0) then raise exception 'outreach_booking_link_missing' using errcode='22023'; end if;
 update public.outreach_messages set review_status='APPROVED',approved_by=auth.uid(),approved_at=now(),final_content=txt,send_status='READY',
  rfc_message_id='<'||gen_random_uuid()::text||'@'||p_message_domain||'>',
  scheduled_for=case when m.kind in ('INITIAL','BOOKING') then now() else greatest(now(),coalesce(m.scheduled_for,now())) end,updated_at=now() where id=m.id;
 if m.kind='INITIAL' then
  prev:=k.status;
  update public.outreach_candidates set status='READY_TO_SEND',review_status='APPROVED',updated_at=now() where id=k.id;
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'candidate.approved',prev,'APPROVED',jsonb_build_object('edited',m.human_edit is not null));
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'candidate.ready_to_send','APPROVED','READY_TO_SEND','{}');
 elsif m.kind='BOOKING' then perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'booking.approved','DRAFT','READY',jsonb_build_object('edited',m.human_edit is not null));
 else perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'followup.approved','DRAFT','READY',jsonb_build_object('edited',m.human_edit is not null)); end if;
 return jsonb_build_object('status','APPROVED');
end $$;
revoke all on function public.review_outreach_message(uuid,text,text,text,text) from public,anon;
grant execute on function public.review_outreach_message(uuid,text,text,text,text) to authenticated;

create or replace function public.set_outreach_outcome(p_candidate_id uuid,p_outcome text,p_milestone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.outreach_candidates; e text; n int;
begin
 select * into k from public.outreach_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(k.organization_id);
 perform prospectos_private.require_self_outreach_org(k.organization_id);
 if p_outcome is not null then
  if p_outcome not in ('POSITIVE','NEUTRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE','BOUNCE','UNKNOWN') then raise exception 'Invalid outcome' using errcode='22023'; end if;
  update public.outreach_candidates set outcome=p_outcome,outcome_by=auth.uid(),outcome_at=now(),updated_at=now() where id=k.id;
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'outcome.set',k.outcome,p_outcome,'{}');
  perform prospectos_private.outreach_stop_followups(k.id,'outcome');
  -- A booking reply only makes sense after a POSITIVE outcome: any other outcome cancels a pending one.
  if p_outcome<>'POSITIVE' then
   update public.outreach_messages set send_status='CANCELLED',updated_at=now() where candidate_id=k.id and kind='BOOKING' and send_status in ('DRAFT','READY');
   get diagnostics n=row_count;
   if n>0 then perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'booking.cancelled',null,'CANCELLED',jsonb_build_object('reason','outcome')); end if;
  end if;
  if p_outcome in ('UNSUBSCRIBE','BOUNCE') then
   select email into e from public.outreach_contacts where id=k.contact_id;
   insert into public.outreach_suppressions(email,reason,source_candidate_id,created_by) values(e,case when p_outcome='UNSUBSCRIBE' then 'OPT_OUT' else 'HARD_BOUNCE' end,k.id,auth.uid()) on conflict(email) do nothing;
   perform prospectos_private.outreach_stop_email(e,p_outcome);
  end if;
 end if;
 if p_milestone is not null then
  if p_milestone not in ('DEMO','PAID') then raise exception 'Invalid milestone' using errcode='22023'; end if;
  update public.outreach_candidates set demo_at=case when p_milestone='DEMO' then coalesce(demo_at,now()) else demo_at end,
   paid_at=case when p_milestone='PAID' then coalesce(paid_at,now()) else paid_at end,updated_at=now() where id=k.id;
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'milestone.'||lower(p_milestone),null,null,'{}');
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.set_outreach_outcome(uuid,text,text) from public,anon;
grant execute on function public.set_outreach_outcome(uuid,text,text) to authenticated;

create or replace function public.outreach_metrics(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid; r jsonb;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform prospectos_private.require_self_outreach_org(tenant);
 with k as (select c.*,(select bool_or(m.send_status='SENT') from public.outreach_messages m where m.candidate_id=c.id) sent,
   (select min(m.sent_at) from public.outreach_messages m where m.candidate_id=c.id and m.kind='INITIAL' and m.send_status='SENT') first_sent_at
   from public.outreach_candidates c where c.project_id=p_project_id),
  mt as (select * from public.outreach_meetings where project_id=p_project_id)
 select jsonb_build_object(
  'discovered',count(*),'qualified',count(*) filter (where status<>'DISCOVERED'),'needs_review',count(*) filter (where status='NEEDS_REVIEW'),
  'approved',count(*) filter (where review_status='APPROVED'),'rejected',count(*) filter (where status='REJECTED'),
  'sent',count(*) filter (where coalesce(sent,false)),'replied',count(*) filter (where reply_status='REPLIED'),
  'positive',count(*) filter (where outcome='POSITIVE'),'objection',count(*) filter (where outcome='OBJECTION'),
  'not_interested',count(*) filter (where outcome='NOT_INTERESTED'),'unsubscribe',count(*) filter (where outcome='UNSUBSCRIBE'),
  'bounce',count(*) filter (where status='BOUNCED' or outcome='BOUNCE'),'demo',count(*) filter (where demo_at is not null),'paid',count(*) filter (where paid_at is not null),
  'by_signal_type',coalesce((select jsonb_object_agg(signal_type,x) from (select signal_type,jsonb_build_object('sent',count(*) filter (where coalesce(sent,false)),
    'replied',count(*) filter (where reply_status='REPLIED'),'positive',count(*) filter (where outcome='POSITIVE'),'demo',count(*) filter (where demo_at is not null),
    'paid',count(*) filter (where paid_at is not null)) x from k group by signal_type) t),'{}'::jsonb),
  'by_score_band',coalesce((select jsonb_object_agg(band,x) from (select (case when outreach_score>=90 then '90-100' when outreach_score>=75 then '75-89' else '0-74' end) band,
    jsonb_build_object('sent',count(*) filter (where coalesce(sent,false)),'replied',count(*) filter (where reply_status='REPLIED'),'positive',count(*) filter (where outcome='POSITIVE'),
    'demo',count(*) filter (where demo_at is not null),'paid',count(*) filter (where paid_at is not null)) x from k group by 1) t),'{}'::jsonb),
  'meetings',(select jsonb_build_object('scheduled',count(*) filter (where status='SCHEDULED'),'held',count(*) filter (where status='HELD'),
    'no_show',count(*) filter (where status='NO_SHOW'),'cancelled',count(*) filter (where status='CANCELLED'),
    'upcoming',count(*) filter (where status='SCHEDULED' and scheduled_for>=now())) from mt),
  'last_30_days',jsonb_build_object('sent',count(*) filter (where first_sent_at>=now()-interval '30 days'),
    'replied',count(*) filter (where reply_status='REPLIED' and first_sent_at>=now()-interval '30 days'),
    'positive',count(*) filter (where outcome='POSITIVE' and outcome_at>=now()-interval '30 days'),
    'meetings_booked',(select count(*) from mt where created_at>=now()-interval '30 days' and status<>'CANCELLED'),
    'meetings_held',(select count(*) from mt where status='HELD' and scheduled_for>=now()-interval '30 days'))
 ) into r from k;
 return r;
end $$;
revoke all on function public.outreach_metrics(uuid) from public,anon;
grant execute on function public.outreach_metrics(uuid) to authenticated;

create or replace function public.claim_outreach_sends(p_organization_ids uuid[],p_sender text,p_limit int,p_daily_cap int,p_lease_seconds int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m record; out jsonb:='[]'::jsonb; d date:=(now() at time zone 'Europe/Paris')::date; token uuid; got int; stale boolean; reply_to text;
begin
 if p_limit not between 1 and 50 or p_daily_cap not between 0 and 500 or p_lease_seconds not between 30 and 900 then raise exception 'Invalid claim' using errcode='22023'; end if;
 for m in update public.outreach_messages x set send_status='UNCERTAIN',lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED',updated_at=now()
  where x.send_status='SENDING' and x.lease_until<now() returning x.* loop
  update public.outreach_candidates set status='FAILED',updated_at=now() where id=m.candidate_id and status='SENDING';
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,m.candidate_id,m.id,'send.uncertain','SENDING','UNCERTAIN','{}');
 end loop;
 insert into public.outreach_daily_counters(day,sender,sent) values(d,lower(p_sender),0) on conflict do nothing;
 for m in select x.*,k.status kstatus,k.reply_status,k.outcome,c.status cstatus,c.booking_url from public.outreach_messages x
   join public.outreach_candidates k on k.id=x.candidate_id join public.outreach_campaigns c on c.id=k.campaign_id
   where x.send_status='READY' and x.review_status='APPROVED' and x.scheduled_for<=now() and (x.next_attempt_at is null or x.next_attempt_at<=now())
     and x.organization_id=any(p_organization_ids) and prospectos_private.self_outreach_org_allowed(x.organization_id)
   order by x.scheduled_for,x.id limit p_limit for update of x,k skip locked loop
  if prospectos_private.outreach_is_suppressed_email(m.to_email) then perform prospectos_private.outreach_stop_email(m.to_email,'SUPPRESSED_AT_CLAIM'); continue; end if;
  if m.kind='BOOKING' then
   stale:=m.cstatus<>'ACTIVE' or m.kstatus<>'REPLIED' or m.reply_status<>'REPLIED' or m.outcome is distinct from 'POSITIVE' or m.booking_url is null or position(m.booking_url in m.final_content)=0;
  else
   stale:=m.reply_status<>'NONE' or m.cstatus<>'ACTIVE' or (m.kind='INITIAL' and m.kstatus<>'READY_TO_SEND') or (m.kind='FOLLOW_UP' and m.kstatus<>'SENT');
  end if;
  if stale then
   update public.outreach_messages set send_status='CANCELLED',updated_at=now() where id=m.id;
   perform prospectos_private.outreach_event(m.organization_id,m.project_id,m.candidate_id,m.id,'send.cancelled_at_claim','READY','CANCELLED',jsonb_build_object('candidate_status',m.kstatus,'reply_status',m.reply_status,'campaign',m.cstatus));
   continue;
  end if;
  -- New outreach (INITIAL / FOLLOW_UP) is capped per day; a BOOKING reply answers someone who asked for it and is not.
  if m.kind<>'BOOKING' then
   update public.outreach_daily_counters set sent=sent+1 where day=d and sender=lower(p_sender) and sent<p_daily_cap;
   get diagnostics got=row_count;
   if got=0 then continue; end if; -- daily cap reached: the message stays READY for tomorrow (a BOOKING after it may still go)
  end if;
  token:=gen_random_uuid();
  update public.outreach_messages set send_status='SENDING',lease_token=token,lease_until=now()+make_interval(secs=>p_lease_seconds),
   slot_day=case when m.kind='BOOKING' then null else d end,slot_sender=case when m.kind='BOOKING' then null else lower(p_sender) end,updated_at=now() where id=m.id;
  if m.kind='INITIAL' then update public.outreach_candidates set status='SENDING',updated_at=now() where id=m.candidate_id; end if;
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,m.candidate_id,m.id,'send.claimed','READY','SENDING','{}');
  reply_to:=null;
  if m.kind='BOOKING' then
   -- In the prospect's thread: their own reply's Message-ID when the mailbox gave one, else our initial message.
   select i.mailbox_key into reply_to from public.outreach_inbound i where i.candidate_id=m.candidate_id and not i.is_dsn and not i.auto_submitted
    and i.mailbox_key ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$' order by i.received_at desc nulls last,i.created_at desc limit 1;
  end if;
  if reply_to is null and m.sequence>0 then select p.rfc_message_id into reply_to from public.outreach_messages p where p.candidate_id=m.candidate_id and p.sequence=0; end if;
  out:=out||jsonb_build_array(jsonb_build_object('message_id',m.id,'lease_token',token,'to_email',m.to_email,'subject',m.subject,'content',m.final_content,
   'rfc_message_id',m.rfc_message_id,'kind',m.kind,'in_reply_to',reply_to));
 end loop;
 return out;
end $$;
revoke all on function public.claim_outreach_sends(uuid[],text,int,int,int) from public,anon,authenticated;
grant execute on function public.claim_outreach_sends(uuid[],text,int,int,int) to service_role;

create or replace function public.outreach_send_permitted(p_message_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m public.outreach_messages; k public.outreach_candidates; link text;
begin
 select * into m from public.outreach_messages where id=p_message_id;
 if not found or m.send_status<>'SENDING' or m.lease_token is distinct from p_lease_token or m.lease_until<now() then return false; end if;
 if not prospectos_private.self_outreach_org_allowed(m.organization_id) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('outreach:'||m.to_email,0));
 select * into k from public.outreach_candidates where id=m.candidate_id;
 if prospectos_private.outreach_is_suppressed_email(m.to_email) then return false; end if;
 if m.kind='BOOKING' then
  select booking_url into link from public.outreach_campaigns where id=k.campaign_id;
  return k.status='REPLIED' and k.reply_status='REPLIED' and k.outcome='POSITIVE' and link is not null and position(link in m.final_content)>0;
 end if;
 if k.reply_status<>'NONE' or k.status in ('REPLIED','BOUNCED','SUPPRESSED','REJECTED','FAILED') then return false; end if;
 return true;
end $$;
revoke all on function public.outreach_send_permitted(uuid,uuid) from public,anon,authenticated;
grant execute on function public.outreach_send_permitted(uuid,uuid) to service_role;

commit;
