import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EDITOR, HOSTING, MISSING, MISSING_COMMERCIAL, TERMS_VERSION, PRIVACY_VERSION, LEGAL_PAGES} from '../src/domain/legal.ts';

const legalRoutes=['mentions-legales','cgu','confidentialite','cgv'];

// ------------------------------------------------------------
// A — the 4 public legal pages exist, render without authentication, and never call any gated/
// server-authenticated helper (no requireActiveEntitlement, no authenticatedDb, no Supabase call at
// all — same static-source-proof convention as tests/seo-routes.test.ts).
// ------------------------------------------------------------
test('A — the 4 legal routes exist and use the shared LegalPage layout',async()=>{
 for(const slug of legalRoutes){
  const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
  assert.match(source,/LegalPage/,`${slug} does not use the shared LegalPage layout`);
 }
});
test('A — none of the 4 legal pages ever call an authenticated/gated helper (public, no auth required)',async()=>{
 for(const slug of legalRoutes){
  const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
  for(const forbidden of [/requireActiveEntitlement/,/authenticatedDb/,/createClient\(/,/@supabase\/supabase-js/])
   assert.doesNotMatch(source,forbidden,`${slug} must never depend on authentication or a Supabase client — naming Supabase in prose (as a data processor) is fine, importing/calling its client is not`);
 }
});
test('A — none of the 4 legal pages declare a client component ("use client") — they are static, server-rendered pages with no browser-only API, no cookie/storage access',async()=>{
 for(const slug of legalRoutes){
  const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
  assert.doesNotMatch(source,/use client/);
 }
});

// ------------------------------------------------------------
// B — no invented legal identity. Every EDITOR/HOSTING field is either the one value verified from
// the product itself (EDITOR_NAME), or the exact '[À FOURNIR]' sentinel — never a fabricated SIREN,
// address, status, or contact.
// ------------------------------------------------------------
test('B — EDITOR_NAME is the one identity fact actually verifiable from the product (matches the production organization name)',()=>{
 assert.equal(EDITOR.name,'Foodatoi');
});
test('B — every other legal identity field is the explicit MISSING placeholder, never invented',()=>{
 for(const field of [EDITOR.legalStatus,EDITOR.siren,EDITOR.siret,EDITOR.rcs,EDITOR.vatNumber,EDITOR.address,EDITOR.phone,EDITOR.legalEmail,EDITOR.publicationDirector,EDITOR.capital])
  assert.equal(field,MISSING);
});
test('B — hosting providers are named from the real architecture (Vercel, Supabase), never invented, but their exact addresses are left explicit rather than guessed',()=>{
 assert.equal(HOSTING.application.name,'Vercel Inc.');
 assert.equal(HOSTING.database.name,'Supabase');
 assert.equal(HOSTING.application.address,MISSING);
 assert.equal(HOSTING.database.address,MISSING);
});
test('B — no page ever renders a fabricated SIREN/SIRET-shaped number or a fictional address',async()=>{
 for(const slug of legalRoutes){
  const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b\d{9}\b/,`${slug} must never contain a 9-digit-looking SIREN`);
  assert.doesNotMatch(source,/\b\d{14}\b/,`${slug} must never contain a 14-digit-looking SIRET`);
 }
});

// ------------------------------------------------------------
// C — CGV never implies a paid offer already exists.
// ------------------------------------------------------------
test('C — the CGV page explicitly states no paid offer exists yet, and commercial terms use the MISSING_COMMERCIAL placeholder, never an invented price/duration/payment method',async()=>{
 const source=await readFile(new URL('../app/cgv/page.tsx',import.meta.url),'utf8');
 assert.match(source,/n’a pas encore ouvert d’offre payante/);
 assert.match(source,/MISSING_COMMERCIAL/);
 for(const forbidden of [/\d+\s?€/,/Stripe/,/carte bancaire/i,/prélèvement/i])
  assert.doesNotMatch(source,forbidden,'the CGV page must never invent a price or payment method');
});

// ------------------------------------------------------------
// D — CGU never over-promises (accuracy, results, conversion, automatic legal compliance).
// ------------------------------------------------------------
test('D — the CGU explicitly disclaim absolute accuracy, commercial results, conversion rates, and automatic legality of contact',async()=>{
 const source=await readFile(new URL('../app/cgu/page.tsx',import.meta.url),'utf8');
 assert.match(source,/ne garantit pas.*exactitude absolue/s);
 assert.match(source,/résultat commercial/);
 assert.match(source,/taux de conversion/);
 assert.match(source,/licéité automatique d’une prise de contact/);
 assert.match(source,/Sources d’abord\. Action humaine toujours\./);
});

// ------------------------------------------------------------
// E — privacy policy correctly reflects the real architecture: public-data nuance (never "public =
// free to use"), the real providers, the real export/delete mechanism, and the cookie conclusion.
// ------------------------------------------------------------
test('E — the privacy policy states the required negation ("public data ≠ freely usable without restriction") exactly once, in that negated form, never as a bare positive claim elsewhere on the page',async()=>{
 const source=await readFile(new URL('../app/confidentialite/page.tsx',import.meta.url),'utf8');
 assert.match(source,/ne signifie pas qu’elle est librement exploitable sans restriction/,'the required negation must be present');
 const occurrences=source.match(/librement exploitable sans restriction/g)??[];
 assert.equal(occurrences.length,1,'the phrase must appear exactly once — inside the required negation, never repeated as a separate bare claim');
 assert.match(source,/base juridique appropriée/);
});
test('E — the privacy policy names the real providers (Supabase, Vercel, Anthropic, Brave Search) and never claims data is sold or shared with a data broker',async()=>{
 const source=await readFile(new URL('../app/confidentialite/page.tsx',import.meta.url),'utf8');
 for(const provider of ['Supabase','Vercel','Anthropic','Brave Search'])assert.match(source,new RegExp(provider));
 assert.match(source,/[Aa]ucune donnée n’est vendue/);
});
test('E — the privacy policy describes export and deletion exactly as they behave (anonymization, not physical deletion; organizational data retained; audit references retained)',async()=>{
 const source=await readFile(new URL('../app/confidentialite/page.tsx',import.meta.url),'utf8');
 assert.match(source,/anonymisées/);
 assert.match(source,/ne sont.*pas.*supprimées|ne sont pas supprimées/);
 assert.match(source,/références.*d.audit|d.audit.*conservées/);
 assert.doesNotMatch(source,/suppression (physique|totale|définitive de toutes)/i,'must never claim total physical erasure of all historical data');
});
test('E — the privacy policy concludes no cookie consent banner is required and states why (strictly necessary session storage only)',async()=>{
 const source=await readFile(new URL('../app/confidentialite/page.tsx',import.meta.url),'utf8');
 assert.match(source,/ne requièrent pas de recueil de consentement/);
 assert.match(source,/[Aa]ucune bannière de consentement/);
});
test('E — no analytics/marketing tracker (Google Analytics, Meta Pixel, Hotjar) is ever mentioned as present, and none exists in package.json',async()=>{
 const source=await readFile(new URL('../app/confidentialite/page.tsx',import.meta.url),'utf8');
 for(const tracker of [/Google Analytics/,/Meta Pixel/,/Hotjar/,/Mixpanel/])assert.doesNotMatch(source,tracker);
 const pkg=await readFile(new URL('../package.json',import.meta.url),'utf8');
 for(const tracker of ['analytics','gtag','hotjar','mixpanel','segment','posthog'])
  assert.doesNotMatch(pkg.toLowerCase(),new RegExp(tracker),`package.json must not depend on ${tracker}`);
});
test('E — CNIL complaint right is mentioned',async()=>{
 const source=await readFile(new URL('../app/confidentialite/page.tsx',import.meta.url),'utf8');
 assert.match(source,/CNIL/);
});

// ------------------------------------------------------------
// F — footer: present on the public landing screen, links to all 4 legal pages, mobile-first (reuses
// the existing responsive .site-footer rule, no design regression to the existing layout classes).
// ------------------------------------------------------------
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
test('F — the welcome/landing screen renders a site-footer with the copyright line and all 4 legal page links',()=>{
 const welcomeMatch=page.match(/if\(mode==='welcome'\)return <main className="welcome">[\s\S]*?<\/main>;/);
 assert.ok(welcomeMatch,'welcome screen JSX not found');
 const welcome=welcomeMatch[0];
 assert.match(welcome,/className="site-footer"/);
 assert.match(welcome,/© 2026 ProspectOS/);
 // The footer renders all 4 pages via LEGAL_PAGES.map (single source of truth, see src/domain/legal.ts)
 // rather than 4 literal hrefs — asserting the map call is the correct proof, not a per-page literal.
 const footerMatch=welcome.match(/<footer className="site-footer">[\s\S]*?<\/footer>/);
 assert.ok(footerMatch,'site-footer block not found');
 assert.match(footerMatch[0],/LEGAL_PAGES\.map\(p=><a key=\{p\.href\} href=\{p\.href\}>\{p\.label\}<\/a>\)/);
});
test('F — the footer CSS is mobile-first: a base rule plus an explicit narrow-viewport override, matching the existing responsive pattern',()=>{
 assert.match(css,/\.site-footer\{/);
 assert.match(css,/@media\(max-width:700px\)\{\.site-footer\{/);
});
test('F — the authenticated app also links to the 4 legal pages (from the account modal), without adding a permanent nav item that would clutter the main interface',()=>{
 const accountModalMatch=page.match(/\{modal==='account'&&<div className="modal-backdrop"[\s\S]*?<\/section><\/div>\}/);
 const accountModal=accountModalMatch?.[0]??'';
 assert.ok(accountModal,'account modal JSX not found');
 assert.match(accountModal,/className="legal-nav"/);
 const navMatch=accountModal.match(/<nav className="legal-nav">[\s\S]*?<\/nav>/);
 assert.ok(navMatch,'legal-nav block not found in account modal');
 assert.match(navMatch[0],/LEGAL_PAGES\.map\(p=><a key=\{p\.href\} href=\{p\.href\} target="_blank" rel="noreferrer">\{p\.label\}<\/a>\)/);
});

// ------------------------------------------------------------
// G — signup: legal links accessible before acceptance, checkbox never pre-checked, gates only the
// signup button (never the login button for an existing account).
// ------------------------------------------------------------
test('G — the signup checkbox defaults to unchecked (never pre-checked) via useState(false)',()=>{
 assert.match(page,/const \[legalAccepted,setLegalAccepted\]=useState\(false\)/);
});
test('G — the CGU/confidentialité links are present in the signup form, opening in a new tab so they remain reachable before ticking the box',()=>{
 const welcomeMatch=page.match(/if\(mode==='welcome'\)return <main className="welcome">[\s\S]*?<\/main>;/);
 const welcome=welcomeMatch![0];
 assert.match(welcome,/href="\/cgu" target="_blank"/);
 assert.match(welcome,/href="\/confidentialite" target="_blank"/);
});
test('G — "Créer un compte" is disabled until the checkbox is checked; "Se connecter" (existing accounts) is never gated by it',()=>{
 const welcomeMatch=page.match(/if\(mode==='welcome'\)return <main className="welcome">[\s\S]*?<\/main>;/);
 const welcome=welcomeMatch![0];
 assert.match(welcome,/onClick=\{\(\)=>login\(true\)\}>Créer un compte/);
 const createAccountButton=welcome.match(/<button type="button" disabled=\{[^}]*\} onClick=\{\(\)=>login\(true\)\}>Créer un compte<\/button>/);
 assert.ok(createAccountButton,'Créer un compte button not found with an expected disabled expression');
 assert.match(createAccountButton[0],/!legalAccepted/);
 const loginButton=welcome.match(/<button className="primary" disabled=\{[^}]*\}>Se connecter<\/button>/);
 assert.ok(loginButton,'Se connecter button not found');
 assert.doesNotMatch(loginButton[0],/legalAccepted/,'the existing-account login button must never depend on the new signup-only checkbox');
});
test('G — login() re-checks acceptance server-request-side (not just via the disabled button) before ever calling signUp, so a bypassed disabled attribute still can\'t sign up without acceptance',()=>{
 assert.match(page,/if\(signup&&!legalAccepted\)\{setNotice\('[^']*'\);return\}/);
});

// ------------------------------------------------------------
// H — versioned acceptance: recorded via Supabase Auth's own user_metadata on signUp (no new table,
// no new migration), and never read back anywhere to gate/block anything (so an existing account,
// including the historical INTERNAL one, is never affected).
// ------------------------------------------------------------
test('H — signUp records terms_version/privacy_version/terms_accepted_at via Supabase Auth\'s own options.data (user_metadata) — no new table, no new migration',()=>{
 assert.match(page,/auth\.auth\.signUp\(\{email,password,options:\{data:\{terms_accepted_at:new Date\(\)\.toISOString\(\),terms_version:TERMS_VERSION,privacy_version:PRIVACY_VERSION\}\}\}\)/);
});
test('H — TERMS_VERSION and PRIVACY_VERSION are non-empty version strings, single source of truth shared by the pages and the signup call',()=>{
 assert.match(TERMS_VERSION,/^\d{4}-\d{2}-\d{2}$/);
 assert.match(PRIVACY_VERSION,/^\d{4}-\d{2}-\d{2}$/);
});
test('H — the acceptance metadata is never read back anywhere in the codebase to gate or block an action — it is a pure evidentiary record, never an enforcement mechanism (so an existing account, including INTERNAL, is never retroactively blocked)',async()=>{
 for(const path of ['../src/server/entitlement.ts','../app/api/v1/[...path]/route.ts','../src/discovery/api.ts']){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(source,/terms_accepted_at|terms_version|privacy_version/,`${path} must never read the acceptance metadata — it must never become a gate`);
 }
});
test('H — no new migration file was introduced for versioned acceptance (011 remains the latest — the BETA hotfix, untouched by this bloc)',async()=>{
 const {readdir}=await import('node:fs/promises');
 const files=await readdir(new URL('../db/migrations/',import.meta.url));
 const latest=files.filter(f=>/^\d+_/.test(f)).sort().at(-1);
 assert.equal(latest,'011_beta_entitlement_gate.sql','no migration 012+ should exist for this bloc — versioned acceptance uses Supabase Auth user_metadata instead');
});

// ------------------------------------------------------------
// I — no secret ever appears in any legal/domain file added by this bloc.
// ------------------------------------------------------------
test('I — no secret-shaped string (API key, ciphertext, master key name) appears in any legal page or the legal domain module',async()=>{
 const files=['../src/domain/legal.ts',...legalRoutes.map(s=>`../app/${s}/page.tsx`)];
 for(const path of files){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  for(const forbidden of [/BYOK_MASTER_KEY\s*=/,/SUPABASE_SERVICE_ROLE_KEY\s*=/,/sk-ant-/,/encrypted_secret/,/auth_tag/])
   assert.doesNotMatch(source,forbidden,`${path} must never reference a secret value`);
 }
});
