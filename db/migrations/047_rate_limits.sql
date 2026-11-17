-- 047 — Shared rate limits (audit 2026-11-11, S2 and S3). Until now nothing bounded how many requests a signed-in account
-- could send per minute (the plan quotas bound costly actions, not the rate), and the public "3 prospects" form counted in
-- the memory of one server instance — useless on Vercel, where every instance keeps its own count. One counter table, one
-- fixed window per (bucket, subject, window start), shared by every instance.
--
-- 1. public.rate_limit_counters — key = bucket:subject, window_start, count. Server-only (RLS on, no policy, no grant).
-- 2. public.rate_limit_hit(p_bucket,p_limit,p_window_seconds) — for a signed-in caller: the subject is auth.uid(), never a
--    value the caller sends, so nobody can spend or reset another account's counter. Returns {allowed, retry_after}.
-- 3. public.rate_limit_hit_key(p_key,p_limit,p_window_seconds) — server only (service_role): for anonymous traffic the
--    server keys by a hash of the client address.
-- Rows older than 2 hours are purged on the way (about 1 call in 50), so the table stays small without a job.
-- Nothing else is touched: no existing table, policy, function, entitlement, billing or evidence object changes.
--
-- Rollback: drop function public.rate_limit_hit(text,int,int), public.rate_limit_hit_key(text,int,int);
--   drop table public.rate_limit_counters;
begin;

create table if not exists public.rate_limit_counters (
 key text not null check(length(key) between 3 and 160),
 window_start timestamptz not null,
 count int not null default 1 check(count>=1),
 primary key(key,window_start)
);
create index if not exists rate_limit_counters_window_idx on public.rate_limit_counters(window_start);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public,anon,authenticated;

create or replace function prospectos_private.rate_limit_count(p_key text,p_limit int,p_window_seconds int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w timestamptz;n int;
begin
 if p_limit is null or p_limit<1 or p_limit>10000 or p_window_seconds is null or p_window_seconds<1 or p_window_seconds>86400 then
  raise exception 'Invalid rate limit' using errcode='22023';
 end if;
 w:=to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds);
 insert into public.rate_limit_counters as c(key,window_start,count) values(p_key,w,1)
  on conflict(key,window_start) do update set count=c.count+1 returning c.count into n;
 if random()<0.02 then delete from public.rate_limit_counters where window_start<now()-interval '2 hours'; end if;
 return jsonb_build_object('allowed',n<=p_limit,'count',n,
  'retry_after',case when n<=p_limit then 0 else greatest(1,ceil(extract(epoch from (w+make_interval(secs=>p_window_seconds)-now())))::int) end);
end $$;
revoke all on function prospectos_private.rate_limit_count(text,int,int) from public,anon,authenticated;

create or replace function public.rate_limit_hit(p_bucket text,p_limit int,p_window_seconds int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_bucket is null or p_bucket!~'^[a-z_]{1,32}$' then raise exception 'Invalid bucket' using errcode='22023'; end if;
 return prospectos_private.rate_limit_count(p_bucket||':'||u::text,p_limit,p_window_seconds);
end $$;

create or replace function public.rate_limit_hit_key(p_key text,p_limit int,p_window_seconds int) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_key is null or p_key!~'^[a-z_]{1,32}:[A-Za-z0-9_-]{1,120}$' then raise exception 'Invalid key' using errcode='22023'; end if;
 return prospectos_private.rate_limit_count(p_key,p_limit,p_window_seconds);
end $$;

revoke all on function public.rate_limit_hit(text,int,int),public.rate_limit_hit_key(text,int,int) from public,anon,authenticated;
grant execute on function public.rate_limit_hit(text,int,int) to authenticated;
grant execute on function public.rate_limit_hit_key(text,int,int) to service_role;

commit;
