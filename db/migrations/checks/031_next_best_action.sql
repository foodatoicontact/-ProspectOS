-- Post-migration check for 031 (run by scripts/staging-migrate.sh inside the migration's transaction; any exception
-- rolls the migration back and leaves it unrecorded). Read only.
do $verify$ declare t text; f text;
 member text[]:=array['public.save_nba_actions(uuid,jsonb)','public.decide_nba_action(uuid,text,text,timestamp with time zone,text)',
  'public.record_nba_outcome(uuid,text,text)','public.refresh_nba_states(uuid)'];
begin
 foreach t in array array['public.nba_actions','public.nba_action_events'] loop
  if to_regclass(t) is null then raise exception 'check 031: % missing',t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass(t)) then raise exception 'check 031: RLS off on %',t; end if;
  if has_table_privilege('authenticated',t,'INSERT') or has_table_privilege('authenticated',t,'UPDATE') or has_table_privilege('authenticated',t,'DELETE')
     or has_table_privilege('anon',t,'SELECT') then raise exception 'check 031: client write or anon read on %',t; end if;
 end loop;
 foreach f in array member loop
  if to_regprocedure(f) is null then raise exception 'check 031: % missing',f; end if;
  if not (select prosecdef from pg_proc where oid=to_regprocedure(f)) or (select coalesce(proconfig,'{}') from pg_proc where oid=to_regprocedure(f))<>array['search_path=""'] then
   raise exception 'check 031: % must be security definer with an empty search_path',f; end if;
  if has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then raise exception 'check 031: % callable by anon',f; end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgname='nba_action_guard' and tgrelid='public.nba_actions'::regclass and tgenabled='O') then
  raise exception 'check 031: guard missing or disabled'; end if;
end $verify$;
