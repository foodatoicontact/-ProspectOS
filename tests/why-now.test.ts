// Signal Engine S7 — "why now" (src/domain/why-now.ts). Plan NO_GO: a single test sentence carrying a fact that is not
// in the verified excerpt. The sentence quotes the strongest VERIFIED signal verbatim, with its domain and own date.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {whyNow,withWhyNow} from '../src/domain/why-now.ts';
import {generateOutreach,DEFAULT_CRITERIA} from '../src/domain/core.ts';
import type {IntentSignal} from '../src/domain/intent.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const day=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const s=(o:Partial<IntentSignal>={}):IntentSignal=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'Kerlan recrute un RSSI',excerpt:'Kerlan recrute un responsable de la sécurité des systèmes d’information en CDI.',
 source_url:'https://jobs.example/kerlan',source_domain:'jobs.example',confidence:0.8,event_date:null,published_at:day(4),observed_at:day(1),matched_terms:[],...o});
const P={types:{hiring_role:25,funding:30,leadership_change:25},terms:[]};

test('the strongest verified signal, quoted verbatim with its domain and its own date',()=>{
 const w=whyNow([s(),s({id:'s2',signal_type:'funding',excerpt:'Kerlan lève 3 M€.',published_at:day(2),source_domain:'news.example'})],P,NOW)!;
 assert.deepEqual(w.signal_ids,['s2'],'funding outweighs hiring here');
 assert.equal(w.sentence,'j’ai vu cette actualité récente vous concernant : « Kerlan lève 3 M€ » (news.example, 4 octobre 2026).');
 const en=whyNow([s()],P,NOW,'en')!;
 assert.equal(en.sentence,'I saw this recent news about you: “Kerlan recrute un responsable de la sécurité des systèmes d’information en CDI” (jobs.example, 2 October 2026).');
});

test('never quoted: a signal to review, a rejected one, one too old, one of an untracked type; no date of its own → no date shown',()=>{
 assert.equal(whyNow([s({status:'PENDING_REVIEW'})],P,NOW),null);
 assert.equal(whyNow([s({status:'REJECTED'})],P,NOW),null);
 assert.equal(whyNow([s({published_at:day(200)})],P,NOW),null);
 assert.equal(whyNow([s({signal_type:'event'})],P,NOW),null);
 const undated=whyNow([s({published_at:null,observed_at:day(1)})],P,NOW)!;
 assert.doesNotMatch(undated.sentence,/\d{4}/,'the day ProspectOS read it is not presented as the date of the fact');
});

test('NO_GO guard: every word of the sentence outside the fixed template comes from the excerpt or the source domain',()=>{
 const cases=[s(),s({excerpt:'ACME nomme Claire Martin directrice des opérations à compter du 1er octobre.',signal_type:'leadership_change',source_domain:'acme.example'}),
  s({excerpt:'x'.repeat(400)+' fin',source_domain:null})];
 for(const c of cases){
  const w=whyNow([c],P,NOW)!;const quoted=w.sentence.match(/« (.*) »/)![1].replace(/…$/,'');
  assert.ok(c.excerpt.replace(/\s+/g,' ').startsWith(quoted),`quoted text is a prefix of the excerpt: ${quoted}`);
  const outside=w.sentence.replace(/« .* »/,'').replace(c.source_domain??'','').replace(/\d{1,2} \S+ \d{4}/,'');
  assert.equal(outside.replace(/[(), ]/g,''),'j’aivucetteactualitérécentevousconcernant:.','nothing but the fixed template');
 }
});

test('placed after the greeting of the factual template; the rest of the message is unchanged',()=>{
 const base=generateOutreach('Kerlan','Nous auditons la sécurité des PME.',DEFAULT_CRITERIA,[],NOW,'fr');
 const w=whyNow([s()],P,NOW)!;
 const text=withWhyNow(base.text,'Kerlan',w,'fr');
 assert.ok(text.startsWith('Bonjour l’équipe Kerlan, j’ai vu cette actualité récente vous concernant : « Kerlan recrute'));
 assert.ok(text.endsWith(base.text.slice('Bonjour l’équipe Kerlan, '.length).replace(/^j/,'J')));
 assert.equal(withWhyNow(base.text,'Kerlan',null,'fr'),base.text,'no signal: the template is exactly the same');
 assert.equal(withWhyNow('Texte libre','Kerlan',w,'fr'),'Texte libre','an unexpected template is never altered');
 const en=generateOutreach('Kerlan','',DEFAULT_CRITERIA,[],NOW,'en');
 assert.match(withWhyNow(en.text,'Kerlan',whyNow([s()],P,NOW,'en'),'en'),/^Hello Kerlan team, I saw this recent news about you: “Kerlan recrute/);
});

test('purity and wiring: no model; the outreach route adds why-now, stores signal_ids; core.ts untouched',async()=>{
 const src=await readFile(new URL('../src/domain/why-now.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/fetch\(|anthropic|openai|Math\.random|Date\.now\(\)/);
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 // O2: the route reads the verified signals and the intent profile, the composer (src/outreach/compose.ts) picks the angle
 // and adds why-now when the angle is a signal; the row stores the signal ids it quoted.
 assert.match(route,/signals=await verifiedSignalsOf\(db,p\.id\);intentProfile=await intentProfileOf\(db,p\.project_id\)/);
 assert.match(route,/signal_ids:composed\.signal_ids,evidence_ids:composed\.evidence_ids/);
 const compose=await readFile(new URL('../src/outreach/compose.ts',import.meta.url),'utf8');
 assert.match(compose,/const why=whyNow\(input\.signals,input\.profile,input\.now,input\.locale\);if\(why\)\{text=withWhyNow\(text,input\.name,why,input\.locale\)/);
});
