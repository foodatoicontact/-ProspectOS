import {webV2HomeEnabled} from '../../../../src/ui/v2/home/flag.ts';
// Public: whether the ProspectOS 2.0 homepage (WEB-1) is shown on THIS deployment, decided per request (never prerendered: a
// static page would freeze it with the build environment). Only a boolean — no variable value, no user data. The real
// Production guard is the absence of WEB_V2_HOME_ENABLED there.
export const dynamic='force-dynamic';
export async function GET(){
 return new Response(JSON.stringify({enabled:webV2HomeEnabled(process.env)}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
}
