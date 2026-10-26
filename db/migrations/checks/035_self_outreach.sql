-- Post-migration check for 035 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ declare t text; f text;
 service_only text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)',
  'public.complete_outreach_send(uuid,uuid,text,text,text,integer)','public.outreach_followups_due(uuid[],integer)',
  'public.create_outreach_followup(uuid,text,text,jsonb,jsonb)','public.record_outreach_inbound(jsonb)'];
 member_fns text[]:=array['public.create_outreach_campaign(uuid,text,boolean,integer)','public.add_outreach_contact(uuid,text,text,text,text,text,text,text)',
  'public.create_outreach_candidate(uuid,uuid,uuid,uuid[],jsonb,jsonb)','public.review_outreach_message(uuid,text,text,text,text)',
  'public.set_outreach_outcome(uuid,text,text)','public.suppress_outreach_email(uuid,text,text)','public.outreach_metrics(uuid)'];
 private_fns text[]:=array['prospectos_private.outreach_event(uuid,uuid,uuid,uuid,text,text,text,jsonb)','prospectos_private.outreach_is_suppressed_email(text)',
  'prospectos_private.outreach_stop_email(text,text)','prospectos_private.outreach_stop_followups(uuid,text)','prospectos_private.outreach_text_refused(text)',
  'prospectos_private.self_outreach_org_allowed(uuid)','prospectos_private.require_self_outreach_org(uuid)'];
 -- Server paths that must also consult the database list of served organizations.
 server_gated text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)',
  'public.outreach_followups_due(uuid[],integer)','public.create_outreach_followup(uuid,text,text,jsonb,jsonb)'];
 pol record; n int;
begin
 foreach t in array array['public.outreach_campaigns','public.outreach_contacts','public.outreach_candidates','public.outreach_messages','public.outreach_events',
   'public.outreach_suppressions','public.outreach_inbound','public.outreach_daily_counters'] loop
  if to_regclass(t) is null then raise exception 'check 035: % missing',t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass(t)) then raise exception 'check 035: RLS off on %',t; end if;
  if has_table_privilege('authenticated',t,'INSERT') or has_table_privilege('authenticated',t,'UPDATE') or has_table_privilege('authenticated',t,'DELETE')
     or has_table_privilege('anon',t,'SELECT') then raise exception 'check 035: client write or anon read on %',t; end if;
 end loop;
 if has_table_privilege('authenticated','public.outreach_suppressions','SELECT') then raise exception 'check 035: suppressions readable by clients'; end if;
 -- Execute rights, explicitly (has_function_privilege also counts grants to PUBLIC).
 foreach f in array service_only||array['public.outreach_is_suppressed(text)'] loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then
   raise exception 'check 035: % callable by clients',f; end if;
  if not has_function_privilege('service_role',to_regprocedure(f),'EXECUTE') then raise exception 'check 035: % not callable by the server',f; end if;
 end loop;
 foreach f in array member_fns loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then raise exception 'check 035: % callable by anon',f; end if;
  if not has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') then raise exception 'check 035: % not callable by members',f; end if;
  if not (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure(f)) then
   raise exception 'check 035: % must be security definer with an empty search_path',f; end if;
  -- require_member alone is not enough: the organization must be served (the database list).
  if pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_member(%' or pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_self_outreach_org(%' then
   raise exception 'check 035: % must require a member of a served organization',f; end if;
 end loop;
 foreach f in array server_gated loop
  if pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.self_outreach_org_allowed(%' and pg_get_functiondef(to_regprocedure(f)) not like '%prospectos_private.require_self_outreach_org(%' then
   raise exception 'check 035: % must consult the served organizations',f; end if;
 end loop;
 -- The list of served organizations: private, never readable or writable by a client.
 if to_regclass('prospectos_private.self_outreach_organizations') is null then raise exception 'check 035: served organizations list missing'; end if;
 if has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','SELECT') or has_table_privilege('anon','prospectos_private.self_outreach_organizations','SELECT')
    or has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','INSERT') or has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','UPDATE')
    or has_table_privilege('authenticated','prospectos_private.self_outreach_organizations','DELETE') then raise exception 'check 035: served organizations list exposed to clients'; end if;
 -- The read policies' helper: members only (answers about the caller's own organizations), never anon.
 if has_function_privilege('anon',to_regprocedure('prospectos_private.self_outreach_member(uuid)'),'EXECUTE')
    or not has_function_privilege('authenticated',to_regprocedure('prospectos_private.self_outreach_member(uuid)'),'EXECUTE') then
  raise exception 'check 035: self_outreach_member execute rights'; end if;
 -- Every client read policy of the Self-Outreach tables requires a member of a served organization.
 n:=0;
 for pol in select tablename,policyname,qual,cmd,roles from pg_policies where schemaname='public' and tablename=any(array['outreach_campaigns','outreach_contacts','outreach_candidates',
   'outreach_messages','outreach_events','outreach_suppressions','outreach_inbound','outreach_daily_counters']) loop
  n:=n+1;
  if pol.cmd<>'SELECT' or coalesce(pol.qual,'') not like '%self_outreach_member(%' then
   raise exception 'check 035: policy % on % must be SELECT and require self_outreach_member',pol.policyname,pol.tablename; end if;
 end loop;
 if n<>6 then raise exception 'check 035: % Self-Outreach policies, expected 6',n; end if;
 foreach f in array private_fns loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then
   raise exception 'check 035: % callable by clients',f; end if;
 end loop;
end $verify$;
