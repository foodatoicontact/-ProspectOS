#!/usr/bin/env bash
# True parallel-session proof for the Pro team pool (migration 022) on a real PostgreSQL server: a Pro team of
# 5 accounts with 298 of 300 Discovery used fires 12 simultaneous launches from its 5 different accounts — exactly
# 2 must be recorded (the per-user locks differ, so only the per-team lock can hold the pool).
# Needs local PostgreSQL binaries (not run in CI — the serialized cases are in tests/team-pro-db.mjs).
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
create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
SQL
"${PSQL[@]}" -f "$ROOT/db/schema.sql" >/dev/null
for f in "$ROOT"/db/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
T=10000000-0000-4000-8000-000000000001; P=20000000-0000-4000-8000-000000000001
U(){ printf '00000000-0000-4000-8000-%012d' "$1"; }
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users(id,email,email_confirmed_at) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'u'||i||'@t',now() from generate_series(1,5) i;
insert into public.organizations(id,name,owner_id) values('$T','Team','$(U 1)');
insert into public.memberships(organization_id,user_id,role) values('$T','$(U 1)','owner'),('$T','$(U 2)','member'),('$T','$(U 3)','member'),('$T','$(U 4)','member'),('$T','$(U 5)','member');
insert into public.projects(id,organization_id,name) values('$P','$T','P');
insert into prospectos_private.team_invitations(organization_id,email,token_hash,invited_by,accepted_at,accepted_by) select '$T','u'||i||'@t',lpad(md5(i::text),64,'0'),'$(U 1)',now(),('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(2,5) i;
insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,seats) values('$(U 1)','TEAM','ACTIVE',now()-interval '1 minute',now()+interval '30 days',5);
update prospectos_private.discovery_quota_settings set runs_per_hour=100000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000;
insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select '$T','discovery',('00000000-0000-4000-8000-'||lpad((1+i%5)::text,12,'0'))::uuid from generate_series(1,1498) i;
SQL
count(){ "${PSQL[@]}" -tAc "select count(*) from prospectos_private.discovery_quota_usage where action='discovery' and organization_id='$T' and billable"; }
at=$("${PSQL[@]}" -tAc "select (clock_timestamp()+interval '1.5 seconds')::text")
for i in $(seq 1 12); do
 who=$(U $(( i % 5 + 1 )))
 ( "${PSQL[@]}" -tAc "set role authenticated; select set_config('request.jwt.claim.sub','$who',false); select pg_sleep(greatest(0,extract(epoch from ('$at'::timestamptz - clock_timestamp())))); select public.start_discovery('$P','studios','Lyon','[]','registry',20,'{}'::jsonb);" >/dev/null 2>&1 && echo ok || echo refused ) >> "$WORK/race" &
done; wait
ok=$(grep -c ok "$WORK/race" || true)
if [ "$(count)" = 1500 ] && [ "$ok" = 2 ]; then echo "PASS TEAM_POOL_PARALLEL (12 simultaneous launches from 5 accounts at 1498/1500 (Équipe, 5 seats) → $(count)/1500, $ok accepted)"; echo "PASS: the Équipe team pool holds under real parallel sessions"; else echo "FAIL TEAM_POOL_PARALLEL (recorded $(count), accepted $ok)"; exit 1; fi
