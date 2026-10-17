import {uiV2Enabled} from '../../../../src/ui/v2/flag.ts';
// Public: whether the ProspectOS 2.0 shell (UI-2) runs on THIS deployment, decided per request (never prerendered: a static
// page would freeze it with the build environment). Only a boolean — no variable value, no user data. The real Production
// guard is the absence of UI_V2_ENABLED there (the runtime does not reliably expose VERCEL_ENV, docs/ZERO_FRICTION.md).
export const dynamic='force-dynamic';
export async function GET(){
 return new Response(JSON.stringify({enabled:uiV2Enabled(process.env)}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
}
