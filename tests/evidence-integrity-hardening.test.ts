// Evidence integrity hardening — regressions reproduced on the real engine during the BIG crash-test.
// A machine proposal is never a validated proof: an article or a discourse marker is never an ICP rule, a
// generic event never satisfies a specialised criterion, an old or resolved event is never a current signal,
// and no wording before human review says that a condition is satisfied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTargetingProposal} from '../src/domain/onboarding.ts';
import {scoreProspect,DEFAULT_CRITERIA,type Criterion,type Evidence} from '../src/domain/core.ts';
import {evaluateTargetFit} from '../src/discovery/strategies/target-fit.ts';
import {matchNeedFitSignal} from '../src/discovery/strategies/need-fit.ts';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';

const OFFER="On propose un SOC managé 24/7 (détection et réponse aux incidents) et un accompagnement à la mise en conformité NIS2 pour les industriels qui n'ont pas d'équipe cyber en interne.";
const TARGET="Des ETI industrielles ou agroalimentaires entre 200 et 2000 salariés en Auvergne-Rhône-Alpes, idéalement qui recrutent un RSSI ou qui ont eu un incident cyber récemment.";
const NOW=new Date('2026-10-04T09:00:00Z');
const FUNCTION_WORDS=/^(?:le|la|les|l|un|une|des|de|du|d|au|aux|a|à|en|dans|sur|pour|par|avec|et|ou|qui|que|idéalement|notamment|surtout)$/i;
const page=(...lines:string[])=>`<html><head><title>Exemple</title></head><body>${lines.map(l=>`<p>${l}</p>`).join('')}</body></html>`;
const extract=(lines:string[],criteria:Criterion[])=>new ObservationService().extract(page(...lines),'https://exemple.test/',criteria,'official_website',NOW);
const withRules=(over:Partial<Record<'target_fit'|'need_fit'|'commercial_signal',Partial<Criterion>>>):Criterion[]=>DEFAULT_CRITERIA.map(c=>({...c,...(over as Record<string,Partial<Criterion>>)[c.key]}));
const positive=(obs:ReturnType<typeof extract>,key:string)=>obs.filter(o=>o.criterion===key&&o.value===true);

test('A — an article ("des") never becomes a category, a target_fit rule or a matching term',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 assert.ok(p.categories.value.every(c=>!FUNCTION_WORDS.test(c)),`categories: ${JSON.stringify(p.categories.value)}`);
 const rule=p.criteria.find(c=>c.key==='target_fit')?.rules;
 const ruleCategories=rule?.type==='target_fit'?rule.config.categories??[]:[];
 assert.ok(ruleCategories.every(c=>!FUNCTION_WORDS.test(c)),`target_fit categories: ${JSON.stringify(ruleCategories)}`);
 assert.ok(p.categories.value.includes('agroalimentaire'),'the explicit business words are kept');
 assert.ok(p.categories.value.some(c=>/^industri/.test(c)),'the explicit business words are kept');
 assert.doesNotMatch(p.discovery.query,/^des\b/i);
 // An ICP saved before this fix may still carry "des": it can no longer validate anything.
 assert.equal(evaluateTargetFit({lines:['Nous fabriquons des fromages.']},{match:'any_defined',categories:['des']}).satisfied,false);
});

test('B — a discourse marker ("idéalement") is never a need signal; "ou" never stays attached',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 const signals=p.signals.value;
 assert.ok(!signals.some(s=>/^idéalement$/i.test(s)),`signals: ${JSON.stringify(signals)}`);
 assert.ok(signals.every(s=>!/\s(?:ou|et)$/i.test(s)&&!/^(?:qui|ou|et)\s/i.test(s)),`signals: ${JSON.stringify(signals)}`);
 assert.ok(signals.some(s=>/RSSI/.test(s)),'the recruiting concept is kept');
 assert.ok(signals.some(s=>/incident cyber/i.test(s)),'the incident concept is kept');
 // An ICP saved before this fix may still carry "idéalement": it can no longer match a page.
 assert.equal(matchNeedFitSignal({lines:['Idéalement situés au cœur des Alpes.']},['idéalement']),null);
});

test('C — a headcount range is a structured constraint, never search words',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 assert.doesNotMatch(p.discovery.query,/200|2000|salari/i,`query: ${p.discovery.query}`);
 assert.deepEqual((p as unknown as {employeeRange?:unknown}).employeeRange,{min:200,max:2000});
 assert.ok(p.notes.some(n=>/200.*2000.*salariés/.test(n)),'still shown to the human as a note');
});

test('D — a generic recruitment never satisfies a specialised recruiting criterion',()=>{
 const criteria=withRules({commercial_signal:{label:'Recrutement cybersécurité (RSSI, ingénieur sécurité)'}});
 assert.deepEqual(positive(extract(['Nous recrutons 40 opérateurs de production.'],criteria),'commercial_signal'),[]);
 assert.equal(positive(extract(['Nous recrutons actuellement un RSSI.'],criteria),'commercial_signal').length,1);
 assert.equal(positive(extract(['Nous recrutons un ingénieur sécurité.'],criteria),'commercial_signal').length,1);
});

test('E — an old dated event is historical information, never a current signal because the page was collected today',()=>{
 const obs=extract(['Mars 2021 : nous recrutons 40 opérateurs de production.'],DEFAULT_CRITERIA);
 assert.deepEqual(positive(obs,'commercial_signal'),[],'not proposed as a current recruitment');
 assert.deepEqual(new EvidenceProposalService().propose(obs,DEFAULT_CRITERIA).filter(e=>e.criterion==='commercial_signal'),[]);
 assert.ok(obs.some(o=>o.value===null&&/2021/.test(o.claim)&&/historique/i.test(o.claim)),'kept as dated, historical information');
 // No date on the page: still a proposal, but the claim never presents it as established or current.
 const undated=positive(extract(['Nous recrutons actuellement un RSSI.'],DEFAULT_CRITERIA),'commercial_signal');
 assert.equal(undated.length,1);
 assert.match(undated[0].claim,/date.*(?:non|pas).*(?:publiée|identifiée)/i);
 assert.doesNotMatch(undated[0].claim,/actif/i);
});

test('F — a resolved or negated event is never a current need',()=>{
 const criteria=withRules({need_fit:{rules:{type:'need_fit',config:{signals:['incident cyber']}}}});
 for(const line of ['Nous avons subi un incident cyber en 2020, aujourd’hui résolu.','Notre incident cyber est aujourd’hui résolu.','Nous n’avons jamais subi d’incident cyber.'])
  assert.deepEqual(positive(extract([line],criteria),'need_fit'),[],line);
 assert.equal(positive(extract(['Nous venons de subir un incident cyber.'],criteria),'need_fit').length,1,'a current mention is still proposed');
});

test('G — before human review, no claim says that a condition is satisfied, observed or active',()=>{
 const criteria=withRules({target_fit:{rules:{type:'target_fit',config:{match:'any_defined',categories:['fromagerie']}}},need_fit:{rules:{type:'need_fit',config:{signals:['incident cyber']}}}});
 const obs=extract(['Fromagerie familiale en Savoie.','Nous venons de subir un incident cyber.','Nous recrutons actuellement un RSSI.'],criteria);
 const proposals=obs.filter(o=>o.value===true&&o.criterion&&['target_fit','need_fit','commercial_signal'].includes(o.criterion));
 assert.equal(proposals.length,3);
 for(const o of proposals){
  assert.doesNotMatch(o.claim,/satisfaite|explicitement|actif|annoncé/i,o.claim);
  assert.match(o.claim,/à vérifier/i,o.claim);
 }
});

test('invariant — machine proposals never count in the score before human validation',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 const obs=extract(['Nous fabriquons des fromages.','Idéalement situés au cœur des Alpes.','Mars 2021 : nous recrutons 40 opérateurs de production.','Nous recrutons actuellement un RSSI.','Nous avons subi un incident cyber en 2020, aujourd’hui résolu.','Tél. 04 79 00 00 00'],p.criteria);
 const evidence:Evidence[]=new EvidenceProposalService().propose(obs,p.criteria);
 assert.ok(evidence.every(e=>e.status!=='VERIFIED'&&e.verified_by===null));
 assert.equal(scoreProspect(p.criteria,evidence,NOW).score,0);
});

test('replay — the crash-test sentences against the crash-test ICP',()=>{
 const p=buildTargetingProposal({offerText:OFFER,targetText:TARGET});
 const one=(line:string)=>extract([line],p.criteria).filter(o=>o.value===true&&o.criterion!=='contactability');
 assert.deepEqual(one('Nous fabriquons des fromages.'),[],'"des" no longer matches the target');
 assert.deepEqual(one('Idéalement situés au cœur des Alpes.'),[],'"idéalement" no longer matches a need');
 assert.deepEqual(one('Mars 2021 : nous recrutons 40 opérateurs de production.'),[],'old generic recruitment: historical only');
 assert.ok(one('Nous recrutons actuellement un RSSI.').some(o=>o.criterion==='need_fit'),'the user’s own need (RSSI recruitment) is proposed, to verify');
 assert.deepEqual(one('Nous avons subi un incident cyber en 2020, aujourd’hui résolu.'),[],'resolved past incident: not a current need');
});

test('guards of this hardening — no false date, no word cut, a negation only counts next to the signal',async()=>{
 const {eventDateIn}=await import('../src/discovery/strategies/event-time.ts');
 assert.equal(eventDateIn('Groupe de 2000 salariés, nous recrutons un RSSI.'),null,'a headcount is not a year');
 assert.equal(eventDateIn('Depuis 1952, nous recrutons localement.'),null,'a founding year is not the date of the event');
 assert.deepEqual(eventDateIn('Mars 2021 : nous recrutons.'),{year:2021,month:3,text:'mars 2021'});
 assert.deepEqual(buildTargetingProposal({offerText:OFFER,targetText:'Détaillants de vélos en Bretagne'}).categories.value,['détaillants'.slice(0,-1)],'an article is removed only as a whole word');
 const criteria=withRules({need_fit:{rules:{type:'need_fit',config:{signals:['commande à emporter']}}}});
 assert.equal(positive(extract(['Pas de frais de service, commande à emporter disponible.'],criteria),'need_fit').length,1,'a negation elsewhere in the sentence does not negate the signal');
 assert.deepEqual(positive(extract(['Pas de commande à emporter.'],criteria),'need_fit'),[]);
});
