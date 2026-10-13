-- Post-migration check for 030 (run by scripts/staging-migrate.sh inside the migration's transaction; any exception
-- rolls the migration back and leaves it unrecorded). Read only.
do $verify$ declare t text; f text; svc text[]:=array['public.save_signal_discovery_candidates(uuid,uuid,jsonb)','public.complete_signal_discovery_run(uuid,text,jsonb,text)',
 'public.release_failed_signal_discovery(uuid)','public.purge_signal_discovery()'];
 member text[]:=array['public.start_signal_discovery(uuid,text,text,jsonb,text,integer)','public.ignore_signal_candidate(uuid)','public.add_signal_candidate_to_project(uuid,text,text,uuid)'];
begin
 foreach t in array array['public.signal_discovery_runs','public.signal_discovery_candidates'] loop
  if to_regclass(t) is null then raise exception 'check 030: % missing',t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass(t)) then raise exception 'check 030: RLS off on %',t; end if;
  if has_table_privilege('authenticated',t,'INSERT') or has_table_privilege('authenticated',t,'UPDATE') or has_table_privilege('authenticated',t,'DELETE')
     or has_table_privilege('anon',t,'SELECT') then raise exception 'check 030: client write or anon read on %',t; end if;
 end loop;
 foreach f in array svc||member loop
  if to_regprocedure(f) is null then raise exception 'check 030: % missing',f; end if;
  if not (select prosecdef from pg_proc where oid=to_regprocedure(f)) or (select coalesce(proconfig,'{}') from pg_proc where oid=to_regprocedure(f))<>array['search_path=""'] then
   raise exception 'check 030: % must be security definer with an empty search_path',f; end if;
  if has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then raise exception 'check 030: % callable by anon',f; end if;
 end loop;
 foreach f in array svc loop
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') then raise exception 'check 030: % callable by members',f; end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgname='signal_discovery_candidate_guard' and tgrelid='public.signal_discovery_candidates'::regclass and tgenabled='O') then
  raise exception 'check 030: candidate guard missing or disabled'; end if;
end $verify$;
