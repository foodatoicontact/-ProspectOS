-- Post-migration check for 029 (run by scripts/staging-migrate.sh inside the migration's transaction; any exception
-- rolls the migration back and leaves it unrecorded). Read only.
do $verify$ declare fn regprocedure := to_regprocedure('prospectos_private.guard_outreach_provenance()'); def text;
begin
 if fn is null then raise exception 'check 029: function missing'; end if;
 if (select prosecdef from pg_proc where oid=fn) then raise exception 'check 029: the guard must be security invoker'; end if;
 if (select coalesce(proconfig,'{}') from pg_proc where oid=fn)<>array['search_path=""'] then raise exception 'check 029: the guard must pin an empty search_path'; end if;
 if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE') then raise exception 'check 029: the guard is callable by clients'; end if;
 select pg_get_triggerdef(t.oid) into def from pg_trigger t
  where t.tgname='outreach_provenance_guard' and t.tgrelid='public.outreach'::regclass and not t.tgisinternal and t.tgenabled='O' and t.tgfoid=fn;
 if def is null then raise exception 'check 029: trigger missing or disabled'; end if;
 if position('BEFORE UPDATE OF status ON public.outreach FOR EACH ROW WHEN' in def)=0 or position('''APPROVED''' in def)=0
    or position('''USED''' in def)=0 or position('IS DISTINCT FROM old.status' in def)=0 then raise exception 'check 029: trigger definition differs'; end if;
end $verify$;
