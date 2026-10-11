// UX A/B — which presentation of the prospect detail page a user sees (experiment prospect_detail_v1). Presentation only:
// every fetch, mutation, score, angle, message and lifecycle step is shared by A and B.
// - Enabled on Preview (VERCEL_ENV=preview) or local development only; Production is a hard off (always A, no header, no
//   event). Decided by the server PER REQUEST (GET /api/public/ux-config), never in a statically prerendered file: a static
//   page freezes it with the build environment (the Preview bug of 135bdbf9). Where the platform does not expose
//   VERCEL_ENV, the explicit project switch UX_AB_ENABLED=1 (scoped to Preview) enables it; it never applies in Production.
// - Normal assignment: a deterministic hash of the signed-in user's id — the same variant on every reload and device,
//   never random, never stored.
// - ?ux=A / ?ux=B: a manual override for comparing both on the same prospect, kept for the browser tab only
//   (sessionStorage, never localStorage), always labelled 'forced' so metrics can exclude it; ?ux=auto clears it.
export type UxVariant='A'|'B';
export type UxAssignment={variant:UxVariant;assignment:'hashed'|'forced'|'default'};
export const UX_EXPERIMENT='prospect_detail_v1';
export const UX_FORCED_SESSION_KEY='prospectos.ux.prospect_detail_v1.forced';
export const UX_HEADER='x-prospectos-ux';
type Env={VERCEL_ENV?:string;NODE_ENV?:string;UX_AB_ENABLED?:string};
type SessionStore={getItem(k:string):string|null;setItem(k:string,v:string):void;removeItem(k:string):void};

export function uxAbEnabledFromEnv(env:Env):boolean{
 if(env.VERCEL_ENV)return env.VERCEL_ENV==='preview';
 return env.UX_AB_ENABLED==='1'||env.NODE_ENV==='development';
}
// Which environment the server sees — reported by /api/public/ux-config as a runtime proof.
export function uxEnvironment(env:Env):'preview'|'production'|'development'|'unknown'{
 if(env.VERCEL_ENV==='preview'||env.VERCEL_ENV==='production')return env.VERCEL_ENV;
 if(!env.VERCEL_ENV&&env.NODE_ENV==='development')return 'development';
 return 'unknown';
}
// FNV-1a, 32 bits: stable, dependency-free, the same in the browser and on the server.
export function hashedVariant(userId:string):UxVariant{
 let h=0x811c9dc5;
 for(const ch of `${UX_EXPERIMENT}:${userId}`){h^=ch.charCodeAt(0);h=Math.imul(h,0x01000193)>>>0}
 return h%2===0?'A':'B';
}
export function forcedFromSearch(search:string):UxVariant|'clear'|null{
 const v=new URLSearchParams(search).get('ux')?.toUpperCase();
 return v==='A'||v==='B'?v:v==='AUTO'?'clear':null;
}
// The tab's own store (sessionStorage) for the manual override, or null where it is unavailable (private mode).
export const tabStore=():SessionStore|null=>{try{return typeof window==='undefined'?null:window.sessionStorage}catch{return null}};
export function readForced(search:string,store:SessionStore|null):UxVariant|null{
 if(!store)return null;
 try{
  const fromUrl=forcedFromSearch(search);
  if(fromUrl==='clear'){store.removeItem(UX_FORCED_SESSION_KEY);return null}
  if(fromUrl){store.setItem(UX_FORCED_SESSION_KEY,fromUrl);return fromUrl}
  const kept=store.getItem(UX_FORCED_SESSION_KEY);
  return kept==='A'||kept==='B'?kept:null;
 }catch{return null}
}
export function resolveUxVariant(i:{enabled:boolean;userId:string|null;forced:UxVariant|null}):UxAssignment{
 if(!i.enabled)return {variant:'A',assignment:'default'};
 if(i.forced)return {variant:i.forced,assignment:'forced'};
 if(!i.userId)return {variant:'A',assignment:'default'};
 return {variant:hashedVariant(i.userId),assignment:'hashed'};
}
// Temporary Preview diagnostic: what this browser resolved. Shown only when the experiment runs; no business content.
export function uxDiagnosticLabel(enabled:boolean,a:UxAssignment):string|null{return enabled?`UX: ${a.variant} | enabled:${enabled} | assignment:${a.assignment}`:null}
// The label sent with the user's own API calls — analytics only, never an authorization input.
export function uxHeaderValue(a:UxAssignment):string|null{return a.assignment==='default'?null:`${a.variant};${a.assignment}`}
export function parseUxHeader(value:string|null):{variant:UxVariant;assignment:'hashed'|'forced'}|null{
 const m=/^(A|B);(hashed|forced)$/.exec(value??'');
 return m?{variant:m[1] as UxVariant,assignment:m[2] as 'hashed'|'forced'}:null;
}
