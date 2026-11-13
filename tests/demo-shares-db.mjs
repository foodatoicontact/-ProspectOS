// Migration 042 — demo links, on real PostgreSQL (PGlite) with the full migration chain: only the OWNER of the project's
// organization creates, lists and revokes; the token hash never reaches a browser role; the public read is server-only,
// limited to the project of the link, and answers NULL for an unknown, expired or revoked link; a view is counted and
// announced once; the copy after sign-up lands in the caller's own organization, once, with signals back to review.
// WITHOUT_042=1 runs the checks without the migration: they must fail.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
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
const hash = token => createHash('sha256').update(token).digest('hex');

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
    .filter(f => !(process.env.WITHOUT_042 && f.startsWith('042_')));
  assert.ok(process.env.WITHOUT_042 || migrations.includes('042_demo_shares.sql'), 'migration 042 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1'; // owner of the shared project
  const M = '00000000-0000-4000-8000-0000000000a2'; // plain member of A's organization
  const B = '00000000-0000-4000-8000-0000000000b1'; // another customer
  const N = '00000000-0000-4000-8000-0000000000c1'; // a brand-new account, no organization yet
  await sql(`insert into auth.users(id,email) values ($1,'a@client.fr'),($2,'m@client.fr'),($3,'b@client.fr'),($4,'n@client.fr')`, [A, M, B, N]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const orgA = await org(A), orgB = await org(B);
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`, [orgA, M]);
  const project = async (user, o, name) => (await as(user, `insert into public.projects(organization_id,name,offer) values($1,$2,'Offre') returning id`, [o, name])).rows[0].id;
  const shared = await project(A, orgA, 'Garages repris IDF'), other = await project(A, orgA, 'Autre projet de A'), foreign = await project(B, orgB, 'Projet de B');
  await as(A, `insert into public.icps(organization_id,project_id,criteria) values($1,$2,'[]')`, [orgA, shared]);
  let n = 0;
  const prospect = async (o, p, name, { status = 'PENDING_REVIEW', demo = {} } = {}) => {
    n++;
    const id = (await as(o === orgB ? B : A, `insert into public.prospects(organization_id,project_id,name,city,website) values($1,$2,$3,'Cergy','https://annuaire-entreprises.data.gouv.fr/entreprise/${100000000 + n}') returning id`, [o, p, name])).rows[0].id;
    await sql(`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,event_date,observed_at,confidence,content_hash,event_key,status,reviewed_at,raw_metadata)
      values($1,$2,$3,'bodacc','acquisition','Vente et cession','Achat d’un fonds ${n}','https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A${n}','legal_announcement','2026-10-0${n}',now(),1,$4,'k${n}',$5,${status === 'REJECTED' ? 'now()' : 'null'},$6)`,
      [o, p, id, String(n).padStart(64, '0'), status, JSON.stringify({ demo, siren: String(100000000 + n) })]);
    return id;
  };
  const g1 = await prospect(orgA, shared, 'GARAGE UN', { demo: { department: '95', sells_vehicles: true, is_new: true } });
  await prospect(orgA, shared, 'GARAGE DEUX', { demo: { department: '77' } });
  await prospect(orgA, shared, 'GARAGE REJETE', { status: 'REJECTED' });
  await as(A, `insert into public.channels(organization_id,prospect_id,kind,value) values($1,$2,'phone','0102030405')`, [orgA, g1]);
  await prospect(orgA, other, 'SECRET DE A');
  await prospect(orgB, foreign, 'SECRET DE B');

  const T = 'a'.repeat(43), T2 = 'b'.repeat(43), T3 = 'c'.repeat(43);
  const create = (user, p, token, target = null) => as(user, `select public.create_demo_share($1,$2,$3) r`, [p, hash(token), target]);
  const read = async token => (await asService(`select public.read_demo_share($1) r`, [hash(token)])).rows[0].r;
  let shareId;

  await check('OWNER_ONLY_CREATE: the owner creates a link; a member, another customer and anon cannot', async () => {
    const r = (await create(A, shared, T, 'Garages repris en Île-de-France')).rows[0].r;
    shareId = r.id;
    assert.equal(r.view_count, 0);
    assert.equal(r.token_hash, undefined, 'the hash is not echoed');
    const days = (new Date(r.expires_at) - new Date(r.created_at)) / 86400000;
    assert.ok(Math.abs(days - 14) < 0.01, `14 days by default (got ${days})`);
    await refused(() => create(M, shared, T2), /owner/i, 'a plain member creating a link');
    await refused(() => create(B, shared, T2), /owner/i, 'another customer creating a link on a project that is not theirs');
    await refused(() => as(undefined, `select public.create_demo_share($1,$2) r`, [shared, hash(T2)]), /permission denied/i, 'anon creating a link');
    await refused(() => as(A, `select public.create_demo_share($1,'not-a-hash') r`, [shared]), /Invalid demo share/, 'a malformed hash');
  });
  await check('NO_DIRECT_WRITE_NO_HASH: rows are written by the functions only, and no browser role reads token_hash', async () => {
    await refused(() => as(A, `insert into public.demo_shares(organization_id,project_id,created_by,token_hash) values($1,$2,$3,$4)`, [orgA, shared, A, hash(T2)]), /permission denied/i, 'a direct insert');
    await refused(() => as(A, `update public.demo_shares set view_count=99`), /permission denied/i, 'a direct update');
    await refused(() => as(A, `delete from public.demo_shares`), /permission denied/i, 'a direct delete');
    await refused(() => as(A, `select token_hash from public.demo_shares`), /permission denied/i, 'reading the token hash');
    assert.equal((await sql(`select count(*) n from public.demo_shares where token_hash=$1`, [T])).rows[0].n, 0, 'the raw token is not stored');
  });
  await check('OWNER_ONLY_LIST: the owner lists the link; a member and another customer see nothing', async () => {
    const cols = 'id,project_id,target,expires_at,revoked_at,view_count,last_viewed_at,created_at';
    assert.equal((await as(A, `select ${cols} from public.demo_shares`)).rows.length, 1);
    assert.equal((await as(M, `select ${cols} from public.demo_shares`)).rows.length, 0);
    assert.equal((await as(B, `select ${cols} from public.demo_shares`)).rows.length, 0);
    await refused(() => as(undefined, `select id from public.demo_shares`), /permission denied/i, 'anon listing links');
  });
  await check('SERVER_ONLY_READ: the page content is not reachable by a browser role', async () => {
    await refused(() => as(B, `select public.read_demo_share($1)`, [hash(T)]), /permission denied/i, 'an authenticated read_demo_share');
    await refused(() => as(undefined, `select public.read_demo_share($1)`, [hash(T)]), /permission denied/i, 'an anonymous read_demo_share');
    await refused(() => as(B, `select public.record_demo_share_view($1)`, [hash(T)]), /permission denied/i, 'an authenticated record_demo_share_view');
  });
  await check('PROJECT_ONLY: the link shows its project’s companies and nothing of another project', async () => {
    const v = await read(T);
    assert.equal(v.project.name, 'Garages repris IDF');
    assert.equal(v.target, 'Garages repris en Île-de-France');
    assert.deepEqual(v.prospects.map(p => p.name).sort(), ['GARAGE DEUX', 'GARAGE REJETE', 'GARAGE UN']);
    const text = JSON.stringify(v);
    assert.doesNotMatch(text, /SECRET DE A|SECRET DE B|Autre projet|Projet de B/, 'no other project, no other customer');
    assert.doesNotMatch(text, /0102030405|phone|email|a@client\.fr/, 'no channel, no address');
    assert.doesNotMatch(text, /token_hash|organization_id|created_by/, 'no internal identifier');
    const one = v.prospects.find(p => p.name === 'GARAGE UN');
    assert.equal(one.signals.length, 1);
    assert.deepEqual(one.signals[0].demo, { department: '95', sells_vehicles: true, is_new: true });
    assert.match(one.signals[0].source_url, /^https:\/\/www\.bodacc\.fr\//);
    assert.equal(v.prospects.find(p => p.name === 'GARAGE REJETE').signals.length, 0, 'a rejected signal is not shown');
  });
  await check('INVALID_TOKEN: an unknown token, a null and the raw token instead of its hash read nothing', async () => {
    assert.equal(await read('z'.repeat(43)), null);
    assert.equal((await asService(`select public.read_demo_share(null) r`)).rows[0].r, null);
    assert.equal((await asService(`select public.read_demo_share($1) r`, [T])).rows[0].r, null);
    assert.equal((await asService(`select public.record_demo_share_view($1) r`, [hash('z'.repeat(43))])).rows[0].r, null);
  });
  await check('READ_ONLY: reading the page changes nothing', async () => {
    const before = JSON.stringify((await sql(`select * from public.demo_shares order by id`)).rows);
    await read(T); await read(T);
    assert.equal(JSON.stringify((await sql(`select * from public.demo_shares order by id`)).rows), before);
  });
  await check('VIEW_COUNT: each human view is counted; the first one is announced once, with the creator’s address', async () => {
    const v1 = (await asService(`select public.record_demo_share_view($1) r`, [hash(T)])).rows[0].r;
    assert.equal(v1.first, true); assert.equal(v1.view_count, 1);
    assert.equal(v1.project_name, 'Garages repris IDF'); assert.equal(v1.owner_email, 'a@client.fr');
    const v2 = (await asService(`select public.record_demo_share_view($1) r`, [hash(T)])).rows[0].r;
    assert.equal(v2.first, false); assert.equal(v2.view_count, 2);
    assert.equal(v2.owner_email, null, 'the address is returned for the first view only');
    const row = (await as(A, `select view_count,last_viewed_at from public.demo_shares where id=$1`, [shareId])).rows[0];
    assert.equal(row.view_count, 2); assert.ok(row.last_viewed_at);
  });
  await check('EXPIRED: an expired link reads nothing, counts nothing and cannot be copied', async () => {
    await create(A, shared, T2);
    await sql(`update public.demo_shares set expires_at=now()-interval '1 second' where token_hash=$1`, [hash(T2)]);
    assert.equal(await read(T2), null);
    assert.equal((await asService(`select public.record_demo_share_view($1) r`, [hash(T2)])).rows[0].r, null);
    assert.equal((await sql(`select view_count from public.demo_shares where token_hash=$1`, [hash(T2)])).rows[0].view_count, 0);
    await refused(() => as(B, `select public.claim_demo_share($1)`, [hash(T2)]), /demo_share_invalid/, 'copying an expired link');
  });
  await check('REVOKED: only the owner revokes; a revoked link reads nothing and cannot be copied', async () => {
    await create(A, shared, T3);
    const id = (await sql(`select id from public.demo_shares where token_hash=$1`, [hash(T3)])).rows[0].id;
    await refused(() => as(M, `select public.revoke_demo_share($1)`, [id]), /owner/i, 'a member revoking');
    await refused(() => as(B, `select public.revoke_demo_share($1)`, [id]), /owner/i, 'another customer revoking');
    assert.ok(await read(T3), 'still readable after the refused attempts');
    assert.equal((await as(A, `select public.revoke_demo_share($1) r`, [id])).rows[0].r, true);
    assert.equal(await read(T3), null);
    await refused(() => as(B, `select public.claim_demo_share($1)`, [hash(T3)]), /demo_share_invalid/, 'copying a revoked link');
  });
  await check('CLAIM_AFTER_SIGNUP: a new account gets its own copy — project, targeting, companies, signals back to review', async () => {
    const r = (await as(N, `select public.claim_demo_share($1) r`, [hash(T)])).rows[0].r;
    assert.equal(r.copied, true); assert.equal(r.prospects, 3);
    const copy = (await sql(`select p.*,(select role from public.memberships m where m.organization_id=p.organization_id and m.user_id=$2) role from public.projects p where p.id=$1`, [r.project_id, N])).rows[0];
    assert.equal(copy.name, 'Garages repris IDF'); assert.equal(copy.role, 'owner', 'in an organization the new account owns');
    assert.notEqual(copy.organization_id, orgA);
    assert.equal((await as(N, `select count(*) n from public.icps where project_id=$1`, [r.project_id])).rows[0].n, 1);
    const mine = (await as(N, `select name,status,city from public.prospects where project_id=$1 order by name`, [r.project_id])).rows;
    assert.deepEqual(mine.map(p => p.name), ['GARAGE DEUX', 'GARAGE REJETE', 'GARAGE UN']);
    assert.ok(mine.every(p => p.status === 'À analyser' && p.city === 'Cergy'));
    const sig = (await as(N, `select status,reviewed_by,source_url,raw_metadata from public.signals where project_id=$1`, [r.project_id])).rows;
    assert.equal(sig.length, 2, 'the rejected signal is not copied');
    assert.ok(sig.every(s => s.status === 'PENDING_REVIEW' && s.reviewed_by === null && /^https:\/\/www\.bodacc\.fr\//.test(s.source_url)));
    assert.equal((await sql(`select count(*) n from public.channels c join public.prospects p on p.id=c.prospect_id where p.project_id=$1`, [r.project_id])).rows[0].n, 0, 'no channel copied');
    assert.equal((await as(N, `select count(*) n from public.prospects where project_id in ($1,$2)`, [shared, other])).rows[0].n, 0, 'the source stays invisible to the new account');
    assert.equal((await sql(`select count(*) n from public.prospects where project_id=$1`, [shared])).rows[0].n, 3, 'the source project is untouched');
  });
  await check('CLAIM_ONCE: the same account copying again gets the same project, no duplicate', async () => {
    const before = (await sql(`select count(*) n from public.projects`)).rows[0].n;
    const again = (await as(N, `select public.claim_demo_share($1) r`, [hash(T)])).rows[0].r;
    assert.equal(again.copied, false);
    assert.equal((await sql(`select count(*) n from public.projects`)).rows[0].n, before);
  });
  await check('CLAIM_SCOPE: another customer copies into ITS organization; the owner’s side cannot copy to itself; anon cannot', async () => {
    const r = (await as(B, `select public.claim_demo_share($1) r`, [hash(T)])).rows[0].r;
    assert.equal((await sql(`select organization_id from public.projects where id=$1`, [r.project_id])).rows[0].organization_id, orgB);
    assert.equal((await as(B, `select count(*) n from public.prospects where name='SECRET DE A'`)).rows[0].n, 0);
    await refused(() => as(A, `select public.claim_demo_share($1)`, [hash(T)]), /demo_share_own/, 'the owner copying their own link');
    await refused(() => as(M, `select public.claim_demo_share($1)`, [hash(T)]), /demo_share_own/, 'a member copying their own organization’s link');
    await refused(() => as(undefined, `select public.claim_demo_share($1)`, [hash(T)]), /permission denied/i, 'anon copying');
  });
  await check('PROJECT_DELETED: deleting the project removes its links', async () => {
    const p = await project(A, orgA, 'Éphémère');
    await create(A, p, 'd'.repeat(43));
    await sql(`delete from public.projects where id=$1`, [p]);
    assert.equal(await read('d'.repeat(43)), null);
  });
  await check('IDEMPOTENT: re-applying migration 042 changes nothing', async () => {
    if (!process.env.WITHOUT_042) await db.exec(await readFile(new URL('../db/migrations/042_demo_shares.sql', import.meta.url), 'utf8'));
    assert.equal((await read(T)).prospects.length, 3);
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
