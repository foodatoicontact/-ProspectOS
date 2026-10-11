// Variant B — "decision first": pure view of data the page already has (no fetch, no score, no angle computed here).
// 1. Pourquoi maintenant ? — from the INTENT the Signals panel already computed (scoreIntent): a VERIFIED signal stays
//    verified, a signal still to review stays "to confirm", nothing stays "unknown". Never upgraded.
// 2. Angle recommandé — only the angle the SERVER returned with the generated message (selectAngle never runs on the
//    client); before generation: "pending_generation".
// 3. Next step — from the O1 message status only. Copy is never "contacted".
import test from 'node:test';
import assert from 'node:assert/strict';
import {whyNowView,angleView,nextStep} from '../src/ux/decision-view.ts';
import type {IntentScore,IntentLine} from '../src/domain/intent.ts';
import type {Angle} from '../src/outreach/angle.ts';
import {readFileSync} from 'node:fs';

const line=(o:Partial<IntentLine>):IntentLine=>({signal_id:'s',signal_type:'hiring_role',title:'t',source_url:'https://x.example/a',source_domain:'x.example',date_basis:'event',age_days:3,weight:25,confidence:0.8,recency:1,relevance:1,multiplier:1,points:20,strength:'strong',verified:true,...o});
const intent=(o:Partial<IntentScore>):IntentScore=>({score:0,lines:[],archived:[],pending:{count:0,potential:0},estimated:{score:0,lines:[],to_verify:0},...o});

test('why now — loading until the Signals panel has computed INTENT',()=>{assert.deepEqual(whyNowView(null),{state:'loading'})});
test('why now — the strongest VERIFIED signal, with the existing INTENT score',()=>{
 const v=whyNowView(intent({score:31,lines:[line({signal_id:'a',title:'faible',points:5}),line({signal_id:'b',title:'fort',points:26,source_domain:'jobs.example',age_days:4})]}));
 assert.deepEqual(v,{state:'verified',signal_id:'b',title:'fort',source_domain:'jobs.example',age_days:4,intent_score:31,count:2});
});
test('why now — only signals to review → to_confirm, never shown as verified',()=>{
 const v=whyNowView(intent({pending:{count:2,potential:18},estimated:{score:18,lines:[line({signal_id:'p',title:'à revoir',verified:false,points:12})],to_verify:2}}));
 assert.deepEqual(v,{state:'to_confirm',count:2,title:'à revoir'});
});
test('why now — verified but archived (0 point) does not count as a reason now',()=>{
 assert.deepEqual(whyNowView(intent({lines:[line({points:0,strength:'archive'})]})),{state:'unknown'});
});
test('why now — nothing → unknown',()=>{assert.deepEqual(whyNowView(intent({})),{state:'unknown'})});

const angle=(type:Angle['type']):Angle=>({type,source_id:type==='generic'?null:'id1',label:'Libellé',reason:'r',source_url:type==='generic'?null:'https://www.example.fr/page',observed_at:null,excerpt:null});
test('angle — none before generation: the server alone chooses it',()=>{
 assert.deepEqual(angleView(null),{state:'pending_generation'});
});
for(const t of ['public_content_pinned','signal','public_content','evidence','generic'] as const)test(`angle — server angle ${t} shown as returned, with its provenance`,()=>{
 const v=angleView(angle(t));
 assert.equal(v.state,'ready');assert.equal((v as any).type,t);assert.equal((v as any).label,'Libellé');
 assert.equal((v as any).source_host,t==='generic'?null:'www.example.fr');
});
test('angle — an unsafe source URL is never turned into a link',()=>{
 assert.equal((angleView({...angle('evidence'),source_url:'javascript:alert(1)'}) as any).source_host,null);
});

test('next step — follows the O1 status only; USED is done, never "contacted"',()=>{
 assert.equal(nextStep(false,'DRAFT'),'generate');
 assert.equal(nextStep(true,'DRAFT'),'review_and_approve');
 assert.equal(nextStep(true,'APPROVED'),'copy');
 assert.equal(nextStep(true,'USED'),'done');
 assert.equal(nextStep(true,'DISCARDED'),'generate');
});

test('the decision view computes nothing of its own: no scoring, no angle selection, no fetch',()=>{
 const src=readFileSync(new URL('../src/ux/decision-view.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/scoreIntent\(|scoreProspect\(|selectAngle\(|composeRuleBased\(|fetch\(|api\(/);
 assert.doesNotMatch(src,/opportunit|priority|priorit/i,'no invented score or priority');
});
