// UX A/B — prospect detail page (experiment prospect_detail_v1). The variant only chooses the presentation; every
// fetch, mutation, score, angle, message and lifecycle step is shared. On Preview only (VERCEL_ENV=preview, or local
// development): the normal assignment is a deterministic hash of the signed-in user's id (stable across reloads and
// devices, never random, never stored); ?ux=A / ?ux=B forces a variant for manual comparison, kept for the browser tab
// only (sessionStorage, never localStorage) and always labelled assignment 'forced' so it can be excluded from metrics;
// ?ux=auto clears it. Production, tests and any unknown environment: always A, no header, no event.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ux from '../src/ux/variant.ts';

test('enabled only on Preview or local development, never in Production',()=>{
 assert.equal(ux.uxAbEnabledFromEnv({VERCEL_ENV:'preview'}),true);
 assert.equal(ux.uxAbEnabledFromEnv({NODE_ENV:'development'}),true);
 assert.equal(ux.uxAbEnabledFromEnv({VERCEL_ENV:'production',NODE_ENV:'production'}),false);
 assert.equal(ux.uxAbEnabledFromEnv({VERCEL_ENV:'production',NODE_ENV:'development'}),false,'Production wins over a dev NODE_ENV');
 assert.equal(ux.uxAbEnabledFromEnv({NODE_ENV:'production'}),false,'a production build outside Vercel');
 assert.equal(ux.uxAbEnabledFromEnv({NODE_ENV:'test'}),false);
 assert.equal(ux.uxAbEnabledFromEnv({}),false);
});

test('normal assignment — deterministic per user, stable across calls, no randomness',()=>{
 const id='03ce80fd-03ca-4022-b635-b3494c1c6eaa';
 const first=ux.resolveUxVariant({enabled:true,userId:id,forced:null});
 for(let i=0;i<20;i++)assert.deepEqual(ux.resolveUxVariant({enabled:true,userId:id,forced:null}),first);
 assert.equal(first.assignment,'hashed');
 assert.equal(first.variant,ux.hashedVariant(id));
});
test('normal assignment — both variants occur, roughly balanced on a synthetic population',()=>{
 let b=0;const n=2000;
 for(let i=0;i<n;i++)if(ux.hashedVariant(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`)==='B')b++;
 assert.ok(b>n*0.4&&b<n*0.6,`B share ${b}/${n}`);
});
test('?ux=A / ?ux=B force the variant (assignment forced); ?ux=auto clears; anything else is ignored',()=>{
 assert.equal(ux.forcedFromSearch('?ux=B'),'B');
 assert.equal(ux.forcedFromSearch('?foo=1&ux=a'),'A');
 assert.equal(ux.forcedFromSearch('?ux=auto'),'clear');
 assert.equal(ux.forcedFromSearch('?ux=C'),null);
 assert.equal(ux.forcedFromSearch(''),null);
 const id='11111111-1111-4111-8111-111111111111',other=ux.hashedVariant(id)==='A'?'B':'A';
 assert.deepEqual(ux.resolveUxVariant({enabled:true,userId:id,forced:other}),{variant:other,assignment:'forced'});
});
test('the forced override lives in the tab only and never replaces the normal assignment',()=>{
 const session=new Map<string,string>();const store={getItem:(k:string)=>session.get(k)??null,setItem:(k:string,v:string)=>{session.set(k,v)},removeItem:(k:string)=>{session.delete(k)}};
 assert.equal(ux.readForced('?ux=B',store),'B');assert.equal(session.get(ux.UX_FORCED_SESSION_KEY),'B');
 assert.equal(ux.readForced('',store),'B','kept on a reload or an in-app navigation that drops the query');
 assert.equal(ux.readForced('?ux=auto',store),null);assert.equal(session.has(ux.UX_FORCED_SESSION_KEY),false,'auto clears it');
 assert.equal(ux.readForced('',null),null,'no storage (private mode): no override');
 const id='22222222-2222-4222-8222-222222222222';
 assert.deepEqual(ux.resolveUxVariant({enabled:true,userId:id,forced:null}),{variant:ux.hashedVariant(id),assignment:'hashed'},'normal assignment unaffected by a past override');
 const src=String(ux.readForced)+String(ux.tabStore);assert.doesNotMatch(src,/localStorage/);assert.match(String(ux.tabStore),/sessionStorage/);
});
test('disabled (Production), demo or signed out → A, default, and no header at all',()=>{
 assert.deepEqual(ux.resolveUxVariant({enabled:false,userId:'x',forced:'B'}),{variant:'A',assignment:'default'},'?ux=B is ignored in Production');
 assert.deepEqual(ux.resolveUxVariant({enabled:true,userId:null,forced:null}),{variant:'A',assignment:'default'});
 assert.equal(ux.uxHeaderValue({variant:'A',assignment:'default'}),null);
 assert.equal(ux.uxHeaderValue({variant:'B',assignment:'hashed'}),'B;hashed');
 assert.equal(ux.uxHeaderValue({variant:'A',assignment:'forced'}),'A;forced');
});
test('header parsing is strict: anything but A|B;hashed|forced is dropped',()=>{
 assert.deepEqual(ux.parseUxHeader('B;hashed'),{variant:'B',assignment:'hashed'});
 assert.deepEqual(ux.parseUxHeader('A;forced'),{variant:'A',assignment:'forced'});
 for(const v of [null,'','B','B;default','C;hashed','B;hashed;x','b;hashed',' B;hashed','B;hashed\n','x'.repeat(500)])assert.equal(ux.parseUxHeader(v as string|null),null,String(v));
});
