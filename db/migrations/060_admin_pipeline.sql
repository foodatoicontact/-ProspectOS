-- 060 — Cockpit administrateur, écran Pipeline (docs/ADMIN_COCKPIT.md, décision du propriétaire du 26 nov. 2026): the
-- requests received by the two public forms (056: « 3 prospects de votre zone » and « veille dédiée ») followed in columns
-- Nouveau / Contacté / Démo / Devis / Signé / Perdu.
--
-- 1. public.admin_pipeline — the current stage of a request (no row: « Nouveau »), with who moved it, when, and a version
--    for optimistic concurrency: a move made from a stale screen (another tab, another device) is refused, never silently
--    overwrites. Deleted with its request (12-month retention of 056).
-- 2. public.admin_pipeline_moves — the history of the moves: APPEND-ONLY (no UPDATE, no TRUNCATE for any role, the owner
--    included; a DELETE only through the deletion of its request, i.e. the 12-month retention).
-- 3. public.admin_pipeline(p_kinds) — the board: the requests (at most 500, newest first; never more than 12 months old by
--    the retention) with their stage. public.admin_pipeline_move(p_request,p_stage,p_version) — one move.
--
-- Who may do what: the administrator only (ACTIVE INTERNAL entitlement): every function checks it, RLS hides every row
-- from anyone else, no client account and no anonymous visitor reads or writes any of it. No CRM function for clients.
-- Nothing else changes: no existing table, policy, entitlement, billing or evidence object is touched.
--
-- Rollback: drop function public.admin_pipeline(text[]), public.admin_pipeline_move(uuid,text,int),
--   prospectos_private.deny_admin_pipeline_move_mutation(); drop table public.admin_pipeline_moves, public.admin_pipeline;
begin;

create table if not exists public.admin_pipeline (
 request_id uuid primary key references public.contact_requests(id) on delete cascade,
 stage text not null check(stage in ('NEW','CONTACTED','DEMO','QUOTE','SIGNED','LOST')),
 version int not null default 1 check(version>=1),
 moved_at timestamptz not null default now(),
 moved_by uuid not null references auth.users(id)
);

create table if not exists public.admin_pipeline_moves (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.contact_requests(id) on delete cascade,
 from_stage text not null check(from_stage in ('NEW','CONTACTED','DEMO','QUOTE','SIGNED','LOST')),
 to_stage text not null check(to_stage in ('NEW','CONTACTED','DEMO','QUOTE','SIGNED','LOST') and to_stage<>from_stage),
 moved_by uuid not null references auth.users(id),
 moved_at timestamptz not null default now()
);
create index if not exists admin_pipeline_moves_request_idx on public.admin_pipeline_moves(request_id,id desc);

-- Append-only: the only DELETE allowed is the cascade of its request's deletion (the request is already gone).
create or replace function prospectos_private.deny_admin_pipeline_move_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.contact_requests where id=old.request_id) then return old; end if;
 raise exception 'admin_pipeline_moves is append-only' using errcode='42501';
end $$;
drop trigger if exists admin_pipeline_moves_no_update on public.admin_pipeline_moves;
create trigger admin_pipeline_moves_no_update before update or delete on public.admin_pipeline_moves for each row execute function prospectos_private.deny_admin_pipeline_move_mutation();
drop trigger if exists admin_pipeline_moves_no_truncate on public.admin_pipeline_moves;
create trigger admin_pipeline_moves_no_truncate before truncate on public.admin_pipeline_moves for each statement execute function prospectos_private.deny_admin_pipeline_move_mutation();

alter table public.admin_pipeline enable row level security;
alter table public.admin_pipeline_moves enable row level security;
revoke all on public.admin_pipeline,public.admin_pipeline_moves from public,anon,authenticated;
grant select on public.admin_pipeline,public.admin_pipeline_moves to authenticated;
drop policy if exists admin_pipeline_admin_read on public.admin_pipeline;
create policy admin_pipeline_admin_read on public.admin_pipeline for select to authenticated using (prospectos_private.is_internal_admin());
drop policy if exists admin_pipeline_moves_admin_read on public.admin_pipeline_moves;
create policy admin_pipeline_moves_admin_read on public.admin_pipeline_moves for select to authenticated using (prospectos_private.is_internal_admin());

create or replace function public.admin_pipeline(p_kinds text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_kinds is not null and (cardinality(p_kinds)>2 or not p_kinds<@array['PROSPECTS','WATCH']) then raise exception 'admin_query_invalid' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x order by (x->>'created_at') desc,x->>'id'),'[]'::jsonb) into r from (
  select jsonb_build_object('id',c.id,'kind',c.kind,'activity',c.activity,'target',c.target,'department',c.department,'email',c.email,
   'company',c.company,'message',c.message,'created_at',c.created_at,
   'stage',coalesce(p.stage,'NEW'),'version',coalesce(p.version,0),'moved_at',p.moved_at,
   'moved_by',(select email from auth.users where id=p.moved_by)) x
  from public.contact_requests c left join public.admin_pipeline p on p.request_id=c.id
  where p_kinds is null or c.kind=any(p_kinds)
  order by c.created_at desc,c.id limit 500) t;
 return jsonb_build_object('items',r,'total',(select count(*) from public.contact_requests c where p_kinds is null or c.kind=any(p_kinds)));
end $$;

-- p_version: the version the screen showed (0 for a request still « Nouveau » and never moved). Another version → refused.
create or replace function public.admin_pipeline_move(p_request uuid,p_stage text,p_version int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cur public.admin_pipeline; from_stage text; n public.admin_pipeline;
begin
 if not prospectos_private.is_internal_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_stage is null or p_stage not in ('NEW','CONTACTED','DEMO','QUOTE','SIGNED','LOST') or p_version is null or p_version<0 then
  raise exception 'admin_query_invalid' using errcode='22023'; end if;
 perform 1 from public.contact_requests where id=p_request for update;
 if not found then raise exception 'admin_request_not_found' using errcode='P0002'; end if;
 select * into cur from public.admin_pipeline where request_id=p_request;
 if coalesce(cur.version,0)<>p_version then raise exception 'admin_pipeline_conflict' using errcode='40001'; end if;
 from_stage:=coalesce(cur.stage,'NEW');
 if from_stage=p_stage then
  return jsonb_build_object('id',p_request,'stage',from_stage,'version',coalesce(cur.version,0),'moved_at',cur.moved_at);
 end if;
 insert into public.admin_pipeline(request_id,stage,version,moved_at,moved_by) values(p_request,p_stage,1,now(),auth.uid())
  on conflict(request_id) do update set stage=excluded.stage,version=public.admin_pipeline.version+1,moved_at=excluded.moved_at,moved_by=excluded.moved_by
  returning * into n;
 insert into public.admin_pipeline_moves(request_id,from_stage,to_stage,moved_by) values(p_request,from_stage,p_stage,auth.uid());
 return jsonb_build_object('id',p_request,'stage',n.stage,'version',n.version,'moved_at',n.moved_at);
end $$;

revoke all on function public.admin_pipeline(text[]),public.admin_pipeline_move(uuid,text,int) from public,anon;
grant execute on function public.admin_pipeline(text[]),public.admin_pipeline_move(uuid,text,int) to authenticated;

commit;
