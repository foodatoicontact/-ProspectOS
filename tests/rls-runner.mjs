// Execute the real schema + role-based SQL assertions on PostgreSQL WASM.
// This auth shim models the Supabase role/JWT interface, not Supabase Auth itself.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  `);
  await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../db/rls-test.sql', import.meta.url), 'utf8'));
  const { rows } = await db.query('SELECT count(*)::int AS n FROM auth.users');
  if (rows[0].n !== 0) throw new Error('Test transaction leaked users');
  console.log('PASS: PostgreSQL schema applied; authenticated A/B + anon RLS assertions passed; test transaction rolled back.');
} finally {
  await db.close();
}
