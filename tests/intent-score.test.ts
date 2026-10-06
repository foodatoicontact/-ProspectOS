// Signal Engine S5 — INTENT score (src/domain/intent.ts): "is there a recent reason to contact this company now?".
// Deterministic and explainable: each line = weight × confidence × recency × relevance, only for VERIFIED signals,
// diminishing returns and a cap per type, total capped at 100. No model, no randomness, no hidden input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scoreIntent,recency,DECAY,DEFAULT_INTENT_WEIGHTS,type IntentSignal} from '../src/domain/intent.ts';
import {SIGNAL_TYPES} from '../src/signals/types.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const s=(o:Partial<IntentSignal>={}):IntentSignal=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'ACME recrute un RSSI',excerpt:'ACME recrute un RSSI à Lyon.',
 source_url:'https://jobs.example/rssi',source_domain:'jobs.example',confidence:1,event_date:null,published_at:daysAgo(4),observed_at:daysAgo(1),matched_terms:['RSSI'],...o});
const PROFILE={types:{hiring_role:25,funding:30,leadership_change:25},terms:['RSSI']};

test('decay: every type has a half-life and a max age; age 0 → 1, half-life → 0.5, beyond max → 0, future → 0',()=>{
 assert.deepEqual(Object.keys(DECAY).sort(),[...SIGNAL_TYPES].sort());
 assert.deepEqual(Object.keys(DEFAULT_INTENT_WEIGHTS).sort(),[...SIGNAL_TYPES].sort());
 for(const t of SIGNAL_TYPES){
  const {halfLifeDays,maxAgeDays}=DECAY[t];
  assert.equal(recency(0,t),1);assert.equal(Math.round(recency(halfLifeDays,t)*1000)/1000,0.5);
  assert.equal(recency(maxAgeDays+1,t),0);assert.equal(recency(-1,t),0);
 }
 assert.ok(DECAY.incident_cyber.halfLifeDays<DECAY.leadership_change.halfLifeDays&&DECAY.leadership_change.halfLifeDays<DECAY.funding.halfLifeDays,'urgent signals fade fastest');
});

test('one verified signal: points = weight × confidence × recency × relevance, every factor shown',()=>{
 const r=scoreIntent([s()],PROFILE,NOW);
 const line=r.lines[0];
 assert.equal(line.weight,25);assert.equal(line.confidence,1);assert.equal(line.relevance,1,'tracked type and a profile term in the excerpt');
 assert.equal(line.age_days,4);assert.equal(line.date_basis,'published');
 assert.equal(line.points,Math.round(25*1*recency(4,'hiring_role')*1*10)/10);
 assert.equal(r.score,Math.round(line.points));assert.equal(line.strength,'strong');
});

test('only VERIFIED signals count; pending ones are listed with what they could add, rejected ones ignored',()=>{
 const r=scoreIntent([s({status:'PENDING_REVIEW',id:'p'}),s({status:'REJECTED',id:'x'})],PROFILE,NOW);
 assert.equal(r.score,0);assert.equal(r.lines.length,0);
 assert.equal(r.pending.count,1);assert.ok(r.pending.potential>0);
});

test('relevance: tracked + term 1.0, tracked without term 0.6, untracked type 0; no profile → default weights at 0.6',()=>{
 // Relevance reads the title, the excerpt and the matched terms: none mentions a profile term here.
 assert.equal(scoreIntent([s({matched_terms:[],title:'ACME recrute',excerpt:'ACME recrute un développeur à Lyon.'})],PROFILE,NOW).lines[0].relevance,0.6);
 assert.equal(scoreIntent([s({signal_type:'event'})],PROFILE,NOW).lines.length,0,'a type the profile does not track never counts');
 const d=scoreIntent([s({matched_terms:[],title:'ACME recrute',excerpt:'ACME recrute un développeur à Lyon.'})],null,NOW).lines[0];
 assert.equal(d.weight,DEFAULT_INTENT_WEIGHTS.hiring_role);assert.equal(d.relevance,0.6);
});

test('dates: event date first, then publication, then observation; an observed-only fact is visible as such',()=>{
 assert.equal(scoreIntent([s({event_date:daysAgo(10).slice(0,10)})],PROFILE,NOW).lines[0].date_basis,'event');
 const o=scoreIntent([s({published_at:null,observed_at:daysAgo(2)})],PROFILE,NOW).lines[0];
 assert.equal(o.date_basis,'observed_only');assert.equal(o.age_days,2);
});

test('too old: past its max age a signal gives 0 points and is kept as archive context',()=>{
 const r=scoreIntent([s({published_at:daysAgo(200)})],PROFILE,NOW);
 assert.equal(r.score,0);assert.equal(r.lines.length,0);assert.equal(r.archived.length,1);assert.equal(r.archived[0].strength,'archive');
});

test('diminishing returns per type: 1, ½, ¼, then nothing, capped at the type weight — ten job ads are not ten signals',()=>{
 // Snippet-level confidence (0.6) so a single ad does not already reach the type's cap.
 const ten=Array.from({length:10},(_,i)=>s({id:`j${i}`,published_at:daysAgo(0),confidence:0.6}));
 const r=scoreIntent(ten,PROFILE,NOW);
 assert.ok(r.score<=25,'never more than the type weight');
 assert.equal(r.lines.filter(l=>l.points>0).length,3);
 assert.deepEqual(r.lines.slice(0,3).map(l=>l.multiplier),[1,0.5,0.25]);
});

test('several types add up, total capped at 100; lines sorted by points, deterministic whatever the input order',()=>{
 const many=[s({id:'a'}),s({id:'b',signal_type:'funding',matched_terms:[],published_at:daysAgo(5)}),s({id:'c',signal_type:'leadership_change',published_at:daysAgo(10)})];
 const r1=scoreIntent(many,PROFILE,NOW),r2=scoreIntent([...many].reverse(),PROFILE,NOW);
 assert.deepEqual(r1,r2);assert.ok(r1.score>25);
 assert.deepEqual(r1.lines.map(l=>l.points),[...r1.lines.map(l=>l.points)].sort((a,b)=>b-a));
 const huge={types:Object.fromEntries(SIGNAL_TYPES.map(t=>[t,50])),terms:['RSSI']};
 const all=SIGNAL_TYPES.map((t,i)=>s({id:`t${i}`,signal_type:t,published_at:daysAgo(0)}));
 assert.equal(scoreIntent(all,huge,NOW).score,100);
});

test('purity: no model, no network, no clock read, no FIT input — and FIT never reads intent',async()=>{
 const src=await readFile(new URL('../src/domain/intent.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/fetch\(|anthropic|openai|Math\.random|Date\.now\(\)|new Date\(\)(?!\.)|scoreProspect|evidence/i);
 const core=await readFile(new URL('../src/domain/core.ts',import.meta.url),'utf8');
 assert.doesNotMatch(core,/intent/i);
});
