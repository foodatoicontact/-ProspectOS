// Public simulator V1 — the demonstration data. Fictional companies only (reserved .example domains, RFC 2606): no real
// business ever receives a simulated signal, proof or content. No phone, email or person. At most 3 prospects per
// scenario. Statuses are the product's own; every scenario shows both a verified item and an item still to confirm.
// The recommended angle is STORED (no angle is selected in the browser) and must equal what the real O2 selector picks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENARIOS,getScenario} from '../src/simulator/scenarios/index.ts';
import {SCENARIO_IDS,SIM_MAX_PROSPECTS,REGIONS} from '../src/simulator/types.ts';
import {resolveAngle,verifiedEvidenceIds} from '../src/simulator/view.ts';
import {validateCriteria} from '../src/domain/core.ts';
import {scoreIntent} from '../src/domain/intent.ts';
import {estimateFit} from '../src/domain/fit-estimate.ts';
import {fitDisplay} from '../src/domain/score-display.ts';
import {selectAngle} from '../src/outreach/angle.ts';
import {SIGNAL_TYPES} from '../src/signals/types.ts';
import {DEMO_PROSPECTS} from '../src/domain/demo.ts';

const DAY=86_400_000;
const urlsOf=(p:typeof SCENARIOS[number]['prospects'][number])=>[...p.evidence.map(e=>e.source_url),...p.signals.map(s=>s.source_url),...p.public_content.map(c=>c.source_url)];
const textOf=(v:unknown)=>JSON.stringify(v);

test('scenarios — the closed list, unique ids, a generic fallback, a fixed reference date',()=>{
 assert.deepEqual(SCENARIOS.map(s=>s.id),[...SCENARIO_IDS]);
 assert.ok(SCENARIO_IDS.includes('generique'));
 for(const s of SCENARIOS){
  assert.equal(getScenario(s.id),s);
  assert.equal(s.version,1);
  assert.match(s.reference_date,/^\d{4}-\d{2}-\d{2}T12:00:00Z$/);
  assert.doesNotThrow(()=>validateCriteria(s.criteria),`${s.id} criteria follow the existing ICP rules`);
 }
 assert.equal(getScenario('nope' as never),undefined);
 assert.ok(REGIONS.length>=14&&REGIONS.some(r=>r.code==='fr'));
});
test('at most 3 prospects per scenario, unique ids everywhere',()=>{
 const ids=SCENARIOS.flatMap(s=>s.prospects.map(p=>p.id));
 assert.equal(new Set(ids).size,ids.length);
 for(const s of SCENARIOS)assert.ok(s.prospects.length>=1&&s.prospects.length<=SIM_MAX_PROSPECTS,s.id);
 assert.equal(SIM_MAX_PROSPECTS,3);
});
test('fictional only — .example domains, no real company, no phone, no email, no person',()=>{
 const real=new Set(DEMO_PROSPECTS.map(p=>p.name.toLowerCase()));
 for(const s of SCENARIOS)for(const p of s.prospects){
  assert.equal(p.fictional,true);
  assert.match(p.domain,/^[a-z0-9-]+\.example$/,p.id);
  assert.ok(!real.has(p.name.toLowerCase()),p.name);
  for(const u of urlsOf(p)){const h=new URL(u).hostname;assert.ok(h===p.domain||h.endsWith('.example'),`${p.id} ${u}`);assert.equal(new URL(u).protocol,'https:')}
  const t=textOf(p);
  assert.doesNotMatch(t,/@|\b0\d(?:[ .]?\d{2}){4}\b|\+33/,`${p.id} has no email or phone`);
 }
});
test('statuses are the product ones; a verified proof says who verified it; dates are before the reference date',()=>{
 for(const s of SCENARIOS){
  const ref=Date.parse(s.reference_date);
  for(const p of s.prospects){
   for(const e of p.evidence){
    assert.ok(['VERIFIED','NOT_VERIFIED','INFERRED_UNCONFIRMED'].includes(e.status),e.id);
    assert.equal(!!e.verified_by,e.status==='VERIFIED',e.id);
    const age=ref-Date.parse(e.observed_at);assert.ok(age>=0&&age<=90*DAY,`${e.id} within the 90-day window`);
    assert.ok(s.criteria.some(c=>c.key===e.criterion),e.id);
   }
   for(const g of p.signals){
    assert.ok(['VERIFIED','PENDING_REVIEW'].includes(g.status),g.id);
    assert.ok((SIGNAL_TYPES as readonly string[]).includes(g.signal_type),g.id);
    assert.ok(g.confidence>0&&g.confidence<=1,g.id);
    assert.ok(Date.parse(g.observed_at)<=ref&&(!g.event_date||Date.parse(`${g.event_date}T00:00:00Z`)<=ref),g.id);
   }
   for(const c of p.public_content)assert.ok(['VERIFIED','PENDING_REVIEW'].includes(c.status),c.id);
  }
 }
});
test('every targeted scenario shows a verified item AND an item to confirm (the distinction is always visible)',()=>{
 for(const s of SCENARIOS){
  const all=s.prospects.flatMap(p=>[...p.evidence.map(e=>e.status),...p.signals.map(g=>g.status)]);
  assert.ok(all.includes('VERIFIED'),s.id);
  assert.ok(all.some(x=>x!=='VERIFIED'),s.id);
 }
});
test('the stored angle is exactly what the real O2 selector picks (no selection in the browser)',()=>{
 for(const s of SCENARIOS){
  const now=new Date(s.reference_date);
  for(const p of s.prospects){
   const real=selectAngle({publicContent:p.public_content,signals:p.signals,profile:null,evidence:p.evidence,evidenceIds:verifiedEvidenceIds(p),now});
   assert.deepEqual(p.angle_ref,{type:real.type,source_id:real.source_id},p.id);
   const shown=resolveAngle(p);
   assert.equal(shown.type,real.type,p.id);assert.equal(shown.label,real.label,p.id);
  }
 }
});
test('order — accounts with a verified reason to act now first, then by the existing FIT (no new score)',()=>{
 for(const s of SCENARIOS){
  const now=new Date(s.reference_date);
  const rows=s.prospects.map(p=>({now:scoreIntent(p.signals,null,now).lines.some(l=>l.verified&&l.points>0),fit:fitDisplay(estimateFit(s.criteria,p.evidence,now)).main??-1}));
  for(let i=1;i<rows.length;i++){
   const a=rows[i-1],b=rows[i];
   assert.ok(Number(a.now)>Number(b.now)||(a.now===b.now&&a.fit>=b.fit),`${s.id} #${i}`);
  }
 }
});
