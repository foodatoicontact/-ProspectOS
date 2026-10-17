// Next Best Action V1 — the engine (src/nba/engine.ts), its content (src/nba/content.ts) and its routes' flag and
// validation (src/nba/api.ts). Pure: fictitious companies and .example domains, `now` fixed, no network, no database.
// The database side (031: RLS, tenants, transitions, immutability) is tests/next-best-action-db.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {buildOpportunity,classifySignal,todayOf,byPriority,canTransition,validateConfig,freshnessOf,NBA_DEFAULT_CONFIG,TRANSITIONS,RULES,
 type NbaInput,type NbaSignal,type NbaPublicContent,type Opportunity} from '../src/nba/engine.ts';
import {prepareContent,NBA_FORBIDDEN,NBA_FLATTERY} from '../src/nba/content.ts';
import {REGISTRY,COMMERCIAL_SIGNAL_TYPES,CONVERSATION_TOPICS,fold} from '../src/nba/registry.ts';
import {handleNextBestActions,nextBestActionEnabled,isNbaPath} from '../src/nba/api.ts';
import type {Criterion,Evidence} from '../src/domain/core.ts';

const NOW=new Date('2026-10-17T12:00:00Z');
const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
// A FIT of exactly `fit`: one criterion of that weight, verified TRUE; the rest unknown.
const criteriaFor=(fit:number):Criterion[]=>fit>=100?[{key:'icp',label:'Correspond à la cible définie',weight:100}]:[{key:'icp',label:'Correspond à la cible définie',weight:fit},{key:'other',label:'Autre critère',weight:100-fit}];
const verifiedEvidence=(id='e1'):Evidence=>({id,criterion:'icp',value:true,status:'VERIFIED',source_url:'https://acme.example/a-propos',excerpt:'Éditeur SaaS B2B pour les équipes commerciales.',observed_at:daysAgo(5),verified_by:'u1'});
let n=0;
const signal=(o:Partial<NbaSignal>={}):NbaSignal=>({id:`s${++n}`,signal_type:'hiring_role',status:'VERIFIED',title:'ACME recrute un SDR',
 excerpt:'Nous recrutons notre premier SDR pour construire le pipeline outbound.',source_url:`https://jobs.example/acme/sdr-${n}`,source_domain:'jobs.example',
 source_type:'job_board',confidence:0.8,event_date:null,published_at:daysAgo(2),observed_at:daysAgo(2),matched_terms:[],provider:'web_search',...o});
const post=(o:Partial<NbaPublicContent>={}):NbaPublicContent=>({id:`c${++n}`,status:'VERIFIED',source_url:'https://social.example/claire/post-1',source_domain:'social.example',
 author:'Claire Martin',content:'200 appels cette semaine pour 3 rendez-vous. Il faut revoir notre façon de prospecter.',published_at:daysAgo(1),observed_at:daysAgo(1),...o});
const input=(fit:number,o:Partial<NbaInput>={}):NbaInput=>({prospect:{id:`p${++n}`,project_id:'proj',name:'ACME',status:'À analyser'},criteria:criteriaFor(fit),
 evidence:[verifiedEvidence()],signals:[],publicContent:[],profile:null,now:NOW,...o});

// ------------------------------------------------------------
// The four reference companies
// ------------------------------------------------------------
test('scenario A–D: a good ICP is not a reason to contact; a fresh explicit need is; a conversation is engaged; an old signal waits',()=>{
 const A=buildOpportunity(input(95));
 assert.equal(A.scores.fit.score,95);assert.equal(A.scores.timing.score,0);
 assert.equal(A.recommended_action,'WAIT');assert.equal(A.rule,'FIT_WITHOUT_TIMING');

 const B=buildOpportunity(input(82,{signals:[signal()]}));
 assert.equal(B.recommended_action,'CONTACT');assert.equal(B.rule,'EXPLICIT_RECENT_NEED');
 assert.equal(B.primary?.kind,'signal');assert.equal((B.primary as any).commercial_type,'HIRING_SDR');
 assert.ok(B.scores.timing.score>=80&&B.scores.freshness.score>=85,JSON.stringify(B.scores.timing));

 const C=buildOpportunity(input(85,{publicContent:[post()]}));
 assert.equal(C.recommended_action,'ENGAGE');assert.equal(C.rule,'RELEVANT_CONVERSATION');
 assert.equal(C.target.person?.name,'Claire Martin');assert.equal(C.target.person?.basis,'public_content_author');
 assert.match((C.primary as any).suggested_angle,/volume d’appels et qualité du ciblage/);

 const D=buildOpportunity(input(90,{signals:[signal({published_at:daysAgo(182),observed_at:daysAgo(182)})]}));
 assert.equal(D.scores.timing.score,0);assert.equal(D.recommended_action,'WAIT');
 // The stale signal is named, with its proof, and why it no longer counts — never hidden behind "no signal".
 assert.match(D.explanation.why_now[0]!.text,/^Le signal le plus récent \(Recrutement SDR, il y a 182 jours\) ne compte plus : sa durée de vie est de 60 jours\.$/);
 assert.equal(D.explanation.why_now[0]!.refs[0]!.kind,'signal');
 // A 6-month-old funding (longer life) still waits: some timing, under the WATCH threshold.
 const D2=buildOpportunity(input(90,{signals:[signal({signal_type:'funding',title:'ACME lève 5 M€',excerpt:'ACME annonce une levée de 5 M€.',published_at:daysAgo(182),observed_at:daysAgo(182)})]}));
 assert.ok(D2.scores.timing.score>0&&D2.scores.timing.score<NBA_DEFAULT_CONFIG.timing.watchMin,String(D2.scores.timing.score));
 assert.equal(D2.recommended_action,'WAIT');
 // Same inputs, same answer.
 const same=signal({id:'sX',published_at:daysAgo(182)});const pX={id:'pX',project_id:'proj',name:'ACME',status:'À analyser'};
 assert.deepEqual(buildOpportunity(input(90,{prospect:pX,signals:[same]})),buildOpportunity(input(90,{prospect:pX,signals:[{...same}]})));
});

// ------------------------------------------------------------
// Freshness, staleness, expiration
// ------------------------------------------------------------
test('freshness: deterministic decay per type — a fresh hiring counts, a stale one does not, a funding lives longer',()=>{
 assert.equal(freshnessOf(0,{halfLifeDays:14,maxAgeDays:60}),1);
 assert.equal(freshnessOf(14,{halfLifeDays:14,maxAgeDays:60}),0.5);
 assert.equal(freshnessOf(61,{halfLifeDays:14,maxAgeDays:60}),0);
 const fresh=classifySignal(signal({excerpt:'Nous recrutons un SDR.',published_at:daysAgo(1)}),NOW)!;
 const stale=classifySignal(signal({excerpt:'Nous recrutons un SDR.',published_at:daysAgo(70)}),NOW)!;
 assert.equal(fresh.commercial_type,'HIRING_SDR');assert.ok(fresh.freshness>0.9);
 assert.equal(stale.freshness,0);assert.equal(stale.timing,0);
 const funding=classifySignal(signal({signal_type:'funding',title:'Levée',excerpt:'ACME lève 3 M€.',published_at:daysAgo(70)}),NOW)!;
 assert.ok(funding.freshness>0.4,'a funding round keeps value for months');
 // Every registry decay is explicit or the Intent Engine's own, and positive.
 for(const e of REGISTRY)if(e.decay)assert.ok(e.decay.halfLifeDays>0&&e.decay.maxAgeDays>e.decay.halfLifeDays,e.type);
});

test('expiration: an action expires when its reason stops counting; without a dated reason, after the default horizon',()=>{
 const B=buildOpportunity(input(82,{signals:[signal({excerpt:'Nous recrutons un SDR.',published_at:daysAgo(10)})]}));
 // HIRING_SDR max age 60 days: 50 days left.
 assert.equal(B.expires_at,new Date(NOW.getTime()+50*86400000).toISOString());
 const A=buildOpportunity(input(95));
 assert.equal(A.expires_at,new Date(NOW.getTime()+NBA_DEFAULT_CONFIG.defaultHorizonDays*86400000).toISOString());
 const C=buildOpportunity(input(85,{publicContent:[post({published_at:daysAgo(3)})]}));
 assert.equal(C.expires_at,new Date(NOW.getTime()+(NBA_DEFAULT_CONFIG.engage.maxAgeDays-3)*86400000).toISOString());
});

// ------------------------------------------------------------
// Evidence: VERIFIED / INFERRED / UNKNOWN
// ------------------------------------------------------------
test('evidence first: an unreviewed signal never triggers CONTACT (WATCH, to verify); a rejected one is ignored; unknown FIT says so',()=>{
 const inferred=buildOpportunity(input(85,{signals:[signal({status:'PENDING_REVIEW'})]}));
 assert.equal(inferred.recommended_action,'WATCH');assert.equal(inferred.rule,'SIGNAL_TO_VERIFY');
 assert.equal((inferred.primary as any).evidence_status,'INFERRED');
 assert.equal(inferred.explanation.why_now[0]!.kind,'inference');assert.match(inferred.explanation.why_now[0]!.text,/à vérifier/);
 const rejected=buildOpportunity(input(85,{signals:[signal({status:'REJECTED'})]}));
 assert.equal(rejected.scores.timing.score,0);assert.deepEqual(rejected.signal_ids,[]);assert.equal(rejected.recommended_action,'WAIT');
 const unknown=buildOpportunity(input(85,{evidence:[]}));
 assert.equal(unknown.scores.fit.basis,'unknown');assert.equal(unknown.scores.fit.score,null);
 assert.equal(unknown.recommended_action,'DISMISS');assert.equal(unknown.rule,'NOT_ENOUGH');
 assert.ok(unknown.explanation.unknown.some(s=>/ICP inconnue/.test(s.text)));
});

test('weak evidence: a search snippet weighs less than a job board; the evidence quality score says so',()=>{
 const strong=buildOpportunity(input(82,{signals:[signal()]}));
 const weak=buildOpportunity(input(82,{signals:[signal({source_type:'search_snippet',confidence:0.6})]}));
 assert.ok(weak.scores.evidence_quality.score<strong.scores.evidence_quality.score);
 const unreviewed=buildOpportunity(input(82,{signals:[signal({status:'PENDING_REVIEW'})]}));
 assert.ok(unreviewed.scores.evidence_quality.score<strong.scores.evidence_quality.score);
 // Estimated FIT (unverified evidence) is labelled as an inference, never as a fact.
 const est=buildOpportunity(input(82,{evidence:[{...verifiedEvidence(),status:'NOT_VERIFIED',verified_by:null}]}));
 assert.equal(est.scores.fit.basis,'estimated');assert.equal(est.explanation.why_this_account[0]!.kind,'inference');
});

// ------------------------------------------------------------
// Several signals, duplicates
// ------------------------------------------------------------
test('duplicates: two signals of the same type count once (the best); different types add with diminishing returns',()=>{
 const one=buildOpportunity(input(82,{signals:[signal({excerpt:'Nous recrutons un SDR.'})]}));
 const dup=buildOpportunity(input(82,{signals:[signal({excerpt:'Nous recrutons un SDR.'}),signal({excerpt:'Nous recrutons un SDR (2e annonce).',published_at:daysAgo(3)})]}));
 assert.equal(dup.scores.timing.score,one.scores.timing.score,'a duplicate adds nothing');
 assert.equal(dup.scores.timing.lines.length,1);
 const multi=buildOpportunity(input(82,{signals:[signal({excerpt:'Nous recrutons un SDR.'}),signal({signal_type:'funding',title:'Levée',excerpt:'ACME lève 3 M€.',published_at:daysAgo(5)})]}));
 assert.equal(multi.scores.timing.lines.length,2);
 assert.match(multi.scores.timing.lines[1]!.label,/× 0.5$/);
 assert.ok(multi.scores.timing.score>one.scores.timing.score);
 assert.ok(multi.scores.timing.score<=100);
});

// ------------------------------------------------------------
// Explanation and target
// ------------------------------------------------------------
test('why now: every fact carries the proof to open; the opportunity score shows its components; no person is invented',()=>{
 const s=signal();const B=buildOpportunity(input(82,{signals:[s]}));
 const why=B.explanation.why_now[0]!;
 assert.equal(why.kind,'fact');assert.deepEqual(why.refs,[{kind:'signal',id:s.id,source_url:s.source_url}]);
 assert.ok(why.text.includes(s.excerpt.replace(/[.!?]+$/,'')),'the excerpt is quoted verbatim');
 assert.match(why.text,/jobs\.example, publié il y a 2 jours/);
 assert.deepEqual(B.explanation.why_this_account[0]!.refs,[{kind:'evidence',id:'e1',source_url:'https://acme.example/a-propos'}]);
 assert.equal(B.explanation.why_this_action[0]!.kind,'rule');
 // Components, never only the total.
 const parts=B.scores.opportunity.lines.map(l=>l.label.split(' ')[0]);
 assert.deepEqual(parts,['FIT','TIMING','INTENT','EVIDENCE_QUALITY','FRESHNESS']);
 assert.equal(Math.round(B.scores.opportunity.lines.reduce((a,l)=>a+l.value,0)),B.scores.opportunity.score);
 // Target: a role from the registry (inference), no person.
 assert.equal(B.target.role,'Head of Sales');assert.equal(B.target.person,null);
 assert.ok(B.explanation.inferred.some(s=>/Rôle cible recommandé : Head of Sales/.test(s.text)));
 assert.ok(B.explanation.unknown.some(s=>/Personne cible inconnue/.test(s.text)));
 // A date the source does not give is said to be unknown.
 const undated=buildOpportunity(input(82,{signals:[signal({published_at:null,event_date:null,observed_at:daysAgo(1)})]}));
 assert.ok(undated.explanation.unknown.some(s=>/Date du fait inconnue/.test(s.text)));
});

test('rules: closed prospects and off-target accounts are dismissed; OPPORTUNITY never decides alone',()=>{
 assert.equal(buildOpportunity(input(95,{prospect:{id:'pc',project_id:'proj',name:'ACME',status:'Perdu'},signals:[signal()]})).rule,'CLOSED_PROSPECT');
 assert.equal(buildOpportunity(input(20,{signals:[signal()]})).rule,'OFF_TARGET');
 // A high opportunity from FIT + INTENT alone (old signals) is still WAIT without TIMING.
 const old=buildOpportunity(input(100,{signals:[signal({signal_type:'funding',title:'Levée',excerpt:'Levée.',published_at:daysAgo(400)})]}));
 assert.equal(old.recommended_action,'WAIT');
 // Each rule is one entry of a table, the last one always applies.
 assert.equal(RULES.at(-1)!.id,'NOT_ENOUGH');assert.equal(new Set(RULES.map(r=>r.id)).size,RULES.length);
});

test('conversation: only a VERIFIED, dated, relevant and recent public content; an explicit fresh need beats it',()=>{
 assert.notEqual(buildOpportunity(input(85,{publicContent:[post({status:'PENDING_REVIEW'})]})).recommended_action,'ENGAGE');
 assert.notEqual(buildOpportunity(input(85,{publicContent:[post({published_at:null})]})).recommended_action,'ENGAGE');
 assert.notEqual(buildOpportunity(input(85,{publicContent:[post({content:'Belle journée au bord du lac avec l’équipe.'})]})).recommended_action,'ENGAGE');
 assert.notEqual(buildOpportunity(input(85,{publicContent:[post({published_at:daysAgo(10)})]})).recommended_action,'ENGAGE');
 // The project's own intent terms make a post relevant too.
 assert.equal(buildOpportunity(input(85,{profile:{types:{},terms:['caisse enregistreuse']},publicContent:[post({content:'Nous changeons de caisse enregistreuse ce trimestre.'})]})).recommended_action,'ENGAGE');
 // A fresh, verified, explicit need wins over the conversation.
 assert.equal(buildOpportunity(input(85,{signals:[signal()],publicContent:[post()]})).recommended_action,'CONTACT');
});

// ------------------------------------------------------------
// Queue, Today, states
// ------------------------------------------------------------
test('today: only pending CONTACT / ENGAGE / WATCH, actionable first, capped — never 500 leads',()=>{
 const items=[
  {prospect_id:'a',recommended_action:'WAIT' as const,opportunity_score:90,timing_score:0,freshness_score:0},
  {prospect_id:'b',recommended_action:'WATCH' as const,opportunity_score:70,timing_score:30,freshness_score:40},
  {prospect_id:'c',recommended_action:'CONTACT' as const,opportunity_score:60,timing_score:80,freshness_score:90},
  {prospect_id:'d',recommended_action:'ENGAGE' as const,opportunity_score:65,timing_score:60,freshness_score:80},
  {prospect_id:'e',recommended_action:'CONTACT' as const,opportunity_score:75,timing_score:85,freshness_score:90,state:'SNOOZED' as const},
  ...Array.from({length:30},(_,i)=>({prospect_id:`w${i}`,recommended_action:'WATCH' as const,opportunity_score:40,timing_score:20,freshness_score:20})),
 ];
 const today=todayOf(items,10);
 assert.equal(today.length,10);assert.deepEqual(today.slice(0,3).map(i=>i.prospect_id),['c','d','b']);
 assert.ok(!today.some(i=>i.recommended_action==='WAIT'||i.prospect_id==='e'));
 assert.equal(todayOf(items,999).length,NBA_DEFAULT_CONFIG.today.maxLimit>=34?33:NBA_DEFAULT_CONFIG.today.maxLimit);
 assert.ok([...items].sort(byPriority)[0]!.recommended_action==='CONTACT');
});

test('states: snooze, reject, done, expiry — the transition table (the database enforces the same)',()=>{
 assert.ok(canTransition('PENDING','SNOOZED')&&canTransition('SNOOZED','PENDING')&&canTransition('PENDING','REJECTED')&&canTransition('APPROVED','DONE'));
 for(const terminal of ['DONE','REJECTED','EXPIRED'] as const)assert.deepEqual(TRANSITIONS[terminal],[]);
 assert.ok(!canTransition('DONE','PENDING')&&!canTransition('REJECTED','APPROVED')&&!canTransition('SNOOZED','DONE'));
});

test('config: weights sum to 1, thresholds ordered; a broken config is refused',()=>{
 validateConfig(NBA_DEFAULT_CONFIG);
 assert.throws(()=>validateConfig({...NBA_DEFAULT_CONFIG,weights:{...NBA_DEFAULT_CONFIG.weights,fit:0.9}}),/NBA_CONFIG_WEIGHTS/);
 assert.throws(()=>validateConfig({...NBA_DEFAULT_CONFIG,fit:{...NBA_DEFAULT_CONFIG.fit,dismissBelow:80}}),/NBA_CONFIG_FIT/);
 assert.equal(new Set(REGISTRY.map(e=>e.type)).size,REGISTRY.length);
 assert.deepEqual([...REGISTRY.map(e=>e.type)].sort(),[...COMMERCIAL_SIGNAL_TYPES].sort());
});

// ------------------------------------------------------------
// Prepared content
// ------------------------------------------------------------
const prep=(o:Opportunity,extra:Partial<Parameters<typeof prepareContent>[0]>={})=>prepareContent({opportunity:o,name:'ACME',offer:'Nous aidons les équipes commerciales à choisir quels comptes contacter chaque semaine.',
 criteria:criteriaFor(82),evidence:[verifiedEvidence()],signals:[],publicContent:[],profile:null,now:NOW,...extra});
test('content: CONTACT draft quotes the verified signal verbatim; ENGAGE proposes an angle, a comment without flattery and a DM; no free offer ever',()=>{
 const s=signal();const B=buildOpportunity(input(82,{signals:[s]}));
 const d=prep(B,{signals:[s]});
 assert.equal(d.kind,'contact_draft');
 assert.ok((d as any).text.includes('Nous recrutons notre premier SDR pour construire le pipeline outbound'));
 assert.deepEqual((d as any).signal_ids,[s.id]);
 const c=post();const C=buildOpportunity(input(85,{publicContent:[c]}));
 const e=prep(C,{publicContent:[c]}) as any;
 assert.equal(e.kind,'engage');assert.ok(e.suggested_comment&&e.suggested_dm_after_engagement);
 assert.match(e.suggested_dm_after_engagement,/^Bonjour Claire, je réagis à votre publication du 16 octobre sur le volume d’appels\./);
 for(const t of [e.suggested_comment,e.suggested_dm_after_engagement])assert.ok(!NBA_FLATTERY.test(fold(t))&&!NBA_FORBIDDEN.test(fold(t)),t);
 for(const t of CONVERSATION_TOPICS)assert.ok(!NBA_FLATTERY.test(fold(t.comment.fr))&&!NBA_FORBIDDEN.test(fold(t.comment.fr)),t.key);
 // An offer with a free trial is never drafted.
 assert.equal((prep(B,{signals:[s],offer:'Essai gratuit de 14 jours, sans engagement.'}) as any).reason,'FORBIDDEN_OFFER_OR_FAMILIARITY');
 assert.equal((prep(C,{publicContent:[c],offer:'Bêta gratuite pour les premiers clients.'}) as any).suggested_dm_after_engagement,null);
 // A company whose name is a flattery word is still drafted (names are not words).
 const bravo=prep(B,{signals:[s],name:'Bravo'});assert.equal(bravo.kind,'contact_draft',JSON.stringify(bravo));
 // But flattery written by the engine itself never passes.
 assert.ok(NBA_FLATTERY.test(fold('Bravo pour ce post inspirant')));
 // WAIT / WATCH / DISMISS: nothing to draft.
 assert.equal(prep(buildOpportunity(input(95))).kind,'none');
});

// ------------------------------------------------------------
// Flag, routes, no external execution
// ------------------------------------------------------------
const PROJ='00000000-0000-4000-8000-000000000001';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
test('feature flag: absent / false = every route 404, nothing read; on = validation before any write',async()=>{
 assert.equal(nextBestActionEnabled({}),false);assert.equal(nextBestActionEnabled({NEXT_BEST_ACTION_ENABLED:'false'}),false);
 assert.equal(nextBestActionEnabled({NEXT_BEST_ACTION_ENABLED:'true'}),true);assert.equal(nextBestActionEnabled({NEXT_BEST_ACTION_ENABLED:'1'}),true);
 assert.ok(isNbaPath(['projects',PROJ,'next-best-actions'])&&isNbaPath(['next-best-actions','x','decision'])&&!isNbaPath(['projects',PROJ,'signals']));
 let touched=0;const db=new Proxy({},{get(){touched++;throw Error('no database access expected')}}) as any;
 const off={enabled:false,now:()=>NOW,requireEntitlement:async()=>{throw Error('no')}};
 for(const [p,m] of [[['projects',PROJ,'next-best-actions'],'GET'],[['projects',PROJ,'next-best-actions','compute'],'POST'],[['next-best-actions',PROJ,'decision'],'POST']] as const){
  const r=await handleNextBestActions(new Request('https://x.example/api',{method:m}),[...p],{},db,json,off);assert.equal(r?.status,404);
 }
 assert.equal(touched,0);
 assert.equal(await handleNextBestActions(new Request('https://x.example/api'),['projects',PROJ,'signals'],{},db,json,off),null,'not an NBA path: next handler');
 const on={...off,enabled:true};
 for(const body of [{decision:'SEND'},{decision:'SNOOZED'},{decision:'DONE',extra:1},{decision:'DONE',human_action:'POST_ON_LINKEDIN'}]){
  const r=await handleNextBestActions(new Request('https://x.example/api',{method:'POST'}),['next-best-actions',PROJ,'decision'],body,db,json,on);assert.equal(r?.status,400,JSON.stringify(body));
 }
 const bad=await handleNextBestActions(new Request('https://x.example/api',{method:'POST'}),['next-best-actions',PROJ,'outcome'],{outcome:'CLOSED'},db,json,on);assert.equal(bad?.status,400);
 assert.equal(touched,0,'refused before any database access');
});

test('no external execution: the NBA modules never send, post, comment or message',async()=>{
 const dir=new URL('../src/nba/',import.meta.url);
 for(const f of await readdir(dir)){
  const code=(await readFile(new URL(f,dir),'utf8')).split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code,/nodemailer|smtp|imap|ionos|sendMail|linkedin\.com\/|\bfetch\(|https:\/\/api\./i,`${f}: no external channel`);
 }
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/enabled:nextBestActionEnabled\(process\.env\)/);
});
