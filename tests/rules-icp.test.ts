// TDD coverage for user-authored ICP rules (target_fit / need_fit): validation (Zod), the shared
// deterministic literal-matching primitive, and the two new strategy modules. Evidence-first
// invariants (never VERIFIED automatically, never value:false from absence) are re-verified here at
// the JS level; the full PGlite/SQL confirm-and-score lifecycle lives in tests/discovery-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryInputSchema,CriterionContextSchema} from '../src/discovery/types.ts';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {findLiteralMatch} from '../src/discovery/strategies/text-match.ts';
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
