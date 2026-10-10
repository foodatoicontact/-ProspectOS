-- O1/O2 — Outreach intelligence. Additive only: no existing column, value, policy or function is removed or narrowed,
-- except that an APPROVED message's text is now locked (it was approved as written).
--
-- 1. public.outreach keeps the generated message next to the human version:
--    generated_content — the text ProspectOS generated, set once at creation (= content at that moment), then
--    immutable. Legacy rows (created before 027) keep NULL: their original is unknown and is never reconstructed
--    from content. created_by / last_edited_by / last_edited_at are set by the database from auth.uid(), never by the
--    client. The provenance of a message — angle, evidence_ids, signal_ids, public_content_ids, style_profile_id,
--    provider — is frozen at creation, so "why was this message written this way" can always be answered.
--    New references are checked: the style profile must be the author's own, public content and signals must be
--    VERIFIED and belong to the same prospect and tenant.
-- 2. public.outreach_style_profiles — one PERSONAL writing profile per user and organization. Only its owner reads
--    it; it is written only through save_outreach_style_profile (owner forced to auth.uid(), strict fields,
--    instructions ≤ 1500 characters). Never shared with the organization automatically.
-- 3. public.prospect_public_content — public content about a prospect (a post, an article…) added by a person
--    (user_provided) — or later by a provider ProspectOS explicitly authorizes (authorized_provider, server only;
--    none exists yet). It is NOT evidence and NOT a signal: no row here creates, changes or verifies evidence or
--    signals, and neither FIT nor INTENT reads it. It only feeds personalisation (the outreach angle) once a person
--    VERIFIED it. Written only through functions; members read through RLS; one pinned item per prospect.
--
-- Rollback: drop function public.save_outreach_style_profile(uuid,jsonb), public.save_public_content(uuid,jsonb),
-- public.review_public_content(uuid,text), public.pin_public_content(uuid,boolean), public.delete_public_content(uuid),
-- prospectos_private.guard_outreach_intelligence(), prospectos_private.guard_public_content();
-- drop trigger outreach_intelligence_guard on public.outreach; drop table public.prospect_public_content,
-- public.outreach_style_profiles; alter table public.outreach drop column generated_content, created_by,
-- last_edited_by, last_edited_at, style_profile_id, angle, public_content_ids.
begin;

create table if not exists public.outreach_style_profiles (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id),
 tone text not null default 'professional_conversational' check(tone in ('professional_conversational','formal','warm','direct')),
 address_mode text not null default 'auto' check(address_mode in ('auto','vous','tu')),
 length text not null default 'short' check(length in ('short','medium')),
 max_chars int not null default 600 check(max_chars between 200 and 2000),
 banned_phrases jsonb not null default '[]' check(jsonb_typeof(banned_phrases)='array' and jsonb_array_length(banned_phrases)<=30),
 preferred_ctas jsonb not null default '[]' check(jsonb_typeof(preferred_ctas)='array' and jsonb_array_length(preferred_ctas)<=10),
 instructions text not null default '' check(length(instructions)<=1500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,user_id),
 unique(id,organization_id)
);
alter table public.outreach_style_profiles enable row level security;
drop policy if exists outreach_style_profiles_read on public.outreach_style_profiles;
create policy outreach_style_profiles_read on public.outreach_style_profiles for select to authenticated
 using(user_id=auth.uid() and prospectos_private.is_member(organization_id));
revoke all on public.outreach_style_profiles from public,anon,authenticated;
grant select on public.outreach_style_profiles to authenticated;

create table if not exists public.prospect_public_content (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 project_id uuid not null,
 prospect_id uuid not null,
 source_type text not null check(source_type in ('user_provided','authorized_provider')),
 source_url text not null check(source_url ~ '^https?://[^[:space:]]+$' and length(source_url)<=2048),
 source_domain text generated always as (lower(substring(source_url from '^https?://([^/:?#]+)'))) stored,
 author text check(author is null or length(trim(author)) between 1 and 200),
 content text not null check(length(trim(content)) between 1 and 4000),
 published_at timestamptz,
 observed_at timestamptz not null,
 provider text not null check(provider ~ '^[a-z_]{1,40}$'),
 status text not null default 'PENDING_REVIEW' check(status in ('PENDING_REVIEW','VERIFIED','REJECTED')),
 pinned boolean not null default false,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(prospect_id,organization_id) references public.prospects(id,organization_id) on delete cascade,
 foreign key(project_id,organization_id) references public.projects(id,organization_id),
 unique(prospect_id,content_hash),
 check(not pinned or status='VERIFIED'),
 check(status<>'VERIFIED' or (reviewed_by is not null and reviewed_at is not null)),
 check(published_at is null or published_at<=observed_at+interval '1 day')
);
create index if not exists prospect_public_content_prospect_idx on public.prospect_public_content(organization_id,prospect_id,status);
create unique index if not exists prospect_public_content_one_pin on public.prospect_public_content(prospect_id) where pinned;
alter table public.prospect_public_content enable row level security;
drop policy if exists prospect_public_content_read on public.prospect_public_content;
create policy prospect_public_content_read on public.prospect_public_content for select to authenticated using(prospectos_private.is_member(organization_id));
revoke all on public.prospect_public_content from public,anon,authenticated;
grant select on public.prospect_public_content to authenticated;

-- What was observed never changes: only the review (status, reviewer, pin) may.
create or replace function prospectos_private.guard_public_content() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'reviewed_by'-'reviewed_at'-'pinned'-'updated_at'-'source_domain')
    is distinct from (to_jsonb(old)-'status'-'reviewed_by'-'reviewed_at'-'pinned'-'updated_at'-'source_domain') then
  raise exception 'Public content is immutable once observed: only the review may change' using errcode='42501';
 end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function prospectos_private.guard_public_content() from public,anon,authenticated;
drop trigger if exists public_content_guard on public.prospect_public_content;
create trigger public_content_guard before update on public.prospect_public_content for each row execute function prospectos_private.guard_public_content();

alter table public.outreach add column if not exists generated_content text check(generated_content is null or length(generated_content)<=4000);
alter table public.outreach add column if not exists created_by uuid references auth.users(id);
alter table public.outreach add column if not exists last_edited_by uuid references auth.users(id);
alter table public.outreach add column if not exists last_edited_at timestamptz;
alter table public.outreach add column if not exists style_profile_id uuid references public.outreach_style_profiles(id);
alter table public.outreach add column if not exists angle jsonb check(angle is null or (jsonb_typeof(angle)='object' and length(angle::text)<=4096));
alter table public.outreach add column if not exists public_content_ids jsonb not null default '[]'
 check(jsonb_typeof(public_content_ids)='array' and jsonb_array_length(public_content_ids)<=20);

-- A non-array reference list is left to the column's own check constraint. Security invoker: the reference checks read through the caller's own RLS (another user's style profile, another
-- tenant's content or signal is simply not visible, hence refused).
create or replace function prospectos_private.guard_outreach_intelligence() returns trigger
language plpgsql security invoker set search_path='' as $$
declare ref text;
begin
 if TG_OP='INSERT' then
  new.created_by:=auth.uid(); new.last_edited_by:=null; new.last_edited_at:=null;
  if new.generated_content is null then new.generated_content:=new.content;
  elsif new.generated_content is distinct from new.content then
   raise exception 'generated_content must equal content when a message is created' using errcode='22023';
  end if;
  if new.style_profile_id is not null and not exists(select 1 from public.outreach_style_profiles s
     where s.id=new.style_profile_id and s.organization_id=new.organization_id and s.user_id=auth.uid()) then
   raise exception 'Invalid style profile reference' using errcode='23503';
  end if;
  for ref in select jsonb_array_elements_text(case when jsonb_typeof(new.public_content_ids)='array' then new.public_content_ids else '[]' end) loop
   if not exists(select 1 from public.prospect_public_content c where c.id=ref::uuid and c.organization_id=new.organization_id
      and c.prospect_id=new.prospect_id and c.status='VERIFIED') then
    raise exception 'Invalid public content reference' using errcode='23503';
   end if;
  end loop;
  for ref in select jsonb_array_elements_text(case when jsonb_typeof(new.signal_ids)='array' then new.signal_ids else '[]' end) loop
   if not exists(select 1 from public.signals s where s.id=ref::uuid and s.organization_id=new.organization_id
      and s.prospect_id=new.prospect_id and s.status='VERIFIED') then
    raise exception 'Invalid signal reference' using errcode='23503';
   end if;
  end loop;
  return new;
 end if;
 if new.generated_content is distinct from old.generated_content or new.created_by is distinct from old.created_by
    or new.style_profile_id is distinct from old.style_profile_id or new.angle is distinct from old.angle
    or new.public_content_ids is distinct from old.public_content_ids or new.signal_ids is distinct from old.signal_ids
    or new.evidence_ids is distinct from old.evidence_ids or new.provider is distinct from old.provider
    or new.prospect_id is distinct from old.prospect_id or new.created_at is distinct from old.created_at then
  raise exception 'Outreach provenance is immutable' using errcode='42501';
 end if;
 if new.content is distinct from old.content then
  if old.status='APPROVED' then raise exception 'An approved outreach message is locked' using errcode='42501'; end if;
  new.last_edited_by:=auth.uid(); new.last_edited_at:=now();
 else
  if new.last_edited_by is distinct from old.last_edited_by or new.last_edited_at is distinct from old.last_edited_at then
   raise exception 'Outreach provenance is immutable' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function prospectos_private.guard_outreach_intelligence() from public,anon,authenticated;
drop trigger if exists outreach_intelligence_guard on public.outreach;
create trigger outreach_intelligence_guard before insert or update on public.outreach
 for each row execute function prospectos_private.guard_outreach_intelligence();

-- p_profile: exactly {tone, address_mode, length, max_chars, banned_phrases[], preferred_ctas[], instructions}.
create or replace function public.save_outreach_style_profile(p_organization_id uuid, p_profile jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.outreach_style_profiles;
 allowed text[]:=array['tone','address_mode','length','max_chars','banned_phrases','preferred_ctas','instructions'];
begin
 perform prospectos_private.require_member(p_organization_id);
 if jsonb_typeof(p_profile)<>'object' or exists(select 1 from jsonb_object_keys(p_profile) k where not k=any(allowed))
    or coalesce(p_profile->>'tone','') not in ('professional_conversational','formal','warm','direct')
    or coalesce(p_profile->>'address_mode','') not in ('auto','vous','tu')
    or coalesce(p_profile->>'length','') not in ('short','medium')
    or jsonb_typeof(p_profile->'max_chars')<>'number' or (p_profile->>'max_chars')::numeric not between 200 and 2000 or (p_profile->>'max_chars')::numeric<>trunc((p_profile->>'max_chars')::numeric)
    or jsonb_typeof(coalesce(p_profile->'banned_phrases','[]'))<>'array' or jsonb_array_length(coalesce(p_profile->'banned_phrases','[]'))>30
    or exists(select 1 from jsonb_array_elements(coalesce(p_profile->'banned_phrases','[]')) t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 2 and 120)
    or jsonb_typeof(coalesce(p_profile->'preferred_ctas','[]'))<>'array' or jsonb_array_length(coalesce(p_profile->'preferred_ctas','[]'))>10
    or exists(select 1 from jsonb_array_elements(coalesce(p_profile->'preferred_ctas','[]')) t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 2 and 200)
    or jsonb_typeof(coalesce(p_profile->'instructions','""'))<>'string' or length(coalesce(p_profile->>'instructions',''))>1500 then
  raise exception 'Invalid style profile' using errcode='22023';
 end if;
 insert into public.outreach_style_profiles(organization_id,user_id,tone,address_mode,length,max_chars,banned_phrases,preferred_ctas,instructions)
 values(p_organization_id,auth.uid(),p_profile->>'tone',p_profile->>'address_mode',p_profile->>'length',(p_profile->>'max_chars')::int,
  coalesce(p_profile->'banned_phrases','[]'),coalesce(p_profile->'preferred_ctas','[]'),coalesce(p_profile->>'instructions',''))
 on conflict(organization_id,user_id) do update set tone=excluded.tone,address_mode=excluded.address_mode,length=excluded.length,max_chars=excluded.max_chars,
  banned_phrases=excluded.banned_phrases,preferred_ctas=excluded.preferred_ctas,instructions=excluded.instructions,updated_at=now()
 returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.save_outreach_style_profile(uuid,jsonb) from public,anon;
grant execute on function public.save_outreach_style_profile(uuid,jsonb) to authenticated;

-- One public content added by a person: exactly {source_url, content, author?, published_at?}. Saved user_provided,
-- PENDING_REVIEW; hash and observation date by the database. The same text on the same prospect is kept once.
create or replace function public.save_public_content(p_prospect_id uuid, p_item jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; project uuid; pa timestamptz; hash text; row_id uuid;
 allowed text[]:=array['source_url','content','author','published_at'];
begin
 select organization_id,project_id into tenant,project from public.prospects where id=p_prospect_id;
 if tenant is null then raise exception 'Prospect not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(tenant);
 if jsonb_typeof(p_item)<>'object' or exists(select 1 from jsonb_object_keys(p_item) k where not k=any(allowed))
    or jsonb_typeof(p_item->'source_url')<>'string' or jsonb_typeof(p_item->'content')<>'string'
    or length(trim(p_item->>'content')) not between 1 and 4000 or (p_item->>'source_url') !~ '^https?://[^[:space:]]+$'
    or (p_item ? 'author' and jsonb_typeof(p_item->'author') not in ('string','null')) then
  raise exception 'Invalid public content' using errcode='22023';
 end if;
 begin pa:=nullif(p_item->>'published_at','')::timestamptz; exception when others then raise exception 'Invalid public content' using errcode='22023'; end;
 if pa is not null and pa>now()+interval '1 day' then raise exception 'Invalid public content' using errcode='22023'; end if;
 hash:=encode(sha256(convert_to(trim(p_item->>'content'),'UTF8')),'hex');
 insert into public.prospect_public_content(organization_id,project_id,prospect_id,source_type,source_url,author,content,published_at,observed_at,provider,content_hash,created_by)
 values(tenant,project,p_prospect_id,'user_provided',p_item->>'source_url',nullif(trim(coalesce(p_item->>'author','')),''),trim(p_item->>'content'),pa,now(),'user',hash,auth.uid())
 on conflict(prospect_id,content_hash) do nothing returning id into row_id;
 if row_id is null then
  select id into row_id from public.prospect_public_content where prospect_id=p_prospect_id and content_hash=hash;
  return jsonb_build_object('id',row_id,'duplicate',true);
 end if;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(tenant,p_prospect_id,auth.uid(),'public_content.saved',jsonb_build_object('public_content_id',row_id));
 return jsonb_build_object('id',row_id,'duplicate',false);
end $$;
revoke all on function public.save_public_content(uuid,jsonb) from public,anon;
grant execute on function public.save_public_content(uuid,jsonb) to authenticated;

-- A person reviews public content: verify (it may now inspire an angle), reject, or reset to review. Leaving
-- VERIFIED removes the pin.
create or replace function public.review_public_content(p_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.prospect_public_content;
begin
 select * into c from public.prospect_public_content where id=p_id for update;
 if not found then raise exception 'Public content not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 if p_decision not in ('verify','reject','reset') then raise exception 'Invalid review decision' using errcode='22023'; end if;
 update public.prospect_public_content set
  status=case p_decision when 'verify' then 'VERIFIED' when 'reject' then 'REJECTED' else 'PENDING_REVIEW' end,
  reviewed_by=case when p_decision='reset' then null else auth.uid() end,
  reviewed_at=case when p_decision='reset' then null else now() end,
  pinned=case when p_decision='verify' then pinned else false end
 where id=c.id returning * into c;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(c.organization_id,c.prospect_id,auth.uid(),'public_content.'||p_decision,jsonb_build_object('public_content_id',c.id));
 return to_jsonb(c);
end $$;
revoke all on function public.review_public_content(uuid,text) from public,anon;
grant execute on function public.review_public_content(uuid,text) to authenticated;

-- Pin a VERIFIED item as the preferred angle for its prospect (the previous pin, if any, is removed).
create or replace function public.pin_public_content(p_id uuid, p_pinned boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.prospect_public_content;
begin
 select * into c from public.prospect_public_content where id=p_id for update;
 if not found then raise exception 'Public content not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 if p_pinned is null then raise exception 'Invalid pin' using errcode='22023'; end if;
 if p_pinned and c.status<>'VERIFIED' then raise exception 'Only verified public content can be pinned' using errcode='22023'; end if;
 if p_pinned then update public.prospect_public_content set pinned=false where prospect_id=c.prospect_id and pinned and id<>c.id; end if;
 update public.prospect_public_content set pinned=p_pinned where id=c.id returning * into c;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(c.organization_id,c.prospect_id,auth.uid(),case when p_pinned then 'public_content.pin' else 'public_content.unpin' end,jsonb_build_object('public_content_id',c.id));
 return to_jsonb(c);
end $$;
revoke all on function public.pin_public_content(uuid,boolean) from public,anon;
grant execute on function public.pin_public_content(uuid,boolean) to authenticated;

-- Delete one public content (a message that used it keeps its own frozen angle).
create or replace function public.delete_public_content(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.prospect_public_content;
begin
 select * into c from public.prospect_public_content where id=p_id for update;
 if not found then raise exception 'Public content not found' using errcode='P0002'; end if;
 perform prospectos_private.require_member(c.organization_id);
 delete from public.prospect_public_content where id=c.id;
 insert into public.events(organization_id,prospect_id,actor_id,kind,payload)
 values(c.organization_id,c.prospect_id,auth.uid(),'public_content.delete',jsonb_build_object('public_content_id',c.id));
 return true;
end $$;
revoke all on function public.delete_public_content(uuid) from public,anon;
grant execute on function public.delete_public_content(uuid) to authenticated;

commit;
