-- Post-migration check for 032 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ begin
 if not exists(select 1 from pg_trigger where tgname='signal_guard' and tgrelid='public.signals'::regclass and tgenabled='O') then
  raise exception 'check 032: signal_guard missing or disabled'; end if;
 if has_table_privilege('authenticated','public.signals','UPDATE') or has_table_privilege('anon','public.signals','UPDATE') then
  raise exception 'check 032: clients must not update signals'; end if;
 if has_function_privilege('authenticated','prospectos_private.guard_signal()','EXECUTE') then raise exception 'check 032: guard callable by clients'; end if;
 if position('legacy-geo-v' in (select prosrc from pg_proc where oid='prospectos_private.guard_signal()'::regprocedure))=0 then
  raise exception 'check 032: guard not updated'; end if;
end $verify$;
