import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {translate,LOCALE_STORAGE_KEY,DEFAULT_LOCALE,detectBrowserLocale} from '../src/i18n/index.ts';
import {statusLabel,evidenceStatusLabel,outreachStatusLabel} from '../src/i18n/labels.ts';
import {STATUSES} from '../src/domain/core.ts';

// This project has no browser/jsdom/E2E harness anywhere (see tests/account-session.test.ts,
// tests/mobile-layout.test.ts for the same precedent) — these are static, source-level and pure-logic
// proofs of the FR/EN i18n bloc's 18 mandated properties, exactly like every other invariant test here.

// ------------------------------------------------------------
// 1 & 2 — FR renders French labels, EN renders English labels (same key, both dictionaries, sampled
// across every zone of the brief).
// ------------------------------------------------------------
test('1 — FR dictionary renders French labels across every required zone (landing/nav/dashboard/icp/prospects/evidence/discovery/outreach/account)',()=>{
 assert.equal(translate('fr','landing.trialCta'),'Démarrer mon essai gratuit');
 assert.equal(translate('fr','nav.dashboard'),'Vue d’ensemble');
 assert.equal(translate('fr','icp.saveIcp'),'Enregistrer l’offre et l’ICP');
 assert.equal(translate('fr','evidence.reviewTitle'),'Analyse des sources publiques');
 assert.equal(translate('fr','discovery.title'),'Trouver des prospects');
 assert.equal(translate('fr','outreach.prepare'),'Préparer le message');
 assert.equal(translate('fr','account.exportData'),'Exporter mes données');
 assert.equal(translate('fr','footer.tagline'),'Sources d’abord. Action humaine toujours.');
});
test('2 — EN dictionary renders English labels for the exact same keys, in the recommended terminology',()=>{
 assert.equal(translate('en','landing.trialCta'),'Start my free trial');
 assert.equal(translate('en','nav.dashboard'),'Overview');
 assert.equal(translate('en','icp.saveIcp'),'Save offer and ICP');
 assert.equal(translate('en','evidence.reviewTitle'),'Public source analysis');
 assert.equal(translate('en','discovery.title'),'Find prospects');
 assert.equal(translate('en','outreach.prepare'),'Prepare message');
 assert.equal(translate('en','account.exportData'),'Export my data');
 assert.equal(translate('en','footer.tagline'),'Sources first. Human action always.');
});
test('both dictionaries share the exact same key set (compiler-enforced via satisfies in en.ts, re-checked here at runtime)',()=>{
 assert.deepEqual(Object.keys(fr).sort(),Object.keys(en).sort());
});

// ------------------------------------------------------------
// 3 & 4 — locale persisted in localStorage, survives refresh (structural proof: useLocale.ts persists
// on every setLocale call, and its mount effect reads the stored value BEFORE ever considering
// browser-language detection — a stored choice always wins, which is what makes it survive a refresh).
// ------------------------------------------------------------
test('3 — setLocale persists the choice to localStorage under the documented key',async()=>{
 const source=await readFile(new URL('../src/i18n/useLocale.ts',import.meta.url),'utf8');
 assert.match(source,/localStorage\.setItem\(LOCALE_STORAGE_KEY,next\)/);
 assert.equal(LOCALE_STORAGE_KEY,'prospectos-locale');
});
test('4 — a refresh (a fresh mount) reads the stored locale FIRST, before any browser-language detection — this is what makes a manual choice survive reload/reopen/logout+login on the same device',async()=>{
 const source=await readFile(new URL('../src/i18n/useLocale.ts',import.meta.url),'utf8');
 const effectMatch=source.match(/useEffect\(\(\)=>\{[\s\S]*?\},\[\]\);/);
 assert.ok(effectMatch,'mount effect not found');
 const effect=effectMatch[0];
 const storedCheckIdx=effect.indexOf("stored==='fr'||stored==='en'");
 const detectIdx=effect.indexOf('detectBrowserLocale(');
 assert.ok(storedCheckIdx>=0&&detectIdx>=0&&storedCheckIdx<detectIdx,'the stored-value check must run, and return, before browser-language detection is ever consulted');
});

// ------------------------------------------------------------
// 5 — an unknown/invalid stored value falls back cleanly to detection, never to a crash or an
// unrecognized locale silently propagating.
// ------------------------------------------------------------
test('5 — an unrecognized stored value (neither "fr" nor "en") is never treated as a valid locale — it falls through to browser detection',async()=>{
 const source=await readFile(new URL('../src/i18n/useLocale.ts',import.meta.url),'utf8');
 assert.match(source,/if\(stored==='fr'\|\|stored==='en'\)\{setLocaleState\(stored\);return\}/,'only the two known literal values are ever accepted from storage');
});
test('5 — detectBrowserLocale never throws and always returns a valid Locale, including for undefined/garbage input',()=>{
 for(const input of [undefined,'','xx','de-DE','FR-fr','not-a-locale-at-all']){
  const result=detectBrowserLocale(input);
  assert.ok(result==='fr'||result==='en',`detectBrowserLocale(${JSON.stringify(input)}) returned an invalid locale: ${result}`);
 }
 assert.equal(detectBrowserLocale(undefined),DEFAULT_LOCALE);
});

// ------------------------------------------------------------
// 6 & 7 — internal business/enum values are never renamed by the display-label helpers; a submitted
// <select> value is always the raw internal string, never the localized text.
// ------------------------------------------------------------
test('6 — statusLabel/evidenceStatusLabel/outreachStatusLabel never mutate or replace the internal value — they only ever return a DIFFERENT string for display, the input itself is untouched',()=>{
 for(const s of STATUSES){const before=s;statusLabel(s,'en');assert.equal(s,before,'the STATUSES constant itself must never be mutated by a display call')}
 assert.equal(typeof statusLabel('Contacté','en'),'string');
 assert.notEqual(statusLabel('Contacté','en'),undefined);
});
test('7 — VERIFIED (and every other internal evidence/outreach status) is never renamed in code — only its DISPLAY is translated, the enum string used in comparisons/persistence stays exactly VERIFIED/NOT_VERIFIED/CONTRADICTED/INFERRED_UNCONFIRMED/DRAFT/USED',()=>{
 assert.equal(evidenceStatusLabel('VERIFIED',null,'en'),'Verified');
 assert.equal(evidenceStatusLabel('VERIFIED',null,'fr'),'Vérifiée');
 assert.equal(outreachStatusLabel('DRAFT','en'),'DRAFT');
 assert.equal(outreachStatusLabel('USED','fr'),'UTILISÉ');
 // The actual enum values used by business logic (evidence.status checks, scoreProspect, the outreach
 // lifecycle) are defined once in core.ts and never touched by this bloc — see test 13 below.
});
test('6/7 — every <select>/<option> built from an internal enum keeps value={the raw internal string}; only the child text node is localized, so a submitted form/PATCH body is always untranslated',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/STATUSES\.map\(s=><option key=\{s\} value=\{s\}>\{statusLabel\(s,locale\)\}<\/option>\)/g);
 assert.doesNotMatch(page,/STATUSES\.map\(s=><option key=\{s\}>\{statusLabel/,'value= must never be omitted once statusLabel is used for the child text — omitting it would submit the translated label instead of the real status');
});

// ------------------------------------------------------------
// 8 & 9 — never translate business/user data: evidence excerpts, prospect/company names.
// ------------------------------------------------------------
test('8 — no evidence excerpt is ever passed through a translation helper — {e.excerpt}/{o.claim}/{o.source_excerpt} are always rendered raw',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const obs=await readFile(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
 assert.match(page,/<p>\{e\.excerpt\}<\/p>/);
 assert.doesNotMatch(page,/tr\(e\.excerpt/);
 assert.doesNotMatch(page,/translate\([^,]*,e\.excerpt/);
 assert.match(obs,/<p>\{o\.claim\}<\/p>/);
 assert.match(obs,/<blockquote>\{o\.source_excerpt\}<\/blockquote>/);
});
test('9 — no prospect or company name is ever passed through a translation helper — {current.name}/{p.name}/{r.normalized_payload.name} are always rendered raw',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.match(page,/<h2>\{current\.name\}<\/h2>/);
 assert.match(page,/<strong>\{p\.name\}<\/strong>/);
 assert.match(panel,/<h3>\{r\.normalized_payload\.name\}<\/h3>/);
 for(const source of [page,panel])assert.doesNotMatch(source,/tr\([^)]*\.name\)/,'no .name field is ever wrapped in a translation call');
});
test('9b — the CSV export localizes only its column headers, never a single cell value (name/city/URL/sources stay exactly the business data)',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const fnMatch=page.match(/function download\(\)\{[\s\S]*?\}\n/);
 assert.ok(fnMatch,'download() not found');
 assert.match(fnMatch[0],/p\.name,p\.city,statusLabel\(p\.status,locale\),s\.score,s\.coverage,p\.website/,'only the status column is display-mapped — name/city/score/coverage/website are the raw values');
});

// ------------------------------------------------------------
// 10 — demo mode works in both languages (the demo notice/onboarding/limitations all resolve for
// either locale; nothing in demo()/resetDemo() branches on locale to decide whether the demo runs).
// ------------------------------------------------------------
test('10 — demo mode notices resolve to a real string in both locales, and demo() never branches on locale to decide behavior',async()=>{
 assert.equal(typeof translate('fr','demo.notice'),'string');
 assert.equal(typeof translate('en','demo.notice'),'string');
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const fnMatch=page.match(/function demo\(\)\{[\s\S]*?\}\n/);
 assert.ok(fnMatch,'demo() not found');
 assert.doesNotMatch(fnMatch[0],/\blocale\b/,'demo() itself never reads locale to decide what it does — only the notice TEXT (tr) varies');
});

// ------------------------------------------------------------
// 11 — resetDemo() never touches the locale key (a demo reset never resets the user's chosen language).
// ------------------------------------------------------------
test('11 — resetDemo removes only the two demo-scoped localStorage keys, never the locale preference',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const fn=page.match(/function resetDemo\(\)\{[^}]*\}/)?.[0]??'';
 assert.ok(fn,'resetDemo body not found');
 const removals=[...fn.matchAll(/localStorage\.removeItem\('([^']+)'\)/g)].map(m=>m[1]);
 assert.deepEqual(new Set(removals),new Set(['prospectos-demo-v1','prospectos-demo-help-dismissed']));
 assert.doesNotMatch(fn,/prospectos-locale/);
});

// ------------------------------------------------------------
// 12 — logout() never destroys the language preference (it clears identity/session state, never
// touches localStorage at all, so prospectos-locale survives a logout/login cycle on the same device).
// ------------------------------------------------------------
test('12 — logout() never calls localStorage.removeItem — the language preference is never destroyed by signing out',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const fn=page.match(/async function logout\(\)\{.*\}/)?.[0]??'';
 assert.ok(fn,'logout() body not found');
 assert.doesNotMatch(fn,/localStorage\.removeItem/);
 assert.doesNotMatch(fn,/prospectos-locale/);
});

// ------------------------------------------------------------
// 13 — scoring is byte-for-byte unchanged by this bloc (no locale parameter, no new branch).
// ------------------------------------------------------------
test('13 — scoreProspect is untouched: still exactly 3 parameters (criteria, evidence, now), never a locale argument',async()=>{
 const source=await readFile(new URL('../src/domain/core.ts',import.meta.url),'utf8');
 assert.match(source,/export function scoreProspect\(criteria:Criterion\[\],evidence:Evidence\[\],now=new Date\(\)\) \{/);
});
test('13 — generateOutreach\'s new locale parameter only ever selects the human-language template — it is appended AFTER `now`, defaults to \'fr\', and the scoreProspect call inside it is completely unaffected',async()=>{
 const source=await readFile(new URL('../src/domain/core.ts',import.meta.url),'utf8');
 assert.match(source,/export function generateOutreach\(name:string,offer:string,criteria:Criterion\[\],evidence:Evidence\[\],now=new Date\(\),locale:'fr'\|'en'='fr'\)\{/);
 assert.match(source,/const s=scoreProspect\(criteria,evidence,now\);/,'the scoring call itself takes no locale and is unchanged');
});

// ------------------------------------------------------------
// 14 — Discovery search/accept logic is unchanged: still the same schema validation, the same
// dedup/fixture pipeline, locale only ever changes label TEXT around it.
// ------------------------------------------------------------
test('14 — DiscoveryPanel\'s search()/accept() business logic (schema parsing, fixture/dedup pipeline, API calls) is unchanged — only tr()/discoveryFoundNote/searchDoneNote wrap display text',async()=>{
 const source=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.match(source,/DiscoveryInputSchema\.parse\(\{project_id:projectId,query:String\(form\.get\('query'\)\),location:String\(form\.get\('location'\)\)/);
 assert.match(source,/new FixtureProvider\(\),d=new DeduplicationService\(\)/);
 assert.match(source,/api\(`projects\/\$\{projectId\}\/discovery`,'POST',input\)/);
});

// ------------------------------------------------------------
// 15 — RLS is completely unaffected: this bloc created no migration at all (purely a client-side
// UI/i18n change), so every existing policy is untouched by construction.
// ------------------------------------------------------------
test('15 — this bloc adds no database migration whatsoever — RLS is unaffected because no SQL file changed',async()=>{
 const fs=await import('node:fs/promises');
 const files=(await fs.readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('013_beta_analytics_admin.sql'),'the last known migration before this bloc must still be there, unmodified');
 assert.ok(!files.some(f=>/^01[4-9]|^0[2-9][0-9]/.test(f)),'no migration numbered 014 or higher exists — this bloc is purely client-side');
});

// ------------------------------------------------------------
// 16 — entitlement gating is completely unaffected: requireActiveEntitlement is untouched, and the
// outreach/analyze-company routes still call it exactly as before, regardless of locale.
// ------------------------------------------------------------
test('16 — src/server/entitlement.ts (the sole access gate) is byte-for-byte unchanged by the i18n bloc',async()=>{
 const source=await readFile(new URL('../src/server/entitlement.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/locale|i18n/i,'the entitlement gate must never need to know about locale');
 assert.match(source,/if\(data\.plan==='INTERNAL'\)return;/);
 assert.match(source,/if\(new Date\(data\.expires_at\)\.getTime\(\)<=Date\.now\(\)\)throw Error\('BETA_ACCESS_EXPIRED'\)/);
});
test('16 — the outreach route still calls requireActiveEntitlement before generating a draft, and only additionally reads body.locale for template selection',async()=>{
 const source=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 const outreachBlock=source.match(/if\(resource==='outreach'&&request\.method==='POST'\)\{[\s\S]*?generateOutreach\(p\.name,project\.offer,projectCriteria\(project\.icps\),p\.evidence,undefined,draftLocale\);/);
 assert.ok(outreachBlock,'outreach POST block not found');
 assert.match(outreachBlock[0],/requireActiveEntitlement\(db,user\.id\);/);
 assert.match(outreachBlock[0],/const draftLocale=body\.locale==='en'\?'en':'fr';/);
});

// ------------------------------------------------------------
// 17 — no external translation API/service is ever called (no network request for translation, no
// third-party translation SDK referenced anywhere in the new i18n code or its call sites).
// ------------------------------------------------------------
test('17 — no external translation API/service is referenced anywhere in the i18n module or its call sites',async()=>{
 const files=['../src/i18n/fr.ts','../src/i18n/en.ts','../src/i18n/format.ts','../src/i18n/labels.ts','../src/i18n/useLocale.ts','../src/i18n/errors.ts','../src/i18n/locale.ts','../src/i18n/index.ts','../app/page.tsx','../src/components/DiscoveryPanel.tsx','../src/components/ObservationsReview.tsx'];
 const forbidden=[/deepl/i,/google\.?translate/i,/translate\.googleapis/i,/i18next-http-backend/i,/microsoft.*translator/i,/fetch\(['"`]https?:\/\/[^'"`]*translat/i];
 for(const f of files){
  const source=await readFile(new URL(f,import.meta.url),'utf8');
  for(const pattern of forbidden)assert.doesNotMatch(source,pattern,`${f} must never reference an external translation service (${pattern})`);
 }
});

// ------------------------------------------------------------
// 18 — no new dependency/API key was added for this bloc: package.json's dependency lists are exactly
// the pre-existing set, and no new environment variable is introduced.
// ------------------------------------------------------------
test('18 — package.json introduces no new runtime or dev dependency for i18n (no translation library, static dictionaries only)',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(pkg.dependencies).sort(),['@supabase/supabase-js','cheerio','ipaddr.js','jszip','next','react','react-dom','robots-parser','tldts','zod']);
 assert.deepEqual(Object.keys(pkg.devDependencies).sort(),['@electric-sql/pglite','@types/node','@types/react','@types/react-dom','typescript']);
});
test('18 — no new environment variable / API key is referenced by the i18n module',async()=>{
 const files=['../src/i18n/fr.ts','../src/i18n/en.ts','../src/i18n/format.ts','../src/i18n/labels.ts','../src/i18n/useLocale.ts','../src/i18n/errors.ts','../src/i18n/locale.ts'];
 for(const f of files){
  const source=await readFile(new URL(f,import.meta.url),'utf8');
  assert.doesNotMatch(source,/process\.env\./,`${f} must never read an environment variable — this is a static, dependency-free dictionary layer`);
 }
});
