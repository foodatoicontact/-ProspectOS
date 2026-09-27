// ProspectOS Bêta commercial quotas (migration 016) — real PostgreSQL (PGlite) with the full production
// migration chain. `as()` executes SQL as role `authenticated` with a JWT subject, exactly what PostgREST does
// for a signed-in member; every check attacks the database directly, never the interface.
// Trial = 20 Discovery / 50 analyses over [starts_at, expires_at); PAID = 100 / 250 per billing period.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = (text, params = []) => db.query(text, params);
async function as(user, text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  await sql(`set role ${user === undefined ? 'anon' : 'authenticated'}`);
  try { return await sql(text, params); } finally { await sql('reset role'); }
}
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).split('\n')[0]]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  assert.ok(migrations.includes('016_beta_commercial_quotas.sql'));
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const T = '00000000-0000-4000-8000-0000000000a1'; // trial user
  const P = '00000000-0000-4000-8000-0000000000b1'; // paid user
  const X = '00000000-0000-4000-8000-0000000000c1'; // another trial user (other organization)
  const I = '00000000-0000-4000-8000-0000000000d1'; // INTERNAL
  const L = '00000000-0000-4000-8000-0000000000e1'; // legacy user, no entitlement row
  await sql(`insert into auth.users(id,email) values ($1,'t@test'),($2,'p@test'),($3,'x@test'),($4,'i@test'),($5,'l@test')`, [T, P, X, I, L]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const project = async (user, o) => (await as(user, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [o])).rows[0].id;
  const prospect = async (user, o, p) => (await as(user, `insert into public.prospects(organization_id,project_id,name,website,status) values($1,$2,'Studio',$3,'À analyser') returning id`, [o, p, 'https://studio.example'])).rows[0].id;
  const ctx = {};
  for (const [k, u] of Object.entries({ T, P, X, I, L })) { const o = await org(u); const p = await project(u, o); ctx[k] = { user: u, org: o, project: p, prospect: await prospect(u, o, p) }; }
  // Hourly protections out of the way for the commercial checks (Q restores and checks them).
  const hourly = (runs, perOrg, perUser) => sql('update prospectos_private.discovery_quota_settings set runs_per_hour=$1, analyses_per_hour=$2, analyses_per_user_per_hour=$3', [runs, perOrg, perUser]);
  await hourly(1000, 1000, 1000);
  const entitle = (user, plan, status = 'ACTIVE', startOffset = '-1 minute', endOffset = '+7 days') => sql(
    `insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,$2,$3,now()+$4::interval,now()+$5::interval)
     on conflict (user_id) do update set plan=excluded.plan,status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at`,
    [user, plan, status, startOffset, endOffset]);
  const discover = c => as(c.user, `select public.start_discovery($1,'studios sport','Lyon','[]','fixture',20,'{}'::jsonb) run`, [c.project]);
  const analyze = c => as(c.user, 'select public.consume_analysis_quota($1)', [c.prospect]);
  const usage = c => as(c.user, 'select public.get_commercial_usage() u').then(r => r.rows[0].u);
  const used = async (user, action) => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action=$2`, [user, action])).rows[0].n);
  // Pre-fill n rows inside the current window (what n earlier launches would have recorded).
  const prefill = (c, action, n) => sql(`insert into prospectos_private.discovery_quota_usage(organization_id,action,user_id) select $1,$2,$3 from generate_series(1,$4)`, [c.org, action, c.user, n]);
  const clear = user => sql('delete from prospectos_private.discovery_quota_usage where user_id=$1', [user]);
  await entitle(T, 'BETA'); await entitle(X, 'BETA'); await entitle(P, 'PAID', 'ACTIVE', '-1 minute', '+30 days'); await entitle(I, 'INTERNAL', 'ACTIVE', '-1 minute', '+3650 days');

  // ---------------- TRIAL ----------------
  await check('A_TRIAL_LIMITS: a new trial reads 20 Discovery and 50 analyses, nothing used', async () => {
    const u = await usage(ctx.T);
    assert.equal(u.plan, 'BETA'); assert.equal(u.active, true);
    assert.equal(u.discovery_limit, 20); assert.equal(u.analysis_limit, 50);
    assert.equal(u.discovery_used, 0); assert.equal(u.analysis_used, 0);
  });
  await check('B_DISCOVERY_20: the 1st to the 20th Discovery are allowed and each records one use', async () => {
    for (let i = 0; i < 20; i++) await discover(ctx.T);
    assert.equal(await used(T, 'discovery'), 20);
    assert.equal((await usage(ctx.T)).discovery_used, 20);
  });
  await check('C_DISCOVERY_21: the 21st Discovery is refused, records nothing and creates no run', async () => {
    const runs = Number((await sql('select count(*) n from public.discovery_runs where organization_id=$1', [ctx.T.org])).rows[0].n);
    await refused(() => discover(ctx.T), /plan_limit_reached/, 'a 21st trial Discovery');
    assert.equal(await used(T, 'discovery'), 20);
    assert.equal(Number((await sql('select count(*) n from public.discovery_runs where organization_id=$1', [ctx.T.org])).rows[0].n), runs);
  });
  await check('D_ANALYSIS_50: from 49 used, the 50th analysis is allowed', async () => {
    await prefill(ctx.T, 'analysis', 49);
    await analyze(ctx.T);
    assert.equal(await used(T, 'analysis'), 50);
  });
  await check('E_ANALYSIS_51: the 51st analysis is refused and records nothing', async () => {
    await refused(() => analyze(ctx.T), /plan_limit_reached/, 'a 51st trial analysis');
    assert.equal(await used(T, 'analysis'), 50);
  });

  // ---------------- PAID ----------------
  await check('F_PAID_DISCOVERY_100: a PAID period allows exactly 100 Discovery', async () => {
    assert.equal((await usage(ctx.P)).discovery_limit, 100);
    await prefill(ctx.P, 'discovery', 99);
    await discover(ctx.P);
    await refused(() => discover(ctx.P), /plan_limit_reached/, 'a 101st Discovery in the period');
    assert.equal(await used(P, 'discovery'), 100);
  });
  await check('G_PAID_ANALYSIS_250: a PAID period allows exactly 250 analyses', async () => {
    assert.equal((await usage(ctx.P)).analysis_limit, 250);
    await prefill(ctx.P, 'analysis', 249);
    await analyze(ctx.P);
    await refused(() => analyze(ctx.P), /plan_limit_reached/, 'a 251st analysis in the period');
    assert.equal(await used(P, 'analysis'), 250);
  });
  await check('H_PERIOD_RESET: the next billing period starts from zero, the history is kept', async () => {
    // The previous period is over: its rows are dated before the new period start.
    await sql(`update prospectos_private.discovery_quota_usage set used_at=now()-interval '40 days' where user_id=$1`, [P]);
    await entitle(P, 'PAID', 'ACTIVE', '-1 minute', '+30 days');
    const u = await usage(ctx.P);
    assert.equal(u.discovery_used, 0); assert.equal(u.analysis_used, 0);
    await discover(ctx.P); await analyze(ctx.P);
    assert.equal(await used(P, 'discovery'), 101, 'old rows kept, one new');
  });
  await check('I_NO_OVERAGE: at the limit nothing is recorded, however many times it is retried', async () => {
    await clear(P); await prefill(ctx.P, 'discovery', 100);
    for (let i = 0; i < 5; i++) await refused(() => discover(ctx.P), /plan_limit_reached/, 'an overage Discovery');
    assert.equal(await used(P, 'discovery'), 100);
  });

  // ---------------- IDEMPOTENCE & ISOLATION ----------------
  await check('J_READ_FREE: reading usage, runs, prospects never consumes', async () => {
    await clear(X);
    for (let i = 0; i < 5; i++) {
      await usage(ctx.X);
      await as(X, 'select * from public.discovery_runs'); await as(X, 'select * from public.prospects');
      await as(X, 'select * from public.account_entitlements');
    }
    assert.equal(await used(X, 'discovery') + await used(X, 'analysis'), 0);
  });
  await check('K_ONE_USE_PER_LAUNCH: a refused or rolled-back launch records nothing; one launch = one use', async () => {
    await clear(X);
    await discover(ctx.X);
    assert.equal(await used(X, 'discovery'), 1);
    await sql('begin'); await sql("select set_config('request.jwt.claim.sub', $1, true)", [X]); await sql('set local role authenticated');
    await sql(`select public.start_discovery($1,'studios sport','Lyon','[]','fixture',20,'{}'::jsonb)`, [ctx.X.project]);
    await sql('rollback');
    assert.equal(await used(X, 'discovery'), 1, 'a launch whose transaction failed is not counted');
    const src = (await sql(`select prosrc from pg_proc where proname='consume_discovery_quota'`)).rows[0].prosrc;
    assert.ok(src.indexOf("'discovery-user:'") > 0 && src.indexOf("'discovery-user:'") < src.indexOf('enforce_plan_limit'), 'the per-user lock is taken before the limit is read');
    const a = (await sql(`select prosrc from pg_proc where proname='consume_analysis_quota'`)).rows[0].prosrc;
    assert.ok(a.indexOf("'analysis-user:'") > 0 && a.indexOf("'analysis-user:'") < a.indexOf('enforce_plan_limit'));
  });
  await check('L_ISOLATION: account A at its limit never blocks account B; nobody reads another usage', async () => {
    // T is at 20/20 Discovery and 50/50 analyses; X (another organization) keeps its own counters.
    await clear(X);
    await discover(ctx.X); await analyze(ctx.X);
    assert.equal((await usage(ctx.X)).discovery_used, 1);
    assert.equal((await usage(ctx.T)).discovery_used, 20);
    await refused(() => as(X, 'select * from prospectos_private.discovery_quota_usage'), /permission denied/, 'reading raw usage');
    await refused(() => as(X, 'select prospectos_private.enforce_plan_limit($1,$2)', [T, 'discovery']), /permission denied/, 'calling the private check');
    await refused(() => as(X, 'update prospectos_private.discovery_quota_settings set trial_discovery_limit=100000'), /permission denied/, 'raising the limit');
    await refused(() => as(X, `update public.account_entitlements set plan='PAID', expires_at=now()+interval '10 years' where user_id=$1`, [X]), /permission denied/, 'self-upgrading to PAID');
    // No parameter: the counters are always the caller's own (auth.uid()), never an id the browser sends.
    assert.equal((await sql(`select pronargs from pg_proc where proname='get_commercial_usage'`)).rows[0].pronargs, 0);
    await refused(() => as(undefined, 'select public.get_commercial_usage()'), /permission denied|Authentication required/, 'anonymous read');
    await refused(() => discover({ ...ctx.X, project: ctx.T.project }), /tenant member required/i, 'launching in another organization');
  });
  await check('M_TRIAL_END_KEEPS_DATA: an ended trial keeps every row, reads still work, paid actions are refused', async () => {
    const before = (await sql(`select (select count(*) from public.prospects where organization_id=$1) p,(select count(*) from public.discovery_runs where organization_id=$1) r,(select count(*) from prospectos_private.discovery_quota_usage where user_id=$2) q`, [ctx.X.org, X])).rows[0];
    await sql(`update public.account_entitlements set starts_at=now()-interval '8 days', expires_at=now()-interval '1 day' where user_id=$1`, [X]);
    await refused(() => discover(ctx.X), /plan_limit_reached/, 'a Discovery after the trial');
    await refused(() => analyze(ctx.X), /plan_limit_reached/, 'an analysis after the trial');
    const after = (await sql(`select (select count(*) from public.prospects where organization_id=$1) p,(select count(*) from public.discovery_runs where organization_id=$1) r,(select count(*) from prospectos_private.discovery_quota_usage where user_id=$2) q`, [ctx.X.org, X])).rows[0];
    assert.deepEqual(after, before);
    assert.equal((await as(X, 'select count(*)::int n from public.prospects')).rows[0].n, Number(before.p), 'the member still reads its prospects');
    const u = await usage(ctx.X); assert.equal(u.active, false);
    await sql(`update public.account_entitlements set status='EXPIRED' where user_id=$1`, [X]);
    await refused(() => discover(ctx.X), /plan_limit_reached/, 'a Discovery on an EXPIRED row');
  });

  // ---------------- EXISTING USERS & HOURLY LIMITS ----------------
  await check('P_EXISTING_USERS: INTERNAL is unlimited, a user without entitlement keeps the previous behaviour, legacy rows are untouched', async () => {
    await prefill(ctx.I, 'discovery', 150);
    await discover(ctx.I); await analyze(ctx.I);
    assert.deepEqual(await usage(ctx.I), { plan: 'INTERNAL', status: 'ACTIVE' });
    assert.deepEqual(await usage(ctx.L), { plan: null });
    await discover(ctx.L); // no entitlement row: the commercial check steps aside (the application gate decides)
    // Rows written before 016 carry no user_id: they stay, and are never counted against anyone.
    await sql(`insert into prospectos_private.discovery_quota_usage(organization_id,action) select $1,'discovery' from generate_series(1,30)`, [ctx.X.org]);
    await entitle(X, 'BETA');
    await clear(X);
    await discover(ctx.X);
    assert.equal((await usage(ctx.X)).discovery_used, 1);
    assert.equal(Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where organization_id=$1 and user_id is null`, [ctx.X.org])).rows[0].n), 30);
    const plans = (await sql(`select pg_get_constraintdef(oid) d from pg_constraint where conname='account_entitlements_plan_check'`)).rows[0].d;
    assert.match(plans, /BETA/); assert.match(plans, /INTERNAL/); assert.match(plans, /PAID/);
  });
  await check('Q_HOURLY_LIMITS: the existing hourly limits still refuse first, with their own error, and are unchanged by default', async () => {
    const defaults = (await sql(`select column_name,column_default from information_schema.columns where table_schema='prospectos_private' and table_name='discovery_quota_settings' and column_name in ('runs_per_hour','analyses_per_hour','analyses_per_user_per_hour','ai_offer_per_hour','trial_discovery_limit','trial_analysis_limit','paid_discovery_limit','paid_analysis_limit') order by column_name`)).rows;
    assert.deepEqual(Object.fromEntries(defaults.map(r => [r.column_name, r.column_default])), {
      ai_offer_per_hour: '10', analyses_per_hour: '20', analyses_per_user_per_hour: '20', paid_analysis_limit: '250',
      paid_discovery_limit: '100', runs_per_hour: '10', trial_analysis_limit: '50', trial_discovery_limit: '20' });
    await clear(X); await sql('delete from prospectos_private.discovery_quota_usage where organization_id=$1', [ctx.X.org]); await hourly(2, 1000, 1);
    await discover(ctx.X); await discover(ctx.X);
    await refused(() => discover(ctx.X), /quota_exceeded/, 'a 3rd Discovery in the hour');
    await analyze(ctx.X);
    await refused(() => analyze(ctx.X), /quota_exceeded/, 'a 2nd analysis in the hour');
    assert.equal(await used(X, 'discovery'), 2); assert.equal(await used(X, 'analysis'), 1);
    await hourly(1000, 1000, 1000);
  });
  await check('MIGRATION_IDEMPOTENT: re-applying 016 changes nothing', async () => {
    await db.exec(await readFile(new URL('../db/migrations/016_beta_commercial_quotas.sql', import.meta.url), 'utf8'));
    assert.equal(Number((await sql(`select count(*) n from pg_proc where proname in ('get_commercial_usage','enforce_plan_limit')`)).rows[0].n), 2);
    assert.equal((await usage(ctx.T)).discovery_used, 20);
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
} finally {
  await db.close();
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS');
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
