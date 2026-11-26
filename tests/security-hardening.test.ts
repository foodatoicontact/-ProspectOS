// Audit 2026-11-11, lot sécurité: S1 (HTTP security headers) and S2/S3 (shared rate limits, migration 047).
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import nextConfig,{SECURITY_HEADERS} from '../next.config.ts';
import {API_RULE,TENDERS_RULE,ruleForPath,hitForAccount,hitForAddress,addressKey,tooManyRequests} from '../src/server/rate-limit.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('S1 headers: no framing by another site, nosniff, referrer policy, permissions policy; on every path but the demo page',async()=>{
 const h=Object.fromEntries(SECURITY_HEADERS.map(x=>[x.key,x.value]));
 assert.match(h['Content-Security-Policy']!,/frame-ancestors 'none'/);
 assert.match(h['Content-Security-Policy']!,/base-uri 'self'/);
 assert.match(h['Content-Security-Policy']!,/object-src 'none'/);
 // Only directives that cannot block the app's own scripts, styles or requests (a full policy needs nonces first).
 assert.doesNotMatch(h['Content-Security-Policy']!,/script-src|style-src|connect-src|default-src|form-action/);
 assert.equal(h['X-Frame-Options'],'DENY');
 assert.equal(h['X-Content-Type-Options'],'nosniff');
 assert.equal(h['Referrer-Policy'],'strict-origin-when-cross-origin');
 assert.match(h['Permissions-Policy']!,/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
 assert.doesNotMatch(h['Permissions-Policy']!,/clipboard/,'the app copies to the clipboard');
 assert.equal(nextConfig.poweredByHeader,false);
 const rules=await nextConfig.headers!();
 // Owner decision (26 nov. 2026, PWA, docs/PWA.md): a second rule, for /sw.js only — always re-checked, scope '/'.
 assert.equal(rules.length,2);
 assert.deepEqual(rules[1],{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'}]});
 const re=new RegExp(`^${rules[0]!.source.replace('/((?!d/).*)','/((?!d/).*)')}$`);
 for(const p of ['/','/tarifs','/api/v1/prospects','/veille-entreprises','/dashboard'])assert.ok(re.test(p),p);
 assert.ok(!re.test('/d/abc123'),'the demo page keeps the stricter headers of its own route');
 assert.match(read('app/d/[token]/route.ts'),/frame-ancestors 'none'/);
});

test('S2 rules: 120 a minute per account, 10 a minute for open tenders (BOAMP at each call, no plan quota)',()=>{
 assert.deepEqual(ruleForPath(['prospects']),API_RULE);
 assert.deepEqual(ruleForPath(['tenders','search']),TENDERS_RULE);
 assert.deepEqual([API_RULE.limit,API_RULE.windowSeconds,TENDERS_RULE.limit,TENDERS_RULE.windowSeconds],[120,60,10,60]);
});

test('S2 counter: asks the database by bucket only (the account comes from the token), refuses past the limit, fail-open',async()=>{
 const calls:[string,Record<string,unknown>][]=[];const logs:unknown[]=[];
 const rpc=(answer:{data:unknown;error:unknown}|Error)=>(fn:string,args:Record<string,unknown>)=>{calls.push([fn,args]);return answer instanceof Error?Promise.reject(answer):Promise.resolve(answer)};
 assert.deepEqual(await hitForAccount(rpc({data:{allowed:true,count:1,retry_after:0},error:null}),API_RULE,l=>logs.push(l)),{allowed:true,retryAfter:0});
 assert.deepEqual(calls[0],['rate_limit_hit',{p_bucket:'api',p_limit:120,p_window_seconds:60}]);
 assert.ok(!JSON.stringify(calls[0]).match(/user|uid|account/),'no subject is sent: the database takes it from the token');
 assert.deepEqual(await hitForAccount(rpc({data:{allowed:false,count:121,retry_after:17},error:null}),API_RULE,l=>logs.push(l)),{allowed:false,retryAfter:17});
 // Migration not applied, database error, malformed answer, network failure: the request goes on, one line is logged.
 for(const a of [{data:null,error:{message:'function does not exist'}},{data:{nope:1},error:null},new Error('fetch failed')]){
  assert.deepEqual(await hitForAccount(rpc(a),API_RULE,l=>logs.push(l)),{allowed:true,retryAfter:0});
 }
 assert.equal(logs.length,3);
 const r=tooManyRequests(17,{code:'RATE_LIMITED'});
 assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'17');assert.equal(r.headers.get('cache-control'),'no-store');
});

test('S3 public form: shared count per hashed client address — the address itself is never sent or stored',async()=>{
 const calls:[string,Record<string,unknown>][]=[];
 const rpc=(fn:string,args:Record<string,unknown>)=>{calls.push([fn,args]);return Promise.resolve({data:{allowed:false,retry_after:600},error:null})};
 const r=await hitForAddress(rpc,{bucket:'prospect_request',limit:5,windowSeconds:3600},'203.0.113.7',()=>{});
 assert.deepEqual(r,{allowed:false,retryAfter:600});
 assert.equal(calls[0]![0],'rate_limit_hit_key');
 const key=String(calls[0]![1].p_key);
 assert.match(key,/^prospect_request:[A-Za-z0-9_-]{32}$/,'matches the key format the database accepts');
 assert.ok(!key.includes('203.0.113'));
 assert.equal(key,addressKey('prospect_request','203.0.113.7'),'stable for one address');
 assert.notEqual(key,addressKey('prospect_request','203.0.113.8'));
 const route=read('app/api/public/demande-prospects/route.ts');
 assert.match(route,/hitForAddress\(.*bucket:'prospect_request',limit:5,windowSeconds:3600/s);
 assert.ok(route.indexOf('hitForAddress')<route.indexOf('await request.text()'),'counted before the body is read');
});

test('S2 wiring: every signed-in API request is counted right after authentication, before any handler',()=>{
 const route=read('app/api/v1/[...path]/route.ts');
 const auth=route.indexOf('await authenticatedDb(request)');const limit=route.indexOf('hitForAccount(');
 assert.ok(auth>0&&limit>auth,'after authentication');
 assert.ok(limit<route.indexOf('handleIcpImport(request'),'before the first handler');
 assert.match(route,/if\(!rate\.allowed\)return tooManyRequests\(rate\.retryAfter,/);
});
