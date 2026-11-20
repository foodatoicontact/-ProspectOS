-- 042 — Demo links (src/demo-share, app/d/[token]): a project owner hands a prospect a read-only link showing the
-- companies of ONE project, without an account. The person can then create an account and keep a copy.
--
-- 1. public.demo_shares — one row per link: project, creator, the SHA-256 of the token (the token itself is drawn by the
--    server, shown once to the owner and never stored), expiry (14 days by default), revocation, an optional target line
--    shown on the page, and the view counter. Owners of the project's organization read their links (RLS) — every column
--    except token_hash, which no browser role can read. No direct write: only the functions below.
-- 2. public.demo_share_claims — who copied which link into which project (one copy per account and link).
-- 3. Owner functions (authenticated): create_demo_share(project, token_hash, target, days) and revoke_demo_share(id).
--    Both require the caller to be an OWNER of the project's organization.
-- 4. Server only (service_role — the public page has no session):
--    read_demo_share(token_hash) returns the page's content — the project name, the target line and the project's
--    prospects with their non-rejected signals — or NULL when the hash is unknown, expired or revoked (the three are not
--    told apart). It reads; it never writes. Only company data leaves: name, city, the signal's type, dates, title,
--    exact excerpt, official source URL and its display keys (raw_metadata->'demo'). No channel (phone, email), no
--    evidence, no status, no message, nothing of another project.
--    record_demo_share_view(token_hash) counts one human view and says, once per link, that it is the first one, with the
--    creator's sign-in email for the notification. Preview robots are never passed to it (src/demo-share/bots.ts).
-- 5. public.claim_demo_share(token_hash) (authenticated): copies the project, its targeting (icps) and its prospects
--    with their signals into the caller's own organization (created when the account has none). Signals arrive as
--    PENDING_REVIEW, never VERIFIED: a review made by someone else is not inherited. Evidence, channels, messages,
--    statuses and history are not copied. A member of the source organization is refused (nothing to copy to oneself).
-- Nothing else is touched: no existing table, policy, function, quota, entitlement or billing object changes.
--
-- Rollback: drop function public.claim_demo_share(text), public.record_demo_share_view(text), public.read_demo_share(text),
-- public.revoke_demo_share(uuid), public.create_demo_share(uuid,text,text,int); drop table public.demo_share_claims,
-- public.demo_shares. Copied projects are ordinary projects of their new owner and stay.
begin;

create table if not exists public.demo_shares (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 created_by uuid not null references auth.users(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 target text check(target is null or length(trim(target)) between 1 and 300),
 expires_at timestamptz not null default (now()+interval '14 days'),
 revoked_at timestamptz,
 view_count int not null default 0 check(view_count>=0),
 last_viewed_at timestamptz,
 notified_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete cascade
);
create index if not exists demo_shares_project_idx on public.demo_shares(organization_id,project_id,created_at desc);

create table if not exists public.demo_share_claims (
 share_id uuid not null references public.demo_shares(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid references public.projects(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key(share_id,user_id)
);

alter table public.demo_shares enable row level security;
alter table public.demo_share_claims enable row level security;
drop policy if exists demo_shares_owner_read on public.demo_shares;
create policy demo_shares_owner_read on public.demo_shares for select to authenticated using (
 exists(select 1 from public.memberships m where m.organization_id=demo_shares.organization_id and m.user_id=(select auth.uid()) and m.role='owner'));
revoke all on public.demo_shares,public.demo_share_claims from public,anon,authenticated;
-- Every column but token_hash and notified_at: the hash never reaches a browser.
grant select(id,organization_id,project_id,created_by,target,expires_at,revoked_at,view_count,last_viewed_at,created_at) on public.demo_shares to authenticated;

create or replace function public.create_demo_share(p_project_id uuid,p_token_hash text,p_target text default null,p_days int default 14) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; row public.demo_shares;
begin
 select organization_id into tenant from public.projects where id=p_project_id;
 if tenant is null then raise exception 'Project not found' using errcode='P0002'; end if;
 perform prospectos_private.require_owner(tenant);
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_days is null or p_days not between 1 and 90
    or (p_target is not null and length(trim(p_target))>300) then
  raise exception 'Invalid demo share' using errcode='22023';
 end if;
 if (select count(*) from public.demo_shares s where s.project_id=p_project_id and s.revoked_at is null and s.expires_at>now())>=20 then
  raise exception 'demo_share_limit' using errcode='P0001';
 end if;
 insert into public.demo_shares(organization_id,project_id,created_by,token_hash,target,expires_at)
 values(tenant,p_project_id,auth.uid(),p_token_hash,nullif(trim(coalesce(p_target,'')),''),now()+make_interval(days=>p_days)) returning * into row;
 return jsonb_build_object('id',row.id,'project_id',row.project_id,'target',row.target,'expires_at',row.expires_at,'revoked_at',row.revoked_at,
  'view_count',row.view_count,'last_viewed_at',row.last_viewed_at,'created_at',row.created_at);
end $$;
revoke all on function public.create_demo_share(uuid,text,text,int) from public,anon;
grant execute on function public.create_demo_share(uuid,text,text,int) to authenticated;

create or replace function public.revoke_demo_share(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare tenant uuid;
begin
 select organization_id into tenant from public.demo_shares where id=p_id;
 if tenant is null then raise exception 'Demo share not found' using errcode='P0002'; end if;
 perform prospectos_private.require_owner(tenant);
 update public.demo_shares set revoked_at=coalesce(revoked_at,now()) where id=p_id;
 return true;
end $$;
revoke all on function public.revoke_demo_share(uuid) from public,anon;
grant execute on function public.revoke_demo_share(uuid) to authenticated;

create or replace function public.read_demo_share(p_token_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'project',jsonb_build_object('name',p.name),
  'target',s.target,
  'expires_at',s.expires_at,
  'prospects',coalesce((select jsonb_agg(jsonb_build_object('name',x.name,'city',x.city,
     'signals',coalesce((select jsonb_agg(jsonb_build_object('signal_type',g.signal_type,'title',g.title,'excerpt',g.excerpt,'source_url',g.source_url,
        'source_type',g.source_type,'event_date',g.event_date,'published_at',g.published_at,'demo',coalesce(g.raw_metadata->'demo','{}'::jsonb))
        order by coalesce(g.event_date,g.published_at::date,g.observed_at::date) desc,g.id)
       from public.signals g where g.prospect_id=x.id and g.project_id=s.project_id and g.organization_id=s.organization_id and g.status<>'REJECTED'),'[]'::jsonb))
     order by x.created_at,x.id)
    from (select * from public.prospects q where q.project_id=s.project_id and q.organization_id=s.organization_id order by q.created_at,q.id limit 500) x),'[]'::jsonb))
 from public.demo_shares s join public.projects p on p.id=s.project_id and p.organization_id=s.organization_id
 where p_token_hash is not null and s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now()
$$;
revoke all on function public.read_demo_share(text) from public,anon,authenticated;
grant execute on function public.read_demo_share(text) to service_role;

create or replace function public.record_demo_share_view(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row public.demo_shares; first boolean:=false; mail text; project text;
begin
 update public.demo_shares set view_count=view_count+1,last_viewed_at=now()
  where token_hash=p_token_hash and revoked_at is null and expires_at>now() returning * into row;
 if not found then return null; end if;
 -- The first human view is announced once, whatever the number of concurrent openings.
 update public.demo_shares set notified_at=now() where id=row.id and notified_at is null;
 first:=found;
 if first then
  select u.email into mail from auth.users u where u.id=row.created_by;
  select p.name into project from public.projects p where p.id=row.project_id;
 end if;
 return jsonb_build_object('first',first,'view_count',row.view_count,'viewed_at',row.last_viewed_at,'project_name',project,'owner_email',mail);
end $$;
revoke all on function public.record_demo_share_view(text) from public,anon,authenticated;
grant execute on function public.record_demo_share_view(text) to service_role;

create or replace function public.claim_demo_share(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.demo_shares; src public.projects; tenant uuid; target_project uuid; known public.demo_share_claims; copied int:=0;
 p record; new_prospect uuid;
begin
 if actor is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 select * into s from public.demo_shares where p_token_hash is not null and token_hash=p_token_hash and revoked_at is null and expires_at>now();
 if not found then raise exception 'demo_share_invalid' using errcode='P0001'; end if;
 if exists(select 1 from public.memberships m where m.organization_id=s.organization_id and m.user_id=actor) then
  raise exception 'demo_share_own' using errcode='P0001';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('demo-claim:'||s.id::text||':'||actor::text,0));
 select * into known from public.demo_share_claims where share_id=s.id and user_id=actor;
 if found then return jsonb_build_object('project_id',known.project_id,'copied',false,'prospects',0); end if;
 select m.organization_id into tenant from public.memberships m where m.user_id=actor and m.role='owner' order by m.created_at,m.organization_id limit 1;
 if tenant is null then tenant:=prospectos_private.bootstrap_organization('Mon espace'); end if;
 select * into src from public.projects where id=s.project_id and organization_id=s.organization_id;
 insert into public.projects(organization_id,name,offer) values(tenant,src.name,src.offer) returning id into target_project;
 insert into public.icps(organization_id,project_id,name,criteria)
  select tenant,target_project,i.name,i.criteria from public.icps i where i.project_id=s.project_id and i.organization_id=s.organization_id;
 for p in select * from public.prospects q where q.project_id=s.project_id and q.organization_id=s.organization_id order by q.created_at,q.id limit 500 loop
  insert into public.prospects(organization_id,project_id,name,website,city,status) values(tenant,target_project,p.name,p.website,p.city,'À analyser') returning id into new_prospect;
  insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,event_date,published_at,observed_at,
    confidence,matched_terms,content_hash,event_key,raw_metadata,purge_after)
   select tenant,target_project,new_prospect,g.provider,g.signal_type,g.title,g.excerpt,g.source_url,g.source_type,g.event_date,g.published_at,g.observed_at,
    g.confidence,g.matched_terms,g.content_hash,g.event_key,g.raw_metadata,now()+interval '60 days'
   from public.signals g where g.prospect_id=p.id and g.organization_id=s.organization_id and g.status<>'REJECTED';
  copied:=copied+1;
 end loop;
 insert into public.demo_share_claims(share_id,user_id,project_id) values(s.id,actor,target_project);
 return jsonb_build_object('project_id',target_project,'copied',true,'prospects',copied);
end $$;
revoke all on function public.claim_demo_share(text) from public,anon;
grant execute on function public.claim_demo_share(text) to authenticated;

commit;
