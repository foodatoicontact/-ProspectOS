import test from 'node:test';import assert from 'node:assert/strict';import {FixtureProvider} from '../src/discovery/providers/fixture.ts';import {BraveProvider} from '../src/discovery/providers/brave.ts';
const input={project_id:'p',query:'burger',location:'Toulouse',categories:['restaurant'],max_results:2,optional_filters:{}};
test('fixture provider is explicitly synthetic and limited',async()=>{const p=new FixtureProvider();const rows=await p.searchCompanies(input);assert.equal(rows.length,2);assert.equal(p.mode,'test');assert.match(p.normalizeResult(rows[0]).name,/TEST/)});
// Website resolution (entity-resolution.ts) can now populate `website` from a conservative,
// explainable heuristic (see tests/entity-resolution.test.ts) — this test's real invariant is that
// city/address/phone are NEVER invented from a search hit that never mentioned them, whatever the
// resolution outcome for website.
test('Brave requires key and preserves uncertainty without invented location',async()=>{assert.throws(()=>new BraveProvider(''));const p=new BraveProvider('test',async(url,opts)=>{assert.ok(String(url).startsWith('https://api.search.brave.com/'));assert.equal(opts?.redirect,'error');return Response.json({web:{results:[{title:'Food',url:'https://directory.example/food',description:'test'}]}})});const c=p.normalizeResult((await p.searchCompanies(input))[0]);assert.equal(c.city,null);assert.equal(c.source_url,'https://directory.example/food')});
test('Brave malformed result fails closed',()=>assert.throws(()=>new BraveProvider('test').normalizeResult({title:'test',url:'javascript:x'})));
