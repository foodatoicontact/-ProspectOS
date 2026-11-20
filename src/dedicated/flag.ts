// Veille dédiée, suivi au résultat (migration 043) — OFF unless DEDICATED_TRACKING_ENABLED is "true" or "1". Off: no
// route answers (404), no menu entry is shown, the monthly job does nothing.
export type Env=Record<string,string|undefined>;
export const dedicatedTrackingEnabled=(env:Env)=>{const v=(env.DEDICATED_TRACKING_ENABLED??'').trim().toLowerCase();return v==='true'||v==='1'};
// Where the "statement not validated by the 5th" notice goes: DEDICATED_NOTIFY_EMAIL, else the contact address given.
export function dedicatedNotifyEmail(env:Env,fallback:string):string{
 const v=(env.DEDICATED_NOTIFY_EMAIL??'').trim();return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(v)?v:fallback;
}
