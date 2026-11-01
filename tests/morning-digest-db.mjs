// Migration 040 — the morning recap email, on real PostgreSQL (PGlite) with the full migration chain: off by default,
// only the member's own choice turns it on (consent recorded), RLS shows each member only their own row and no direct
// write, the server claims each subscriber once a day, lists only PENDING_REVIEW signals of the member's own
// organizations since the last check, records the result, and unsubscribes in one call; account deletion removes it.
// WITHOUT_040=1 runs the checks without the migration: they must fail.
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
    .filter(f => !(process.env.WITHOUT_040 && f.startsWith('040_')));
  assert.ok(process.env.WITHOUT_040 || migrations.includes('040_morning_digest.sql'), 'migration 040 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));

  const A = '00000000-0000-4000-8000-0000000000a1';
  const B = '00000000-0000-4000-8000-0000000000b1';
  await sql(`insert into auth.users(id,email) values ($1,'a@client.fr'),($2,'b@client.fr')`, [A, B]);
  const org = async user => (await as(user, `select public.create_organization('Org') id`)).rows[0].id;
  const ctx = {};
  for (const [k, u] of Object.entries({ A, B })) {
    const o = await org(u);
    const p = (await as(u, `insert into public.projects(organization_id,name) values($1,'Agences web') returning id`, [o])).rows[0].id;
    const pr = (await sql(`insert into public.prospects(organization_id,project_id,name) values($1,$2,'Boulangerie ${k}') returning id`, [o, p])).rows[0].id;
    ctx[k] = { user: u, org: o, project: p, prospect: pr };
  }
  let n = 0;
  const signal = async (c, { status = 'PENDING_REVIEW', created = 'now()' } = {}) => {
    n++;
    const reviewed = status === 'PENDING_REVIEW' ? 'null,null' : `'${c.user}',now()`;
    await sql(`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,confidence,content_hash,event_key,status,reviewed_by,reviewed_at,created_at)
      values($1,$2,$3,'bodacc','acquisition','Vente et cession ${n}','Achat d’un fonds','https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A${n}','legal_announcement',now(),0.9,$4,'k${n}',$5,${reviewed},${created})`,
      [c.org, c.project, c.prospect, String(n).padStart(64, '0'), status]);
  };
  const row = async user => (await sql('select * from public.morning_digest_subscriptions where user_id=$1', [user])).rows[0];
  const dayStart = "date_trunc('day', now())";

  await check('A_OFF_BY_DEFAULT: nobody is subscribed until they choose it', async () => {
    assert.equal(Number((await sql('select count(*) n from public.morning_digest_subscriptions')).rows[0].n), 0);
    assert.equal((await asService(`select count(*) n from public.claim_morning_digests(50, ${dayStart})`)).rows[0].n, 0);
  });
  await check('B_OWN_CHOICE_WITH_CONSENT: set_morning_digest(true) records the consent for the caller only', async () => {
    const r = (await as(A, 'select public.set_morning_digest(true) r')).rows[0].r;
    assert.equal(r.enabled, true); assert.ok(r.consented_at);
    const a = await row(A); assert.equal(a.enabled, true); assert.ok(a.consented_at); assert.ok(a.last_checked_at, 'enabling starts from now');
    assert.equal(await row(B), undefined);
    await refused(() => as(undefined, 'select public.set_morning_digest(true)'), /permission|denied|authenticated/i, 'an anonymous choice');
  });
  await check('C_RLS: a member reads only their own row and can never write it directly', async () => {
    assert.equal((await as(B, 'select count(*) n from public.morning_digest_subscriptions')).rows[0].n, 0);
    assert.equal((await as(A, 'select count(*) n from public.morning_digest_subscriptions')).rows[0].n, 1);
    await refused(() => as(B, `insert into public.morning_digest_subscriptions(user_id,enabled,consented_at) values($1,true,now())`, [A]), /permission|denied|policy/i, 'subscribing someone else');
    await refused(() => as(A, `update public.morning_digest_subscriptions set last_sent_at=null`), /permission|denied/i, 'a direct update');
    await refused(() => sql(`insert into public.morning_digest_subscriptions(user_id,enabled) values($1,true)`, [B]), /check/i, 'enabled without consent');
  });
  await check('D_SERVER_ONLY: members cannot claim, read the queue, mark or unsubscribe anyone', async () => {
    for (const q of [`select * from public.claim_morning_digests(50, ${dayStart})`, `select * from public.morning_digest_signals('${A}', now()-interval '1 day', 10)`,
      `select public.mark_morning_digest('${A}', now(), true)`, `select public.unsubscribe_morning_digest('${A}')`])
      await refused(() => as(A, q), /permission|denied/i, q.slice(0, 40));
  });
  await check('E_CLAIM_ONCE_A_DAY: a subscriber is claimed once per day, with its email and since', async () => {
    const c = (await asService(`select * from public.claim_morning_digests(50, ${dayStart})`)).rows;
    assert.equal(c.length, 1); assert.equal(c[0].user_id, A); assert.equal(c[0].email, 'a@client.fr'); assert.ok(c[0].since);
    assert.equal((await asService(`select * from public.claim_morning_digests(50, ${dayStart})`)).rows.length, 0, 'never twice the same day');
    await refused(() => asService(`select * from public.claim_morning_digests(0, ${dayStart})`), /Invalid claim/, 'a zero limit');
    await refused(() => asService(`select * from public.claim_morning_digests(5, now()+interval '1 day')`), /Invalid claim/, 'a future day');
  });
  await check('F_SIGNALS: only PENDING_REVIEW signals of the member’s organizations, created since the last check', async () => {
    await sql(`update public.morning_digest_subscriptions set last_checked_at=now()-interval '1 day' where user_id=$1`, [A]);
    await signal(ctx.A); await signal(ctx.A, { status: 'VERIFIED' }); await signal(ctx.A, { created: "now()-interval '3 days'" }); await signal(ctx.B);
    const since = (await row(A)).last_checked_at;
    const s = (await asService('select * from public.morning_digest_signals($1,$2,30)', [A, since])).rows;
    assert.equal(s.length, 1, 'not the verified one, not the old one, not another organization’s');
    assert.equal(s[0].prospect_name, 'Boulangerie A'); assert.equal(s[0].project_name, 'Agences web'); assert.match(s[0].source_url, /^https:\/\/www\.bodacc\.fr\//);
    assert.equal((await asService('select count(*) n from public.morning_digest_signals($1,$2,30)', [B, since])).rows[0].n, 0, 'B never enabled it');
  });
  await check('G_MARK: the check and the sending date are recorded only for an enabled subscriber', async () => {
    assert.equal((await asService('select public.mark_morning_digest($1, now(), true) r', [A])).rows[0].r, true);
    const a = await row(A); assert.ok(a.last_sent_at);
    assert.equal((await asService('select public.mark_morning_digest($1, now(), true) r', [B])).rows[0].r, false);
    assert.equal((await asService(`select public.mark_morning_digest($1, now()+interval '1 hour', false) r`, [A])).rows[0].r, false, 'never a future check');
  });
  await check('H_UNSUBSCRIBE: one call turns it off; no longer claimed nor listed; on again only by the member', async () => {
    assert.equal((await asService('select public.unsubscribe_morning_digest($1) r', [A])).rows[0].r, true);
    const a = await row(A); assert.equal(a.enabled, false); assert.ok(a.unsubscribed_at);
    assert.equal((await asService('select public.unsubscribe_morning_digest($1) r', [A])).rows[0].r, false, 'idempotent');
    await sql('update public.morning_digest_subscriptions set claimed_at=null where user_id=$1', [A]);
    assert.equal((await asService(`select * from public.claim_morning_digests(50, ${dayStart})`)).rows.length, 0);
    assert.equal((await asService(`select count(*) n from public.morning_digest_signals($1, now()-interval '10 days', 30)`, [A])).rows[0].n, 0);
    await as(A, 'select public.set_morning_digest(false)');
    assert.equal((await row(A)).enabled, false);
  });
  await check('I_ACCOUNT_DELETION: deleting the user deletes the row', async () => {
    const C = '00000000-0000-4000-8000-0000000000c1';
    await sql(`insert into auth.users(id,email) values ($1,'c@client.fr')`, [C]);
    await as(C, 'select public.set_morning_digest(true)');
    assert.ok(await row(C));
    await sql('delete from auth.users where id=$1', [C]);
    assert.equal(await row(C), undefined);
  });
  await check('J_CLOSED_ACCOUNT: an anonymized account, or one without any organization, is never claimed', async () => {
    const D = '00000000-0000-4000-8000-0000000000d1';
    await sql(`insert into auth.users(id,email) values ($1,'d@client.fr')`, [D]);
    const o = await org(D);
    await as(D, 'select public.set_morning_digest(true)');
    await sql(`update auth.users set email=$2 where id=$1`, [D, `deleted+${D}@deleted.invalid`]);
    assert.equal((await asService(`select count(*) n from public.claim_morning_digests(50, ${dayStart}) where user_id='${D}'`)).rows[0].n, 0);
    await sql(`update auth.users set email='d@client.fr' where id=$1`, [D]);
    await sql('delete from public.memberships where user_id=$1', [D]);
    assert.equal((await asService(`select count(*) n from public.claim_morning_digests(50, ${dayStart}) where user_id='${D}'`)).rows[0].n, 0);
    assert.equal((await row(D)).claimed_at, null, 'not even marked as claimed');
    void o;
  });
  await check('IDEMPOTENT: re-applying migration 040 changes nothing', async () => {
    if (!process.env.WITHOUT_040) await db.exec(await readFile(new URL('../db/migrations/040_morning_digest.sql', import.meta.url), 'utf8'));
    assert.equal((await as(A, 'select public.set_morning_digest(true) r')).rows[0].r.enabled, true);
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
