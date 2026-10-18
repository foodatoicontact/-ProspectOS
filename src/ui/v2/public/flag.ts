// WEB-2 — the ProspectOS 2.0 public site (docs/UI_V2.md): ONE build-time flag for every public page (/, /tarifs, SEO, legal).
// NEXT_PUBLIC_WEB_V2_ENABLED is inlined by Next at build time, on the server render and in the browser bundle alike, so the
// version of the site is decided before the first paint (no client swap) and both sides always agree. Changing it needs a
// redeploy, by design. It is only ever set on the Preview of the web-v2 branch; Production has no such variable.
export function webV2Enabled(v:string|undefined):boolean{
 const s=(v??'').trim().toLowerCase();
 return s==='1'||s==='true';
}
// Must stay a literal `process.env.NEXT_PUBLIC_…` read for Next to inline it.
export const WEB_V2=webV2Enabled(process.env.NEXT_PUBLIC_WEB_V2_ENABLED);
