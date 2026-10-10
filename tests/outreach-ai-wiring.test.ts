// O1/O2 — AI outreach wiring (src/outreach/ai-generate.ts + the outreach route). One AI attempt = one "AI outreach"
// unit, reserved before the provider call; its rule-based fallback belongs to the same attempt (no second unit). No
// attempt possible (not configured, BYOK broken, no quota) = rule-based, 0 unit. Save / Edit / Approve / Copy never
// reserve. The model gets the angle, the verified sources, the style profile and at most 5 of the SAME user's really
// edited messages (masked) — never another user's, never an old fact as a source. Every AI output goes through the
// fact guard; anything it refuses is replaced by the rule-based message and recorded as a fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async(path:string)=>{try{return await import(path)}catch{return null}};
const need=(m:any,name:string)=>{assert.ok(m,`module for ${name} exists`);return m};
const src=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const ROUTE='../app/api/v1/[...path]/route.ts';
const day=(d:number)=>new Date(Date.parse('2026-10-10T12:00:00Z')-d*86400000).toISOString();

const composed={text:'Bonjour l’équipe Kerlan, j’ai vu cette actualité récente vous concernant : « Kerlan recrute un responsable de la sécurité des systèmes d’information » (jobs.example). Nous auditons la sécurité des sites industriels. Seriez-vous ouvert à un court échange ?',
 evidence_ids:[],signal_ids:['s1'],public_content_ids:[],provider:'rule_based_v1',why_now:null,
 angle:{type:'signal',source_id:'s1',label:'Kerlan recrute un RSSI',reason:'STRONGEST_VERIFIED_SIGNAL',source_url:'https://jobs.example/kerlan',observed_at:day(1),excerpt:'Kerlan recrute un responsable de la sécurité des systèmes d’information.'}};
const input=()=>({composed,name:'Kerlan',offer:'Nous auditons la sécurité des sites industriels.',locale:'fr' as const,style:null,sources:['Kerlan recrute un responsable de la sécurité des systèmes d’information.'],userId:'me'});
const rows=[
 ...Array.from({length:7},(_,i)=>({id:`m${i}`,created_by:'me',generated_content:`Bonjour l’équipe Société X${i}, « Société X${i} lève 3 M€ » https://x${i}.example 450 salariés.`,content:`Bonjour Société X${i}, bravo. https://x${i}.example 450 salariés.`,created_at:day(i+1),prospect_name:`Société X${i}`})),
 {id:'other',created_by:'someone-else',generated_content:'Bonjour A',content:'Salut A',created_at:day(0),prospect_name:'Autre'},
 {id:'same',created_by:'me',generated_content:'Bonjour B.',content:'Bonjour B.',created_at:day(0),prospect_name:'B'},
 {id:'legacy',created_by:'me',generated_content:null,content:'Ancien',created_at:day(0),prospect_name:'C'},
];
const VALID='Bonjour, j’ai vu que Kerlan recrute un responsable de la sécurité des systèmes d’information. Nous auditons la sécurité des sites industriels. Seriez-vous ouvert à un court échange ?';
function deps(o:Record<string,any>={}){
 const log:any[]=[];
 const d={userId:'me',
  availability:async()=>({ok:true,apiKeyOverride:null,billingSource:'PLATFORM'}),
  reserve:async()=>{log.push(['reserve']);return 'u1'},
  loadExampleRows:async()=>rows,
  call:async(req:any)=>{log.push(['call',req]);return {text:JSON.stringify({message:VALID}),usage:{provider:'anthropic',model:'m',input_tokens:100,output_tokens:50}}},
  meter:async(u:any,b:string)=>{log.push(['meter',u,b])},...o};
 return {d,log};
}

test('A — a valid, supported AI message is kept: provider ai_composer_v1, 1 unit, metered once as outreach_generation',async()=>{
 const g=need(await load('../src/outreach/ai-generate.ts'),'ai-generate');
 const {d,log}=deps();const r=await g.generateOutreachWithAi(input(),d);
 assert.equal(r.provider,'ai_composer_v1');assert.equal(r.text,VALID);assert.equal(r.attempted,true);assert.equal(r.usage_id,'u1');assert.equal(r.outcome,'AI_VALID');
 assert.equal(log.filter(l=>l[0]==='reserve').length,1);assert.equal(log.filter(l=>l[0]==='meter').length,1);
 assert.deepEqual(r.signal_ids,['s1'],'the provenance of the attempt is the rule-based angle’s');
});

const fails:[string,Record<string,any>,string][]=[
 ['B banned phrase',{call:async()=>({text:JSON.stringify({message:'Je me permets de vous contacter : Kerlan recrute un responsable de la sécurité des systèmes d’information.'}),usage:null})},'BANNED_PHRASE'],
 ['C unsupported figure',{call:async()=>({text:JSON.stringify({message:'Avec vos 450 salariés, Kerlan recrute un responsable de la sécurité des systèmes d’information.'}),usage:null})},'UNSUPPORTED_NUMBER'],
 ['D unsupported URL',{call:async()=>({text:JSON.stringify({message:'Voir https://x0.example : Kerlan recrute un responsable de la sécurité des systèmes d’information.'}),usage:null})},'UNSUPPORTED_URL'],
 ['E invented quote',{call:async()=>({text:JSON.stringify({message:'Vous écrivez « la sécurité est notre priorité absolue ». Nous auditons la sécurité des sites industriels.'}),usage:null})},'UNSUPPORTED_QUOTE'],
 ['F old example company',{call:async()=>({text:JSON.stringify({message:'Comme pour Société X1, Kerlan recrute un responsable de la sécurité des systèmes d’information.'}),usage:null})},'FOREIGN_COMPANY'],
 ['G timeout',{call:()=>new Promise(()=>{}),timeoutMs:20},'AI_TIMEOUT'],
 ['H provider error',{call:async()=>{throw Error('AI_UNAVAILABLE')}},'AI_ERROR'],
 ['I invalid JSON',{call:async()=>({text:'Bonjour, voici le message',usage:null})},'INVALID_JSON'],
];
for(const [name,o,reason] of fails)test(`${name} → rule-based fallback, same attempt (1 unit, never 2), recorded as a fallback`,async()=>{
 const g=need(await load('../src/outreach/ai-generate.ts'),'ai-generate');
 const {d,log}=deps(o);const r=await g.generateOutreachWithAi(input(),d);
 assert.equal(r.provider,'rule_based_fallback_v1');assert.equal(r.text,composed.text,'the safe rule-based message, unchanged');
 assert.equal(r.outcome,'FALLBACK');assert.equal(r.fallback_reason,reason);assert.equal(r.attempted,true);
 assert.equal(log.filter(l=>l[0]==='reserve').length,1,'one unit for the attempt and its fallback');
});

test('failure with real provider usage is still metered (once); a failure without usage meters nothing',async()=>{
 const g=need(await load('../src/outreach/ai-generate.ts'),'ai-generate');
 const withUsage=deps({call:async()=>{throw Object.assign(Error('AI_INVALID_RESULT'),{usage:{provider:'anthropic',model:'m',input_tokens:10,output_tokens:5}})}});
 await g.generateOutreachWithAi(input(),withUsage.d);assert.equal(withUsage.log.filter(l=>l[0]==='meter').length,1);
 const banned=deps({call:async()=>({text:JSON.stringify({message:'synergie'}),usage:{provider:'anthropic',model:'m',input_tokens:10,output_tokens:5}})});
 await g.generateOutreachWithAi(input(),banned.d);assert.equal(banned.log.filter(l=>l[0]==='meter').length,1,'a refused but billed answer is metered');
 const none=deps({call:async()=>{throw Error('AI_UNAVAILABLE')}});await g.generateOutreachWithAi(input(),none.d);assert.equal(none.log.filter(l=>l[0]==='meter').length,0);
});

test('no attempt possible (not configured, BYOK broken, quota unavailable) → rule-based, 0 unit, no provider call',async()=>{
 const g=need(await load('../src/outreach/ai-generate.ts'),'ai-generate');
 for(const o of [{availability:async()=>({ok:false,reason:'AI_NOT_CONFIGURED'})},{availability:async()=>({ok:false,reason:'BYOK_CREDENTIAL_INVALID'})},{reserve:async()=>{throw Error('AI_OUTREACH_LIMIT_REACHED')}}]){
  const {d,log}=deps(o);const r=await g.generateOutreachWithAi(input(),d);
  assert.equal(r.provider,'rule_based_v1');assert.equal(r.attempted,false);assert.equal(r.usage_id,null);assert.equal(r.text,composed.text);assert.ok(r.fallback_reason);
  assert.equal(log.filter(l=>l[0]==='call').length,0);assert.equal(log.filter(l=>l[0]==='meter').length,0);
 }
});

test('style learning through the pipeline: same user only, really edited only, 5 max, masked — never a source',async()=>{
 const g=need(await load('../src/outreach/ai-generate.ts'),'ai-generate');
 const {d,log}=deps();const r=await g.generateOutreachWithAi(input(),d);
 const req=log.find(l=>l[0]==='call')[1];const user=JSON.parse(req.user);
 assert.equal(user.examples.length,5);assert.equal(r.examples_used,5);
 const ex=JSON.stringify(user.examples);
 assert.doesNotMatch(ex,/Société X|x\d\.example|lève 3 M€|Autre|Salut A/,'old names, links and quotes are masked; other users are excluded');
 assert.deepEqual(user.sources,input().sources,'only the new prospect’s verified sources are facts');
 assert.doesNotMatch(JSON.stringify(user.sources),/Société X|450/);
});

test('Regenerate via AI = a new attempt = a new unit; rule-based generation and Save/Edit/Approve/Copy reserve nothing',async()=>{
 const g=need(await load('../src/outreach/ai-generate.ts'),'ai-generate');
 const {d,log}=deps();await g.generateOutreachWithAi(input(),d);await g.generateOutreachWithAi(input(),d);
 assert.equal(log.filter(l=>l[0]==='reserve').length,2);
 const route=await src(ROUTE);
 const post=route.slice(route.indexOf("resource==='outreach'&&request.method==='POST'"),route.indexOf("resource==='outreach'&&request.method==='GET'"));
 assert.match(post,/if\(body\.ai===true\)/,'AI only when the user asks for it');
 assert.match(post,/reserve:\(\)=>checked\(db\.rpc\('reserve_ai_outreach',\{p_prospect_id:p\.id\}\)\)/);
 const patch=route.slice(route.indexOf("resource==='outreach'&&request.method==='PATCH'"),route.indexOf("resource==='events'"));
 assert.doesNotMatch(patch,/reserve_ai_outreach|generateOutreachWithAi|recordApiUsage/);
});

test('route: the attempt is closed with its outcome and linked to the saved message; usage metered as outreach_generation; BYOK as for the offer analysis',async()=>{
 const route=await src(ROUTE);
 assert.match(route,/db\.rpc\('finish_ai_outreach',\{p_usage_id:ai\.usage_id,p_outcome:ai\.outcome,p_reason:ai\.fallback_reason,p_outreach_id:row\?\.id\?\?null\}\)/);
 assert.match(route,/operation:'outreach_generation'/);
 assert.match(route,/provider:ai\?ai\.provider:composed\.provider/);
 const avail=route.slice(route.indexOf('availability:async()=>'),route.indexOf('availability:async()=>')+600);
 assert.match(avail,/resolveProviderCredential\(p\.organization_id,'anthropic'\)/);assert.match(avail,/BYOK_CREDENTIAL_INVALID/);
 const pricing=await src('../src/server/pricing.ts');assert.match(pricing,/'outreach_generation'/);
 assert.doesNotMatch(route.slice(route.indexOf("resource==='outreach'&&request.method==='POST'"),route.indexOf("resource==='outreach'&&request.method==='GET'")),/operation:'offer_analysis'/);
});

test('AI provider adapter: one JSON call, no tools, thinking off, bounded; usage returned; key never logged',async()=>{
 const ai=await src('../src/server/ai.ts');
 const fn=ai.slice(ai.indexOf('export async function composeOutreachMessage'));
 assert.ok(fn.length>100,'composeOutreachMessage exists');
 assert.match(fn,/thinking:\{type:'disabled'\}/);assert.doesNotMatch(fn,/tools|web_search/);
 assert.match(fn,/AbortSignal\.timeout\(/);assert.doesNotMatch(fn,/console\.(log|error)\([^)]*key/i);
});

test('UI: "Rédiger avec l’IA" is an explicit choice; the result says whether the AI text or the safe fallback is shown',async()=>{
 const page=await src('../app/page.tsx');
 assert.match(page,/api\('outreach','POST',\{prospect_id:current\.id,locale,ai:useAi\}\)/);
 assert.match(page,/tr\('outreach\.useAi'\)/);assert.match(page,/tr\('outreach\.aiFallback'\)/);
 for(const lang of ['fr','en']){const dict=(await import(`../src/i18n/${lang}.ts`))[lang];for(const k of ['outreach.useAi','outreach.aiFallback','outreach.aiUsed'])assert.ok(dict[k],`${lang} ${k}`)}
});

test('AI provider adapter (behaviour, fetch stubbed): one request, platform key or BYOK, usage returned; untrusted answers throw with their billed usage',async()=>{
 const {composeOutreachMessage}=await import('../src/server/ai.ts');
 const env={...process.env};const realFetch=globalThis.fetch;const seen:any[]=[];
 const reply=(o:any)=>{globalThis.fetch=(async(url:string,init:any)=>{seen.push({url,init});return Response.json(o)}) as any};
 try{
  Object.assign(process.env,{AI_PROVIDER:'anthropic',AI_MODEL:'claude-sonnet-5',AI_API_KEY:'platform-key'});
  reply({stop_reason:'end_turn',content:[{type:'text',text:'{"message":"Bonjour"}'}],usage:{input_tokens:120,output_tokens:30}});
  const r=await composeOutreachMessage({system:'S',user:'{"company":"K"}'});
  assert.equal(r.text,'{"message":"Bonjour"}');assert.deepEqual(r.usage,{provider:'anthropic',model:'claude-sonnet-5',input_tokens:120,output_tokens:30});
  const body=JSON.parse(seen[0].init.body);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.tools,undefined);assert.equal(seen[0].init.headers['x-api-key'],'platform-key');
  await composeOutreachMessage({system:'S',user:'U'},{apiKeyOverride:'byok-key'});assert.equal(seen[1].init.headers['x-api-key'],'byok-key');
  reply({stop_reason:'max_tokens',content:[{type:'text',text:'{"mess'}],usage:{input_tokens:120,output_tokens:1024}});
  await assert.rejects(composeOutreachMessage({system:'S',user:'U'}),(e:any)=>e.message==='AI_INVALID_RESULT'&&e.usage?.output_tokens===1024);
  globalThis.fetch=(async()=>new Response('',{status:529})) as any;
  await assert.rejects(composeOutreachMessage({system:'S',user:'U'}),(e:any)=>e.message==='AI_UNAVAILABLE'&&!e.usage);
  process.env.AI_PROVIDER='';await assert.rejects(composeOutreachMessage({system:'S',user:'U'}),/AI_NOT_CONFIGURED/);
 }finally{globalThis.fetch=realFetch;for(const k of ['AI_PROVIDER','AI_MODEL','AI_API_KEY'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]}
});
