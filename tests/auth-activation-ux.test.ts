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
