// Zero-Friction ZF1 (docs/ZERO_FRICTION.md) — "Aujourd'hui" as the destination. Server-side flag, OFF unless
// ZERO_FRICTION_TODAY_ENABLED is "true"/"1". With it OFF nothing changes anywhere.
export type Env=Record<string,string|undefined>;
export function zeroFrictionTodayEnabled(env:Env):boolean{
 const v=(env.ZERO_FRICTION_TODAY_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
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
