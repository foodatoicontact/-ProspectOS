// ProspectOS Bêta commercial quotas (migration 016) — real PostgreSQL (PGlite) with the full production
// migration chain. `as()` executes SQL as role `authenticated` with a JWT subject, exactly what PostgREST does
// for a signed-in member; every check attacks the database directly, never the interface.
// Trial = 20 Discovery / 50 site analyses / 5 AI offer analyses over [starts_at, expires_at); PAID = 100 / 250 /
// 25 per billing period. The hourly technical limits keep counting every reservation; the commercial count
// only counts billable ones (not a fixture Discovery, not an analysis the server released after a failure).
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
async function asService(text, params = []) {
  await sql('reset role');
  await sql("select set_config('request.jwt.claim.sub', '', false)");
  await sql('set role service_role');
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
  const hourly = (runs, perOrg, perUser, offers = 1000) => sql('update prospectos_private.discovery_quota_settings set runs_per_hour=$1, analyses_per_hour=$2, analyses_per_user_per_hour=$3, ai_offer_per_hour=$4', [runs, perOrg, perUser, offers]);
  await hourly(1000, 1000, 1000);
  const entitle = (user, plan, status = 'ACTIVE', startOffset = '-1 minute', endOffset = '+7 days') => sql(
    `insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,$2,$3,now()+$4::interval,now()+$5::interval)
     on conflict (user_id) do update set plan=excluded.plan,status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at`,
    [user, plan, status, startOffset, endOffset]);
  // A real (Brave) launch: start_discovery is the reservation made before any provider request.
  const discover = c => as(c.user, `select public.start_discovery($1,'studios sport','Lyon','[]','brave',20,'{}'::jsonb) run`, [c.project]);
  const discoverFixture = c => as(c.user, `select public.start_discovery($1,'studios sport','Lyon','[]','fixture',20,'{}'::jsonb) run`, [c.project]);
  const HASH = n => String(n).padStart(64, '0');
  const reserveOffer = (c, n) => as(c.user, 'select public.reserve_offer_analysis($1,$2) r', [c.project, HASH(n)]).then(r => r.rows[0].r);
  const completeOffer = (c, n, result) => as(c.user, 'select public.complete_offer_analysis($1,$2,$3::jsonb)', [c.project, HASH(n), JSON.stringify(result)]);
  const abandonOffer = (c, n) => as(c.user, 'select public.abandon_offer_analysis($1,$2)', [c.project, HASH(n)]);
  const release = (user, action) => asService('select public.release_commercial_use($1,$2) ok', [user, action]).then(r => r.rows[0].ok);
  const billed = async (user, action) => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action=$2 and billable`, [user, action])).rows[0].n);
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
    assert.equal(u.discovery_limit, 20); assert.equal(u.analysis_limit, 50); assert.equal(u.ai_offer_limit, 5);
    assert.equal(u.discovery_used, 0); assert.equal(u.analysis_used, 0); assert.equal(u.ai_offer_used, 0);
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
    await sql(`select public.start_discovery($1,'studios sport','Lyon','[]','brave',20,'{}'::jsonb)`, [ctx.X.project]);
    await sql('rollback');
    assert.equal(await used(X, 'discovery'), 1, 'a launch whose transaction failed is not counted');
    const src = (await sql(`select prosrc from pg_proc where proname='consume_discovery_quota' and pronargs=3`)).rows[0].prosrc;
    assert.ok(src.indexOf("'-user:'") > 0 && src.indexOf("'-user:'") < src.indexOf('enforce_plan_limit'), 'the per-user lock is taken before the limit is read');
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
    const offers = (await sql(`select column_default d from information_schema.columns where table_schema='prospectos_private' and table_name='discovery_quota_settings' and column_name in ('trial_ai_offer_limit','paid_ai_offer_limit') order by column_name`)).rows.map(r => r.d);
    assert.deepEqual(offers, ['25', '5']);
    await clear(X); await sql('delete from prospectos_private.discovery_quota_usage where organization_id=$1', [ctx.X.org]); await hourly(2, 1000, 1);
    await discover(ctx.X); await discover(ctx.X);
    await refused(() => discover(ctx.X), /quota_exceeded/, 'a 3rd Discovery in the hour');
    await analyze(ctx.X);
    await refused(() => analyze(ctx.X), /quota_exceeded/, 'a 2nd analysis in the hour');
    assert.equal(await used(X, 'discovery'), 2); assert.equal(await used(X, 'analysis'), 1);
    await hourly(1000, 1000, 1000);
  });
  // ---------------- AI OFFER ANALYSIS (commercial quota, idempotence) ----------------
  await check('OFFER_A_TRIAL_5: from 4 used, the 5th AI offer analysis of the trial is reserved', async () => {
    await clear(X); await hourly(1000, 1000, 1000, 1000);
    await prefill(ctx.X, 'ai_offer', 4);
    assert.deepEqual(await reserveOffer(ctx.X, 5), { reserved: true });
    assert.equal(await billed(X, 'ai_offer'), 5);
    const u = await usage(ctx.X); assert.equal(u.ai_offer_used, 5); assert.equal(u.ai_offer_limit, 5);
  });
  await check('OFFER_B_TRIAL_6: the 6th is refused with its own code, nothing recorded, no reservation left', async () => {
    await refused(() => reserveOffer(ctx.X, 6), /offer_limit_reached/, 'a 6th trial offer analysis');
    assert.equal(await used(X, 'ai_offer'), 5);
    assert.equal(Number((await sql(`select count(*) n from prospectos_private.offer_analyses where user_id=$1 and text_hash=$2`, [X, HASH(6)])).rows[0].n), 0);
    await refused(() => as(X, 'select public.consume_ai_offer_quota($1)', [ctx.X.project]), /offer_limit_reached/, 'the direct reservation RPC');
  });
  await check('OFFER_C_D_PAID_25: a PAID period allows the 25th AI offer analysis and refuses the 26th', async () => {
    await clear(P); await entitle(P, 'PAID', 'ACTIVE', '-1 minute', '+30 days');
    assert.equal((await usage(ctx.P)).ai_offer_limit, 25);
    await prefill(ctx.P, 'ai_offer', 24);
    assert.deepEqual(await reserveOffer(ctx.P, 25), { reserved: true });
    await refused(() => reserveOffer(ctx.P, 26), /offer_limit_reached/, 'a 26th offer analysis in the period');
    assert.equal(await billed(P, 'ai_offer'), 25);
  });
  await check('OFFER_E_DOUBLE_CLICK: the same request twice while the first runs = one unit; after completion it is read back', async () => {
    await clear(X);
    assert.deepEqual(await reserveOffer(ctx.X, 100), { reserved: true });
    await refused(() => reserveOffer(ctx.X, 100), /offer_analysis_in_progress/, 'a duplicate while the first runs');
    assert.equal(await used(X, 'ai_offer'), 1);
    await completeOffer(ctx.X, 100, { summary: 'S', target: 'T', questions: ['Q'] });
    assert.deepEqual(await reserveOffer(ctx.X, 100), { cached: { summary: 'S', target: 'T', questions: ['Q'] } });
    assert.equal(await used(X, 'ai_offer'), 1, 'the retry after success consumed nothing');
  });
  await check('OFFER_F_CONSULT: reading an existing analysis and the counters never consumes', async () => {
    const before = await used(X, 'ai_offer');
    for (let i = 0; i < 3; i++) { await reserveOffer(ctx.X, 100); await usage(ctx.X); }
    assert.equal(await used(X, 'ai_offer'), before);
    await refused(() => as(X, 'select * from prospectos_private.offer_analyses'), /permission denied/, 'reading the stored analyses directly');
  });
  await check('OFFER_RETRY_AFTER_FAILURE: an abandoned reservation lets the identical retry run again (a genuine new AI call)', async () => {
    await clear(X);
    await reserveOffer(ctx.X, 200); await abandonOffer(ctx.X, 200);
    assert.deepEqual(await reserveOffer(ctx.X, 200), { reserved: true });
    assert.equal(await used(X, 'ai_offer'), 2);
  });
  await check('OFFER_PRE_PROVIDER_REFUND: stopped before the AI call, the unit goes back to the plan; the hourly log keeps it', async () => {
    await clear(X);
    await reserveOffer(ctx.X, 300);
    assert.equal(await release(X, 'ai_offer'), true);
    assert.equal(await billed(X, 'ai_offer'), 0); assert.equal(await used(X, 'ai_offer'), 1);
    assert.equal((await usage(ctx.X)).ai_offer_used, 0);
  });
  await check('OFFER_ISOLATION: another account never reads a stored analysis; it pays its own', async () => {
    await clear(T); await entitle(T, 'BETA'); await clear(X);
    await reserveOffer(ctx.X, 400); await completeOffer(ctx.X, 400, { summary: 'secret of X', target: 't', questions: [] });
    const t = await as(T, 'select public.reserve_offer_analysis($1,$2) r', [ctx.T.project, HASH(400)]).then(r => r.rows[0].r);
    assert.deepEqual(t, { reserved: true }, 'T gets a reservation, never X\'s result');
    await refused(() => as(T, 'select public.reserve_offer_analysis($1,$2)', [ctx.X.project, HASH(400)]), /tenant member required/i, 'T on X\'s project');
    await refused(() => as(X, 'select public.reserve_offer_analysis($1,$2)', [ctx.X.project, 'not-a-hash']), /Invalid text hash/, 'a malformed hash');
  });
  await check('OFFER_HOURLY: the existing hourly AI offer limit still applies on top', async () => {
    await clear(X); await sql('delete from prospectos_private.discovery_quota_usage where organization_id=$1', [ctx.X.org]);
    await hourly(1000, 1000, 1000, 1);
    await reserveOffer(ctx.X, 500);
    await refused(() => reserveOffer(ctx.X, 501), /quota_exceeded/, 'a 2nd offer analysis in the hour');
    await hourly(1000, 1000, 1000, 1000);
  });

  // ---------------- SITE ANALYSIS: technical rate limit ≠ commercial quota ----------------
  await check('G_SITE_SUCCESS: a site analysis that produced its result counts +1 on the plan', async () => {
    await clear(X);
    await analyze(ctx.X);
    assert.equal(await billed(X, 'analysis'), 1); assert.equal((await usage(ctx.X)).analysis_used, 1);
  });
  await check('H_SITE_FAILED: a fetch that failed before any result is released by the server: plan unchanged', async () => {
    await clear(X);
    await analyze(ctx.X); // reservation made before the fetch
    assert.equal(await release(X, 'analysis'), true); // the server saw the fetch fail
    assert.equal(await billed(X, 'analysis'), 0); assert.equal((await usage(ctx.X)).analysis_used, 0);
    assert.equal(await release(X, 'analysis'), false, 'nothing left to release: never below zero');
  });
  await check('I_HOURLY_UNCHANGED: the failed analysis still counts for the hourly anti-abuse limit', async () => {
    await clear(X); await hourly(1000, 1000, 1);
    await analyze(ctx.X); await release(X, 'analysis');
    await refused(() => analyze(ctx.X), /quota_exceeded/, 'a 2nd analysis in the hour after a failed one');
    assert.equal(await used(X, 'analysis'), 1);
    await hourly(1000, 1000, 1000);
  });
  await check('RELEASE_SERVER_ONLY: a member can never refund a unit; only analysis/offer units can be released', async () => {
    await refused(() => as(X, 'select public.release_commercial_use($1,$2)', [X, 'analysis']), /permission denied/, 'a member refunding itself');
    await refused(() => as(undefined, 'select public.release_commercial_use($1,$2)', [X, 'analysis']), /permission denied/, 'anonymous refund');
    await refused(() => release(X, 'discovery'), /Invalid release/, 'refunding a Discovery');
    await refused(() => as(X, 'update prospectos_private.discovery_quota_usage set billable=false'), /permission denied/, 'editing the log');
  });

  // ---------------- DISCOVERY: real vs fixture ----------------
  await check('J_BRAVE_DISCOVERY: a real Discovery counts +1 at launch, whatever it finds (even no new prospect)', async () => {
    await clear(X);
    const run = (await discover(ctx.X)).rows[0].run;
    assert.equal(run.provider, 'brave');
    assert.equal(await billed(X, 'discovery'), 1);
    // The unit is taken at launch, before the provider request: how many results (or new prospects) the run
    // later finds cannot change it — the request was made and paid either way.
    assert.equal((await usage(ctx.X)).discovery_used, 1);
  });
  await check('FIXTURE_DISCOVERY: a fixture/TEST run is not charged to the plan, even at the limit, but stays hourly-limited', async () => {
    await clear(X); await prefill(ctx.X, 'discovery', 20);
    await refused(() => discover(ctx.X), /plan_limit_reached/, 'a real Discovery at 20/20');
    await discoverFixture(ctx.X);
    assert.equal(await billed(X, 'discovery'), 20); assert.equal(await used(X, 'discovery'), 21);
    await sql('delete from prospectos_private.discovery_quota_usage where organization_id=$1', [ctx.X.org]); await hourly(1, 1000, 1000);
    await discoverFixture(ctx.X);
    await refused(() => discoverFixture(ctx.X), /quota_exceeded/, 'a 2nd fixture run in an hour limited to 1');
    await hourly(1000, 1000, 1000);
  });
  await check('MIGRATION_IDEMPOTENT: re-applying 016 changes nothing', async () => {
    await db.exec(await readFile(new URL('../db/migrations/016_beta_commercial_quotas.sql', import.meta.url), 'utf8'));
    const before = await usage(ctx.T);
    await db.exec(await readFile(new URL('../db/migrations/016_beta_commercial_quotas.sql', import.meta.url), 'utf8'));
    assert.equal(Number((await sql(`select count(*) n from pg_proc where proname in ('get_commercial_usage','enforce_plan_limit','release_commercial_use','reserve_offer_analysis','complete_offer_analysis','abandon_offer_analysis')`)).rows[0].n), 6);
    assert.equal(Number((await sql(`select count(*) n from pg_proc where proname='consume_discovery_quota'`)).rows[0].n), 2, 'the 2-argument form and the billable form');
    assert.deepEqual(await usage(ctx.T), before);
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
