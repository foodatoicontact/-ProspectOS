#!/usr/bin/env bash
# True parallel-session proof for the ProspectOS Bêta commercial quotas (migration 016) on a real PostgreSQL
# server: one trial user with 18 of 20 Discovery used fires 12 simultaneous launches across two of its
# organizations (double clicks, retries, several tabs) — exactly 2 must be recorded; with 48 of 50 analyses
# used, 12 simultaneous analyses must record exactly 2; with 3 of 5 AI offer analyses used, 12 simultaneous
# offer analyses of different texts must reserve exactly 2, and 8 simultaneous identical ones exactly 1.
# Hourly limits are raised out of the way here only.
# Needs local PostgreSQL binaries (not run in CI — the serialized cases are in tests/beta-commercial-quotas-db.mjs).
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
A=00000000-0000-4000-8000-00000000000a; O1=10000000-0000-4000-8000-000000000001; O2=10000000-0000-4000-8000-000000000002
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users(id,email) values('$A','a@t');
insert into public.organizations(id,name,owner_id) values('$O1','A','$A'),('$O2','A bis','$A');
insert into public.memberships(organization_id,user_id,role) values('$O1','$A','owner'),('$O2','$A','owner');
insert into public.projects(id,organization_id,name) values('20000000-0000-4000-8000-000000000001','$O1','P'),('20000000-0000-4000-8000-000000000002','$O2','P');
set role authenticated; select set_config('request.jwt.claim.sub','$A',false);
insert into public.prospects(id,organization_id,project_id,name,website,status) values
 ('30000000-0000-4000-8000-000000000001','$O1','20000000-0000-4000-8000-000000000001','X','https://x.example','À analyser'),
 ('30000000-0000-4000-8000-000000000002','$O2','20000000-0000-4000-8000-000000000002','X','https://x.example','À analyser');
reset role;
insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values('$A','BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days');
update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000;
insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select '$O1','discovery','$A' from generate_series(1,18);
insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select '$O1','analysis','$A' from generate_series(1,48);
insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select '$O1','ai_offer','$A' from generate_series(1,3);
SQL
count(){ "${PSQL[@]}" -tAc "select count(*) from prospectos_private.discovery_quota_usage where action='$1' and user_id='$A'"; }
race(){ # $1 label, $2 parallel sessions, $3 SQL template with %N = 1|2 (alternating organization)
 local at; at=$("${PSQL[@]}" -tAc "select (clock_timestamp()+interval '1.5 seconds')::text")
 for i in $(seq 1 "$2"); do
  local call="${3//%N/$(( i % 2 + 1 ))}"
  ( "${PSQL[@]}" -tAc "set role authenticated; select set_config('request.jwt.claim.sub','$A',false); select pg_sleep(greatest(0,extract(epoch from ('$at'::timestamptz - clock_timestamp())))); $call" >/dev/null 2>&1 && echo ok || echo refused ) >> "$WORK/race.$1" &
 done; wait; }
FAIL=0; pass(){ echo "PASS $1"; }; fail(){ echo "FAIL $1"; FAIL=1; }
race discovery 12 "select public.start_discovery('20000000-0000-4000-8000-00000000000%N','studios','Lyon','[]','brave',20,'{}'::jsonb);"
[ "$(count discovery)" = 20 ] && [ "$(grep -c ok "$WORK/race.discovery")" = 2 ] && pass "K_PARALLEL_DISCOVERY (12 simultaneous launches at 18/20 → $(count discovery)/20, $(grep -c ok "$WORK/race.discovery") accepted)" || fail "K_PARALLEL_DISCOVERY (recorded $(count discovery))"
runs=$("${PSQL[@]}" -tAc "select count(*) from public.discovery_runs")
[ "$runs" = 2 ] && pass "K_PARALLEL_DISCOVERY_RUNS (only the 2 accepted launches created a run)" || fail "K_PARALLEL_DISCOVERY_RUNS ($runs runs)"
race analysis 12 "select public.consume_analysis_quota('30000000-0000-4000-8000-00000000000%N');"
[ "$(count analysis)" = 50 ] && [ "$(grep -c ok "$WORK/race.analysis")" = 2 ] && pass "K_PARALLEL_ANALYSIS (12 simultaneous analyses at 48/50 → $(count analysis)/50)" || fail "K_PARALLEL_ANALYSIS (recorded $(count analysis))"
race offer 12 "select public.reserve_offer_analysis('20000000-0000-4000-8000-00000000000%N',lpad(md5(random()::text),64,'0'));"
[ "$(count ai_offer)" = 5 ] && [ "$(grep -c ok "$WORK/race.offer")" = 2 ] && pass "OFFER_PARALLEL (12 simultaneous offer analyses at 3/5 → $(count ai_offer)/5)" || fail "OFFER_PARALLEL (recorded $(count ai_offer))"
"${PSQL[@]}" -c "delete from prospectos_private.discovery_quota_usage where action='ai_offer'; delete from prospectos_private.offer_analyses" >/dev/null
race same 8 "select public.reserve_offer_analysis('20000000-0000-4000-8000-000000000001',repeat('a',64));"
[ "$(count ai_offer)" = 1 ] && [ "$(grep -c ok "$WORK/race.same")" = 1 ] && pass "OFFER_DOUBLE_SUBMIT (8 simultaneous identical requests → $(count ai_offer) unit)" || fail "OFFER_DOUBLE_SUBMIT (recorded $(count ai_offer))"
[ "$FAIL" = 0 ] && echo "PASS: commercial quotas hold under real parallel sessions" || { echo "FAIL"; exit 1; }
