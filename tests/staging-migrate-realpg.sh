#!/usr/bin/env bash
# scripts/staging-migrate.sh against a REAL local PostgreSQL server (throwaway cluster, deleted at the end), with the
# Supabase objects the script relies on recreated (auth, roles, supabase_migrations.schema_migrations).
#  A. the Preview state seen on 2026-10-10: 001–026 recorded, 027 applied except delete_public_content, nothing
#     recorded for 027/028 → the script completes 027 (idempotent replay), verifies and records it, then 028;
#  B. a second run changes nothing (both recorded → skipped, re-verified);
#  C. 028 failing halfway (a conflicting object) → the script stops with an error, 028 is NOT recorded and none of
#     its objects remain (its own transaction rolled back); 027 stays applied and recorded.
# Needs local PostgreSQL server binaries; touches nothing else (local mode is refused on GitHub runners).
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/postgres" ] || { echo "SKIPPED: no local PostgreSQL server binaries"; exit 0; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; PORT=$(( 20000 + RANDOM % 20000 )); REF=ggilyurgopsjrpnvxovl
RUN=(); if [ "$(id -u)" = 0 ]; then chown -R postgres "$WORK"; RUN=(runuser -u postgres --); fi
cleanup(){ "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/log" start -w >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres)
"${ADMIN[@]}" -d postgres -c "create role \"postgres.$REF\" login superuser"
setup(){ local db="$1"
 [ "$db" = postgres ] || "${ADMIN[@]}" -d postgres -c "create database $db"
 "${ADMIN[@]}" -d "$db" >/dev/null <<'SQL'
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
SQL
 "${ADMIN[@]}" -d "$db" -f "$ROOT/db/schema.sql" >/dev/null
 for f in "$ROOT"/db/migrations/0[0-2][0-9]_*.sql; do n=$(basename "$f" .sql); case "$n" in 027_*|028_*) continue;; esac
  "${ADMIN[@]}" -d "$db" -f "$f" >/dev/null
  "${ADMIN[@]}" -d "$db" -c "insert into supabase_migrations.schema_migrations(version,name) values('2026$(printf %010d $((10#${n:0:3})))','$n')"; done
}
q(){ "${ADMIN[@]}" -d "$1" -tAc "$2"; }
migrate(){ STAGING_MIGRATE_ALLOW_LOCALHOST=1 CONFIRM_PROJECT_REF=$REF SUPABASE_STAGING_DB_URL="postgresql://postgres.$REF@127.0.0.1:$PORT/$1" bash "$ROOT/scripts/staging-migrate.sh"; }
pass(){ echo "PASS  $1"; }

# ——— A: the observed Preview state ———
setup postgres
"${ADMIN[@]}" -d postgres -f "$ROOT/db/migrations/027_outreach_intelligence.sql" >/dev/null
"${ADMIN[@]}" -d postgres -c "drop function public.delete_public_content(uuid)"
[ "$(q postgres "select count(*) from supabase_migrations.schema_migrations where name ~ '^02[78]_'")" = 0 ]
migrate postgres > "$WORK/a.out"
[ "$(q postgres "select string_agg(name,',' order by version) from supabase_migrations.schema_migrations where name ~ '^02[78]_'")" = "027_outreach_intelligence,028_outreach_ai_generation" ]
[ "$(q postgres "select count(*) from pg_proc where proname='delete_public_content'")" = 1 ]
[ "$(q postgres "select string_agg(plan||'='||period_limit||'/'||per_hour,',' order by plan) from prospectos_private.ai_outreach_limits")" = "BETA=25/10,ENTERPRISE=3000/60,INTERNAL=10000/120,PAID=150/20,PRO=500/30,TEAM=1000/30" ]
for m in 027_outreach_intelligence 028_outreach_ai_generation; do
 [ "$(q postgres "select md5(statements[1]) from supabase_migrations.schema_migrations where name='$m'")" = "$(md5sum "$ROOT/db/migrations/$m.sql" | cut -d' ' -f1)" ]; done
! grep -q "127.0.0.1:$PORT" "$WORK/a.out"
pass "A — partial 027 completed (delete_public_content created), verified, recorded with its exact SQL; 028 likewise, with the validated limits; URL not printed"

# ——— B: idempotent second run ———
migrate postgres > "$WORK/b.out"
[ "$(grep -c 'already recorded, skipped' "$WORK/b.out")" = 2 ]
[ "$(q postgres "select count(*) from supabase_migrations.schema_migrations where name ~ '^02[78]_'")" = 2 ]
pass "B — second run: both recorded → skipped and re-verified, history unchanged"

# ——— C: 028 fails halfway → stop, no record, nothing of 028 left ———
setup failcase
"${ADMIN[@]}" -d failcase -c "create table prospectos_private.ai_outreach_usage(id int)"   # conflicts with 028's own table
set +e; migrate failcase > "$WORK/c.out" 2> "$WORK/c.err"; status=$?; set -e
[ "$status" != 0 ]
[ "$(q failcase "select string_agg(name,',') from supabase_migrations.schema_migrations where name ~ '^02[78]_'")" = "027_outreach_intelligence" ]
[ "$(q failcase "select count(*) from pg_proc where proname in ('reserve_ai_outreach','finish_ai_outreach')")" = 0 ]
[ -z "$(q failcase "select to_regclass('prospectos_private.ai_outreach_limits')")" ]
[ "$(q failcase "select pg_get_constraintdef(oid) like '%outreach_generation%' from pg_constraint where conname='api_usage_events_operation_check'")" = f ]
pass "C — 028 error: the script stops (exit $status), 028 not recorded, none of its objects remain; 027 kept"
echo "STAGING-MIGRATE REAL POSTGRES: 3/3 PASS"
