// TDD coverage for user-authored ICP rules (target_fit / need_fit): validation (Zod), the shared
// deterministic literal-matching primitive, and the two new strategy modules. Evidence-first
// invariants (never VERIFIED automatically, never value:false from absence) are re-verified here at
// the JS level; the full PGlite/SQL confirm-and-score lifecycle lives in tests/discovery-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryInputSchema,CriterionContextSchema} from '../src/discovery/types.ts';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {findLiteralMatch} from '../src/discovery/strategies/text-match.ts';
import {evaluateTargetFit} from '../src/discovery/strategies/target-fit.ts';
import {matchNeedFitSignal} from '../src/discovery/strategies/need-fit.ts';
import type {Criterion,TargetFitRules} from '../src/domain/core.ts';

// --- Compatibility ---
test('a criterion without rules behaves exactly as before (target_fit/need_fit stay non-conclusive)',()=>{
 const criteria:Criterion[]=[{key:'target_fit',label:'Correspond à la cible définie',weight:50},{key:'need_fit',label:'Besoin correspondant à l’offre',weight:50}];
 const html='<title>x</title><main><p>Restaurant reconnu à Toulouse, fort volume de réservations.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>['target_fit','need_fit'].includes(x.criterion??'')&&x.status==='OBSERVED'));
});
test('CriterionContextSchema accepts a criterion with valid target_fit rules',()=>{
 const criterion={key:'target_fit',label:'Correspond à la cible définie',weight:25,rules:{type:'target_fit',config:{categories:['restaurant','pizzeria'],match:'any_defined'}}};
 const parsed=CriterionContextSchema.parse(criterion);
 assert.deepEqual(parsed.rules,{type:'target_fit',config:{categories:['restaurant','pizzeria'],match:'any_defined'}});
});
test('CriterionContextSchema accepts a criterion with valid need_fit rules',()=>{
 const criterion={key:'need_fit',label:'Besoin correspondant à l’offre',weight:30,rules:{type:'need_fit',config:{signals:['fort volume de demandes']}}};
 const parsed=CriterionContextSchema.parse(criterion);
 assert.deepEqual(parsed.rules,{type:'need_fit',config:{signals:['fort volume de demandes']}});
});
test('a criterion carrying rules passes through the full DiscoveryInputSchema unchanged',()=>{
 const criteria=[{key:'target_fit',label:'Correspond à la cible définie',weight:25,rules:{type:'target_fit',config:{categories:['restaurant'],match:'any_defined'}}}];
 const input=DiscoveryInputSchema.parse({project_id:'p',query:'PME services',location:'Toulouse',categories:[],max_results:5,optional_filters:{criteria}});
 assert.equal(input.optional_filters.criteria?.[0].rules?.type,'target_fit');
});
test('rules values are trimmed and exact-duplicate values are deduplicated',()=>{
 const criterion={key:'need_fit',label:'Besoin',weight:30,rules:{type:'need_fit',config:{signals:['  Forte volumétrie  ','Forte volumétrie','Autre signal']}}};
 const parsed=CriterionContextSchema.parse(criterion);
 assert.equal(parsed.rules?.type,'need_fit');
 assert.deepEqual(parsed.rules?.type==='need_fit'?parsed.rules.config.signals:null,['Forte volumétrie','Autre signal']);
});

// --- Validation rejects invalid payloads (rules invalide rejeté) ---
test('a TargetFitRules payload with no dimension defined is rejected',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'target_fit',label:'x',weight:25,rules:{type:'target_fit',config:{match:'any_defined'}}}));
});
test('NeedFitRules requires at least one signal',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'need_fit',label:'x',weight:30,rules:{type:'need_fit',config:{signals:[]}}}));
});
test('an unknown match mode is rejected',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'target_fit',label:'x',weight:25,rules:{type:'target_fit',config:{categories:['a'],match:'sometimes'}}}));
});
test('a rule value shorter than 2 characters is rejected',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'need_fit',label:'x',weight:30,rules:{type:'need_fit',config:{signals:['a']}}}));
});
test('more than 20 values in a list is rejected',()=>{
 const many=Array.from({length:21},(_,i)=>`signal ${i}`);
 assert.throws(()=>CriterionContextSchema.parse({key:'need_fit',label:'x',weight:30,rules:{type:'need_fit',config:{signals:many}}}));
});
test('an unknown field on rules.config is rejected — no silent passthrough',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'need_fit',label:'x',weight:30,rules:{type:'need_fit',config:{signals:['x'],extra:'nope'}}}));
});
test('a criterion still rejects a truly unknown top-level field',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'need_fit',label:'x',weight:30,foo:'bar'}));
});
test('an unknown rules.type is rejected',()=>{
 assert.throws(()=>CriterionContextSchema.parse({key:'need_fit',label:'x',weight:30,rules:{type:'commercial_signal',config:{}}}));
});

// --- Shared literal-matching primitive ---
test('findLiteralMatch: whole word/phrase only, never a fragment of a longer word',()=>{
 assert.ok(findLiteralMatch(['Notre bar est ouvert.'],'bar'));
 assert.equal(findLiteralMatch(['Notre barbecue est ouvert.'],'bar'),null);
 assert.equal(findLiteralMatch(['Notre association locale.'],'on'),null);
 assert.ok(findLiteralMatch(['Ouvert le week-end, on vous accueille.'],'on'));
});
test('findLiteralMatch: case-insensitive and accent/whitespace normalized, never fuzzy',()=>{
 assert.ok(findLiteralMatch(['NOTRE  ÉQUIPE   est   disponible.'],'équipe'));
 assert.ok(findLiteralMatch(['notre equipe est disponible.'],'Équipe'));
 assert.equal(findLiteralMatch(['Nous recevons un volume important de sollicitations.'],'fort volume de demandes'),null,'no approximate/paraphrased match');
});
test('findLiteralMatch: a longer phrase matches as a whole, and a short needle matches inside it',()=>{
 assert.ok(findLiteralMatch(['PME de services reconnue à Toulouse.'],'PME de services'));
 assert.ok(findLiteralMatch(['PME de services reconnue à Toulouse.'],'PME'));
});

// --- TARGET_FIT strategy ---
const targetFitCriterion=(config:TargetFitRules):Criterion=>({key:'target_fit',label:'Correspond à la cible définie',weight:25,rules:{type:'target_fit',config}});
test('target_fit all_defined: a matching category alone is not enough when a location is also required',()=>{
 const criteria=[targetFitCriterion({categories:['restaurant'],locations:['Bordeaux'],match:'all_defined'})];
 const html='<title>x</title><main><p>Nous sommes un restaurant reconnu.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='target_fit'&&x.status==='OBSERVED'&&x.value===true));
});
test('target_fit all_defined: category and location both matching produce a proposal',()=>{
 const criteria=[targetFitCriterion({categories:['restaurant'],locations:['Toulouse'],match:'all_defined'})];
 const html='<title>x</title><main><p>Restaurant situé à Toulouse.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 const match=o.find(x=>x.criterion==='target_fit');
 assert.ok(match);assert.equal(match!.status,'OBSERVED');assert.equal(match!.value,true);
});
test('target_fit any_defined: a single matching dimension is enough',()=>{
 const criteria=[targetFitCriterion({categories:['restaurant'],locations:['Bordeaux'],match:'any_defined'})];
 const html='<title>x</title><main><p>Restaurant reconnu, situé à Toulouse.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 const match=o.find(x=>x.criterion==='target_fit');
 assert.ok(match);assert.equal(match!.value,true);
});
test('target_fit: absence of any match never produces a positive proposal, and never value=false',()=>{
 const criteria=[targetFitCriterion({categories:['pizzeria'],match:'any_defined'})];
 const html='<title>x</title><main><p>Nous sommes une agence de conseil.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='target_fit'&&x.value===true));
 assert.ok(!o.some(x=>x.criterion==='target_fit'&&x.value===false));
});
test('"bar" does not match inside "barbecue" for target_fit',()=>{
 const criteria=[targetFitCriterion({categories:['bar'],match:'any_defined'})];
 const html='<title>x</title><main><p>Notre restaurant propose un barbecue chaque week-end.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='target_fit'&&x.value===true));
});
test('"bar" matches when it appears as a genuine whole word',()=>{
 const criteria=[targetFitCriterion({categories:['bar'],match:'any_defined'})];
 const html='<title>x</title><main><p>Notre bar est ouvert tous les soirs.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 const match=o.find(x=>x.criterion==='target_fit');
 assert.ok(match);assert.equal(match!.value,true);
});
test('a criterion with valid target_fit rules but an unrecognized key gets no deterministic mapping',()=>{
 const criteria:Criterion[]=[{key:'custom_fit_key',label:'x',weight:100,rules:{type:'target_fit',config:{categories:['restaurant'],match:'any_defined'}}}];
 const html='<title>x</title><main><p>Nous sommes un restaurant reconnu.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='custom_fit_key'&&x.status==='OBSERVED'&&x.value===true));
});
test('a criterion whose label vaguely resembles "target"/"cible" without recognized key+rules gets no mapping',()=>{
 const criteria:Criterion[]=[{key:'cible_marketing',label:'Cible marketing prioritaire',weight:100}];
 const html='<title>x</title><main><p>Notre cible marketing est prioritaire cette année.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='cible_marketing'&&x.status==='OBSERVED'&&x.value===true));
});

// --- NEED_FIT strategy ---
const needFitCriterion=(signals:string[]):Criterion=>({key:'need_fit',label:'Besoin correspondant à l’offre',weight:30,rules:{type:'need_fit',config:{signals}}});
test('need_fit: an exact user-defined signal produces a proposal explaining what matched',()=>{
 const criteria=[needFitCriterion(['prise de rendez-vous en ligne'])];
 const html='<title>x</title><main><p>Nous proposons la prise de rendez-vous en ligne pour nos clients.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 const match=o.find(x=>x.criterion==='need_fit');
 assert.ok(match);assert.equal(match!.status,'OBSERVED');assert.equal(match!.value,true);
 assert.match(match!.claim,/prise de rendez-vous en ligne/);
});
test('need_fit: signal absent from the page never produces evidence',()=>{
 const criteria=[needFitCriterion(['fort volume de demandes'])];
 const html='<title>x</title><main><p>Nous accompagnons les PME dans leur transformation numérique.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='need_fit'&&x.value===true));
});
test('need_fit: a bare word from the label ("besoin") is never enough',()=>{
 const criteria=[needFitCriterion(['fort volume de demandes'])];
 const html='<title>x</title><main><p>Nous avons un besoin urgent de personnel.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='need_fit'&&x.status==='OBSERVED'&&x.value===true));
});
test('need_fit: a phone number never grants need_fit',()=>{
 const criteria=[needFitCriterion(['fort volume de demandes']),{key:'contactability',label:'Canal de contact',weight:70}];
 const html='<title>x</title><main><p>Contactez-nous au 05 00 00 00 09.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='need_fit'&&x.value===true));
});
test('need_fit: a commercial_signal event never grants need_fit (each stays on its own criterion)',()=>{
 const criteria=[needFitCriterion(['fort volume de demandes']),{key:'commercial_signal',label:'Signal commercial observable',weight:70}];
 const html='<title>x</title><main><p>Nous recrutons actuellement plusieurs commerciaux.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='need_fit'&&x.value===true));
 assert.ok(o.some(x=>x.criterion==='commercial_signal'&&x.value===true));
});
test('need_fit: no approximate/fuzzy similarity — a near-miss paraphrase does not match',()=>{
 const criteria=[needFitCriterion(['fort volume de demandes'])];
 const html='<title>x</title><main><p>Nous recevons un volume important de sollicitations.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='need_fit'&&x.value===true));
});
test('need_fit: GENERIC_KEYWORD_MATCH never becomes an evidence proposal, even alongside a configured rule',()=>{
 const criteria=[needFitCriterion(['fort volume de demandes']),{key:'target_fit',label:'Correspond à la cible définie',weight:70}];
 const html='<title>x</title><main><p>Correspond à notre cible idéale.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 assert.equal(new EvidenceProposalService().propose(o,criteria).some(e=>e.criterion==='target_fit'),false);
});

// --- M1 fix: rules read from icps.criteria are never trusted at their declared TypeScript type.
// icps.criteria is a schema-less jsonb column writable outside this application's own Zod validation
// (e.g. directly via PostgREST) — a malformed `rules` object must be treated as "no exploitable
// rule": never a throw, never a positive or negative proposal, never an evidence, never repaired or
// partially interpreted. An invalid `match` in particular must fail closed, never fall back to
// any_defined (see evaluateTargetFit's isValidTargetFitConfig).
test('evaluateTargetFit: malformed configs never throw and always resolve to not-satisfied',()=>{
 const lines=['Restaurant reconnu à Toulouse.'];
 const malformedConfigs:unknown[]=[
  undefined,
  null,
  {},
  {match:'invalid'},
  {categories:'PME',match:'any_defined'},
  {locations:null,match:'any_defined'},
  {categories:['restaurant'],match:'invalid'},
  {categories:[123],match:'any_defined'},
  'not-an-object',
  42,
  ['array','not','object'],
 ];
 for(const config of malformedConfigs){
  const result=evaluateTargetFit({lines},config);
  assert.equal(result.satisfied,false,`config ${JSON.stringify(config)} must never satisfy`);
  assert.deepEqual(result.matches,[]);
 }
});
test('evaluateTargetFit: an invalid match value fails closed, never falls back to any_defined',()=>{
 // "restaurant" genuinely matches the text below — if an invalid match value silently behaved like
 // any_defined, this would incorrectly satisfy. It must not.
 const result=evaluateTargetFit({lines:['Restaurant reconnu à Toulouse.']},{categories:['restaurant'],match:'sometimes'});
 assert.equal(result.satisfied,false);
});
test('matchNeedFitSignal: malformed signals never throw and never match',()=>{
 const lines=['Nous avons un fort volume de réservations.'];
 const malformedSignals:unknown[]=[undefined,null,'foo',[123],{signals:['x']},42,[null],['fort volume de réservations',123]];
 for(const signals of malformedSignals){
  assert.equal(matchNeedFitSignal({lines},signals),null,`signals ${JSON.stringify(signals)} must never match`);
 }
});

// End-to-end through the real ObservationService: 10 malformed rules scenarios, each proven to never
// throw, never produce a positive or negative value, and never become an evidence proposal.
const MALFORMED_HTML='<title>x</title><main><p>Restaurant reconnu à Toulouse, PME locale, fort volume de réservations.</p></main>';
function malformed(key:string,rules:unknown):Criterion{return {key,label:'x',weight:100,rules} as Criterion}
const MALFORMED_CASES:[string,Criterion][]=[
 ['need_fit config={}',malformed('need_fit',{type:'need_fit',config:{}})],
 ['need_fit signals=null',malformed('need_fit',{type:'need_fit',config:{signals:null}})],
 ['need_fit signals="foo"',malformed('need_fit',{type:'need_fit',config:{signals:'foo'}})],
 ['need_fit signals=[123]',malformed('need_fit',{type:'need_fit',config:{signals:[123]}})],
 ['target_fit rules sans config',malformed('target_fit',{type:'target_fit'})],
 ['target_fit categories="PME"',malformed('target_fit',{type:'target_fit',config:{categories:'PME',match:'any_defined'}})],
 ['target_fit locations=null',malformed('target_fit',{type:'target_fit',config:{locations:null,match:'any_defined'}})],
 ['target_fit match="invalid"',malformed('target_fit',{type:'target_fit',config:{categories:['restaurant'],match:'invalid'}})],
 ['target_fit config={}',malformed('target_fit',{type:'target_fit',config:{}})],
 ['objet rules totalement incohérent',malformed('target_fit',{foo:'bar',random:[1,2,3]})],
];
for(const [label,criterion] of MALFORMED_CASES){
 test(`malformed rules never throws, never proposes, never creates evidence — ${label}`,()=>{
  const observations=new ObservationService().extract(MALFORMED_HTML,'https://vendor.example',[criterion]);
  const rows=observations.filter(o=>o.criterion===criterion.key);
  assert.ok(rows.every(o=>o.status!=='OBSERVED'),'never resolves to OBSERVED from a malformed rule');
  assert.ok(!rows.some(o=>o.value===true),'never value=true');
  assert.ok(!rows.some(o=>o.value===false),'never value=false');
  assert.equal(new EvidenceProposalService().propose(observations,[criterion]).length,0,'never becomes an evidence proposal');
 });
}
