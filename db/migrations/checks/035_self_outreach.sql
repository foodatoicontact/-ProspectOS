-- Post-migration check for 035 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ declare t text; f text;
 service_only text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)',
  'public.complete_outreach_send(uuid,uuid,text,text,text,integer)','public.outreach_followups_due(uuid[],integer)',
  'public.create_outreach_followup(uuid,text,text,jsonb,jsonb)','public.record_outreach_inbound(jsonb)'];
 member_fns text[]:=array['public.create_outreach_campaign(uuid,text,boolean,integer)','public.add_outreach_contact(uuid,text,text,text,text,text,text,text)',
  'public.create_outreach_candidate(uuid,uuid,uuid,uuid[],jsonb,jsonb)','public.review_outreach_message(uuid,text,text,text,text)',
  'public.set_outreach_outcome(uuid,text,text)','public.suppress_outreach_email(uuid,text,text)','public.outreach_metrics(uuid)'];
 private_fns text[]:=array['prospectos_private.outreach_event(uuid,uuid,uuid,uuid,text,text,text,jsonb)','prospectos_private.outreach_is_suppressed_email(text)',
  'prospectos_private.outreach_stop_email(text,text)','prospectos_private.outreach_stop_followups(uuid,text)','prospectos_private.outreach_text_refused(text)'];
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
 end loop;
 foreach f in array private_fns loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then
   raise exception 'check 035: % callable by clients',f; end if;
 end loop;
end $verify$;
