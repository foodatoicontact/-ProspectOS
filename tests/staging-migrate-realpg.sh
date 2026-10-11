#!/usr/bin/env bash
# The generic staging migration runner (scripts/staging-migrate.sh) against a REAL local PostgreSQL server (throwaway
# cluster, deleted at the end), with the Supabase objects it relies on recreated (auth, roles,
# supabase_migrations.schema_migrations). Targets are throwaway git copies of this repository's db/ ("refs") plus
# FIXTURE migrations numbered after the newest real one (N1, N2, …) — independent of any application migration.
#  G  a fixture migration applied partially and never recorded (as after an interrupted run) → replayed, its optional
#     check (from the target ref) run, recorded with the exact file text; the next fixture applied after it
#  H  second run → nothing to apply (recorded migrations are never re-run)
#  A  one more migration in a new ref → only that one applied (no runner change)
#  K  a failing check shipped in the target ref → that migration rolled back with it, not recorded
#  C  fail closed: recorded migration absent from the ref, pending one older than the newest recorded, file changed
#     after the runner applied it, malformed transaction lines, psql meta-command → refused, nothing applied
#  D  two runners at once → exactly one migrates, the other is refused by the advisory lock; a lock held by a session
#     that ends is released by the server
#  F  the history insert fails → that migration rolled back with it, the run stops, the next one is not attempted
#  X  a migration failing halfway → stopped, not recorded, none of its objects left; the previous one kept
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

# Fixture numbers: after the newest real migration of this ref.
LAST=""; for f in "$ROOT"/db/migrations/[0-9][0-9][0-9]_*.sql; do LAST="$(basename "$f")"; done
num(){ printf '%03d' $((10#${LAST:0:3} + $1)); }
N1="$(num 1)_fixture_alpha"; N2="$(num 2)_fixture_beta"; N3="$(num 3)_fixture_gamma"; N4="$(num 4)_fixture_ghost"
# A target "ref": a git copy of db/ changed by a shell snippet (fixtures); prints its directory.
target(){ local dir="$WORK/ref_$1"; mkdir -p "$dir"; cp -r "$ROOT/db" "$dir/"; mkdir -p "$dir/db/migrations/checks"
 ( cd "$dir"; eval "${2:-true}"; git init -q; git add -A; git -c user.email=t@t -c user.name=t commit -qm "$1" ); echo "$dir"; }
add_alpha(){ cat > db/migrations/$N1.sql <<'SQL'
begin;
create table if not exists public.fixture_alpha(id int);
create or replace function public.fixture_alpha_fn() returns int language sql as $f$ select 1 $f$;
commit;
SQL
cat > db/migrations/checks/$N1.sql <<'SQL'
do $c$ begin if to_regclass('public.fixture_alpha') is null or to_regprocedure('public.fixture_alpha_fn()') is null then raise exception 'check alpha: objects missing'; end if; end $c$;
SQL
}
add_beta(){ printf 'begin;\ncreate table public.fixture_beta(id int);\ncreate index fixture_beta_idx on public.fixture_beta(id);\ncommit;\n' > db/migrations/$N2.sql; }
add_gamma(){ printf 'begin;\ncreate table public.fixture_gamma(id int);\ncommit;\n' > db/migrations/$N3.sql; }
export -f add_alpha add_beta add_gamma; export N1 N2 N3
# A staging-like database: auth, history table, schema.sql + every real migration applied and recorded (001_schema = baseline).
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
 for f in "$ROOT"/db/migrations/[0-9][0-9][0-9]_*.sql; do n=$(basename "$f" .sql)
  "${ADMIN[@]}" -d "$db" -f "$f" >/dev/null
  "${ADMIN[@]}" -d "$db" -c "insert into supabase_migrations.schema_migrations(version,name) values('202609280$(printf %05d $((10#${n:0:3})))','$n')"; done
}
migrate(){ local db="$1" tgt="$2"; STAGING_MIGRATE_ALLOW_LOCALHOST=1 CONFIRM_PROJECT_REF=$REF STAGING_MIGRATE_TARGET="$tgt" \
 SUPABASE_STAGING_DB_URL="postgresql://postgres.$REF:secret-pw@127.0.0.1:$PORT/$db" bash "$ROOT/scripts/staging-migrate.sh"; }
fixtures(){ q "$1" "select coalesce(string_agg(name,',' order by name),'') from supabase_migrations.schema_migrations where name like '%\\_fixture\\_%'"; }
refused(){ local out="$WORK/r.out"; set +e; migrate "$1" "$2" >"$out" 2>&1; local s=$?; set -e; [ "$s" != 0 ] || { cat "$out"; echo "FAIL: expected a refusal"; exit 1; }
 grep -q "$3" "$out" || { cat "$out"; echo "FAIL: refused for another reason than: $3"; exit 1; }; must test -z "$(grep secret-pw "$out")"; }
R12=$(target r12 "add_alpha; add_beta")

# ——— G: interrupted earlier run → replay of the partial, unrecorded migration, then the next ———
setup g
"${ADMIN[@]}" -d g -c "create table public.fixture_alpha(id int)"   # alpha half applied, never recorded
migrate g "$R12" > "$WORK/g.out"
must [ "$(fixtures g)" = "$N1,$N2" ]
must [ -n "$(q g "select to_regprocedure('public.fixture_alpha_fn()')")" ]
for m in "$N1" "$N2"; do
 must [ "$(q g "select md5(statements[1])||':'||created_by from supabase_migrations.schema_migrations where name='$m'")" = "$(md5sum "$R12/db/migrations/$m.sql" | cut -d' ' -f1):prospectos-staging-migrate" ]; done
must [ "$(q g "select bool_and(version ~ '^[0-9]{14}\$') and count(distinct version)=count(*) from supabase_migrations.schema_migrations")" = t ]
must test -z "$(grep secret-pw "$WORK/g.out")"
pass "G — partial unrecorded migration replayed and completed, its check (from the target ref) run, recorded with the exact file text; the next one applied"

# ——— H: second run = no-op ———
before=$(q g "select count(*) from supabase_migrations.schema_migrations")
migrate g "$R12" > "$WORK/h.out"; must grep -q "Nothing to apply" "$WORK/h.out"
must [ "$(q g "select count(*) from supabase_migrations.schema_migrations")" = "$before" ]
pass "H — second run: nothing to apply, history unchanged"

# ——— A: one more migration in a new ref, no runner change ———
R123=$(target r123 "add_alpha; add_beta; add_gamma")
migrate g "$R123" > "$WORK/a.out"
must [ "$(fixtures g)" = "$N1,$N2,$N3" ]; must [ -n "$(q g "select to_regclass('public.fixture_gamma')")" ]
must grep -q "$N3: applied" "$WORK/a.out"; must test -z "$(grep "$N1: applied" "$WORK/a.out")"
pass "A — a new migration is discovered and applied alone"

# ——— K: a failing check from the target ref rolls its migration back ———
setup k
RK=$(target rk "add_alpha; echo \"do \\\$c\\\$ begin raise exception 'check refused (test)'; end \\\$c\\\$;\" > db/migrations/checks/$N1.sql")
set +e; migrate k "$RK" > "$WORK/k.out" 2>&1; s=$?; set -e
must [ "$s" != 0 ]; must grep -q "check refused (test)" "$WORK/k.out"
must [ "$(fixtures k)" = "" ]; must [ -z "$(q k "select to_regclass('public.fixture_alpha')")" ]
pass "K — a failing check shipped in the target ref: the migration is rolled back with it and not recorded"

# ——— C: fail closed ———
before=$(q g "select count(*) from supabase_migrations.schema_migrations")
refused g "$R12" "which this commit does not contain"                       # staging has N3, this ref does not
CHANGED=$(target changed "add_alpha; add_beta; add_gamma; printf '\n-- edited\n' >> db/migrations/$N1.sql")
refused g "$CHANGED" "changed after this runner applied it"
must [ "$(q g "select count(*) from supabase_migrations.schema_migrations")" = "$before" ]
setup ooo; "${ADMIN[@]}" -d ooo -c "insert into supabase_migrations.schema_migrations(version,name) values('20991231000000','$N2')"
refused ooo "$R12" "out of order"; must [ -z "$(q ooo "select to_regclass('public.fixture_alpha')")" ]
setup malformed
BAD=$(target bad "printf 'begin;\ncreate table public.bad(id int);\ncommit;\nbegin;\nselect 1;\ncommit;\n' > db/migrations/$N1.sql")
refused malformed "$BAD" "transaction lines"
META=$(target meta "printf 'begin;\n\\\\! touch /tmp/x\ncommit;\n' > db/migrations/$N1.sql")
refused malformed "$META" "psql meta-commands"
must [ "$(fixtures malformed)" = "" ]
setup ghost; "${ADMIN[@]}" -d ghost -c "insert into supabase_migrations.schema_migrations(version,name) values('20991231000000','$N4')"
refused ghost "$R12" "which this commit does not contain"
pass "C — fail closed: unknown recorded migration, file changed after apply, out of order, malformed file, psql meta-command → refused, nothing applied"

# ——— D: two runners at once; a session that ends releases the lock ———
setup race
SLOW=$(target slow "printf 'begin;\nselect pg_sleep(4);\ncreate table public.fixture_slow(id int);\ncommit;\n' > db/migrations/$N1.sql")
( set +e; migrate race "$SLOW" > "$WORK/d1.out" 2>&1; echo $? > "$WORK/d1.rc" ) &
( set +e; sleep 1; migrate race "$SLOW" > "$WORK/d2.out" 2>&1; echo $? > "$WORK/d2.rc" ) &
wait
must [ "$(cat "$WORK/d1.rc")" = 0 ]; must [ "$(cat "$WORK/d2.rc")" != 0 ]; must grep -q "STAGING-MIGRATE LOCKED" "$WORK/d2.out"
must [ "$(q race "select count(*) from supabase_migrations.schema_migrations where name='$N1'")" = 1 ]
setup held
( "${ADMIN[@]}" -d held -c "select pg_advisory_lock(hashtextextended('prospectos:staging-migrations',0))" -c "select pg_sleep(3)" >/dev/null ) &
sleep 1; refused held "$R12" "STAGING-MIGRATE LOCKED"; must [ "$(fixtures held)" = "" ]
wait
migrate held "$R12" > /dev/null; must [ "$(fixtures held)" = "$N1,$N2" ]
pass "D — concurrent runners: one migrates, the other is refused by the advisory lock (recorded once); a lock held by a session that ends is released"

# ——— F: history insert fails → rollback of that migration, stop before the next ———
setup histfail
"${ADMIN[@]}" -d histfail -c "create function public.reject_beta() returns trigger language plpgsql as \$\$ begin if new.name = '$N2' then raise exception 'history write refused (test)'; end if; return new; end \$\$" \
 -c "create trigger reject_beta before insert on supabase_migrations.schema_migrations for each row execute function public.reject_beta()"
set +e; migrate histfail "$R123" > "$WORK/f.out" 2>&1; s=$?; set -e
must [ "$s" != 0 ]; must grep -q "history write refused" "$WORK/f.out"
must [ "$(fixtures histfail)" = "$N1" ]
must [ -z "$(q histfail "select to_regclass('public.fixture_beta')")" ]; must [ -z "$(q histfail "select to_regclass('public.fixture_gamma')")" ]
pass "F — history write refused for the second migration: rolled back with it (no object left), run stopped, the third not attempted; the first kept"

# ——— X: a migration failing halfway (its table is created, then its index name is already taken) ———
setup failcase
"${ADMIN[@]}" -d failcase -c "create table public.fixture_beta_idx(id int)"
set +e; migrate failcase "$R12" > /dev/null 2>&1; s=$?; set -e
must [ "$s" != 0 ]; must [ "$(fixtures failcase)" = "$N1" ]
must [ -z "$(q failcase "select to_regclass('public.fixture_beta')")" ]
pass "X — error halfway through a migration: stopped, not recorded, none of its objects left; the previous one kept"
echo "STAGING-MIGRATE REAL POSTGRES: 8/8 PASS"
