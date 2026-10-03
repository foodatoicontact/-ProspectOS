// Activation funnel hotfix (real beta feedback): VISIT → SIGN UP → CONFIRMATION E-MAIL → ACTIVATION.
// A non-technical visitor must see at once how to create an account vs sign in, be told that a confirmation
// e-mail was sent (and to check spam), be able to resend it (bounded), and never be told whether an address
// already has an account. Pure tests (helpers + page wiring); the browser walk-through is in the PR description.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authOutcome,confirmationRedirect,initialAuthView,resendSecondsLeft,RESEND_COOLDOWN_SECONDS,KNOWN_ACCOUNT_KEY} from '../src/domain/auth-ux.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const welcome=page.match(/if\(mode==='welcome'\)return <main className="welcome">[\s\S]*?<\/main>;/)![0];
const loginFn=page.slice(page.indexOf('async function login('),page.indexOf('async function resendConfirmation('));
const resendFn=page.slice(page.indexOf('async function resendConfirmation('),page.indexOf('async function status('));

test('1/10 — two explicit views, "Créer mon compte" and "Me connecter", switchable both ways; first visit lands on account creation',()=>{
 assert.equal(fr['auth.tabSignup'],'Créer mon compte');assert.equal(fr['auth.tabLogin'],'Me connecter');assert.equal(fr['landing.loginButton'],'Me connecter');
 assert.match(welcome,/role="tablist"/);
 assert.match(welcome,/onClick=\{\(\)=>switchAuthView\('signup'\)\}>\{tr\('auth\.tabSignup'\)\}/);
 assert.match(welcome,/onClick=\{\(\)=>switchAuthView\('login'\)\}>\{tr\('auth\.tabLogin'\)\}/);
 assert.match(welcome,/\{tr\('auth\.haveAccount'\)\}/);assert.match(welcome,/\{tr\('auth\.newHere'\)\}/);
 assert.equal(initialAuthView(null),'signup');assert.equal(initialAuthView('1'),'login');assert.equal(initialAuthView('x'),'signup');
 assert.match(page,/localStorage\.setItem\(KNOWN_ACCOUNT_KEY,'1'\)/);assert.equal(KNOWN_ACCOUNT_KEY,'prospectos-has-account');
});
test('1 — the sign-up view says a confirmation e-mail will follow; the login view never shows the consent checkbox',()=>{
 assert.match(fr['auth.signupSubtitle'],/e-mail pour confirmer votre adresse/);
 const loginBranch=welcome.slice(welcome.indexOf("{authView==='login'?<>"),welcome.indexOf("</>:<>"));
 assert.doesNotMatch(loginBranch,/legalAccepted|checkbox/);
 assert.match(welcome,/autoComplete=\{authView==='signup'\?'new-password':'current-password'\}/);
});
test('2 — after a sign-up without session: the "Vérifiez votre boîte mail" screen with the address, spam hint, resend, change address, back to sign-in',()=>{
 assert.match(loginFn,/if\(!result\.data\.session\)\{setPendingEmail\(email\);setLastSentAt\(Date\.now\(\)\);return\}/);
 assert.equal(fr['auth.checkEmailTitle'],'Vérifiez votre boîte mail');
 assert.match(fr['auth.checkEmailStep3'],/Spam, Indésirables ou Promotions/);
 assert.match(fr['auth.checkEmailStep1'],/ProspectOS/);
 for(const piece of ["{pendingEmail?<div className=\"check-email\"","<b>{pendingEmail}</b>","onClick={resendConfirmation}","switchAuthView('signup')}>{tr('auth.changeEmail')}","switchAuthView('login')}>{tr('auth.confirmedSignIn')}"])assert.ok(welcome.includes(piece),piece);
});
test('4 — the confirmation link comes back to the site the user signed up on; never a foreign or plain-http origin',()=>{
 assert.equal(confirmationRedirect('https://prospectos-v0.vercel.app'),'https://prospectos-v0.vercel.app/');
 assert.equal(confirmationRedirect('http://localhost:3000'),'http://localhost:3000/');
 assert.equal(confirmationRedirect('http://evil.example'),undefined);
 assert.equal(confirmationRedirect('not a url'),undefined);
 assert.match(loginFn,/signUp\(\{email,password,options:\{emailRedirectTo:confirmationRedirect\(window\.location\.origin\)/);
 assert.match(resendFn,/emailRedirectTo:confirmationRedirect\(window\.location\.origin\)/);
});
test('6/7/8 — unconfirmed sign-in → check-email screen; existing account → sign-in; wrong password → clear French message',()=>{
 assert.equal(authOutcome({code:'email_not_confirmed',status:400,message:'Email not confirmed'}),'CONFIRMATION_REQUIRED');
 assert.equal(authOutcome({status:400,message:'Email not confirmed'}),'CONFIRMATION_REQUIRED');
 assert.equal(authOutcome({code:'invalid_credentials',status:400,message:'Invalid login credentials'}),'INVALID_CREDENTIALS');
 assert.equal(authOutcome({code:'user_already_exists',status:422,message:'User already registered'}),'ALREADY_REGISTERED');
 assert.equal(authOutcome({code:'over_email_send_rate_limit',status:429,message:'email rate limit exceeded'}),'RATE_LIMITED');
 for(const x of [null,'x',{status:500,message:'boom'}])assert.equal(authOutcome(x),'OTHER');
 assert.match(loginFn,/if\(outcome==='CONFIRMATION_REQUIRED'\)\{setPendingEmail\(email\);return\}/);
 assert.match(loginFn,/if\(outcome==='INVALID_CREDENTIALS'\)\{setNotice\(tr\('auth\.invalidCredentials'\)\);return\}/);
 assert.match(fr['auth.invalidCredentials'],/^E-mail ou mot de passe incorrect/);
});
test('9 — resend: bounded by a 60 s cooldown on screen (Supabase limits server-side too), signup type only, rate limit answered calmly',()=>{
 assert.equal(RESEND_COOLDOWN_SECONDS,60);
 assert.equal(resendSecondsLeft(1_000_000,1_000_000),60);assert.equal(resendSecondsLeft(1_000_000,1_059_500),1);assert.equal(resendSecondsLeft(1_000_000,1_060_000),0);
 assert.match(resendFn,/if\(!auth\|\|!pendingEmail\|\|resendIn>0\)return;/);
 assert.match(resendFn,/auth\.auth\.resend\(\{type:'signup',email:pendingEmail,/);
 assert.match(resendFn,/setLastSentAt\(Date\.now\(\)\);if\(r\.error\)/,'the cooldown starts even when the server refuses: no hammering');
 assert.match(welcome,/disabled=\{busy\|\|resendIn>0\} onClick=\{resendConfirmation\}/);
});
test('15 — no account enumeration: the screen never reads whether the address already existed, and tells everybody the same thing',()=>{
 assert.doesNotMatch(page,/identities/);
 assert.match(fr['auth.alreadyHaveAccountHint'],/connectez-vous directement/);
 assert.match(resendFn,/setNotice\(tr\('auth\.resent'\)\)/);
});
test('13/14 — trial claim unchanged: only an authenticated arrival (session) reaches loadAccount; the consent gate is unchanged',()=>{
 assert.ok(loginFn.indexOf('setPendingEmail(email);setLastSentAt(Date.now());return}')<loginFn.indexOf('await loadAccount(t)'));
 assert.match(page,/if\(signup&&!legalAccepted\)\{setNotice\(tr\('login\.legalRequired'\)\);return\}/);
 assert.match(welcome,/<button type="button" className="primary" disabled=\{busy\|\|!auth\|\|!legalAccepted\} onClick=\{\(\)=>login\(true\)\}>/);
});
test('wording: every auth string exists in FR and EN, none mentions Supabase or a technical term',()=>{
 const keys=Object.keys(fr).filter(k=>k.startsWith('auth.'));
 assert.ok(keys.length>=18);
 for(const k of keys){assert.ok((en as Record<string,string>)[k],`missing EN ${k}`);for(const v of [(fr as Record<string,string>)[k],(en as Record<string,string>)[k]])assert.doesNotMatch(v,/supabase|token|auth\b|OTP|redirect/i,k)}
});

// ================================================================ hotfix #11 — confirmation return + auth error UX
// Post-beta audit: a session arriving from the confirmation link (or restored on reload) claimed the trial but left the
// user on the welcome screen with no message — only login() entered the app. An expired/used link was silent, and an
// unexpected or network error was shown raw, in English.
import * as authUx from '../src/domain/auth-ux.ts';
const listener=page.slice(page.indexOf('auth.auth.onAuthStateChange('),page.indexOf('return()=>data.subscription.unsubscribe()'));
const enterFn=page.slice(page.indexOf('async function enterWorkspace('),page.indexOf('async function enterWorkspace(')+600);
test('#11 A/B — a session from the confirmation link or a reload enters the app: loadProjects + loadAccount + live mode, no second login',()=>{
 assert.ok(page.includes('async function enterWorkspace('),'one shared entry for a session that did not come from login()');
 assert.match(enterFn,/await loadProjects\(t\);await loadAccount\(t\);setMode\('live'\)/);
 assert.match(listener,/if\(event==='SIGNED_IN'\|\|event==='INITIAL_SESSION'\)/);
 assert.match(listener,/modeRef\.current==='welcome'&&!loginInFlight\.current\?void enterWorkspace\(t\):void loadAccount\(t\)/,'the welcome screen enters the app; an in-flight login or any other mode keeps the previous behaviour (no double load)');
 assert.match(page,/loginInFlight\.current=true;try\{/);assert.match(page,/finally\{loginInFlight\.current=false\}/);
});
test('#11 A — confirmation success message, non-blocking, only after entering with a session',()=>{
 assert.equal(authUx.authReturnFromUrl('https://prospectos-v0.vercel.app/#access_token=x&expires_in=3600&refresh_token=y&token_type=bearer&type=signup'),'CONFIRMED');
 assert.equal(authUx.authReturnFromUrl('https://prospectos-v0.vercel.app/?type=signup'),'CONFIRMED');
 assert.equal(authUx.authReturnFromUrl('https://prospectos-v0.vercel.app/'),null);
 assert.match(enterFn,/if\(AUTH_RETURN==='CONFIRMED'&&!confirmedShown\.current\)\{confirmedShown\.current=true;setNotice\(tr\('auth\.emailConfirmed'\)\)\}/);
 assert.equal(fr['auth.emailConfirmed'],'Adresse confirmée — bienvenue dans ProspectOS');assert.ok(en['auth.emailConfirmed']);
 assert.ok(page.indexOf('const AUTH_RETURN=')<page.indexOf('const auth=sbUrl'),'read before the auth client consumes and clears the URL');
});
test('#11 C — no session: no app, no trial claim, no authenticated load',()=>{
 const noSession=listener.slice(listener.indexOf('else {'));
 assert.doesNotMatch(noSession,/enterWorkspace|loadAccount|loadProjects|activate-trial/);
 assert.match(noSession,/setMode\('welcome'\)/);
 assert.ok(listener.indexOf('if(session){')<listener.indexOf('enterWorkspace(t)'),'entering always requires a session');
});
test('#11 D — expired or already used link: "Me connecter" tab, plain French message, never a raw Supabase error',()=>{
 for(const url of ['https://p.example/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired','https://p.example/?error=access_denied&error_code=otp_expired','https://p.example/?error_code=flow_state_expired'])
  assert.equal(authUx.authReturnFromUrl(url),'LINK_INVALID',url);
 assert.match(page,/if\(AUTH_RETURN==='LINK_INVALID'\)\{setAuthView\('login'\);setNotice\(tr\('auth\.linkInvalid'\)\)/);
 assert.match(fr['auth.linkInvalid'],/n’est plus valide/);assert.match(fr['auth.linkInvalid'],/connectez-vous|renvoyer/i);
 assert.doesNotMatch(fr['auth.linkInvalid'],/otp|expired|supabase/i);
});
test('#11 E/F — unknown auth error → generic French message; network error → connection message; known cases unchanged',()=>{
 assert.equal(authUx.authErrorKey({name:'AuthRetryableFetchError',status:0,message:'Failed to fetch'}),'auth.networkError');
 assert.equal(authUx.authErrorKey(new TypeError('Failed to fetch')),'auth.networkError');
 assert.equal(authUx.authErrorKey({status:0,message:'Load failed'}),'auth.networkError');
 assert.equal(authUx.authErrorKey({code:'weak_password',status:422,message:'Password should contain…'}),'auth.unknownError');
 assert.equal(authUx.authErrorKey(null),'auth.unknownError');
 assert.match(fr['auth.unknownError'],/Une erreur est survenue/);assert.match(fr['auth.networkError'],/connexion/);
 assert.doesNotMatch(page,/throw result\.error|throw r\.error/,'no raw Supabase error reaches the screen');
 assert.match(loginFn,/setNotice\(tr\(authErrorKey\(result\.error\)\)\);return\}/);
 assert.match(resendFn,/setNotice\(tr\(authErrorKey\(r\.error\)\)\);return\}/);
 // The specific translations stay first.
 assert.ok(loginFn.indexOf("isEmailRateLimitError(result.error)")<loginFn.indexOf('authErrorKey(result.error)'));
 assert.ok(loginFn.indexOf("outcome==='INVALID_CREDENTIALS'")<loginFn.indexOf('authErrorKey(result.error)'));
});
test('#11 G — demo mode untouched: the listener only enters from the welcome screen, demo() is unchanged',()=>{
 assert.match(page,/function demo\(\)\{clearWorkspace\(\);/);
 assert.match(page,/const modeRef=useRef\(mode\);modeRef\.current=mode;/);
});
test('#11 H — anti-enumeration kept: no account-existence read, neutral sign-up answer unchanged',()=>{
 assert.doesNotMatch(page,/identities/);
 assert.match(loginFn,/if\(!result\.data\.session\)\{setPendingEmail\(email\);setLastSentAt\(Date\.now\(\)\);return\}/);
 for(const k of ['auth.emailConfirmed','auth.linkInvalid','auth.unknownError','auth.networkError'])for(const v of [(fr as Record<string,string>)[k],(en as Record<string,string>)[k]])assert.doesNotMatch(v??'',/supabase|token|existe|exists/i,k);
});
