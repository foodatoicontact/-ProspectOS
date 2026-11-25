-- 054 — Weekly watch on how the BODACC « Ventes et cessions » notices are sorted (src/domain/bodacc-purchase.ts,
-- src/collect/sale-quality.ts). Owner decision, 25 nov. 2026: the sort is automatic (purchase, contribution, merger,
-- court-ordered sale, undetermined), so a change in the register's wording must raise an alert instead of a silent error.
--
-- 1. public.public_event_runs.sale_rules — for each collection run, how many notices each rule decided:
--    {"category_purchase": 51, "text_merger": 47, …}. Rule ids and counts only: never a notice, a name or any text.
-- 2. public.ingest_public_events(…, p_sale_rules) — the same function as migration 045 with one more argument, defaulting to
--    {} so a call with the five arguments of 045 behaves exactly as before. The counts are validated: an object of at most
--    32 keys, each a rule id ([a-z_]{1,40}) mapped to a count between 0 and 100 000.
-- 3. public.bodacc_sale_rule_weeks(p_until, p_weeks) — the counts summed per week of 7 days ending before p_until, newest
--    first, for the weekly check. Server only (service_role), like every function of 045.
-- Nothing else changes: no event, no company record, no client table, policy, billing or evidence object.
--
-- Rollback: drop function public.bodacc_sale_rule_weeks(date,int); drop function public.ingest_public_events(text,date,jsonb,int,int,jsonb);
--   re-run the ingest_public_events definition and its grants from 045; alter table public.public_event_runs drop column sale_rules.
begin;

alter table public.public_event_runs add column if not exists sale_rules jsonb not null default '{}'::jsonb;
alter table public.public_event_runs drop constraint if exists public_event_runs_sale_rules_object;
alter table public.public_event_runs add constraint public_event_runs_sale_rules_object check (jsonb_typeof(sale_rules)='object');

drop function if exists public.ingest_public_events(text,date,jsonb,int,int);
create or replace function public.ingest_public_events(p_source text,p_day date,p_events jsonb,p_fetched int,p_skipped_persons int,p_sale_rules jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n int; rules jsonb:=coalesce(p_sale_rules,'{}'::jsonb);
begin
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>20000 then raise exception 'Invalid events' using errcode='22023'; end if;
 if jsonb_typeof(rules)<>'object' or (select count(*) from jsonb_object_keys(rules))>32
  or exists(select 1 from jsonb_each(rules) r where r.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(r.value)<>'number'
   or (r.value)::numeric<0 or (r.value)::numeric>100000 or (r.value)::numeric<>trunc((r.value)::numeric))
 then raise exception 'Invalid sale rules' using errcode='22023'; end if;
 with rows as (
  insert into public.public_events(source,source_id,kind,siren,name,published_on,department,commune,postal_code,activity,source_url)
  select p_source,e->>'source_id',e->>'kind',e->>'siren',nullif(left(e->>'name',200),''),(e->>'published_on')::date,nullif(e->>'department',''),
   nullif(left(e->>'commune',120),''),nullif(e->>'postal_code',''),nullif(left(e->>'activity',500),''),e->>'source_url'
  from jsonb_array_elements(p_events) e
  on conflict(source,source_id) do nothing returning 1)
 select count(*) into n from rows;
 insert into public.public_event_runs(source,day,fetched,inserted,skipped_persons,sale_rules)
  values(p_source,p_day,coalesce(p_fetched,0),n,coalesce(p_skipped_persons,0),rules);
 return jsonb_build_object('inserted',n);
end $$;

-- [{"week_start":"2026-11-17","rules":{"category_purchase":350,…},"runs":7}, …] — weeks of 7 days ending the day before
-- p_until, newest first; a run counts in the week of the day it collected. A replayed day counts once (its latest run).
create or replace function public.bodacc_sale_rule_weeks(p_until date,p_weeks int) returns jsonb
language sql stable security definer set search_path='' as $$
 with latest as (
  select distinct on (r.day) r.day,r.sale_rules from public.public_event_runs r
  where r.source='bodacc' and r.sale_rules<>'{}'::jsonb and r.day<p_until and r.day>=p_until-7*greatest(1,least(coalesce(p_weeks,5),26))
  order by r.day,r.created_at desc),
 weeks as (
  select p_until-7*(((p_until-1-l.day)/7)+1) as week_start,count(*) as runs from latest l group by 1),
 sums as (
  select p_until-7*(((p_until-1-l.day)/7)+1) as week_start,k.key,sum((k.value)::bigint) as n
  from latest l cross join lateral jsonb_each(l.sale_rules) k group by 1,2)
 select coalesce(jsonb_agg(jsonb_build_object('week_start',w.week_start,'runs',w.runs,
  'rules',(select coalesce(jsonb_object_agg(s.key,s.n),'{}'::jsonb) from sums s where s.week_start=w.week_start)) order by w.week_start desc),'[]'::jsonb)
 from weeks w
$$;

revoke all on function public.ingest_public_events(text,date,jsonb,int,int,jsonb),public.bodacc_sale_rule_weeks(date,int) from public,anon,authenticated;
grant execute on function public.ingest_public_events(text,date,jsonb,int,int,jsonb),public.bodacc_sale_rule_weeks(date,int) to service_role;

commit;
