// WEB-1 — ProspectOS 2.0 public homepage (docs/UI_V2.md). Pins the flag (runtime, Preview only), the flag-OFF parity of the
// legacy welcome screen with main, the commercial behaviour taken verbatim from app/page.tsx (trial CTA, destination, sign-up
// card, prices, legal links), invented demo companies only, no generic SaaS wording, the colour rules and the contrast of the
// tokens the page uses. Browser behaviour (320 / 390 / 768 / 1440, overflow, CTA above the fold, demo detail, sign-in, measured
// contrast, reduced motion / transparency, forced colours) is checked with Playwright against a flag-ON build.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
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

test('page — a build-time choice: the v2 homepage is in the prerendered HTML when the flag is on, absent otherwise',()=>{
 assert.match(page,/import \{WEB_V2\} from '\.\.\/src\/ui\/v2\/public\/flag\.ts';/);
 assert.match(page,/const HomeV2=WEB_V2\?dynamic\(\(\)=>import\('\.\.\/src\/ui\/v2\/home\/HomeV2\.tsx'\)\.then\(m=>m\.HomeV2\)\):null;/,'server-rendered (next/dynamic keeps SSR): no client swap');
 assert.doesNotMatch(page,/web-v2-home|fetch\('\/api\/public\/web/,'no runtime fetch of the flag any more');
 assert.doesNotMatch(page,/import \{HomeV2\}|from '\.\.\/src\/ui\/v2\/home/,'never a static import: built without the flag, "/" ships no v2 homepage styles');
 assert.doesNotMatch(read('../app/layout.tsx'),/WEB_V2|process\.env/);
});
test('flag OFF parity — the legacy welcome screen is byte-for-byte the one of main (119bb30)',()=>{
 const blk=page.slice(page.indexOf(" if(mode==='welcome'){"));
 assert.equal(createHash('sha256').update(legacyWelcome(page)).digest('hex'),'6e51c117bc0c9eed5ba4382d70ceb16446ec0675be672bacf1202f323a11405e');
 assert.match(blk,/\n  if\(HomeV2\)return <HomeV2 /,'the v2 homepage replaces the screen only in a site built with the flag');
});
test('commercial behaviour — CTA, sign-up card, demo link and footer come unchanged from app/page.tsx',()=>{
 assert.match(page,/cta=\{\{label:tr\(trialFull\?'landing\.createAccountCta':'landing\.trialCta'\),sub:trialFull\?null:tr\('landing\.trialSub'\)\}\}/,'same CTA wording and trial sub-line rule as main');
 assert.match(page,/authCard=\{authCard\} onLocale=\{setLocale\}/,'the very same sign-up card node');
 assert.match(page,/demoLabel=\{tr\('landing\.exploreDemo'\)\} onDemo=\{demo\}/);
 assert.match(page,/onLogin=\{\(\)=>switchAuthView\('login'\)\} contactLabel=\{tr\('landing\.footerContact'\)\}>\{pricingModal\}<\/HomeV2>/);
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
 // The one image (31 oct. 2026): the video's poster, a frame of the same video (the "why this recommendation" panel with its
 // "Exemple fictif · entreprises inventées" label), so Safari shows something before playback. Still no logo and no photo.
 const POSTER="const HOME_VIDEO_POSTER='/videos/prospectos-presentation-poster.jpg';";
 assert.ok(home.includes(POSTER),'the poster is the named frame of the presentation video');
 assert.match(home,/aria-label=\{v\.label\} poster=\{HOME_VIDEO_POSTER\}/,'used only as the video poster');
 const poster=statSync(new URL('../public/videos/prospectos-presentation-poster.jpg',import.meta.url)).size;
 assert.ok(poster>0&&poster<200*1024,`the poster stays light (${poster} bytes)`);
 assert.doesNotMatch(home.replace(POSTER,'')+css,/<img|<Image|\.png|\.jpe?g|\.webp|\.svg['"]/i,'no logo or photo');
 assert.doesNotMatch(css,/\burl\(/,'no background image either');
 assert.match(HOME_COPY.fr.demo.label,/fictif/i);assert.match(HOME_COPY.en.demo.label,/fictitious/i);
 assert.match(HOME_COPY.fr.demo.caption,/inventée/);
 assert.doesNotMatch(home,/demoCompanies|DemoCard|TodayPreview/,'the demo companies appear only in the video, whose label says they are invented');
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
 assert.match(read('../src/ui/v2/public/styles.ts'),/\.locale-switch>\*\{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:44px/,'shared header: 44 px language targets');
 assert.match(css,/input\[type="password"\]\{display:block;width:100%;min-height:var\(--pos-size-target\)/);
 assert.match(read('../src/ui/v2/public/styles.ts'),/@media \(max-width:359px\)/,'320 px: the logo mark alone');
 // Short page (mobile feedback, oct. 2026): hero, video, the three pillars with the guarantee, sign-up. Nothing else.
 const order=['id="pos-home-title"','<PresentationVideo ','id="pos-home-positioning"','{copy.workflow.guarantee}','id="pos-home-signup"'].map(k=>home.indexOf(k));
 assert.ok(order.every((x,i)=>x>0&&(i===0||x>order[i-1]!)),`sections in order: ${order}`);
 assert.equal((home.match(/<section /g)??[]).length,4,'four sections only');
 assert.doesNotMatch(home,/pos-home-workflow|pos-home-product|pos-home__dark/,'no step list and no light / dark previews any more');
 assert.match(home,/href="#presentation">\{copy\.hero\.how\}<\/a>/,'"Voir comment ça fonctionne" leads to the video');
 assert.match(home,/<div className="pos-legacy">\{children\}<\/div>/,'the legacy pricing dialog keeps its own styles');
});
test('presentation video — silent, never auto-played against reduced motion, controls and a readable text alternative',()=>{
 assert.match(home,/const HOME_VIDEO_SRC='\/videos\/prospectos-presentation\.mp4';/);
 const size=statSync(new URL('../public/videos/prospectos-presentation.mp4',import.meta.url)).size;
 assert.ok(size>0&&size<10*1024*1024,`the video file ships with the site and stays light (${size} bytes)`);
 assert.match(home,/<video ref=\{ref\} src=\{HOME_VIDEO_SRC\} muted loop playsInline controls preload="metadata" aria-label=\{v\.label\}/);
 assert.doesNotMatch(home,/autoPlay|autoplay/,'started by script only, while on screen');
 assert.match(home,/matchMedia\('\(prefers-reduced-motion: no-preference\)'\)/,'no automatic playback when the visitor asked for reduced motion');
 assert.match(home,/<details className="pos-home__transcript">/,'the on-screen text is readable without the video');
 for(const l of ['fr','en'] as const){
  assert.ok(HOME_COPY[l].video.transcript.length>=6);
  assert.match(HOME_COPY[l].video.label,/inventées|invented/,'the video says its companies are invented');
 }
 assert.match(home,/onClick=\{onDemo\}>\{demoLabel\}/,'the demo link of app/page.tsx stays on the page, next to the video');
});
