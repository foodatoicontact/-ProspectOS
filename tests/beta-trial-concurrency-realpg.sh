#!/usr/bin/env bash
# True parallel-session proof for activate_trial() (migration 012) on a real PostgreSQL server: with 9/10
# BETA slots used, N simultaneous first arrivals must end at exactly 10/10, and a claim arriving while
# another transaction holds the capacity lock must wait for it, then be refused. A negative control (the
# same function WITHOUT the advisory lock, created in this throwaway database only) must exceed capacity,
# proving the race is real and the test can see it. Needs local PostgreSQL binaries (not run in CI —
# the serialized cases are covered by tests/beta-auto-activation-db.mjs). Creates and deletes its own
# temporary cluster; touches nothing else.
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
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
SQL
for f in db/schema.sql db/migrations/008_account_privacy_beta.sql db/migrations/011_beta_entitlement_gate.sql db/migrations/012_beta_self_service_trial.sql; do "${PSQL[@]}" -f "$ROOT/$f" >/dev/null; done
# Negative control only: identical body minus the advisory lock and with a pause between the capacity
# read and the insert, so an unlocked version's race window is guaranteed to be hit.
"${PSQL[@]}" <<'SQL'
create function public.activate_trial_unlocked() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); cap int; used int; already boolean;
begin
 select exists(select 1 from public.account_entitlements where user_id=actor) into already;
 if not already then
  select capacity into cap from prospectos_private.beta_program where singleton;
  select count(*) into used from public.account_entitlements where plan='BETA';
  if used>=cap then raise exception 'BETA_CAPACITY_REACHED' using errcode='P0001'; end if;
  perform pg_sleep(0.5);
  insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values(actor,'BETA','ACTIVE',now(),now()+interval '7 days',now());
 end if;
 return '{}'::jsonb;
end $$;
grant execute on function public.activate_trial_unlocked() to authenticated;
SQL
setup(){ "${PSQL[@]}" -c "delete from public.account_entitlements; delete from auth.users; update prospectos_private.beta_program set capacity=10;
 insert into auth.users(id,email) select gen_random_uuid(),'seed'||g||'@t' from generate_series(1,9) g;
 insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) select id,'BETA','ACTIVE',now(),now()+interval '7 days' from auth.users;
 insert into auth.users(id,email) select gen_random_uuid(),'racer'||g||'@t' from generate_series(1,$1) g;" >/dev/null; }
count(){ "${PSQL[@]}" -tAc "select count(*) from public.account_entitlements where plan='BETA'"; }
race(){ # $1 function, $2 racers: all start at the same instant, one connection each
 local at; at=$("${PSQL[@]}" -tAc "select (clock_timestamp()+interval '1.5 seconds')::text")
 local ids; mapfile -t ids < <("${PSQL[@]}" -tAc "select id from auth.users where email like 'racer%'")
 for id in "${ids[@]}"; do
  ( "${PSQL[@]}" -tAc "set role authenticated; select set_config('request.jwt.claim.sub','$id',false); select pg_sleep(greatest(0,extract(epoch from ('$at'::timestamptz - clock_timestamp())))); select public.$1();" >/dev/null 2>&1 && echo ok || echo refused ) >> "$WORK/race.$1" &
 done; wait; }
FAIL=0; pass(){ echo "PASS $1"; }; fail(){ echo "FAIL $1"; FAIL=1; }

# G — 9/10 used, 2 simultaneous claims → exactly one wins, 10/10.
setup 2; race activate_trial 2
[ "$(count)" = 10 ] && [ "$(grep -c ok "$WORK/race.activate_trial")" = 1 ] && pass "G_TWO_PARALLEL_CLAIMS_AT_9_OF_10 (final 10/10)" || fail "G_TWO_PARALLEL_CLAIMS_AT_9_OF_10 (final $(count))"
# Same with 20 simultaneous first arrivals.
rm -f "$WORK/race.activate_trial"; setup 20; race activate_trial 20
[ "$(count)" = 10 ] && [ "$(grep -c ok "$WORK/race.activate_trial")" = 1 ] && pass "G_TWENTY_PARALLEL_CLAIMS_AT_9_OF_10 (final 10/10)" || fail "G_TWENTY_PARALLEL_CLAIMS_AT_9_OF_10 (final $(count))"
# A claim arriving while another transaction holds the lock waits for its commit, then is refused.
setup 2; mapfile -t R < <("${PSQL[@]}" -tAc "select id from auth.users where email like 'racer%' order by email")
( "${PSQL[@]}" -tAc "begin; set local role authenticated; select set_config('request.jwt.claim.sub','${R[0]}',true); select public.activate_trial(); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5; T0=$(date +%s%N)
OUT=$("${PSQL[@]}" -tAc "set role authenticated; select set_config('request.jwt.claim.sub','${R[1]}',false); select public.activate_trial();" 2>&1 || true); T1=$(date +%s%N); wait
WAITED=$(( (T1-T0)/1000000 ))
[[ "$OUT" == *BETA_CAPACITY_REACHED* ]] && [ "$WAITED" -ge 1000 ] && [ "$(count)" = 10 ] && pass "LOCK_SERIALIZES (second claim waited ${WAITED}ms, then BETA_CAPACITY_REACHED)" || fail "LOCK_SERIALIZES (waited ${WAITED}ms, got: ${OUT//$'\n'/ })"
# Negative control: without the lock the same race exceeds capacity — the test can see a real race.
setup 5; race activate_trial_unlocked 5
[ "$(count)" -gt 10 ] && pass "NEGATIVE_CONTROL_UNLOCKED_EXCEEDS ($(count)/10 without the lock)" || fail "NEGATIVE_CONTROL_UNLOCKED_EXCEEDS ($(count)/10 — race not reproduced)"
[ "$FAIL" = 0 ] && echo "PASS: activate_trial capacity lock holds under real parallel sessions" || { echo "FAIL"; exit 1; }
