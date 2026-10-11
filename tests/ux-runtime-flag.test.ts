// UX A/B — regression for the Preview bug "?ux=A and ?ux=B show the same page". Runtime proof on the Preview of 135bdbf9:
// the served "/" was <html lang="fr"> without data-ux-ab, prerendered at build (x-nextjs-prerender: 1, route "○ /"),
// while the same code built locally with VERCEL_ENV=preview gives data-ux-ab="1". The flag was decided in the static
// layout, so it was frozen with the BUILD environment, which on Vercel did not say "preview": the client always resolved A.
// Fix: the flag is decided per request by the server (GET /api/public/ux-config, dynamic, no-store) and never in a static
// file. Production is a hard off. When the platform does not expose VERCEL_ENV, an explicit project switch UX_AB_ENABLED=1
// (to be scoped to Preview) can enable it; the endpoint also reports which environment the server sees, as runtime proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ux from '../src/ux/variant.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');

test('root cause — the flag is never decided in the statically prerendered layout',()=>{
 const layout=read('../app/layout.tsx');
 assert.doesNotMatch(layout,/uxAbEnabledFromEnv|data-ux-ab|process\.env/,'a static layout freezes the flag with the build environment');
 assert.doesNotMatch(read('../app/page.tsx'),/dataset\.uxAb/,'the client no longer reads a build-time attribute');
});
test('rule — preview on, production hard off, explicit switch only where the environment is not exposed',()=>{
 assert.equal(ux.uxAbEnabledFromEnv({VERCEL_ENV:'preview'}),true);
 assert.equal(ux.uxAbEnabledFromEnv({VERCEL_ENV:'production',UX_AB_ENABLED:'1'}),false,'never in Production, whatever the switch');
 assert.equal(ux.uxAbEnabledFromEnv({UX_AB_ENABLED:'1',NODE_ENV:'production'}),true,'switch, environment not exposed');
 assert.equal(ux.uxAbEnabledFromEnv({UX_AB_ENABLED:'true',NODE_ENV:'production'}),false,'only the exact value 1');
 assert.equal(ux.uxAbEnabledFromEnv({NODE_ENV:'production'}),false,'what the Preview build actually had');
 assert.equal(ux.uxAbEnabledFromEnv({NODE_ENV:'development'}),true);
});
test('runtime proof — which environment the server sees',()=>{
 assert.equal(ux.uxEnvironment({VERCEL_ENV:'preview'}),'preview');
 assert.equal(ux.uxEnvironment({VERCEL_ENV:'production'}),'production');
 assert.equal(ux.uxEnvironment({NODE_ENV:'development'}),'development');
 assert.equal(ux.uxEnvironment({NODE_ENV:'production'}),'unknown');
 assert.equal(ux.uxEnvironment({VERCEL_ENV:'staging'}),'unknown');
});
test('endpoint — per request, dynamic, never cached, only a boolean and the environment class',async()=>{
 const src=read('../app/api/public/ux-config/route.ts');
 assert.match(src,/export const dynamic='force-dynamic';/);
 assert.match(src,/'cache-control':'no-store'/);
 const saved={...process.env};
 try{
  const {GET}=await import('../app/api/public/ux-config/route.ts');
  for(const [env,expected] of [[{VERCEL_ENV:'preview'},{enabled:true,environment:'preview'}],[{VERCEL_ENV:'production',UX_AB_ENABLED:'1'},{enabled:false,environment:'production'}],[{UX_AB_ENABLED:'1'},{enabled:true,environment:'unknown'}],[{},{enabled:false,environment:'unknown'}]] as const){
   delete process.env.VERCEL_ENV;delete process.env.UX_AB_ENABLED;Object.assign(process.env,{NODE_ENV:'production'},env);
   const res=await GET();assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual(await res.json(),expected);
  }
 }finally{for(const k of ['VERCEL_ENV','UX_AB_ENABLED','NODE_ENV'])if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}
});
test('page — the variant waits for the server flag, read at runtime, before resolving',()=>{
 const page=read('../app/page.tsx');
 assert.match(page,/fetch\('\/api\/public\/ux-config',\{cache:'no-store'\}\)/);
 assert.match(page,/resolveUxVariant\(\{enabled:uxEnabled,userId:mode==='live'\?identity\.current:null,forced:readForced\(window\.location\.search,tabStore\(\)\)\}\)/);
 assert.match(page,/\},\[mode,token,uxEnabled\]\);/);
});
test('server analytics follow the same runtime rule',()=>{
 assert.match(read('../src/server/ux-events.ts'),/if\(!uxAbEnabledFromEnv\(i\.env\)/);
 assert.match(read('../app/api/v1/[...path]/route.ts'),/env:process\.env/);
});
