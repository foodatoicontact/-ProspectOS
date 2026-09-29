// A company's public switchboard phone, contact@ e-mail or contact form is a documented contact CHANNEL,
// never an identifiable decision-maker. Only a named person or a precise decision role may be proposed for
// "Contact décisionnaire identifiable" — and only as a proposal a human must confirm (0 point before).
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {ICP_SIGNAL_PREFIX} from '../src/discovery/strategies/icp-concepts.ts';
import {isContactChannelCriterion} from '../src/discovery/strategies/contact-channel.ts';
import {scoreProspect,type Criterion} from '../src/domain/core.ts';
import type {Observation} from '../src/discovery/types.ts';

const NOW=new Date('2026-09-29T10:00:00Z');
const html=(lines:string[])=>`<html><head><title>Ribiere</title></head><body>${lines.map(l=>`<p>${l}</p>`).join('')}</body></html>`;
const extract=(lines:string[],criteria:Criterion[])=>new ObservationService().extract(html(lines),'https://ribiere.fixture.example/',criteria,'official_website',NOW);
// A user-created key and the default-ICP key relabeled by the user: both must behave the same.
const DM=(key:string):Criterion=>({key,label:'Contact décisionnaire identifiable',weight:20});
const KEYS=['c_decision','contactability'];
const attached=(obs:Observation[],key:string)=>obs.filter(o=>o.criterion===key&&o.value===true);

for(const key of KEYS){
 test(`[${key}] 1 — generic phone → NO MATCH for "Contact décisionnaire identifiable"`,()=>{
  const obs=extract(['Tél : 05 55 00 00 00'],[DM(key)]);
  assert.deepEqual(attached(obs,key),[]);
  assert.equal(isContactChannelCriterion(DM(key)),false);
 });
 test(`[${key}] 2 — generic contact@ e-mail → NO MATCH`,()=>{
  assert.deepEqual(attached(extract(['Écrivez-nous : contact@ribiere.fr'],[DM(key)]),key),[]);
 });
 test(`[${key}] 3 — contact form → NO MATCH`,()=>{
  assert.deepEqual(attached(extract(['Formulaire de contact','Contactez-nous'],[DM(key)]),key),[]);
 });
 test(`[${key}] 4 — "Jean Dupont — Directeur commercial" → proposal to confirm (INFERRED, never VERIFIED)`,()=>{
  const obs=extract(['Tél : 05 55 00 00 00','Jean Dupont — Directeur commercial'],[DM(key)]);
  const p=attached(obs,key);
  assert.equal(p.length,1);
  assert.equal(p[0].source_excerpt,'Jean Dupont — Directeur commercial');
  assert.equal(p[0].observation_type,ICP_SIGNAL_PREFIX+key);
  assert.equal(p[0].status,'INFERRED');
 });
 test(`[${key}] 5 — the generic phone stays documented as a contextual note`,()=>{
  const phone=extract(['Tél : 05 55 00 00 00'],[DM(key)]).find(o=>o.observation_type==='PHONE_RAW');
  assert.ok(phone);assert.equal(phone.criterion,null);assert.equal(phone.value,null);
 });
 test(`[${key}] 6/7 — no point without human validation: score 0/100, confirmation required`,()=>{
  const icp:Criterion[]=[{...DM(key),weight:100}];
  const obs=extract(['Tél : 05 55 00 00 00','contact@ribiere.fr','Formulaire de contact','Jean Dupont — Directeur commercial'],icp);
  const evidence=new EvidenceProposalService().propose(obs,icp);
  assert.ok(evidence.every(e=>e.verified_by===null&&e.status!=='VERIFIED'));
  assert.equal(scoreProspect(icp,evidence,NOW).score,0);
  assert.ok(obs.every(o=>(o.status as string)!=='VERIFIED'));
  const confirmed=evidence.map(e=>({...e,status:'VERIFIED' as const,verified_by:'human-1'}));
  assert.equal(scoreProspect(icp,confirmed,NOW).score,100,'a human-confirmed named decision-maker scores as before');
 });
}

test('a real contact-channel criterion still receives the phone (unchanged)',()=>{
 const c:Criterion={key:'contactability',label:'Contact professionnel joignable',weight:20};
 assert.equal(isContactChannelCriterion(c),true);
 const obs=extract(['Tél : 05 55 00 00 00'],[c]);
 assert.equal(attached(obs,'contactability')[0]?.observation_type,'PHONE_RAW');
});
