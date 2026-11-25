// Migration 055 — reclassement des reprises et statut des annonces annulées ou rectifiées (owner decision, 25 nov. 2026),
// on real PostgreSQL (PGlite) with the full migration chain: a batch reclassifies sale notices without deleting any row,
// every change is audited with its old value, a batch is reverted exactly (there, back, there again), a cancellation or a
// correction from the collection reaches its notice whatever the order they arrive in, only ACTIVE « rachats » reach a
// client's pool, the INDETERMINE rows are listed for the administrator only, and deliveries and the journal never change.
// WITHOUT_055=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_055 && f.startsWith('055_')));
  assert.ok(process.env.WITHOUT_055 || migrations.includes('055_public_event_reclassification.sql'), 'migration 055 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const K = '00000000-0000-4000-8000-0000000000ad', S = '00000000-0000-4000-8000-0000000000a1', G = '00000000-0000-4000-8000-0000000000b1', H = '00000000-0000-4000-8000-0000000000c1';
  await sql(`insert into auth.users(id,email) values ($1,'admin@test.fr'),($2,'detec@test.fr'),($3,'concurrent@test.fr'),($4,'capston@test.fr')`, [K, S, G, H]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const [o1, o2, o3] = [await org(S), await org(G), await org(H)];
  const pdf = Buffer.from(`%PDF-1.4\n% proposition\n${'x'.repeat(200)}\n%%EOF\n`, 'latin1');
  const sha = createHash('sha256').update(pdf).digest('hex');
  const contract = async (orgId, user, label) => {
    const c = (await as(K, `select public.propose_dedicated_watch($1,$2,9900,17900,15,'2026-11-16','2026-01-01','proposition.pdf',$3) r`, [orgId, label, pdf.toString('base64')])).rows[0].r;
    await as(user, `select public.accept_dedicated_proposal($1,$2)`, [c.id, sha]);
    return c.id;
  };
  const [c1, c2, c3] = [await contract(o1, S, 'Veille Détec'), await contract(o2, G, 'Veille concurrent'), await contract(o3, H, 'Veille Capston')];
  const item = siren => ({ siren, name: `Société ${siren}`, city: 'Pantin', source_label: 'BODACC — vente de fonds', source_url: `https://www.bodacc.fr/annonce/${siren}` });
  const deliver = (contractId, sirens) => as(K, `select public.create_dedicated_delivery($1,'IDF',$2)`, [contractId, JSON.stringify(sirens.map(item))]);
  const today = new Date().toISOString().slice(0, 10);
  const url = id => `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${id}`;
  // Ten sale notices collected before 25 nov. 2026, all stored as VENTE_FONDS, and one head-office move (never a sale).
  const notices = [['A1', '900000001'], ['A2', '900000002'], ['A3', '900000003'], ['A4', '900000004'], ['A5', '900000005'], ['A6', '900000006'],
    ['A7', '900000007'], ['A8', '900000008'], ['A9', '900000009'], ['A10', '900000010']];
  for (const [id, siren] of notices) {
    await sql(`insert into public.public_events(source,source_id,kind,siren,published_on,department,commune,source_url) values('bodacc',$1,'VENTE_FONDS',$2,$3,'93','Pantin',$4)`, [id, siren, today, url(id)]);
    await sql(`insert into public.company_cache(siren,name,naf,legal_form,employee_band,active,individual,opposition,department,commune,expires_at)
      values($1,$2,'56.10A','5710','11',true,false,false,'93','Pantin',now()+interval '30 days')`, [siren, `SOCIETE ${siren}`]);
  }
  await sql(`insert into public.public_events(source,source_id,kind,siren,published_on,department,commune,source_url) values('bodacc','T1','TRANSFERT_SIEGE','900000011',$1,'93','Pantin',$2)`, [today, url('T1')]);
  await as(K, `select public.admin_set_lead_profile($1,'securite-incendie','Sécurité incendie',array['93'],array['VENTE_FONDS','TRANSFERT_SIEGE'],'{}')`, [c1]);
  await deliver(c1, ['900000002']);   // already delivered: must never change
  const pool = async () => (await as(K, `select public.admin_lead_pool($1,60,100) r`, [c1])).rows[0].r.leads.map(l => l.siren);
  const snapshot = async () => (await sql(`select source_id,kind,sale_rule,status,status_source_id,status_url from public.public_events order by source_id`)).rows;
  const deliveries = async () => (await sql(`select md5(coalesce((select string_agg(to_jsonb(i)::text,'|' order by i.id) from public.dedicated_items i),'')
    ||coalesce((select string_agg((to_jsonb(d)-'pdf')::text,'|' order by d.id) from public.dedicated_deliveries d),'')
    ||coalesce((select string_agg(to_jsonb(j)::text,'|' order by j.id) from public.dedicated_journal j),'')) h`)).rows[0].h;
  const before = await snapshot(), deliveredBefore = await deliveries(), countBefore = before.length;
  const B1 = '11111111-1111-4111-8111-111111111111';
  const rows = [{ source_id: 'A2', kind: 'FUSION', rule: 'text_merger' }, { source_id: 'A3', kind: 'APPORT', rule: 'origin_contribution' },
    { source_id: 'A4', kind: 'VENTE_JUDICIAIRE', rule: 'text_forced' }, { source_id: 'A5', kind: 'INDETERMINE', rule: 'no_rule' },
    { source_id: 'A1', kind: 'VENTE_FONDS', rule: 'category_purchase' }, { source_id: 'T1', kind: 'FUSION', rule: 'text_merger' }];
  const sups = [{ target_source_id: 'A6', status: 'ANNULEE', by_source_id: 'X1', by_url: url('X1') },
    { target_source_id: 'A7', status: 'RECTIFIEE', by_source_id: 'R1', by_url: url('R1') },
    { target_source_id: 'A8', status: 'AVIS_ANNULATION', by_source_id: 'A99', by_url: url('A99') }];
  const apply = async () => ({
    k: (await asService(`select public.reclassify_public_events($1,$2) r`, [B1, JSON.stringify(rows)])).rows[0].r,
    s: (await asService(`select public.supersede_public_events($1,$2) r`, [B1, JSON.stringify(sups)])).rows[0].r });

  await check('SERVER ONLY: no browser role reclassifies, supersedes, reverts or reads the audit', async () => {
    await refused(() => as(K, `select public.reclassify_public_events($1,'[]')`, [B1]), /permission denied/i, 'an administrator calling the batch directly');
    await refused(() => as(S, `select public.supersede_public_events($1,'[]')`, [B1]), /permission denied/i, 'a client superseding');
    await refused(() => as(S, `select public.revert_public_event_batch($1)`, [B1]), /permission denied/i, 'a client reverting');
    for (const t of ['public_event_reclassifications', 'public_event_supersessions'])
      await refused(() => as(K, `select * from public.${t}`), /permission denied/i, `reading ${t}`);
  });
  await check('RECLASSIFY: sale notices only, each change audited with its old value, nothing deleted, a replay changes nothing', async () => {
    const r = await apply();
    assert.deepEqual([r.k.changed, r.s.changed], [5, 3], 'A1 → VENTE_FONDS gets its rule; T1 (a head-office move) is never touched');
    const now = Object.fromEntries((await snapshot()).map(x => [x.source_id, x]));
    assert.deepEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'T1'].map(k => now[k].kind), ['VENTE_FONDS', 'FUSION', 'APPORT', 'VENTE_JUDICIAIRE', 'INDETERMINE', 'TRANSFERT_SIEGE']);
    assert.deepEqual([now.A6.status, now.A6.status_url, now.A7.status, now.A8.status, now.A8.status_url], ['ANNULEE', url('X1'), 'RECTIFIEE', 'AVIS_ANNULATION', url('A99')]);
    assert.equal((await snapshot()).length, countBefore, 'no row deleted');
    const audit = (await sql(`select source_id,old_kind,new_kind,old_status,new_status,actor,batch_id from public.public_event_reclassifications order by source_id`)).rows;
    assert.deepEqual(audit.map(a => [a.source_id, a.old_kind, a.new_kind, a.old_status, a.new_status]), [['A1', 'VENTE_FONDS', 'VENTE_FONDS', 'ACTIVE', 'ACTIVE'], ['A2', 'VENTE_FONDS', 'FUSION', 'ACTIVE', 'ACTIVE'],
      ['A3', 'VENTE_FONDS', 'APPORT', 'ACTIVE', 'ACTIVE'], ['A4', 'VENTE_FONDS', 'VENTE_JUDICIAIRE', 'ACTIVE', 'ACTIVE'], ['A5', 'VENTE_FONDS', 'INDETERMINE', 'ACTIVE', 'ACTIVE'],
      ['A6', 'VENTE_FONDS', 'VENTE_FONDS', 'ACTIVE', 'ANNULEE'], ['A7', 'VENTE_FONDS', 'VENTE_FONDS', 'ACTIVE', 'RECTIFIEE'], ['A8', 'VENTE_FONDS', 'VENTE_FONDS', 'ACTIVE', 'AVIS_ANNULATION']]);
    assert.ok(audit.every(a => a.actor === 'batch' && a.batch_id === B1));
    const again = await apply();
    assert.deepEqual([again.k.changed, again.s.changed], [0, 0], 'a replayed batch changes nothing');
    await refused(() => asService(`select public.reclassify_public_events($1,$2)`, [B1, JSON.stringify([{ source_id: 'A1', kind: 'CREATION', rule: 'x' }])]), /Invalid reclassification/, 'a non-sale kind');
    await refused(() => asService(`select public.reclassify_public_events($1,$2)`, [B1, JSON.stringify([{ source_id: 'A1', kind: 'FUSION', rule: 'Jean DUPONT' }])]), /Invalid reclassification/, 'a rule that is not an id');
  });
  await check('EXCLUDED: only ACTIVE « rachats » reach a client\'s pool; deliveries and the journal are unchanged', async () => {
    assert.deepEqual((await pool()).sort(), ['900000001', '900000009', '900000010'],
      'A2 is delivered; A3–A5 are not sales; A6 cancelled, A7 corrected, A8 a notice of cancellation (T1 has no company record yet)');
    assert.equal((await snapshot()).find(x => x.source_id === 'T1').kind, 'TRANSFERT_SIEGE');
    assert.equal(await deliveries(), deliveredBefore, 'dedicated_items, deliveries and journal untouched');
    const c = (await as(K, `select public.admin_company('900000006') r`)).rows[0].r;
    assert.deepEqual([c.events[0].status, c.events[0].status_url], ['ANNULEE', url('X1')], 'the company sheet shows the status and the cancelling notice');
  });
  await check('REVIEW: the INDETERMINE rows, for the administrator only', async () => {
    const r = (await as(K, `select public.admin_events_to_review(50) r`)).rows[0].r;
    assert.deepEqual(r.map(x => [x.source_id, x.sale_rule, x.name]), [['A5', 'no_rule', 'SOCIETE 900000005']]);
    await refused(() => as(S, `select public.admin_events_to_review(50)`), /Admin access required/, 'a client reading the review list');
    await refused(() => as(undefined, `select public.admin_events_to_review(50)`), /permission denied/i, 'anon reading the review list');
  });
  await check('REVERT: there, back, there again — every value put back exactly, the audit kept and stamped', async () => {
    const r = (await asService(`select public.revert_public_event_batch($1) r`, [B1])).rows[0].r;
    assert.equal(r.reverted, 8);
    assert.deepEqual(await snapshot(), before, 'every row exactly as before the batch');
    assert.equal((await sql(`select count(*)::int n from public.public_event_reclassifications where reverted_at is null`)).rows[0].n, 0);
    assert.equal((await sql(`select count(*)::int n from public.public_event_reclassifications`)).rows[0].n, 8, 'the audit keeps every change');
    assert.equal((await sql(`select count(*)::int n from public.public_event_supersessions where reverted_at is null`)).rows[0].n, 0, 'the batch\'s cancellations are withdrawn');
    const B2 = '22222222-2222-4222-8222-222222222222';
    await asService(`select public.reclassify_public_events($1,$2)`, [B2, JSON.stringify(rows)]);
    await asService(`select public.supersede_public_events($1,$2)`, [B2, JSON.stringify(sups)]);
    const after = Object.fromEntries((await snapshot()).map(x => [x.source_id, x]));
    assert.deepEqual([after.A2.kind, after.A6.status, after.A8.status], ['FUSION', 'ANNULEE', 'AVIS_ANNULATION'], 'applied again after the revert');
    assert.equal(await deliveries(), deliveredBefore);
  });
  await check('COLLECT: a cancellation or a correction reaches its notice whatever the order; a cancellation wins; audited as « collect »', async () => {
    const ev = (id, siren) => ({ source_id: id, kind: 'VENTE_FONDS', siren, name: `SOCIETE ${siren}`, published_on: today, department: '93', commune: 'Pantin', postal_code: '93500', activity: 'Restaurant', source_url: url(id), sale_rule: 'category_purchase' });
    const ingest = (events, s) => asService(`select public.ingest_public_events('bodacc',current_date,$1,1,0,'{}'::jsonb,$2) r`, [JSON.stringify(events), JSON.stringify(s)]).then(x => x.rows[0].r);
    // The cancellation arrives first, its notice the night after.
    assert.deepEqual(await ingest([], [{ target_source_id: 'N1', status: 'ANNULEE', by_source_id: 'Z1', by_url: url('Z1') }]), { inserted: 0, superseded: 0 });
    assert.deepEqual(await ingest([ev('N1', '900000021')], []), { inserted: 1, superseded: 1 });
    // A correction, then a cancellation of the same notice.
    await ingest([ev('N2', '900000022')], [{ target_source_id: 'N2', status: 'RECTIFIEE', by_source_id: 'Z2', by_url: url('Z2') }]);
    await ingest([], [{ target_source_id: 'N2', status: 'ANNULEE', by_source_id: 'Z3', by_url: url('Z3') }]);
    const s = Object.fromEntries((await snapshot()).map(x => [x.source_id, x]));
    assert.deepEqual([s.N1.status, s.N1.status_source_id, s.N2.status, s.N2.status_source_id, s.N1.sale_rule], ['ANNULEE', 'Z1', 'ANNULEE', 'Z3', 'category_purchase']);
    assert.deepEqual((await sql(`select source_id,old_status,new_status,actor from public.public_event_reclassifications where actor='collect' order by id`)).rows.map(a => [a.source_id, a.old_status, a.new_status]),
      [['N1', 'ACTIVE', 'ANNULEE'], ['N2', 'ACTIVE', 'RECTIFIEE'], ['N2', 'RECTIFIEE', 'ANNULEE']]);
    assert.ok(!(await pool()).includes('900000021') && !(await pool()).includes('900000022'));
    await refused(() => ingest([], [{ target_source_id: 'N3', status: 'SUPPRIMEE', by_source_id: 'Z4' }]), /Invalid supersessions/, 'an unknown status');
    await refused(() => ingest([{ ...ev('N4', '900000024'), kind: 'RADIATION' }], []), /check constraint|violates/i, 'an unknown kind');
  });
  await check('NOTHING_ELSE: only the event store, its audit and the functions reading it', async () => {
    const m = (await readFile(new URL('../db/migrations/055_public_event_reclassification.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table) public\.(?!(public_events|public_event_runs|public_event_reclassifications|public_event_supersessions)\b)\w+/i);
    assert.doesNotMatch(m, /delete from public\.public_events|drop table|truncate/i, 'nothing is deleted');
    assert.doesNotMatch(m, /create policy|alter policy|drop policy|grant [^;]*(reclassify|supersede|revert|ingest)[^;]* to (anon|authenticated)/i);
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
