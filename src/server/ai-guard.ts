import {z} from 'zod';

// Enforces "consume the quota, then call the paid provider — never the other way round" as a single
// choke point, so no call site can accidentally reorder the two and call the provider first. If
// `consumeQuota` rejects for ANY reason (quota exceeded, not a member, or the quota check itself
// failing for an unrelated infrastructure reason), `callProvider` is never invoked: this is fail-closed
// by construction, since a rejected `await` never reaches the next line. A provider failure that
// happens AFTER the quota was successfully consumed does not refund it — the unit stays spent. That is
// a deliberate choice for this first technical guard (no plans/billing yet): refunding would need a
// second DB round trip with its own race window, and silently makes retry-driven quota drain cheaper
// for an attacker. Simpler and safer wins for V0.
export async function withAiQuota<T>(consumeQuota:()=>Promise<void>,callProvider:()=>Promise<T>):Promise<T>{
 await consumeQuota();
 return callProvider();
}

// Same UUID schema shape already used elsewhere for path/body ids (src/discovery/api.ts).
export const projectIdSchema=z.string().uuid();

// A malformed project_id must never reach the quota RPC or the provider: reject it before either one
// runs. This is the same "fail closed on anything unexpected" posture as withAiQuota, applied one step
// earlier — an invalid id is neither a quota check nor a provider call, so it can't consume quota nor
// cost money.
export async function analyzeCompanyGuarded<T>(projectId:unknown,consumeQuota:(projectId:string)=>Promise<void>,callProvider:()=>Promise<T>):Promise<T>{
 const parsed=projectIdSchema.safeParse(projectId);
 if(!parsed.success)throw Error('INVALID_PROJECT_ID');
 return withAiQuota(()=>consumeQuota(parsed.data),callProvider);
}
