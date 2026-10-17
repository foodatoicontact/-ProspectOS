// ProspectOS 2.0 — UI-1 Fondations (docs/UI_V2.md). Server-side flag, OFF unless UI_V2_ENABLED is "true"/"1".
// Decided per request (never in a static file: a prerendered page freezes the flag with the BUILD environment, see
// tests/ux-runtime-flag.test.ts). Production stays a hard off whenever the platform reports it; because the runtime does
// not always expose VERCEL_ENV (docs/ZERO_FRICTION.md, P0 debt), the variable itself must only ever be set on Preview.
export type Env=Record<string,string|undefined>;
export function uiV2Enabled(env:Env):boolean{
 if((env.VERCEL_ENV??'').trim().toLowerCase()==='production')return false;
 const v=(env.UI_V2_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
