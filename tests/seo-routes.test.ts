import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routes=['prospection-b2b','prospection-ia','lead-scoring','prospection-restaurants'];

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


test('SEO route metadata uses absolute titles to avoid duplicate ProspectOS suffixes',async()=>{
  for(const slug of routes){
    const source=await readFile(new URL(`../app/${slug}/page.tsx`,import.meta.url),'utf8');
    assert.match(source,/title:\{absolute:page\.title\}/);
  }
});

test('an Open Graph image route exists for rich sharing',async()=>{
  const source=await readFile(new URL('../app/opengraph-image.tsx',import.meta.url),'utf8');
  assert.match(source,/ImageResponse/);
  assert.match(source,/ProspectOS/);
});
