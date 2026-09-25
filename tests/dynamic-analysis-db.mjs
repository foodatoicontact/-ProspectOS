// Dynamic safe analysis (migration 015) — real PostgreSQL (PGlite) with the full production migration
// chain. `as()` executes SQL as role `authenticated` with a JWT subject (what PostgREST does for a member);
// `asService()` is the server's privileged client. Every check attacks the database directly.
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
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-00000000000a'; // owns OA and OA2
  const A2 = '00000000-0000-4000-8000-0000000000a2'; // second member of OA
  const B = '00000000-0000-4000-8000-00000000000b'; // owns OB
  const OA = '10000000-0000-4000-8000-00000000000a', OA2 = '10000000-0000-4000-8000-0000000000a2', OB = '10000000-0000-4000-8000-00000000000b';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'a2@test'),($3,'b@test')`, [A, A2, B]);
  // A creates organizations through the self-service RPC, exactly like the product (the bypass vector).
  const newOrg = async (user, id, name) => { const o = (await as(user, `select public.create_organization($1) id`, [name])).rows[0].id; await sql('update public.organizations set id=$1 where id=$2', [id, o]).catch(() => {}); return o; };
  const oa = await newOrg(A, OA, 'A'); const oa2 = await newOrg(A, OA2, 'A bis'); const ob = await newOrg(B, OB, 'B');
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'member')`, [oa, A2]);
  const project = async (user, org) => (await as(user, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [org])).rows[0].id;
  const prospect = async (user, org, proj, website) => (await as(user, `insert into public.prospects(organization_id,project_id,name,website,status) values($1,$2,'BeBureau',$3,'À analyser') returning id`, [org, proj, website])).rows[0].id;
  const pa = await project(A, oa), pa2 = await project(A, oa2), pb = await project(B, ob);
  const prA = await prospect(A, oa, pa, 'https://bebureau.com'), prA2 = await prospect(A, oa2, pa2, 'https://bebureau.com'), prB = await prospect(B, ob, pb, 'https://b.example');
  const setting = (perOrg, perUser) => sql('update prospectos_private.discovery_quota_settings set analyses_per_hour=$1, analyses_per_user_per_hour=$2', [perOrg, perUser]);
  const resetUsage = () => sql("delete from prospectos_private.discovery_quota_usage where action='analysis'");
  const consume = (user, prospectId) => as(user, 'select public.consume_analysis_quota($1)', [prospectId]);

  // ---------------- S. per-user quota ----------------
  await check('S_USER_QUOTA: exactly analyses_per_user_per_hour analyses per user per hour, the next one refused', async () => {
    await resetUsage(); await setting(100, 3);
    for (let i = 0; i < 3; i++) await consume(A, prA);
    await refused(() => consume(A, prA), /quota_exceeded/, 'a 4th analysis');
  });
  await check('S_MULTI_ORG: creating another organization does not multiply the user quota', async () => {
    await resetUsage(); await setting(100, 3);
    await consume(A, prA); await consume(A, prA2); await consume(A, prA);
    await refused(() => consume(A, prA2), /quota_exceeded/, 'an analysis in a second organization of the same user');
  });
  await check('S_OTHER_USER: the per-user quota of A never blocks B', async () => {
    await resetUsage(); await setting(100, 1);
    await consume(A, prA);
    await refused(() => consume(A, prA), /quota_exceeded/, 'A beyond its quota');
    await consume(B, prB);
  });
  // ---------------- T. organization quota preserved ----------------
  await check('T_ORG_QUOTA: the organization quota still applies across its members', async () => {
    await resetUsage(); await setting(2, 20);
    await consume(A, prA); await consume(A2, prA);
    await refused(() => consume(A2, prA), /quota_exceeded/, 'a 3rd analysis in an organization limited to 2');
  });
  await check('T_DEFAULTS: defaults are 20/hour per organization and 20/hour per user', async () => {
    const d = (await sql(`select column_default from information_schema.columns where table_schema='prospectos_private' and table_name='discovery_quota_settings' and column_name in ('analyses_per_hour','analyses_per_user_per_hour') order by column_name`)).rows.map(r => r.column_default);
    assert.deepEqual(d, ['20', '20']);
  });
  await check('QUOTA_ROWS: every analysis reservation records the user; a refused one records nothing', async () => {
    await resetUsage(); await setting(1, 20);
    await consume(A, prA);
    await refused(() => consume(A, prA), /quota_exceeded/, 'over quota');
    const rows = (await sql(`select organization_id,user_id from prospectos_private.discovery_quota_usage where action='analysis'`)).rows;
    assert.deepEqual(rows, [{organization_id: oa, user_id: A}]);
  });
  await check('QUOTA_TENANT: a user cannot consume analysis quota on another tenant\'s prospect', async () => {
    await resetUsage(); await setting(20, 20);
    await refused(() => consume(B, prA), /tenant member required/i, 'B on A\'s prospect');
  });
  await check('QUOTA_LOCKS: the reservation takes the user lock then the organization lock (same key as other analysis quota users)', async () => {
    const src = (await sql(`select prosrc from pg_proc where proname='consume_analysis_quota'`)).rows[0].prosrc;
    const user = src.indexOf("'analysis-user:'"), org = src.indexOf("':analysis'");
    assert.ok(user > 0 && org > user, 'user lock precedes organization lock');
  });
  await check('QUOTA_DIRECT: members still cannot read or write the quota tables', async () => {
    await refused(() => as(A, 'select * from prospectos_private.discovery_quota_usage'), /permission denied/, 'reading usage');
    await refused(() => as(A, `update prospectos_private.discovery_quota_settings set analyses_per_user_per_hour=100000`), /permission denied/, 'raising the quota');
  });

  // ---------------- U. audit log ----------------
  const record = (user, prospectId, host, mode, outcome) => asService('select public.record_website_analysis($1,$2,$3,$4,$5) id', [user, prospectId, host, mode, outcome]);
  let started;
  await check('U_RECORD: the server records an attempt for a member of the prospect\'s organization', async () => {
    started = (await record(A, prA, 'bebureau.com', 'dynamic_discovery', 'STARTED')).rows[0].id;
    await record(A, prA, 'evil.com', null, 'WEBSITE_MISMATCH');
    const row = (await sql('select organization_id,user_id,host,authorization_mode,outcome,completed_at from public.website_analysis_audit where id=$1', [started])).rows[0];
    assert.deepEqual({...row, completed_at: row.completed_at === null}, {organization_id: oa, user_id: A, host: 'bebureau.com', authorization_mode: 'dynamic_discovery', outcome: 'STARTED', completed_at: true});
  });
  await check('U_COMPLETE: only the opening user closes a STARTED attempt, exactly once', async () => {
    await refused(() => asService('select public.complete_website_analysis($1,$2,$3,$4,$5)', [started, B, 'ANALYZED', 3, 0]), /not found/, 'another user closing it');
    await asService('select public.complete_website_analysis($1,$2,$3,$4,$5)', [started, A, 'ANALYZED', 3, 0]);
    await refused(() => asService('select public.complete_website_analysis($1,$2,$3,$4,$5)', [started, A, 'ANALYSIS_FAILED', 0, 0]), /not found/, 'closing twice');
    await refused(() => asService('select public.complete_website_analysis($1,$2,$3,$4,$5)', [started, A, 'STARTED', 0, 0]), /Invalid outcome/, 'reopening');
  });
  await check('U_MEMBERSHIP: the server cannot record for a user outside the prospect\'s organization', async () => {
    await refused(() => record(B, prA, 'bebureau.com', 'dynamic_discovery', 'STARTED'), /tenant member required/i, 'B on A\'s prospect');
    await refused(() => record(null, prA, 'bebureau.com', 'dynamic_discovery', 'STARTED'), /Authenticated user required/, 'no user');
  });
  await check('U_SHAPE: constrained values — outcome, mode consistency, host charset', async () => {
    await refused(() => record(A, prA, 'bebureau.com', 'dynamic_discovery', 'VERIFIED'), /check constraint/, 'an unknown outcome');
    await refused(() => record(A, prA, 'bebureau.com', null, 'STARTED'), /check constraint/, 'an authorized attempt without mode');
    await refused(() => record(A, prA, 'bebureau.com', 'dynamic_discovery', 'WEBSITE_MISMATCH'), /check constraint/, 'a refusal with a mode');
    await refused(() => record(A, prA, 'https://bebureau.com/<script>', 'dynamic_discovery', 'STARTED'), /check constraint/, 'a URL/HTML instead of a host');
    await refused(() => record(A, prA, '10.0.0.1:8080', 'dynamic_discovery', 'STARTED'), /check constraint/, 'an address with port');
  });
  await check('U_CLIENT_WRITES: members cannot insert, update, delete audit rows or call the audit RPCs', async () => {
    await refused(() => as(A, `insert into public.website_analysis_audit(organization_id,prospect_id,user_id,outcome) values($1,$2,$3,'WEBSITE_MISMATCH')`, [oa, prA, A]), /permission denied/, 'a direct INSERT');
    await refused(() => as(A, `update public.website_analysis_audit set outcome='ANALYZED'`), /permission denied/, 'an UPDATE');
    await refused(() => as(A, `delete from public.website_analysis_audit`), /permission denied/, 'a DELETE');
    await refused(() => as(A, 'select public.record_website_analysis($1,$2,$3,$4,$5)', [A, prA, 'x.com', null, 'SOURCE_POLICY_REQUIRED']), /permission denied/, 'the record RPC');
    await refused(() => as(A, 'select public.complete_website_analysis($1,$2,$3,$4,$5)', [started, A, 'ANALYZED', 1, 0]), /permission denied/, 'the complete RPC');
    await refused(() => as(undefined, 'select * from public.website_analysis_audit'), /permission denied/, 'anon reading');
  });
  await check('U_RLS_READ: members read their organization\'s attempts only', async () => {
    await record(B, prB, 'b.example', 'static_allowlist', 'STARTED');
    const a = (await as(A, 'select distinct organization_id from public.website_analysis_audit')).rows.map(r => r.organization_id);
    const b = (await as(B, 'select distinct organization_id from public.website_analysis_audit')).rows.map(r => r.organization_id);
    assert.deepEqual(a, [oa]); assert.deepEqual(b, [ob]);
    assert.equal((await as(A2, 'select count(*)::int n from public.website_analysis_audit')).rows[0].n, 2, 'a colleague of the same organization reads it too');
  });
  await check('U_NO_CONTENT: the audit table has no column able to hold page content, URL, address, header or key', async () => {
    const cols = (await sql(`select column_name from information_schema.columns where table_schema='public' and table_name='website_analysis_audit' order by ordinal_position`)).rows.map(r => r.column_name);
    assert.deepEqual(cols, ['id', 'organization_id', 'prospect_id', 'user_id', 'host', 'authorization_mode', 'outcome', 'pages_analyzed', 'failed_pages', 'created_at', 'completed_at']);
  });
  await check('RLS_ENABLED: row level security is enabled on website_analysis_audit and still on discovery tables', async () => {
    const rows = (await sql(`select relname, relrowsecurity from pg_class where relname in ('website_analysis_audit','discovery_results','prospects','prospect_observations') order by relname`)).rows;
    assert.ok(rows.length === 4 && rows.every(r => r.relrowsecurity), JSON.stringify(rows));
  });
  await check('EVIDENCE_UNCHANGED: members still cannot mark evidence VERIFIED by writing observations', async () => {
    const saved = (await as(A, `select public.save_discovery_observations($1,$2::jsonb) r`, [prA, JSON.stringify([{criterion: null, observation_type: 'catalog', claim: 'Mobilier de bureau', value: null, status: 'INFERRED', source_url: 'https://bebureau.com/', source_title: 'BeBureau', source_excerpt: 'Mobilier de bureau professionnel', source_type: 'official_website', confidence: 0.5, collected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString(), content_hash: 'h1'}])])).rows[0].r;
    assert.equal(saved[0].review_status, 'NOT_VERIFIED');
    assert.equal((await sql(`select count(*)::int n from public.evidence where status='VERIFIED'`)).rows[0].n, 0);
  });

  const width = Math.max(...results.map(r => r[0].length));
  for (const [name, status, detail] of results) console.log(`${status}  ${name.padEnd(width)}  ${detail}`);
  const failed = results.filter(r => r[1] === 'FAIL').length;
  console.log(`DYNAMIC SAFE ANALYSIS DB: ${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
} finally {
  await db.close();
}
