// WEB-1 — ProspectOS 2.0 public homepage (docs/UI_V2.md). Server-side flag, OFF unless WEB_V2_HOME_ENABLED is "true"/"1".
// Same rule as UI_V2_ENABLED (../flag.ts): decided per request, never in a static file; Production stays a hard off whenever the
// platform reports it, but the real guard is that the variable is only ever set on Preview (VERCEL_ENV is not reliable).
import type {Env} from '../flag.ts';
export function webV2HomeEnabled(env:Env):boolean{
 if((env.VERCEL_ENV??'').trim().toLowerCase()==='production')return false;
 const v=(env.WEB_V2_HOME_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
