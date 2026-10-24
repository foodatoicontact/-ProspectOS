// Next Best Action v1.3 — FIT semantics and GEO safety (canary 2 6XPOS on staging, 2026-10-17: verdict FAIL).
//  1. UNKNOWN is not NEGATIVE: a partly documented FIT with nothing against it is INCOMPLETE, never "low".
//  2. Monotonicity: a criterion going from UNKNOWN to verified TRUE never makes the recommended action less favourable.
//  3. A signal whose place is UNKNOWN under a geographic ICP never drives CONTACT.
// Weights, thresholds, half-lives and the CONTACT requirements are unchanged. Fictitious companies, .example domains,
// real French places (public facts); `now` fixed, no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildOpportunity,NBA_DEFAULT_CONFIG,RULES,ACTION_PRIORITY,type NbaInput,type NbaSignal,type NbaPublicContent,type NbaAction,type Opportunity} from '../src/nba/engine.ts';
import type {Criterion,Evidence} from '../src/domain/core.ts';

const NOW=new Date('2026-10-17T12:00:00Z');
const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
let n=0;
// The canary's ICP shape: a geographic target criterion and three others.
const ICP=(locations:string[]|null=['Occitanie']):Criterion[]=>[
 {key:'target_fit',label:'Restauration en Occitanie',weight:35,...(locations?{rules:{type:'target_fit' as const,config:{locations,match:'any_defined' as const}}}:{})},
 {key:'local_decision',label:'Décision d’achat locale',weight:25},
 {key:'need_fit',label:'Besoin d’un canal direct',weight:25},
 {key:'contactability',label:'Canal de contact documenté',weight:15}];
const ev=(criterion:string,value=true,status:'VERIFIED'|'NOT_VERIFIED'='VERIFIED'):Evidence=>({id:`e${++n}`,criterion,value,status,source_url:'https://presse.example/x',
 excerpt:'Restaurant ouvert à Toulouse.',observed_at:daysAgo(3),verified_by:status==='VERIFIED'?'u':null});
const TOULOUSE={text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'};
const VANNES={text:'Vannes',departments:['56'],regions:['Bretagne'],basis:'EVENT_MENTION'};
const LES_ULIS={text:'Les Ulis',departments:['91'],regions:['Île-de-France'],basis:'EVENT_MENTION'};
const opening=(location:object|null,o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'new_site',status:'VERIFIED',title:'Kantina ouvre un restaurant',
 excerpt:'Kantina vient d’ouvrir un nouveau restaurant.',source_url:`https://presse.example/kantina-${n}`,source_domain:'presse.example',source_type:'search_snippet',confidence:0.6,
 event_date:null,published_at:daysAgo(5),observed_at:daysAgo(5),matched_terms:[],provider:'discovery_recycled',
 raw_metadata:location?{origin:'signal_discovery',location}:{origin:'signal_discovery'},...o});
// A contact-affinity signal (explicit need), located or not.
const sdr=(location:object|null,o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'hiring_role',status:'VERIFIED',title:'Kantina recrute un SDR',
 excerpt:'Kantina recrute un SDR pour son pipeline outbound.',source_url:`https://jobs.example/kantina-${n}`,source_domain:'jobs.example',source_type:'job_board',confidence:0.8,
 event_date:null,published_at:daysAgo(2),observed_at:daysAgo(2),matched_terms:[],provider:'web_search',raw_metadata:location?{location}:null,...o});
const run=(o:Partial<NbaInput>):Opportunity=>buildOpportunity({prospect:{id:`p${++n}`,project_id:'proj',name:'Kantina',status:'À analyser'},criteria:ICP(),
 evidence:[],signals:[],publicContent:[],profile:null,now:NOW,...o});
const action=(o:Opportunity)=>o.explanation.why_this_action[0]!.text;
const LOW_WORDING=/ne correspond pas suffisamment|insuffisant|sous le seuil/i;

// ------------------------------------------------------------
// FIT semantics — required cases
// ------------------------------------------------------------
test('FIT CASE 1 — no evidence + fresh unverified signal → WATCH (existing rule, unchanged)',()=>{
 const o=run({signals:[opening(TOULOUSE,{status:'PENDING_REVIEW'})]});
 assert.equal(o.recommended_action,'WATCH');assert.equal(o.rule,'UNKNOWN_FIT_FRESH_SIGNAL');
 assert.equal(o.scores.fit.profile.state,'UNKNOWN');
});

test('FIT CASE 2 — 35 TRUE, 65 UNKNOWN + fresh VERIFIED signal in the zone → WATCH, not DISMISS, not CONTACT (Mojo)',()=>{
 const o=run({evidence:[ev('target_fit')],signals:[opening(TOULOUSE)]});
 const p=o.scores.fit.profile;
 assert.deepEqual([p.positive_weight,p.negative_weight,p.unknown_weight,p.observed_weight,p.coverage,p.direction,p.state],[35,0,65,35,35,'POSITIVE','INCOMPLETE']);
 assert.equal(o.scores.fit.score,35,'the historical score is unchanged');
 assert.equal(o.recommended_action,'WATCH');assert.equal(o.rule,'INCOMPLETE_FIT_FRESH_SIGNAL');
 assert.equal((o.primary as any).geo_relevance,'MATCH');
});

test('FIT CASE 3 — 35 TRUE + a new verified TRUE: the action never becomes less favourable',()=>{
 const signals=[opening(TOULOUSE)];
 const before=run({evidence:[ev('target_fit')],signals});
 const after=run({evidence:[ev('target_fit'),ev('need_fit')],signals});
 assert.ok(ACTION_PRIORITY[after.recommended_action]<=ACTION_PRIORITY[before.recommended_action],`${before.recommended_action} → ${after.recommended_action}`);
 // 60 verified points reach the existing CONTACT threshold with this fresh verified opening in the zone.
 assert.equal(before.recommended_action,'WATCH');assert.equal(after.recommended_action,'CONTACT');assert.equal(after.rule,'CONTACT_SIGNAL');
});

test('FIT CASE 4 — enough VERIFIED positive evidence + fresh VERIFIED contact signal in the zone → CONTACT (existing rules)',()=>{
 const o=run({evidence:[ev('target_fit'),ev('local_decision'),ev('need_fit')],signals:[sdr(TOULOUSE)]});
 assert.equal(o.scores.fit.profile.verified_score,85);
 assert.equal(o.recommended_action,'CONTACT');assert.equal(o.rule,'EXPLICIT_RECENT_NEED');
});

test('FIT CASE 5 — sufficient VERIFIED negative evidence + strong signal → never CONTACT',()=>{
 const o=run({evidence:[ev('target_fit',false),ev('local_decision',false),ev('need_fit')],signals:[sdr(TOULOUSE)]});
 assert.equal(o.scores.fit.profile.state,'KNOWN_LOW');assert.equal(o.scores.fit.profile.direction,'MIXED');
 assert.notEqual(o.recommended_action,'CONTACT');assert.equal(o.recommended_action,'DISMISS');
 assert.match(action(o),/des éléments vérifiés indiquent que le compte ne correspond pas suffisamment à la cible \(défavorable : Restauration en Occitanie, Décision d’achat locale/);
 const off=run({evidence:[ev('target_fit',false),ev('local_decision',false),ev('need_fit',false)],signals:[sdr(TOULOUSE)]});
 assert.equal(off.rule,'OFF_TARGET');
});

test('FIT CASE 6 — 35 TRUE, 65 UNKNOWN, no timing → not qualified LOW_FIT',()=>{
 const o=run({evidence:[ev('target_fit')]});
 assert.equal(o.scores.fit.profile.state,'INCOMPLETE');
 assert.notEqual(o.rule,'OFF_TARGET');assert.equal(o.recommended_action,'DISMISS','nothing to act on now — the rule says why, without calling the FIT low');
 assert.doesNotMatch(action(o),LOW_WORDING);
 assert.equal(o.rule,'FIT_INCOMPLETE_NO_TIMING','v1.3.x: to document, not rejected');
 assert.equal(action(o),'Les éléments disponibles sont favorables, mais une partie de l’ICP reste non documentée (35 % documenté ; à documenter : Décision d’achat locale, Besoin d’un canal direct, Canal de contact documenté), et aucun élément récent ne justifie une action.');
});

test('FIT CASE 7 — the INCOMPLETE_FIT explanation names the coverage and the missing information',()=>{
 const o=run({evidence:[ev('target_fit')],signals:[opening(TOULOUSE)]});
 assert.equal(action(o),'Un signal récent existe (Nouvelle implantation, il y a 5 jours). Le compte correspond aux critères vérifiés disponibles, mais seulement 35 % de l’ICP est documenté : des informations supplémentaires sont nécessaires avant une prise de contact.');
 assert.doesNotMatch(action(o),LOW_WORDING);
 assert.ok(o.explanation.unknown.some(s=>s.text==='Critères ICP non documentés (65 % de l’ICP) : Décision d’achat locale, Besoin d’un canal direct, Canal de contact documenté.'));
 assert.match(o.explanation.why_this_account[0]!.text,/FIT vérifié 35\/100, 35 % de l’ICP vérifié/);
});

test('FIT CASE 8 — a real LOW FIT needs unfavourable information, never only missing information',()=>{
 // The same 35 points, with and without unfavourable evidence.
 const incomplete=run({evidence:[ev('target_fit')],signals:[opening(TOULOUSE)]});
 const low=run({evidence:[ev('target_fit'),ev('local_decision',false)],signals:[opening(TOULOUSE)]});
 assert.equal(incomplete.scores.fit.profile.state,'INCOMPLETE');assert.equal(low.scores.fit.profile.state,'KNOWN_LOW');
 assert.equal(incomplete.recommended_action,'WATCH');assert.equal(low.recommended_action,'DISMISS');
 // An unverified FALSE observation is not unfavourable information yet: still to check.
 const unverified=run({evidence:[ev('target_fit'),ev('local_decision',false,'NOT_VERIFIED')],signals:[opening(TOULOUSE)]});
 assert.equal(unverified.scores.fit.profile.state,'INCOMPLETE');assert.equal(unverified.recommended_action,'WATCH');
 // Nothing at all: UNKNOWN, never LOW, never OFF_TARGET.
 for(const o of [run({}),run({signals:[opening(TOULOUSE)]})])assert.notEqual(o.rule,'OFF_TARGET');
});

test('FIT — an estimated (unverified) FIT never reaches CONTACT: CONTACT reads the verified score alone',()=>{
 const est=run({criteria:ICP(null),evidence:['target_fit','local_decision','need_fit','contactability'].map(k=>ev(k,true,'NOT_VERIFIED')),signals:[sdr(null)]});
 assert.ok(est.scores.fit.profile.level>=NBA_DEFAULT_CONFIG.fit.contactMin,'estimated 70');
 assert.equal(est.scores.fit.profile.verified_score,0);
 assert.notEqual(est.recommended_action,'CONTACT');assert.equal(est.recommended_action,'WATCH');
});

// ------------------------------------------------------------
// Monotonicity — exhaustive over the canary ICP: every combination of criterion states × typical signal situations;
// each UNKNOWN criterion turned into a verified TRUE, all else equal.
// ------------------------------------------------------------
type St='UNKNOWN'|'TRUE'|'FALSE'|'ESTIMATED';
const STATES:St[]=['UNKNOWN','TRUE','FALSE','ESTIMATED'];
const evidenceOf=(states:St[])=>ICP().flatMap((c,i)=>states[i]==='UNKNOWN'?[]:[{...ev(c.key,states[i]!=='FALSE',states[i]==='ESTIMATED'?'NOT_VERIFIED':'VERIFIED'),id:`m-${c.key}-${states[i]}`}]);
const post=():NbaPublicContent=>({id:'c-1',status:'VERIFIED',source_url:'https://social.example/p',source_domain:'social.example',author:'Claire',
 content:'200 appels cette semaine pour 3 rendez-vous. Il faut revoir notre façon de prospecter.',published_at:daysAgo(1),observed_at:daysAgo(1)});
const SITUATIONS:Record<string,Partial<NbaInput>>={
 none:{},fresh_verified_match:{signals:[opening(TOULOUSE)]},fresh_inferred:{signals:[opening(TOULOUSE,{status:'PENDING_REVIEW'})]},
 old:{signals:[opening(TOULOUSE,{published_at:daysAgo(300)})]},mismatch:{signals:[opening(VANNES)]},unknown_place:{signals:[opening(null)]},
 contact_match:{signals:[sdr(TOULOUSE)]},contact_unknown_place:{signals:[sdr(null)]},conversation:{publicContent:[post()]},
};
test('MONOTONICITY — UNKNOWN → verified TRUE never lowers the recommended action (exhaustive)',()=>{
 let checked=0;const rank=(a:NbaAction)=>-ACTION_PRIORITY[a];
 for(const [name,situation] of Object.entries(SITUATIONS))
  for(let code=0;code<STATES.length**4;code++){
   const states=[0,1,2,3].map(i=>STATES[Math.floor(code/STATES.length**i)%STATES.length]!);
   const before=run({...situation,evidence:evidenceOf(states)});
   states.forEach((s,i)=>{
    if(s!=='UNKNOWN')return;
    const next=[...states];next[i]='TRUE';
    const after=run({...situation,evidence:evidenceOf(next)});
    assert.ok(rank(after.recommended_action)>=rank(before.recommended_action),`${name} ${states.join(',')} → ${next.join(',')}: ${before.rule} ${before.recommended_action} → ${after.rule} ${after.recommended_action}`);
    checked++;
   });
  }
 assert.ok(checked>2000,String(checked));
});

// ------------------------------------------------------------
// GEO — structured places only; UNKNOWN never drives CONTACT under a geographic ICP
// ------------------------------------------------------------
const geoOf=(location:object|null)=>(run({signals:[opening(location)]}).primary as any)?.geo_relevance??null;
test('GEO — ICP Occitanie: Toulouse MATCH, Vannes MISMATCH, Les Ulis MISMATCH, no structured place UNKNOWN',()=>{
 assert.equal(geoOf(TOULOUSE),'MATCH');
 const vannes=run({signals:[opening(VANNES)]});assert.equal(vannes.scores.timing.score,0,'a MISMATCH signal creates no timing');
 assert.equal(vannes.recommended_action,'DISMISS');assert.match(action(vannes),/Vannes, hors de Occitanie/);
 const ulis=run({signals:[opening(LES_ULIS)]});assert.equal(ulis.scores.timing.score,0);assert.equal(ulis.recommended_action,'DISMISS');
 assert.equal(geoOf(null),'UNKNOWN');
 assert.equal(geoOf({text:'Les Ulis',departments:[],regions:[],basis:'EVENT_MENTION'}),'UNKNOWN','the text alone is never compared');
});

test('GEO — UNKNOWN place + geographic ICP → never CONTACT on this signal alone; without a zone, unchanged',()=>{
 const strong=[ev('target_fit'),ev('local_decision'),ev('need_fit')];
 const unknownPlace=run({evidence:strong,signals:[sdr(null)]});
 assert.notEqual(unknownPlace.recommended_action,'CONTACT');assert.equal(unknownPlace.recommended_action,'WATCH');
 assert.equal(run({evidence:strong,signals:[sdr(TOULOUSE)]}).recommended_action,'CONTACT');
 // An UNKNOWN signal never tops up a MATCH one to reach the CONTACT timing either: CONTACT timing counts eligible
 // signals only. A 40-day-old opening in the zone (timing under the CONTACT threshold) + a fresh one of unknown place:
 // together over the threshold, yet no CONTACT — the unknown one only makes the account worth a check.
 const weakMatch=opening(TOULOUSE,{published_at:daysAgo(40)});
 const alone=run({evidence:strong,signals:[weakMatch]}),plus=run({evidence:strong,signals:[weakMatch,sdr(null)]});
 assert.ok(alone.scores.timing.score<NBA_DEFAULT_CONFIG.timing.contactMin&&plus.scores.timing.score>=NBA_DEFAULT_CONFIG.timing.contactMin,JSON.stringify([alone.scores.timing.score,plus.scores.timing.score]));
 assert.notEqual(plus.recommended_action,'CONTACT');assert.equal(plus.recommended_action,'WATCH');
 // No geographic scope in the ICP: the place is not a condition (behaviour of v1.2).
 assert.equal(run({criteria:ICP(null),evidence:strong,signals:[sdr(null)]}).recommended_action,'CONTACT');
});

test('GEO — the NBA engine parses no town or region from text; rules table names the v1.3 rules once',async()=>{
 const engine=await readFile(new URL('../src/nba/engine.ts',import.meta.url),'utf8');
 assert.doesNotMatch(engine,/signal-discovery|eventPlacesIn|communeDepartment|placesIn\(/,'no place reading in NBA');
 const ids=RULES.map(r=>r.id);
 assert.deepEqual(ids.filter(i=>['FIT_FRESH_SIGNAL','INCOMPLETE_FIT_FRESH_SIGNAL','UNKNOWN_FIT_FRESH_SIGNAL'].includes(i)),['FIT_FRESH_SIGNAL','UNKNOWN_FIT_FRESH_SIGNAL','INCOMPLETE_FIT_FRESH_SIGNAL']);
 assert.equal(NBA_DEFAULT_CONFIG.version,'nba-v1.3-2026-10');
 assert.deepEqual([NBA_DEFAULT_CONFIG.fit,NBA_DEFAULT_CONFIG.timing],[{contactMin:60,engageMin:50,watchMin:50,dismissBelow:30},{contactMin:50,watchMin:15}],'thresholds unchanged');
});
