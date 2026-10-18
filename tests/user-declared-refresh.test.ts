// UI-4 fix — a USER_DECLARED changes the FIT profile without necessarily changing the action or the driving signal; the
// recommendation's fingerprint (version:action:driver) then stayed the same, save_nba_actions kept the old row as
// "unchanged", and Today served the old FIT profile (staging canary on Quick, 2026-10-18). The fingerprint now carries a
// digest of the declarations that feed the estimate — only when there are some. The Quick case below is the staging data
// (6XPOS) as read on 2026-10-18; no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpportunity,type NbaInput,type Opportunity} from '../src/nba/engine.ts';
import {estimateFit} from '../src/domain/fit-estimate.ts';
import {computeProject} from '../src/nba/api.ts';
import {todayV2} from '../src/ui/v2/today/model.ts';
import type {TodayRow} from '../src/nba/today.ts';
import {composeRuleBased} from '../src/outreach/compose.ts';
import {generateOutreach,type Criterion} from '../src/domain/core.ts';

const NOW=new Date('2026-10-18T16:44:00Z');
const CRITERIA:Criterion[]=[
 {key:'target_fit',label:'Restauration avec point de vente physique en Occitanie',weight:35,rules:{type:'target_fit',config:{match:'all_defined',locations:['Occitanie'],categories:['restaurant','restauration rapide','snack','burger','pizza','kebab','vente à emporter','cuisine à emporter']}}},
 {key:'local_decision',label:'Indépendant ou petit réseau : décision d’achat locale (pas une grande chaîne aux achats centralisés)',weight:25},
 {key:'need_fit',label:'Besoin d’un canal direct : commande directe, click & collect, fidélité, moindre dépendance aux plateformes',weight:25,rules:{type:'need_fit',config:{signals:['click & collect','commande en ligne','fidélité','Uber Eats','Deliveroo']}}},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:15}];
const QUICK={id:'4c9a9b0c-cff9-4d7c-8e23-809c01f8d825',project_id:'7502ae8e-1df0-4dfa-99ab-4599b08a6591',name:'Quick',status:'À analyser'};
const VERIFIED_TARGET={id:'2d6b5b3e-b100-49bb-87dc-d97684a802a7',criterion:'target_fit',value:true,status:'VERIFIED',
 excerpt:'Ce vendredi 17 septembre, Quick ouvre un nouveau restaurant aux portes de Montpellier et plus précisément au sein de la zone commerciale du Crès.',
 source_url:'https://actu.fr/occitanie/le-cres_34090/quick-ouvre-un-nouveau-restaurant-aux-portes-de-montpellier_64805388.html',observed_at:'2026-09-20T00:00:00+00:00',verified_by:'41b6c178-00d0-426c-a6be-8d5e3cc7627c'};
// The row the canary created from the Preview (Sheet, mobile).
const CANARY_DECLARATION={id:'ca941035-e0ba-4edc-a4cb-2d8de77e9ba0',criterion:'local_decision',value:true,status:'USER_DECLARED',excerpt:null,source_url:null,
 observed_at:'2026-10-18T16:43:44.623+00:00',verified_by:null,declared_by:'03ce80fd-03ca-4022-b635-b3494c1c6eaa',note:'Test canary UI-4'};
const sig=(id:string,type:string,title:string,excerpt:string,url:string,dom:string,pub:string,obs:string,ev:string|null,loc:object)=>({id,provider:'discovery_recycled',signal_type:type,status:'VERIFIED',
 title,excerpt,source_url:url,source_domain:dom,source_type:'search_snippet',confidence:0.6,event_date:ev,published_at:pub,observed_at:obs,matched_terms:[],raw_metadata:{origin:'signal_discovery',location:loc}});
const QUICK_SIGNALS=[
 sig('618fc74b-5a7e-4781-b828-116c5671fd1d','new_site','Quick — Quick ouvre un nouveau restaurant aux portes de Montpellier','Ce vendredi 17 septembre, Quick ouvre un nouveau restaurant aux portes de Montpellier et plus précisément au sein de la zone commerciale du Crès.',
  'https://actu.fr/occitanie/le-cres_34090/quick-ouvre-un-nouveau-restaurant-aux-portes-de-montpellier_64805388.html','actu.fr','2026-09-20T12:56:58+00:00','2026-10-14T00:45:39.717894+00:00',null,{text:'Le Crès',basis:'EVENT_MENTION',regions:['Occitanie'],departments:['34']}),
 sig('30c296d8-7534-405f-b1e1-6754b62a1802','expansion','Quick — Hérault : un nouveau Quick ouvre dans cette commune — InfOccitanie','L\'enseigne de restauration rapide Quick poursuit son développement autour de Montpellier (Hérault).',
  'https://infoccitanie.fr/herault-un-nouveau-quick-ouvre-dans-cette-commune/','infoccitanie.fr','2026-09-22T12:48:02+00:00','2026-10-13T23:49:49.582936+00:00',null,{text:'Hérault (34)',basis:'EVENT_MENTION',regions:['Occitanie'],departments:['34']}),
 sig('b638af2f-2a0b-4f2f-be20-33697840bcff','new_site','Quick ouvre un nouveau restaurant le 2 juillet 2026, près de Saint-Brieuc en Bretagne : découvrez où','Quick fait son retour dans l’agglomération briochine après huit ans d’absence : le restaurant ouvrira ses portes le 2 juillet 2026 à Trégueux, dans la zone commerciale de Brézillet.',
  'https://lexpress-franchise.com/actualites/quick-ouvre-2-juillet-2026-nouveau-restaurant-pres-saint-brieuc-bretagne/','lexpress-franchise.com','2026-07-02T00:00:00+00:00','2026-10-13T23:49:49.582936+00:00','2026-07-02',{text:'Trégueux',basis:'EVENT_MENTION',regions:['Bretagne'],departments:['22']})];
const STORED_FINGERPRINT='nba-v1.3-2026-10:WATCH:30c296d8-7534-405f-b1e1-6754b62a1802';
const quick=(evidence:object[]):Opportunity=>buildOpportunity({prospect:QUICK,criteria:CRITERIA,evidence,signals:QUICK_SIGNALS,publicContent:[],profile:null,now:NOW} as unknown as NbaInput);
const row=(o:Opportunity):TodayRow=>({id:'a',prospect_id:o.prospect_id,recommended_action:o.recommended_action,rule:o.rule,state:'PENDING',opportunity_score:o.scores.opportunity.score,
 fit_score:o.scores.fit.score,fit_basis:o.scores.fit.basis,intent_score:o.scores.intent.score,timing_score:o.scores.timing.score,freshness_score:o.scores.freshness.score,
 evidence_quality_score:o.scores.evidence_quality.score,primary_kind:o.primary?.kind??null,primary_signal_type:o.primary?.kind==='signal'?o.primary.commercial_type:null,
 primary_evidence_status:o.primary?.kind==='signal'?o.primary.evidence_status:null,signal_age_days:o.primary?.age_days??null,primary_detail:o.primary as TodayRow['primary_detail'],
 scores:o.scores as TodayRow['scores'],target:o.target,explanation:o.explanation,prepared_content:null,computed_at:o.computed_at,prospects:{name:'Quick'}});
const card=(o:Opportunity)=>{const v=todayV2([row(o)],'fr');return [...v.cards,...v.watched][0]!};

test('QUICK — the staging canary, exactly: before the declaration (the stored recommendation)',()=>{
 const o=quick([VERIFIED_TARGET]);const p=o.scores.fit.profile;
 assert.deepEqual([o.recommended_action,o.rule,o.fingerprint],['WATCH','INCOMPLETE_FIT_FRESH_SIGNAL',STORED_FINGERPRINT],'what staging stores (49a91382)');
 assert.deepEqual([p.verified_score,p.level,p.verified_coverage,o.scores.evidence_quality.score],[35,35,35,50]);
 const c=card(o);
 assert.deepEqual(c.level2.favourableItems.map(f=>f.basis),['verified']);assert.equal(c.level2.missingItems.length,3);
 assert.equal(c.note,'3 informations à documenter.');
});
test('QUICK — after local_decision = true: a NEW recommendation (fingerprint differs), verified unchanged, Level 2 / 3 refreshed',()=>{
 const before=quick([VERIFIED_TARGET]),after=quick([VERIFIED_TARGET,CANARY_DECLARATION]);const p=after.scores.fit.profile;
 assert.equal(after.recommended_action,'WATCH','the action stays WATCH');
 assert.equal(after.primary?.kind==='signal'&&after.primary.signal_id,'30c296d8-7534-405f-b1e1-6754b62a1802','the same driving signal');
 assert.notEqual(after.fingerprint,STORED_FINGERPRINT,'re-stated: save_nba_actions no longer answers "unchanged"');
 assert.match(after.fingerprint,/^nba-v1\.3-2026-10:WATCH:30c296d8-7534-405f-b1e1-6754b62a1802:ud[0-9a-f]{16}$/);
 assert.deepEqual([p.verified_score,p.verified_coverage,after.scores.evidence_quality.score],[35,35,50],'verified FIT, coverage and evidence quality unchanged');
 assert.equal(p.level,53,'estimated FIT 35 → 53 (25 × 0.7 = 18)');
 const c=card(after);
 assert.deepEqual(c.level2.favourableItems,[{label:CRITERIA[0]!.label,basis:'verified'},{label:CRITERIA[1]!.label,basis:'declared'}],'1 verified + 1 "Déclaré par vous"');
 assert.equal(c.level2.missingItems.length,2,'2 missing');
 assert.deepEqual(c.level3.evidence.find(e=>e.label==='USER_DECLARED true'),{label:'USER_DECLARED true',value:CRITERIA[1]!.label});
 assert.notEqual(before.fingerprint,after.fingerprint);
});
test('QUICK — safety unchanged: no CONTACT, nothing quoted from the declaration',()=>{
 const o=quick([VERIFIED_TARGET,CANARY_DECLARATION]);assert.notEqual(o.recommended_action,'CONTACT');
 const offer='Solutions d’encaissement pour restaurants.';
 const ev=[VERIFIED_TARGET,CANARY_DECLARATION] as never[];
 const g=generateOutreach('Quick',offer,CRITERIA,ev,NOW,'fr');const c=composeRuleBased({name:'Quick',offer,criteria:CRITERIA,evidence:ev,signals:QUICK_SIGNALS as never[],profile:null,publicContent:[],now:NOW,locale:'fr'});
 for(const t of [g.text,c.text])assert.ok(!t.includes('Test canary UI-4')&&!t.includes('Indépendant ou petit réseau'));
 assert.ok(![...g.evidence_ids,...c.evidence_ids].includes(CANARY_DECLARATION.id));
});

// ------------------------------------------------------------ fingerprint identity
const D=(criterion:string,value:boolean,o:object={})=>({id:`d-${criterion}-${value}`,criterion,value,status:'USER_DECLARED',source_url:null,excerpt:null,observed_at:'2026-10-18T10:00:00Z',verified_by:null,note:null,...o});
const fp=(evidence:object[])=>quick([VERIFIED_TARGET,...evidence]).fingerprint;
test('identity — deterministic, order-free, content-based (criterion + value), never the id nor the note',()=>{
 const a=[D('local_decision',true),D('need_fit',false)];
 assert.equal(fp(a),fp(a),'deterministic');assert.equal(fp([...a].reverse()),fp(a),'row order never matters');
 assert.equal(fp([D('local_decision',true,{id:'another-id'}),D('need_fit',false,{id:'x2'})]),fp(a),'same content, other ids: same identity');
 assert.equal(fp([D('local_decision',true),D('local_decision',true,{id:'dup'})]),fp([D('local_decision',true)]),'a duplicate adds nothing');
 // The note is never read by the engine (no score, rule, sentence or label depends on it): it would only churn.
 assert.equal(fp([D('local_decision',true,{note:'Autre note'})]),fp([D('local_decision',true,{note:'Test'})]),'note alone: same identity');
 assert.notEqual(fp([D('local_decision',true)]),fp([D('local_decision',false)]),'TRUE and FALSE told apart');
 assert.notEqual(fp([D('local_decision',true),D('need_fit',true)]),fp([D('local_decision',true)]),'a new relevant declaration: new identity');
 assert.notEqual(fp([D('local_decision',true),D('local_decision',false)]),fp([D('local_decision',true)]),'contradicting declarations are part of the identity');
 assert.equal(fp([D('local_decision',false),D('local_decision',true)]),fp([D('local_decision',true),D('local_decision',false)]),'order-free within one criterion too');
});
test('identity — only declarations that feed the estimate: no churn from irrelevant rows',()=>{
 const base=fp([]);
 assert.equal(base,STORED_FINGERPRINT,'no declaration: the historical fingerprint, exactly');
 assert.equal(fp([D('target_fit',false)]),base,'a criterion a VERIFIED fact decides: the declaration changes nothing');
 assert.equal(fp([D('budget',true)]),base,'a criterion outside the ICP');
 assert.equal(fp([D('local_decision',true,{observed_at:'2026-07-01T00:00:00Z'})]),base,'outside the 90-day window');
 assert.equal(fp([{...D('local_decision',true),status:'NOT_VERIFIED',source_url:'https://x.example',excerpt:'x'}]),base,'other statuses never add a suffix');
 assert.deepEqual(estimateFit(CRITERIA,[VERIFIED_TARGET,D('need_fit',false),D('local_decision',true)] as never[],NOW).declarations,['local_decision=T','need_fit=F']);
 // Bounded: a 30-criterion ICP fully declared stays inside the database's 120-character limit.
 const many:Criterion[]=Array.from({length:30},(_,i)=>({key:`criterion_with_a_long_key_${i}`,label:`C${i}`,weight:i<10?4:3}));
 const all=many.map(c=>D(c.key,true));
 const o=buildOpportunity({prospect:QUICK,criteria:many,evidence:all,signals:QUICK_SIGNALS,publicContent:[],profile:null,now:NOW} as unknown as NbaInput);
 assert.ok(o.fingerprint.length<=120,`${o.fingerprint.length}`);
});
test('tenant / prospect isolation — another prospect\'s declaration never touches this prospect\'s fingerprint',()=>{
 const other={...QUICK,id:'00000000-0000-4000-8000-0000000000ff',name:'Autre'};
 const data=(otherEvidence:object[])=>({project:{icps:[{criteria:CRITERIA}],offer:''},prospects:[{...QUICK,evidence:[VERIFIED_TARGET]},{...other,evidence:otherEvidence}],
  signals:QUICK_SIGNALS.map(s=>({...s,prospect_id:QUICK.id})),content:[],profile:null});
 const without=computeProject(data([]) as never,NOW).items.find(i=>i.prospect_id===QUICK.id)!;
 const withOther=computeProject(data([D('local_decision',true)]) as never,NOW).items.find(i=>i.prospect_id===QUICK.id)!;
 assert.equal(withOther.fingerprint,without.fingerprint);assert.equal(without.fingerprint,STORED_FINGERPRINT);
 const otherRow=computeProject(data([D('local_decision',true)]) as never,NOW).items.find(i=>i.prospect_id===other.id)!;
 assert.match(String(otherRow.fingerprint),/:ud[0-9a-f]{16}$/,'the declaration belongs to its own prospect');
});
