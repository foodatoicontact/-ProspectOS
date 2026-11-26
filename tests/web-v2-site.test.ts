// WEB-2 — ProspectOS 2.0 public site (docs/UI_V2.md). Pins: one build-time flag for the whole public site (no runtime
// decision, no client swap); every public route goes through one of the three envelopes (homepage, PublicSeoPage,
// LegalPage); built without the flag, those envelopes are byte-for-byte main's; the legal text, the SEO content, the prices,
// quotas, trial and plan files are untouched (hashes of main 119bb30); the shared header / footer and their links; the
// public styles are inlined only by the v2 envelope (tokens only). Browser checks (every route at 320 / 390 / 768 / 1440,
// no legacy colour, journeys, SEO parity flag OFF vs ON) run with Playwright against two builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withoutSelfOutreach} from './self-outreach-strip.ts';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {webV2Enabled} from '../src/ui/v2/public/flag.ts';
import {seoPages,sitemapEntries} from '../src/domain/seo.ts';

const root=new URL('../',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,root),'utf8');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

test('flag — one build-time switch for the whole public site',()=>{
 assert.equal(webV2Enabled(undefined),false);
 assert.equal(webV2Enabled(''),false);
 assert.equal(webV2Enabled('0'),false);
 assert.equal(webV2Enabled('false'),false);
 assert.equal(webV2Enabled('1'),true);
 assert.equal(webV2Enabled(' true '),true);
 const flag=read('src/ui/v2/public/flag.ts');
 assert.match(flag,/export const WEB_V2=webV2Enabled\(process\.env\.NEXT_PUBLIC_WEB_V2_ENABLED\);/,'a literal NEXT_PUBLIC_ read: inlined by Next on the server and in the browser, decided before the first paint');
 assert.ok(!existsSync(new URL('app/api/public/web-v2-home',root)),'no runtime endpoint any more');
 for(const f of ['app/page.tsx','src/components/PublicSeoPage.tsx','src/components/LegalPage.tsx','src/ui/v2/home/HomeV2.tsx','src/ui/v2/public/PublicSite.tsx'])
  assert.doesNotMatch(read(f),/WEB_V2_HOME_ENABLED|WEB_V2_[A-Z]+_ENABLED|web-v2-home/,`${f}: a single public flag, no per-page flag`);
 assert.doesNotMatch(read('app/layout.tsx'),/WEB_V2|process\.env/,'the root layout stays flag-free');
});

test('inventory — every public page renders through one of the three envelopes',()=>{
 // Owner decision (26 nov. 2026): /cockpit is the administrator's page (migration 056), never indexed — not a public page.
 // Owner decision (26 nov. 2026, PWA): /app is the start page of the installed app (the application itself), never indexed.
 const routes=readdirSync(new URL('app',root),{withFileTypes:true}).filter(d=>d.isDirectory()&&!['api','ui-v2','cockpit','app'].includes(d.name)&&existsSync(new URL(`app/${d.name}/page.tsx`,root))).map(d=>d.name);
 assert.ok(routes.length>=13,routes.join(','));
 for(const r of routes){
  const src=read(`app/${r}/page.tsx`);
  assert.ok(/<PublicSeoPage /.test(src)||/<LegalPage /.test(src),`/${r} must use PublicSeoPage or LegalPage`);
 }
 // Every SEO page has its route and is in the sitemap (the footer links to all of them).
 for(const p of seoPages){
  assert.ok(routes.includes(p.slug),`route for ${p.slug}`);
  assert.ok(sitemapEntries.some(e=>e.url.endsWith(`/${p.slug}`)),`sitemap has ${p.slug}`);
 }
 assert.match(read('src/ui/v2/public/PublicSite.tsx'),/\{seoPages\.map\(p=><li key=\{p\.slug\}><Link href=\{`\/\$\{p\.slug\}`\}>\{p\.navLabel\}<\/Link><\/li>\)\}/);
});

test('flag OFF parity — the legacy envelopes are byte-for-byte main’s once the v2 branch is set aside',()=>{
 const legacy=(p:string)=>{
  const s=read(p).split('\n// WEB-2 (docs/UI_V2.md)')[0]!.replace(/\n+$/,'\n');
  return s.split('\n').filter(l=>!/^import .*(ui\/v2\/public\/|Children,cloneElement)|if\(WEB_V2\)return </.test(l)).join('\n');
 };
 // Owner request (18 nov. 2026, SEO): the shared block renderer learns the « table » block (one case added), legacy and v2 alike.
 assert.equal(sha(legacy('src/components/PublicSeoPage.tsx')),'d4d4e3018903f1fda1fe09bacd525e1a8f75e9587fa487d96ae760aab28bde5f');
 assert.equal(sha(legacy('src/components/LegalPage.tsx')),'da4b65ef59aa51e03aa5994ada8ff714c510bb4d42211a7ab05dd38a87e470db');
 // The v2 branch is the first statement after the JSON-LD (SEO) or the very first one (legal): nothing else moved.
 assert.match(read('src/components/PublicSeoPage.tsx'),/\.replace\(\/<\/g,'\\\\u003c'\);\n  if\(WEB_V2\)return <SeoPageV2 page=\{page\} jsonLd=\{jsonLd\}>\{children\}<\/SeoPageV2>;\n  return <main className="seo-public seo-article-page">/);
 assert.match(read('src/components/LegalPage.tsx'),/children:React\.ReactNode\}\)\{\n if\(WEB_V2\)return <LegalPageV2 title=\{title\} updated=\{updated\} currentPath=\{currentPath\}>\{children\}<\/LegalPageV2>;\n return <main className="seo-public legal-page">/);
});

test('freeze — legal text, SEO content, prices, quotas, trial, plans, i18n and demo data are main’s (119bb30)',()=>{
 // Owner decision (1 nov. 2026): the contact address becomes contact@prospectos.fr everywhere (legal.ts, the FR/EN texts, the
 // SEO content), and the privacy policy describes the "3 prospects de votre zone" form (sections 3.6, 5, 6, 8; PRIVACY_VERSION).
 // Nothing else in these files changed: their hashes below are those of that change.
 const FROZEN:Record<string,string>={
  'app/cgu/page.tsx':'7287810445b66f0b67763eb06e8713b3fe42127521502eefe3cf15d6a485121c',
  'app/cgv/page.tsx':'49c80e19478f219668144f1c4039fca7464a15d5003584193db990bfb0269208',
  // 1 nov. 2026 (migration 040): the privacy policy also describes the opt-in morning recap (sections 3.7, 5, 6, 8).
  // Owner decision (18 nov. 2026, RGPD): section 8 states the retention applied by migration 048 — contact details 3 years without activity, signals, BODACC announcements.
  // Owner decision (25 nov. 2026, RGPD): section 13 « Programme partenaires » (candidates and partners, clients signed up with a
  // code; applications not accepted deleted within 6 months, migration 053), the ?ref= session storage in section 7, contact → 14.
  // Owner decision (26 nov. 2026, RGPD, admin cockpit — migration 056): section 3.6 covers both forms, now stored (12 months),
  // and the quote form; section 5 its legal basis; section 6 ntfy (push without any personal data); section 8 the 12 months.
  // Owner decision (26 nov. 2026, RGPD, PWA — migration 057): section 3.8 (installed app and notifications, the four measured
  // facts), section 6 the browsers' push services, section 7 the local storage and cache of the installed app, section 8.
  'app/confidentialite/page.tsx':'b25b3883ff30b0a7e2ff0e40ad0abd994110939bb776a83dd7a4e3835c0e7b04',
  'app/mentions-legales/page.tsx':'2efbad023e459aa36de624415f119b61f8372d80cecd1c60722f1a9f23b0f65e',
  // Owner decision (14 nov. 2026): ACTIVITY_FORMALITY.filedAt corrected to 13/11/2026, the date the INPI formality was signed.
  // Owner decision (18 nov. 2026, RGPD): PRIVACY_VERSION 2026-11-18 for the retention lines above; terms unchanged.
  // Owner decision (25 nov. 2026, RGPD): PRIVACY_VERSION 2026-11-25 for section 13 above; terms unchanged.
  // Owner decision (25 nov. 2026, external audit): EDITOR.vatStatus « TVA non applicable, article 293 B du CGI »; the Stripe
  // transfer text prepared behind STRIPE_SCC_CONFIRMED (false: the policy is unchanged); RCS untouched.
  // Owner decision (26 nov. 2026, RGPD): PRIVACY_VERSION 2026-11-26 for the forms stored above; terms unchanged.
  'src/domain/legal.ts':'4c8a91314b8b8326f07b1be1c74ff80165415d3c66a33f3462abc8784447a384',
  // WEB-2.1 / 2.2: the /a-propos entry (demo wording, recommendation instead of score, its date) and the /prospection-b2b
  // closing call to action only; every other page is main's text.
  // Owner decision (11 nov. 2026, SEO): the /tarifs and /a-propos titles, descriptions and dates rewritten.
  // Owner decision (14 nov. 2026, SEO, option B): /logiciel-prospection-b2b rewritten for « logiciel de prospection B2B » and
  // linked from /prospection-b2b (one sentence, related block).
  // Owner decision (14 nov. 2026, /tarifs): the « Veille dédiée, sur devis » service is stated next to the self-service plans, with its section and two price questions in the FAQ.
  // Owner request (15 nov. 2026, SEO): a /veille-entreprises page for the veille dédiée, linked from /tarifs (one sentence).
  // Owner request (18 nov. 2026, SEO): page /prospection-agences-consultants (frozen real counts with their date, prices from plans.ts), linked from /logiciel-prospection-b2b.
  // Owner request (19 nov. 2026): /veille-entreprises no longer lists « nouveaux établissements » (the BODACC publishes almost none).
  // Owner decision (26 nov. 2026, admin cockpit): the veille dédiée FAQ answer and the /veille-entreprises call to action point to
  // the quote form /demande-veille instead of « écrivez à contact@… »; nothing else changed.
  'src/domain/seo-content.ts':'0159d0acb5ab1ca9ec0ef958ef30db2fcbd1d16dd4cd785537c604a06d4c5195',
  // Owner decision (11 nov. 2026, SEO): prospectos.fr as the default site address, robots closing the connected and
  // technical routes, the LinkedIn pages of ProspectOS and of its founder as sameAs.
  // Owner request (13 nov. 2026, demo links, migration 042): robots also closes /d/ (private demo pages) — that one entry only.
  // Owner request (18 nov. 2026, SEO): the « table » block type (métier → signal correspondences).
  'src/domain/seo.ts':'cbcc121af8e9d32328bfe84e6dc0ed1fed0967b447e2b4f76fc0ba5e8214a880',
  // Owner decision (14 nov. 2026, /tarifs): the « Veille dédiée, sur devis » service is stated next to the self-service plans.
  // Owner decision (26 nov. 2026, admin cockpit): « Demander un devis » links to the quote form /demande-veille, not a mailto.
  'src/components/PricingPage.tsx':'d97e34a033d4afd1c001cc3757b80060bf17fb25b0dcb62dcbc5819f6ccd0477',
  'src/components/PricingPlans.tsx':'fc49929e18df6b472f2b70bb36c80bd53dcfb4c85b9f86192b1e142ddb691773',
  'src/domain/plans.ts':'cf5e701c415bb9cfbadf4caf1d60e3e9b6d80822de5d30ed3648b7d1c2e60a02',
  'src/i18n/fr.ts':'812d1fd6093bbe5050efcf4baad844087903aea58a69773e78f8a0dee1264441',
  'src/i18n/en.ts':'9566a8fb876434760291cf4bf4d41e5f2dda6f844b523d1d10684fd18546d801',
  'src/domain/demo.ts':'70a67774e17b28d664f696846572febeac3c64ecaa320e7a85d8ecc9235e84ee',
 };
 // Self-Outreach (035) adds its own i18n keys: the frozen texts are compared without them (tests/self-outreach-strip.ts).
 for(const [f,h] of Object.entries(FROZEN))assert.equal(sha(f.startsWith('src/i18n/')?withoutSelfOutreach(read(f)):read(f)),h,`${f} changed — WEB-2 must not touch it`);
});

test('SEO v2 render — same H1, sections, blocks, FAQ, call to action, related links and structured data',()=>{
 const v2=read('src/components/PublicSeoPage.tsx').split('\n// WEB-2 (docs/UI_V2.md)')[1]!;
 for(const piece of [
  '<script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd}}/>',
  'title={page.h1} intro={page.intro}','<time dateTime={page.updated}>{updatedLabel(page.updated)}</time>',
  '{page.sections.map(section=><section key={section.h2}>','<h2>{section.h2}</h2>','{section.blocks.map((block,i)=><Block key={i} block={block}/>)}',
  '<h2>Questions fréquentes</h2>','<h3>{item.q}</h3><p>{renderRich(item.a)}</p>',
  "href={page.cta.href??'/'} label={page.cta.label??'Explorer la démonstration'}",
  '{relatedPages(page).map(other=><Link key={other.slug} href={`/${other.slug}`}','aria-label="Ressources liées"',
  '{children&&',
 ])assert.ok(v2.includes(piece),piece);
 const cta=read('src/ui/v2/public/PublicSite.tsx');
 assert.match(cta,/<h2>\{title\}<\/h2><p>\{text\}<\/p>/,'the call to action keeps its H2');
 assert.match(cta,/<h1 className="pos-public__h1">\{title\}<\/h1>/);
});

test('legal v2 — the page’s own sections, untouched; only an id per section for the table of contents',()=>{
 const v2=read('src/components/LegalPage.tsx').split('\n// WEB-2 (docs/UI_V2.md)')[1]!;
 assert.match(v2,/return cloneElement\(el,\{id\}\);/,'the only change to a section: its id');
 assert.match(v2,/<div className="pos-public__legal pos-public__prose">\{nodes\}<\/div>/);
 assert.match(v2,/eyebrow="PROSPECTOS — INFORMATION LÉGALE" title=\{title\} meta=\{<>Dernière mise à jour : \{updated\}<\/>\}/,'same eyebrow, title and date as the legacy page');
 assert.match(v2,/\{LEGAL_PAGES\.map\(p=><Link key=\{p\.href\} href=\{p\.href\}/);
 assert.doesNotMatch(v2.replace(/^\/\/.*$/gm,''),/<p>|<li>|<h2>/,'no legal wording of its own');
});

test('shared header and footer — same on every page: ProspectOS, Tarifs, FR | EN, Me connecter; legal and content links',()=>{
 const s=read('src/ui/v2/public/PublicSite.tsx');
 assert.match(s,/<Link className="pos-public__brand" href="\/" aria-label=\{labels\.home\}><Mark\/><span>ProspectOS<\/span><\/Link>/);
 assert.equal((s.match(/<Link className="pos-public__navlink" href="\/tarifs">\{labels\.pricing\}<\/Link>/g)??[]).length,2,'Tarifs in the bar (desktop) and in the menu (phones)');
 assert.match(s,/href="\/#connexion">\{labels\.login\}<\/a>/,'"Me connecter" from any page opens the sign-in card of the homepage');
 assert.match(s,/<a href="\/\?lang=en" lang="en" hrefLang="en"/,'EN leads to the bilingual homepage');
 assert.match(s,/<details className="pos-public__menu">/,'phones: a native menu, no JavaScript needed');
 assert.match(s,/\{LEGAL_PAGES\.map\(p=><li key=\{p\.href\}><Link href=\{p\.href\}>\{p\.label\}<\/Link><\/li>\)\}<li><a href=\{CONTACT_MAILTO\}>/);
 const home=read('src/ui/v2/home/HomeV2.tsx');
 assert.match(home,/<PublicSiteShell className="pos-home" lang=\{locale\} header=\{header\} footer=\{<PublicFooter /,'the homepage uses the same envelope');
 assert.match(home,/if\(u\.hash==='#connexion'\)login\(\);/);
 assert.match(home,/if\(lang==='fr'\|\|lang==='en'\)\{onLocale\(lang\);/);
});

test('styles — inlined by the envelope only (no CSS import), tokens only, legacy element rules neutralised',()=>{
 for(const f of ['src/ui/v2/public/PublicSite.tsx','src/ui/v2/public/styles.ts','src/ui/v2/public/flag.ts','src/components/PublicSeoPage.tsx','src/components/LegalPage.tsx'])
  assert.doesNotMatch(read(f),/import\s+['"][^'"]+\.css['"]/,`${f}: a CSS import would change the stylesheets of every page, flag off included`);
 const shell=read('src/ui/v2/public/PublicSite.tsx');
 assert.match(shell,/<style href="pos-ui-tokens" precedence="default">\{tokensCss\(\)\}<\/style>/);
 assert.match(shell,/<style href="pos-public" precedence="default">\{PUBLIC_CSS\}<\/style>/);
 const css=read('src/ui/v2/public/styles.ts').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\/\/.*$/gm,'');
 assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|rgba?\(/i,'tokens only');
 assert.doesNotMatch(css,/status-contact|action-contact|green/,'never green on the public site');
 assert.doesNotMatch(css,/background-clip:\s*text|-webkit-text-fill-color/,'no gradient text');
 assert.match(css,/\.pos-public footer\{display:block/,'the legacy `footer{display:flex;font-size:9px}` never reaches the v2 footer');
 assert.match(css,/@media \(prefers-reduced-transparency:reduce\)/);
 assert.match(css,/@media \(forced-colors:active\)/);
 assert.match(css,/@media \(prefers-reduced-motion:no-preference\)\{html:has\(\.pos-ui\.pos-public\)\{scroll-behavior:smooth\}\}/);
});
