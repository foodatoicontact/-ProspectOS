#!/usr/bin/env bash
# The production migration runner (scripts/production-migrate.sh) against a REAL local PostgreSQL server (throwaway
# cluster, deleted at the end): two databases stand for staging and production, with the Supabase history table. The
# target is a throwaway git directory holding FIXTURE migrations (9NN_*), independent of any application migration.
#  S  verify-staging: refused when a listed migration is not on staging, was recorded by another path, or differs
#     from the file; accepted when the staging runner recorded this exact file. It writes nothing.
#  D  dry-run: the migrations and their checks run on production, then are rolled back — no object, no history row.
#  A  apply: each migration applied, its check run, recorded with the exact file text and the production runner id.
#  R  re-running a recorded migration is refused before anything is applied.
#  X  a failing migration after a good one: the good one is kept, the failing one leaves nothing, the run stops.
#  K  a failing check shipped with a migration rolls that migration back.
#  L  another session holding the lock → refused at once.
#  G  guards: wrong project, the other project's ref, bad list, unknown file, psql meta-command, malformed transaction.
# Needs local PostgreSQL server binaries; touches nothing else (local mode is refused on GitHub runners).
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/postgres" ] || { echo "SKIPPED: no local PostgreSQL server binaries"; exit 0; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; PORT=$(( 20000 + RANDOM % 20000 )); STG=ggilyurgopsjrpnvxovl; PRD=vptqxhlxwiljfbkybqej
RUN=(); if [ "$(id -u)" = 0 ]; then chown -R postgres "$WORK"; RUN=(runuser -u postgres --); fi
cleanup(){ "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/log" start -w >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
ADMIN=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres)
"${ADMIN[@]}" -d postgres -c "create role \"postgres.$STG\" login superuser" -c "create role \"postgres.$PRD\" login superuser" -c "create database stg" -c "create database prd"
for d in stg prd; do "${ADMIN[@]}" -d "$d" -c "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text)"; done
q(){ "${ADMIN[@]}" -d "$1" -tAc "$2"; }
pass(){ echo "PASS  $1"; }
must(){ "$@" || { echo "FAIL: $*"; exit 1; }; }

# The target: fixture migrations in a git directory.
T="$WORK/target"; mkdir -p "$T/db/migrations/checks"
printf -- '-- fixture\nbegin;\ncreate table public.fx_alpha(id int);\ncommit;\n' > "$T/db/migrations/901_fixture_alpha.sql"
printf -- '-- fixture with a check\nbegin;\ncreate table public.fx_beta(id int);\ncommit;\n' > "$T/db/migrations/902_fixture_beta.sql"
printf -- "do \$v\$ begin if to_regclass('public.fx_beta') is null then raise exception 'check 902'; end if; end \$v\$;\n" > "$T/db/migrations/checks/902_fixture_beta.sql"
printf -- '-- fails halfway\nbegin;\ncreate table public.fx_gamma(id int);\nselect 1/0;\ncommit;\n' > "$T/db/migrations/903_fixture_gamma.sql"
printf -- '-- its check fails\nbegin;\ncreate table public.fx_delta(id int);\ncommit;\n' > "$T/db/migrations/904_fixture_delta.sql"
printf -- "do \$v\$ begin raise exception 'check 904 refuses'; end \$v\$;\n" > "$T/db/migrations/checks/904_fixture_delta.sql"
printf -- 'begin;\n\\! echo pwned\ncommit;\n' > "$T/db/migrations/905_fixture_meta.sql"
printf -- 'create table public.fx_x(id int);\ncommit;\n' > "$T/db/migrations/906_fixture_malformed.sql"
git -C "$T" init -q && git -C "$T" -c user.email=t@t -c user.name=t add -A && git -C "$T" -c user.email=t@t -c user.name=t commit -qm fixtures
cp "$T/db/migrations/901_fixture_alpha.sql" "$WORK/alpha.sql"; chmod -R a+rX "$WORK"

SCRIPT="$ROOT/scripts/production-migrate.sh"
SURL="postgresql://postgres.$STG@127.0.0.1:$PORT/stg"; PURL="postgresql://postgres.$PRD@127.0.0.1:$PORT/prd"
mig(){ local mode="$1" list="$2"; shift 2; env -u GITHUB_ACTIONS PRODUCTION_MIGRATE_ALLOW_LOCALHOST=1 PRODUCTION_MIGRATE_TARGET="$T" PRODUCTION_MIGRATE_MODE="$mode" MIGRATIONS="$list" \
  CONFIRM_PROJECT_REF="$([ "$mode" = verify-staging ] && echo $STG || echo $PRD)" SUPABASE_STAGING_DB_URL="$SURL" SUPABASE_PRODUCTION_DB_URL="$PURL" "$@" bash "$SCRIPT" 2>&1; }
refused(){ local pat="$1"; shift; local out; if out="$("$@" 2>&1)"; then echo "FAIL (not refused): $*"; echo "$out"; exit 1; fi; grep -q -- "$pat" <<<"$out" || { echo "FAIL (wrong reason, wanted $pat): $out"; exit 1; }; }
# psql interpolates :'f' only in a script (not in -c): the statement goes through stdin.
stg_record(){ echo "insert into supabase_migrations.schema_migrations values('$(date +%s%N)',array[left(:'f',-1)],'$1','$3');" | "${ADMIN[@]}" -d stg -v f="$(cat "$2"; printf x)" -f -; }

# S
refused "not recorded on staging" mig verify-staging 901_fixture_alpha,902_fixture_beta
stg_record 901_fixture_alpha "$T/db/migrations/901_fixture_alpha.sql" someone@example.com
refused "not recorded on staging by the staging runner" mig verify-staging 901_fixture_alpha
"${ADMIN[@]}" -d stg -c "update supabase_migrations.schema_migrations set created_by='prospectos-staging-migrate', statements=array['other text'] where name='901_fixture_alpha'"
refused "differs from this commit" mig verify-staging 901_fixture_alpha
"${ADMIN[@]}" -d stg -c "delete from supabase_migrations.schema_migrations"
stg_record 901_fixture_alpha "$T/db/migrations/901_fixture_alpha.sql" prospectos-staging-migrate
stg_record 902_fixture_beta "$T/db/migrations/902_fixture_beta.sql" prospectos-staging-migrate
must grep -q "Staging verified" <<<"$(mig verify-staging 901_fixture_alpha,902_fixture_beta)"
must [ "$(q stg "select count(*) from pg_tables where tablename like 'fx_%'")" = 0 ]
pass "S  verify-staging: only the staging runner's record of this exact file passes; nothing written"

# D
out="$(mig dry-run 901_fixture_alpha,902_fixture_beta)"; must grep -q "Dry run done" <<<"$out"; must grep -q "ROLLED BACK" <<<"$out"
must [ "$(q prd "select count(*) from pg_tables where tablename like 'fx_%'")" = 0 ]
must [ "$(q prd "select count(*) from supabase_migrations.schema_migrations")" = 0 ]
pass "D  dry-run: migrations and checks ran, then nothing kept"

# A
must grep -q "Done: 2 migration" <<<"$(mig apply 901_fixture_alpha,902_fixture_beta)"
must [ "$(q prd "select count(*) from pg_tables where tablename in ('fx_alpha','fx_beta')")" = 2 ]
must [ "$(q prd "select string_agg(name||':'||created_by,',' order by name) from supabase_migrations.schema_migrations")" = "901_fixture_alpha:prospectos-production-migrate,902_fixture_beta:prospectos-production-migrate" ]
must [ "$(q prd "select md5(statements[1]) from supabase_migrations.schema_migrations where name='901_fixture_alpha'")" = "$(md5sum "$WORK/alpha.sql" | cut -d' ' -f1)" ]
pass "A  apply: applied, checked, recorded with the exact file text"

# R
refused "already recorded on production" mig apply 901_fixture_alpha
pass "R  a recorded migration is never re-run"

# X
"${ADMIN[@]}" -d prd -c "delete from supabase_migrations.schema_migrations; drop table public.fx_alpha, public.fx_beta"
refused "division by zero" mig apply 901_fixture_alpha,903_fixture_gamma,902_fixture_beta
must [ "$(q prd "select string_agg(tablename,',' order by tablename) from pg_tables where tablename like 'fx_%'")" = "fx_alpha" ]
must [ "$(q prd "select string_agg(name,',') from supabase_migrations.schema_migrations")" = "901_fixture_alpha" ]
pass "X  a failing migration leaves nothing and stops the run; the previous one is kept"

# K
refused "check 904 refuses" mig apply 904_fixture_delta
must [ "$(q prd "select count(*) from pg_tables where tablename='fx_delta'")" = 0 ]
pass "K  a failing check rolls its migration back"

# L
"${ADMIN[@]}" -d prd -c "select pg_advisory_lock(hashtextextended('prospectos:production-migrations',0)); select pg_sleep(4)" >/dev/null &
sleep 1; refused "LOCKED" mig apply 902_fixture_beta; wait
must [ "$(q prd "select count(*) from pg_tables where tablename='fx_beta'")" = 0 ]
pass "L  another run holding the lock → refused at once"

# G
refused "confirm_project_ref" env CONFIRM_PROJECT_REF=$STG PRODUCTION_MIGRATE_MODE=apply MIGRATIONS=901_fixture_alpha SUPABASE_PRODUCTION_DB_URL="$PURL" bash "$SCRIPT"
refused "mentions the other project" mig apply 902_fixture_beta SUPABASE_PRODUCTION_DB_URL="postgresql://postgres.$PRD@127.0.0.1:$PORT/prd?x=$STG"
refused "mentions the other project" mig verify-staging 901_fixture_alpha SUPABASE_STAGING_DB_URL="postgresql://postgres.$PRD:pw@db.$PRD.supabase.co:5432/postgres"
refused "host is not the production project" mig apply 902_fixture_beta SUPABASE_PRODUCTION_DB_URL="postgresql://postgres:pw@db.otherproject.supabase.co:5432/postgres"
refused "NNN_name" mig apply "902_fixture_beta, 901_fixture_alpha"
refused "NNN_name" mig apply ""
refused "listed twice" mig apply 902_fixture_beta,902_fixture_beta
refused "not a migration of this commit" mig apply 999_unknown
refused "meta-commands" mig apply 905_fixture_meta
refused "transaction lines" mig apply 906_fixture_malformed
refused "MODE must be" mig nonsense 902_fixture_beta
refused "sslmode=require" mig apply 902_fixture_beta GITHUB_ACTIONS=true EXPECTED_SHA="$(git -C "$T" rev-parse HEAD)" SUPABASE_PRODUCTION_DB_URL="postgresql://postgres:pw@db.$PRD.supabase.co:5432/postgres"
refused "EXPECTED_SHA is required" mig apply 902_fixture_beta GITHUB_ACTIONS=true SUPABASE_PRODUCTION_DB_URL="postgresql://postgres:pw@db.$PRD.supabase.co:5432/postgres?sslmode=require"
refused "is not the expected commit" mig apply 902_fixture_beta EXPECTED_SHA=0000000000000000000000000000000000000000
refused "host is not the production project" mig apply 902_fixture_beta GITHUB_ACTIONS=true EXPECTED_SHA="$(git -C "$T" rev-parse HEAD)" SUPABASE_PRODUCTION_DB_URL="postgresql://postgres.$PRD@127.0.0.1:$PORT/prd?sslmode=require"
out="$(mig apply 902_fixture_beta SUPABASE_PRODUCTION_DB_URL="postgresql://postgres:s3cret@db.otherproject.supabase.co:5432/postgres" || true)"; if grep -q s3cret <<<"$out"; then echo "FAIL: secret printed"; exit 1; fi
pass "G  guards: project, other project's ref, list, files, meta-commands, transaction lines, sslmode, SHA, localhost on GitHub; secret never printed"
echo "PRODUCTION MIGRATE (real PostgreSQL): all checks passed"
