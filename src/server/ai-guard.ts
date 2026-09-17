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
