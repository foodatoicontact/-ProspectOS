-- Post-migration check for 035 (run inside the migration's transaction; any exception rolls it back). Read only.
do $verify$ declare t text; f text;
 service_only text[]:=array['public.claim_outreach_sends(uuid[],text,integer,integer,integer)','public.outreach_send_permitted(uuid,uuid)',
  'public.complete_outreach_send(uuid,uuid,text,text,text,integer)','public.outreach_followups_due(uuid[],integer)',
  'public.create_outreach_followup(uuid,text,text,jsonb,jsonb)','public.record_outreach_inbound(jsonb)'];
begin
 foreach t in array array['public.outreach_campaigns','public.outreach_contacts','public.outreach_candidates','public.outreach_messages','public.outreach_events',
   'public.outreach_suppressions','public.outreach_inbound','public.outreach_daily_counters'] loop
  if to_regclass(t) is null then raise exception 'check 035: % missing',t; end if;
  if not (select relrowsecurity from pg_class where oid=to_regclass(t)) then raise exception 'check 035: RLS off on %',t; end if;
  if has_table_privilege('authenticated',t,'INSERT') or has_table_privilege('authenticated',t,'UPDATE') or has_table_privilege('authenticated',t,'DELETE')
     or has_table_privilege('anon',t,'SELECT') then raise exception 'check 035: client write or anon read on %',t; end if;
 end loop;
 if has_table_privilege('authenticated','public.outreach_suppressions','SELECT') then raise exception 'check 035: suppressions readable by clients'; end if;
 foreach f in array service_only loop
  if to_regprocedure(f) is null then raise exception 'check 035: % missing',f; end if;
  if has_function_privilege('authenticated',to_regprocedure(f),'EXECUTE') or has_function_privilege('anon',to_regprocedure(f),'EXECUTE') then
   raise exception 'check 035: % callable by clients',f; end if;
 end loop;
end $verify$;
