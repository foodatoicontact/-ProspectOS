-- Post-migration check for 027 (run by scripts/staging-migrate.sh inside the migration's transaction; any exception
-- rolls the migration back and leaves it unrecorded). Read only.
do $verify$ begin
 if to_regclass('public.outreach_style_profiles') is null or to_regclass('public.prospect_public_content') is null then raise exception 'check 027: tables missing'; end if;
 if (select count(*) from pg_class where oid in ('public.outreach_style_profiles'::regclass,'public.prospect_public_content'::regclass) and relrowsecurity)<>2 then raise exception 'check 027: RLS not enabled'; end if;
 if (select count(*) from pg_policies where (tablename,policyname) in (('outreach_style_profiles','outreach_style_profiles_read'),('prospect_public_content','prospect_public_content_read')))<>2 then raise exception 'check 027: policies missing'; end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='outreach' and column_name in ('generated_content','angle','public_content_ids','style_profile_id','created_by','last_edited_by','last_edited_at'))<>7 then raise exception 'check 027: outreach columns missing'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (('public','save_outreach_style_profile'),('public','save_public_content'),('public','review_public_content'),('public','pin_public_content'),('public','delete_public_content'),('prospectos_private','guard_outreach_intelligence'),('prospectos_private','guard_public_content')))<>7 then raise exception 'check 027: functions missing'; end if;
 if (select count(*) from pg_trigger where tgname in ('outreach_intelligence_guard','public_content_guard') and not tgisinternal)<>2 then raise exception 'check 027: triggers missing'; end if;
end $verify$;
