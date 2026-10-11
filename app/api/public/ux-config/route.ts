import {uxAbEnabledFromEnv,uxEnvironment} from '../../../../src/ux/variant.ts';
// Public: whether the UX A/B experiment runs on THIS deployment, decided per request (never prerendered: a static page
// would freeze it with the build environment). Only a boolean and the environment class the server sees — no variable
// value, no user data. Production always answers enabled:false.
export const dynamic='force-dynamic';
export async function GET(){
 return new Response(JSON.stringify({enabled:uxAbEnabledFromEnv(process.env),environment:uxEnvironment(process.env)}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
}
