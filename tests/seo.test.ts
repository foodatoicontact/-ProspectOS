import test from 'node:test';
import assert from 'node:assert/strict';
import {SITE_URL,siteMetadata,seoPages,robotsPolicy,sitemapEntries,softwareApplicationJsonLd} from '../src/domain/seo.ts';

test('site metadata targets generic B2B prospecting rather than only Foodatoi',()=>{
  assert.match(siteMetadata.title,/ProspectOS/i);
  assert.match(siteMetadata.description,/prospection B2B/i);
  assert.doesNotMatch(siteMetadata.description,/Verticale Foodatoi/i);
  assert.equal(siteMetadata.canonical,SITE_URL);
});

test('SEO landing pages cover the four approved search intents',()=>{
  assert.deepEqual(seoPages.map(p=>p.slug).sort(),[
    'lead-scoring','prospection-b2b','prospection-ia','prospection-restaurants'
  ]);
  for(const page of seoPages){
    assert.ok(page.title.length>20);
    assert.ok(page.description.length>80);
    assert.ok(page.h1.length>20);
  }
});

test('robots allows public crawling and excludes APIs/private routes',()=>{
  assert.equal(robotsPolicy.allow,'/');
  assert.ok(robotsPolicy.disallow.includes('/api/'));
  assert.ok(robotsPolicy.disallow.includes('/auth/'));
  assert.equal(robotsPolicy.sitemap,`${SITE_URL}/sitemap.xml`);
});

test('sitemap includes homepage and all public SEO pages',()=>{
  const urls=sitemapEntries.map(e=>e.url);
  assert.ok(urls.includes(SITE_URL));
  for(const page of seoPages)assert.ok(urls.includes(`${SITE_URL}/${page.slug}`));
});

test('structured data identifies ProspectOS as a SoftwareApplication',()=>{
  assert.equal(softwareApplicationJsonLd['@type'],'SoftwareApplication');
  assert.equal(softwareApplicationJsonLd.name,'ProspectOS');
  assert.equal(softwareApplicationJsonLd.url,SITE_URL);
  assert.match(String(softwareApplicationJsonLd.description),/prospection B2B/i);
});


test('structured data does not advertise an unvalidated price',()=>{
  assert.equal('offers' in softwareApplicationJsonLd,false);
});
