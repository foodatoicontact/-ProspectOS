// ProspectOS 2.0 — UI-1 Fondations (docs/UI_V2.md). Server-side flag, OFF unless UI_V2_ENABLED is "true"/"1".
// Decided per request (never in a static file: a prerendered page freezes the flag with the BUILD environment, see
// tests/ux-runtime-flag.test.ts). B1: VERCEL_ENV describes the environment, the flag controls the feature — the v2 shell
// runs in Production because UI_V2_ENABLED is set there (owner GO), whether or not the runtime exposes VERCEL_ENV.
export type Env=Record<string,string|undefined>;
export function uiV2Enabled(env:Env):boolean{
 const v=(env.UI_V2_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
// UI-5C: the /ui-v2/* benches (frozen fixtures for visual review) are a separate, explicit opt-in. The v2 shell itself
// runs in Production (UI_V2_ENABLED), the benches never do: without UI_V2_BENCH_ENABLED ("true"/"1") they answer the
// same server-side 404 as any unknown URL. Set it only for a local run, a test server or a Preview being reviewed.
export function uiV2BenchEnabled(env:Env):boolean{
 // A Production that reports itself never serves the benches, even with the bench flag set by mistake.
 if((env.VERCEL_ENV??'').trim().toLowerCase()==='production')return false;
 if(!uiV2Enabled(env))return false;
 const v=(env.UI_V2_BENCH_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
