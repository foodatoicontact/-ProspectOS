// Public simulator V1 — the view of each fictional prospect: computed ONLY with the product's existing pure rules, at the
// scenario's fixed reference date. FIT = fitDisplay(estimateFit) unchanged; "why now" and the reason card = heroView /
// reasonView over scoreIntent unchanged; proofs split by their own status (verified vs to confirm), nothing upgraded.
// No opportunity score, no confidence gauge, no probability of purchase, no composite score.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulate,simulateScenario} from '../src/simulator/view.ts';
import {SCENARIOS,getScenario} from '../src/simulator/scenarios/index.ts';
import {estimateFit} from '../src/domain/fit-estimate.ts';
import {fitDisplay} from '../src/domain/score-display.ts';
import {scoreProspect} from '../src/domain/core.ts';
import {scoreIntent} from '../src/domain/intent.ts';
import {heroView,reasonView} from '../src/ux/cockpit-view.ts';

test('FIT, coverage, why now and reason come from the existing rules, at the scenario reference date',()=>{
 for(const s of SCENARIOS){
  const now=new Date(s.reference_date),v=simulate(s.id);
  assert.equal(v.scenario_id,s.id);assert.equal(v.label,s.label);
  v.prospects.forEach((p,i)=>{
   const src=s.prospects[i];
   assert.equal(p.id,src.id);assert.equal(p.fictional,true);assert.equal(p.domain,src.domain);
   assert.deepEqual(p.fit,fitDisplay(estimateFit(s.criteria,src.evidence,now)));
   assert.equal(p.coverage,scoreProspect(s.criteria,src.evidence,now).coverage);
   const intent=scoreIntent(src.signals,null,now);
   assert.deepEqual(p.hero,heroView(intent));assert.deepEqual(p.reason,reasonView(intent));
  });
 }
});
test('proofs — verified and to-confirm kept apart, every non-rejected item shown exactly once, never upgraded',()=>{
 for(const s of SCENARIOS)simulate(s.id).prospects.forEach((p,i)=>{
  const src=s.prospects[i];
  assert.ok(p.verified.every(x=>x.status==='verified'),p.id);
  assert.ok(p.to_confirm.every(x=>x.status!=='verified'),p.id);
  const shown=[...p.verified,...p.to_confirm].map(x=>`${x.kind}:${x.id}`).sort();
  const expected=[...src.evidence.filter(e=>e.value).map(e=>`evidence:${e.id}`),...src.signals.map(g=>`signal:${g.id}`),...src.public_content.map(c=>`content:${c.id}`)].sort();
  assert.deepEqual(shown,expected,p.id);
  for(const e of src.evidence)assert.equal(p.verified.some(x=>x.id===e.id),e.status==='VERIFIED',e.id);
  for(const g of src.signals)assert.equal(p.verified.some(x=>x.id===g.id),g.status==='VERIFIED',g.id);
 });
});
test('undocumented criteria are listed as such (no proof at all), from the existing FIT breakdown',()=>{
 const v=simulate('restauration').prospects.find(p=>p.id==='resto-traiteur')!;
 assert.deepEqual(v.undocumented,['Vente à emporter ou retrait','Commandes par téléphone']);
});
test('the angle is the stored one, resolved for display',()=>{
 const p=simulate('restauration').prospects[0];
 assert.deepEqual(p.angle,{type:'signal',label:'Ouverture d’un second point de vente annoncée',source_host:'comptoir-exemple.example'});
 assert.deepEqual(simulate('restauration').prospects[2].angle,{type:'generic',label:'',source_host:null});
});
test('at most 3 prospects, whatever the fixture holds; deterministic',()=>{
 const s=getScenario('btp')!;
 const big={...s,prospects:[...s.prospects,...s.prospects.map(p=>({...p,id:`${p.id}-x`}))]};
 assert.equal(simulateScenario(big).prospects.length,3);
 assert.deepEqual(simulate('btp'),simulate('btp'));
});
test('no invented metric: no opportunity, confidence, probability or composite score in what is shown',()=>{
 const shown=JSON.stringify(SCENARIOS.map(s=>simulate(s.id)));
 assert.doesNotMatch(shown,/opportunit|confidence|probab|likelihood|chance|composite|priority/i);
 const src=readFileSync(new URL('../src/simulator/view.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/Date\.now|new Date\(\)|Math\.random|fetch\(|selectAngle\(/,'no clock, no randomness, no network, no angle selection');
});
