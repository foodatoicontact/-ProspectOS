// Every /api/v1 call goes through one catch-all route (app/api/v1/[...path]/route.ts, a single `handler`), but Next.js
// only routes the HTTP methods that file exports: any other method gets an empty 405 before the handler runs — no JSON,
// so the browser shows « Service momentanément indisponible » (fetchApiJson) and the session check never even runs.
// PUT and DELETE were answered by the handler and sent by the UI (style profile, public content, BYOK key removal) but
// never exported. Read from the sources: the route exports exactly the methods its handler — or a module it hands the
// request to — answers (HEAD and OPTIONS stay automatic), and every method the browser sends is among them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

const src=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const ROUTE='../app/api/v1/[...path]/route.ts';
const HTTP=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'];
const methods=(names:Iterable<string>)=>[...new Set(names)].filter(n=>HTTP.includes(n)).sort();

// `export {handler as GET,…}`, `export {GET}`, `export (async) function GET`, `export const GET`.
async function exportedMethods(){
 const route=await src(ROUTE);const names:string[]=[];
 for(const [,specs] of route.matchAll(/^export\s*\{([^}]*)\}/gm))for(const spec of specs.split(','))names.push(spec.trim().split(/\s+as\s+/).at(-1)??'');
 for(const [,name] of route.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/gm))names.push(name);
 return methods(names);
}
// The route itself and the modules it hands the request to (its `handle…` imports): each `method==='X'` is answered.
async function answeredMethods(){
 const route=await src(ROUTE);
 const modules=[...route.matchAll(/^import\s*\{[^}]*\bhandle[A-Z]\w*[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/\.\.\/(src\/[\w/-]+)'/gm)].map(m=>`../${m[1]}.ts`);
 const texts=[route,...await Promise.all(modules.map(src))];
 return {modules,answered:methods(texts.flatMap(t=>[...t.matchAll(/\bmethod\s*===\s*'([A-Z]+)'/g)].map(m=>m[1])))};
}
// What the browser sends: api(path,'METHOD',…) in the page and its components (api() defaults to GET), and the direct
// fetch('/api/v1/…',{method:'…'}) calls.
async function sentMethods(){
 const files=['../app/page.tsx',...(await readdir(new URL('../src/components/',import.meta.url))).filter(f=>/\.tsx?$/.test(f)).map(f=>`../src/components/${f}`)];
 const sent=['GET'];
 for(const text of await Promise.all(files.map(src))){
  for(const m of text.matchAll(/\bapi\([^;]*?,\s*'([A-Z]+)'/g))sent.push(m[1]);
  for(const m of text.matchAll(/\bfetch\(\s*['`]\/api\/v1\/[^;]*?\bmethod\s*:\s*'([A-Z]+)'/g))sent.push(m[1]);
 }
 return methods(sent);
}
// The branch of a handler that starts at `marker`, up to the next resource branch.
const branch=(text:string,marker:string)=>{const i=text.indexOf(marker);assert.ok(i>=0,marker);const next=text.indexOf('if(resource',i+marker.length);return text.slice(i,next<0?undefined:next)};

test('A — the route exports exactly the methods its handler and the modules it delegates to answer',async()=>{
 const {modules,answered}=await answeredMethods();
 assert.ok(modules.includes('../src/outreach/api.ts')&&modules.length>=3,'the delegated modules are read too');
 for(const m of ['GET','POST','PATCH','PUT','DELETE'])assert.ok(answered.includes(m),`the handler answers ${m}`);
 assert.deepEqual(await exportedMethods(),answered,'every answered method is exported (never an empty 405), and nothing the handler never answers');
});

test('B — every method the browser sends to /api/v1 is exported by the route',async()=>{
 const sent=await sentMethods(),exported=await exportedMethods();
 for(const m of ['GET','POST','PATCH','PUT','DELETE'])assert.ok(sent.includes(m),`the UI sends ${m}`);
 assert.deepEqual(sent.filter(m=>!exported.includes(m)),[],'sent by the UI, yet answered by Next.js with an empty 405');
});

const ENDPOINTS=[
 {route:'PUT /api/v1/outreach-style',method:'PUT',ui:'../src/components/OutreachIntelligence.tsx',call:"api('outreach-style','PUT',{organization_id:organizationId,profile:style})",module:'../src/outreach/api.ts',branch:"if(resource==='outreach-style'){",answer:"if(method==='PUT'){"},
 {route:'DELETE /api/v1/public-content/:id',method:'DELETE',ui:'../src/components/OutreachIntelligence.tsx',call:"api(`public-content/${id}`,'DELETE')",module:'../src/outreach/api.ts',branch:"if(resource==='public-content'){",answer:"if(method==='DELETE'&&!action)"},
 {route:'DELETE /api/v1/provider-credentials/:org',method:'DELETE',ui:'../app/page.tsx',call:"api(`provider-credentials/${orgId}`,'DELETE',{provider:'anthropic'})",module:ROUTE,branch:"if(resource==='provider-credentials'){",answer:"if(request.method==='DELETE'){"},
];
for(const e of ENDPOINTS)test(`C — ${e.route}: sent by the UI, answered by the handler, exported by the route`,async()=>{
 assert.ok((await src(e.ui)).includes(e.call),`the UI sends ${e.route}`);
 assert.ok(branch(await src(e.module),e.branch).includes(e.answer),`the handler answers ${e.route}`);
 assert.ok((await exportedMethods()).includes(e.method),`${e.method} is exported, so ${e.route} reaches the handler`);
});

test('D — an unauthenticated PUT or DELETE reaches the handler and gets its JSON answer (401 « Connexion requise »), the session being checked before anything else',async()=>{
 const exported=await exportedMethods();
 for(const m of ['PUT','DELETE'])assert.ok(exported.includes(m),`${m} reaches the handler`);
 const route=await src(ROUTE);const start=route.indexOf('async function handler(');assert.ok(start>0,'handler exists');
 assert.match(route.slice(start),/^async function handler\([^)]*\)\{\s*try\s*\{\s*const \{db,user\}=await authenticatedDb\(request\);/,'the session is checked first, whatever the method (before the path, the body or the database)');
 assert.match(await src('../src/server/db.ts'),/throw new Error\('UNAUTHORIZED'\)/,'no valid bearer token → UNAUTHORIZED');
 assert.match(route,/code==='UNAUTHORIZED'\?401/);assert.match(route,/code==='UNAUTHORIZED'\?'Connexion requise'/);
});
