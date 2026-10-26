#!/usr/bin/env bash
# PRODUCTION migration runner for ProspectOS (called by .github/workflows/production-migrations.yml). Production's history
# is not staging's (it was built by hand: no 001_schema row, some migrations deliberately absent), so this runner never
# "applies whatever is pending". It applies an EXPLICIT list of migrations, in the order given, and only migrations that
# STAGING already ran from the very same file. Three modes (PRODUCTION_MIGRATE_MODE):
#   verify-staging  connects to STAGING only: each listed migration must be recorded there by the staging runner
#                   (created_by prospectos-staging-migrate) with exactly this file's text (md5). Nothing is written.
#   dry-run         connects to PRODUCTION: runs every listed migration and its check, records it, then ROLLS BACK —
#                   the real database proves the run would succeed, and keeps nothing.
#   apply           the same, committed: each migration in ONE transaction (file statements → optional check file →
#                   history row with the exact file text), all or nothing; the first error stops the run.
#
# Guards, all before any connection — refused unless:
#  - CONFIRM_PROJECT_REF is exactly the project of the mode (staging for verify-staging, production otherwise);
#  - the connection string is a plain postgresql:// URL to that project's host (db.<ref>.supabase.co, user postgres or
#    postgres.<ref>) or its pooler (user postgres.<ref>); it never mentions the OTHER project; its only query parameter
#    is sslmode, mandatory (require / verify-*) on GitHub runners;
#  - on GitHub runners, EXPECTED_SHA is set and equals the checked-out commit;
#  - MIGRATIONS is 1 to 10 distinct NNN_name entries, each a file of this commit, with exactly one leading begin; and
#    one trailing commit; (or none), and no psql meta-command in it or in its check file.
# Planning (read only), fail closed: a listed migration already recorded on production → refused, nothing applied.
# One psql session holding a session-level advisory lock (another run is refused at once). The connection string is
# never printed.
set -euo pipefail

STAGING_REF="ggilyurgopsjrpnvxovl"
PRODUCTION_REF="vptqxhlxwiljfbkybqej"
STAGING_RUNNER="prospectos-staging-migrate"
RUNNER_ID="prospectos-production-migrate"
LOCK_KEY="prospectos:production-migrations"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$(cd "${PRODUCTION_MIGRATE_TARGET:-$ROOT}" && pwd)"
MIGRATIONS_DIR="$TARGET/db/migrations"
ON_GITHUB=0; [ "${GITHUB_ACTIONS:-}" = "true" ] && ON_GITHUB=1

fail(){ echo "PRODUCTION-MIGRATE REFUSED: $*" >&2; exit 1; }

# ——— 1. guards (no connection yet) ———
MODE="${PRODUCTION_MIGRATE_MODE:-}"
case "$MODE" in
  verify-staging) REF="$STAGING_REF"; OTHER="$PRODUCTION_REF"; URL="${SUPABASE_STAGING_DB_URL:-}"; WHAT="staging";;
  dry-run|apply)  REF="$PRODUCTION_REF"; OTHER="$STAGING_REF"; URL="${SUPABASE_PRODUCTION_DB_URL:-}"; WHAT="production";;
  *) fail "PRODUCTION_MIGRATE_MODE must be verify-staging, dry-run or apply";;
esac
[ "${CONFIRM_PROJECT_REF:-}" = "$REF" ] || fail "confirm_project_ref must be exactly the $WHAT project ref"
[ -n "$URL" ] || fail "the $WHAT connection string is empty"
case "$URL" in *"$OTHER"*) fail "the connection string mentions the other project (not $WHAT)";; esac
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
if [ "${PRODUCTION_MIGRATE_ALLOW_LOCALHOST:-}" = "1" ] && [ "$ON_GITHUB" = 0 ]; then LOCAL_TEST=1; fi
if [ "$DB_HOST" = "db.$REF.supabase.co" ]; then
  [ "$DB_USER" = "postgres" ] || [ "$DB_USER" = "postgres.$REF" ] || fail "unexpected database user for the $WHAT host"
elif [[ "$DB_HOST" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
  [ "$DB_USER" = "postgres.$REF" ] || fail "pooler user must be postgres.$REF"
elif [ "$LOCAL_TEST" = 1 ] && { [ "$DB_HOST" = "127.0.0.1" ] || [ "$DB_HOST" = "localhost" ]; }; then
  [ "$DB_USER" = "postgres.$REF" ] || fail "local test user must be postgres.$REF"
else
  fail "host is not the $WHAT project"
fi
HEAD_SHA="$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$ON_GITHUB" = 1 ] && [ -z "${EXPECTED_SHA:-}" ]; then fail "EXPECTED_SHA is required on GitHub runners"; fi
if [ -n "${EXPECTED_SHA:-}" ] && [ "$EXPECTED_SHA" != "$HEAD_SHA" ]; then fail "checked-out commit $HEAD_SHA is not the expected commit $EXPECTED_SHA"; fi

# ——— 2. the explicit list ———
LIST="${MIGRATIONS:-}"
[[ "$LIST" =~ ^[0-9]{3}_[a-z0-9_]+(,[0-9]{3}_[a-z0-9_]+){0,9}$ ]] || fail "MIGRATIONS must be 1 to 10 comma-separated NNN_name entries, no spaces"
IFS=',' read -ra NAMES <<<"$LIST"
declare -A SEEN=() MD5_OF=()
for n in "${NAMES[@]}"; do
  [ -z "${SEEN[$n]:-}" ] || fail "$n is listed twice"; SEEN[$n]=1
  f="$MIGRATIONS_DIR/$n.sql"
  [ -f "$f" ] || fail "$n.sql is not a migration of this commit"
  grep -qE '^\s*\\' "$f" && fail "$n.sql contains psql meta-commands"
  if [ -f "$MIGRATIONS_DIR/checks/$n.sql" ] && grep -qE '^\s*\\' "$MIGRATIONS_DIR/checks/$n.sql"; then fail "checks/$n.sql contains psql meta-commands"; fi
  b=$(grep -cx 'begin;' "$f" || true); c=$(grep -cx 'commit;' "$f" || true)
  first=$(awk '!/^[[:space:]]*(--.*)?$/{print; exit}' "$f"); last=$(awk '!/^[[:space:]]*(--.*)?$/{l=$0} END{print l}' "$f")
  if ! { [ "$b" = 1 ] && [ "$c" = 1 ] && [ "$first" = "begin;" ] && [ "$last" = "commit;" ]; } && ! { [ "$b" = 0 ] && [ "$c" = 0 ]; }; then
    fail "$n.sql: transaction lines must be exactly one leading begin; and one trailing commit; (or none)"
  fi
  MD5_OF[$n]="$(md5sum "$f" | cut -d' ' -f1)"
done
echo "Guards passed: $WHAT project $REF, mode $MODE, commit $HEAD_SHA, ${#NAMES[@]} migration(s): $LIST"
if [ "${PRODUCTION_MIGRATE_GUARD_ONLY:-}" = "1" ]; then echo "Guard-only mode: no connection made."; exit 0; fi

export PGCONNECT_TIMEOUT=15 PGAPPNAME="$RUNNER_ID" PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
HISTORY="$("${PSQL[@]}" -tA -F $'\t' -c "select name, coalesce(created_by,''), coalesce(md5(statements[1]),'') from supabase_migrations.schema_migrations where name ~ '^[0-9]{3}_' order by name")"
declare -A RECORDED_BY=() RECORDED_MD5=()
while IFS=$'\t' read -r name by md5; do [ -n "$name" ] || continue; RECORDED_BY[$name]="$by"; RECORDED_MD5[$name]="$md5"; done <<<"$HISTORY"

# ——— 3a. staging first: the same file, applied there by the staging runner ———
if [ "$MODE" = "verify-staging" ]; then
  for n in "${NAMES[@]}"; do
    [ -n "${RECORDED_BY[$n]+x}" ] || fail "$n is not recorded on staging: apply it there first"
    [ "${RECORDED_BY[$n]}" = "$STAGING_RUNNER" ] || fail "$n was not recorded on staging by the staging runner (recorded by another path)"
    [ "${RECORDED_MD5[$n]}" = "${MD5_OF[$n]}" ] || fail "$n on staging differs from this commit's file"
    echo "  $n  staging OK  md5 ${MD5_OF[$n]}"
  done
  echo "Staging verified: every listed migration ran there from this exact file."; exit 0
fi

# ——— 3b. production plan (read only), fail closed ———
for n in "${NAMES[@]}"; do [ -z "${RECORDED_BY[$n]+x}" ] || fail "$n is already recorded on production: nothing applied"; done
echo "Plan ($MODE, commit $HEAD_SHA):"; for n in "${NAMES[@]}"; do echo "  $n  md5 ${MD5_OF[$n]}"; done

# ——— 4. one session: lock, then each migration in its own all-or-nothing transaction ———
WORK="$(mktemp -d)"; chmod 700 "$WORK"; trap 'rm -rf "$WORK"' EXIT
DRIVER="$WORK/driver.sql"; VARS=()
END="commit;"; [ "$MODE" = "dry-run" ] && END="rollback;"
{
  echo "do \$lock\$ begin if not pg_try_advisory_lock(hashtextextended('$LOCK_KEY',0)) then raise exception 'PRODUCTION-MIGRATE LOCKED: another production migration run holds the lock'; end if; end \$lock\$;"
  i=0
  for n in "${NAMES[@]}"; do
    f="$MIGRATIONS_DIR/$n.sql"
    grep -vx -e 'begin;' -e 'commit;' "$f" > "$WORK/body_$i.sql"
    text="$(cat "$f"; printf x)"; VARS+=(-v "file_$i=${text%x}")
    echo "begin;"
    echo "do \$chk\$ begin if exists(select 1 from supabase_migrations.schema_migrations where name='$n') then raise exception 'PRODUCTION-MIGRATE: $n is already recorded'; end if; end \$chk\$;"
    echo "\\ir body_$i.sql"
    if [ -f "$MIGRATIONS_DIR/checks/$n.sql" ]; then cp "$MIGRATIONS_DIR/checks/$n.sql" "$WORK/check_$i.sql"; echo "\\ir check_$i.sql"; fi
    echo "insert into supabase_migrations.schema_migrations(version,name,statements,created_by)"
    echo " select greatest(to_char(clock_timestamp() at time zone 'utc','YYYYMMDDHH24MISS')::numeric, coalesce(max(version::numeric) filter (where version ~ '^[0-9]{14}\$'),0)+1)::text,"
    echo "  '$n', array[:'file_$i'], '$RUNNER_ID' from supabase_migrations.schema_migrations;"
    echo "$END"
    if [ "$MODE" = "dry-run" ]; then echo "\\echo '$n: applied, checked and recorded — then ROLLED BACK (dry run).'"; else echo "\\echo '$n: applied, checked and recorded.'"; fi
    i=$((i+1))
  done
  echo "select pg_advisory_unlock(hashtextextended('$LOCK_KEY',0)) as unlocked \\gset"
} > "$DRIVER"
"${PSQL[@]}" "${VARS[@]}" -f "$DRIVER"
if [ "$MODE" = "dry-run" ]; then echo "Dry run done: ${#NAMES[@]} migration(s) would apply cleanly; nothing was kept."
else echo "Done: ${#NAMES[@]} migration(s) applied and recorded on the production project."; fi
