// Discovery trust boundary — real PostgreSQL (PGlite) with the full production migration chain.
// An authenticated member talking to PostgREST executes SQL as role `authenticated` with their JWT
// subject; `as()` reproduces exactly that (see tests/rls-runner.mjs for the same auth shim). The server's
// privileged write path runs as `service_role`. Every check below attacks the database directly — no
// TypeScript gate is involved — so a PASS means the database itself refuses.
//
// Before migration 014 exists this harness writes results the way production did (INSERT as the
// member); the attack checks then FAIL, which is the reproduction of the bypass.
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
  const hardened = (await sql(`select to_regprocedure('public.save_discovery_results(uuid,uuid,jsonb)') is not null as ok`)).rows[0].ok;

  const A = '00000000-0000-4000-8000-000000000001'; // member of OA
  const B = '00000000-0000-4000-8000-000000000002'; // member of OB
  const C = '00000000-0000-4000-8000-000000000003'; // authenticated, member of nothing
  const OA = '10000000-0000-4000-8000-000000000001', OB = '10000000-0000-4000-8000-000000000002';
  const PA = '20000000-0000-4000-8000-000000000001', PB = '20000000-0000-4000-8000-000000000002';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test'),($3,'c@test')`, [A, B, C]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'A',$2),($3,'B',$4)`, [OA, A, OB, B]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [OA, A, OB, B]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'A project'),($3,$4,'B project')`, [PA, OA, PB, OB]);
  const runA = (await as(A, `select public.start_discovery($1,'agences marketing','Toulouse','[]','brave',20,'{}') run`, [PA])).rows[0].run.id;
  const runB = (await as(B, `select public.start_discovery($1,'agences marketing','Lyon','[]','brave',20,'{}') run`, [PB])).rows[0].run.id;

  const row = (name, cls, extra = {}) => ({
    company_name: name, website: extra.website ?? null, phone: null, address: null, city: null,
    source_url: extra.source_url ?? `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.example/`, source_title: name,
    provider: 'brave', raw_payload: {source_class: cls}, normalized_payload: {name, raw_metadata: {source_class: cls}},
    dedupe_key: `name:${name.toLowerCase()}|${Math.random()}`, dedupe_status: 'unique', duplicate_of: null, reason: 'test', source_class: cls,
  });
  // The pipeline write, exactly as the server performs it in each state of the codebase.
  async function pipelineWrite(user, run, rows) {
    if (hardened) return (await asService(`select * from public.save_discovery_results($1,$2,$3::jsonb)`, [user, run, JSON.stringify(rows)])).rows;
    const out = [];
    for (const r of rows) out.push((await as(user, `insert into public.discovery_results(organization_id,project_id,discovery_run_id,company_name,website,source_url,source_title,provider,raw_payload,normalized_payload,dedupe_key,dedupe_status,reason)
      select organization_id,project_id,id,$2,$3,$4,$5,'brave',$6::jsonb,$7::jsonb,$8,'unique','test' from public.discovery_runs where id=$1 returning *`,
      [run, r.company_name, r.website, r.source_url, r.source_title, JSON.stringify(r.raw_payload), JSON.stringify(r.normalized_payload), r.dedupe_key])).rows[0]);
    return out;
  }
  const [candA, signalA, irrelevantA, uncertainA, toIgnoreA, forgeTargetA] = await pipelineWrite(A, runA, [
    row('La Collab', 'COMPANY_CANDIDATE', {website: 'https://lacollab.example'}),
    row('Grand Frais via Indeed', 'SIGNAL_SOURCE', {source_url: 'https://fr.indeed.com/viewjob?jk=1'}),
    row('Freelance Media plus de 100 emplois', 'IRRELEVANT', {source_url: 'https://fr.indeed.com/q-freelance-media-emplois.html'}),
    row('Consultant Freelance en Marketing Digital', 'UNCERTAIN', {source_url: 'https://kerline.example/'}),
    row('A ignorer', 'COMPANY_CANDIDATE'),
    row('Cible de falsification', 'IRRELEVANT'),
  ]);
  const [candB] = await pipelineWrite(B, runB, [row('Entreprise B', 'COMPANY_CANDIDATE', {website: 'https://b.example'})]);
  // A result written before this classification existed: no class at all.
  const legacyA = (await sql(`insert into public.discovery_results(organization_id,project_id,discovery_run_id,company_name,source_url,source_title,provider,dedupe_key,dedupe_status)
    values($1,$2,$3,'Ancien résultat','https://ancien.example/','Ancien','brave','legacy-1','unique') returning *`, [OA, PA, runA])).rows[0];
  const legacyAcceptedA = (await sql(`insert into public.discovery_results(organization_id,project_id,discovery_run_id,company_name,source_url,source_title,provider,dedupe_key,dedupe_status)
    values($1,$2,$3,'Ancien accepté','https://ancien-accepte.example/','Ancien','brave','legacy-2','unique') returning *`, [OA, PA, runA])).rows[0];
  // Prospects are audited (append_event requires a member identity): created as A, as it historically was.
  const legacyProspect = (await as(A, `insert into public.prospects(organization_id,project_id,name,status) values($1,$2,'Ancien accepté','À analyser') returning id`, [OA, PA])).rows[0].id;
  await sql(`update public.discovery_results set status='accepted',prospect_id=$2 where id=$1`, [legacyAcceptedA.id, legacyProspect]);

  const prospectCount = async () => (await sql('select count(*)::int n from public.prospects')).rows[0].n;
  const snapshot = async id => JSON.stringify((await sql('select * from public.discovery_results where id=$1', [id])).rows[0]);
  const tenantB = async () => JSON.stringify((await sql(`select (select json_agg(r order by r.id) from public.discovery_results r where organization_id=$1) results,(select json_agg(p order by p.id) from public.prospects p where organization_id=$1) prospects`, [OB])).rows[0]);
  const bBefore = await tenantB();
  const acceptAs = (user, id) => as(user, `select public.accept_discovery_result($1,false) p`, [id]);

  // ---------------- attacks by an authenticated member (PostgREST-equivalent) ----------------
  await check('ATTACK_DIRECT_INSERT: member INSERTs a forged COMPANY_CANDIDATE row', () => refused(() => as(A, `insert into public.discovery_results(organization_id,project_id,discovery_run_id,company_name,source_url,source_title,provider,normalized_payload,dedupe_key,dedupe_status)
    values($1,$2,$3,'Forgée','https://forgee.example/','Forgée','brave','{"raw_metadata":{"source_class":"COMPANY_CANDIDATE"}}','forged','unique')`, [OA, PA, runA]), /permission denied/, 'a direct INSERT'));
  await check('ATTACK_CLASS_UPDATE: member UPDATEs source_class to COMPANY_CANDIDATE', () => refused(() => as(A, `update public.discovery_results set source_class='COMPANY_CANDIDATE' where id=$1`, [forgeTargetA.id]), /permission denied/, 'an UPDATE of source_class'));
  await check('ATTACK_JSONB_FORGERY: member rewrites normalized_payload then accepts', async () => {
    await refused(() => as(A, `update public.discovery_results set normalized_payload=jsonb_set(normalized_payload,'{raw_metadata,source_class}','"COMPANY_CANDIDATE"'), raw_payload=jsonb_set(raw_payload,'{source_class}','"COMPANY_CANDIDATE"') where id=$1`, [forgeTargetA.id]), /permission denied/, 'an UPDATE of normalized_payload');
    await refused(() => acceptAs(A, forgeTargetA.id), /CANDIDATE_NOT_ACCEPTABLE/, 'accepting the forged row');
  });
  const before = await prospectCount();
  await check('ATTACK_RPC_IRRELEVANT: direct accept_discovery_result on IRRELEVANT', () => refused(() => acceptAs(A, irrelevantA.id), /CANDIDATE_NOT_ACCEPTABLE/, 'accepting IRRELEVANT'));
  await check('ATTACK_RPC_SIGNAL_SOURCE: direct accept_discovery_result on SIGNAL_SOURCE', () => refused(() => acceptAs(A, signalA.id), /CANDIDATE_NOT_ACCEPTABLE/, 'accepting SIGNAL_SOURCE'));
  await check('ATTACK_RPC_UNCERTAIN: direct accept_discovery_result on UNCERTAIN', () => refused(() => acceptAs(A, uncertainA.id), /CANDIDATE_NOT_ACCEPTABLE/, 'accepting UNCERTAIN'));
  await check('ATTACK_RPC_NULL: direct accept_discovery_result on a legacy row with no class', () => refused(() => acceptAs(A, legacyA.id), /CANDIDATE_NOT_ACCEPTABLE/, 'accepting a legacy NULL row'));
  await check('NO_PARASITIC_PROSPECT: no prospect created by any refused call', async () => assert.equal(await prospectCount(), before));
  await check('REFUSED_ROWS_UNCHANGED: refused rows keep status pending and no prospect_id', async () => {
    for (const r of [irrelevantA, signalA, uncertainA, legacyA, forgeTargetA]) {
      const now = (await sql('select status,prospect_id from public.discovery_results where id=$1', [r.id])).rows[0];
      assert.deepEqual(now, {status: 'pending', prospect_id: null}, r.company_name);
    }
  });
  await check('ATTACK_CROSS_TENANT: member of A accepts a COMPANY_CANDIDATE of B', () => refused(() => acceptAs(A, candB.id), /tenant member required/, 'a cross-tenant accept'));
  await check('ATTACK_NON_MEMBER: authenticated non-member accepts a COMPANY_CANDIDATE of A', () => refused(() => acceptAs(C, candA.id), /tenant member required/, 'a non-member accept'));
  await check('ATTACK_ANON: anonymous caller cannot accept', () => refused(() => as(undefined, `select public.accept_discovery_result($1,false)`, [candA.id]), /permission denied/, 'an anonymous accept'));
  await check('ATTACK_SAVE_AS_MEMBER: member calls the privileged save_discovery_results directly', () => refused(() => as(A, `select * from public.save_discovery_results($1,$2,$3::jsonb)`, [A, runA, JSON.stringify([row('Forgée via RPC', 'COMPANY_CANDIDATE')])]), /permission denied/, 'a member-invoked privileged save'));
  await check('CONFUSED_DEPUTY_DB: privileged save for user A into B\'s run', () => refused(() => asService(`select * from public.save_discovery_results($1,$2,$3::jsonb)`, [A, runB, JSON.stringify([row('Intrusion', 'COMPANY_CANDIDATE')])]), /tenant member required/, 'writing into a tenant the user does not belong to'));
  await check('CLASS_CHECK_CONSTRAINT: an invalid class cannot be stored even by the privileged path', () => refused(() => asService(`select * from public.save_discovery_results($1,$2,$3::jsonb)`, [A, runA, JSON.stringify([row('Invalide', 'VERIFIED')])]), /check constraint/, 'an invalid source_class'));
  await check('TENANT_FROM_RUN: the privileged path always takes organization/project from the run, never from the row', async () => {
    const forged = {...row('Org forgée', 'COMPANY_CANDIDATE'), organization_id: OB, project_id: PB};
    const [saved] = (await asService(`select * from public.save_discovery_results($1,$2,$3::jsonb)`, [A, runA, JSON.stringify([forged])])).rows;
    assert.equal(saved.organization_id, OA); assert.equal(saved.project_id, PA);
  });

  // ---------------- legitimate flows ----------------
  await check('LEGIT_COMPANY_CANDIDATE: a pipeline-written COMPANY_CANDIDATE is accepted', async () => {
    const n = await prospectCount();
    const p = (await acceptAs(A, candA.id)).rows[0].p;
    assert.equal(p.name, 'La Collab'); assert.equal(p.website, 'https://lacollab.example'); assert.equal(p.organization_id, OA);
    assert.equal(await prospectCount(), n + 1);
  });
  await check('IDEMPOTENCE: accepting the same COMPANY_CANDIDATE again returns the same prospect and creates nothing', async () => {
    const n = await prospectCount();
    const first = (await sql('select prospect_id from public.discovery_results where id=$1', [candA.id])).rows[0].prospect_id;
    const again = (await acceptAs(A, candA.id)).rows[0].p;
    assert.equal(again.id, first); assert.equal(await prospectCount(), n);
  });
  await check('IDEMPOTENCE_LEGACY: a result accepted before the migration still returns its prospect, creates nothing', async () => {
    const n = await prospectCount();
    assert.equal((await acceptAs(A, legacyAcceptedA.id)).rows[0].p.id, legacyProspect); assert.equal(await prospectCount(), n);
  });
  await check('LEGIT_IGNORE: pending -> ignored, and nothing else on the row changes', async () => {
    const beforeRow = JSON.parse(await snapshot(toIgnoreA.id));
    await as(A, `select public.ignore_discovery_result($1)`, [toIgnoreA.id]);
    const afterRow = JSON.parse(await snapshot(toIgnoreA.id));
    assert.equal(afterRow.status, 'ignored');
    assert.deepEqual({...afterRow, status: beforeRow.status}, beforeRow, 'only status changed');
  });
  await check('IGNORE_CROSS_TENANT: member of A cannot ignore B\'s result', async () => {
    const snap = await snapshot(candB.id);
    await refused(() => as(A, `select public.ignore_discovery_result($1)`, [candB.id]), /tenant member required/, 'a cross-tenant ignore');
    assert.equal(await snapshot(candB.id), snap);
  });
  await check('IGNORE_NON_PENDING: an accepted result cannot be flipped to ignored', async () => {
    const snap = await snapshot(candA.id);
    await refused(() => as(A, `select public.ignore_discovery_result($1)`, [candA.id]), /only a pending/i, 'ignoring an accepted result');
    assert.equal(await snapshot(candA.id), snap);
  });
  await check('IGNORED_NOT_ACCEPTABLE: an ignored result still cannot be accepted', () => refused(() => acceptAs(A, toIgnoreA.id), /Ignored result cannot be accepted/, 'accepting an ignored result'));
  await check('GATE_BEFORE_FUSION: a non-candidate marked duplicate_candidate of an existing prospect is refused, prospect untouched', async () => {
    const target = (await sql('select prospect_id from public.discovery_results where id=$1', [candA.id])).rows[0].prospect_id;
    const [dup] = await pipelineWrite(A, runA, [{...row('Doublon non candidat', 'IRRELEVANT'), dedupe_status: 'duplicate_candidate', duplicate_of: target}]);
    const prospectBefore = JSON.stringify((await sql('select * from public.prospects where id=$1', [target])).rows[0]);
    await refused(() => acceptAs(A, dup.id), /CANDIDATE_NOT_ACCEPTABLE/, 'fusing a non-candidate into an existing prospect');
    assert.equal(JSON.stringify((await sql('select * from public.prospects where id=$1', [target])).rows[0]), prospectBefore);
    assert.equal((await sql('select status from public.discovery_results where id=$1', [dup.id])).rows[0].status, 'pending');
  });
  await check('MEMBER_SELECT_KEPT: members still read their own results; RLS still hides other tenants', async () => {
    assert.ok((await as(A, 'select count(*)::int n from public.discovery_results')).rows[0].n > 0);
    assert.equal((await as(A, 'select count(*)::int n from public.discovery_results where organization_id=$1', [OB])).rows[0].n, 0);
    assert.equal((await as(C, 'select count(*)::int n from public.discovery_results')).rows[0].n, 0);
  });
  await check('CROSS_TENANT_UNCHANGED: nothing of tenant B changed during all of the above', async () => assert.equal(await tenantB(), bBefore));
  await check('RLS_ENABLED: row level security is still enabled on discovery_results', async () => assert.equal((await sql(`select relrowsecurity from pg_class where oid='public.discovery_results'::regclass`)).rows[0].relrowsecurity, true));

  const width = Math.max(...results.map(r => r[0].length));
  for (const [name, status, detail] of results) console.log(`${status}  ${name.padEnd(width)}  ${detail}`);
  const failed = results.filter(r => r[1] === 'FAIL').length;
  console.log(`${hardened ? 'HARDENED' : 'BASELINE (no migration 014)'}: ${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
} finally {
  await db.close();
}
