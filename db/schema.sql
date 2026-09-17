-- ProspectOS V0. Run once in a NEW Supabase project's SQL editor as postgres.
-- This is an install schema, not an idempotent migration over an existing app.
begin;
create schema if not exists prospectos_private;
revoke all on schema prospectos_private from public;
grant usage on schema prospectos_private to authenticated;

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 160),
 owner_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.memberships (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 role text not null default 'member' check(role in ('owner','member')), created_at timestamptz not null default now(),
 primary key(organization_id,user_id)
);
create index memberships_user_idx on public.memberships(user_id,organization_id);
create table public.projects (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 200), offer text not null default '', website text,
 created_at timestamptz not null default now(), unique(id,organization_id)
);
create table public.icps (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 project_id uuid not null unique, name text not null default 'ICP Foodatoi', criteria jsonb not null default '[]',
 created_at timestamptz not null default now(), check(jsonb_typeof(criteria) = 'array'),
 foreign key(project_id,organization_id) references public.projects(id,organization_id), unique(id,organization_id)
);
create table public.prospects (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 200), website text, city text,
 status text not null default 'À analyser' check(status in ('À analyser','Qualifié','À contacter','Contacté','Réponse','Gagné','Perdu')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id), unique(id,organization_id)
);
create table public.evidence (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, prospect_id uuid not null,
 criterion text not null check(length(criterion) between 1 and 100), value boolean,
 status text not null default 'NOT_VERIFIED' check(status in ('NOT_VERIFIED','VERIFIED','CONTRADICTED','INFERRED_UNCONFIRMED')),
 source_url text, excerpt text, observed_at timestamptz not null default now(), verified_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 check(source_url is null or source_url ~ '^https?://[^[:space:]]+$'),
 check(status not in ('VERIFIED','CONTRADICTED') or (verified_by is not null and value is not null and length(trim(source_url)) > 0 and length(trim(excerpt)) > 0 and source_url is not null and excerpt is not null)),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id), unique(id,organization_id)
);
create table public.channels (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, prospect_id uuid not null,
 kind text not null check(kind in ('linkedin','email','phone','form','whatsapp','instagram','website')),
 value text not null check(length(trim(value)) > 0), source_url text, verified boolean not null default false,
 created_at timestamptz not null default now(), check(not verified or (source_url is not null and source_url ~ '^https?://[^[:space:]]+$')),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id)
);
create table public.outreach (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, prospect_id uuid not null,
 content text not null, evidence_ids jsonb not null default '[]', channel text, provider text not null default 'template',
 created_at timestamptz not null default now(), check(jsonb_typeof(evidence_ids) = 'array'),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id)
);
create table public.events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 prospect_id uuid, actor_id uuid references auth.users(id), kind text not null, payload jsonb not null default '{}',
 created_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id)
);
create index projects_tenant_idx on public.projects(organization_id);
create index icps_tenant_idx on public.icps(organization_id,project_id);
create index prospects_project_idx on public.prospects(organization_id,project_id);
create index evidence_prospect_idx on public.evidence(organization_id,prospect_id);
create index channels_prospect_idx on public.channels(organization_id,prospect_id);
create index outreach_prospect_idx on public.outreach(organization_id,prospect_id);
create index events_prospect_idx on public.events(organization_id,prospect_id,created_at desc);

-- No privileged membership lookup needed: users may read only their own memberships.
alter table public.memberships enable row level security;
create policy membership_self on public.memberships for select to authenticated using(user_id = (select auth.uid()));
create function prospectos_private.is_member(tenant uuid) returns boolean language sql stable security invoker set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.memberships where organization_id = tenant and user_id = auth.uid());
$$;
revoke all on function prospectos_private.is_member(uuid) from public;
grant execute on function prospectos_private.is_member(uuid) to authenticated;

-- Private privileged bootstrap: public RPC is an invoker wrapper. Identity always comes from JWT.
create function prospectos_private.bootstrap_organization(name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare tenant uuid; actor uuid := auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.organizations(name,owner_id) values(name,actor) returning id into tenant;
 insert into public.memberships(organization_id,user_id,role) values(tenant,actor,'owner');
 return tenant;
end $$;
revoke all on function prospectos_private.bootstrap_organization(text) from public;
grant execute on function prospectos_private.bootstrap_organization(text) to authenticated;
create function public.create_organization(name text) returns uuid language sql security invoker set search_path = '' as $$
 select prospectos_private.bootstrap_organization(name);
$$;
revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

alter table public.organizations enable row level security;
create policy organization_read on public.organizations for select to authenticated using(prospectos_private.is_member(id));
-- Membership mutations/invitations intentionally absent in V0; no client role escalation path.
do $$ declare tbl text; begin
 foreach tbl in array array['projects','icps','prospects','evidence','channels','outreach'] loop
 execute format('alter table public.%I enable row level security',tbl);
 execute format('create policy tenant_read on public.%I for select to authenticated using (prospectos_private.is_member(organization_id))',tbl);
 execute format('create policy tenant_insert on public.%I for insert to authenticated with check (prospectos_private.is_member(organization_id))',tbl);
 execute format('create policy tenant_update on public.%I for update to authenticated using (prospectos_private.is_member(organization_id)) with check (prospectos_private.is_member(organization_id))',tbl);
 execute format('create policy tenant_delete on public.%I for delete to authenticated using (prospectos_private.is_member(organization_id))',tbl);
 end loop;
end $$;
alter table public.events enable row level security;
create policy event_read on public.events for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.organizations,public.memberships,public.projects,public.icps,public.prospects,public.evidence,public.channels,public.outreach,public.events from public,anon,authenticated;
grant select on public.organizations,public.memberships,public.events to authenticated;
grant select,insert,update,delete on public.projects,public.icps,public.prospects,public.evidence,public.channels,public.outreach to authenticated;

create function prospectos_private.guard_record() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP = 'UPDATE' and (new.id <> old.id or new.organization_id <> old.organization_id) then
 raise exception 'Identity and tenant are immutable' using errcode='42501'; end if;
 if TG_TABLE_NAME = 'prospects' then new.updated_at := now(); end if;
 if TG_TABLE_NAME = 'evidence' then
  if new.status in ('VERIFIED','CONTRADICTED') then
   if auth.uid() is null then raise exception 'Human authentication required' using errcode='42501'; end if;
   new.verified_by := auth.uid();
  else new.verified_by := null; end if;
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_record() from public;
create trigger evidence_guard before insert or update on public.evidence for each row execute function prospectos_private.guard_record();
create trigger prospect_guard before insert or update on public.prospects for each row execute function prospectos_private.guard_record();

-- Trigger-only privileged event append. No direct INSERT/UPDATE/DELETE grants or RPC.
create function prospectos_private.append_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare rowdata jsonb; tenant uuid; subject uuid;
begin
 rowdata := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
 tenant := (rowdata->>'organization_id')::uuid;
 if auth.uid() is null or not exists(select 1 from public.memberships where organization_id=tenant and user_id=auth.uid()) then
 raise exception 'Authenticated tenant member required for audit' using errcode='42501'; end if;
 subject := case when TG_TABLE_NAME='prospects' then (rowdata->>'id')::uuid else (rowdata->>'prospect_id')::uuid end;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(tenant,subject,auth.uid(),TG_TABLE_NAME||'.'||lower(TG_OP),jsonb_build_object('record_id',rowdata->>'id','status',rowdata->>'status'));
 return null;
end $$;
revoke all on function prospectos_private.append_event() from public;
create trigger prospect_event after insert or update on public.prospects for each row execute function prospectos_private.append_event();
create trigger evidence_event after insert or update or delete on public.evidence for each row execute function prospectos_private.append_event();
create function prospectos_private.deny_event_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Audit events are append-only' using errcode='42501'; end $$;
revoke all on function prospectos_private.deny_event_mutation() from public;
create trigger event_immutable before update or delete on public.events for each row execute function prospectos_private.deny_event_mutation();

-- JSON reference arrays must resolve to evidence on the same prospect and tenant.
create function prospectos_private.validate_outreach_refs() returns trigger language plpgsql security invoker set search_path = '' as $$
declare ref text;
begin
 for ref in select jsonb_array_elements_text(new.evidence_ids) loop
  if not exists(select 1 from public.evidence where id=ref::uuid and organization_id=new.organization_id and prospect_id=new.prospect_id) then
   raise exception 'Invalid evidence reference' using errcode='23503';
  end if;
 end loop;
 return new;
end $$;
revoke all on function prospectos_private.validate_outreach_refs() from public;
create trigger outreach_refs before insert or update on public.outreach for each row execute function prospectos_private.validate_outreach_refs();
commit;
