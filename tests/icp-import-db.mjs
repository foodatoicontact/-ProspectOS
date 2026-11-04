// Migration 041 — « Importer mon entreprise », on real PostgreSQL (PGlite) with the full migration chain. An import is
// started by a member (one AI offer quota unit, URL daily cap, one in progress per project), completed by the server
// only, and becomes VALIDATED only through validate_icp_import called by a signed-in member. Nobody writes icp_imports
// or the ICP profile columns directly — not even with a forged operation flag. Tenants are isolated; the manual ICP
// save keeps working. WITHOUT_041=1 runs the checks without the migration: they must fail.
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
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_041 && f.startsWith('041_')));
  assert.ok(process.env.WITHOUT_041 || migrations.includes('041_icp_import.sql'), 'migration 041 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  const B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@client.fr'),($2,'b@client.fr')`, [A, B]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const ctx = {};
  for (const [k, u] of Object.entries({ A, B })) {
    const o = await org(u);
    const p = (await as(u, `insert into public.projects(organization_id,name,offer) values($1,'Protection incendie','offre initiale') returning id`, [o])).rows[0].id;
    ctx[k] = { user: u, org: o, project: p };
    await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days') on conflict (user_id) do update set plan='BETA',status='ACTIVE'`, [u]);
  }
  await sql('update prospectos_private.discovery_quota_settings set ai_offer_per_hour=1000');
  const start = (c, type = 'TEXT', ref = 'texte collé') => as(c.user, 'select public.start_icp_import($1,$2,$3) id', [c.project, type, ref]).then(r => r.rows[0].id);
  const complete = (id, status = 'EXTRACTED', extracted = { version: 1 }, error = null) =>
    asService(`select public.complete_icp_import($1,$2,$3::jsonb,'[]'::jsonb,'[]'::jsonb,1200,'{"input":1000,"output":200,"attempts":1}'::jsonb,$4) r`, [id, status, extracted ? JSON.stringify(extracted) : null, error]).then(r => r.rows[0].r);
  const row = async id => (await sql('select * from public.icp_imports where id=$1', [id])).rows[0];
  const icp = async c => (await sql('select * from public.icps where project_id=$1', [c.project])).rows[0];
  const aiUnits = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='ai_offer'`, [user])).rows[0].n);
  const criteria = [{ key: 'target_fit', label: 'Cible', weight: 60, rules: { type: 'target_fit', config: { categories: ['restaurant'], match: 'any_defined' } } }, { key: 'need_fit', label: 'Besoin', weight: 40 }];
  let imp;

  await check('A_START: a member starts an import — PENDING, created_by, one AI offer quota unit', async () => {
    const before = await aiUnits(A);
    imp = await start(ctx.A);
    const r = await row(imp);
    assert.equal(r.status, 'PENDING'); assert.equal(r.created_by, A); assert.equal(r.organization_id, ctx.A.org); assert.equal(r.source_type, 'TEXT');
    assert.equal(await aiUnits(A), before + 1);
    await refused(() => as(undefined, `select public.start_icp_import($1,'TEXT','x')`, [ctx.A.project]), /permission|denied|Authentication/i, 'an anonymous start');
    await refused(() => as(B, `select public.start_icp_import($1,'TEXT','x')`, [ctx.A.project]), /member/i, 'a start in another tenant');
    await refused(() => as(A, `select public.start_icp_import($1,'XLS','x')`, [ctx.A.project]), /Invalid import source/, 'an unknown source type');
    await refused(() => as(A, `select public.start_icp_import($1,'URL','javascript:alert(1)')`, [ctx.A.project]), /Invalid import source/, 'a non-http URL');
  });
  await check('B_ONE_IN_PROGRESS: a second import of the same project is refused while one is pending', async () => {
    await refused(() => start(ctx.A), /icp_import_in_progress/, 'two imports at once');
  });
  await check('C_NO_DIRECT_WRITE: members, the server role and a forged flag can never write icp_imports directly', async () => {
    await refused(() => as(A, `insert into public.icp_imports(organization_id,project_id,source_type,source_ref,created_by) values($1,$2,'TEXT','x',$3)`, [ctx.A.org, ctx.A.project, A]), /permission|denied/i, 'a direct insert');
    await refused(() => as(A, `update public.icp_imports set status='VALIDATED' where id=$1`, [imp]), /permission|denied/i, 'a direct update');
    await refused(() => as(A, `delete from public.icp_imports where id=$1`, [imp]), /permission|denied/i, 'a direct delete');
    await refused(() => asService(`update public.icp_imports set status='EXTRACTED', extracted='{}' where id=$1`, [imp]), /permission|denied/i, 'a direct update by the server role');
    await refused(() => sql(`update public.icp_imports set status='VALIDATED', validated_at=now(), validated_by=$2 where id=$1`, [imp, A]), /transition refused/, 'even the owner role without the operation');
    await refused(() => sql(`delete from public.icp_imports where id=$1`, [imp]), /never deleted/, 'a delete by the owner role');
  });
  await check('D_COMPLETE_SERVER_ONLY: only the server records the extraction, once', async () => {
    await refused(() => as(A, `select public.complete_icp_import($1,'EXTRACTED','{}'::jsonb,'[]','[]',0,'{}',null)`, [imp]), /permission|denied/i, 'a member recording an extraction');
    assert.equal(await complete(imp), true);
    const r = await row(imp);
    assert.equal(r.status, 'EXTRACTED'); assert.equal(r.token_usage, 1200); assert.deepEqual(r.usage, { input: 1000, output: 200, attempts: 1 });
    assert.equal(await complete(imp), false, 'an extracted import is never rewritten');
    await refused(() => complete(imp, 'VALIDATED'), /Invalid import status/, 'the server cannot validate');
  });
  await check('E_VALIDATE_HUMAN_ONLY: VALIDATED only through validate_icp_import by a signed-in member', async () => {
    await refused(() => asService(`select public.validate_icp_import($1,'{"version":1}'::jsonb,null,null)`, [imp]), /permission|denied/i, 'the server role validating');
    await refused(() => as(B, `select public.validate_icp_import($1,'{"version":1}'::jsonb,null,null)`, [imp]), /member|not found/i, 'another tenant validating');
    await refused(() => as(A, `select public.validate_icp_import($1,'{"version":1}'::jsonb,null,$2::jsonb)`, [imp, JSON.stringify([{ key: 'a', label: 'A', weight: 50 }])]), /weights sum to 100/, 'weights not summing to 100');
    await refused(() => as(A, `select public.validate_icp_import($1,'{"version":1}'::jsonb,null,$2::jsonb)`, [imp, JSON.stringify([{ key: 'a', label: 'A', weight: '100' }])]), /weights sum to 100/, 'a weight that is not a number');
    assert.equal((await row(imp)).status, 'EXTRACTED', 'nothing changed by the refusals');
    const r = (await as(A, `select public.validate_icp_import($1,'{"version":1,"company":{}}'::jsonb,'Offre importée validée',$2::jsonb) r`, [imp, JSON.stringify(criteria)])).rows[0].r;
    assert.equal(r.status, 'VALIDATED'); assert.equal(r.offer_written, true); assert.equal(r.criteria_written, true);
    const v = await row(imp); assert.equal(v.validated_by, A); assert.ok(v.validated_at);
    const i = await icp(ctx.A);
    assert.deepEqual(i.profile, { version: 1, company: {} }); assert.equal(i.profile_import_id, imp); assert.equal(i.profile_validated_by, A);
    assert.deepEqual(i.criteria, criteria); assert.deepEqual(i.projected_criteria, criteria); assert.equal(i.projected_offer, 'Offre importée validée');
    assert.equal((await sql('select offer from public.projects where id=$1', [ctx.A.project])).rows[0].offer, 'Offre importée validée');
    await refused(() => as(A, `select public.validate_icp_import($1,'{"version":1}'::jsonb,null,null)`, [imp]), /not_reviewable/, 'validating twice');
  });
  await check('F_REIMPORT_KEEPS_CHOICES: null offer / criteria keep what the project has (no silent overwrite)', async () => {
    await as(A, `update public.icps set criteria=$2::jsonb where project_id=$1`, [ctx.A.project, JSON.stringify([{ key: 'manual', label: 'Edité à la main', weight: 100 }])]);
    const again = await start(ctx.A); await complete(again);
    await as(A, `select public.validate_icp_import($1,'{"version":1,"second":true}'::jsonb,null,null)`, [again]);
    const i = await icp(ctx.A);
    assert.deepEqual(i.criteria, [{ key: 'manual', label: 'Edité à la main', weight: 100 }], 'a hand edit is never overwritten when the user keeps it');
    assert.equal((await sql('select offer from public.projects where id=$1', [ctx.A.project])).rows[0].offer, 'Offre importée validée');
    assert.deepEqual(i.profile, { version: 1, second: true }); assert.equal(i.profile_import_id, again);
  });
  await check('G_PROFILE_COLUMNS_GUARDED: the manual ICP save still works; the profile columns cannot be written directly, even with a forged flag', async () => {
    await as(B, `insert into public.icps(organization_id,project_id,criteria) values($1,$2,$3::jsonb)`, [ctx.B.org, ctx.B.project, JSON.stringify(criteria)]);
    await as(B, `update public.icps set criteria=$2::jsonb where project_id=$1`, [ctx.B.project, JSON.stringify(criteria)]);
    await refused(() => as(A, `update public.icps set profile='{"forged":true}' where project_id=$1`, [ctx.A.project]), /validate_icp_import only/, 'a direct profile write');
    // The flag set by the client itself, for its whole session (set_config is callable by anyone): still refused.
    await as(A, `select set_config('prospectos.icp_import_op','validate',false)`);
    await refused(() => as(A, `update public.icps set profile='{"forged":true}' where project_id=$1`, [ctx.A.project]), /validate_icp_import only/, 'a forged operation flag');
    await refused(() => as(A, `select public.discard_icp_import($1)`, [imp]).then(() => as(A, `update public.icp_imports set status='DISCARDED' where id=$1`, [imp])), /permission|denied/i, 'a forged flag on icp_imports');
    await refused(() => as(B, `insert into public.icps(organization_id,project_id,criteria,profile) values($1,gen_random_uuid(),'[]','{}')`, [ctx.B.org]), /validate_icp_import only|foreign key/, 'an insert with a profile');
    await sql(`select set_config('prospectos.icp_import_op','',false)`);
  });
  await check('H_DISCARD: a member rejects a draft or a failed import; nothing is written to the project', async () => {
    const d = await start(ctx.B); await complete(d, 'FAILED', null, 'PDF_NO_TEXT');
    assert.equal((await row(d)).error, 'PDF_NO_TEXT');
    await refused(() => as(A, 'select public.discard_icp_import($1)', [d]), /member/i, 'another tenant discarding');
    assert.equal((await as(B, 'select public.discard_icp_import($1) r', [d])).rows[0].r, true);
    assert.equal((await row(d)).status, 'DISCARDED');
    assert.equal((await as(B, 'select public.discard_icp_import($1) r', [d])).rows[0].r, false, 'a discarded import stays discarded');
    await refused(() => as(B, `select public.validate_icp_import($1,'{"version":1}'::jsonb,null,null)`, [d]), /not_reviewable/, 'validating a discarded import');
  });
  await check('I_RLS: each tenant reads only its own imports', async () => {
    assert.equal(Number((await as(B, 'select count(*) n from public.icp_imports where organization_id=$1', [ctx.A.org])).rows[0].n), 0);
    assert.ok(Number((await as(A, 'select count(*) n from public.icp_imports')).rows[0].n) >= 2);
    assert.equal(Number((await as(undefined, 'select count(*) n from public.icp_imports').catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n), 0, 'anonymous reads nothing');
  });
  await check('J_URL_DAILY_CAP: at most 10 URL imports per organization over 24 hours', async () => {
    // Unlimited plan for this check only, so the URL cap is what is measured (a trial stops at 5 AI imports).
    await sql(`update public.account_entitlements set plan='INTERNAL' where user_id=$1`, [B]);
    for (let i = 0; i < 10; i++) { const id = await start(ctx.B, 'URL', `https://exemple.fr/p${i}`); await complete(id, 'FAILED', null, 'TEST'); }
    await refused(() => start(ctx.B, 'URL', 'https://exemple.fr/p10'), /icp_url_daily_limit/, 'an 11th URL import');
    const t = await start(ctx.B, 'TEXT', 'texte'); await complete(t, 'FAILED', null, 'TEST');
    await sql(`update public.account_entitlements set plan='BETA' where user_id=$1`, [B]);
  });
  await check('K_AI_QUOTA: the AI offer quota is enforced (no import beyond the hourly limit)', async () => {
    await sql('update prospectos_private.discovery_quota_settings set ai_offer_per_hour=1');
    await refused(() => start(ctx.A), /quota|limit/i, 'an import beyond the AI offer quota');
    await sql('update prospectos_private.discovery_quota_settings set ai_offer_per_hour=1000');
  });
  await check('IDEMPOTENT: re-applying migration 041 changes nothing', async () => {
    if (!process.env.WITHOUT_041) await db.exec(await readFile(new URL('../db/migrations/041_icp_import.sql', import.meta.url), 'utf8'));
    const id = await start(ctx.A); assert.equal((await row(id)).status, 'PENDING');
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
