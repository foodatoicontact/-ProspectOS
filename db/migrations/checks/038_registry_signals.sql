-- Post-migration check for 038 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ declare t text; f text; n int;
 member_fns text[]:=array['public.start_registry_signal_run(uuid,text,text,integer)','public.ignore_registry_signal_candidate(uuid)',
  'public.add_registry_signal_candidate_to_project(uuid,text,uuid)'];
 service_only text[]:=array['public.save_registry_signal_candidates(uuid,uuid,jsonb)','public.complete_registry_signal_run(uuid,text,jsonb,text)',
  'public.release_failed_registry_signal_run(uuid)','public.purge_registry_signals()'];
begin
 foreach t in array array['registry_signal_runs','registry_signal_candidates','registry_signal_cache'] loop
  if to_regclass('public.'||t) is null then raise exception 'check 038: % missing',t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||t)) then raise exception 'check 038: RLS off on %',t; end if;
  if has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE')
     or has_table_privilege('authenticated','public.'||t,'DELETE') or has_table_privilege('anon','public.'||t,'SELECT') then
   raise exception 'check 038: client write or anon read on %',t; end if;
 end loop;
 if has_table_privilege('authenticated','public.registry_signal_cache','SELECT') then raise exception 'check 038: members can read the cache'; end if;
 select count(*) into n from pg_policies where schemaname='public' and tablename in ('registry_signal_runs','registry_signal_candidates')
  and cmd='SELECT' and coalesce(qual,'') like '%is_member(%';
 if n<>2 then raise exception 'check 038: runs and candidates need one member SELECT policy each'; end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='registry_signal_cache') then raise exception 'check 038: the cache has no policy'; end if;
 -- No personal officer field, no Google content column.
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='registry_signal_candidates'
    and column_name ~ '(dirigeant|rating|note|avis|review|website|site|horaire|opening)') then
  raise exception 'check 038: a forbidden column exists on registry_signal_candidates'; end if;
 foreach f in array member_fns loop
  if not has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') then raise exception 'check 038: % grants',f; end if;
 end loop;
 foreach f in array service_only loop
  if has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') or not has_function_privilege('service_role',f,'EXECUTE') then
   raise exception 'check 038: % must be service-role only',f; end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgname='registry_signal_candidate_guard' and tgrelid='public.registry_signal_candidates'::regclass) then
  raise exception 'check 038: guard trigger missing'; end if;
end $verify$;
