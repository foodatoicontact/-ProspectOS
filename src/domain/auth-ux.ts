// Account creation / sign-in wording and outcomes, kept out of page.tsx so they can be tested. Pure, no network.
// The activation funnel is VISIT → SIGN UP → CONFIRMATION E-MAIL → ACTIVATION: every outcome below must leave a
// non-technical user knowing what happened and what to do next, without revealing whether an address already has
// an account (Supabase's own anti-enumeration behaviour is kept: a sign-up for an existing confirmed address
// answers like a new one, and the screen says "already have an account? sign in" to everybody).
export type AuthView='signup'|'login';
// Seconds before the confirmation e-mail can be sent again from this screen. Supabase Auth applies its own
// server-side limit on top of it (over_email_send_rate_limit), which stays the real authority.
export const RESEND_COOLDOWN_SECONDS=60;
// Remembered on this device after a successful sign-in, so a returning user lands on "Me connecter" and a first
// visit lands on "Créer mon compte". Never an identity: a flag only.
export const KNOWN_ACCOUNT_KEY='prospectos-has-account';
export function initialAuthView(storedFlag:string|null):AuthView{return storedFlag==='1'?'login':'signup'}

export type AuthOutcome='CONFIRMATION_REQUIRED'|'INVALID_CREDENTIALS'|'ALREADY_REGISTERED'|'RATE_LIMITED'|'OTHER';
type AuthErrorLike={code?:unknown;status?:unknown;message?:unknown};
export function authOutcome(error:unknown):AuthOutcome{
 if(!error||typeof error!=='object')return 'OTHER';
 const e=error as AuthErrorLike;const code=typeof e.code==='string'?e.code:'';const message=typeof e.message==='string'?e.message:'';
 if(code==='over_email_send_rate_limit'||/email rate limit|only request this after/i.test(message)||(e.status===429&&/e-?mail/i.test(message)))return 'RATE_LIMITED';
 if(code==='email_not_confirmed'||/email not confirmed/i.test(message))return 'CONFIRMATION_REQUIRED';
 if(code==='invalid_credentials'||/invalid login credentials/i.test(message))return 'INVALID_CREDENTIALS';
 if(code==='user_already_exists'||code==='email_exists'||/already registered|already been registered/i.test(message))return 'ALREADY_REGISTERED';
 return 'OTHER';
}
// Where the confirmation link brings the user back: the very site they signed up on. Supabase only honours it
// when it is in the project's allowed redirect URLs, and falls back to the configured Site URL otherwise — so a
// production sign-up comes back to production, never to localhost or another Preview.
export function confirmationRedirect(origin:string):string|undefined{
 try{const u=new URL(origin);return u.protocol==='https:'||u.hostname==='localhost'?`${u.origin}/`:undefined}catch{return undefined}
}
export const resendSecondsLeft=(lastSentAt:number,now:number)=>Math.max(0,Math.ceil((lastSentAt+RESEND_COOLDOWN_SECONDS*1000-now)/1000));
