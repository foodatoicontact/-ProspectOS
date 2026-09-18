import {createClient} from '@supabase/supabase-js';
// Server-only, privileged client: bypasses RLS. Never imported by client code, never reachable from
// the browser. Used exclusively for writes/reads that must never be reachable through any
// `authenticated`-scoped RPC or grant (cost ledger writes, BYOK secret decryption) — the same pattern
// already used by anonymizeAuthUser in src/server/account.ts.
export function createAdminClient() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!serviceKey)throw Error('CONFIGURATION_REQUIRED');
 return createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
}
