import type {SupabaseClient} from '@supabase/supabase-js';
// Absence of a row means "not part of the time-boxed beta program" — an account with no entitlement
// row (a legacy user, or a future paid plan with no expiry) is never blocked by this check. Only an
// account that actually HAS a plan record with an expiry is ever time-boxed. Reads through the
// caller's own authenticated client, so RLS (account_entitlements_self) already guarantees this can
// never read another user's entitlement — never trusts a userId supplied by the client for anything
// beyond which row to look at; the row itself is unreachable for anyone else regardless.
export async function requireActiveEntitlement(db:SupabaseClient,userId:string):Promise<void>{
 const {data,error}=await db.from('account_entitlements').select('status,expires_at').eq('user_id',userId).maybeSingle();
 if(error)throw Error('DATABASE_REQUEST_FAILED');
 if(!data)return;
 if(data.status!=='ACTIVE'||new Date(data.expires_at).getTime()<=Date.now())throw Error('BETA_ACCESS_EXPIRED');
}
