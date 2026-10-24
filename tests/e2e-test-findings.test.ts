// End-to-end test 2026-10-24 (a real BTP prospect added by hand, proofs validated, a draft written): two display
// findings. Pure tests, no network, no database.
//  1. A criterion read as met while a proof pointing the other way was never reviewed (score 100/100, "hors AURA"
//     unseen). The line now says so; the score itself is unchanged.
//  2. "Analyser le site" on a hand-added prospect answered "Analyse impossible" + "Réessayer", which reads as an
//     outage. The refusal is by design: it now explains why and what to do instead, and offers no retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unreviewedContrary} from '../src/components/evidence-verification.ts';
import {scoreProspect,type Evidence} from '../src/domain/core.ts';

const ev=(id:string,value:boolean,status:string,excerpt=`Extrait ${id}`):Evidence=>({id,criterion:'target_fit',value,status,source_url:'https://x.example/',excerpt,observed_at:'2026-10-24T10:00:00Z',verified_by:status==='VERIFIED'||status==='CONTRADICTED'?'u1':null});

test('contrary — a met criterion with an unreviewed opposite proof is flagged; the score is unchanged', () => {
 const all=[ev('size',true,'NOT_VERIFIED','35 collaborateurs'),ev('size-ok',true,'VERIFIED','35 collaborateurs'),ev('region',false,'NOT_VERIFIED','Siège : Toulouse')];
 const s=scoreProspect([{key:'target_fit',label:'PME 10–100, priorité AURA',weight:100}],all,new Date('2026-10-24T12:00:00Z'));
 assert.equal(s.breakdown[0].state,'TRUE');assert.equal(s.score,100,'display only: scoring is untouched');
 assert.deepEqual(unreviewedContrary('TRUE','target_fit',all).map(e=>e.id),['region']);
});
test('contrary — an unmet criterion flags an unreviewed proof saying it is met', () => {
 assert.deepEqual(unreviewedContrary('FALSE','target_fit',[ev('a',false,'VERIFIED'),ev('b',true,'INFERRED_UNCONFIRMED')]).map(e=>e.id),['b']);
});
test('contrary — nothing to flag once the opposite proof was reviewed (verified or contradicted copy), or when the criterion is not settled', () => {
 const verifiedCopy=[ev('ok',true,'VERIFIED'),ev('r',false,'NOT_VERIFIED','Siège : Toulouse'),ev('r2',false,'VERIFIED','Siège : Toulouse')];
 assert.deepEqual(unreviewedContrary('CONFLICT','target_fit',verifiedCopy),[]);
 const contradicted=[ev('ok',true,'VERIFIED'),ev('r',false,'NOT_VERIFIED','Siège : Toulouse'),ev('r2',false,'CONTRADICTED','Siège : Toulouse')];
 assert.deepEqual(unreviewedContrary('TRUE','target_fit',contradicted),[]);
 for(const state of ['UNKNOWN','CONFLICT'])assert.deepEqual(unreviewedContrary(state,'target_fit',[ev('r',false,'NOT_VERIFIED')]),[]);
 assert.deepEqual(unreviewedContrary('TRUE','target_fit',[ev('same-side',true,'NOT_VERIFIED')]),[],'a proof agreeing with the state is not contrary');
 assert.deepEqual(unreviewedContrary('TRUE','need_fit',[ev('other-criterion',false,'NOT_VERIFIED')]),[]);
});
test('contrary — the v2 record (production UI) says it on the criterion line, in both locales', () => {
 const v2=readFileSync(new URL('../src/ui/v2/prospects/ProspectsV2.tsx',import.meta.url),'utf8');
 assert.match(v2,/\{c\.contraryLabel&&<small className="pos-pcrit__contrary" data-testid="criterion-contrary" role="note">\{c\.contraryLabel\}<\/small>\}/);
 const model=readFileSync(new URL('../src/ui/v2/prospects/model.ts',import.meta.url),'utf8');
 assert.match(model,/contraryLabel:unreviewedContrary\(b\.state,b\.key,prospect\.evidence\)\.length\?CONTRARY_LABEL\[locale\]:null/);
 assert.match(model,/fr:'Preuve contraire à relire',en:'Contrary evidence to review'/);
});

test('manual prospect — the server explains the refusal and points to the manual tools, without operator jargon', () => {
 const api=readFileSync(new URL('../src/discovery/api.ts',import.meta.url),'utf8');
 for(const code of ['SOURCE_POLICY_REQUIRED','DISCOVERY_CAPABILITY_INVALID']){
  const msg=api.match(new RegExp(`${code}:\\['([^']+)'`))![1];
  assert.match(msg,/＋ Preuve/,code);assert.match(msg,/Analyser un texte/,code);assert.doesNotMatch(msg,/DISCOVERY_ALLOWED_HOSTS|opérateur/,code);
 }
});
test('manual prospect — no retry and no technical note for a refusal retrying cannot change; real failures keep both', () => {
 const ui=readFileSync(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
 assert.match(ui,/MANUAL_ONLY_CODES=new Set\(\['SOURCE_POLICY_REQUIRED','DISCOVERY_CAPABILITY_INVALID'\]\)/);
 assert.match(ui,/const manualOnly=failed&&MANUAL_ONLY_CODES\.has\(errorCode\);/);
 assert.match(ui,/<p>\{error\}<\/p>\{!manualOnly&&<><p className="muted">\{tr\('evidence\.analysisFailedNote'\)\}<\/p><button disabled=\{busy\|\|disabled\} onClick=\{analyze\}>\{tr\('evidence\.retry'\)\}<\/button><\/>\}<\/div>/);
 assert.match(ui,/setErrorCode\(\(e as Error&\{code\?:string\}\)\?\.code\?\?''\)/,'the API error code reaches the card');
});
