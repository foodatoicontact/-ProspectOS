// FIT estimé (2026-10-06, choix de Kevin) : le score est calculé automatiquement en croisant toutes les observations,
// pondérées par la fiabilité de leur source, et affiché « estimé » à côté du score vérifié (scoreProspect, inchangé).
// L'humain vérifie les sources : chaque vérification rapproche l'estimé du vérifié. Seules les preuves vérifiées sont
// citées comme faits dans un message (generateOutreach, inchangé).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {estimateFit,evidenceConfidence,type EstimateEvidence} from '../src/domain/fit-estimate.ts';
import {scoreProspect,type Criterion} from '../src/domain/core.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const ICP:Criterion[]=[{key:'target_fit',label:'Cible',weight:25},{key:'need_fit',label:'Besoin',weight:30},{key:'commercial_signal',label:'Signal',weight:25},{key:'contactability',label:'Contact',weight:20}];
let n=0;
const ev=(o:Partial<EstimateEvidence>={}):EstimateEvidence=>({id:`e${++n}`,criterion:'need_fit',value:true,status:'NOT_VERIFIED',source_url:'https://acme.example/services',excerpt:'Nous accompagnons 200 PME.',
 observed_at:'2026-10-01T10:00:00Z',verified_by:null,source_type:'official_website',...o});

test('confidence by source: official site 90 %, directory 80 %, search result 60 %, manual 70 %, inference 30 %, demo 50 %',()=>{
 assert.equal(evidenceConfidence(ev()),0.9);
 assert.equal(evidenceConfidence(ev({source_type:'public_directory'})),0.8);
 assert.equal(evidenceConfidence(ev({source_type:'search_result'})),0.6);
 assert.equal(evidenceConfidence(ev({source_type:null})),0.7,'typed by the user, no observation behind it');
 assert.equal(evidenceConfidence(ev({status:'INFERRED_UNCONFIRMED'})),0.3,'an inference stays weak whatever its page');
 assert.equal(evidenceConfidence(ev({source_type:'test_fixture'})),0.5);
 assert.equal(evidenceConfidence(ev({status:'VERIFIED',verified_by:'u'})),1,'verified by a person');
});

test('nothing verified yet: the estimate is computed at once, the verified score stays the unchanged scoreProspect',()=>{
 const list=[ev(),ev({criterion:'target_fit',source_type:'public_directory'})];
 const r=estimateFit(ICP,list,NOW);
 assert.deepEqual(r.verified,scoreProspect(ICP,list,NOW));
 assert.equal(r.verified.coverage,0);
 assert.equal(r.estimated.score,Math.round(30*0.9+25*0.8));
 assert.equal(r.to_verify.count,2);assert.equal(r.to_verify.points,r.estimated.score-r.verified.score);
 const need=r.estimated.breakdown.find(b=>b.key==='need_fit')!;
 assert.equal(need.state,'ESTIMATED');assert.equal(need.confidence,0.9);assert.equal(need.points,27);
});

test('verifying a source moves it to the verified score: full points, no longer "to verify"',()=>{
 const list=[ev({status:'VERIFIED',verified_by:'u'}),ev({criterion:'target_fit',source_type:'public_directory'})];
 const r=estimateFit(ICP,list,NOW);
 assert.equal(r.verified.score,30);
 const need=r.estimated.breakdown.find(b=>b.key==='need_fit')!;assert.equal(need.state,'VERIFIED');assert.equal(need.points,30);
 assert.equal(r.estimated.score,30+20);assert.equal(r.to_verify.count,1);
});

test('the best source wins inside a criterion; several sources never add up beyond its weight',()=>{
 const r=estimateFit(ICP,[ev({source_type:'search_result'}),ev(),ev({source_type:'public_directory'})],NOW);
 const need=r.estimated.breakdown.find(b=>b.key==='need_fit')!;
 assert.equal(need.confidence,0.9);assert.equal(need.points,27);assert.equal(need.evidence_ids.length,3);
});

test('contradiction between sources: the criterion is "to review", it adds nothing instead of averaging',()=>{
 const r=estimateFit(ICP,[ev(),ev({value:false,source_type:'search_result'})],NOW);
 const need=r.estimated.breakdown.find(b=>b.key==='need_fit')!;
 assert.equal(need.state,'TO_REVIEW');assert.equal(need.points,0);
});

test('a person decides: verified FALSE wins over any unverified TRUE; a contradicted observation is ignored',()=>{
 const r=estimateFit(ICP,[ev({status:'VERIFIED',verified_by:'u',value:false}),ev()],NOW);
 assert.equal(r.estimated.breakdown.find(b=>b.key==='need_fit')!.state,'FALSE');
 const c=estimateFit(ICP,[ev({status:'CONTRADICTED',verified_by:'u'})],NOW);
 assert.equal(c.estimated.breakdown.find(b=>b.key==='need_fit')!.state,'UNKNOWN');assert.equal(c.estimated.score,0);
});

test('unusable observations are never estimated: no source, no excerpt, older than 90 days, unknown criterion',()=>{
 const r=estimateFit(ICP,[ev({source_url:''}),ev({excerpt:'  '}),ev({observed_at:'2026-05-01T00:00:00Z'}),ev({criterion:'unknown'})],NOW);
 assert.equal(r.estimated.score,0);assert.equal(r.to_verify.count,0);
});

test('all criteria verified: estimated = verified, nothing left to verify; bounded to 100',()=>{
 const list=ICP.map(c=>ev({criterion:c.key,status:'VERIFIED',verified_by:'u'}));
 const r=estimateFit(ICP,list,NOW);
 assert.equal(r.verified.score,100);assert.equal(r.estimated.score,100);assert.equal(r.to_verify.count,0);assert.equal(r.to_verify.points,0);
});

test('guardrails: core.ts unchanged by this block, no model, outreach still quotes verified evidence only',async()=>{
 const src=await readFile(new URL('../src/domain/fit-estimate.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/fetch\(|anthropic|openai|Math\.random/i);
 assert.match(src,/scoreProspect\(criteria,evidence,now\)/,'the verified score is scoreProspect itself');
 const core=await readFile(new URL('../src/domain/core.ts',import.meta.url),'utf8');
 assert.match(core,/e\.status==='VERIFIED'&&e\.verified_by/,'scoreProspect still counts verified evidence only');
});

test('badge: nothing found → "Non scoré"; sources to verify → estimated; all verified → verified score',async()=>{
 const {fitDisplay}=await import('../src/domain/score-display.ts');
 assert.deepEqual(fitDisplay(estimateFit(ICP,[],NOW)),{kind:'none',main:null,verified:null,toVerify:0,toVerifyPoints:0});
 const e=fitDisplay(estimateFit(ICP,[ev(),ev({criterion:'target_fit',status:'VERIFIED',verified_by:'u'})],NOW));
 assert.equal(e.kind,'estimated');assert.equal(e.main,25+27);assert.equal(e.verified,25);assert.equal(e.toVerify,1);assert.equal(e.toVerifyPoints,27);
 const v=fitDisplay(estimateFit(ICP,[ev({status:'VERIFIED',verified_by:'u'})],NOW));
 assert.deepEqual(v,{kind:'verified',main:30,verified:30,toVerify:0,toVerifyPoints:0});
});

test('API: each evidence carries the source type of the observation that proposed it (best-effort, read under RLS)',async()=>{
 const {attachEvidenceSources}=await import('../src/server/evidence-sources.ts');
 const calls:any[]=[];
 const db={from:(t:string)=>({select:()=>({in:async(col:string,ids:string[])=>{calls.push([t,col,ids.length]);return {data:[{evidence_id:'e1',source_type:'official_website'}],error:null}}})})} as any;
 const out=await attachEvidenceSources(db,[{id:'p',evidence:[{id:'e1'},{id:'e2'}]}] as any);
 assert.deepEqual(out[0].evidence,[{id:'e1',source_type:'official_website'},{id:'e2',source_type:null}]);
 assert.deepEqual(calls,[['prospect_observations','evidence_id',2]]);
 const failing={from:()=>({select:()=>({in:async()=>({data:null,error:{message:'x'}})})})} as any;
 const same=[{id:'p',evidence:[{id:'e1'}]}];assert.equal(await attachEvidenceSources(failing,same as any),same,'unchanged on error');
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/return json\(await attachEvidenceSources\(db,await checked\(db\.from\('prospects'\)\.select\('\*,evidence\(\*\),channels\(\*\)'\)/);
});
