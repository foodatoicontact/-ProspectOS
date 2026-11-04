// ICP import — the output budget of one extraction call (src/domain/icp/budget.ts, docs/ICP_IMPORT.md). Smoke test #3
// (4 Nov. 2026) was cut at max_tokens with wider bounds: the profile filled to every bound must fit the budget, and a
// bound cannot be raised without re-doing the calculation.
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {ICP_LIMITS,parseIcpProfile} from '../src/domain/icp/schema.ts';
import {largestProfile,estimateOutputTokens,ICP_OUTPUT_BUDGET_TOKENS,CHARS_PER_TOKEN} from '../src/domain/icp/budget.ts';
import {ICP_MAX_TOKENS,ICP_SYSTEM_PROMPT,structureIcp,StructureIcpError} from '../src/server/ai.ts';

// The bounds as reviewed with the budget below. Changing one of them (or the budget) means re-running the calculation
// and updating both, together, here and in docs/ICP_IMPORT.md.
const REVIEWED={budget:2920,charsPerToken:2.4,maxTokens:4096,limits:{
 source:40,name:60,activity:100,city:40,sites:6,zones:4,
 service:40,services:9,promise:50,unit:10,promises:3,differentiator:60,differentiators:3,proof:50,proofs:1,
 segmentKey:20,segmentLabel:40,segments:3,apeCodes:1,sizeBands:2,salesCycle:20,
 personas:1,role:40,painPoints:1,painPoint:50,messageAngle:50,
 signals:2,segmentRefs:2,exclusions:1,exclusionLabel:40,exclusionReason:40}};

test('the largest profile the schema accepts fits the output budget, with a margin under max_tokens',()=>{
 const p=largestProfile();
 const parsed=parseIcpProfile(p);assert.ok(parsed.ok,JSON.stringify(!parsed.ok&&parsed.issues));
 const tokens=estimateOutputTokens(p);
 assert.ok(tokens<=ICP_OUTPUT_BUDGET_TOKENS,`largest profile ≈ ${tokens} tokens > budget ${ICP_OUTPUT_BUDGET_TOKENS}`);
 assert.equal(ICP_MAX_TOKENS,4096,'max_tokens is not raised (≈ 29 s for 4 096 tokens; the route has 60 s, a retry included)');
 assert.ok(ICP_OUTPUT_BUDGET_TOKENS<=ICP_MAX_TOKENS*0.75,'at least 25 % of max_tokens left for what the estimate does not see');
});

test('a bound cannot be raised without the budget: the reviewed bounds and budget are pinned together',()=>{
 assert.deepEqual({budget:ICP_OUTPUT_BUDGET_TOKENS,charsPerToken:CHARS_PER_TOKEN,maxTokens:ICP_MAX_TOKENS,limits:{...ICP_LIMITS}},REVIEWED,
  'a bound, the budget or the estimate changed: recompute largestProfile against the budget and update REVIEWED and docs/ICP_IMPORT.md together');
 // And the budget really binds: raising any list bound that carries sourced text by one item goes over it.
 for(const k of ['sites','services','promises','differentiators','proofs','segments','personas','exclusions'] as const){
  const raised={...ICP_LIMITS,[k]:ICP_LIMITS[k]+1};
  assert.ok(estimateOutputTokens(largestProfile(raised))>ICP_OUTPUT_BUDGET_TOKENS,`one more ${k} must not fit the same budget`);
 }
 assert.ok(estimateOutputTokens(largestProfile({...ICP_LIMITS,source:ICP_LIMITS.source+20}))>ICP_OUTPUT_BUDGET_TOKENS,'longer sources must not fit either');
});

test('the schema enforces the bounds the budget counts on',()=>{
 const p=largestProfile();
 const over=(mut:(x:any)=>void)=>{const c=structuredClone(p) as any;mut(c);return parseIcpProfile(c).ok};
 assert.equal(over(c=>c.offer.services.push(c.offer.services[0])),false,'one service too many');
 assert.equal(over(c=>c.segments.push({...c.segments[0],key:'autre'})),false,'one segment too many');
 assert.equal(over(c=>{c.company.name.source+='x'}),false,'a source one character too long');
 assert.equal(over(c=>{c.company.activity.value+='x'}),false,'an activity one character too long');
});

test('the prompt states the same bounds and asks for compact JSON',()=>{
 for(const s of [`${ICP_LIMITS.services} services`,`${ICP_LIMITS.segments} segments`,`${ICP_LIMITS.source} caractères au plus`,`service ${ICP_LIMITS.service}`])assert.ok(ICP_SYSTEM_PROMPT.includes(s),s);
 assert.match(ICP_SYSTEM_PROMPT,/JSON compact, sur une seule ligne, sans indentation/);
});

test('a truncated answer is logged and reported with input and output tokens apart, next to max_tokens',async()=>{
 const env={...process.env};Object.assign(process.env,{AI_PROVIDER:'anthropic',AI_MODEL:'claude-sonnet-5',AI_API_KEY:'k'});
 const f=mock.method(globalThis,'fetch',async()=>Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'{"version":1,'}],usage:{input_tokens:5423,output_tokens:4096}}));
 const logs:string[]=[];const e=mock.method(console,'error',(l:string)=>{logs.push(String(l))});
 try{
  const err=await structureIcp('Atlantique Sécurité Incendie installe des extincteurs à Nantes.').catch(x=>x as StructureIcpError);
  assert.ok(err instanceof StructureIcpError);assert.equal(err.code,'AI_TRUNCATED_RESULT');
  assert.equal(err.usage!.input_tokens,5423);assert.equal(err.usage!.output_tokens,4096);
  const line=logs.map(l=>JSON.parse(l)).find(l=>l.reason==='TRUNCATED_MAX_TOKENS')!;
  assert.deepEqual({i:line.input_tokens,o:line.output_tokens,last:line.last_output_tokens,max:line.max_tokens},{i:5423,o:4096,last:4096,max:4096});
 }finally{f.mock.restore();e.mock.restore();for(const k of ['AI_PROVIDER','AI_MODEL','AI_API_KEY'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]}
});

test('input side: the system prompt, skeleton included, stays a bounded fixed cost per call',async()=>{
 const {estimatePromptTokens}=await import('../src/domain/icp/budget.ts');
 const t=estimatePromptTokens(ICP_SYSTEM_PROMPT);
 assert.ok(t<=2000,`system prompt ≈ ${t} tokens (> 2 000): it is paid on every call, a retry included`);
 assert.match(ICP_SYSTEM_PROMPT,/Squelette \(forme seulement, pas des données\)/);
});
