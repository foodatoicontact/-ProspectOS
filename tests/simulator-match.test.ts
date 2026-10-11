// Public simulator V1 — choosing the demonstration scenario from what the visitor typed. Deterministic and explainable:
// accent- and case-insensitive word-start matching against a fixed dictionary, target terms count twice, a minimum score,
// ties broken by the fixed scenario order. No LLM, no network. The explanation only ever lists DICTIONARY labels, never
// the visitor's own words. Below the threshold: the generic example, flagged as such.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeWords,matchScenario,SIM_MATCH_MIN_SCORE,SIM_INPUT_LIMITS} from '../src/simulator/match.ts';

test('normalization — lower case, no accents, words only',()=>{
 assert.deepEqual(normalizeWords('Brasserie, Cafés & BOULANGERIES — Région Île-de-France'),['brasserie','cafes','boulangeries','region','ile','de','france']);
 assert.deepEqual(normalizeWords('   '),[]);
});
test('table — the expected scenario, the matched dictionary labels, no fallback',()=>{
 const rows:[string,string,string,string[]][]=[
  ['Un logiciel de caisse et de commande en ligne','Restaurants et boulangeries','restauration',['restauration','boulangerie','commande','caisse']],
  ['Un CRM SaaS','Des PME et des startups','logiciel-pme',['PME','startup','SaaS','CRM']],
  ['De la location de matériel de chantier','Entreprises du BTP et artisans du bâtiment','btp',['BTP','bâtiment','artisans','matériel','location','chantier']],
  ['Un outil de signature et de gestion documentaire','Cabinets d’expertise comptable','cabinets',['cabinet','expert-comptable','comptabilité','signature','gestion','documents']],
  ['La maintenance prédictive de machines','Usines et PMI industrielles','industrie',['usine','PMI','industrie','maintenance','machines']],
 ];
 for(const [offer,target,id,labels] of rows){
  const m=matchScenario(offer,target);
  assert.equal(m.scenario_id,id,`${offer} / ${target}`);assert.equal(m.fallback,false);
  assert.deepEqual([...m.matched].sort(),[...labels].sort(),id);
 }
});
test('target terms weigh twice the offer terms; a tie keeps the fixed scenario order',()=>{
 // offer says software (logiciel-pme, 1 point), target says restaurants (restauration, 2 points)
 assert.equal(matchScenario('Un logiciel','Des restaurants').scenario_id,'restauration');
 // one target hit each: restauration comes first in the fixed order
 assert.equal(matchScenario('','restaurants et PME').scenario_id,'restauration');
});
test('fallback — nothing close enough: the generic example, clearly flagged, nothing matched',()=>{
 for(const [o,t] of [['',''],['Des chaussettes','Des particuliers'],['Un logiciel','']]){
  const m=matchScenario(o,t);
  assert.deepEqual(m,{scenario_id:'generique',fallback:true,matched:[],score:m.score},`${o}/${t}`);
  assert.ok(m.score<SIM_MATCH_MIN_SCORE);
 }
 assert.equal(SIM_MATCH_MIN_SCORE,2);
});
test('deterministic — the same input always gives the same result; input is capped, never echoed',()=>{
 const a=matchScenario('Logiciel de caisse','Restaurants'),b=matchScenario('Logiciel de caisse','Restaurants');
 assert.deepEqual(a,b);
 const secret='Ma société ZETA-SECRÈTE vend';
 const m=matchScenario(`${secret} des caisses`,'restaurants');
 assert.ok(!JSON.stringify(m).includes('ZETA'),'the result never carries the visitor’s words');
 assert.deepEqual(SIM_INPUT_LIMITS,{offer:500,target:200});
 assert.equal(matchScenario('','restaurant').scenario_id,'restauration');
 assert.equal(matchScenario('','x'.repeat(5000)+' restaurant').scenario_id,'generique','text past the limit is ignored');
});
test('no model, no network in the matching engine',()=>{
 const src=readFileSync(new URL('../src/simulator/match.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/fetch\(|anthropic|openai|Math\.random|Date\.now|import\(.*http/i);
});
