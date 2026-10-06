// Being proposed by AI assistants (ChatGPT, Claude, Perplexity, Gemini, Copilot) is earned with facts they can read
// and cite: /llms.txt and /llms-full.txt, AI crawlers explicitly welcome, complete schema.org (offers, organization,
// FAQ, breadcrumbs) and factual pages. Every number comes from the product's own sources (OFFERS, PLAN_QUOTAS), so
// what an assistant repeats is exactly what the product does — no client, review, ranking or result is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {OFFERS} from '../src/domain/offers.ts';
import {PLAN_QUOTAS} from '../src/domain/plans.ts';
import {SITE_URL,seoPages,robotsPolicy,softwareApplicationJsonLd,organizationJsonLd,faqJsonLd,breadcrumbJsonLd,getSeoPage} from '../src/domain/seo.ts';
import {llmsTxt,llmsFullTxt,AI_CRAWLERS} from '../src/domain/geo.ts';

const read=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const FORBIDDEN=[/nos clients/i,/témoignage/i,/garanti/i,/meilleur (logiciel|outil)/i,/n°\s?1|numéro un|leader/i,/\d+\s?% de conversion/i,/augment\w* (de |vos )?ventes/i];

test('llms.txt: the llmstxt.org shape — title, summary, sections of absolute links — and the real offers',()=>{
 const t=llmsTxt();
 assert.match(t,/^# ProspectOS\n\n> .{80,}\n/);
 for(const h of ['## Ce que fait ProspectOS','## Offres et tarifs','## Principes','## Pages','## Contact'])assert.ok(t.includes(h),h);
 const solo=OFFERS.find(o=>o.id==='BETA')!,pro=OFFERS.find(o=>o.id==='PRO')!;
 assert.match(t,new RegExp(`ProspectOS Solo[^\\n]*${solo.priceEurExclVatPerMonth} € HT/mois`));
 // Pro is one account since 2026-10-06; teams buy ProspectOS Équipe (tests/team-offer.test.ts).
 assert.match(t,new RegExp(`ProspectOS Pro[^\\n]*${pro.priceEurExclVatPerMonth} € HT/mois, 1 compte`));
 assert.match(t,/ProspectOS Équipe[^\n]*jusqu’à 5 comptes/);
 assert.match(t,/Entreprise[^\n]*sur devis/);
 for(const [plan,q] of [['Solo',PLAN_QUOTAS.BETA],['Pro',PLAN_QUOTAS.PRO]] as const)assert.ok(t.includes(`${q.discovery} recherches`)&&t.includes(`${q.analysis} analyses de prospects`),plan);
 assert.ok(t.includes(`essai gratuit de 7 jours`)&&t.includes(`${PLAN_QUOTAS.TRIAL.discovery} recherches`),'trial');
 for(const p of seoPages)assert.ok(t.includes(`(${SITE_URL}/${p.slug})`),`link to ${p.slug}`);
 for(const re of FORBIDDEN)assert.doesNotMatch(t,re);
});

test('llms-full.txt: every public page in full text, links resolved, nothing invented',()=>{
 const t=llmsFullTxt();
 assert.ok(t.startsWith(llmsTxt()));
 for(const p of seoPages){assert.ok(t.includes(`# ${p.h1}`),p.slug);assert.ok(t.includes(p.faq[0]!.q),`${p.slug} faq`)}
 assert.doesNotMatch(t,/\]\(\//,'internal links resolved to absolute URLs');
 for(const re of FORBIDDEN)assert.doesNotMatch(t,re);
});

test('routes: /llms.txt and /llms-full.txt served as UTF-8 plain text, cacheable',async()=>{
 for(const [path,fn] of [['../app/llms.txt/route.ts','llmsTxt'],['../app/llms-full.txt/route.ts','llmsFullTxt']]){
  const src=await read(path);
  assert.match(src,new RegExp(`new Response\\(${fn}\\(\\),\\{headers:\\{'content-type':'text/plain; charset=utf-8'`));
  assert.match(src,/export const dynamic='force-static'/);
 }
});

test('robots: AI assistants and their search crawlers explicitly welcome, private paths still closed',async()=>{
 for(const bot of ['GPTBot','OAI-SearchBot','ChatGPT-User','ClaudeBot','Claude-SearchBot','Claude-User','PerplexityBot','Perplexity-User','Google-Extended','Applebot-Extended','Bingbot','CCBot'])assert.ok(AI_CRAWLERS.includes(bot),bot);
 const robots=await read('../app/robots.ts');
 assert.match(robots,/rules:\[\{userAgent:'\*',allow:robotsPolicy\.allow,disallow:robotsPolicy\.disallow\},\{userAgent:\[\.\.\.AI_CRAWLERS\],allow:robotsPolicy\.allow,disallow:robotsPolicy\.disallow\}\]/);
 assert.deepEqual(robotsPolicy.disallow,['/api/','/auth/']);
});

test('schema.org: the software with its real offers, the organization, FAQ and breadcrumbs per page',()=>{
 const app=softwareApplicationJsonLd as any;
 assert.equal(app['@type'],'SoftwareApplication');assert.equal(app.applicationCategory,'BusinessApplication');
 const offers=app.offers as any[];
 for(const o of OFFERS.filter(o=>o.priceEurExclVatPerMonth!==null))assert.ok(offers.some(x=>x.price===String(o.priceEurExclVatPerMonth)&&x.priceCurrency==='EUR'),`offer ${o.id}`);
 assert.ok(offers.every(o=>o.url&&o.name),'each offer named and linked');
 assert.ok(Array.isArray(app.featureList)&&app.featureList.length>=5);
 assert.equal(app.aggregateRating,undefined,'never an invented rating');assert.equal(app.review,undefined,'never an invented review');
 const org=organizationJsonLd as any;
 assert.equal(org['@type'],'Organization');assert.equal(org.name,'ProspectOS');assert.equal(org.url,SITE_URL);assert.equal(org.email,'prospectos.contact@gmail.com');
 const page=getSeoPage('prospection-b2b');
 const faq=faqJsonLd(page) as any;
 assert.equal(faq['@type'],'FAQPage');assert.equal(faq.mainEntity.length,page.faq.length);
 assert.doesNotMatch(JSON.stringify(faq),/\]\(\//,'markdown links stripped');
 const bc=breadcrumbJsonLd(page) as any;
 assert.deepEqual(bc.itemListElement.map((i:any)=>i.item),[SITE_URL,`${SITE_URL}/${page.slug}`]);
});

test('public pages emit their FAQ and breadcrumb JSON-LD; the layout emits software, website and organization',async()=>{
 assert.match(await read('../src/components/PublicSeoPage.tsx'),/JSON\.stringify\(\[faqJsonLd\(page\),breadcrumbJsonLd\(page\)\]\)/);
 assert.match(await read('../app/layout.tsx'),/JSON\.stringify\(\[softwareApplicationJsonLd,webSiteJsonLd,organizationJsonLd\]\)/);
});

test('factual pages for the questions people ask assistants: tarifs, logiciel de prospection B2B, à propos',async()=>{
 for(const slug of ['tarifs','logiciel-prospection-b2b','a-propos']){
  const page=getSeoPage(slug);
  assert.match(await read(`../app/${slug}/page.tsx`),new RegExp(`getSeoPage\\('${slug}'\\)`));
  const text=JSON.stringify(page);for(const re of FORBIDDEN)assert.doesNotMatch(text,re,`${slug} ${re}`);
 }
 const tarifs=JSON.stringify(getSeoPage('tarifs'));
 for(const o of OFFERS.filter(o=>o.priceEurExclVatPerMonth!==null))assert.ok(tarifs.includes(`${o.priceEurExclVatPerMonth} € HT par mois`),`tarifs ${o.id}`);
 for(const q of [PLAN_QUOTAS.BETA,PLAN_QUOTAS.PRO,PLAN_QUOTAS.TRIAL])assert.ok(tarifs.includes(`${q.discovery} recherches`)&&tarifs.includes(`${q.analysis} analyses de prospects`)&&tarifs.includes(`${q.aiOffer} analyses d’offre`));
 assert.ok(tarifs.includes('5 comptes'));
 const about=JSON.stringify(getSeoPage('a-propos'));
 assert.ok(about.includes('Kevin Cardia')&&about.includes('Toulouse'),'the real publisher, as in the legal notice');
 assert.ok(about.includes('registre public des entreprises'),'the real sources');
});
