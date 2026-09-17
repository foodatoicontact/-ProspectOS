// TDD coverage for the generic, multi-sector Discovery engine (BLOC 3), including the
// red-team hardening pass: the generic keyword matcher must never conclude TRUE on its own,
// and the restaurant preset must only fire on genuinely vertical-specific ICP keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {FOODATOI_CRITERIA,DEFAULT_CRITERIA,scoreProspect,type Criterion} from '../src/domain/core.ts';
import {validateUrl} from '../src/discovery/safe-fetch.ts';

const RESTAURANT_HTML='<title>Restaurant Toulouse</title><main><p>Restaurant à Toulouse.</p><p>Commandez au 05 61 22 59 49.</p><p>Livraison Uber Eats et Deliveroo.</p><p>Commande par Instagram.</p><p>Click & collect et retrait sur place.</p><p>Livraison directe.</p></main>';
const SAAS_HTML='<title>Automatisation PME</title><main><p>Nous automatisons le traitement des demandes entrantes pour les PME.</p><p>Correspond à la cible définie : PME de services.</p><p>Contactez-nous par email à contact@example.com ou au 05 00 00 00 09.</p></main>';

const SAAS_CRITERIA:Criterion[]=[
 {key:'target_fit',label:'Correspond à la cible définie',weight:25},
 {key:'need_fit',label:'Besoin correspondant à l’offre',weight:30},
 {key:'commercial_signal',label:'Signal commercial observable',weight:25},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:20}
];

test('TEST 1 — a Foodatoi project keeps using its historical criteria correctly',()=>{
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',FOODATOI_CRITERIA);
 for(const k of ['food','region','phone_orders','platforms','social_orders'])assert.ok(o.some(x=>x.criterion===k&&x.status==='OBSERVED'&&x.value===true));
 assert.ok(o.some(x=>x.criterion==='weak_collect'&&x.value===false));
 assert.ok(o.some(x=>x.criterion==='internal_delivery'&&x.status==='INFERRED'));
});

test('TEST 1bis — a full Foodatoi ICP activates the restaurant preset',()=>{
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',FOODATOI_CRITERIA);
 assert.ok(o.some(x=>x.observation_type==='FOOD_ACTIVITY'));
 assert.ok(o.some(x=>x.observation_type==='DELIVERY_PLATFORM'));
});

test('TEST 2 — a project with generic SaaS criteria receives no restaurant/Foodatoi observation automatically',()=>{
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',SAAS_CRITERIA);
 assert.ok(!o.some(x=>['food','region','phone_orders','social_orders','platforms','weak_collect','audience','internal_delivery'].includes(x.criterion??'')));
 assert.ok(!o.some(x=>x.observation_type==='FOOD_ACTIVITY'||x.observation_type==='DELIVERY_PLATFORM'||x.observation_type==='CLICK_AND_COLLECT'));
});

test('TEST 3 — an unknown-at-compile-time criterion can receive a candidate observation, never a conclusive one, from its own ICP label',()=>{
 const criteria:Criterion[]=[{key:'custom_signal_x',label:'Mention API publique documentée',weight:100}];
 const html='<title>Produit</title><main><p>Notre API publique documentée est accessible à tous.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 const match=o.find(x=>x.criterion==='custom_signal_x');
 assert.ok(match);
 assert.equal(match!.status,'INFERRED');
 assert.equal(match!.value,null);
 // A non-conclusive candidate never becomes an evidence proposal on its own.
 assert.equal(new EvidenceProposalService().propose(o,criteria).length,0);
});

test('a keyword from the ICP label present on the page is not enough to propose TRUE',()=>{
 const criteria:Criterion[]=[{key:'need_fit',label:'Besoin correspondant à l’offre',weight:100}];
 const html='<title>Page</title><main><p>Nous avons un besoin urgent de personnel.</p></main>';
 const o=new ObservationService().extract(html,'https://vendor.example',criteria);
 const match=o.find(x=>x.criterion==='need_fit');
 assert.ok(match,'a candidate excerpt is still surfaced for human review');
 assert.notEqual(match!.status,'OBSERVED');
 assert.equal(match!.value,null);
 assert.equal(new EvidenceProposalService().propose(o,criteria).length,0);
});

test('TEST 4 — a proposal toward a key absent from the ICP is rejected',()=>{
 const observations=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',FOODATOI_CRITERIA);
 // Simulate a proposal that (incorrectly) targets a key foreign to the SaaS ICP.
 const foreign=[...observations,{...observations.find(x=>x.criterion==='food')!,criterion:'not_in_icp'}];
 const evidence=new EvidenceProposalService().propose(foreign as typeof observations,SAAS_CRITERIA);
 assert.ok(!evidence.some(e=>e.criterion==='not_in_icp'));
 assert.ok(!evidence.some(e=>e.criterion==='food'));
});

test('TEST 5 — absence of information never produces FALSE automatically',()=>{
 const o=new ObservationService().extract('<p>Bonjour</p>','https://resto.example',SAAS_CRITERIA);
 assert.ok(o.every(x=>x.status==='UNKNOWN'&&x.value===null));
 assert.equal(new EvidenceProposalService().propose(o,SAAS_CRITERIA).length,0);
});

test('TEST 6 — Discovery never directly creates a VERIFIED evidence proposal',()=>{
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',FOODATOI_CRITERIA);
 const evidence=new EvidenceProposalService().propose(o,FOODATOI_CRITERIA);
 assert.ok(evidence.length>0);
 assert.ok(evidence.every(e=>e.status!=='VERIFIED'));
});

test('TEST 7 — two projects with two different ICPs never contaminate their observations',()=>{
 const restaurantRun=new ObservationService().extract(RESTAURANT_HTML+SAAS_HTML,'https://mixed.example',FOODATOI_CRITERIA);
 const saasRun=new ObservationService().extract(RESTAURANT_HTML+SAAS_HTML,'https://mixed.example',SAAS_CRITERIA);
 assert.ok(!restaurantRun.some(o=>SAAS_CRITERIA.some(c=>c.key===o.criterion)));
 assert.ok(!saasRun.some(o=>FOODATOI_CRITERIA.some(c=>c.key===o.criterion)));
});

test('TEST 8 — no FOODATOI_CRITERIA fallback anywhere in the generic Discovery path',()=>{
 const o=new ObservationService().extract('<p>Bonjour</p>','https://vendor.example',DEFAULT_CRITERIA);
 const unknownKeys=o.filter(x=>x.status==='UNKNOWN').map(x=>x.criterion);
 assert.deepEqual(new Set(unknownKeys),new Set(DEFAULT_CRITERIA.map(c=>c.key)));
 assert.ok(!unknownKeys.some(k=>FOODATOI_CRITERIA.some(c=>c.key===k)));
});

test('TEST 9 — existing URL/SSRF protections remain operational',()=>{
 assert.throws(()=>validateUrl('http://localhost/'),/Localhost is forbidden/);
 assert.throws(()=>validateUrl('http://127.0.0.1/'),/non-public IP/i);
 assert.throws(()=>validateUrl('https://user:pass@example.com/'),/credentials are forbidden/);
 assert.throws(()=>validateUrl('https://linkedin.com/company/x'),/social network fetching is forbidden/);
 assert.doesNotThrow(()=>validateUrl('https://example.com/page'));
});

test('TEST 10 — unvalidated observations never change the score',()=>{
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',FOODATOI_CRITERIA);
 const evidence=new EvidenceProposalService().propose(o,FOODATOI_CRITERIA);
 assert.ok(evidence.length>0);
 assert.equal(scoreProspect(FOODATOI_CRITERIA,evidence).score,0);
});

// --- Restaurant preset activation: conservative trigger on vertical-specific keys only ---
test('an ICP containing only "region" does not activate the restaurant preset',()=>{
 const criteria:Criterion[]=[{key:'region',label:'Toulouse / Occitanie',weight:100}];
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',criteria);
 assert.ok(!o.some(x=>x.observation_type==='GEOGRAPHY'));
});

test('an ICP containing only "audience" does not activate the restaurant preset',()=>{
 const criteria:Criterion[]=[{key:'audience',label:'Forte audience sociale documentée',weight:100}];
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',criteria);
 assert.ok(!o.some(x=>x.criterion==='audience'&&x.status!=='UNKNOWN'&&x.observation_type!=='GENERIC_KEYWORD_MATCH'));
 assert.ok(!o.some(x=>x.observation_type==='FOOD_ACTIVITY'||x.observation_type==='DELIVERY_PLATFORM'));
});

test('an ICP containing only "platforms" does not activate the restaurant preset',()=>{
 const criteria:Criterion[]=[{key:'platforms',label:'Uber Eats / Deliveroo',weight:100}];
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',criteria);
 assert.ok(!o.some(x=>x.observation_type==='DELIVERY_PLATFORM'));
});

test('the full Foodatoi ICP activates the restaurant preset',()=>{
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',FOODATOI_CRITERIA);
 assert.ok(o.some(x=>x.observation_type==='FOOD_ACTIVITY'));
 assert.ok(o.some(x=>x.observation_type==='GEOGRAPHY'));
 assert.ok(o.some(x=>x.observation_type==='DELIVERY_PLATFORM'));
});

test('a single strong key (e.g. "food") alone is enough to activate the preset for that key',()=>{
 const criteria:Criterion[]=[{key:'food',label:'Activité alimentaire',weight:100}];
 const o=new ObservationService().extract(RESTAURANT_HTML,'https://resto.example',criteria);
 assert.ok(o.some(x=>x.observation_type==='FOOD_ACTIVITY'&&x.value===true));
});
