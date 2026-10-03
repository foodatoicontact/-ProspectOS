// Post-build check of the prerendered public HTML (run after `npm run build`): what a crawler gets
// without executing JavaScript. Reads .next/server/app/<route>.html produced by the static prerender.
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';

const SLUGS=['prospection-b2b','prospection-ia','lead-scoring','prospection-restaurants','qualifier-un-prospect-b2b','prioriser-liste-prospects'];
const results=[];
const meta=(html,attr,name)=>[...html.matchAll(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`,'g'))].map(m=>m[1]);
const text=s=>s.replace(/<[^>]+>/g,'').replace(/&#x27;|&#39;/g,'’').trim();
const titles=new Map(),descriptions=new Map();
let sitemap='';
try{sitemap=await readFile(new URL('../.next/server/app/sitemap.xml.body',import.meta.url),'utf8')}catch{}

for(const slug of SLUGS){
  try{
    const html=await readFile(new URL(`../.next/server/app/${slug}.html`,import.meta.url),'utf8');
    const body=html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/g,'');
    const title=text(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1]??'');
    const description=meta(html,'name','description')[0];
    assert.ok(title,'title');assert.ok(description,'description');
    titles.set(title,slug);descriptions.set(description,slug);
    const canonical=/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    assert.match(canonical??'',new RegExp(`^https?://[^/]+/${slug}$`),'canonical');
    assert.deepEqual(meta(html,'name','robots'),['index, follow'],'robots');
    for(const [attr,name] of [['property','og:image'],['name','twitter:image']]){
      const v=meta(html,attr,name);
      assert.equal(v.length,1,`${name} count`);
      assert.match(v[0],/^https?:\/\/[^/]+\/opengraph-image/,`${name} absolute URL`);
    }
    assert.equal(meta(html,'property','og:url')[0],canonical,'og:url');
    assert.equal((body.match(/<h1[\s>]/g)??[]).length,1,'exactly one H1');
    assert.ok((body.match(/<h2[\s>]/g)??[]).length>=5,'H2 rendered in the HTML');
    assert.ok(body.includes('seo-cta'),'final CTA');
    const related=/<nav[^>]*aria-label="Ressources liées"[^>]*>([\s\S]*?)<\/nav>/.exec(body)?.[1]??'';
    assert.ok(related,'related block');
    assert.doesNotMatch(related,new RegExp(`href="/${slug}"`),'related links to the current page');
    const relCount=(related.match(/<a /g)??[]).length;
    assert.ok(relCount>=2&&relCount<=4,`related count ${relCount}`);
    const article=/<article[\s\S]*?<\/article>/.exec(body)?.[0]??'';
    const contextual=[...article.matchAll(/<a [^>]*href="(\/[^"]*)"/g)].map(m=>m[1]).filter(h=>h!=='/');
    assert.ok(contextual.length>=2,'contextual links in the article');
    assert.ok(!contextual.includes(`/${slug}`),'article links to itself');
    const words=text(article.replace(/<[^>]+>/g,' ')).split(/\s+/).filter(Boolean).length;
    assert.ok(words>=550,`rendered words ${words}`);
    if(sitemap)assert.match(sitemap,new RegExp(`<loc>https?://[^<]+/${slug}</loc>\\s*<lastmod>`),'in sitemap with lastmod');
    results.push([slug,'PASS',`${words} words, ${relCount} related, ${contextual.length} contextual links`]);
  }catch(error){results.push([slug,'FAIL',String(error?.message??error).split('\n')[0]])}
}
try{
  assert.equal(titles.size,SLUGS.length,'unique titles');assert.equal(descriptions.size,SLUGS.length,'unique descriptions');
  results.push(['UNIQUE_METADATA','PASS',''])}catch(error){results.push(['UNIQUE_METADATA','FAIL',error.message])}
for(const [name,status,detail] of results)console.log(`${status} ${name}${detail?` — ${detail}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;
console.log(`SEO_HTML ${results.length-failed}/${results.length}${sitemap?'':' (sitemap body not found: sitemap check skipped)'}`);
if(failed)process.exit(1);
