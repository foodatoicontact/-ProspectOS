import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routes=['prospection-b2b','prospection-ia','lead-scoring','prospection-restaurants','qualifier-un-prospect-b2b','prioriser-liste-prospects'];

test('approved public SEO routes exist and render the shared public SEO page',async()=>{
  for(const slug of routes){
    const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
    assert.match(source,/PublicSeoPage/);
    assert.match(source,new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});

test('robots and sitemap metadata routes are present',async()=>{
  const robots=await readFile(new URL('../app/robots.ts',import.meta.url),'utf8');
  const sitemap=await readFile(new URL('../app/sitemap.ts',import.meta.url),'utf8');
  assert.match(robots,/robotsPolicy/);
  assert.match(sitemap,/sitemapEntries/);
});


test('SEO route metadata comes from the shared helper, which uses absolute titles (no duplicate ProspectOS suffix)',async()=>{
  for(const slug of routes){
    const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
    assert.match(source,/seoPageMetadata\(page\)/);
  }
  const helper=await readFile(new URL('../src/domain/seo.ts',import.meta.url),'utf8');
  assert.match(helper,/title:\{absolute:page\.title\}/);
});

test('the public SEO page component stays a server component (HTML readable without JavaScript)',async()=>{
  const source=await readFile(new URL('../src/components/PublicSeoPage.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/['"]use client['"]/);
  assert.doesNotMatch(source,/useState|useEffect/);
});

test('an Open Graph image route exists for rich sharing',async()=>{
  const source=await readFile(new URL('../app/opengraph-image.tsx',import.meta.url),'utf8');
  assert.match(source,/ImageResponse/);
  assert.match(source,/ProspectOS/);
});
