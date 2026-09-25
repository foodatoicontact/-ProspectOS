#!/usr/bin/env bash
# True parallel-session proof for consume_analysis_quota() (migration 015) on a real PostgreSQL server:
# one user, two organizations, 20 simultaneous analyses with a per-user limit of 5 must record exactly 5
# reservations. A negative control (the same checks WITHOUT the advisory locks, created in this throwaway
# database only) must exceed the limit, proving the race is real and visible to this test. Needs local
# PostgreSQL binaries (not run in CI — the serialized cases are covered by tests/dynamic-analysis-db.mjs).
# Creates and deletes its own temporary cluster; touches nothing else.
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/postgres" ] || { echo "SKIPPED: no local PostgreSQL server binaries"; exit 0; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; PORT=$(( 20000 + RANDOM % 20000 ))
RUN=(); if [ "$(id -u)" = 0 ]; then chown -R postgres "$WORK"; RUN=(runuser -u postgres --); fi
cleanup(){ "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c max_connections=60" -l "$WORK/log" start -w >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
SQL
"${PSQL[@]}" -f "$ROOT/db/schema.sql" >/dev/null
for f in "$ROOT"/db/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
A=00000000-0000-4000-8000-00000000000a
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users(id,email) values('$A','a@t');
insert into public.organizations(id,name,owner_id) values('10000000-0000-4000-8000-000000000001','A','$A'),('10000000-0000-4000-8000-000000000002','A bis','$A');
insert into public.memberships(organization_id,user_id,role) values('10000000-0000-4000-8000-000000000001','$A','owner'),('10000000-0000-4000-8000-000000000002','$A','owner');
insert into public.projects(id,organization_id,name) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','P'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','P');
set role authenticated; select set_config('request.jwt.claim.sub','$A',false);
insert into public.prospects(id,organization_id,project_id,name,website,status) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','X','https://x.example','À analyser'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','X','https://x.example','À analyser');
reset role;
update prospectos_private.discovery_quota_settings set analyses_per_hour=100, analyses_per_user_per_hour=5;
-- Negative control only: the same checks and insert without the advisory locks, with a pause between the
-- count and the insert so an unlocked version's race window is guaranteed to be hit.
create function public.consume_analysis_quota_unlocked(p_prospect_id uuid) returns void language plpgsql security definer set search_path='' as \$\$
declare tenant uuid; actor uuid := auth.uid(); used int;
begin
 select organization_id into tenant from public.prospects where id=p_prospect_id;
 perform prospectos_private.require_member(tenant);
 select count(*) into used from prospectos_private.discovery_quota_usage where user_id=actor and action='analysis' and used_at > now()-interval '1 hour';
 if used >= 5 then raise exception 'quota_exceeded' using errcode='P0001'; end if;
 perform pg_sleep(0.5);
 insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) values(tenant,'analysis',actor);
end \$\$;
grant execute on function public.consume_analysis_quota_unlocked(uuid) to authenticated;
SQL
count(){ "${PSQL[@]}" -tAc "select count(*) from prospectos_private.discovery_quota_usage where action='analysis' and user_id='$A'"; }
race(){ # $1 function, $2 parallel sessions alternating between the user's two organizations
 "${PSQL[@]}" -c "delete from prospectos_private.discovery_quota_usage" >/dev/null
 local at; at=$("${PSQL[@]}" -tAc "select (clock_timestamp()+interval '1.5 seconds')::text")
 for i in $(seq 1 "$2"); do
  local p="30000000-0000-4000-8000-00000000000$(( i % 2 + 1 ))"
  ( "${PSQL[@]}" -tAc "set role authenticated; select set_config('request.jwt.claim.sub','$A',false); select pg_sleep(greatest(0,extract(epoch from ('$at'::timestamptz - clock_timestamp())))); select public.$1('$p');" >/dev/null 2>&1 && echo ok || echo refused ) >> "$WORK/race.$1" &
 done; wait; }
FAIL=0; pass(){ echo "PASS $1"; }; fail(){ echo "FAIL $1"; FAIL=1; }
race consume_analysis_quota 20
[ "$(count)" = 5 ] && [ "$(grep -c ok "$WORK/race.consume_analysis_quota")" = 5 ] && pass "S_PARALLEL_USER_QUOTA (20 simultaneous analyses across 2 organizations, limit 5 → exactly $(count))" || fail "S_PARALLEL_USER_QUOTA (recorded $(count))"
race consume_analysis_quota_unlocked 10
[ "$(count)" -gt 5 ] && pass "NEGATIVE_CONTROL_UNLOCKED_EXCEEDS ($(count)/5 without the locks)" || fail "NEGATIVE_CONTROL_UNLOCKED_EXCEEDS ($(count)/5 — race not reproduced)"
[ "$FAIL" = 0 ] && echo "PASS: consume_analysis_quota holds the per-user limit under real parallel sessions" || { echo "FAIL"; exit 1; }
