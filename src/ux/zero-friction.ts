// Zero-Friction ZF1 (docs/ZERO_FRICTION.md) — "Aujourd'hui" as the destination. Server-side flag, OFF unless
// ZERO_FRICTION_TODAY_ENABLED is "true"/"1". With it OFF nothing changes anywhere.
export type Env=Record<string,string|undefined>;
export function zeroFrictionTodayEnabled(env:Env):boolean{
 const v=(env.ZERO_FRICTION_TODAY_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
// Organization-scoped canary: when the global switch is off, ZERO_FRICTION_TODAY_ORGS (comma-separated organization
// UUIDs) turns "Aujourd'hui" on for those organizations only. Anything that is not a UUID is ignored; spaces, case and
// duplicates do not matter. No user id or e-mail here: the organization is always the one the server resolved.
const ORG_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function zeroFrictionTodayOrgs(env:Env):Set<string>{
 return new Set((env.ZERO_FRICTION_TODAY_ORGS??'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>ORG_UUID.test(v)));
}
export function zeroFrictionTodayEnabledFor(env:Env,organizationId:string|null|undefined):boolean{
 if(zeroFrictionTodayEnabled(env))return true;
 return !!organizationId&&zeroFrictionTodayOrgs(env).has(organizationId.trim().toLowerCase());
}
// The gate the server routes take: true (everyone), false (no one) or, for a canary, a test of the organization the
// route itself resolved (the project's or the recommendation's, under RLS) — never one the client asserts.
export type ZfGate=boolean|((organizationId:string)=>boolean);
export function zeroFrictionTodayGate(env:Env):ZfGate{
 if(zeroFrictionTodayEnabled(env))return true;
 const orgs=zeroFrictionTodayOrgs(env);
 return orgs.size?(organizationId:string)=>orgs.has(organizationId.trim().toLowerCase()):false;
}
// Auto-recalculation policy (src/nba/api.ts ensure-fresh): on opening "Aujourd'hui", recompute only when nothing was
// ever computed for the project or the newest computation is older than this (freshness decays by the day); after a
// data change the user made, recompute once. Never on render, never on a timer.
export const TODAY_RECOMPUTE_TTL_MS=6*60*60*1000;
export type RecomputeReason='open'|'data_changed';
export function shouldRecompute(reason:RecomputeReason,newestComputedAt:string|null,now:Date):boolean{
 if(reason==='data_changed')return true;
 if(!newestComputedAt)return true;
 const t=Date.parse(newestComputedAt);
 return !Number.isFinite(t)||now.getTime()-t>=TODAY_RECOMPUTE_TTL_MS;
}
// The API calls (method + path) whose success changes what NBA reads (prospects, evidence, signals, public content,
// ICP, offer). The client marks "Aujourd'hui" as needing one recomputation after any of them.
const NBA_INPUT_PATHS=[/^prospects(\/|$)/,/^evidence(\/|$)/,/^signals\/[^/]+\/review$/,/^discovery-results\/[^/]+\/accept$/,/^icps$/,/^projects\/[^/]+$/,
 /^public-content(\/|$)/,/^prospects\/[^/]+\/(observations|signals|signal-scan|public-content|analyze|website)/];
export function changesNbaInputs(method:string,path:string):boolean{
 if(method==='GET')return false;
 const p=path.replace(/^\/+/,'').split('?')[0]!;
 return NBA_INPUT_PATHS.some(re=>re.test(p));
}
