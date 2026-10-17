// Next Best Action — canary fix 1 (canary 6XPOS on staging, 2026-10-17: 10/10 DISMISS, one false explanation). Three
// fixes, nothing else (weights, FIT thresholds, half-lives, expiries, CONTACT and ENGAGE rules unchanged):
//  FIX 1  FIT UNKNOWN + fresh, non-rejected signal (not outside the ICP's zone) → WATCH, never CONTACT.
//  FIX 2  WHY_THIS_ACTION is written from the state, never a generic sentence the data could contradict.
//  FIX 3  SIGNAL_GEO_RELEVANCE MATCH / MISMATCH / UNKNOWN from structured places only (department codes, region names).
// Fictitious companies and .example domains; real French places (public facts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpportunity,geoRelevance,icpZoneOf,NBA_DEFAULT_CONFIG,type NbaInput,type NbaSignal,type Opportunity} from '../src/nba/engine.ts';
import type {Criterion,Evidence} from '../src/domain/core.ts';

const NOW=new Date('2026-10-17T12:00:00Z');
const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
let n=0;
const crit=(fit:number,locations?:string[]):Criterion[]=>[
 {key:'target_fit',label:'Correspond à la cible définie',weight:fit,...(locations?{rules:{type:'target_fit' as const,config:{locations,match:'any_defined' as const}}}:{})},
 ...(fit<100?[{key:'other',label:'Autre critère',weight:100-fit}]:[])];
const ev=(value=true):Evidence=>({id:`e${++n}`,criterion:'target_fit',value,status:'VERIFIED',source_url:'https://registre.example/x',excerpt:'Restaurant, Toulouse.',observed_at:daysAgo(3),verified_by:'u'});
const TOULOUSE={text:'Toulouse',departments:['31'],regions:['Occitanie'],basis:'EVENT_MENTION'};
const VANNES={text:'Vannes',departments:['56'],regions:['Bretagne'],basis:'EVENT_MENTION'};
const MONTPELLIER={text:'Montpellier',departments:['34'],regions:['Occitanie'],basis:'EVENT_MENTION'};
const opening=(o:Partial<NbaSignal>={},location:object|null=null):NbaSignal=>({id:`s${++n}`,signal_type:'new_site',status:'PENDING_REVIEW',title:'Kantina ouvre un restaurant',
 excerpt:'Kantina vient d’ouvrir un nouveau restaurant.',source_url:`https://presse.example/kantina-${n}`,source_domain:'presse.example',source_type:'search_snippet',confidence:0.6,
 event_date:null,published_at:daysAgo(5),observed_at:daysAgo(5),matched_terms:[],provider:'discovery_recycled',raw_metadata:location?{origin:'signal_discovery',location}:{origin:'signal_discovery'},...o});
const sdr=(o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'hiring_role',status:'VERIFIED',title:'Kantina recrute un SDR',excerpt:'Kantina recrute un SDR pour son pipeline outbound.',
 source_url:`https://jobs.example/kantina-${n}`,source_domain:'jobs.example',source_type:'job_board',confidence:0.8,event_date:null,published_at:daysAgo(2),observed_at:daysAgo(2),matched_terms:[],provider:'web_search',...o});
const run=(o:Partial<NbaInput>):Opportunity=>buildOpportunity({prospect:{id:`p${++n}`,project_id:'proj',name:'Kantina',status:'À analyser'},criteria:crit(80),evidence:[],signals:[],publicContent:[],profile:null,now:NOW,...o});
const action=(o:Opportunity)=>o.explanation.why_this_action[0]!.text;
const NO_RECENT=/aucun (élément|signal) récent|ni un signal récent|insuffisantes/i;

test('CASE 1 — FIT UNKNOWN + fresh PENDING_REVIEW signal → WATCH (a human check), not DISMISS, never CONTACT',()=>{
 const o=run({signals:[opening()]});
 assert.equal(o.scores.fit.basis,'unknown');
 assert.equal(o.recommended_action,'WATCH');assert.equal(o.rule,'UNKNOWN_FIT_FRESH_SIGNAL');
 assert.equal(action(o),'Un signal récent existe (Nouvelle implantation, il y a 5 jours), mais l’adéquation à l’ICP et/ou le signal doivent encore être vérifiés avant toute prise de contact.');
 assert.ok(o.explanation.unknown.some(s=>/Adéquation à l’ICP inconnue/.test(s.text)),'UNKNOWN is said as unknown, not as low');
});

test('CASE 2 — FIT UNKNOWN + fresh INFERRED signal (search snippet, unreviewed) → WATCH; a VERIFIED one with unknown FIT is still not CONTACT',()=>{
 const o=run({signals:[opening({confidence:0.6,source_type:'search_snippet'})]});
 assert.equal(o.recommended_action,'WATCH');assert.equal((o.primary as any).evidence_status,'INFERRED');
 const v=run({signals:[sdr()]});
 assert.equal(v.recommended_action,'WATCH');assert.equal(v.rule,'UNKNOWN_FIT_FRESH_SIGNAL');
});

test('CASE 3 — FIT UNKNOWN + no signal → DISMISS, with the honest sentence',()=>{
 const o=run({});
 assert.equal(o.recommended_action,'DISMISS');assert.equal(o.rule,'NOT_ENOUGH');
 assert.equal(action(o),'Les informations disponibles sont insuffisantes pour recommander une action.');
});

test('CASE 4 — high FIT + no timing → WAIT, "corresponds but nothing recent"',()=>{
 const o=run({criteria:crit(90),evidence:[ev()]});
 assert.equal(o.recommended_action,'WAIT');
 assert.equal(action(o),'Le compte correspond à l’ICP (FIT 90/100), mais aucun élément récent ne justifie une prise de contact maintenant.');
});

// v1.3: a low FIT is shown by unfavourable evidence (the other criterion verified FALSE) — a missing criterion is
// INCOMPLETE, not low (tests/next-best-action-v13.test.ts).
const against=():Evidence=>({...ev(false),criterion:'other'});
test('CASE 5 — low verified FIT + strong fresh signal → never CONTACT; the sentence says the signal exists and the fit is insufficient',()=>{
 const low=run({criteria:crit(40),evidence:[ev(),against()],signals:[sdr()]});
 assert.notEqual(low.recommended_action,'CONTACT');assert.equal(low.rule,'NOT_ENOUGH');
 assert.match(action(low),/^Un signal récent existe \(Recrutement SDR, il y a 2 jours\), mais des éléments vérifiés indiquent que le compte ne correspond pas suffisamment à la cible \(défavorable : Autre critère ; FIT 40\/100/);
 const off=run({criteria:crit(20),evidence:[ev(),against()],signals:[sdr()]});
 assert.equal(off.rule,'OFF_TARGET');assert.match(action(off),/^Un signal récent existe .* ne correspond pas suffisamment à la cible \(défavorable : Autre critère ; FIT 20\/100/);
});

test('CASE 6 — high FIT + fresh VERIFIED explicit signal → CONTACT, unchanged',()=>{
 const o=run({criteria:crit(82),evidence:[ev()],signals:[sdr()]});
 assert.equal(o.recommended_action,'CONTACT');assert.equal(o.rule,'EXPLICIT_RECENT_NEED');
});

test('CASE 7 — expired signal → never CONTACT; WHY_THIS_ACTION names it and says it is too old',()=>{
 const high=run({criteria:crit(90),evidence:[ev()],signals:[sdr({published_at:daysAgo(120)})]});
 assert.equal(high.recommended_action,'WAIT');
 assert.match(action(high),/Le signal le plus récent \(Recrutement SDR, il y a 120 jours\) est trop ancien pour compter : sa durée de vie est de 60 jours\./);
 const unknownFit=run({signals:[opening({published_at:daysAgo(200)})]});
 assert.equal(unknownFit.recommended_action,'DISMISS');
 assert.match(action(unknownFit),/^Adéquation à l’ICP inconnue\. Le signal le plus récent \(Nouvelle implantation, il y a 200 jours\) est trop ancien pour compter/);
});

test('CASE 8 — whenever a counting signal exists, WHY_THIS_ACTION never says there is none',()=>{
 const fits:[number|null,boolean][]=[[null,false],[20,true],[40,true],[55,true],[70,true],[95,true]];
 for(const [fit,withEv] of fits)for(const age of [0,3,10,20,40])for(const sig of [opening({published_at:daysAgo(age)}),sdr({published_at:daysAgo(age)}),sdr({status:'PENDING_REVIEW',published_at:daysAgo(age)})]){
  const o=run({criteria:crit(fit??80),evidence:withEv?[ev()]:[],signals:[sig]});
  if(o.scores.timing.score>0)assert.doesNotMatch(action(o),NO_RECENT,`${fit} ${age} ${sig.signal_type} ${sig.status}: ${action(o)}`);
 }
});

test('CASE 9 — ICP Toulouse / Occitanie, signal in Vannes → MISMATCH: adds no TIMING, said with its proof; unknown FIT is not WATCH on it',()=>{
 const criteria=crit(90,['Toulouse','Occitanie']);
 const s=opening({},VANNES);
 assert.equal(geoRelevance(s,icpZoneOf(criteria)).relevance,'MISMATCH');
 const o=run({criteria,evidence:[ev()],signals:[s]});
 assert.equal(o.scores.timing.score,0);assert.equal(o.recommended_action,'WAIT');
 assert.match(action(o),/aucun élément récent dans Toulouse, Occitanie .*concerne Vannes, hors de Toulouse, Occitanie : il ne compte pas pour cet ICP\./);
 assert.ok(o.explanation.why_now.some(w=>/concerne Vannes, hors de Toulouse, Occitanie/.test(w.text)&&w.refs[0]?.id===s.id));
 const u=run({criteria:crit(90,['Toulouse','Occitanie']),signals:[opening({},VANNES)]});
 assert.equal(u.recommended_action,'DISMISS','an unknown FIT with an off-zone signal is not worth a check for this ICP');
 assert.match(action(u),/hors de Toulouse, Occitanie/);
});

test('CASE 10 — ICP Toulouse / Occitanie, signal in Toulouse → MATCH: counts normally, the place is stated',()=>{
 const criteria=crit(90,['Toulouse','Occitanie']);
 const s=opening({},TOULOUSE);
 assert.equal(geoRelevance(s,icpZoneOf(criteria)).relevance,'MATCH');
 const o=run({criteria,evidence:[ev()],signals:[s]});
 assert.ok(o.scores.timing.score>0);assert.equal((o.primary as any).geo_relevance,'MATCH');
 assert.ok(o.explanation.why_now.some(w=>w.text==='Lieu du signal : Toulouse, dans Toulouse, Occitanie.'));
 const unknownFit=run({criteria:crit(90,['Toulouse','Occitanie']),signals:[opening({},TOULOUSE)]});
 assert.equal(unknownFit.recommended_action,'WATCH');
});

test('GEO — structured only: scope precision, no zone, no structured place, never a text match (generic model: tests/geo-model.test.ts)',()=>{
 const z=(l:string[])=>icpZoneOf(crit(90,l));
 assert.equal(geoRelevance(opening({},MONTPELLIER),z(['Toulouse','Occitanie'])).relevance,'MATCH','Occitanie is in the scope');
 // A known place outside the scope is MISMATCH (Montpellier is not Toulouse) …
 assert.deepEqual(geoRelevance(opening({},MONTPELLIER),z(['Toulouse'])),{relevance:'MISMATCH',place:'Montpellier',reason:'outside_scope'});
 assert.equal(geoRelevance(opening({},VANNES),z(['Toulouse'])).relevance,'MISMATCH');
 // … but a place known only down to its department, against a town scope, is not precise enough: UNKNOWN.
 assert.deepEqual(geoRelevance(opening({},{text:'Blagnac',departments:['31'],regions:['Occitanie']}),z(['Toulouse'])),{relevance:'UNKNOWN',place:'Blagnac',reason:'insufficient_precision'});
 assert.equal(geoRelevance(opening({},{text:'Blagnac',departments:['31'],regions:['Occitanie']}),z(['Haute-Garonne'])).relevance,'MATCH');
 assert.deepEqual(geoRelevance(opening({},VANNES),null),{relevance:'UNKNOWN',place:'Vannes',reason:'scope_undefined'});
 assert.equal(icpZoneOf(crit(90)),null,'an ICP without locations has no zone');
 // A place written as text only (no structure) is never compared by its words.
 assert.deepEqual(geoRelevance(opening({},{text:'Toulouse'}),z(['Toulouse'])),{relevance:'UNKNOWN',place:'Toulouse',reason:'place_unknown'});
 assert.equal(geoRelevance(opening(),z(['Toulouse'])).reason,'place_unknown');
 // A prefecture is known; a smaller commune typed in the ICP is not (no zone, its signals stay UNKNOWN).
 assert.ok(z(['Carcassonne']));assert.equal(z(['Castelnaudary']),null);
 // UNKNOWN never removes timing (unchanged behaviour), MISMATCH does.
 assert.ok(run({criteria:crit(90),evidence:[ev()],signals:[opening({},VANNES)]}).scores.timing.score>0);
});

test('UNCHANGED — weights, FIT thresholds, half-lives, CONTACT and ENGAGE rules',()=>{
 assert.deepEqual(NBA_DEFAULT_CONFIG.weights,{fit:0.35,timing:0.30,intent:0.15,evidence_quality:0.10,freshness:0.10});
 assert.deepEqual(NBA_DEFAULT_CONFIG.fit,{contactMin:60,engageMin:50,watchMin:50,dismissBelow:30});
 assert.deepEqual(NBA_DEFAULT_CONFIG.freshness,{explicitNeedMin:0.7,contactMin:0.5,inferredWatchMin:0.5});
});
