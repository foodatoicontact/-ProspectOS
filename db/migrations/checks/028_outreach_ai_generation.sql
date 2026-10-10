-- Post-migration check for 028 (run by scripts/staging-migrate.sh inside the migration's transaction; any exception
-- rolls the migration back and leaves it unrecorded). Read only.
do $verify$ begin
 if to_regclass('prospectos_private.ai_outreach_limits') is null or to_regclass('prospectos_private.ai_outreach_usage') is null then raise exception 'check 028: tables missing'; end if;
 if (select string_agg(plan||'='||period_limit||'/'||per_hour,',' order by plan) from prospectos_private.ai_outreach_limits)
    <>'BETA=25/10,ENTERPRISE=3000/60,INTERNAL=10000/120,PAID=150/20,PRO=500/30,TEAM=1000/30' then raise exception 'check 028: limits differ from the validated values'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_ai_outreach','finish_ai_outreach'))<>2 then raise exception 'check 028: functions missing'; end if;
 if pg_get_constraintdef((select oid from pg_constraint where conname='api_usage_events_operation_check')) not like '%outreach_generation%' then raise exception 'check 028: cost operation missing'; end if;
 if position('ai_outreach_used' in (select prosrc from pg_proc where proname='get_commercial_usage'))=0 then raise exception 'check 028: get_commercial_usage not extended'; end if;
end $verify$;
