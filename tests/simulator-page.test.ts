// Public simulator V1 — the public page /simulateur. No account, no session, no database client, no Discovery, no
// provider: the import graph of the page, its component and its endpoint is checked. noindex, outside the sitemap and the
// SEO registry. Permanent "Simulation — données de démonstration" notice; fictional companies flagged; at most 3
// prospects; mobile order: identity → why → FIT / reason → angle → proofs, then the sign-up CTA (to the existing sign-up).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(p:string)=>readFileSync(resolve(ROOT,p),'utf8');
const page=read('app/simulateur/page.tsx'),sim=read('src/components/Simulator.tsx'),css=read('app/globals.css');

// Every module reachable from the public simulator (relative imports, with or without extension).
function graph(entries:string[]){
 const seen=new Set<string>(),packages=new Set<string>();
 const visit=(file:string)=>{
  if(seen.has(file))return;seen.add(file);
  for(const [,spec] of read(file).matchAll(/^\s*import\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)){
   if(!spec.startsWith('.')){packages.add(spec.split('/')[0].startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]);continue}
   const base=resolve(dirname(resolve(ROOT,file)),spec);
   const hit=[base,`${base}.ts`,`${base}.tsx`,`${base}/index.ts`].find(p=>existsSync(p)&&!p.endsWith('/'));
   if(hit&&/\.(ts|tsx)$/.test(hit))visit(hit.slice(ROOT.length+1));
  }
 };
 entries.forEach(visit);return {files:[...seen],packages:[...packages]};
}

test('isolation — no Discovery, server, database client, provider, auth or app shell in the public simulator',()=>{
 const g=graph(['app/simulateur/page.tsx','app/api/public/simulator-event/route.ts']);
 assert.ok(g.files.includes('src/components/Simulator.tsx'));
 for(const f of g.files)assert.doesNotMatch(f,/^src\/(discovery|server)\/|^app\/page\.tsx$|^app\/api\/v1\//,f);
 assert.deepEqual(g.packages.filter(p=>!['react','next','zod'].includes(p)),[],'only react, next and zod');
 // Whole graph: no network call but the analytics beacon (events.ts).
 for(const f of g.files)if(f!=='src/simulator/events.ts')assert.doesNotMatch(read(f),/\bfetch\(|sendBeacon|XMLHttpRequest|new WebSocket|EventSource\(/,`${f}: the only network call is the analytics beacon`);
 // The simulator's own files (shared UI copy may name providers, e.g. the BYOK key screen): no provider, no storage of input.
 const own=g.files.filter(f=>/^(src\/simulator\/|src\/components\/Simulator\.tsx$|app\/simulateur\/|app\/api\/public\/simulator-event\/)/.test(f));
 assert.ok(own.length>=10,String(own.length));
 for(const f of own)assert.doesNotMatch(read(f),/supabase|anthropic|brave|AI_API_KEY|localStorage/i,f);
});
test('page — public, noindex, outside the sitemap and the SEO registry',()=>{
 assert.match(page,/robots:\{index:false,follow:false\}/);
 assert.match(page,/export default function Page\(\)\{return <Simulator\/>\}/);
 assert.doesNotMatch(page,/session|auth|cookies\(|headers\(/i);
 assert.doesNotMatch(read('src/domain/seo.ts')+read('app/sitemap.ts'),/simulateur/);
});
test('component — permanent demo notice, fictional flag, controlled inputs, at most 3 prospects through simulate()',()=>{
 assert.match(sim,/^'use client';/);
 const notice=sim.indexOf('<p className="sim-banner" role="note">{tr(\'sim.banner\')}</p>');
 assert.ok(notice>0&&notice<sim.indexOf('<form'),'the notice is outside the result: always on screen');
 assert.match(sim,/maxLength=\{SIM_INPUT_LIMITS\.offer\}/);assert.match(sim,/maxLength=\{SIM_INPUT_LIMITS\.target\}/);
 assert.match(sim,/\{REGIONS\.map\(r=><option key=\{r\.code\} value=\{r\.code\}>\{r\.label\}<\/option>\)\}/);
 assert.match(sim,/const match=matchScenario\(offer,target\);const view=simulate\(match\.scenario_id\);/);
 assert.match(sim,/<span className="pill sim-fictional">\{tr\('sim\.fictional'\)\}<\/span>/);
 assert.doesNotMatch(sim,/selectAngle\(|scoreIntent\(|estimateFit\(|Math\.random/,'no scoring or angle selection in the component');
});
test('mobile order of a prospect card, then the CTA to the existing sign-up',()=>{
 const card=sim.indexOf('<article key={p.id} className="sim-prospect card">');
 const order=['className="sim-identity"','<Why p={p}/>','className="sim-fit','className="sim-angle"','className="sim-proofs"'].map(m=>sim.indexOf(m,card));
 assert.ok(card>0);
 assert.ok(order.every(i=>i>0),String(order));
 assert.deepEqual([...order].sort((a,b)=>a-b),order);
 const cta=sim.indexOf('className="sim-cta');
 assert.ok(cta>order[4]);
 assert.equal((sim.match(/href="\/"/g)??[]).length>=3,true,'card CTA, main CTA and the real-prospects CTA go to the existing sign-up');
 for(const k of ['sim.cta.signup','sim.cta.realProspects','sim.cta.prepare'])assert.ok(sim.includes(`tr('${k}')`),k);
 assert.match(css,/\.sim-banner\{position:sticky;top:0;/);
});
test('analytics — the five funnel events, with enum values only (never the typed text)',()=>{
 for(const k of ['simulator.viewed','simulator.started','simulator.completed','simulator.prospect_opened','simulator.signup_clicked'])assert.ok(sim.includes(`kind:'${k}'`),k);
 for(const m of sim.matchAll(/sendSimEvent\(\{([^}]*)\}\)/g))assert.doesNotMatch(m[1],/offer|target|matched|label|name/,m[1]);
});
test('copy — the promised wording, FR and EN keys, no purchase prediction, no score that does not exist',()=>{
 assert.equal(fr['sim.title'],'Testez votre ciblage avant même de créer un compte.');
 assert.equal(fr['sim.submit'],'Simuler ma prospection');
 assert.equal(fr['sim.banner'],'Simulation — données de démonstration');
 assert.equal(fr['sim.cta.signup'],'Créer mon compte pour préparer le message');
 assert.equal(fr['sim.cta.realProspects'],'Passer aux vrais prospects');
 const keys=Object.keys(fr).filter(k=>k.startsWith('sim.'));
 assert.ok(keys.length>=20);
 for(const k of keys){
  assert.ok((en as Record<string,string>)[k],`en ${k}`);
  assert.doesNotMatch(`${(fr as Record<string,string>)[k]} ${(en as Record<string,string>)[k]}`,/va acheter|will buy|probabilit|opportunit|confiance|confidence|garanti/i,k);
 }
});
