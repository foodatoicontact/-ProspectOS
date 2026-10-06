import test from 'node:test';
import assert from 'node:assert/strict';
import {CHECKOUT_PRICES} from '../src/domain/plans.ts';
import {SITE_URL,siteMetadata,seoPages,robotsPolicy,sitemapEntries,softwareApplicationJsonLd} from '../src/domain/seo.ts';

test('site metadata targets generic B2B prospecting rather than only Foodatoi',()=>{
  assert.match(siteMetadata.title,/ProspectOS/i);
  assert.match(siteMetadata.description,/prospection B2B/i);
  assert.doesNotMatch(siteMetadata.description,/Verticale Foodatoi/i);
  assert.equal(siteMetadata.canonical,SITE_URL);
});

test('SEO landing pages cover the approved search intents and the factual pages (tarifs, logiciel, à propos)',()=>{
  assert.deepEqual(seoPages.map(p=>p.slug).sort(),[
    'a-propos','lead-scoring','logiciel-prospection-b2b','prioriser-liste-prospects','prospection-b2b','prospection-ia','prospection-restaurants','qualifier-un-prospect-b2b','tarifs'
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


// Prices are advertised only since the server checks them before any checkout (CHECKOUT_PRICES): the structured
// data may state exactly those amounts, monthly and excluding VAT, and nothing else.
test('structured data advertises only the prices the server validates',()=>{
  const offers=(softwareApplicationJsonLd as unknown as {offers:{price:string;priceCurrency:string}[]}).offers;
  assert.deepEqual(offers.map(o=>[o.price,o.priceCurrency]),Object.values(CHECKOUT_PRICES).map(p=>[String(p.unitAmount/100),'EUR']));
});
