// Micro hotfix — the browser api() helper and non-JSON answers. A proxy/HTML error page or a network failure
// used to reach res.json() and surface "Unexpected token 'u', "upstream r"... is not valid JSON". Now any
// non-JSON answer, or no answer at all, becomes one clear localized message; JSON answers (success, business
// errors, 401) are handed to api() exactly as before. No server, auth or retry change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchApiJson,ServiceUnavailableError} from '../src/components/api-response.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const MSG=fr['error.serviceUnavailable'];
const jsonRes=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const UPSTREAM='upstream request timeout';
const HTML='<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1><pre>at handler (/var/task/route.js:1:1)</pre></body></html>';
async function unavailable(send:()=>Promise<Response>){
 const err=await fetchApiJson(send,MSG).then(()=>assert.fail('should have thrown'),(e:unknown)=>e as Error);
 assert.ok(err instanceof ServiceUnavailableError);
 assert.equal(err.message,MSG);
 return err;
}

test('messages — FR and EN texts are the agreed ones',()=>{
 assert.equal(fr['error.serviceUnavailable'],'Service momentanément indisponible. Réessayez dans quelques instants.');
 assert.equal(en['error.serviceUnavailable'],'Service temporarily unavailable. Please try again in a moment.');
});
test('1 — 200 + JSON: the data is returned untouched',async()=>{
 const {res,data}=await fetchApiJson(async()=>jsonRes(200,{rows:[1,2],ok:true}),MSG);
 assert.equal(res.status,200);assert.deepEqual(data,{rows:[1,2],ok:true});
 const charset=await fetchApiJson(async()=>new Response('{"a":1}',{status:200,headers:{'content-type':'application/json; charset=utf-8'}}),MSG);
 assert.deepEqual(charset.data,{a:1});
});
test('2 — JSON business error: status and server message reach api() unchanged',async()=>{
 const {res,data}=await fetchApiJson(async()=>jsonRes(429,{error:'Quota horaire de votre organisation atteint.',code:'QUOTA_EXCEEDED'}),MSG);
 assert.equal(res.ok,false);assert.equal(res.status,429);
 assert.deepEqual(data,{error:'Quota horaire de votre organisation atteint.',code:'QUOTA_EXCEEDED'});
 assert.match(page,/if\(!res\.ok\)\{\n \/\/ The server always answers in French.*\n.*\n const err=Error\(localizeApiErrorMessage\(data\.error\?\?'Erreur',data\.code,locale\)\);/,'business-error branch of api() unchanged');
});
test('3 — 401 JSON: handed to api(), whose session-expiry branch is unchanged',async()=>{
 const {res,data}=await fetchApiJson(async()=>jsonRes(401,{error:'Non authentifié'}),MSG);
 assert.equal(res.status,401);assert.deepEqual(data,{error:'Non authentifié'});
 assert.match(page,/const \{res,data\}=await fetchApiJson\(\(\)=>fetch\(`\/api\/v1\/\$\{path\}`,\{method,headers:\{Authorization:`Bearer \$\{t\}`,'Content-Type':'application\/json'\},\.\.\.\(body\?\{body:JSON\.stringify\(body\)\}:\{\}\)\}\),tr\('error\.serviceUnavailable'\)\);if\(res\.status===401&&mode==='live'\)\{await logout\(\);throw Error\(tr\('error\.sessionExpired'\)\)\}/,'same request, same 401 handling');
});
test('4 — 502 text/plain from a proxy: clean message',async()=>{
 await unavailable(async()=>new Response(UPSTREAM,{status:502,headers:{'content-type':'text/plain'}}));
});
test('5 — 502 HTML error page: clean message',async()=>{
 await unavailable(async()=>new Response(HTML,{status:502,headers:{'content-type':'text/html; charset=utf-8'}}));
});
test('6 — network failure (fetch rejects, no Response): clean message',async()=>{
 await unavailable(async()=>{throw new TypeError('Failed to fetch')});
});
test('7 — "Unexpected token" is never exposed: non-JSON body, missing content-type, cut JSON',async()=>{
 for(const send of [
  async()=>new Response(UPSTREAM,{status:200,headers:{'content-type':'text/plain'}}), // 2xx but not JSON
  async()=>new Response(UPSTREAM,{status:502}),                                       // no content-type at all
  async()=>new Response('{"rows":[1,',{status:200,headers:{'content-type':'application/json'}}), // cut JSON body
  async()=>new Response('',{status:200,headers:{'content-type':'application/json'}}), // empty JSON body
 ]){const err=await unavailable(send);assert.doesNotMatch(err.message,/Unexpected token|not valid JSON|JSON\.parse/i)}
});
test('8 — no raw upstream content is exposed',async()=>{
 for(const [body,type] of [[UPSTREAM,'text/plain'],[HTML,'text/html']]){
  const err=await unavailable(async()=>new Response(body,{status:502,headers:{'content-type':type}}));
  for(const leak of ['upstream','<html','DOCTYPE','502','/var/task','route.js'])assert.ok(!err.message.includes(leak),`leaked: ${leak}`);
 }
});
test('scope — no retry: one call to fetch per api() call',async()=>{
 let calls=0;
 await unavailable(async()=>{calls++;return new Response(UPSTREAM,{status:502,headers:{'content-type':'text/plain'}})});
 assert.equal(calls,1);
});
