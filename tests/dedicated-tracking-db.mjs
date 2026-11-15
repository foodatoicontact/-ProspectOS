// Migration 043 — veille dédiée, suivi au résultat, on real PostgreSQL (PGlite) with the full migration chain:
// a client sees only its own deliveries, items, statements and journal; the administrator (ACTIVE INTERNAL entitlement)
// sees every contract; the journal refuses every UPDATE, DELETE and TRUNCATE and every direct INSERT; DEJA_CLIENT is
// refused after the 15-day window; SIGNE needs the first invoice date; the monthly statement is
// greatest(minimum, commission × signatures) with 0, 1 and 3 signatures, validated once with the attestation sentence.
// WITHOUT_043=1 runs the checks without the migration: they must fail.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const ATTEST = 'J\'atteste l\'exactitude de ce relevé';
// A small but real PDF (the proposal made by `npm run devis` in practice) and its SHA-256 computed here, independently.
const pdfBytes = text => Buffer.from(`%PDF-1.4\n% proposition ${text}\n${'x'.repeat(200)}\n%%EOF\n`, 'latin1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const item = (siren, name) => ({ siren, name, city: 'Meaux', source_label: 'BODACC — création', source_url: `https://www.bodacc.fr/annonce/${siren}` });

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
    .filter(f => !(process.env.WITHOUT_043 && f.startsWith('043_')));
  assert.ok(process.env.WITHOUT_043 || migrations.includes('043_dedicated_tracking.sql'), 'migration 043 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const K = '00000000-0000-4000-8000-0000000000ad'; // the administrator (INTERNAL)
  const S = '00000000-0000-4000-8000-0000000000a1'; // client 1, owner of its organization
  const T = '00000000-0000-4000-8000-0000000000a2'; // a member of client 1's organization
  const G = '00000000-0000-4000-8000-0000000000b1'; // client 2
  const X = '00000000-0000-4000-8000-0000000000c1'; // an ordinary account, no contract
  await sql(`insert into auth.users(id,email) values ($1,'admin@prospectos.test'),($2,'client1@test.fr'),($3,'membre1@test.fr'),($4,'client2@test.fr'),($5,'x@test.fr')`, [K, S, T, G, X]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const org1 = await org(S), org2 = await org(G); await org(X);
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`, [org1, T]);

  let c1, c2, d1, d2, items1, items2;
  const PDF1 = pdfBytes('v1'), PDF2 = pdfBytes('v2');
  const propose = (user, orgId, label, pdf = PDF1) => as(user, `select public.propose_dedicated_watch($1,$2,9900,17900,15,'2026-11-16','2026-01-01','proposition-veille.pdf',$3) r`, [orgId, label, pdf.toString('base64')]);
  await check('PROPOSAL: the administrator attaches a veille to an EXISTING organization, by identifier, with the proposal PDF', async () => {
    await refused(() => propose(S, org1, 'Veille IDF'), /Admin access required/, 'a client proposing');
    await refused(() => propose(undefined, org1, 'Veille IDF'), /permission denied/i, 'anon proposing');
    await refused(() => propose(K, '00000000-0000-4000-8000-00000000dead', 'X'), /dedicated_organization_not_found/, 'an unknown organization');
    await refused(() => as(K, `select public.propose_dedicated_watch($1,'X',9900,17900,15,'2026-11-16','2026-01-01','x.pdf',$2)`, [org1, Buffer.from('not a pdf at all '.repeat(10)).toString('base64')]), /dedicated_proposal_invalid/, 'a file that is not a PDF');
    const found = (await as(K, `select public.dedicated_find_organizations('client1@') r`)).rows[0].r;
    assert.deepEqual(found.map(o => o.id), [org1], 'found by a member address');
    await refused(() => as(S, `select public.dedicated_find_organizations('client')`), /Admin access required/, 'a client searching organizations');
    const users = (await sql(`select count(*)::int n from auth.users`)).rows[0].n;
    c1 = (await propose(K, org1, 'Veille IDF')).rows[0].r;
    c2 = (await propose(K, org2, 'Veille Occitanie')).rows[0].r;
    assert.equal(c1.organization_id, org1); assert.equal(c1.status, 'PROPOSED'); assert.equal(c1.proposal.sha256, sha(PDF1));
    assert.equal((await sql(`select count(*)::int n from auth.users`)).rows[0].n, users, 'no account created');
    assert.equal((await sql(`select count(*)::int n from public.memberships where organization_id=$1`, [org1])).rows[0].n, 2, 'no membership created');
  });

  await check('CLOSED_BEFORE_ACCEPTANCE: before acceptance the client sees the proposal only; no delivery, no action', async () => {
    await refused(() => as(K, `select public.create_dedicated_delivery($1,'IDF',$2)`, [c1.id, JSON.stringify([item('111111111', 'A')])]), /dedicated_contract_not_active/, 'a delivery before acceptance');
    await refused(() => as(S, `select public.export_dedicated_items($1,null,'csv')`, [c1.id]), /dedicated_space_closed/, 'an export before acceptance');
    const seen = (await as(S, `select status from public.dedicated_contracts`)).rows; assert.deepEqual(seen.map(r => r.status), ['PROPOSED']);
    assert.equal((await as(S, `select count(*)::int n from public.dedicated_proposals`)).rows[0].n, 1, 'the proposal is visible');
    assert.equal((await as(S, `select count(*)::int n from public.dedicated_deliveries`)).rows[0].n, 0);
  });

  await check('ACCEPTANCE: refused for a non-member and for a stale version; journaled with user, time and the SHA-256 of the accepted PDF', async () => {
    await refused(() => as(G, `select public.accept_dedicated_proposal($1,$2)`, [c1.id, sha(PDF1)]), /dedicated_contract_not_found/, 'another client accepting');
    await refused(() => as(X, `select public.accept_dedicated_proposal($1,$2)`, [c1.id, sha(PDF1)]), /dedicated_contract_not_found/, 'a stranger accepting');
    await refused(() => as(K, `select public.accept_dedicated_proposal($1,$2)`, [c1.id, sha(PDF1)]), /dedicated_contract_not_found/, 'the administrator accepting for the client');
    // A new version replaces the first one: the old fingerprint no longer opens the space.
    const v2 = (await as(K, `select public.replace_dedicated_proposal($1,'proposition-veille-v2.pdf',$2) r`, [c1.id, PDF2.toString('base64')])).rows[0].r;
    assert.deepEqual([v2.version, v2.sha256], [2, sha(PDF2)]);
    await refused(() => as(S, `select public.accept_dedicated_proposal($1,$2)`, [c1.id, sha(PDF1)]), /dedicated_proposal_changed/, 'accepting a replaced version');
    const r = (await as(T, `select public.accept_dedicated_proposal($1,$2) r`, [c1.id, sha(PDF2)])).rows[0].r;
    assert.equal(r.status, 'ACTIVE'); assert.equal(r.trial_starts_on, '2026-11-16'); assert.equal(r.version, 2);
    const j = (await as(S, `select actor_id,detail,created_at from public.dedicated_journal where kind='PROPOSAL_ACCEPTED' and contract_id=$1`, [c1.id])).rows;
    assert.equal(j.length, 1); assert.equal(j[0].actor_id, T); assert.ok(j[0].created_at);
    const stored = (await sql(`select pdf from public.dedicated_proposals where contract_id=$1 and version=2`, [c1.id])).rows[0].pdf;
    assert.equal(j[0].detail.sha256, sha(Buffer.from(stored)), 'the journal fingerprint is the stored PDF’s');
    assert.equal(j[0].detail.sha256, sha(PDF2), 'and the PDF the client was shown');
    assert.equal((await sql(`select accepted_sha256 from public.dedicated_contracts where id=$1`, [c1.id])).rows[0].accepted_sha256, sha(PDF2));
    await refused(() => as(S, `select public.accept_dedicated_proposal($1,$2)`, [c1.id, sha(PDF2)]), /dedicated_proposal_already_accepted/, 'a second acceptance');
    await refused(() => as(K, `select public.replace_dedicated_proposal($1,'v3.pdf',$2)`, [c1.id, PDF1.toString('base64')]), /dedicated_proposal_already_accepted/, 'replacing an accepted proposal');
    await as(G, `select public.accept_dedicated_proposal($1,$2)`, [c2.id, sha(PDF1)]);
  });

  await check('ADMIN_ONLY_SETUP: only the administrator delivers; numbering per contract; a SIREN delivered once', async () => {
    await refused(() => as(S, `select public.create_dedicated_delivery($1,'IDF',$2)`, [c1.id, JSON.stringify([item('111111111', 'A')])]), /Admin access required/, 'a client creating a delivery');
    d1 = (await as(K, `select public.create_dedicated_delivery($1,'Île-de-France — créations',$2) r`, [c1.id, JSON.stringify(['111111111', '222222222', '333333333', '444444444', '555555555'].map((s, i) => item(s, `ENTREPRISE ${i + 1}`)))])).rows[0].r;
    assert.equal(d1.number, 1); assert.equal(d1.items, 5);
    const again = (await as(K, `select public.create_dedicated_delivery($1,'Île-de-France — semaine 2',$2) r`, [c1.id, JSON.stringify([item('111111111', 'DOUBLON'), item('666666666', 'ENTREPRISE 6')])])).rows[0].r;
    assert.equal(again.number, 2); assert.equal(again.items, 1); assert.deepEqual(again.skipped_sirens, ['111111111']);
    d2 = (await as(K, `select public.create_dedicated_delivery($1,'Occitanie',$2) r`, [c2.id, JSON.stringify([item('999999999', 'SECRET DU CLIENT 2')])])).rows[0].r;
    assert.equal(d2.number, 1, 'numbering is per contract');
    items1 = (await sql(`select id,reference,siren from public.dedicated_items where contract_id=$1 order by reference`, [c1.id])).rows;
    items2 = (await sql(`select id from public.dedicated_items where contract_id=$1`, [c2.id])).rows;
    assert.deepEqual(items1.map(r => r.reference), ['L1-F001', 'L1-F002', 'L1-F003', 'L1-F004', 'L1-F005', 'L2-F001']);
    await refused(() => as(K, `select public.create_dedicated_delivery($1,'X',$2)`, [c1.id, JSON.stringify([{ ...item('12345', 'Bad') }])]), /check constraint|violates/i, 'a malformed SIREN');
    await refused(() => as(K, `select public.create_dedicated_delivery($1,'X',$2)`, [c1.id, JSON.stringify([{ ...item('777777777', 'Bad'), source_url: 'javascript:alert(1)' }])]), /check constraint|violates/i, 'a non-https source');
  });

  await check('ISOLATION: a client sees neither the deliveries, items, statements nor journal of another client', async () => {
    for (const t of ['dedicated_contracts', 'dedicated_deliveries', 'dedicated_items', 'dedicated_journal']) {
      const mine = (await as(S, `select distinct organization_id from public.${t}`)).rows.map(r => r.organization_id);
      assert.deepEqual(mine, [org1], `${t}: client 1 sees only its organization`);
      const theirs = (await as(G, `select distinct organization_id from public.${t}`)).rows.map(r => r.organization_id);
      assert.deepEqual(theirs, [org2], `${t}: client 2 sees only its organization`);
      assert.equal((await as(X, `select count(*)::int n from public.${t}`)).rows[0].n, 0, `${t}: an account without contract sees nothing`);
      assert.equal((await as(T, `select count(*)::int n from public.${t} where organization_id=$1`, [org1])).rows[0].n > 0, true, `${t}: a member of client 1 sees client 1`);
    }
    assert.equal((await as(S, `select count(*)::int n from public.dedicated_items where name='SECRET DU CLIENT 2'`)).rows[0].n, 0);
    await refused(() => as(S, `select public.open_dedicated_item($1)`, [items2[0].id]), /dedicated_item_not_found/, 'client 1 opening an item of client 2');
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'CONTACTE')`, [items2[0].id]), /dedicated_item_not_found/, 'client 1 changing an item of client 2');
    await refused(() => as(S, `select public.export_dedicated_items($1,null,'csv')`, [c2.id]), /dedicated_contract_not_found/, 'client 1 exporting client 2');
    await refused(() => as(undefined, `select * from public.dedicated_items`), /permission denied/i, 'anon reading items');
    const admin = (await as(K, `select count(distinct organization_id)::int n from public.dedicated_items`)).rows[0].n;
    assert.equal(admin, 2, 'the administrator sees every client');
  });

  await check('NO_DIRECT_WRITE: no browser role writes the tables directly', async () => {
    await refused(() => as(S, `update public.dedicated_items set status='SIGNE' where id=$1`, [items1[0].id]), /permission denied/i, 'a direct status update');
    await refused(() => as(S, `insert into public.dedicated_deliveries(contract_id,organization_id,number,delivered_on,scope,created_by) values($1,$2,9,current_date,'x',$3)`, [c1.id, org1, S]), /permission denied/i, 'a direct delivery insert');
    await refused(() => as(K, `delete from public.dedicated_items where id=$1`, [items1[0].id]), /permission denied/i, 'the administrator deleting an item directly');
  });

  await check('JOURNAL: open, export and status changes are journaled with the user and time', async () => {
    await as(S, `select public.open_dedicated_item($1)`, [items1[0].id]);
    const exp = (await as(T, `select public.export_dedicated_items($1,$2,'csv') r`, [c1.id, d1.id])).rows[0].r;
    assert.equal(exp.rows.length, 5); assert.equal(exp.rows[0].reference, 'L1-F001'); assert.equal(exp.rows[0].delivery_number, 1);
    await as(S, `select public.set_dedicated_item_status($1,'CONTACTE')`, [items1[0].id]);
    const j = (await as(S, `select kind,actor_id,item_id,detail,created_at from public.dedicated_journal where organization_id=$1 order by id`, [org1])).rows;
    const kinds = j.map(r => r.kind);
    for (const k of ['PROPOSAL_SENT', 'PROPOSAL_ACCEPTED', 'DELIVERY_CREATED', 'ITEM_OPENED', 'EXPORT', 'STATUS_CHANGED']) assert.ok(kinds.includes(k), k);
    const opened = j.find(r => r.kind === 'ITEM_OPENED'); assert.equal(opened.actor_id, S); assert.equal(opened.item_id, items1[0].id); assert.ok(opened.created_at);
    const exported = j.find(r => r.kind === 'EXPORT'); assert.equal(exported.actor_id, T); assert.equal(exported.detail.count, 5); assert.equal(exported.detail.item_ids.length, 5);
    const changed = j.find(r => r.kind === 'STATUS_CHANGED'); assert.deepEqual([changed.detail.from, changed.detail.to, changed.actor_id], ['A_CONTACTER', 'CONTACTE', S]);
  });

  await check('APPEND_ONLY: the journal refuses every modification and deletion, for every role', async () => {
    const id = (await sql(`select id from public.dedicated_journal order by id limit 1`)).rows[0].id;
    await refused(() => as(S, `update public.dedicated_journal set detail='{}' where id=$1`, [id]), /permission denied|append-only/i, 'a client updating the journal');
    await refused(() => as(S, `delete from public.dedicated_journal where id=$1`, [id]), /permission denied|append-only/i, 'a client deleting the journal');
    await refused(() => as(S, `insert into public.dedicated_journal(organization_id,kind) values($1,'EXPORT')`, [org1]), /permission denied/i, 'a client forging a journal entry');
    await refused(() => as(K, `delete from public.dedicated_journal where id=$1`, [id]), /permission denied|append-only/i, 'the administrator deleting the journal');
    await refused(() => asService(`update public.dedicated_journal set actor_id=null where id=$1`, [id]), /permission denied|append-only/i, 'the server updating the journal');
    await refused(() => sql(`update public.dedicated_journal set detail='{}' where id=$1`, [id]), /append-only/, 'the table owner updating the journal');
    await refused(() => sql(`delete from public.dedicated_journal where id=$1`, [id]), /append-only/, 'the table owner deleting the journal');
    await refused(() => sql(`truncate public.dedicated_journal cascade`), /append-only/, 'the table owner truncating the journal');
  });

  await check('KNOWN_CLIENT: « déjà client » within 15 days with a dated proof; refused after', async () => {
    const proof = JSON.stringify({ kind: 'facture', dated_on: '2025-03-02', reference: 'Facture F-2025-031' });
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'DEJA_CLIENT')`, [items1[1].id]), /known_proof_required/, 'déjà client without proof');
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'DEJA_CLIENT',null,$2)`, [items1[1].id, JSON.stringify({ kind: 'facture', dated_on: '2099-01-01', reference: 'Facture future' })]), /known_proof_required/, 'a proof dated after the delivery');
    const ok = (await as(S, `select public.set_dedicated_item_status($1,'DEJA_CLIENT',null,$2) r`, [items1[1].id, proof])).rows[0].r;
    assert.equal(ok.status, 'DEJA_CLIENT');
    assert.equal((await sql(`select known_proof->>'reference' r from public.dedicated_items where id=$1`, [items1[1].id])).rows[0].r, 'Facture F-2025-031');
    // Day 15 is still open, day 16 is closed (Paris date).
    await sql(`update public.dedicated_items set delivered_on=prospectos_private.paris_today()-15 where id=$1`, [items1[2].id]);
    await as(S, `select public.set_dedicated_item_status($1,'DEJA_CLIENT',null,$2)`, [items1[2].id, proof]);
    await sql(`update public.dedicated_items set delivered_on=prospectos_private.paris_today()-16 where id=$1`, [items1[3].id]);
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'DEJA_CLIENT',null,$2)`, [items1[3].id, proof]), /known_window_closed/, 'déjà client on day 16');
    assert.equal((await sql(`select status from public.dedicated_items where id=$1`, [items1[3].id])).rows[0].status, 'A_CONTACTER');
  });

  await check('SIGNED: « signé » requires the date of the first invoice, between delivery and today', async () => {
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'SIGNE')`, [items1[4].id]), /first_invoice_required/, 'signé without invoice date');
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'SIGNE',prospectos_private.paris_today()+1)`, [items1[4].id]), /first_invoice_required/, 'an invoice in the future');
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'SIGNE','2000-01-01')`, [items1[4].id]), /first_invoice_required/, 'an invoice before the delivery');
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'GAGNE')`, [items1[4].id]), /dedicated_status_invalid/, 'an unknown status');
  });

  await check('STATEMENT: max(99 €, 179 € × signatures) with 0, 1 and 3 signatures; generated once; server only', async () => {
    const month = (n) => sql(`select (date_trunc('month',prospectos_private.paris_today()::timestamp)-make_interval(months=>$1))::date m`, [n]).then(r => r.rows[0].m.toISOString().slice(0, 10));
    const [m3, m2, m1] = [await month(3), await month(2), await month(1)];
    await refused(() => as(K, `select public.generate_dedicated_statements($1)`, [m1]), /permission denied/i, 'the administrator generating from the browser');
    await refused(() => asService(`select public.generate_dedicated_statements(date_trunc('month',now())::date)`), /Invalid statement month/, 'the current month');
    // Month -3: no signature → the minimum.
    const g3 = (await asService(`select public.generate_dedicated_statements($1) r`, [m3])).rows[0].r; assert.equal(g3.generated, 2);
    const s0 = (await sql(`select signed_count,amount_ht_cents from public.dedicated_statements where contract_id=$1 and month=$2`, [c1.id, m3])).rows[0];
    assert.deepEqual([s0.signed_count, s0.amount_ht_cents], [0, 9900]);
    // Month -2: one signature → max(9900, 17900) = 17900.
    const sign = async (id, at) => {
      await sql(`update public.dedicated_items set delivered_on=$2::date-20 where id=$1`, [id, at]);
      await as(S, `select public.set_dedicated_item_status($1,'SIGNE',$2::date-1)`, [id, at]);
      await sql(`update public.dedicated_items set signed_at=($2::date+interval '10 hours') at time zone 'Europe/Paris' where id=$1`, [id, at]);
    };
    await sign(items1[0].id, m2);
    await asService(`select public.generate_dedicated_statements($1)`, [m2]);
    const s1 = (await sql(`select signed_count,amount_ht_cents,items from public.dedicated_statements where contract_id=$1 and month=$2`, [c1.id, m2])).rows[0];
    assert.deepEqual([s1.signed_count, s1.amount_ht_cents, s1.items[0].reference], [1, 17900, 'L1-F001']);
    // Month -1: three signatures → 3 × 17900 = 53700.
    for (const it of [items1[3], items1[4], items1[5]]) await sign(it.id, m1);
    await asService(`select public.generate_dedicated_statements($1)`, [m1]);
    const s3 = (await sql(`select signed_count,amount_ht_cents from public.dedicated_statements where contract_id=$1 and month=$2`, [c1.id, m1])).rows[0];
    assert.deepEqual([s3.signed_count, s3.amount_ht_cents], [3, 53700]);
    // Idempotent; a signature is never counted twice; a counted item no longer changes.
    assert.equal((await asService(`select public.generate_dedicated_statements($1) r`, [m1])).rows[0].r.generated, 0);
    assert.equal((await sql(`select count(*)::int n from public.dedicated_statements where contract_id=$1`, [c1.id])).rows[0].n, 3);
    await refused(() => as(S, `select public.set_dedicated_item_status($1,'PERDU')`, [items1[0].id]), /item_in_statement/, 'changing a counted signature');
    // The database refuses an inconsistent amount whoever writes it.
    await refused(() => sql(`update public.dedicated_statements set amount_ht_cents=1 where contract_id=$1 and month=$2`, [c1.id, m1]), /check constraint/i, 'a falsified amount');
  });

  await check('VALIDATION: once, by the client, with the attestation sentence; journaled; reminders only for unvalidated ones', async () => {
    const st = (await sql(`select id,month from public.dedicated_statements where contract_id=$1 order by month desc`, [c1.id])).rows;
    assert.deepEqual((await as(G, `select distinct organization_id from public.dedicated_statements`)).rows.map(r => r.organization_id), [org2], 'client 2 sees only its statements');
    assert.deepEqual((await as(S, `select distinct organization_id from public.dedicated_statements`)).rows.map(r => r.organization_id), [org1], 'client 1 sees only its statements');
    assert.equal((await as(K, `select count(distinct organization_id)::int n from public.dedicated_statements`)).rows[0].n, 2, 'the administrator sees every statement');
    await refused(() => as(S, `select public.validate_dedicated_statement($1,'ok')`, [st[0].id]), /attestation_required/, 'a validation without the sentence');
    await refused(() => as(G, `select public.validate_dedicated_statement($1,$2)`, [st[0].id, ATTEST]), /dedicated_statement_not_found/, 'client 2 validating client 1');
    await refused(() => as(K, `select public.validate_dedicated_statement($1,$2)`, [st[0].id, ATTEST]), /dedicated_statement_not_found/, 'the administrator validating for the client');
    await as(S, `select public.validate_dedicated_statement($1,$2)`, [st[0].id, ATTEST]);
    await refused(() => as(T, `select public.validate_dedicated_statement($1,$2)`, [st[0].id, ATTEST]), /statement_already_validated/, 'a second validation');
    const v = (await as(S, `select actor_id,detail from public.dedicated_journal where kind='STATEMENT_VALIDATED' and statement_id=$1`, [st[0].id])).rows[0];
    assert.equal(v.actor_id, S); assert.equal(v.detail.attestation, ATTEST); assert.equal(v.detail.amount_ht_cents, 53700);
    await refused(() => as(K, `select public.claim_dedicated_reminders()`), /permission denied/i, 'claiming reminders from the browser');
    const claimed = (await asService(`select public.claim_dedicated_reminders() r`)).rows[0].r;
    // Months -3 and -2 of both clients are past their 5th and not validated; month -1 of client 1 is validated.
    const ids = claimed.map(r => r.id);
    assert.ok(!ids.includes(st[0].id), 'a validated statement is never reminded');
    assert.ok(ids.includes(st[2].id), 'an old unvalidated statement is reminded');
    assert.equal((await asService(`select public.claim_dedicated_reminders() r`)).rows[0].r.length, 0, 'claimed once');
    await asService(`select public.release_dedicated_reminder($1)`, [st[2].id]);
    assert.equal((await asService(`select public.claim_dedicated_reminders() r`)).rows[0].r.length, 1, 'a released reminder is claimed again');
  });

  await check('ADMIN_OVERVIEW: the administrator only; facts for every client', async () => {
    await refused(() => as(S, `select public.dedicated_admin_overview()`), /Admin access required/, 'a client reading the overview');
    const o = (await as(K, `select public.dedicated_admin_overview() r`)).rows[0].r;
    assert.equal(o.length, 2);
    const one = o.find(x => x.contract.id === c1.id);
    assert.equal(one.items.length, 6); assert.equal(one.statements.length, 3);
    const first = one.items.find(i => i.reference === 'L1-F001');
    assert.equal(first.opened, true); assert.ok(first.first_export_at); assert.ok(first.reached.CONTACTE); assert.ok(first.reached.SIGNE);
  });

  await check('DOCUMENT_DELIVERY: the delivered PDF and its cards, numbered in the document’s order; a re-delivered SIREN is refused', async () => {
    const PDF = pdfBytes('livraison 3');
    const card = (siren, name, n) => ({ ...item(siren, name), section_key: 'tr', badge: 'BODACC', event_date: '2026-11-06', event_label: '6 novembre 2026', department: '93',
      chips: [`Activité ${n} · 10 à 19 salariés`], fact: 'Transfert du siège social.', why_now: 'De nouveaux locaux.', hook: `Accroche ${n}` });
    const header = { prepared_for: 'Client 1', eyebrow: 'Île-de-France · 16 novembre 2026', lead: 'Lead', title_count: 2 };
    const sections = [{ key: 'tr', title: 'Entreprises qui déménagent', subtitle: 'transfert de siège', source: 'BODACC — annonces légales', color: '#5b8def', badge: 'BODACC' }];
    await refused(() => as(K, `select public.create_dedicated_delivery($1,'Semaine 47',$2,$3,$4,$5,'liste.pdf')`, [c1.id, JSON.stringify([card('777777771', 'NOUVELLE A', 1), card('111111111', 'DÉJÀ LIVRÉE', 2)]), header, JSON.stringify(sections), PDF.toString('base64')]),
      /dedicated_siren_already_delivered: 111111111/, 'a SIREN already delivered, with a PDF whose numbering must hold');
    const d = (await as(K, `select public.create_dedicated_delivery($1,'Semaine 47',$2,$3,$4,$5,'liste.pdf') r`, [c1.id, JSON.stringify([card('777777771', 'NOUVELLE A', 1), card('777777772', 'NOUVELLE B', 2)]), header, JSON.stringify(sections), PDF.toString('base64')])).rows[0].r;
    assert.equal(d.pdf_sha256, sha(PDF));
    const rows = (await as(S, `select reference,name,chips,hook,event_label,department from public.dedicated_items where delivery_id=$1 order by position`, [d.id])).rows;
    assert.deepEqual(rows.map(r => [r.reference, r.name, r.hook]), [[`L${d.number}-F001`, 'NOUVELLE A', 'Accroche 1'], [`L${d.number}-F002`, 'NOUVELLE B', 'Accroche 2']]);
    assert.deepEqual(rows[0].chips, ['Activité 1 · 10 à 19 salariés']);
    const del = (await as(S, `select header,sections,pdf_sha256,pdf from public.dedicated_deliveries where id=$1`, [d.id])).rows[0];
    assert.equal(del.header.prepared_for, 'Client 1'); assert.equal(del.sections[0].key, 'tr');
    assert.equal(sha(Buffer.from(del.pdf)), del.pdf_sha256, 'the stored PDF is the one sent');
    const exp = (await as(S, `select public.export_dedicated_items($1,$2,'pdf') r`, [c1.id, d.id])).rows[0].r.rows;
    assert.deepEqual([exp[0].hook, exp[0].event_label, exp[0].badge], ['Accroche 1', '6 novembre 2026', 'BODACC']);
    await refused(() => as(K, `select public.create_dedicated_delivery($1,'X',$2,null,null,$3,'x.pdf')`, [c1.id, JSON.stringify([card('777777779', 'Z', 9)]), Buffer.from('nope'.repeat(40)).toString('base64')]), /dedicated_delivery_pdf_invalid/, 'a file that is not a PDF');
  });

  await check('SUBSCRIPTION_INDEPENDENT: an expired trial or a cancelled subscription changes nothing to the veille', async () => {
    await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'BETA','EXPIRED',now()-interval '60 days',now()-interval '30 days',now())`, [S]);
    const it = (await sql(`select id from public.dedicated_items where contract_id=$1 and statement_id is null order by reference limit 1`, [c1.id])).rows[0];
    await as(S, `select public.open_dedicated_item($1)`, [it.id]);
    await as(S, `select public.set_dedicated_item_status($1,'CONTACTE')`, [it.id]);
    assert.equal((await as(S, `select public.export_dedicated_items($1,null,'pdf') r`, [c1.id])).rows[0].r.rows.length, 8);
    assert.equal((await as(S, `select count(*)::int n from public.dedicated_items`)).rows[0].n, 8, 'still readable');
    const m = (await readFile(new URL('../db/migrations/043_dedicated_tracking.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m.replace(/create or replace function prospectos_private\.is_internal_admin[\s\S]*?\$\$;/, ''), /account_entitlements|stripe|billing|subscription/i, 'no access rule reads a subscription (the admin check aside)');
  });

  await check('TERMINATION: no new delivery; reading and status updates for 6 months, then closed; statements without minimum after', async () => {
    const orgX = (await sql(`select organization_id from public.memberships where user_id=$1`, [X])).rows[0].organization_id;
    const c3 = (await propose(K, orgX, 'Veille Nord')).rows[0].r;
    await as(X, `select public.accept_dedicated_proposal($1,$2)`, [c3.id, sha(PDF1)]);
    await as(K, `select public.create_dedicated_delivery($1,'Nord',$2)`, [c3.id, JSON.stringify([item('888888881', 'NORD UN'), item('888888882', 'NORD DEUX')])]);
    await refused(() => as(S, `select public.terminate_dedicated_contract($1)`, [c3.id]), /Admin access required/, 'a client terminating');
    const t = (await as(K, `select public.terminate_dedicated_contract($1) r`, [c3.id])).rows[0].r;
    assert.equal(t.status, 'TERMINATED');
    await refused(() => as(K, `select public.create_dedicated_delivery($1,'Nord',$2)`, [c3.id, JSON.stringify([item('888888883', 'NORD TROIS')])]), /dedicated_contract_not_active/, 'a delivery after termination');
    const [n1, n2] = (await sql(`select id from public.dedicated_items where contract_id=$1 order by reference`, [c3.id])).rows.map(r => r.id);
    await as(X, `select public.set_dedicated_item_status($1,'SIGNE',prospectos_private.paris_today())`, [n1]);
    assert.equal((await as(X, `select count(*)::int n from public.dedicated_items`)).rows[0].n, 2, 'readable during the 6 months');
    // Months after the termination month: commissions only (no minimum), and no statement without a signature.
    await sql(`update public.dedicated_contracts set terminated_at=now()-interval '2 months' where id=$1`, [c3.id]);
    await sql(`update public.dedicated_items set signed_at=(date_trunc('month',now())-interval '1 month'+interval '3 days') where id=$1`, [n1]);
    const prev = (await sql(`select (date_trunc('month',prospectos_private.paris_today()::timestamp)-interval '1 month')::date m`)).rows[0].m.toISOString().slice(0, 10);
    await asService(`select public.generate_dedicated_statements($1)`, [prev]);
    const st = (await sql(`select minimum_ht_cents,amount_ht_cents,signed_count from public.dedicated_statements where contract_id=$1 and month=$2`, [c3.id, prev])).rows[0];
    assert.deepEqual([st.minimum_ht_cents, st.amount_ht_cents, st.signed_count], [0, 17900, 1]);
    // Six months later: closed for the client, still visible to the administrator.
    await sql(`update public.dedicated_contracts set terminated_at=now()-interval '7 months' where id=$1`, [c3.id]);
    assert.equal((await as(X, `select count(*)::int n from public.dedicated_items`)).rows[0].n, 0, 'no longer readable after 6 months');
    assert.equal((await as(X, `select count(*)::int n from public.dedicated_contracts`)).rows[0].n, 0);
    await refused(() => as(X, `select public.set_dedicated_item_status($1,'PERDU')`, [n2]), /dedicated_space_closed/, 'a status update after 6 months');
    assert.equal((await as(K, `select count(*)::int n from public.dedicated_items where contract_id=$1`, [c3.id])).rows[0].n, 2, 'the administrator still sees it');
  });

  await check('NOTHING_ELSE: no existing table, policy or function is touched', async () => {
    const m = (await readFile(new URL('../db/migrations/043_dedicated_tracking.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /(insert into|update|delete from|alter table|on) public\.(evidence|prospect_observations|signals|prospects|projects|account_entitlements|memberships|organizations|events|billing\w*)\b(?!\(id\))/i);
    assert.doesNotMatch(m, /stripe|VERIFIED/i);
  });

  await check('IDEMPOTENT: re-applying migration 043 changes nothing', async () => {
    const before = (await sql(`select count(*)::int n from public.dedicated_journal`)).rows[0].n;
    if (!process.env.WITHOUT_043) await db.exec(await readFile(new URL('../db/migrations/043_dedicated_tracking.sql', import.meta.url), 'utf8'));
    assert.equal((await sql(`select count(*)::int n from public.dedicated_journal`)).rows[0].n, before);
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
