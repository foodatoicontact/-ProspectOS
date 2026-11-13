// Rollback of migration 041 (db/rollbacks/041_icp_import.down.sql, docs/ICP_IMPORT_E2E.md §D), on real PostgreSQL (PGlite)
// with the full migration chain: after 041 and then the rollback, the catalogue (tables, columns, functions, triggers,
// policies, indexes, grants on functions) is exactly the one before 041, the staging history row is gone, and the
// rows of the existing tables are untouched. The rollback is never a migration: no runner applies db/rollbacks.
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (error) { results.push([name, 'FAIL', String(error?.message ?? error).split('\n')[0]]); }
}
const CATALOGUE = `
 select 'rel:'||n.nspname||'.'||c.relname||':'||c.relkind::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','prospectos_private','auth','supabase_migrations')
 union all select 'col:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')
  from information_schema.columns where table_schema in ('public','prospectos_private')
 union all select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(p.prosrc)||':'||coalesce(array_to_string(p.proacl,','),'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','prospectos_private')
 union all select 'trg:'||c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal
 union all select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies
 union all select 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace)
 order by 1`;
const catalogue = async () => (await db.query(CATALOGUE)).rows.map(r => Object.values(r)[0]);

try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[], created_by text);
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  const before041 = files.filter(f => f < '041_'), from041 = files.filter(f => f >= '041_');
  // 042 (demo links) came after 041 and is independent of it: its own tables and functions, and of the ICP it only copies
  // icps.name and icps.criteria, which exist since the base schema. It is not applied here: this test pins the rollback of
  // 041 on the chain that ends with it. A later migration that depends on 041 must come with its own rollback order.
  assert.deepEqual(from041, ['041_icp_import.sql', '042_demo_shares.sql'], 'this rollback is written for 041; only reviewed independent migrations may follow');
  assert.doesNotMatch((await readFile(new URL('../db/migrations/042_demo_shares.sql', import.meta.url), 'utf8')).split('\n').filter(l => !l.trim().startsWith('--')).join('\n'), /icp_import|icp_profile|guard_icp_profile|validate_icp_import/i);
  for (const f of before041) await db.exec(await readFile(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  await db.query(`insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000a1','a@client.fr')`);
  await db.query(`insert into supabase_migrations.schema_migrations(version,name) values ('20261101214740','040_morning_digest')`);
  const reference = await catalogue();
  const rowsOf = async () => (await db.query(`select (select count(*) from auth.users) u,(select count(*) from public.icps) i,(select count(*) from supabase_migrations.schema_migrations) m`)).rows[0];

  await db.exec(await readFile(new URL('../db/migrations/041_icp_import.sql', import.meta.url), 'utf8'));
  await db.query(`insert into supabase_migrations.schema_migrations(version,name) values ('20261105000000','041_icp_import')`);
  const applied = await catalogue();
  const rollback = await readFile(new URL('../db/rollbacks/041_icp_import.down.sql', import.meta.url), 'utf8');

  await check('041 adds objects (the comparison is not vacuous)', async () => {
    assert.ok(applied.some(x => x.startsWith('rel:public.icp_imports:')));
    assert.ok(applied.some(x => x.startsWith('col:public.icps.profile:')));
    assert.ok(applied.length > reference.length);
  });
  await db.exec(rollback);
  await check('after the rollback, the catalogue equals the one before 041', async () => {
    const after = await catalogue();
    assert.deepEqual(after.filter(x => !reference.includes(x)), [], 'left behind');
    assert.deepEqual(reference.filter(x => !after.includes(x)), [], 'removed too much');
  });
  await check('the staging history row of 041 is gone, the others stay', async () => {
    const names = (await db.query(`select name from supabase_migrations.schema_migrations order by name`)).rows.map(r => r.name);
    assert.deepEqual(names, ['040_morning_digest']);
    assert.equal(Number((await rowsOf()).u), 1);
  });
  await check('the rollback is idempotent (a second run changes nothing)', async () => {
    const once = await catalogue(); await db.exec(rollback); assert.deepEqual(await catalogue(), once);
  });
  await check('041 applies again after the rollback', async () => {
    await db.exec(await readFile(new URL('../db/migrations/041_icp_import.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await catalogue()).filter(x => !x.startsWith('rel:supabase_migrations')), applied.filter(x => !x.startsWith('rel:supabase_migrations')));
  });
  await check('the rollback is not a migration: no runner reads db/rollbacks', async () => {
    const runner = await readFile(new URL('../scripts/staging-migrate.sh', import.meta.url), 'utf8');
    assert.match(runner, /MIGRATIONS_DIR="\$TARGET\/db\/migrations"/);
    assert.ok(!runner.includes('rollbacks'));
    assert.match(rollback, /^begin;$/m); assert.match(rollback, /^commit;$/m);
  });
} catch (error) {
  results.push(['setup', 'FAIL', String(error?.message ?? error).split('\n')[0]]);
}
for (const [name, status, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
const failed = results.filter(r => r[1] !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
