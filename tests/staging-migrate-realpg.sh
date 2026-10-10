#!/usr/bin/env bash
# The generic staging migration runner (scripts/staging-migrate.sh) against a REAL local PostgreSQL server (throwaway
# cluster, deleted at the end), with the Supabase objects it relies on recreated (auth, roles,
# supabase_migrations.schema_migrations). Targets are throwaway git copies of this repository ("refs").
#  G  the Preview state of 2026-10-10 (001–026 recorded, 027 applied except delete_public_content, unrecorded)
#     → 027 replayed, checked, recorded, then 028 and every later real migration (029: provenance at the moment of use),
#     each with its own check; history = exact file text, created_by = the runner
#  H  second run → nothing to apply
#  A  a future migration, numbered after the newest real one (no runner change) → only it applied
#  C  fail closed: a recorded migration absent from the target ref; a pending migration older than the newest recorded
#     one; a file changed after the runner applied it; a malformed file → refused, nothing applied
#  D  two runners at once → exactly one migrates, the other is refused by the advisory lock; a lock held by a dead
#     session is released by the server
#  F  the history insert fails → that migration is rolled back with it, the run stops, the next one is not attempted
#  X  028 failing halfway → stopped, not recorded, none of its objects left, 029 not attempted; 027 kept
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
"${ADMIN[@]}" -d postgres -c "create role \"postgres.$REF\" login superuser" -c "create role anon nologin" -c "create role authenticated nologin" -c "create role service_role nologin bypassrls"
q(){ "${ADMIN[@]}" -d "$1" -tAc "$2"; }
pass(){ echo "PASS  $1"; }
# Every check goes through must: a failing test inside an && list would not stop a `set -e` script.
must(){ "$@" || { echo "FAIL: $*"; exit 1; }; }
# A target "ref": a git copy of db/ (optionally changed by $2, a shell snippet run inside it).
target(){ local dir="$WORK/ref_$1"; mkdir -p "$dir"; cp -r "$ROOT/db" "$dir/"; ( cd "$dir"; eval "${2:-true}"; git init -q; git add -A; git -c user.email=t@t -c user.name=t commit -qm "$1" ); echo "$dir"; }
# A staging-like database: auth, history table, schema.sql + 002..026 applied and recorded (001_schema = baseline).
setup(){ local db="$1"
 "${ADMIN[@]}" -d postgres -c "create database $db"
 "${ADMIN[@]}" -d "$db" >/dev/null <<'SQL'
create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
SQL
 "${ADMIN[@]}" -d "$db" -f "$ROOT/db/schema.sql" >/dev/null
 "${ADMIN[@]}" -d "$db" -c "insert into supabase_migrations.schema_migrations(version,name) values('20260927205305','001_schema')"
 for f in "$ROOT"/db/migrations/[0-9][0-9][0-9]_*.sql; do n=$(basename "$f" .sql); [ $((10#${n:0:3})) -lt 27 ] || continue
  "${ADMIN[@]}" -d "$db" -f "$f" >/dev/null
  "${ADMIN[@]}" -d "$db" -c "insert into supabase_migrations.schema_migrations(version,name) values('202609280$(printf %05d $((10#${n:0:3})))','$n')"; done
}
migrate(){ local db="$1" tgt="$2"; STAGING_MIGRATE_ALLOW_LOCALHOST=1 CONFIRM_PROJECT_REF=$REF STAGING_MIGRATE_TARGET="$tgt" \
 SUPABASE_STAGING_DB_URL="postgresql://postgres.$REF:secret-pw@127.0.0.1:$PORT/$db" bash "$ROOT/scripts/staging-migrate.sh"; }
recorded(){ q "$1" "select coalesce(string_agg(name,',' order by name),'') from supabase_migrations.schema_migrations where name ~ '^0(2[7-9]|3[0-9])_'"; }
refused(){ local out="$WORK/r.out"; set +e; migrate "$1" "$2" >"$out" 2>&1; local s=$?; set -e; [ "$s" != 0 ] || { cat "$out"; echo "FAIL: expected a refusal"; exit 1; }
 grep -q "$3" "$out" || { cat "$out"; echo "FAIL: refused for another reason than: $3"; exit 1; }; must test -z "$(grep secret-pw "$out")"; }
MAIN=$(target main)
# The real migrations from 027 on go through the runner; fixtures are numbered after the newest real one.
REAL=(); for f in "$ROOT"/db/migrations/[0-9][0-9][0-9]_*.sql; do REAL+=("$(basename "$f" .sql)"); done
NEXT=$(printf %03d $((10#${REAL[-1]:0:3}+1)))
PENDING_REAL=$(for n in "${REAL[@]}"; do [ $((10#${n:0:3})) -lt 27 ] || echo "$n"; done | paste -sd, -)

# ——— G: the observed Preview state ———
setup preview
"${ADMIN[@]}" -d preview -f "$ROOT/db/migrations/027_outreach_intelligence.sql" >/dev/null
"${ADMIN[@]}" -d preview -c "drop function public.delete_public_content(uuid)"
migrate preview "$MAIN" > "$WORK/g.out"
must [ "$(recorded preview)" = "$PENDING_REAL" ]
must [ "$(q preview "select count(*) from pg_proc where proname='delete_public_content'")" = 1 ]
must [ "$(q preview "select count(*) from pg_trigger where tgname='outreach_provenance_guard' and tgenabled='O'")" = 1 ]
must [ "$(q preview "select string_agg(plan||'='||period_limit||'/'||per_hour,',' order by plan) from prospectos_private.ai_outreach_limits")" = "BETA=25/10,ENTERPRISE=3000/60,INTERNAL=10000/120,PAID=150/20,PRO=500/30,TEAM=1000/30" ]
for m in ${PENDING_REAL//,/ }; do
  must [ "$(q preview "select md5(statements[1])||':'||created_by from supabase_migrations.schema_migrations where name='$m'")" = "$(md5sum "$ROOT/db/migrations/$m.sql" | cut -d' ' -f1):prospectos-staging-migrate" ]; done
must [ "$(q preview "select bool_and(version ~ '^[0-9]{14}\$') and count(distinct version)=count(*) from supabase_migrations.schema_migrations")" = t ]
must test -z "$(grep secret-pw "$WORK/g.out")"
pass "G — Preview state: partial 027 replayed and completed, checked, recorded (exact text, runner id); 028 applied with the validated limits; 029 applied and checked"

# ——— H: second run = no-op ———
migrate preview "$MAIN" > "$WORK/h.out"; must grep -q "Nothing to apply" "$WORK/h.out"
must [ "$(q preview "select count(*) from supabase_migrations.schema_migrations")" = $(( ${#REAL[@]} + 1 )) ]
pass "H — second run: nothing to apply, history unchanged (recorded migrations are never re-run)"

# ——— A: a future migration, no runner change ———
RNEXT=$(target withnext "printf 'begin;\ncreate table public.fake_next(id int);\ncommit;\n' > db/migrations/${NEXT}_fake_future.sql")
migrate preview "$RNEXT" > "$WORK/a.out"
must [ "$(recorded preview)" = "$PENDING_REAL,${NEXT}_fake_future" ]
must [ -n "$(q preview "select to_regclass('public.fake_next')")" ]
must grep -q "${NEXT}_fake_future" "$WORK/a.out"; must test -z "$(grep "027_outreach_intelligence: applied" "$WORK/a.out")"
pass "A — a new migration ${NEXT} is discovered and applied alone; nothing else re-run"

# ——— C: fail closed ———
before=$(q preview "select count(*) from supabase_migrations.schema_migrations")
refused preview "$MAIN" "which this commit does not contain"   # staging has the future migration, the main ref does not
CHANGED=$(target changed "printf '\n-- edited\n' >> db/migrations/027_outreach_intelligence.sql; printf 'begin;\ncreate table public.fake_next(id int);\ncommit;\n' > db/migrations/${NEXT}_fake_future.sql")
refused preview "$CHANGED" "changed after this runner applied it"
must [ "$(q preview "select count(*) from supabase_migrations.schema_migrations")" = "$before" ]
setup ooo; "${ADMIN[@]}" -d ooo -c "insert into supabase_migrations.schema_migrations(version,name) values('20261010000000','028_outreach_ai_generation')"
refused ooo "$MAIN" "out of order"
must [ -z "$(q ooo "select to_regclass('public.outreach_style_profiles')")" ]
setup malformed
BAD=$(target bad "printf 'begin;\ncreate table public.bad(id int);\ncommit;\nbegin;\nselect 1;\ncommit;\n' > db/migrations/${NEXT}_bad.sql")
refused malformed "$BAD" "transaction lines"
must [ "$(recorded malformed)" = "" ]; must [ -z "$(q malformed "select to_regclass('public.outreach_style_profiles')")" ]
META=$(target meta "printf 'begin;\n\\\\! touch /tmp/x\ncommit;\n' > db/migrations/${NEXT}_meta.sql")
refused malformed "$META" "psql meta-commands"
pass "C — fail closed: unknown recorded migration, file changed after apply, out of order, malformed file, psql meta-command → refused, nothing applied"

# ——— D: two runners at once; a dead session releases the lock ———
setup race
SLOW=$(target slow "printf 'begin;\nselect pg_sleep(4);\ncreate table public.slow_next(id int);\ncommit;\n' > db/migrations/${NEXT}_slow.sql")
( set +e; migrate race "$SLOW" > "$WORK/d1.out" 2>&1; echo $? > "$WORK/d1.rc" ) &
( set +e; sleep 1; migrate race "$SLOW" > "$WORK/d2.out" 2>&1; echo $? > "$WORK/d2.rc" ) &
wait
must [ "$(cat "$WORK/d1.rc")" = 0 ]; must [ "$(cat "$WORK/d2.rc")" != 0 ]; must grep -q "STAGING-MIGRATE LOCKED" "$WORK/d2.out"
must [ "$(q race "select count(*) from supabase_migrations.schema_migrations where name='${NEXT}_slow'")" = 1 ]
setup deadlock
( "${ADMIN[@]}" -d deadlock -c "select pg_advisory_lock(hashtextextended('prospectos:staging-migrations',0))" -c "select pg_sleep(3)" >/dev/null ) &
sleep 1; refused deadlock "$MAIN" "STAGING-MIGRATE LOCKED"
must [ "$(recorded deadlock)" = "" ]
wait   # the holder's session ends: the server drops its session lock
migrate deadlock "$MAIN" > /dev/null; must [ "$(recorded deadlock)" = "$PENDING_REAL" ]
pass "D — concurrent runners: one migrates, the other is refused by the advisory lock (${NEXT}_slow recorded once); a lock held by a session that ends is released"

# ——— F: history insert fails → rollback of that migration, stop before the next ———
setup histfail
"${ADMIN[@]}" -d histfail -c "create function public.reject_028() returns trigger language plpgsql as \$\$ begin if new.name like '028_%' then raise exception 'history write refused (test)'; end if; return new; end \$\$" \
 -c "create trigger reject_028 before insert on supabase_migrations.schema_migrations for each row execute function public.reject_028()"
set +e; migrate histfail "$RNEXT" > "$WORK/f.out" 2>&1; s=$?; set -e
must [ "$s" != 0 ]; must grep -q "history write refused" "$WORK/f.out"
must [ "$(recorded histfail)" = "027_outreach_intelligence" ]
must [ -z "$(q histfail "select to_regclass('prospectos_private.ai_outreach_limits')")" ]
must [ -z "$(q histfail "select to_regclass('public.fake_next')")" ]
must [ "$(q histfail "select count(*) from pg_trigger where tgname='outreach_provenance_guard'")" = 0 ]
pass "F — history write refused for 028: 028 rolled back with it (no object left), run stopped, 029 and later not attempted; 027 kept recorded"

# ——— X: 028 fails halfway ———
setup failcase
"${ADMIN[@]}" -d failcase -c "create table prospectos_private.ai_outreach_usage(id int)"
set +e; migrate failcase "$MAIN" > /dev/null 2>&1; s=$?; set -e
must [ "$s" != 0 ]; must [ "$(recorded failcase)" = "027_outreach_intelligence" ]
must [ -z "$(q failcase "select to_regclass('prospectos_private.ai_outreach_limits')")" ]
must [ "$(q failcase "select pg_get_constraintdef(oid) like '%outreach_generation%' from pg_constraint where conname='api_usage_events_operation_check'")" = f ]
must [ "$(q failcase "select count(*) from pg_trigger where tgname='outreach_provenance_guard'")" = 0 ]
pass "X — 028 error halfway: stopped, 028 not recorded, none of its objects left, 029 not attempted; 027 kept"
echo "STAGING-MIGRATE REAL POSTGRES: 7/7 PASS"
