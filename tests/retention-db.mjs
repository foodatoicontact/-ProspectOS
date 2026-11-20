// Migration 048 — retention, on real PostgreSQL (PGlite) with the full migration chain: contact details of people on a
// prospect without activity for 3 years are deleted (the company, its website and its evidence stay); the purges already
// written run together (signals, BODACC announcements past 13 months unless a list cites them, lists past 3 years).
// WITHOUT_048=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_048 && f.startsWith('048_')));
  assert.ok(process.env.WITHOUT_048 || migrations.includes('048_retention.sql'), 'migration 048 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  const ORG = '10000000-0000-4000-8000-000000000001', PRJ = '20000000-0000-4000-8000-000000000001';
  const OLD = '30000000-0000-4000-8000-000000000001', RECENT = '30000000-0000-4000-8000-000000000002', OLD_EVENT = '30000000-0000-4000-8000-000000000003';
  // Fixtures written as the owner with triggers off, so that dates can be set in the past.
  await sql(`set session_replication_role = replica`);
  await sql(`insert into auth.users(id,email) values ($1,'a@test.fr')`, [A]);
  await sql(`insert into public.organizations(id,name,owner_id) values ($1,'Org',$2)`, [ORG, A]);
  await sql(`insert into public.memberships(organization_id,user_id,role) values ($1,$2,'owner')`, [ORG, A]);
  await sql(`insert into public.projects(id,organization_id,name) values ($1,$2,'P')`, [PRJ, ORG]);
  const ago = "now()-interval '4 years'";
  for (const [id, when] of [[OLD, ago], [RECENT, "now()-interval '2 years'"], [OLD_EVENT, ago]])
    await sql(`insert into public.prospects(id,organization_id,project_id,name,created_at,updated_at) values ($1,$2,$3,'Société',${when},${when})`, [id, ORG, PRJ]);
  for (const id of [OLD, RECENT, OLD_EVENT]) {
    await sql(`insert into public.channels(organization_id,prospect_id,kind,value,created_at) values ($1,$2,'email','jean.dupont@exemple.fr',${ago}),($1,$2,'phone','0102030405',${ago}),($1,$2,'website','https://exemple.fr',${ago})`, [ORG, id]);
    await sql(`insert into public.evidence(organization_id,prospect_id,criterion,value,status,created_at) values ($1,$2,'c',true,'NOT_VERIFIED',${ago})`, [ORG, id]);
    await sql(`insert into public.outreach_contacts(organization_id,project_id,prospect_id,contact_name,contact_role,role_source_url,email,email_source,email_source_url,email_source_excerpt,created_at)
      values ($1,$2,$3,'Jean Dupont','Gérant','https://exemple.fr/equipe',$4,'company_website','https://exemple.fr/contact','Écrivez à '||$4,${ago})`, [ORG, PRJ, id, `j.dupont-${id.slice(-1)}@exemple.fr`]);
  }
  // Activity 1 year ago on OLD_EVENT through its audit trail only.
  await sql(`insert into public.events(organization_id,prospect_id,actor_id,kind,created_at) values ($1,$2,$3,'channels.update',now()-interval '1 year')`, [ORG, OLD_EVENT, A]);
  // BODACC announcements: one recent, one old, one old but cited by a list of the référentiel.
  const ev = (id, d) => sql(`insert into public.public_events(source,source_id,kind,siren,published_on,source_url) values('bodacc',$1,'VENTE_FONDS','900000001',$2,'https://www.bodacc.fr/x')`, [id, d]);
  await ev('NEW', '2026-11-01'); await ev('OLD', '2024-01-10'); await ev('CITED', '2024-01-11');
  const list = (await sql(`insert into public.prospect_lists(code,title,purpose,zone,client_label,produced_on,keep_until) values('liste-1','L','p','z','c','2024-01-12','2027-01-12') returning id`)).rows[0].id;
  await sql(`insert into public.prospect_list_items(list_id,position,siren,event_source,event_source_id) values($1,1,'900000001','bodacc','CITED')`, [list]);
  await sql(`insert into public.prospect_lists(code,title,purpose,zone,client_label,produced_on,keep_until) values('liste-2','L','p','z','c','2023-01-01','2026-01-01')`);
  await sql(`set session_replication_role = origin`);

  let report;
  await check('RUN: server only — a signed-in or anonymous caller cannot run the purge', async () => {
    await refused(() => as(A, `select public.run_retention()`), /permission denied/i, 'a signed-in run');
    await refused(() => as(undefined, `select public.run_retention()`), /permission denied/i, 'an anonymous run');
    await refused(() => as(A, `select public.purge_inactive_contacts(10)`), /permission denied/i, 'a signed-in contact purge');
    report = (await asService(`select public.run_retention() r`)).rows[0].r;
    assert.deepEqual(Object.keys(report).sort(), ['inactive_contacts', 'prospect_lists', 'public_events', 'signals']);
  });
  await check('CONTACTS: after 3 years without activity, people\'s details go; the company website, the record and its evidence stay', async () => {
    assert.deepEqual(report.inactive_contacts, { prospects: 1, channels: 2, contacts: 1 });
    const left = (await sql(`select prospect_id,kind from public.channels order by prospect_id,kind`)).rows.map(r => `${r.prospect_id.slice(-1)}:${r.kind}`);
    assert.deepEqual(left, ['1:website', '2:email', '2:phone', '2:website', '3:email', '3:phone', '3:website']);
    assert.deepEqual((await sql(`select prospect_id from public.outreach_contacts order by 1`)).rows.map(r => r.prospect_id), [RECENT, OLD_EVENT]);
    assert.equal((await sql(`select count(*)::int n from public.prospects`)).rows[0].n, 3, 'no prospect is deleted');
    assert.equal((await sql(`select count(*)::int n from public.evidence`)).rows[0].n, 3, 'no evidence is deleted');
  });
  await check('ACTIVITY: an audit event, a channel or a contact added within 3 years keeps the details', async () => {
    assert.equal((await sql(`select count(*)::int n from public.channels where prospect_id=$1`, [OLD_EVENT])).rows[0].n, 3);
    assert.equal((await asService(`select public.purge_inactive_contacts(10) r`)).rows[0].r.prospects, 0, 'a second run finds nothing');
  });
  await check('ANNOUNCEMENTS: older than 13 months go, unless a list of the référentiel cites them; old lists go', async () => {
    assert.deepEqual((await sql(`select source_id from public.public_events order by 1`)).rows.map(r => r.source_id), ['CITED', 'NEW']);
    assert.deepEqual((await sql(`select code from public.prospect_lists`)).rows.map(r => r.code), ['liste-1']);
    assert.equal(report.prospect_lists, 1);
  });
  await check('NOTHING_ELSE: only functions; no table, policy or trigger is created or changed', async () => {
    const m = (await readFile(new URL('../db/migrations/048_retention.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(create|alter|drop) (table|policy|trigger)\b/i);
    assert.doesNotMatch(m, /(insert into|update) public\./i);
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
