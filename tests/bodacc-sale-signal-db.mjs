// Migration 051 (audit 2026-11-11, B8) — a company added from « Reprises de commerces » keeps its official announcement as
// one PENDING_REVIEW signal on its record, through save_signals; nothing becomes verified; other results add nothing.
// WITHOUT_051=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_051 && f.startsWith('051_')));
  assert.ok(process.env.WITHOUT_051 || migrations.includes('051_bodacc_sale_signal.sql'), 'migration 051 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  const B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@test'),($2,'b@test')`, [A, B]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const project = async (user, o) => (await as(user, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [o])).rows[0].id;
  const ctx = {};
  for (const [k, u] of Object.entries({ A, B })) { const o = await org(u); ctx[k] = { user: u, org: o, project: await project(u, o) }; }
  await sql('update prospectos_private.discovery_quota_settings set runs_per_hour=1000, analyses_per_hour=1000, analyses_per_user_per_hour=1000, ai_offer_per_hour=1000');
  for (const u of [A, B]) await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at) values ($1,'BETA','ACTIVE',now()-interval '1 minute',now()+interval '7 days') on conflict (user_id) do update set plan='BETA',status='ACTIVE'`, [u]);
  const start = (c, provider) => as(c.user, `select public.start_discovery($1,'reprises','Haute-Garonne (31)','["restaurant"]',$2,20,'{}'::jsonb) run`, [c.project, provider]).then(r => r.rows[0].run);
  const billed = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery' and billable`, [user])).rows[0].n);
  const used = async user => Number((await sql(`select count(*) n from prospectos_private.discovery_quota_usage where user_id=$1 and action='discovery'`, [user])).rows[0].n);

  const URL1 = 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A20260208360';
  const sale = { notice_id: 'A20260208360', published: '2026-10-29', category: 'Ventes et cessions', activity: 'restauration traditionnelle', trade_name: 'Le Bistrot', establishment: null, city: "L'Isle-en-Dodon", postal_code: '31230' };
  const row = (over = {}) => ({ company_name: 'NB2M', website: null, city: "L'Isle-en-Dodon", source_url: URL1, source_title: 'Reprise publiée au BODACC le 29 octobre 2026 : restauration traditionnelle',
    normalized_payload: { name: 'NB2M', raw_metadata: { siren: '106463037', source_class: 'COMPANY_CANDIDATE', source_type: 'legal_announcement', bodacc_sale: sale } },
    dedupe_key: 'siren:106463037', dedupe_status: 'unique', source_class: 'COMPANY_CANDIDATE', ...over });
  const saveRows = async (provider, rows) => { const run = await start(ctx.A, provider); return (await asService('select * from public.save_discovery_results($1,$2,$3::jsonb)', [A, run.id, JSON.stringify(rows)])).rows; };
  const accept = id => as(A, `select public.accept_discovery_result($1) r`, [id]).then(r => r.rows[0].r);
  const signalsOf = pid => sql(`select provider,signal_type,status,source_type,source_url,excerpt,published_at::date::text d,purge_after is not null purge from public.signals where prospect_id=$1`, [pid]).then(r => r.rows);

  let prospectId;
  await check('B8_SIGNAL: adding a BODACC sale keeps its announcement as ONE signal to review, with the official source', async () => {
    const [r] = await saveRows('bodacc_sales', [row()]);
    prospectId = (await accept(r.id)).id;
    const s = await signalsOf(prospectId);
    assert.equal(s.length, 1);
    assert.deepEqual({ ...s[0] }, { provider: 'bodacc', signal_type: 'acquisition', status: 'PENDING_REVIEW', source_type: 'legal_announcement', source_url: URL1,
      excerpt: "Reprise de fonds publiée au BODACC le 29/10/2026 : restauration traditionnelle, enseigne Le Bistrot, L'Isle-en-Dodon.", d: '2026-10-29', purge: true });
  });
  await check('ONCE: accepting again, or the same announcement from another search, adds nothing', async () => {
    const id = (await sql(`select id from public.discovery_results where prospect_id=$1`, [prospectId])).rows[0].id;
    await accept(id);
    const [r2] = await saveRows('bodacc_sales', [row({ dedupe_status: 'duplicate_candidate' })]);
    await sql(`update public.discovery_results set duplicate_of=$1 where id=$2`, [prospectId, r2.id]);
    await accept(r2.id);
    assert.equal((await signalsOf(prospectId)).length, 1);
  });
  await check('ONLY SALES: a register result, or a result without its announcement, adds no signal', async () => {
    const [reg] = await saveRows('registry', [{ ...row({ source_url: 'https://annuaire-entreprises.data.gouv.fr/entreprise/552100554', dedupe_key: 'siren:552100554', company_name: 'AUTRE' }),
      normalized_payload: { name: 'AUTRE', raw_metadata: { source_class: 'COMPANY_CANDIDATE', source_type: 'public_registry', registry: { siren: '552100554' } } } }]);
    assert.equal((await signalsOf((await accept(reg.id)).id)).length, 0);
    const [bare] = await saveRows('bodacc_sales', [{ ...row({ dedupe_key: 'siren:111222333', company_name: 'SANS ANNONCE' }), normalized_payload: { name: 'SANS ANNONCE', raw_metadata: { siren: '111222333', source_class: 'COMPANY_CANDIDATE', source_type: 'legal_announcement' } } }]);
    assert.equal((await signalsOf((await accept(bare.id)).id)).length, 0);
  });
  await check('NOTHING_ELSE: one trigger on discovery_results; signals written only through save_signals', async () => {
    const m = (await readFile(new URL('../db/migrations/051_bodacc_sale_signal.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(m, /\b(insert into|update|delete from|alter table) public\.\w+/i);
    assert.deepEqual([...m.matchAll(/create trigger (\w+) after update of status on public\.(\w+)/gi)].map(x => x.slice(1)), [['discovery_results_sale_signal', 'discovery_results']]);
    assert.match(m, /perform public\.save_signals\(/);
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
