-- Post-migration check for 033 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.evidence'::regclass and conname='evidence_status_check'
  and pg_get_constraintdef(oid) like '%USER_DECLARED%') then raise exception 'check 033: status check missing USER_DECLARED'; end if;
 if (select count(*) from pg_constraint where conrelid='public.evidence'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%NOT_VERIFIED%' and pg_get_constraintdef(oid) like '%INFERRED_UNCONFIRMED%'
  and pg_get_constraintdef(oid) not like '%verified_by%')<>1 then raise exception 'check 033: exactly one status check expected'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.evidence'::regclass and conname='evidence_user_declared_shape') then
  raise exception 'check 033: declaration shape missing'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.evidence'::regclass and conname='evidence_declared_by_only_declared') then
  raise exception 'check 033: declared_by scope missing'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.evidence'::regclass and conname='evidence_note_only_declared') then
  raise exception 'check 033: note scope missing'; end if;
 if not exists(select 1 from pg_trigger where tgname='evidence_guard' and tgrelid='public.evidence'::regclass and tgenabled='O') then
  raise exception 'check 033: evidence_guard missing or disabled'; end if;
 if not exists(select 1 from pg_trigger where tgname='outreach_guard' and tgrelid='public.outreach'::regclass and tgenabled='O') then
  raise exception 'check 033: outreach_guard missing or disabled'; end if;
 if position('declared_by := auth.uid()' in (select prosrc from pg_proc where oid='prospectos_private.guard_record()'::regprocedure))=0 then
  raise exception 'check 033: guard not updated'; end if;
 if position('USED'',''DISCARDED' in (select prosrc from pg_proc where oid='prospectos_private.guard_record()'::regprocedure))=0 then
  raise exception 'check 033: outreach immutability lost'; end if;
 if has_function_privilege('authenticated','prospectos_private.guard_record()','EXECUTE') then raise exception 'check 033: guard callable by clients'; end if;
 if (select relrowsecurity from pg_class where oid='public.evidence'::regclass) is not true then raise exception 'check 033: RLS off on evidence'; end if;
 if exists(select 1 from public.evidence where status<>'USER_DECLARED' and (declared_by is not null or note is not null)) then
  raise exception 'check 033: existing rows changed'; end if;
end $verify$;
