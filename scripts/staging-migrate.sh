#!/usr/bin/env bash
# Applies the O1/O2 migrations (027, then 028) to the STAGING Supabase database only. Run by
# .github/workflows/staging-migrations.yml (manual workflow_dispatch, GitHub Environment "prospectos-staging").
#
# Guards, all before any connection:
#  - CONFIRM_PROJECT_REF must be exactly the staging ref;
#  - SUPABASE_STAGING_DB_URL must point at the staging project (direct host db.<ref>.supabase.co, or the Supabase
#    pooler with user postgres.<ref>), must never mention the production ref, and may not override the host
#    through query parameters;
#  - each migration file must have the MD5 validated in review (no other SQL is ever run).
# Then, per migration, in order: skipped if already recorded in supabase_migrations.schema_migrations; otherwise
# run with ON_ERROR_STOP (the file's own begin/commit: all or nothing), verified (objects, RLS, functions, limits),
# and only then recorded. Any error stops everything immediately. The connection string is never printed.
set -euo pipefail

STAGING_REF="ggilyurgopsjrpnvxovl"
PRODUCTION_REF="vptqxhlxwiljfbkybqej"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=("027_outreach_intelligence" "028_outreach_ai_generation")
declare -A EXPECTED_MD5=(
  [027_outreach_intelligence]="1caaaf71c29cc52dbefe2422e2bf22fd"
  [028_outreach_ai_generation]="b921ad6e79d21cd229e17abecc8482e9"
)

fail(){ echo "STAGING-MIGRATE REFUSED: $*" >&2; exit 1; }

# ——— 1. guards (no connection yet) ———
[ "${CONFIRM_PROJECT_REF:-}" = "$STAGING_REF" ] || fail "confirm_project_ref must be exactly the staging project ref"
URL="${SUPABASE_STAGING_DB_URL:-}"
[ -n "$URL" ] || fail "SUPABASE_STAGING_DB_URL is empty"
case "$URL" in *"$PRODUCTION_REF"*) fail "the connection string mentions the PRODUCTION project";; esac
re='^postgres(ql)?://([^:@/?#]+)(:[^@]*)?@([^:/?#]+)(:[0-9]+)?/([A-Za-z0-9_]+)(\?(.*))?$'
[[ "$URL" =~ $re ]] || fail "connection string is not a plain postgresql://user[:password]@host[:port]/db URL"
DB_USER="${BASH_REMATCH[2]}"; DB_HOST="${BASH_REMATCH[4]}"; DB_QUERY="${BASH_REMATCH[8]:-}"
if [ -n "$DB_QUERY" ]; then
  IFS='&' read -ra params <<<"$DB_QUERY"
  for p in "${params[@]}"; do case "$p" in sslmode=require|sslmode=verify-full|sslmode=verify-ca) ;; *) fail "only sslmode may be set in the query string";; esac; done
fi
LOCAL_TEST=0
if [ "${STAGING_MIGRATE_ALLOW_LOCALHOST:-}" = "1" ] && [ "${GITHUB_ACTIONS:-}" != "true" ]; then LOCAL_TEST=1; fi
if [ "$DB_HOST" = "db.$STAGING_REF.supabase.co" ]; then
  [ "$DB_USER" = "postgres" ] || [ "$DB_USER" = "postgres.$STAGING_REF" ] || fail "unexpected database user for the staging host"
elif [[ "$DB_HOST" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
  [ "$DB_USER" = "postgres.$STAGING_REF" ] || fail "pooler user must be postgres.$STAGING_REF"
elif [ "$LOCAL_TEST" = 1 ] && { [ "$DB_HOST" = "127.0.0.1" ] || [ "$DB_HOST" = "localhost" ]; }; then
  [ "$DB_USER" = "postgres.$STAGING_REF" ] || fail "local test user must be postgres.$STAGING_REF"
else
  fail "host is not the staging project"
fi
for m in "${MIGRATIONS[@]}"; do
  f="$ROOT/db/migrations/$m.sql"; [ -f "$f" ] || fail "missing $m.sql"
  actual="$(md5sum "$f" | cut -d' ' -f1)"
  [ "$actual" = "${EXPECTED_MD5[$m]}" ] || fail "$m.sql does not have the reviewed content (md5 $actual)"
done
echo "Guards passed: staging project $STAGING_REF, reviewed files 027 and 028."
if [ "${STAGING_MIGRATE_GUARD_ONLY:-}" = "1" ]; then echo "Guard-only mode: no connection made."; exit 0; fi

# ——— 2. migrations ———
export PGCONNECT_TIMEOUT=15 PGAPPNAME="prospectos-staging-migrate" PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
recorded(){ "${PSQL[@]}" -tA -c "select count(*) from supabase_migrations.schema_migrations where name='$1'"; }
verify_027(){ "${PSQL[@]}" -c "do \$v\$ begin
 if to_regclass('public.outreach_style_profiles') is null or to_regclass('public.prospect_public_content') is null then raise exception 'verify 027: tables missing'; end if;
 if (select count(*) from pg_class where oid in ('public.outreach_style_profiles'::regclass,'public.prospect_public_content'::regclass) and relrowsecurity)<>2 then raise exception 'verify 027: RLS not enabled'; end if;
 if (select count(*) from pg_policies where (tablename,policyname) in (('outreach_style_profiles','outreach_style_profiles_read'),('prospect_public_content','prospect_public_content_read')))<>2 then raise exception 'verify 027: policies missing'; end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='outreach' and column_name in ('generated_content','angle','public_content_ids','style_profile_id','created_by','last_edited_by','last_edited_at'))<>7 then raise exception 'verify 027: outreach columns missing'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (('public','save_outreach_style_profile'),('public','save_public_content'),('public','review_public_content'),('public','pin_public_content'),('public','delete_public_content'),('prospectos_private','guard_outreach_intelligence'),('prospectos_private','guard_public_content')))<>7 then raise exception 'verify 027: functions missing'; end if;
 if (select count(*) from pg_trigger where tgname in ('outreach_intelligence_guard','public_content_guard') and not tgisinternal)<>2 then raise exception 'verify 027: triggers missing'; end if;
end \$v\$;"; }
verify_028(){ "${PSQL[@]}" -c "do \$v\$ begin
 if to_regclass('prospectos_private.ai_outreach_limits') is null or to_regclass('prospectos_private.ai_outreach_usage') is null then raise exception 'verify 028: tables missing'; end if;
 if (select string_agg(plan||'='||period_limit||'/'||per_hour,',' order by plan) from prospectos_private.ai_outreach_limits)
    <>'BETA=25/10,ENTERPRISE=3000/60,INTERNAL=10000/120,PAID=150/20,PRO=500/30,TEAM=1000/30' then raise exception 'verify 028: limits differ from the validated values'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_ai_outreach','finish_ai_outreach'))<>2 then raise exception 'verify 028: functions missing'; end if;
 if pg_get_constraintdef((select oid from pg_constraint where conname='api_usage_events_operation_check')) not like '%outreach_generation%' then raise exception 'verify 028: cost operation missing'; end if;
 if position('ai_outreach_used' in (select prosrc from pg_proc where proname='get_commercial_usage'))=0 then raise exception 'verify 028: get_commercial_usage not extended'; end if;
end \$v\$;"; }
version_base="$(date -u +%s)"
i=0
for m in "${MIGRATIONS[@]}"; do
  if [ "$(recorded "$m")" != "0" ]; then echo "$m: already recorded, skipped."; "verify_${m%%_*}"; i=$((i+1)); continue; fi
  if [ "$m" = "028_outreach_ai_generation" ] && [ "$(recorded 027_outreach_intelligence)" = "0" ]; then fail "028 needs 027 recorded first"; fi
  echo "$m: applying…"
  "${PSQL[@]}" -f "$ROOT/db/migrations/$m.sql"
  "verify_${m%%_*}"
  version="$(date -u -d "@$((version_base + i))" +%Y%m%d%H%M%S)"
  # psql variables (quoted by psql itself) are only interpolated in script input, hence stdin.
  # The file is recorded byte for byte ($(...) would drop its final newline: a sentinel keeps it).
  body="$(cat "$ROOT/db/migrations/$m.sql"; printf x)"; body="${body%x}"
  echo "insert into supabase_migrations.schema_migrations(version,name,statements) values(:'version',:'name',array[:'body']);" \
    | "${PSQL[@]}" -v version="$version" -v name="$m" -v body="$body" -f -
  echo "$m: applied, verified and recorded (version $version)."
  i=$((i+1))
done
echo "Done: 027 and 028 are applied and recorded on the staging project."
