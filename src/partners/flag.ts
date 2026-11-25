// Programme partenaires (migration 052, docs/PARTNERS.md) — OFF unless NEXT_PUBLIC_PARTNERS_ENABLED is "true" or "1".
// One flag for both sides: a literal NEXT_PUBLIC_ read, inlined by Next in the browser bundle (the ?ref= capture, the sign-up
// field, the public pages) and read at runtime on the server (routes, Stripe webhook, monthly job). Off: no route answers
// (404), no field, no capture, the webhook and the job do nothing for partners.
export const partnersEnabled=(v:string|undefined)=>{const x=(v??'').trim().toLowerCase();return x==='true'||x==='1'};
export const PARTNERS=partnersEnabled(process.env.NEXT_PUBLIC_PARTNERS_ENABLED);
export const partnersEnabledIn=(env:Record<string,string|undefined>)=>partnersEnabled(env.NEXT_PUBLIC_PARTNERS_ENABLED);
