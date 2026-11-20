-- Post-migration check for 037 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ declare f text; n int;
 member_fns text[]:=array['public.set_outreach_campaign_booking(uuid,text)','public.create_outreach_booking_reply(uuid,text,text)',
  'public.record_outreach_meeting(uuid,timestamp with time zone)','public.set_outreach_meeting_status(uuid,text)',
  'public.review_outreach_message(uuid,text,text,text,text)','public.set_outreach_outcome(uuid,text,text)','public.outreach_metrics(uuid)'];
 service_only text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)'];
begin
 if to_regclass('public.outreach_meetings') is null then raise exception 'check 037: outreach_meetings missing'; end if;
 if not (select relrowsecurity from pg_class where oid=to_regclass('public.outreach_meetings')) then raise exception 'check 037: RLS off on outreach_meetings'; end if;
 if has_table_privilege('authenticated','public.outreach_meetings','INSERT') or has_table_privilege('authenticated','public.outreach_meetings','UPDATE')
    or has_table_privilege('authenticated','public.outreach_meetings','DELETE') or has_table_privilege('anon','public.outreach_meetings','SELECT') then
  raise exception 'check 037: client write or anon read on outreach_meetings'; end if;
 select count(*) into n from pg_policies where schemaname='public' and tablename='outreach_meetings';
 if n<>1 or exists(select 1 from pg_policies where schemaname='public' and tablename='outreach_meetings' and (cmd<>'SELECT' or coalesce(qual,'') not like '%self_outreach_member(%')) then
  raise exception 'check 037: outreach_meetings needs exactly one SELECT policy requiring self_outreach_member'; end if;
 foreach f in array member_fns loop
  if to_regprocedure(f) is null then raise exception 'check 037: % missing',f; end if;
  if has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then raise exception 'check 037: % callable by anon',f; end if;
  if not has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') then raise exception 'check 037: % not callable by members',f; end if;
  if not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure(f)) then
   raise exception 'check 037: % must be security definer with an empty search_path',f; end if;
  if pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_member(%' or pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_self_outreach_org(%' then
   raise exception 'check 037: % must require a member of a served organization',f; end if;
 end loop;
 foreach f in array service_only loop
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then raise exception 'check 037: % callable by clients',f; end if;
  if not has_function_privilege('service_role',to_regprocedure(f),'EXECUTE') then raise exception 'check 037: % not callable by the server',f; end if;
  if pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.self_outreach_org_allowed(%' then raise exception 'check 037: % must consult the served organizations',f; end if;
  if pg_get_functiondef(to_regprocedure(f)) not like '%outreach_is_suppressed_email(%' then raise exception 'check 037: % must check the suppression list',f; end if;
 end loop;
end $verify$;
