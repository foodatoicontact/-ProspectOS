// Migration 059 — cockpit administrateur, écran Clients (owner decision, 26 nov. 2026), on real PostgreSQL (PGlite), full
// chain. The list and the sheet of an organization gather its offer, billing as stored, usage, veille dédiée, partner of
// origin, notes and events; the notes are append-only and timestamped with their author; and the RLS test: a client
// account and an anonymous visitor read no note, call no function, write nothing. WITHOUT_059=1: the checks must fail.
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
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).replace(/\n/g, ' ').slice(0, 400)]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
}
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()
    .filter(f => !(process.env.WITHOUT_059 && f.startsWith('059_')));
  assert.ok(process.env.WITHOUT_059 || migrations.includes('059_admin_clients.sql'), 'migration 059 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const K = uid(0xad), C = uid(0xc1), M = uid(0xc2), D = uid(0xd1);
  await sql(`insert into auth.users(id,email) values($1,'admin@prospectos.test'),($2,'gerant@boulangerie.test'),($3,'membre@boulangerie.test'),($4,'autre@cabinet.test')`, [K, C, M, D]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  const orgC = (await as(C, `select public.create_organization('Boulangerie Martin') id`)).rows[0].id;
  const orgD = (await as(D, `select public.create_organization('Cabinet Durand') id`)).rows[0].id;
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`, [orgC, M]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,seats,updated_at) values($1,'TEAM','ACTIVE',now()-interval '5 days',now()+interval '25 days',2,now())`, [C]);
  await sql(`insert into prospectos_private.billing_accounts(user_id,stripe_customer_id,stripe_subscription_id,plan,subscription_status,current_period_end,cancel_at_period_end,seats) values($1,'cus_TEST1','sub_TEST1',null,'active',now()+interval '25 days',true,2)`, [C]);
  const proj = (await as(C, `insert into public.projects(organization_id,name) values($1,'Prospection') returning id`, [orgC])).rows[0].id;
  await as(C, `insert into public.prospects(organization_id,project_id,name) values($1,$2,'Prospect A'),($1,$2,'Prospect B')`, [orgC, proj]);

  await check('LIST: every organization with its offer, billing state, members and activity; searched by name or owner e-mail', async () => {
    const all = (await as(K, `select public.admin_clients(null,50,0) r`)).rows[0].r;
    assert.equal(all.total, 2);
    const c = all.clients.find(x => x.id === orgC);
    assert.equal(c.name, 'Boulangerie Martin'); assert.equal(c.plan, 'TEAM'); assert.equal(c.seats, 2); assert.equal(c.members, 2);
    assert.equal(c.cancel_at_period_end, true); assert.equal(c.owner_email, 'gerant@boulangerie.test');
    assert.ok(c.last_activity, 'the audit events of its prospects');
    assert.deepEqual((await as(K, `select public.admin_clients('boulang',50,0) r`)).rows[0].r.clients.map(x => x.id), [orgC]);
    assert.deepEqual((await as(K, `select public.admin_clients('cabinet.test',50,0) r`)).rows[0].r.clients.map(x => x.id), [orgD], 'by owner e-mail');
    await refused(() => as(K, `select public.admin_clients($1,50,0)`, ['x'.repeat(81)]), /admin_query_invalid/, 'a query too long');
  });

  await check('SHEET: offer, Stripe ids and state as stored, usage, partner, veille, events of the feed', async () => {
    const s = (await as(K, `select public.admin_client($1) r`, [orgC])).rows[0].r;
    assert.equal(s.organization.name, 'Boulangerie Martin'); assert.equal(s.organization.members, 2);
    assert.equal(s.entitlement.plan, 'TEAM');
    assert.equal(s.billing.customer_id, 'cus_TEST1'); assert.equal(s.billing.cancel_at_period_end, true);
    assert.equal(s.usage.projects, 1); assert.equal(s.usage.prospects, 2); assert.equal(s.usage.searches, 0);
    assert.equal(s.partner, null); assert.deepEqual(s.dedicated, []); assert.deepEqual(s.notes, []);
    assert.ok(s.events.some(e => e.kind === 'SIGNUP'), 'its sign-up, from the feed of 056');
    const d = (await as(K, `select public.admin_client($1) r`, [orgD])).rows[0].r;
    assert.equal(d.entitlement, null); assert.equal(d.billing, null, 'never went through payment');
    await refused(() => as(K, `select public.admin_client($1)`, [uid(0x999)]), /admin_client_not_found/, 'an unknown organization');
  });

  await check('NOTES: timestamped with their author, newest first; append-only for every role, the owner included', async () => {
    await as(K, `select public.admin_add_note($1,'Appel du 26/11 : intéressé par la veille dédiée.')`, [orgC]);
    await as(K, `select public.admin_add_note($1,'  Relancer lundi.  ')`, [orgC]);
    const notes = (await as(K, `select public.admin_client($1) r`, [orgC])).rows[0].r.notes;
    assert.deepEqual(notes.map(n => n.body), ['Relancer lundi.', 'Appel du 26/11 : intéressé par la veille dédiée.']);
    assert.ok(notes.every(n => n.author === 'admin@prospectos.test' && n.created_at));
    await refused(() => as(K, `select public.admin_add_note($1,'   ')`, [orgC]), /check constraint|violates/i, 'an empty note');
    await refused(() => as(K, `select public.admin_add_note($1,$2)`, [orgC, 'x'.repeat(2001)]), /check constraint|violates/i, 'a note too long');
    await refused(() => sql(`update public.admin_notes set body='changé'`), /append-only/, 'the owner changing a note');
    await refused(() => sql(`delete from public.admin_notes`), /append-only/, 'the owner deleting a note');
    await refused(() => sql(`truncate public.admin_notes`), /append-only/, 'the owner truncating the notes');
    assert.equal((await as(K, `select public.admin_clients(null,50,0) r`)).rows[0].r.clients.find(x => x.id === orgC).notes, 2);
  });

  await check('RLS: a client account (even the organization’s own owner) and an anonymous visitor read, call and write nothing', async () => {
    for (const u of [C, M, D]) {
      assert.equal((await as(u, 'select count(*)::int n from public.admin_notes')).rows[0].n, 0, 'no note, not even about its own organization');
      await refused(() => as(u, `select public.admin_clients(null,50,0)`), /Admin access required/, 'a client listing the clients');
      await refused(() => as(u, `select public.admin_client($1)`, [orgC]), /Admin access required/, 'a client reading a sheet');
      await refused(() => as(u, `select public.admin_add_note($1,'x')`, [orgC]), /Admin access required/, 'a client writing a note');
      await refused(() => as(u, `insert into public.admin_notes(organization_id,author_id,body) values($1,$2,'x')`, [orgC, u]), /permission denied/i, 'a direct insert');
    }
    await refused(() => as(undefined, 'select count(*) from public.admin_notes'), /permission denied/i, 'anon reading notes');
    await refused(() => as(undefined, `select public.admin_client($1)`, [orgC]), /permission denied/i, 'anon reading a sheet');
    assert.equal((await as(K, 'select count(*)::int n from public.admin_notes')).rows[0].n, 2, 'the administrator, and only them');
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
