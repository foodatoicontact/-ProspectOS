// Public SEO content foundation: unique metadata, social images, sitemap dates, editorial structure,
// internal links and claims. Pure data checks on src/domain/seo*.ts (rendered HTML: tests/seo-html.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SITE_URL,seoPages,seoPageMetadata,sitemapEntries,relatedPages,socialImage,HOME_LAST_MODIFIED,type SeoPage} from '../src/domain/seo.ts';

const PUBLIC_ROUTES=new Set(['/','/cgu','/cgv','/confidentialite','/mentions-legales',...seoPages.map(p=>`/${p.slug}`)]);
const LINK=/\[([^\]]+)\]\((\/[^)]*)\)/g;

function allText(page:SeoPage):string[]{
  return [page.title,page.description,page.h1,page.intro,page.cta.title,page.cta.text,
    ...page.sections.flatMap(s=>[s.h2,...s.blocks.flatMap(b=>b.type==='ul'||b.type==='ol'?b.items:b.type==='callout'?[b.title,b.text]:[b.text])]),
    ...page.faq.flatMap(f=>[f.q,f.a])];
}
const visibleWords=(page:SeoPage)=>allText(page).filter(t=>t!==page.title&&t!==page.description).join(' ').replace(LINK,'$1').split(/\s+/).filter(Boolean).length;

test('titles, descriptions and H1 are unique across public SEO pages',()=>{
  for(const key of ['title','description','h1'] as const){
    const values=seoPages.map(p=>p[key]);
    assert.equal(new Set(values).size,values.length,`duplicate ${key}`);
  }
  for(const page of seoPages){
    assert.ok(page.title.length<=75,`${page.slug}: title too long (${page.title.length})`);
    assert.ok(page.description.length>=120&&page.description.length<=175,`${page.slug}: description length ${page.description.length}`);
  }
});

test('page metadata: absolute title, canonical, og:image and twitter:image with absolute URLs',()=>{
  assert.match(socialImage.url,/^https?:\/\/[^/]+\/opengraph-image$/);
  for(const page of seoPages){
    const m=seoPageMetadata(page);
    assert.deepEqual(m.title,{absolute:page.title});
    assert.equal(m.alternates?.canonical,`${SITE_URL}/${page.slug}`);
    const og=m.openGraph as {url:string;images:{url:string}[]};
    assert.equal(og.url,`${SITE_URL}/${page.slug}`);
    assert.equal(og.images[0].url,socialImage.url);
    const tw=m.twitter as {images:{url:string}[]};
    assert.equal(tw.images[0].url,socialImage.url);
  }
});

test('sitemap: every page listed once with its own real content date, never the build date',()=>{
  const urls=sitemapEntries.map(e=>e.url);
  assert.equal(new Set(urls).size,urls.length);
  assert.ok(urls.includes(SITE_URL));
  for(const page of seoPages){
    const entry=sitemapEntries.find(e=>e.url===`${SITE_URL}/${page.slug}`);
    assert.ok(entry,`${page.slug} missing from sitemap`);
    assert.equal(entry.lastModified,page.updated);
  }
  for(const e of sitemapEntries){
    assert.match(e.lastModified,/^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(e.lastModified)));
  }
  assert.match(HOME_LAST_MODIFIED,/^\d{4}-\d{2}-\d{2}$/);
});

test('editorial structure: H1, several descriptive H2, a concrete example, a final CTA',()=>{
  for(const page of seoPages){
    assert.ok(page.h1.length>20);
    assert.ok(page.sections.length>=4,`${page.slug}: at least 4 H2`);
    assert.ok(page.sections.every(s=>s.h2.length>=12),`${page.slug}: H2 must be descriptive`);
    assert.ok(page.sections.some(s=>s.blocks.some(b=>b.type==='callout'||b.type==='ol')),`${page.slug}: needs a worked example or an operational procedure`);
    assert.ok(page.cta.title&&page.cta.text,`${page.slug}: final CTA`);
    assert.ok(page.keywords.primary&&page.keywords.secondary.length>0);
  }
});

test('content depth: real pages, not thin content and not padded (indicative 600–1000 words)',()=>{
  for(const page of seoPages){
    const words=visibleWords(page);
    assert.ok(words>=550&&words<=1100,`${page.slug}: ${words} words`);
  }
});

test('internal links: contextual, descriptive, to existing routes, never to the current page',()=>{
  const generic=/^(cliquez ici|ici|en savoir plus|lire la suite|voir plus)$/i;
  for(const page of seoPages){
    const links=allText(page).flatMap(t=>[...t.matchAll(LINK)]);
    assert.ok(links.length>=2,`${page.slug}: at least 2 contextual links`);
    for(const [,anchor,href] of links){
      assert.ok(PUBLIC_ROUTES.has(href),`${page.slug}: unknown route ${href}`);
      assert.notEqual(href,`/${page.slug}`,`${page.slug}: links to itself`);
      assert.doesNotMatch(anchor,generic,`${page.slug}: generic anchor "${anchor}"`);
    }
  }
});

test('related block: 2 to 4 existing pages, never the current page',()=>{
  for(const page of seoPages){
    assert.ok(page.related.length>=2&&page.related.length<=4,`${page.slug}: ${page.related.length} related`);
    assert.ok(!page.related.includes(page.slug),`${page.slug}: related contains itself`);
    assert.equal(relatedPages(page).length,page.related.length,`${page.slug}: unknown related slug`);
  }
  const fake={...seoPages[0],related:[seoPages[0].slug,seoPages[1].slug]};
  assert.deepEqual(relatedPages(fake).map(p=>p.slug),[seoPages[1].slug],'the current page is filtered out');
});

test('no forbidden or unverifiable marketing claims',()=>{
  const forbidden=[/augment\w* (de |vos )?ventes/i,/\d+\s?%\s*de conversion/i,/taux de conversion/i,/meilleur que/i,/révolutionnaire/i,/\b10\s?x\b/i,/automatiquement fiable/i,/témoignage/i,/nos clients/i,/garanti/i,/\b100\s?% (fiable|automatique)/i];
  for(const page of seoPages)for(const text of allText(page))for(const re of forbidden)
    assert.doesNotMatch(text,re,`${page.slug}: forbidden claim ${re} in "${text.slice(0,80)}…"`);
});

test('the score is never presented as a probability of sale',()=>{
  for(const page of seoPages)for(const text of allText(page)){
    assert.doesNotMatch(text,/probabilité de (vente|signature|conversion) (de|est|élevée)/i);
    assert.doesNotMatch(text,/\d+\s?% de chances(?! »)/i);
  }
});

test('examples are explicitly marked as TEST or demonstration data',()=>{
  for(const page of seoPages)for(const s of page.sections)for(const b of s.blocks)
    if(b.type==='callout'&&/exemple/i.test(b.title))assert.match(b.title,/TEST/,`${page.slug}: example "${b.title}" must be marked TEST`);
});
