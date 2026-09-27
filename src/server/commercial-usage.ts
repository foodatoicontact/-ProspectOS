import type {SupabaseClient} from '@supabase/supabase-js';
// Commercial quota ≠ technical rate limit. Every analysis reservation stays in the usage log and keeps
// counting for the hourly anti-abuse limits; only the unit charged against the customer's plan is given
// back when the work produced nothing (migration 016, release_commercial_use). The refund goes through the
// server's privileged client: a member can never refund work that did produce a result.

// Wraps a repository so the route knows whether this very request reserved an analysis. A failure raised
// BEFORE the reservation (not a member, hourly or plan limit, missing website, refused authorization) never
// triggers a refund: nothing of this request was charged.
export function trackAnalysisReservation<R extends {consumeAnalysis(id:string):Promise<void>}>(repo:R){
 let reserved=false;
 const tracked=Object.create(repo) as R;
 tracked.consumeAnalysis=async(id:string)=>{await repo.consumeAnalysis(id);reserved=true};
 return {repo:tracked,reserved:()=>reserved};
}
// Runs the analysis; if it throws after its unit was reserved, the unit is released, then the ORIGINAL error
// is rethrown unchanged (a failed refund is logged by the caller's error path, never masks the real error).
export async function releaseOnFailure<T>(run:()=>Promise<T>,reserved:()=>boolean,release:()=>Promise<unknown>):Promise<T>{
 try{return await run()}
 catch(error){if(reserved()){try{await release()}catch{/* best-effort: the hourly log is unchanged either way */}}throw error}
}
export async function releaseCommercialUse(admin:SupabaseClient,userId:string,action:'analysis'|'ai_offer'){
 const {error}=await admin.rpc('release_commercial_use',{p_user_id:userId,p_action:action});
 if(error)throw Error('RELEASE_FAILED');
}
