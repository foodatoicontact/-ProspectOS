// Onboarding → ICP target parsing: what the target DOES, written after a relational verb ("travaillant avec",
// "spécialisées dans", "proposant", "qui font"…), is kept as a target_fit category in the user's own words — never a
// need signal, never a synonym, never a word the user did not write. The parsed ICP says what the user looks for; it
// is never evidence that a prospect matches. Natural-stone wording is a regression fixture only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTarget,buildTargetingProposal} from '../src/domain/onboarding.ts';

const OFFER='Nous proposons un service B2B aux professionnels.';
const targetFit=(target:string)=>buildTargetingProposal({offerText:OFFER,targetText:target}).criteria.find(c=>c.key==='target_fit');
const needFit=(target:string)=>buildTargetingProposal({offerText:OFFER,targetText:target}).criteria.find(c=>c.key==='need_fit');

test('A — a multi-word business expression after a relational verb is kept whole',()=>{
 assert.deepEqual(parseTarget('entreprises spécialisées dans l’isolation thermique').categories,['isolation thermique']);
 assert.deepEqual(parseTarget('entreprises de 10 à 50 salariés travaillant dans le secteur du bâtiment').categories,['bâtiment']);
});

test('B — other relational wordings: qui font, proposant, qui vendent, utilisant',()=>{
 assert.deepEqual(parseTarget('agences qui font du recrutement informatique').categories,['agence','recrutement informatique']);
 assert.deepEqual(parseTarget('restaurants proposant de la cuisine japonaise').categories,['restaurant','cuisine japonaise']);
 assert.deepEqual(parseTarget('entreprises utilisant un ERP, avec plus de 50 salariés').categories,['ERP']);
 for(const t of ['agences qui font du recrutement informatique','restaurants proposant de la cuisine japonaise'])assert.deepEqual(parseTarget(t).signals,[],`${t}: what the target does is never a need`);
});

test('C — several explicit concepts, coordinated, each kept; the place stays a location',()=>{
 const p=parseTarget('entreprises spécialisées en menuiserie ou en charpente à Toulouse');
 assert.deepEqual(p.categories,['menuiserie','charpente']);assert.deepEqual(p.locations,['Toulouse']);
 assert.deepEqual(parseTarget('PME qui vendent du vin et des spiritueux en Occitanie').categories,['vin','spiritueux']);
});

test('D — no invention: every category is the user’s own words; nothing absent from the text appears',()=>{
 for(const t of ['entreprises spécialisées dans l’isolation thermique','agences qui font du recrutement informatique','restaurants proposant de la cuisine japonaise',
  'entreprises travaillant avec la pierre naturelle','entreprises spécialisées en menuiserie ou en charpente à Toulouse']){
  const folded=t.toLowerCase();
  for(const c of parseTarget(t).categories)for(const w of c.toLowerCase().split(' '))assert.ok(folded.includes(w.replace(/s$/,'')),`${t}: « ${w} » comes from the text`);
 }
 const stone=parseTarget('entreprises travaillant avec la pierre naturelle').categories.join(' ').toLowerCase();
 for(const absent of ['marbre','granit','minéral','carrière'])assert.ok(!stone.includes(absent),`no synonym: ${absent}`);
 // A complement naming the clients is not what the target is.
 assert.deepEqual(parseTarget('artisans travaillant pour les collectivités').categories,['artisan']);
});

test('E — short targets and existing wordings are unchanged',()=>{
 assert.deepEqual(parseTarget('agences immobilières').categories,['agence']);
 assert.deepEqual(parseTarget('ETI industrielles ou agroalimentaires').categories,['industriel','agroalimentaire']);
 assert.deepEqual(parseTarget('Exploitants agricoles en Bretagne').categories,['exploitant'],'a noun ending like a participle is not a relation');
 const r=parseTarget('Restaurants indépendants en Occitanie, avec commande à emporter.');
 assert.deepEqual([r.categories,r.signals],[['restaurant'],['commande à emporter']]);
 assert.deepEqual(parseTarget('sociétés qui sont spécialisées dans la cybersécurité, qui recrutent un RSSI').signals,['recrutent un RSSI'],'an event stays a signal');
});

test('F — vague or generic wording produces no precise concept',()=>{
 for(const t of ['entreprises qui pourraient avoir besoin de nous','entreprises travaillant avec nous','entreprises proposant des services','sociétés faisant des choses']){
  assert.deepEqual(parseTarget(t).categories,[],t);
 }
});

test('G — regression fixture: "entreprises travaillant avec la pierre naturelle" keeps "pierre naturelle" for target_fit, not for need_fit',()=>{
 const p=parseTarget('entreprises travaillant avec la pierre naturelle');
 assert.notDeepEqual(p.categories,['travaillant']);
 assert.deepEqual(p.categories,['pierre naturelle']);
 assert.deepEqual(p.signals,[],'never a need');
 assert.deepEqual(targetFit('entreprises travaillant avec la pierre naturelle')?.rules,{type:'target_fit',config:{match:'any_defined',categories:['pierre naturelle']}});
 assert.equal(needFit('entreprises travaillant avec la pierre naturelle')?.rules,undefined,'no need rule built from the target');
 assert.deepEqual(parseTarget('entreprises travaillant avec la pierre naturelle en Auvergne-Rhône-Alpes').locations,['Auvergne-Rhône-Alpes']);
});

test('the parsed ICP is a definition, not evidence: no criterion carries a value, a source or a status',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:'entreprises travaillant avec la pierre naturelle'});
 for(const c of p.criteria)for(const k of ['value','status','source_url','excerpt','evidence'])assert.ok(!(k in c),`${c.key}.${k}`);
});

test('H — not too permissive: counterparts, clients, idioms, adverbs, negations, possessives and places are never categories',()=>{
 const cats=(t:string)=>parseTarget(t).categories;
 assert.deepEqual(cats('sociétés travaillant avec des collectivités'),[],'"avec des …" names counterparts; the verb is no category either');
 assert.deepEqual(cats('entreprises qui vendent des logiciels aux restaurants'),['logiciels'],'the clients are cut from the concept');
 for(const t of ['entreprises qui font face à des difficultés de recrutement','PME qui utilisent encore Excel','entreprises qui travaillent beaucoup à l’export',
  'entreprises qui ne proposent pas de site web','PME qui transforment leur organisation','entreprises opérant en Occitanie','entreprises réalisant plus de 10 M€ de chiffre d’affaires'])assert.deepEqual(cats(t),[],t);
 assert.deepEqual(parseTarget('entreprises opérant en Occitanie').locations,['Occitanie']);
 assert.deepEqual(cats('cabinets spécialisés en cybersécurité'),['cabinet','cybersécurité']);
});
