// WEB-1 — ProspectOS 2.0 public homepage (docs/UI_V2.md). Pins the flag (runtime, Preview only), the flag-OFF parity of the
// legacy welcome screen with main, the commercial behaviour taken verbatim from app/page.tsx (trial CTA, destination, sign-up
// card, prices, legal links), invented demo companies only, no generic SaaS wording, the colour rules and the contrast of the
// tokens the page uses. Browser behaviour (320 / 390 / 768 / 1440, overflow, CTA above the fold, demo detail, sign-in, measured
// contrast, reduced motion / transparency, forced colours) is checked with Playwright against a flag-ON build.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {webV2HomeEnabled} from '../src/ui/v2/home/flag.ts';
import {HOME_COPY,demoCompanies,HERO_DEMO_ID} from '../src/ui/v2/home/copy.ts';
import {light,dark} from '../src/ui/v2/tokens.ts';
import {composite,contrastRatio} from '../src/ui/v2/color.ts';
import {legacyWelcome} from './welcome-screen.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const page=read('../app/page.tsx');
const home=read('../src/ui/v2/home/HomeV2.tsx');
const copySrc=read('../src/ui/v2/home/copy.ts');
const css=read('../src/ui/v2/home/home.css');
const allCopy=JSON.stringify([HOME_COPY,demoCompanies('fr'),demoCompanies('en')]);

test('flag — off by default, only "1" / "true", hard off when the platform says Production',()=>{
 assert.equal(webV2HomeEnabled({}),false);
 assert.equal(webV2HomeEnabled({WEB_V2_HOME_ENABLED:'false'}),false);
 assert.equal(webV2HomeEnabled({WEB_V2_HOME_ENABLED:'0'}),false);
 assert.equal(webV2HomeEnabled({WEB_V2_HOME_ENABLED:'yes'}),false);
 assert.equal(webV2HomeEnabled({WEB_V2_HOME_ENABLED:'1'}),true);
 assert.equal(webV2HomeEnabled({WEB_V2_HOME_ENABLED:' TRUE '}),true);
 assert.equal(webV2HomeEnabled({WEB_V2_HOME_ENABLED:'1',VERCEL_ENV:'production'}),false);
 assert.equal(webV2HomeEnabled({UI_V2_ENABLED:'1'}),false,'independent from the app flag');
});
test('endpoint — per request, never cached, a boolean only',async()=>{
 const src=read('../app/api/public/web-v2-home/route.ts');
 assert.match(src,/export const dynamic='force-dynamic';/);
 assert.match(src,/'cache-control':'no-store'/);
 const saved=process.env.WEB_V2_HOME_ENABLED;
 try{
  const {GET}=await import('../app/api/public/web-v2-home/route.ts');
  delete process.env.WEB_V2_HOME_ENABLED;
  let res=await GET();assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual(await res.json(),{enabled:false});
  process.env.WEB_V2_HOME_ENABLED='1';
  res=await GET();assert.deepEqual(await res.json(),{enabled:true});
 }finally{if(saved===undefined)delete process.env.WEB_V2_HOME_ENABLED;else process.env.WEB_V2_HOME_ENABLED=saved}
});
test('page — the flag is read at runtime and the v2 homepage code is loaded only when it is on',()=>{
 assert.match(page,/fetch\('\/api\/public\/web-v2-home',\{cache:'no-store'\}\)\.then\(r=>r\.ok\?r\.json\(\):null\)\.then\(c=>c\?\.enabled===true\?import\('\.\.\/src\/ui\/v2\/home\/HomeV2\.tsx'\):null\)/);
 assert.doesNotMatch(page,/import \{HomeV2\}|from '\.\.\/src\/ui\/v2\/home/,'never a static import: flag OFF ships no v2 homepage code on "/"');
 assert.doesNotMatch(read('../app/layout.tsx'),/WEB_V2_HOME|process\.env/,'never frozen in a static file');
});
test('flag OFF parity — the legacy welcome screen is byte-for-byte the one of main (119bb30)',()=>{
 const blk=page.slice(page.indexOf(" if(mode==='welcome'){"));
 assert.equal(createHash('sha256').update(legacyWelcome(page)).digest('hex'),'6e51c117bc0c9eed5ba4382d70ceb16446ec0675be672bacf1202f323a11405e');
 assert.match(blk,/\n  if\(home\)return <home\.HomeV2 /,'the v2 homepage only replaces the screen when the module was loaded');
});
test('commercial behaviour — CTA, sign-up card, demo link and footer come unchanged from app/page.tsx',()=>{
 assert.match(page,/cta=\{\{label:tr\(trialFull\?'landing\.createAccountCta':'landing\.trialCta'\),sub:trialFull\?null:tr\('landing\.trialSub'\)\}\}/,'same CTA wording and trial sub-line rule as main');
 assert.match(page,/authCard=\{authCard\} seoLinks=\{seoLinks\} footer=\{footer\}/,'the very same sign-up card, SEO links and footer nodes');
 assert.match(page,/demoLabel=\{tr\('landing\.exploreDemo'\)\} onDemo=\{demo\}/);
 assert.match(page,/onLogin=\{\(\)=>switchAuthView\('login'\)\}>\{pricingModal\}<\/home\.HomeV2>/);
 assert.match(page,/const authCard=<section className="login card" id="inscription">/,'the CTA destination still exists');
 assert.match(home,/<a className="pos-btn pos-btn--primary pos-btn--lg" href="#inscription" data-testid="home-cta">\{cta\.label\}<\/a>/,'restyled, same destination, same label');
 assert.match(home,/\{cta\.sub&&<p className="pos-home__cta-sub">\{cta\.sub\}<\/p>\}/);
 assert.doesNotMatch(home+copySrc,/fetch\(|\/api\/|stripe|checkout|supabase|localStorage/i,'presentation only: no call, no payment, no storage');
});
test('no price, trial or legal wording of its own — it all comes from src/i18n',()=>{
 assert.doesNotMatch(allCopy,/€|\beur\b|\d+\s*(jours|days)\b.*essai|essai|trial|gratuit|free|carte bancaire|credit card|CGU|CGV|Terms/i);
 assert.doesNotMatch(allCopy,/\b(49|99|179|60)\b/);
});
test('demo — invented companies only, labelled as such; no real brand, logo or photo',()=>{
 assert.deepEqual(demoCompanies('fr').map(c=>c.name),['Atelier Norde','Maison Alba','Café Lumen']);
 assert.equal(demoCompanies('fr').find(c=>c.id===HERO_DEMO_ID)!.name,'Maison Alba');
 const REAL=/\b(Quick|Mojo|O.?Crousti|McDonald|Burger King|KFC|Starbucks|Subway|Domino|Five Guys|Paul|Brioche Dorée|Pizza Hut|Buffalo Grill|Hippopotamus|Courtepaille|Flunch|Del Arte|Big Fernand|Pret A Manger|Carrefour|Leclerc|Auchan|Decathlon|Fnac|Darty)\b/i;
 assert.doesNotMatch(allCopy+home,REAL);
 assert.doesNotMatch(home+css,/<img|<Image|\.png|\.jpe?g|\.webp|\.svg['"]|url\(/i,'no logo or photo');
 assert.match(HOME_COPY.fr.demo.label,/fictif/i);assert.match(HOME_COPY.en.demo.label,/fictitious/i);
 assert.match(HOME_COPY.fr.demo.caption,/inventée/);
 assert.equal((home.match(/\{d\.label\}|\{copy\.demo\.label\}/g)??[]).length,2,'the hero card and every preview say "Exemple fictif"');
 assert.doesNotMatch(allCopy,/client|utilise(nt)? ProspectOS|use ProspectOS|trust(ed)? by|nous font confiance/i,'no company presented as a customer');
});
test('copy — the hero, positioning and workflow asked for; no generic SaaS claims',()=>{
 const fr=HOME_COPY.fr;
 assert.equal(fr.hero.title,'Arrêtez de prospecter toute votre liste.');
 assert.deepEqual(fr.hero.lines,['Qui contacter.','Pourquoi maintenant.','Avec quelles preuves.']);
 assert.equal(fr.hero.subtitle,'ProspectOS détecte les entreprises qui correspondent à votre cible et les signaux qui rendent le timing pertinent.');
 assert.equal(fr.hero.how,'Voir comment ça fonctionne');
 assert.equal(fr.positioning.line1,'Une liste vous dit qui existe.');
 assert.equal(fr.positioning.line2,'ProspectOS vous dit qui mérite votre attention maintenant.');
 assert.deepEqual(fr.positioning.pillars.map(p=>[p.key,p.question]),[['Fit','Est-ce la bonne entreprise ?'],['Timing','Pourquoi maintenant ?'],['Preuve','Sur quoi repose la recommandation ?']]);
 assert.deepEqual(fr.workflow.steps.map(s=>s.name),['Cible','Signaux publics','Preuves','Recommandation','Action humaine']);
 assert.deepEqual(fr.workflow.motto,['L’IA propose.','Vous vérifiez.','Vous décidez.']);
 assert.match(fr.workflow.guarantee,/Aucun envoi automatique.*sans votre validation/);
 const BANNED=/boost|gagne[rz] du temps|save time|révolution|revolution|propulsé par l.IA|AI-powered|powered by AI|ultra[- ]qualifi|hyper[- ]qualifi|10x|game[- ]changer|leads? (chauds|qualifiés)/i;
 assert.doesNotMatch(allCopy,BANNED);
 assert.doesNotMatch(allCopy,/score|\d+\s*\/\s*100|formule|formula/i,'no score or formula on the homepage');
 // FR and EN have the same shape.
 const shape=(o:unknown):unknown=>Array.isArray(o)?o.map(shape):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,shape(v)])):typeof o;
 assert.deepEqual(shape(HOME_COPY.en),shape(HOME_COPY.fr));
});
test('colour rules — green for CONTACT only, indigo for the primary actions, no gradient text',()=>{
 for(const l of ['fr','en'] as const){
  for(const c of demoCompanies(l)){
   assert.equal(c.action?.tone==='contact',c.status==='contact',`${c.name}: green action only for CONTACT`);
  }
 }
 assert.doesNotMatch(css,/status-contact|action-contact|green/,'the page itself never paints green');
 assert.doesNotMatch(css,/background-clip:\s*text|-webkit-text-fill-color/,'no gradient text');
 assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|rgba?\(/i,'tokens only, no literal colour');
 assert.match(css,/\.pos-home__auth \.primary\{[^}]*background:var\(--pos-accent\)/,'the trial button is indigo');
});
test('contrast — the text roles the page uses pass AA on cards, on the canvas and on its strongest halos (both themes)',()=>{
 for(const t of [light,dark]){
  const c=t.colors;const canvases=[c.bg,...t.haloTints.map(h=>composite(h,c.bg))];
  for(const under of [...canvases,c['surface-card'],c['surface-inset']]){
   for(const role of ['text-1','text-2','text-3','accent'] as const){
    const r=contrastRatio(c[role],under);assert.ok(r>=4.5,`${t.name} ${role} ${r.toFixed(2)}`);
   }
  }
  assert.ok(contrastRatio(c['on-accent'],c.accent)>=4.5,`${t.name} on-accent`);
  assert.ok(contrastRatio(c.signal,c['surface-card'])>=4.5,`${t.name} signal`);
  assert.ok(contrastRatio(c['status-verified-fg'],c['surface-card'])>=4.5,`${t.name} verified`);
  assert.ok(contrastRatio(c['status-verify-fg'],composite(c['status-verify-bg'],c['surface-card']))>=4.5,`${t.name} verify note`);
 }
});
test('accessibility guards — reduced motion, reduced transparency, forced colours, 44 px, 320 px',()=>{
 assert.match(css,/@media \(prefers-reduced-motion:no-preference\)\{html:has\(\.pos-ui\.pos-home\)\{scroll-behavior:smooth\}\}/,'smooth scrolling only when motion is welcome');
 assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{[^@]*pos-fade/);
 assert.match(css,/@media \(prefers-reduced-transparency:reduce\)\{[^@]*backdrop-filter:none/);
 assert.match(css,/@supports not \(\(backdrop-filter:blur\(1px\)\)/);
 assert.match(css,/@media \(forced-colors:active\)\{/);
 assert.match(css,/\.locale-switch button\{min-width:40px;min-height:44px/);
 assert.match(css,/input\[type="password"\]\{display:block;width:100%;min-height:var\(--pos-size-target\)/);
 assert.match(css,/@media \(max-width:359px\)/);
 assert.match(home,/aria-hidden="true" inert/,'the product previews are pictures, never focusable');
 assert.match(home,/role="img" aria-label=\{theme==='light'\?p\.mockAria:p\.mockDarkAria\}/);
 assert.match(home,/aria-expanded=\{panel==='why'\} aria-controls="pos-home-panel"/);
 assert.match(home,/<div className="pos-legacy">\{children\}<\/div>/,'the legacy pricing dialog keeps its own styles');
});
