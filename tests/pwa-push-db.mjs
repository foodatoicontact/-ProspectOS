// Migration 057 — ProspectOS installable (owner decision, 26 nov. 2026), on real PostgreSQL (PGlite) with the full chain.
// An account gives its consent on a device (subscription), chooses its notifications, refuses the install invitation for
// all its devices; a veille delivery, signals found by monitoring and an ended trial queue one notification each, only for
// accounts that said yes to that kind; the server claims, sends, retries and drops gone devices; the four measured events
// reach the administrator's feed, bounded per device; and the RLS test: an account reads and changes only its own
// settings, never a subscription, the queue or another account's anything. WITHOUT_057=1: the checks must fail.
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
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).replace(/\n/g, ' ').slice(0, 400)]); }
}
async function refused(operation, pattern, what) {
  let outcome;
  try { await operation(); outcome = null; } catch (error) { outcome = String(error?.message); }
  if (outcome === null) throw new Error(`BYPASS: ${what} was accepted by the database`);
  if (!pattern.test(outcome)) throw new Error(`refused for the wrong reason (${outcome})`);
}
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pdfBytes = text => Buffer.from(`%PDF-1.4\n% proposition ${text}\n${'x'.repeat(200)}\n%%EOF\n`, 'latin1');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const KEY = 'B' + 'A'.repeat(86), AUTH = 'a'.repeat(22);
const queue = async (where = 'true', params = []) => (await sql(`select * from prospectos_private.user_push_queue where ${where} order by id`, params)).rows;

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
    .filter(f => !(process.env.WITHOUT_057 && f.startsWith('057_')));
  assert.ok(process.env.WITHOUT_057 || migrations.includes('057_pwa_push.sql'), 'migration 057 present');
  for (const f of migrations) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  await sql('grant usage on schema prospectos_private to service_role');

  const K = uid(0xad), S = uid(0xa1), T = uid(0xa2), G = uid(0xb1);
  await sql(`insert into auth.users(id,email) values($1,'admin@prospectos.test'),($2,'client@exemple.test'),($3,'membre@exemple.test'),($4,'autre@exemple.test')`, [K, S, T, G]);
  await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'INTERNAL','ACTIVE',now(),now()+interval '10 years',now())`, [K]);
  const org1 = (await as(S, `select public.create_organization('Client') id`)).rows[0].id;
  await as(G, `select public.create_organization('Autre')`);
  await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`, [org1, T]);
  const subscribe = (u, endpoint, platform = 'ios') => as(u, `select public.save_push_subscription($1,$2,$3,$4) r`, [endpoint, KEY, AUTH, platform]);

  await check('SETTINGS: everything on by default; consent on a device saves its subscription for the account; preferences per kind', async () => {
    const s0 = (await as(S, 'select public.app_settings() r')).rows[0].r;
    assert.deepEqual(s0, { install_prompt_refused: false, push: { delivery: true, signals: true, trial: true }, devices: 0 });
    const s1 = (await subscribe(S, 'https://web.push.apple.com/abc')).rows[0].r;
    assert.equal(s1.devices, 1);
    await subscribe(T, 'https://fcm.googleapis.com/fcm/send/def', 'android');
    const s2 = (await as(T, 'select public.set_push_preferences(true,false,true) r')).rows[0].r;
    assert.deepEqual(s2.push, { delivery: true, signals: false, trial: true });
    await refused(() => as(S, `select public.save_push_subscription('http://insecure.test/x',$1,$2,'ios')`, [KEY, AUTH]), /check constraint|violates/i, 'an endpoint over http');
    await refused(() => as(S, `select public.save_push_subscription('https://x.test/y','short',$1,'ios')`, [AUTH]), /check constraint|violates/i, 'a malformed key');
    await refused(() => as(undefined, 'select public.app_settings()'), /permission denied/i, 'anon reading settings');
  });

  await check('SHARED DEVICE: an endpoint saved by another account moves to it — a device notifies one account only', async () => {
    await subscribe(G, 'https://web.push.apple.com/abc');
    assert.equal((await sql(`select user_id from public.push_subscriptions where endpoint='https://web.push.apple.com/abc'`)).rows[0].user_id, G);
    await subscribe(S, 'https://web.push.apple.com/abc');
    assert.equal((await sql(`select user_id from public.push_subscriptions where endpoint='https://web.push.apple.com/abc'`)).rows[0].user_id, S);
    assert.equal(Number((await sql('select count(*) n from public.push_subscriptions')).rows[0].n), 2);
  });

  await check('DELIVERY: a veille delivery queues one notification per member who said yes, once', async () => {
    const PDF = pdfBytes('v1');
    const c = (await as(K, `select public.propose_dedicated_watch($1,'Veille',9900,17900,15,'2026-11-16','2026-01-01','proposition.pdf',$2) r`, [org1, PDF.toString('base64')])).rows[0].r;
    await as(S, 'select public.accept_dedicated_proposal($1,$2)', [c.id, sha(PDF)]);
    await as(K, `select public.create_dedicated_delivery($1,'IDF',$2)`, [c.id, JSON.stringify([{ siren: '111111111', name: 'A', city: 'Meaux', source_label: 'BODACC', source_url: 'https://www.bodacc.fr/annonce/1' }])]);
    const q = await queue(`kind='DELIVERY'`);
    assert.deepEqual(q.map(r => r.user_id).sort(), [S, T].sort(), 'the owner and the member, both subscribed');
    assert.ok(q.every(r => r.url === '/app#veille'));
  });

  await check('SIGNALS: monitoring queues one notification a day for the person who monitors (if they want it); a manual search none', async () => {
    const proj = (await as(S, `insert into public.projects(organization_id,name) values($1,'P') returning id`, [org1])).rows[0].id;
    const pr = (await as(S, `insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Prospect','https://exemple.test') returning id`, [org1, proj])).rows[0].id;
    const run = async (trigger, who) => (await sql(`insert into public.signal_runs(organization_id,project_id,trigger,prospect_ids,status,created_by) values($1,$2,$3,array[$4]::uuid[],'running',$5) returning id`, [org1, proj, trigger, pr, who])).rows[0].id;
    const signal = async (runId, n) => sql(`insert into public.signals(organization_id,project_id,prospect_id,signal_run_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,confidence,content_hash,event_key,purge_after)
      values($1,$2,$3,$4,'official_site','hiring_role','Recrute','Nous recrutons',$5,'official_website',now(),0.5,$6,$6,now()+interval '60 days')`, [org1, proj, pr, runId, `https://exemple.test/${n}`, createHash('sha256').update(`h${n}`).digest('hex')]);
    const m = await run('monitor', S); await signal(m, 1); await signal(m, 2);
    const m2 = await run('monitor', S); await signal(m2, 3);
    assert.equal((await queue(`kind='SIGNALS'`)).length, 1, 'one a day, however many signals');
    const manual = await run('manual', S); await signal(manual, 4);
    assert.equal((await queue(`kind='SIGNALS'`)).length, 1, 'a search the person ran is not announced');
    const mt = await run('monitor', T); await signal(mt, 5);
    assert.equal((await queue(`kind='SIGNALS' and user_id=$1`, [T])).length, 0, 'the member switched signals off');
  });

  await check('TRIAL: the daily sweep queues the end of a recent trial only (an old one is only in the feed)', async () => {
    await sql(`insert into public.account_entitlements(user_id,plan,status,starts_at,expires_at,updated_at) values($1,'BETA','ACTIVE',now()-interval '8 days',now()-interval '1 hour',now()),($2,'BETA','ACTIVE',now()-interval '30 days',now()-interval '20 days',now())`, [S, G]);
    const r = (await asService('select public.sweep_admin_events() r')).rows[0].r;
    assert.equal(r.trials_ended, 2); assert.equal(r.trial_pushes, 1);
    assert.equal((await queue(`kind='TRIAL_ENDED'`))[0].user_id, S);
    assert.equal((await asService('select public.sweep_admin_events() r')).rows[0].r.trial_pushes, 0, 'once');
  });

  await check('SEND: claimed with the account’s subscriptions only; sent, retried up to 5 times; a gone device is dropped', async () => {
    const claimed = (await asService('select public.claim_user_push(50) r')).rows[0].r;
    assert.equal(claimed.length, 4);
    for (const c of claimed) assert.deepEqual(Object.keys(c).sort(), ['id', 'kind', 'subscriptions', 'url'], 'no name, no company, no signal');
    const mine = claimed.find(c => c.kind === 'TRIAL_ENDED');
    assert.deepEqual(mine.subscriptions.map(s => s.endpoint), ['https://web.push.apple.com/abc']);
    await asService('select public.finish_user_push($1,true)', [mine.id]);
    assert.equal((await queue('id=$1', [mine.id]))[0].state, 'SENT');
    assert.ok((await sql(`select last_sent_at from public.push_subscriptions where endpoint='https://web.push.apple.com/abc'`)).rows[0].last_sent_at);
    assert.equal(await asService(`select public.drop_push_subscription('https://fcm.googleapis.com/fcm/send/def') r`).then(x => x.rows[0].r), true);
    const left = claimed.filter(c => c.id !== mine.id);
    for (const c of left) await asService('select public.finish_user_push($1,false)', [c.id]);
    await asService('select public.claim_user_push(50)');
    const memberRow = (await queue(`user_id=$1`, [T]))[0];
    assert.equal(memberRow.state, 'SKIPPED', 'no device left for that account: closed, never sent');
  });

  await check('INVITATION: « Ne plus afficher » is stored on the account (every device); events bounded per device; in the feed', async () => {
    assert.equal((await as(S, 'select public.refuse_install_prompt() r')).rows[0].r.install_prompt_refused, true);
    const ev = (kind, dev = 'device-0000000000000001') => as(S, 'select public.record_app_event($1,$2,$3) r', [kind, dev, 'ios']);
    for (let i = 0; i < 5; i++) await ev('invitation_affichee');
    assert.equal(Number((await sql(`select count(*) n from public.admin_events where kind='INSTALL_PROMPT_SHOWN'`)).rows[0].n), 3, 'at most 3 per device');
    await ev('invitation_refusee'); await ev('invitation_refusee');
    await ev('app_installee'); await ev('notifications_activees'); await ev('app_installee', 'device-0000000000000002');
    const rows = (await sql(`select kind,count(*)::int n from public.admin_events where source_table='app' group by kind order by kind`)).rows;
    assert.deepEqual(rows, [{ kind: 'APP_INSTALLED', n: 2 }, { kind: 'INSTALL_PROMPT_REFUSED', n: 1 }, { kind: 'INSTALL_PROMPT_SHOWN', n: 3 }, { kind: 'PUSH_ENABLED', n: 1 }]);
    const e = (await sql(`select * from public.admin_events where kind='APP_INSTALLED' limit 1`)).rows[0];
    assert.deepEqual(e.detail, { platform: 'ios' }); assert.equal(e.organization_id, org1);
    await refused(() => ev('autre_chose'), /app_event_invalid/, 'an unknown event');
    await refused(() => ev('app_installee', 'x'), /app_event_invalid/, 'a malformed device id');
    const feed = (await as(K, `select public.admin_feed(array['APP_INSTALLED'],null,null,null,10) r`)).rows[0].r.events;
    assert.equal(feed.length, 2); assert.equal(feed[0].organization, 'Client');
  });

  await check('RLS: an account reads no subscription, no queue row, nobody else’s settings; never claims or drops', async () => {
    for (const u of [S, G]) {
      await refused(() => as(u, 'select * from public.push_subscriptions'), /permission denied/i, 'reading subscriptions');
      await refused(() => as(u, 'select * from public.user_app_settings'), /permission denied/i, 'reading settings directly');
      await refused(() => as(u, 'select * from prospectos_private.user_push_queue'), /permission denied/i, 'reading the queue');
      await refused(() => as(u, 'select public.claim_user_push(5)'), /permission denied/i, 'claiming');
      await refused(() => as(u, `select public.drop_push_subscription('https://web.push.apple.com/abc')`), /permission denied/i, 'dropping a device');
      await refused(() => as(u, `select public.drop_user_push_subscriptions($1)`, [S]), /permission denied/i, 'dropping an account’s devices');
    }
    await as(G, `select public.delete_push_subscription('https://web.push.apple.com/abc')`);
    assert.equal(Number((await sql(`select count(*) n from public.push_subscriptions where user_id=$1`, [S])).rows[0].n), 1, 'another account cannot remove my device');
    assert.equal((await as(G, 'select public.app_settings() r')).rows[0].r.install_prompt_refused, false, 'my refusal is mine only');
  });

  await check('ACCOUNT DELETION: every device of the account is removed and its pending notifications closed', async () => {
    await sql(`insert into prospectos_private.user_push_queue(user_id,kind,url,dedupe_key) values($1,'DELIVERY','/app','test-pending')`, [S]);
    assert.equal((await asService('select public.drop_user_push_subscriptions($1) r', [S])).rows[0].r, 1);
    assert.equal((await queue(`dedupe_key='test-pending'`))[0].state, 'SKIPPED');
  });
} catch (error) {
  results.push(['SETUP', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
