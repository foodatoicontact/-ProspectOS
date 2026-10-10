#!/usr/bin/env bash
# Generic STAGING migration runner for ProspectOS (permanent infrastructure, called by
# .github/workflows/staging-migrations.yml). It never needs editing for a new migration: it applies, in order, every
# db/migrations/NNN_name.sql of the target checkout ($STAGING_MIGRATE_TARGET, default: this repository) that the staging history (supabase_migrations.schema_migrations,
# matched by name) does not record yet.
#
# Guards, all before any connection — refused unless:
#  - CONFIRM_PROJECT_REF is exactly the staging ref;
#  - SUPABASE_STAGING_DB_URL is a plain postgresql:// URL to the staging host (db.<ref>.supabase.co) or to the Supabase
#    pooler with user postgres.<ref>; it never mentions the production ref; its only query parameter is sslmode, which
#    is mandatory (require / verify-*) on GitHub runners;
#  - on GitHub runners, EXPECTED_SHA is set and equals the checked-out commit (when set elsewhere, it must match too).
# Planning (read only), fail closed: a recorded NNN_* name with no file in this commit (other ref than the one applied
# to staging), a file whose number is below the highest recorded one (out of order), two files with one number, a
# migration this runner recorded whose file has changed since, a file outside the begin;/commit; convention or
# containing psql meta-commands → refused, nothing applied.
# Applying: ONE psql session for the whole run. It first takes a PostgreSQL session-level advisory lock (refused at once
# if another run holds it; released at the end, or by the server if the session dies), then for each migration, in ONE
# transaction: check it is still unrecorded → the file's statements (its own begin;/commit; lines removed, nothing
# else) → its optional check file db/migrations/checks/<name>.sql → the history row with the file's exact text. Any
# error stops the run: that migration is rolled back entirely (applied and recorded together, or not at all) and no
# later migration is attempted. The connection string is never printed.
set -euo pipefail

STAGING_REF="ggilyurgopsjrpnvxovl"
PRODUCTION_REF="vptqxhlxwiljfbkybqej"
RUNNER_ID="prospectos-staging-migrate"
LOCK_KEY="prospectos:staging-migrations"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The migrations come from the checkout of the selected ref (the runner itself from the workflow's own commit).
TARGET="$(cd "${STAGING_MIGRATE_TARGET:-$ROOT}" && pwd)"
MIGRATIONS_DIR="$TARGET/db/migrations"
ON_GITHUB=0; [ "${GITHUB_ACTIONS:-}" = "true" ] && ON_GITHUB=1

fail(){ echo "STAGING-MIGRATE REFUSED: $*" >&2; exit 1; }

# ——— 1. guards (no connection yet) ———
[ "${CONFIRM_PROJECT_REF:-}" = "$STAGING_REF" ] || fail "confirm_project_ref must be exactly the staging project ref"
URL="${SUPABASE_STAGING_DB_URL:-}"
[ -n "$URL" ] || fail "SUPABASE_STAGING_DB_URL is empty"
case "$URL" in *"$PRODUCTION_REF"*) fail "the connection string mentions the PRODUCTION project";; esac
re='^postgres(ql)?://([^:@/?#]+)(:[^@]*)?@([^:/?#]+)(:[0-9]+)?/([A-Za-z0-9_]+)(\?(.*))?$'
[[ "$URL" =~ $re ]] || fail "connection string is not a plain postgresql://user[:password]@host[:port]/db URL"
DB_USER="${BASH_REMATCH[2]}"; DB_HOST="${BASH_REMATCH[4]}"; DB_QUERY="${BASH_REMATCH[8]:-}"
SSL=""
if [ -n "$DB_QUERY" ]; then
  IFS='&' read -ra params <<<"$DB_QUERY"
  for p in "${params[@]}"; do case "$p" in sslmode=require|sslmode=verify-full|sslmode=verify-ca) SSL="$p";; *) fail "only sslmode may be set in the query string";; esac; done
fi
[ "$ON_GITHUB" = 0 ] || [ -n "$SSL" ] || fail "sslmode=require (or verify-*) is mandatory on GitHub runners"
LOCAL_TEST=0
if [ "${STAGING_MIGRATE_ALLOW_LOCALHOST:-}" = "1" ] && [ "$ON_GITHUB" = 0 ]; then LOCAL_TEST=1; fi
if [ "$DB_HOST" = "db.$STAGING_REF.supabase.co" ]; then
  [ "$DB_USER" = "postgres" ] || [ "$DB_USER" = "postgres.$STAGING_REF" ] || fail "unexpected database user for the staging host"
elif [[ "$DB_HOST" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
  [ "$DB_USER" = "postgres.$STAGING_REF" ] || fail "pooler user must be postgres.$STAGING_REF"
elif [ "$LOCAL_TEST" = 1 ] && { [ "$DB_HOST" = "127.0.0.1" ] || [ "$DB_HOST" = "localhost" ]; }; then
  [ "$DB_USER" = "postgres.$STAGING_REF" ] || fail "local test user must be postgres.$STAGING_REF"
else
  fail "host is not the staging project"
fi
HEAD_SHA="$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$ON_GITHUB" = 1 ] && [ -z "${EXPECTED_SHA:-}" ]; then fail "EXPECTED_SHA is required on GitHub runners"; fi
if [ -n "${EXPECTED_SHA:-}" ] && [ "$EXPECTED_SHA" != "$HEAD_SHA" ]; then fail "checked-out commit $HEAD_SHA is not the expected commit $EXPECTED_SHA"; fi

# ——— 2. the migrations of this commit ———
declare -a NAMES=(); declare -A FILE_OF=() NUM_SEEN=()
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$f" ] || continue
  n="$(basename "$f" .sql)"
  [[ "$n" =~ ^[0-9]{3}_[a-z0-9_]+$ ]] || fail "unexpected migration file name: $n.sql"
  num="${n:0:3}"; [ -z "${NUM_SEEN[$num]:-}" ] || fail "two migration files use number $num"
  NUM_SEEN[$num]=1; NAMES+=("$n"); FILE_OF[$n]="$f"
  if [ -f "$MIGRATIONS_DIR/checks/$n.sql" ] && grep -qE '^\s*\\' "$MIGRATIONS_DIR/checks/$n.sql"; then fail "checks/$n.sql contains psql meta-commands"; fi
done
# db/schema.sql is the baseline, recorded on Supabase as 001_schema; it is never applied by this runner.
BASELINE="001_schema"
echo "Guards passed: staging project $STAGING_REF, commit $HEAD_SHA, ${#NAMES[@]} migration files."
if [ "${STAGING_MIGRATE_GUARD_ONLY:-}" = "1" ]; then echo "Guard-only mode: no connection made."; exit 0; fi

export PGCONNECT_TIMEOUT=15 PGAPPNAME="$RUNNER_ID" PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)

# ——— 3. plan (read only), fail closed ———
HISTORY="$("${PSQL[@]}" -tA -F $'\t' -c "select name, coalesce(created_by,''), coalesce(md5(statements[1]),'') from supabase_migrations.schema_migrations where name ~ '^[0-9]{3}_' order by name")"
declare -A RECORDED=() RECORDED_MD5=() RECORDED_BY=()
max_recorded=0
while IFS=$'\t' read -r name by md5; do
  [ -n "$name" ] || continue
  RECORDED[$name]=1; RECORDED_BY[$name]="$by"; RECORDED_MD5[$name]="$md5"
  if [ "$name" != "$BASELINE" ] && [ -z "${FILE_OF[$name]:-}" ]; then fail "staging records $name, which this commit does not contain (wrong ref?)"; fi
  n=$((10#${name:0:3})); [ "$n" -gt "$max_recorded" ] && max_recorded=$n
done <<<"$HISTORY"
[ -n "${RECORDED[$BASELINE]:-}" ] || fail "the baseline $BASELINE is not recorded on this database"
declare -a PENDING=()
for n in "${NAMES[@]}"; do
  if [ -n "${RECORDED[$n]:-}" ]; then
    if [ "${RECORDED_BY[$n]}" = "$RUNNER_ID" ] && [ "${RECORDED_MD5[$n]}" != "$(md5sum "${FILE_OF[$n]}" | cut -d' ' -f1)" ]; then
      fail "$n.sql changed after this runner applied it"
    fi
    continue
  fi
  [ $((10#${n:0:3})) -gt "$max_recorded" ] || fail "$n is older than the newest recorded migration (out of order)"
  PENDING+=("$n")
done
if [ "${#PENDING[@]}" = 0 ]; then echo "Nothing to apply: every migration of commit $HEAD_SHA is recorded on staging."; exit 0; fi
echo "Plan (commit $HEAD_SHA):"; for n in "${PENDING[@]}"; do echo "  $n  md5 $(md5sum "${FILE_OF[$n]}" | cut -d' ' -f1)"; done

# ——— 4. one session: lock, then each migration in its own all-or-nothing transaction ———
WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
DRIVER="$WORK/driver.sql"; VARS=()
{
  echo "do \$lock\$ begin if not pg_try_advisory_lock(hashtextextended('$LOCK_KEY',0)) then raise exception 'STAGING-MIGRATE LOCKED: another staging migration run holds the lock'; end if; end \$lock\$;"
  i=0
  for n in "${PENDING[@]}"; do
    f="${FILE_OF[$n]}"
    grep -qE '^\s*\\' "$f" && fail "$n.sql contains psql meta-commands"
    b=$(grep -cx 'begin;' "$f" || true); c=$(grep -cx 'commit;' "$f" || true)
    # awk reads the whole file: piping into an early-exiting reader could die of SIGPIPE under pipefail.
    first=$(awk '!/^[[:space:]]*(--.*)?$/{print; exit}' "$f"); last=$(awk '!/^[[:space:]]*(--.*)?$/{l=$0} END{print l}' "$f")
    if [ "$b" = 1 ] && [ "$c" = 1 ] && [ "$first" = "begin;" ] && [ "$last" = "commit;" ]; then
      grep -vx -e 'begin;' -e 'commit;' "$f" > "$WORK/body_$i.sql"
    elif [ "$b" = 0 ] && [ "$c" = 0 ]; then
      cp "$f" "$WORK/body_$i.sql"
    else
      fail "$n.sql: transaction lines must be exactly one leading begin; and one trailing commit; (or none)"
    fi
    text="$(cat "$f"; printf x)"; VARS+=(-v "file_$i=${text%x}")
    echo "begin;"
    echo "do \$chk\$ begin if exists(select 1 from supabase_migrations.schema_migrations where name='$n') then raise exception 'STAGING-MIGRATE: $n is already recorded'; end if; end \$chk\$;"
    echo "\\ir body_$i.sql"
    if [ -f "$MIGRATIONS_DIR/checks/$n.sql" ]; then cp "$MIGRATIONS_DIR/checks/$n.sql" "$WORK/check_$i.sql"; echo "\\ir check_$i.sql"; fi
    echo "insert into supabase_migrations.schema_migrations(version,name,statements,created_by)"
    echo " select greatest(to_char(clock_timestamp() at time zone 'utc','YYYYMMDDHH24MISS')::numeric, coalesce(max(version::numeric) filter (where version ~ '^[0-9]{14}\$'),0)+1)::text,"
    echo "  '$n', array[:'file_$i'], '$RUNNER_ID' from supabase_migrations.schema_migrations;"
    echo "commit;"
    echo "\\echo '$n: applied, checked and recorded.'"
    i=$((i+1))
  done
  echo "select pg_advisory_unlock(hashtextextended('$LOCK_KEY',0)) as unlocked \\gset"
} > "$DRIVER"
"${PSQL[@]}" "${VARS[@]}" -f "$DRIVER"
echo "Done: ${#PENDING[@]} migration(s) applied and recorded on the staging project."
