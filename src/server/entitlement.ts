import type {SupabaseClient} from '@supabase/supabase-js';
// Fail-closed on absence (BETA hotfix): a user with no account_entitlements row has never been granted
// anything — neither BETA nor INTERNAL — so a protected (paid/costly) action must refuse them, not
// silently allow them. This closes the previous legacy fallback (absence -> ACTIVE) that existed only to
// avoid locking out the one historical account before the BETA program existed; that account now carries
// its own explicit INTERNAL entitlement (migration 011) instead of relying on "no row" meaning "allow
// everyone," which stopped being acceptable the moment the app's URL became public. Reads through the
// caller's own authenticated client, so RLS (account_entitlements_self) already guarantees this can
// never read another user's entitlement — never trusts a userId supplied by the client for anything
// beyond which row to look at; the row itself is unreachable for anyone else regardless.
// The EFFECTIVE entitlement (migration 023, get_effective_entitlement): a team member has no row of its own and works
// on its owner's team plan — read-only once that plan is not an active team plan. Everyone else reads its own row.
// Until that function exists on the database (code deployed before the migration), the caller's own row is read,
// exactly as before: the fallback can never grant more than the previous behaviour did.
export type EffectiveEntitlement={plan:string;status:string;expires_at:string;seats?:number|null;via_team?:boolean};
export async function effectiveEntitlement(db:SupabaseClient,userId:string):Promise<{data:EffectiveEntitlement|null;error:unknown}>{
 try{const {data,error}=await db.rpc('get_effective_entitlement');if(!error)return {data:(data as EffectiveEntitlement|null)??null,error:null}}catch{/* not deployed yet */}
 return db.from('account_entitlements').select('plan,status,expires_at').eq('user_id',userId).maybeSingle();
}
export async function requireActiveEntitlement(db:SupabaseClient,userId:string):Promise<void>{
 const {data,error}=await effectiveEntitlement(db,userId);
 if(error)throw Error('DATABASE_REQUEST_FAILED');
 if(!data)throw Error('ENTITLEMENT_REQUIRED'); // never granted BETA or INTERNAL — invitation/activation required
 if(data.status!=='ACTIVE')throw Error('BETA_ACCESS_EXPIRED');
 if(data.plan==='INTERNAL')return; // permanent — never time-boxed, regardless of the stored expires_at
 if(new Date(data.expires_at).getTime()<=Date.now())throw Error('BETA_ACCESS_EXPIRED');
}
