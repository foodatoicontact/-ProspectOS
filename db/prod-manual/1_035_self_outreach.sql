begin;
do $guard$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where name='036_outreach_evidence_revalidation') then raise exception 'REFUSED: 036_outreach_evidence_revalidation missing'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where name in ('035_self_outreach','037_outreach_booking_meetings')) then raise exception 'REFUSED: already recorded'; end if;
end $guard$;

create table if not exists public.outreach_campaigns (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 name text not null check(length(trim(name)) between 2 and 120),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','PAUSED','ARCHIVED')),
 followup_enabled boolean not null default false,
 followup_delay_days int not null default 5 check(followup_delay_days between 3 and 30),
 max_followups int not null default 1 check(max_followups between 0 and 2),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,organization_id)
);

create table if not exists public.outreach_contacts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 prospect_id uuid not null,
 contact_name text not null check(length(trim(contact_name)) between 2 and 120),
 contact_role text not null check(length(trim(contact_role)) between 2 and 120),
 role_source_url text not null check(role_source_url ~ '^https?://[^[:space:]]+$' and length(role_source_url)<=2048),
 email text not null check(email=lower(email) and email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' and length(email)<=254),
 email_source text not null check(email_source in ('company_website','public_profile','public_document','press','direct_exchange')),
 email_source_url text check(email_source_url is null or (email_source_url ~ '^https?://[^[:space:]]+$' and length(email_source_url)<=2048)),
 email_source_excerpt text check(email_source_excerpt is null or length(email_source_excerpt)<=1000),
 email_verified_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id) on delete cascade,
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(organization_id,email),
 unique(id,organization_id),
 check(email_source='direct_exchange' or (email_source_url is not null and email_source_excerpt is not null and position(email in lower(email_source_excerpt))>0))
);

create table if not exists public.outreach_candidates (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 campaign_id uuid not null,
 prospect_id uuid not null,
 contact_id uuid not null,
 signal_id uuid not null,
 signal_type text not null check(signal_type ~ '^[A-Z_]{3,40}$'),
 signal_date date,
 evidence_ids uuid[] not null default '{}' check(cardinality(evidence_ids)<=20),
 fit_score int check(fit_score is null or fit_score between 0 and 100),
 intent_score int not null check(intent_score between 0 and 100),
 timing_score int not null check(timing_score between 0 and 100),
 evidence_quality_score int not null check(evidence_quality_score between 0 and 100),
 outreach_score int not null check(outreach_score between 0 and 100),
 score_threshold int not null check(score_threshold between 0 and 100),
 explanation jsonb not null check(jsonb_typeof(explanation)='object' and length(explanation::text)<=16384),
 config_version text not null check(config_version ~ '^[a-z0-9._-]{1,40}$'),
 status text not null check(status in ('DISCOVERED','QUALIFIED','NEEDS_REVIEW','APPROVED','REJECTED','READY_TO_SEND','SENDING','SENT','REPLIED','BOUNCED','SUPPRESSED','FAILED')),
 review_status text not null default 'PENDING' check(review_status in ('PENDING','APPROVED','REJECTED')),
 reply_status text not null default 'NONE' check(reply_status in ('NONE','REPLIED','NEEDS_REVIEW')),
 outcome text check(outcome is null or outcome in ('POSITIVE','NEUTRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE','BOUNCE','UNKNOWN')),
 outcome_by uuid references auth.users(id),
 outcome_at timestamptz,
 demo_at timestamptz,
 paid_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(campaign_id,organization_id) references public.outreach_campaigns(id,organization_id),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id) on delete cascade,
 foreign key(contact_id,organization_id) references public.outreach_contacts(id,organization_id) on delete cascade,
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(id,organization_id),
 unique(campaign_id,prospect_id),
 unique(campaign_id,contact_id)
);
create unique index if not exists outreach_candidates_one_active_contact on public.outreach_candidates(contact_id)
 where status in ('DISCOVERED','QUALIFIED','NEEDS_REVIEW','APPROVED','READY_TO_SEND','SENDING','SENT');
create index if not exists outreach_candidates_queue_idx on public.outreach_candidates(organization_id,project_id,status,outreach_score desc);

create table if not exists public.outreach_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 candidate_id uuid not null,
 sequence int not null check(sequence between 0 and 2),
 kind text not null check(kind in ('INITIAL','FOLLOW_UP')),
 to_email text not null check(to_email=lower(to_email) and length(to_email)<=254),
 subject text not null check(length(trim(subject)) between 3 and 140 and subject !~ '[\r\n]'),
 generated_content text not null check(length(trim(generated_content)) between 20 and 2000),
 evidence_refs jsonb not null check(jsonb_typeof(evidence_refs)='object' and length(evidence_refs::text)<=4096),
 generation_meta jsonb not null check(jsonb_typeof(generation_meta)='object' and length(generation_meta::text)<=4096),
 human_edit text check(human_edit is null or length(trim(human_edit)) between 20 and 2000),
 final_content text check(final_content is null or length(trim(final_content)) between 20 and 2000),
 review_status text not null default 'PENDING' check(review_status in ('PENDING','APPROVED','REJECTED')),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 send_status text not null default 'DRAFT' check(send_status in ('DRAFT','READY','SENDING','SENT','FAILED','CANCELLED','UNCERTAIN')),
 rfc_message_id text unique check(rfc_message_id is null or rfc_message_id ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'),
 scheduled_for timestamptz,
 next_attempt_at timestamptz,
 attempts int not null default 0 check(attempts between 0 and 3),
 lease_token uuid,
 lease_until timestamptz,
 slot_day date,
 slot_sender text check(slot_sender is null or length(slot_sender) between 3 and 254),
 provider_message_id text check(provider_message_id is null or length(provider_message_id)<=300),
 sent_at timestamptz,
 last_error_code text check(last_error_code is null or last_error_code ~ '^[A-Z_0-9]{2,40}$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(candidate_id,organization_id) references public.outreach_candidates(id,organization_id) on delete cascade,
 unique(id,organization_id),
 unique(candidate_id,sequence),
 check((sequence=0)=(kind='INITIAL')),
 check(review_status<>'APPROVED' or (approved_by is not null and approved_at is not null and final_content is not null and rfc_message_id is not null)),
 check(send_status not in ('READY','SENDING','SENT','UNCERTAIN') or review_status='APPROVED'),
 check((send_status='SENDING')=(lease_token is not null and lease_until is not null)),
 check((send_status='SENT')=(sent_at is not null))
);
create index if not exists outreach_messages_send_idx on public.outreach_messages(send_status,scheduled_for) where send_status in ('READY','SENDING');

create table if not exists public.outreach_events (
 id bigint generated always as identity primary key,
 organization_id uuid not null,
 project_id uuid not null,
 candidate_id uuid,
 message_id uuid,
 kind text not null check(kind ~ '^[a-z_.]{3,60}$'),
 from_status text check(from_status is null or length(from_status)<=30),
 to_status text check(to_status is null or length(to_status)<=30),
 actor_id uuid references auth.users(id),
 payload jsonb not null default '{}' check(jsonb_typeof(payload)='object' and length(payload::text)<=4096),
 created_at timestamptz not null default now()
);
create index if not exists outreach_events_candidate_idx on public.outreach_events(candidate_id,created_at);

create table if not exists public.outreach_suppressions (
 email text primary key check(email=lower(email) and length(email) between 3 and 254 and position('@' in email)>1),
 reason text not null check(reason in ('OPT_OUT','HARD_BOUNCE','MANUAL','COMPLIANCE')),
 source_candidate_id uuid,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);

create table if not exists public.outreach_inbound (
 id uuid primary key default gen_random_uuid(),
 mailbox_key text not null unique check(length(mailbox_key) between 3 and 400),
 organization_id uuid,
 project_id uuid,
 candidate_id uuid,
 message_id uuid,
 from_email text not null check(from_email=lower(from_email) and length(from_email)<=254),
 subject text check(subject is null or length(subject)<=300),
 in_reply_to text check(in_reply_to is null or length(in_reply_to)<=400),
 references_ids text[] not null default '{}' check(cardinality(references_ids)<=50),
 received_at timestamptz,
 auto_submitted boolean not null default false,
 is_dsn boolean not null default false,
 dsn_status text check(dsn_status is null or dsn_status ~ '^[245]\.[0-9]{1,3}\.[0-9]{1,3}$'),
 dsn_recipient text check(dsn_recipient is null or length(dsn_recipient)<=254),
 body_excerpt text check(body_excerpt is null or length(body_excerpt)<=2000),
 match_method text not null check(match_method in ('IN_REPLY_TO','REFERENCES','SENDER_UNIQUE','DSN_RECIPIENT','AMBIGUOUS','NONE')),
 proposed_outcome text not null check(proposed_outcome in ('POSITIVE','NEUTRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE','BOUNCE','UNKNOWN')),
 classification_basis text check(classification_basis is null or length(classification_basis)<=200),
 created_at timestamptz not null default now()
);

create table if not exists public.outreach_daily_counters (
 day date not null,
 sender text not null check(length(sender) between 3 and 254),
 sent int not null default 0 check(sent>=0),
 primary key(day,sender)
);

create table if not exists prospectos_private.self_outreach_organizations (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 added_at timestamptz not null default now(),
 note text check(note is null or length(note)<=200)
);
revoke all on prospectos_private.self_outreach_organizations from public,anon,authenticated;
create or replace function prospectos_private.self_outreach_org_allowed(tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from prospectos_private.self_outreach_organizations where organization_id=tenant)
$$;
revoke all on function prospectos_private.self_outreach_org_allowed(uuid) from public,anon,authenticated;
create or replace function prospectos_private.require_self_outreach_org(tenant uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if tenant is null or not prospectos_private.self_outreach_org_allowed(tenant) then
  raise exception 'self_outreach_org_not_allowed' using errcode='42501'; end if;
end $$;
revoke all on function prospectos_private.require_self_outreach_org(uuid) from public,anon,authenticated;
create or replace function prospectos_private.self_outreach_member(tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select prospectos_private.is_member(tenant) and prospectos_private.self_outreach_org_allowed(tenant)
$$;
revoke all on function prospectos_private.self_outreach_member(uuid) from public,anon;
grant execute on function prospectos_private.self_outreach_member(uuid) to authenticated;

alter table public.outreach_campaigns enable row level security;
alter table public.outreach_contacts enable row level security;
alter table public.outreach_candidates enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.outreach_events enable row level security;
alter table public.outreach_suppressions enable row level security;
alter table public.outreach_inbound enable row level security;
alter table public.outreach_daily_counters enable row level security;
drop policy if exists outreach_campaigns_read on public.outreach_campaigns;
create policy outreach_campaigns_read on public.outreach_campaigns for select to authenticated using(prospectos_private.self_outreach_member(organization_id));
drop policy if exists outreach_contacts_read on public.outreach_contacts;
create policy outreach_contacts_read on public.outreach_contacts for select to authenticated using(prospectos_private.self_outreach_member(organization_id));
drop policy if exists outreach_candidates_read on public.outreach_candidates;
create policy outreach_candidates_read on public.outreach_candidates for select to authenticated using(prospectos_private.self_outreach_member(organization_id));
drop policy if exists outreach_messages_read on public.outreach_messages;
create policy outreach_messages_read on public.outreach_messages for select to authenticated using(prospectos_private.self_outreach_member(organization_id));
drop policy if exists outreach_events_read on public.outreach_events;
create policy outreach_events_read on public.outreach_events for select to authenticated using(prospectos_private.self_outreach_member(organization_id));
drop policy if exists outreach_inbound_read on public.outreach_inbound;
create policy outreach_inbound_read on public.outreach_inbound for select to authenticated using(organization_id is not null and prospectos_private.self_outreach_member(organization_id));
revoke all on public.outreach_campaigns,public.outreach_contacts,public.outreach_candidates,public.outreach_messages,public.outreach_events,
 public.outreach_suppressions,public.outreach_inbound,public.outreach_daily_counters from public,anon,authenticated;
grant select on public.outreach_campaigns,public.outreach_contacts,public.outreach_candidates,public.outreach_messages,public.outreach_events,public.outreach_inbound to authenticated;

create or replace function prospectos_private.outreach_event(p_org uuid,p_project uuid,p_candidate uuid,p_message uuid,p_kind text,p_from text,p_to text,p_payload jsonb default '{}')
returns void language sql set search_path='' as $$
 insert into public.outreach_events(organization_id,project_id,candidate_id,message_id,kind,from_status,to_status,actor_id,payload)
 values(p_org,p_project,p_candidate,p_message,p_kind,p_from,p_to,auth.uid(),coalesce(p_payload,'{}'::jsonb));
$$;
revoke all on function prospectos_private.outreach_event(uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;

create or replace function prospectos_private.outreach_is_suppressed_email(p_email text) returns boolean
language sql stable set search_path='' as $$ select exists(select 1 from public.outreach_suppressions where email=lower(trim(p_email))) $$;
revoke all on function prospectos_private.outreach_is_suppressed_email(text) from public,anon,authenticated;

create or replace function prospectos_private.outreach_stop_email(p_email text,p_reason text) returns int
language plpgsql set search_path='' as $$
declare c record; n int:=0;
begin
 for c in select k.* from public.outreach_candidates k join public.outreach_contacts ct on ct.id=k.contact_id where ct.email=lower(trim(p_email)) for update of k loop
  update public.outreach_messages set send_status='CANCELLED',updated_at=now() where candidate_id=c.id and send_status in ('DRAFT','READY');
  if c.status in ('DISCOVERED','QUALIFIED','NEEDS_REVIEW','APPROVED','READY_TO_SEND','SENT') then
   update public.outreach_candidates set status='SUPPRESSED',updated_at=now() where id=c.id;
   perform prospectos_private.outreach_event(c.organization_id,c.project_id,c.id,null,'candidate.suppressed',c.status,'SUPPRESSED',jsonb_build_object('reason',p_reason));
  end if;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function prospectos_private.outreach_stop_email(text,text) from public,anon,authenticated;

create or replace function prospectos_private.outreach_stop_followups(p_candidate uuid,p_reason text) returns int
language plpgsql set search_path='' as $$
declare n int; k public.outreach_candidates;
begin
 select * into k from public.outreach_candidates where id=p_candidate;
 update public.outreach_messages set send_status='CANCELLED',updated_at=now() where candidate_id=p_candidate and kind='FOLLOW_UP' and send_status in ('DRAFT','READY');
 get diagnostics n=row_count;
 if n>0 then perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'followups.stopped',null,null,jsonb_build_object('reason',p_reason,'cancelled',n)); end if;
 return n;
end $$;
revoke all on function prospectos_private.outreach_stop_followups(uuid,text) from public,anon,authenticated;

create or replace function prospectos_private.outreach_text_refused(p_text text) returns boolean
language sql immutable set search_path='' as $$
 select lower(p_text) ~ '(essai|test|b[eê]ta|p[ée]riode d.essai|d[ée]mo)\s+gratuit|free\s+(trial|beta|test)|gratuitement\s+pendant|j.esp[eè]re\s+que\s+vous\s+allez\s+bien'
$$;
revoke all on function prospectos_private.outreach_text_refused(text) from public,anon,authenticated;

create or replace function public.outreach_is_suppressed(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
 select prospectos_private.outreach_is_suppressed_email(p_email)
$$;
revoke all on function public.outreach_is_suppressed(text) from public,anon,authenticated;
grant execute on function public.outreach_is_suppressed(text) to service_role;

create or replace function public.create_outreach_campaign(p_project_id uuid,p_name text,p_followup_enabled boolean,p_followup_delay_days int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; row public.outreach_campaigns;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform prospectos_private.require_self_outreach_org(tenant);
 insert into public.outreach_campaigns(organization_id,project_id,name,followup_enabled,followup_delay_days,created_by)
 values(tenant,p_project_id,trim(p_name),coalesce(p_followup_enabled,false),coalesce(p_followup_delay_days,5),auth.uid()) returning * into row;
 perform prospectos_private.outreach_event(tenant,p_project_id,null,null,'campaign.created',null,'ACTIVE',jsonb_build_object('campaign_id',row.id));
 return to_jsonb(row);
end $$;
revoke all on function public.create_outreach_campaign(uuid,text,boolean,int) from public,anon;
grant execute on function public.create_outreach_campaign(uuid,text,boolean,int) to authenticated;

create or replace function public.add_outreach_contact(p_prospect_id uuid,p_name text,p_role text,p_role_source_url text,p_email text,p_email_source text,p_email_source_url text,p_email_source_excerpt text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.prospects; row public.outreach_contacts; e text:=lower(trim(p_email));
begin
 select * into p from public.prospects where id=p_prospect_id;
 if not found then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(p.organization_id);
 perform prospectos_private.require_self_outreach_org(p.organization_id);
 if prospectos_private.outreach_is_suppressed_email(e) then raise exception 'outreach_email_suppressed' using errcode='42501'; end if;
 insert into public.outreach_contacts(organization_id,project_id,prospect_id,contact_name,contact_role,role_source_url,email,email_source,email_source_url,email_source_excerpt,created_by)
 values(p.organization_id,p.project_id,p.id,trim(p_name),trim(p_role),p_role_source_url,e,p_email_source,p_email_source_url,p_email_source_excerpt,auth.uid()) returning * into row;
 perform prospectos_private.outreach_event(p.organization_id,p.project_id,null,null,'contact.added',null,null,jsonb_build_object('contact_id',row.id,'email_source',row.email_source));
 return to_jsonb(row);
end $$;
revoke all on function public.add_outreach_contact(uuid,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.add_outreach_contact(uuid,text,text,text,text,text,text,text) to authenticated;

create or replace function public.create_outreach_candidate(p_campaign_id uuid,p_contact_id uuid,p_signal_id uuid,p_evidence_ids uuid[],p_scores jsonb,p_message jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare camp public.outreach_campaigns; ct public.outreach_contacts; s public.signals; row public.outreach_candidates; msg public.outreach_messages;
 score int; threshold int; st text; ev uuid[]:=coalesce(p_evidence_ids,'{}');
begin
 select * into camp from public.outreach_campaigns where id=p_campaign_id;
 if not found then raise exception 'Campaign not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(camp.organization_id);
 perform prospectos_private.require_self_outreach_org(camp.organization_id);
 if camp.status<>'ACTIVE' then raise exception 'outreach_campaign_not_active' using errcode='22023'; end if;
 select * into ct from public.outreach_contacts where id=p_contact_id and organization_id=camp.organization_id and project_id=camp.project_id;
 if not found then raise exception 'Contact not found' using errcode='P0002'; end if;
 if prospectos_private.outreach_is_suppressed_email(ct.email) then raise exception 'outreach_email_suppressed' using errcode='42501'; end if;
 select * into s from public.signals where id=p_signal_id and prospect_id=ct.prospect_id and organization_id=camp.organization_id;
 if not found then raise exception 'outreach_signal_not_of_company' using errcode='22023'; end if;
 if s.status<>'VERIFIED' then raise exception 'outreach_signal_not_verified' using errcode='22023'; end if;
 if exists(select 1 from unnest(ev) x where not exists(select 1 from public.evidence e where e.id=x and e.prospect_id=ct.prospect_id and e.status='VERIFIED' and e.verified_by is not null)) then
  raise exception 'outreach_evidence_not_verified_of_company' using errcode='22023'; end if;
 if jsonb_typeof(p_scores)<>'object' or jsonb_typeof(p_message)<>'object' then raise exception 'Invalid payload' using errcode='22023'; end if;
 score:=(p_scores->>'outreach')::int;threshold:=(p_scores->>'threshold')::int;
 st:=case when score>=threshold then 'NEEDS_REVIEW' else 'QUALIFIED' end;
 insert into public.outreach_candidates(organization_id,project_id,campaign_id,prospect_id,contact_id,signal_id,signal_type,signal_date,evidence_ids,
  fit_score,intent_score,timing_score,evidence_quality_score,outreach_score,score_threshold,explanation,config_version,status,created_by)
 values(camp.organization_id,camp.project_id,camp.id,ct.prospect_id,ct.id,s.id,p_scores->>'signal_type',coalesce(s.event_date,s.published_at::date,s.observed_at::date),ev,
  (p_scores->>'fit')::int,(p_scores->>'intent')::int,(p_scores->>'timing')::int,(p_scores->>'evidence_quality')::int,score,threshold,
  coalesce(p_scores->'explanation','{}'::jsonb),p_scores->>'config_version',st,auth.uid()) returning * into row;
 insert into public.outreach_messages(organization_id,project_id,candidate_id,sequence,kind,to_email,subject,generated_content,evidence_refs,generation_meta)
 values(row.organization_id,row.project_id,row.id,0,'INITIAL',ct.email,trim(p_message->>'subject'),p_message->>'generated_content',
  coalesce(p_message->'evidence_refs','{}'::jsonb),coalesce(p_message->'generation_meta','{}'::jsonb)) returning * into msg;
 perform prospectos_private.outreach_event(row.organization_id,row.project_id,row.id,null,'candidate.created',null,'DISCOVERED','{}');
 perform prospectos_private.outreach_event(row.organization_id,row.project_id,row.id,null,'candidate.qualified','DISCOVERED','QUALIFIED',jsonb_build_object('outreach_score',score,'threshold',threshold));
 if st='NEEDS_REVIEW' then perform prospectos_private.outreach_event(row.organization_id,row.project_id,row.id,null,'candidate.needs_review','QUALIFIED','NEEDS_REVIEW','{}'); end if;
 return jsonb_build_object('candidate',to_jsonb(row),'message_id',msg.id);
end $$;
revoke all on function public.create_outreach_candidate(uuid,uuid,uuid,uuid[],jsonb,jsonb) from public,anon;
grant execute on function public.create_outreach_candidate(uuid,uuid,uuid,uuid[],jsonb,jsonb) to authenticated;

create or replace function public.review_outreach_message(p_message_id uuid,p_decision text,p_subject text,p_content text,p_message_domain text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.outreach_messages; k public.outreach_candidates; txt text; prev text;
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
 if p_decision='REJECT' then
  update public.outreach_messages set review_status='REJECTED',send_status='CANCELLED',updated_at=now() where id=m.id;
  if m.kind='INITIAL' then
   update public.outreach_candidates set status='REJECTED',review_status='REJECTED',updated_at=now() where id=k.id;
   perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'candidate.rejected',k.status,'REJECTED','{}');
  else perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'followup.rejected','DRAFT','CANCELLED','{}'); end if;
  return jsonb_build_object('status','REJECTED');
 end if;
 if p_decision='EDIT' then
  if p_content is null or length(trim(p_content)) not between 20 and 2000 then raise exception 'Invalid content' using errcode='22023'; end if;
  if prospectos_private.outreach_text_refused(p_content) then raise exception 'outreach_text_refused' using errcode='22023'; end if;
  update public.outreach_messages set human_edit=p_content,subject=coalesce(nullif(trim(p_subject),''),subject),updated_at=now() where id=m.id;
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'message.edited',null,null,'{}');
  return jsonb_build_object('status','EDITED');
 end if;
 if prospectos_private.outreach_is_suppressed_email(m.to_email) then raise exception 'outreach_email_suppressed' using errcode='42501'; end if;
 if p_message_domain is null or p_message_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Invalid message domain' using errcode='22023'; end if;
 txt:=coalesce(m.human_edit,m.generated_content);
 if prospectos_private.outreach_text_refused(txt) or prospectos_private.outreach_text_refused(m.subject) then raise exception 'outreach_text_refused' using errcode='22023'; end if;
 update public.outreach_messages set review_status='APPROVED',approved_by=auth.uid(),approved_at=now(),final_content=txt,send_status='READY',
  rfc_message_id='<'||gen_random_uuid()::text||'@'||p_message_domain||'>',
  scheduled_for=case when m.kind='INITIAL' then now() else greatest(now(),coalesce(m.scheduled_for,now())) end,updated_at=now() where id=m.id;
 if m.kind='INITIAL' then
  prev:=k.status;
  update public.outreach_candidates set status='READY_TO_SEND',review_status='APPROVED',updated_at=now() where id=k.id;
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'candidate.approved',prev,'APPROVED',jsonb_build_object('edited',m.human_edit is not null));
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'candidate.ready_to_send','APPROVED','READY_TO_SEND','{}');
 else perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,m.id,'followup.approved','DRAFT','READY',jsonb_build_object('edited',m.human_edit is not null)); end if;
 return jsonb_build_object('status','APPROVED');
end $$;
revoke all on function public.review_outreach_message(uuid,text,text,text,text) from public,anon;
grant execute on function public.review_outreach_message(uuid,text,text,text,text) to authenticated;

create or replace function public.set_outreach_outcome(p_candidate_id uuid,p_outcome text,p_milestone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.outreach_candidates; e text;
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

create or replace function public.suppress_outreach_email(p_project_id uuid,p_email text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; e text:=lower(trim(p_email)); n int;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform prospectos_private.require_self_outreach_org(tenant);
 if p_reason not in ('OPT_OUT','MANUAL','COMPLIANCE') then raise exception 'Invalid reason' using errcode='22023'; end if;
 if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then raise exception 'Invalid email' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('outreach:'||e,0));
 insert into public.outreach_suppressions(email,reason,created_by) values(e,p_reason,auth.uid()) on conflict(email) do nothing;
 n:=prospectos_private.outreach_stop_email(e,p_reason);
 perform prospectos_private.outreach_event(tenant,p_project_id,null,null,'suppression.added',null,null,jsonb_build_object('reason',p_reason,'candidates',n));
 return jsonb_build_object('suppressed',true,'candidates_stopped',n);
end $$;
revoke all on function public.suppress_outreach_email(uuid,text,text) from public,anon;
grant execute on function public.suppress_outreach_email(uuid,text,text) to authenticated;

create or replace function public.outreach_metrics(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid; r jsonb;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 perform prospectos_private.require_self_outreach_org(tenant);
 with k as (select c.*,(select bool_or(m.send_status='SENT') from public.outreach_messages m where m.candidate_id=c.id) sent from public.outreach_candidates c where c.project_id=p_project_id)
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
    'demo',count(*) filter (where demo_at is not null),'paid',count(*) filter (where paid_at is not null)) x from k group by 1) t),'{}'::jsonb)
 ) into r from k;
 return r;
end $$;
revoke all on function public.outreach_metrics(uuid) from public,anon;
grant execute on function public.outreach_metrics(uuid) to authenticated;

create or replace function public.claim_outreach_sends(p_organization_ids uuid[],p_sender text,p_limit int,p_daily_cap int,p_lease_seconds int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m record; out jsonb:='[]'::jsonb; d date:=(now() at time zone 'Europe/Paris')::date; token uuid; got int; prev text;
begin
 if p_limit not between 1 and 50 or p_daily_cap not between 0 and 500 or p_lease_seconds not between 30 and 900 then raise exception 'Invalid claim' using errcode='22023'; end if;
 for m in update public.outreach_messages x set send_status='UNCERTAIN',lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED',updated_at=now()
  where x.send_status='SENDING' and x.lease_until<now() returning x.* loop
  update public.outreach_candidates set status='FAILED',updated_at=now() where id=m.candidate_id and status='SENDING';
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,m.candidate_id,m.id,'send.uncertain','SENDING','UNCERTAIN','{}');
 end loop;
 insert into public.outreach_daily_counters(day,sender,sent) values(d,lower(p_sender),0) on conflict do nothing;
 for m in select x.*,k.status kstatus,k.reply_status,c.status cstatus from public.outreach_messages x
   join public.outreach_candidates k on k.id=x.candidate_id join public.outreach_campaigns c on c.id=k.campaign_id
   where x.send_status='READY' and x.review_status='APPROVED' and x.scheduled_for<=now() and (x.next_attempt_at is null or x.next_attempt_at<=now())
     and x.organization_id=any(p_organization_ids) and prospectos_private.self_outreach_org_allowed(x.organization_id)
   order by x.scheduled_for,x.id limit p_limit for update of x,k skip locked loop
  if prospectos_private.outreach_is_suppressed_email(m.to_email) then perform prospectos_private.outreach_stop_email(m.to_email,'SUPPRESSED_AT_CLAIM'); continue; end if;
  if m.reply_status<>'NONE' or m.cstatus<>'ACTIVE' or (m.kind='INITIAL' and m.kstatus<>'READY_TO_SEND') or (m.kind='FOLLOW_UP' and m.kstatus<>'SENT') then
   update public.outreach_messages set send_status='CANCELLED',updated_at=now() where id=m.id;
   perform prospectos_private.outreach_event(m.organization_id,m.project_id,m.candidate_id,m.id,'send.cancelled_at_claim','READY','CANCELLED',jsonb_build_object('candidate_status',m.kstatus,'reply_status',m.reply_status,'campaign',m.cstatus));
   continue;
  end if;
  update public.outreach_daily_counters set sent=sent+1 where day=d and sender=lower(p_sender) and sent<p_daily_cap;
  get diagnostics got=row_count;
  if got=0 then exit; end if; -- daily cap reached: the message stays READY for tomorrow
  token:=gen_random_uuid();
  update public.outreach_messages set send_status='SENDING',lease_token=token,lease_until=now()+make_interval(secs=>p_lease_seconds),slot_day=d,slot_sender=lower(p_sender),updated_at=now() where id=m.id;
  if m.kind='INITIAL' then update public.outreach_candidates set status='SENDING',updated_at=now() where id=m.candidate_id; end if;
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,m.candidate_id,m.id,'send.claimed','READY','SENDING','{}');
  out:=out||jsonb_build_array(jsonb_build_object('message_id',m.id,'lease_token',token,'to_email',m.to_email,'subject',m.subject,'content',m.final_content,
   'rfc_message_id',m.rfc_message_id,'kind',m.kind,'in_reply_to',(select p.rfc_message_id from public.outreach_messages p where p.candidate_id=m.candidate_id and p.sequence=0 and m.sequence>0)));
 end loop;
 return out;
end $$;
revoke all on function public.claim_outreach_sends(uuid[],text,int,int,int) from public,anon,authenticated;
grant execute on function public.claim_outreach_sends(uuid[],text,int,int,int) to service_role;

create or replace function public.outreach_send_permitted(p_message_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare m public.outreach_messages; k public.outreach_candidates;
begin
 select * into m from public.outreach_messages where id=p_message_id;
 if not found or m.send_status<>'SENDING' or m.lease_token is distinct from p_lease_token or m.lease_until<now() then return false; end if;
 if not prospectos_private.self_outreach_org_allowed(m.organization_id) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('outreach:'||m.to_email,0));
 select * into k from public.outreach_candidates where id=m.candidate_id;
 if prospectos_private.outreach_is_suppressed_email(m.to_email) or k.reply_status<>'NONE' or k.status in ('REPLIED','BOUNCED','SUPPRESSED','REJECTED','FAILED') then return false; end if;
 return true;
end $$;
revoke all on function public.outreach_send_permitted(uuid,uuid) from public,anon,authenticated;
grant execute on function public.outreach_send_permitted(uuid,uuid) to service_role;

create or replace function public.complete_outreach_send(p_message_id uuid,p_lease_token uuid,p_result text,p_provider_message_id text,p_error_code text,p_retry_after_seconds int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.outreach_messages; k public.outreach_candidates;
begin
 select * into m from public.outreach_messages where id=p_message_id for update;
 if not found or m.send_status<>'SENDING' or m.lease_token is distinct from p_lease_token then raise exception 'outreach_lease_lost' using errcode='40001'; end if;
 if p_result not in ('SENT','RETRY','FAILED','BOUNCED','UNCERTAIN','ABORTED') then raise exception 'Invalid result' using errcode='22023'; end if;
 select * into k from public.outreach_candidates where id=m.candidate_id for update;
 if p_result in ('RETRY','FAILED','BOUNCED','ABORTED') then
  update public.outreach_daily_counters set sent=sent-1 where day=m.slot_day and sender=m.slot_sender and sent>0;
 end if;
 if p_result='SENT' then
  update public.outreach_messages set send_status='SENT',sent_at=now(),provider_message_id=left(p_provider_message_id,300),lease_token=null,lease_until=null,updated_at=now() where id=m.id;
  if m.kind='INITIAL' then update public.outreach_candidates set status='SENT',updated_at=now() where id=k.id; end if;
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,k.id,m.id,'send.sent','SENDING','SENT','{}');
 elsif p_result='RETRY' and m.attempts+1<3 then
  update public.outreach_messages set send_status='READY',attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_retry_after_seconds,900),86400))),
   last_error_code=p_error_code,lease_token=null,lease_until=null,updated_at=now() where id=m.id;
  if m.kind='INITIAL' then update public.outreach_candidates set status='READY_TO_SEND',updated_at=now() where id=k.id; end if;
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,k.id,m.id,'send.retry_scheduled','SENDING','READY',jsonb_build_object('error',p_error_code,'attempt',m.attempts+1));
 elsif p_result='ABORTED' then
  update public.outreach_messages set send_status='READY',last_error_code=p_error_code,lease_token=null,lease_until=null,updated_at=now() where id=m.id;
  if m.kind='INITIAL' then update public.outreach_candidates set status='READY_TO_SEND',updated_at=now() where id=k.id; end if;
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,k.id,m.id,'send.aborted','SENDING','READY',jsonb_build_object('error',p_error_code));
 elsif p_result='BOUNCED' then
  update public.outreach_messages set send_status='FAILED',last_error_code=coalesce(p_error_code,'HARD_BOUNCE'),lease_token=null,lease_until=null,updated_at=now() where id=m.id;
  update public.outreach_candidates set status='BOUNCED',updated_at=now() where id=k.id;
  insert into public.outreach_suppressions(email,reason,source_candidate_id) values(m.to_email,'HARD_BOUNCE',k.id) on conflict(email) do nothing;
  perform prospectos_private.outreach_stop_email(m.to_email,'HARD_BOUNCE');
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,k.id,m.id,'send.bounced','SENDING','BOUNCED',jsonb_build_object('error',p_error_code));
 elsif p_result='UNCERTAIN' then
  update public.outreach_messages set send_status='UNCERTAIN',last_error_code=coalesce(p_error_code,'UNCERTAIN'),lease_token=null,lease_until=null,updated_at=now() where id=m.id;
  update public.outreach_candidates set status='FAILED',updated_at=now() where id=k.id and status='SENDING';
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,k.id,m.id,'send.uncertain','SENDING','UNCERTAIN',jsonb_build_object('error',p_error_code));
 else -- FAILED, or RETRY with no attempt left
  update public.outreach_messages set send_status='FAILED',attempts=least(attempts+1,3),last_error_code=p_error_code,lease_token=null,lease_until=null,updated_at=now() where id=m.id;
  if m.kind='INITIAL' then update public.outreach_candidates set status='FAILED',updated_at=now() where id=k.id; end if;
  perform prospectos_private.outreach_event(m.organization_id,m.project_id,k.id,m.id,'send.failed','SENDING','FAILED',jsonb_build_object('error',p_error_code));
 end if;
 return jsonb_build_object('result',p_result);
end $$;
revoke all on function public.complete_outreach_send(uuid,uuid,text,text,text,int) from public,anon,authenticated;
grant execute on function public.complete_outreach_send(uuid,uuid,text,text,text,int) to service_role;

create or replace function public.outreach_followups_due(p_organization_ids uuid[],p_limit int) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',k.id,'message_id',m.id,'sent_at',m.sent_at,'sequence',(select count(*) from public.outreach_messages f where f.candidate_id=k.id)))
  ,'[]'::jsonb) from (select k.* from public.outreach_candidates k
  join public.outreach_campaigns c on c.id=k.campaign_id
  join public.outreach_messages m0 on m0.candidate_id=k.id and m0.sequence=0 and m0.send_status='SENT'
  where k.organization_id=any(p_organization_ids) and prospectos_private.self_outreach_org_allowed(k.organization_id) and k.status='SENT' and k.reply_status='NONE' and c.status='ACTIVE' and c.followup_enabled
   and m0.sent_at<=now()-make_interval(days=>c.followup_delay_days)
   and (select count(*) from public.outreach_messages f where f.candidate_id=k.id)<=c.max_followups
   and not exists(select 1 from public.outreach_messages f where f.candidate_id=k.id and f.send_status in ('DRAFT','READY','SENDING','UNCERTAIN'))
   and not prospectos_private.outreach_is_suppressed_email((select email from public.outreach_contacts where id=k.contact_id))
  order by m0.sent_at limit greatest(1,least(p_limit,50))) k
  join public.outreach_messages m on m.candidate_id=k.id and m.sequence=0;
$$;
revoke all on function public.outreach_followups_due(uuid[],int) from public,anon,authenticated;
grant execute on function public.outreach_followups_due(uuid[],int) to service_role;

create or replace function public.create_outreach_followup(p_candidate_id uuid,p_subject text,p_content text,p_evidence_refs jsonb,p_generation_meta jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k public.outreach_candidates; c public.outreach_campaigns; seq int; e text; row public.outreach_messages;
begin
 select * into k from public.outreach_candidates where id=p_candidate_id for update;
 if not found then raise exception 'Candidate not found' using errcode='P0002'; end if;
 perform prospectos_private.require_self_outreach_org(k.organization_id);
 select * into c from public.outreach_campaigns where id=k.campaign_id;
 select email into e from public.outreach_contacts where id=k.contact_id;
 if k.status<>'SENT' or k.reply_status<>'NONE' or not c.followup_enabled or c.status<>'ACTIVE' or prospectos_private.outreach_is_suppressed_email(e) then
  raise exception 'outreach_candidate_not_followable' using errcode='22023'; end if;
 select count(*) into seq from public.outreach_messages where candidate_id=k.id;
 if seq>c.max_followups then raise exception 'outreach_followups_exhausted' using errcode='22023'; end if;
 insert into public.outreach_messages(organization_id,project_id,candidate_id,sequence,kind,to_email,subject,generated_content,evidence_refs,generation_meta,scheduled_for)
 values(k.organization_id,k.project_id,k.id,seq,'FOLLOW_UP',e,trim(p_subject),p_content,coalesce(p_evidence_refs,'{}'::jsonb),coalesce(p_generation_meta,'{}'::jsonb),now()) returning * into row;
 perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,row.id,'followup.drafted',null,'DRAFT','{}');
 return to_jsonb(row);
end $$;
revoke all on function public.create_outreach_followup(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_outreach_followup(uuid,text,text,jsonb,jsonb) to service_role;

create or replace function public.record_outreach_inbound(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids text[]; hit public.outreach_messages; k public.outreach_candidates; method text:='NONE'; n int; frm text:=lower(trim(p->>'from_email'));
 proposed text:=coalesce(p->>'proposed_outcome','UNKNOWN'); auto boolean:=coalesce((p->>'auto_submitted')::boolean,false); dsn boolean:=coalesce((p->>'is_dsn')::boolean,false);
 cands uuid[]; row public.outreach_inbound;
begin
 if exists(select 1 from public.outreach_inbound where mailbox_key=p->>'mailbox_key') then return jsonb_build_object('duplicate',true); end if;
 ids:=array(select x from jsonb_array_elements_text(coalesce(p->'references_ids','[]'::jsonb)) x)||coalesce(array[p->>'in_reply_to'],'{}');
 if dsn then
  if coalesce(p->>'dsn_status','') ~ '^5\.' and p->>'dsn_recipient' is not null then
   select x.* into hit from public.outreach_messages x where x.send_status='SENT' and x.to_email=lower(p->>'dsn_recipient') order by x.sent_at desc limit 1;
   if found then method:='DSN_RECIPIENT'; end if;
  end if;
 else
  select x.* into hit from public.outreach_messages x where x.send_status='SENT' and x.rfc_message_id=p->>'in_reply_to' limit 1;
  if found then method:='IN_REPLY_TO';
  else
   select x.* into hit from public.outreach_messages x where x.send_status='SENT' and x.rfc_message_id=any(ids) order by x.sent_at desc limit 1;
   if found then method:='REFERENCES'; end if;
  end if;
  if method='NONE' then
   cands:=array(select distinct k2.id from public.outreach_candidates k2 join public.outreach_contacts ct on ct.id=k2.contact_id
     where ct.email=frm and exists(select 1 from public.outreach_messages x where x.candidate_id=k2.id and x.send_status='SENT'));
   if cardinality(cands)=1 then method:='SENDER_UNIQUE'; elsif cardinality(cands)>1 then method:='AMBIGUOUS'; end if;
  end if;
 end if;
 if method in ('IN_REPLY_TO','REFERENCES','DSN_RECIPIENT') then select * into k from public.outreach_candidates where id=hit.candidate_id for update;
 elsif method='SENDER_UNIQUE' then select * into k from public.outreach_candidates where id=cands[1] for update; end if;
 insert into public.outreach_inbound(mailbox_key,organization_id,project_id,candidate_id,message_id,from_email,subject,in_reply_to,references_ids,received_at,auto_submitted,is_dsn,
  dsn_status,dsn_recipient,body_excerpt,match_method,proposed_outcome,classification_basis)
 values(p->>'mailbox_key',k.organization_id,k.project_id,k.id,case when method in ('IN_REPLY_TO','REFERENCES','DSN_RECIPIENT') then hit.id end,frm,left(p->>'subject',300),left(p->>'in_reply_to',400),
  array(select left(x,400) from jsonb_array_elements_text(coalesce(p->'references_ids','[]'::jsonb)) x limit 50),(p->>'received_at')::timestamptz,auto,dsn,p->>'dsn_status',left(lower(p->>'dsn_recipient'),254),
  left(p->>'body_excerpt',2000),method,proposed,left(p->>'classification_basis',200)) returning * into row;
 if method='DSN_RECIPIENT' then
  update public.outreach_candidates set status='BOUNCED',outcome=coalesce(outcome,'BOUNCE'),updated_at=now() where id=k.id;
  insert into public.outreach_suppressions(email,reason,source_candidate_id) values(hit.to_email,'HARD_BOUNCE',k.id) on conflict(email) do nothing;
  perform prospectos_private.outreach_stop_email(hit.to_email,'HARD_BOUNCE');
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,hit.id,'reply.bounce',k.status,'BOUNCED',jsonb_build_object('inbound_id',row.id));
 elsif method in ('IN_REPLY_TO','REFERENCES') then
  perform prospectos_private.outreach_stop_followups(k.id,'reply');
  if auto then
   update public.outreach_candidates set reply_status='NEEDS_REVIEW',updated_at=now() where id=k.id and reply_status='NONE';
   perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,hit.id,'reply.auto_submitted',null,'NEEDS_REVIEW',jsonb_build_object('inbound_id',row.id));
  else
   update public.outreach_candidates set status=case when status in ('SENT','SENDING','FAILED') then 'REPLIED' else status end,reply_status='REPLIED',updated_at=now() where id=k.id;
   update public.outreach_contacts set email_verified_at=coalesce(email_verified_at,now()) where id=k.contact_id;
   perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,hit.id,'reply.detected',k.status,'REPLIED',jsonb_build_object('inbound_id',row.id,'method',method,'proposed',proposed));
  end if;
 elsif method='SENDER_UNIQUE' then
  perform prospectos_private.outreach_stop_followups(k.id,'possible_reply');
  update public.outreach_candidates set reply_status='NEEDS_REVIEW',updated_at=now() where id=k.id and reply_status='NONE';
  perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'reply.possible',null,'NEEDS_REVIEW',jsonb_build_object('inbound_id',row.id));
 elsif method='AMBIGUOUS' then
  for k in select * from public.outreach_candidates where id=any(cands) for update loop
   perform prospectos_private.outreach_stop_followups(k.id,'ambiguous_reply');
   update public.outreach_candidates set reply_status='NEEDS_REVIEW',updated_at=now() where id=k.id and reply_status='NONE';
   perform prospectos_private.outreach_event(k.organization_id,k.project_id,k.id,null,'reply.ambiguous',null,'NEEDS_REVIEW',jsonb_build_object('inbound_id',row.id));
  end loop;
 end if;
 if proposed='UNSUBSCRIBE' and not dsn and frm ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
  perform pg_advisory_xact_lock(hashtextextended('outreach:'||frm,0));
  insert into public.outreach_suppressions(email,reason,source_candidate_id) values(frm,'OPT_OUT',k.id) on conflict(email) do nothing;
  get diagnostics n=row_count;
  perform prospectos_private.outreach_stop_email(frm,'OPT_OUT');
 end if;
 return jsonb_build_object('inbound_id',row.id,'match_method',method,'candidate_id',k.id);
end $$;
revoke all on function public.record_outreach_inbound(jsonb) from public,anon,authenticated;
grant execute on function public.record_outreach_inbound(jsonb) to service_role;


do $verify$ declare t text; f text;
 service_only text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)',
  'public.complete_outreach_send(uuid,uuid,text,text,text,integer)','public.outreach_followups_due(uuid[],integer)',
  'public.create_outreach_followup(uuid,text,text,jsonb,jsonb)','public.record_outreach_inbound(jsonb)'];
 member_fns text[]:=array['public.create_outreach_campaign(uuid,text,boolean,integer)','public.add_outreach_contact(uuid,text,text,text,text,text,text,text)',
  'public.create_outreach_candidate(uuid,uuid,uuid,uuid[],jsonb,jsonb)','public.review_outreach_message(uuid,text,text,text,text)',
  'public.set_outreach_outcome(uuid,text,text)','public.suppress_outreach_email(uuid,text,text)','public.outreach_metrics(uuid)'];
 private_fns text[]:=array['prospectos_private.outreach_event(uuid,uuid,uuid,uuid,text,text,text,jsonb)','prospectos_private.outreach_is_suppressed_email(text)',
  'prospectos_private.outreach_stop_email(text,text)','prospectos_private.outreach_stop_followups(uuid,text)','prospectos_private.outreach_text_refused(text)',
  'prospectos_private.self_outreach_org_allowed(uuid)','prospectos_private.require_self_outreach_org(uuid)'];
 server_gated text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)',
  'public.outreach_followups_due(uuid[],integer)','public.create_outreach_followup(uuid,text,text,jsonb,jsonb)'];
 pol record; n int;
begin
 foreach t in array array['public.outreach_campaigns','public.outreach_contacts','public.outreach_candidates','public.outreach_messages','public.outreach_events',
   'public.outreach_suppressions','public.outreach_inbound','public.outreach_daily_counters'] loop
  if to_regclass(t) is null then raise exception 'check 035: % missing',t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass(t)) then raise exception 'check 035: RLS off on %',t; end if;
  if has_table_privilege('authenticated',t,'INSERT') or has_table_privilege('authenticated',t,'UPDATE') or has_table_privilege('authenticated',t,'DELETE')
     or has_table_privilege('anon',t,'SELECT') then raise exception 'check 035: client write or anon read on %',t; end if;
 end loop;
 if has_table_privilege('authenticated','public.outreach_suppressions','SELECT') then raise exception 'check 035: suppressions readable by clients'; end if;
 foreach f in array service_only||array['public.outreach_is_suppressed(text)'] loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then
   raise exception 'check 035: % callable by clients',f; end if;
  if not has_function_privilege('service_role',to_regprocedure(f),'EXECUTE') then raise exception 'check 035: % not callable by the server',f; end if;
 end loop;
 foreach f in array member_fns loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then raise exception 'check 035: % callable by anon',f; end if;
  if not has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') then raise exception 'check 035: % not callable by members',f; end if;
  if not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure(f)) then
   raise exception 'check 035: % must be security definer with an empty search_path',f; end if;
  if pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_member(%' or pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_self_outreach_org(%' then
   raise exception 'check 035: % must require a member of a served organization',f; end if;
 end loop;
 foreach f in array server_gated loop
  if pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.self_outreach_org_allowed(%' and pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_self_outreach_org(%' then
   raise exception 'check 035: % must consult the served organizations',f; end if;
 end loop;
 if to_regclass('prospectos_private.self_outreach_organizations') is null then raise exception 'check 035: served organizations list missing'; end if;
 if has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','SELECT') or has_table_privilege('anon','prospectos_private.self_outreach_organizations','SELECT')
    or has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','INSERT') or has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','UPDATE')
    or has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','DELETE') then raise exception 'check 035: served organizations list exposed to clients'; end if;
 if has_function_privilege('anon',to_regprocedure('prospectos_private.self_outreach_member(uuid)'),'EXECUTE')
    or not has_function_privilege('authenticated',to_regprocedure('prospectos_private.self_outreach_member(uuid)'),'EXECUTE') then
  raise exception 'check 035: self_outreach_member execute rights'; end if;
 n:=0;
 for pol in select tablename,policyname,qual,cmd,roles from pg_policies where schemaname='public' and tablename=any(array['outreach_campaigns','outreach_contacts','outreach_candidates',
   'outreach_messages','outreach_events','outreach_suppressions','outreach_inbound','outreach_daily_counters']) loop
  n:=n+1;
  if pol.cmd<>'SELECT' or coalesce(pol.qual,'') not like '%self_outreach_member(%' then
   raise exception 'check 035: policy % on % must be SELECT and require self_outreach_member',pol.policyname,pol.tablename; end if;
 end loop;
 if n<>6 then raise exception 'check 035: % Self-Outreach policies, expected 6',n; end if;
 foreach f in array private_fns loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then
   raise exception 'check 035: % callable by clients',f; end if;
 end loop;
end $verify$;

insert into supabase_migrations.schema_migrations(version,name,statements,created_by) values(to_char(clock_timestamp() at time zone 'utc','YYYYMMDDHH24MISS'),'035_self_outreach',array['applied by Claude from the file of commit afbfbfb; file md5 981a5a5ea61ec390def9d66249f5ccd2'],'prospectos-claude-sql');
commit;
