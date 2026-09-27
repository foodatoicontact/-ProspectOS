// Beta feedback hotfix — human review of proofs. (1) "J'ai vérifié la source : valider" could be clicked again
// and again: each click inserted one more VERIFIED copy and one more history line. (2) Some review buttons
// "did nothing": before the observations of the prospect were loaded, analysis evidence looked manual and
// showed a button the server-side check refuses. Interface guards only: no request, no database, no scoring
// rule is changed here — a proof is still VERIFIED only after an explicit human click.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hasVerifiedCopy,sameProof,reviewSummaryReady,createInFlight,reviewChangesState} from '../src/components/evidence-verification.ts';
import {presentObservations,isReviewable} from '../src/components/evidence-presentation.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import type {StoredObservation} from '../src/discovery/types.ts';

const review=await readFile(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');

const ICP:Criterion[]=[{key:'lieu',label:'Lieu physique',weight:25},{key:'cours',label:'Cours / séances',weight:25},{key:'planning',label:'Planning',weight:20},{key:'contact',label:'Contact',weight:15},{key:'discipline',label:'Discipline cible',weight:15}];
const NOW=new Date('2026-09-27T10:00:00Z');
const ev=(id:string,extra:Partial<Evidence>={}):Evidence=>({id,criterion:'lieu',value:true,status:'NOT_VERIFIED',source_url:'https://site.example/',excerpt:'Trois terrains couverts',observed_at:'2026-09-26T10:00:00Z',verified_by:null,...extra});
const row=(id:string,criterion:string|null,extra:Partial<StoredObservation>={}):StoredObservation=>({id,prospect_id:'p',organization_id:'o',evidence_id:criterion?`ev-${id}`:null,review_status:'NOT_VERIFIED',criterion,observation_type:criterion?`ICP_SIGNAL:${criterion}`:'GENERIC_KEYWORD_MATCH',claim:'Le site indique quelque chose. Proposition à confirmer par un humain.',value:criterion?true:null,status:'INFERRED',source_url:'https://site.example/',source_title:'Site',source_excerpt:`Extrait ${id}`,source_type:'official_website',confidence:.55,collected_at:'2026-09-26T10:00:00Z',expires_at:'2026-12-26T10:00:00Z',content_hash:id,...extra});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}};

// ---------------------------------------------------------------- A, B: one click = one request
test('A — one click on a review button sends exactly one request',async()=>{
 const guard=createInFlight();let calls=0;
 assert.equal(await guard.run('obs-1',async()=>{calls++}),true);
 assert.equal(calls,1);
});
test('B — rapid clicks on the same proof send a single request while the first is pending',async()=>{
 const guard=createInFlight();let calls=0;const pending=deferred();
 const first=guard.run('obs-1',async()=>{calls++;await pending.promise});
 const second=guard.run('obs-1',async()=>{calls++});
 const third=guard.run('obs-1',async()=>{calls++});
 assert.equal(guard.has('obs-1'),true);
 assert.equal(await second,false);assert.equal(await third,false);
 pending.resolve();assert.equal(await first,true);
 assert.equal(calls,1,'no duplicate mutation');
 assert.equal(await guard.run('obs-2',async()=>{calls++}),true,'another proof is not blocked');
 assert.equal(calls,2);
});
test('A/B wiring — both review handlers go through the per-proof guard',()=>{
 assert.match(review,/reviewing\.current\.run\(row\.id,\(\)=>execute\(/,'Confirmer / Contredire / Laisser non vérifié');
 assert.match(page,/verifying\.current\.run\(e\.id,\(\)=>work\(/,'J’ai vérifié la source : valider');
});

// ---------------------------------------------------------------- C, D: confirmed stays confirmed, no re-confirmation
test('C — after a manual verification the proof shows as verified and its button is gone (also after a reload)',()=>{
 const original=ev('e1');
 const copy=ev('e2',{status:'VERIFIED',verified_by:'user-1'}); // what POST /evidence returns and what a reload reads back
 assert.equal(sameProof(original,copy),true);
 assert.equal(hasVerifiedCopy(original,[original]),false,'before: the button is offered');
 assert.equal(hasVerifiedCopy(original,[original,copy]),true,'after: the original is superseded');
 assert.equal(hasVerifiedCopy(copy,[original,copy]),false,'the verified copy itself stays listed as verified');
 assert.match(page,/&&!hasVerifiedCopy\(e,current\.evidence\)\):\[\];/,'the superseded original leaves the manual list');
});
test('C — after "Confirmer" the analysis proof reads Vérifié',()=>{
 const g=presentObservations([row('o1','lieu',{review_status:'VERIFIED'})],ICP,'fr').groups[0];
 assert.equal(g.tone,'verified');assert.equal(g.statusLabel,'Vérifié');
});
test('D — an already confirmed proof cannot be confirmed again',()=>{
 assert.equal(reviewChangesState({review_status:'VERIFIED'},'confirm'),false);
 assert.equal(reviewChangesState({review_status:'NOT_VERIFIED'},'confirm'),true);
 assert.equal(reviewChangesState({review_status:'CONTRADICTED'},'contradict'),false);
 assert.equal(reviewChangesState({review_status:'NOT_VERIFIED'},'unverify'),false);
 assert.equal(reviewChangesState({review_status:'VERIFIED'},'unverify'),true,'a human can still undo');
 assert.match(review,/if\(!reviewChangesState\(row,decision\)\)return;/);
 assert.match(page,/if\(!current\|\|hasVerifiedCopy\(e,current\.evidence\)\)return;/);
 const other=ev('e3',{excerpt:'Un autre extrait'});
 assert.equal(hasVerifiedCopy(other,[other,ev('e2',{status:'VERIFIED',verified_by:'u'})]),false,'a different proof is never hidden');
 assert.equal(hasVerifiedCopy(ev('e4',{value:false}),[ev('e2',{status:'VERIFIED',verified_by:'u'})]),false,'a different value is a different proof');
});

// ---------------------------------------------------------------- E: a failure never locks the button
test('E — a failed request releases the proof: the user can retry',async()=>{
 const guard=createInFlight();let calls=0;
 await assert.rejects(guard.run('obs-1',async()=>{calls++;throw Error('HTTP 500')}));
 assert.equal(guard.has('obs-1'),false);
 assert.equal(await guard.run('obs-1',async()=>{calls++}),true);
 assert.equal(calls,2);
});

// ---------------------------------------------------------------- F: buttons only where the server accepts the click
test('F — OBSERVED and INFERRED proposals keep their review actions; UNKNOWN never gets one',()=>{
 const rows=[row('obs','lieu',{status:'OBSERVED'}),row('inf','cours',{status:'INFERRED'}),row('unk','planning',{status:'UNKNOWN',value:null})];
 const view=presentObservations(rows,ICP,'fr');
 assert.deepEqual(view.groups.map(g=>g.criterion.key),['lieu','cours']);
 for(const g of view.groups)for(const c of g.cards)assert.equal(isReviewable(c.row,ICP),true,'every card with a Confirmer button is one the RPC accepts');
 assert.equal(isReviewable(row('noev','lieu',{evidence_id:null}),ICP),false);
 assert.equal(isReviewable(row('empty','lieu',{source_excerpt:'  '}),ICP),false);
});
test('F — the manual list waits for the observations of THIS prospect (no dead "valider" button)',()=>{
 const empty={criteria:{},linkedEvidenceIds:[],contextEvidenceIds:[]};
 assert.equal(reviewSummaryReady(empty,'p1'),false,'initial page state');
 assert.equal(reviewSummaryReady({...empty,ready:false,prospectId:'p1'},'p1'),false,'observations still loading');
 assert.equal(reviewSummaryReady({...empty,ready:true,prospectId:'p0'},'p1'),false,'summary of the previous prospect');
 assert.equal(reviewSummaryReady({...empty,ready:true,prospectId:'p1'},'p1'),true);
 assert.match(page,/const manual=reviewSummaryReady\(reviewSummary,current\.id\)\?/);
 assert.match(review,/const summaryKey=JSON\.stringify\(\{\.\.\.view\.summary,ready:loaded,prospectId:prospect\.id\}\);/);
 assert.match(review,/setRows\(data\);setLoaded\(true\)/,'ready once loaded');
 assert.match(review,/setError\(tr\('evidence\.unavailable'\)\);setLoaded\(true\)/,'a failed read keeps the previous behaviour');
});

// ---------------------------------------------------------------- G, H: scoring unchanged
test('G — a verified proof still adds its criterion weight, once, however many copies exist',()=>{
 const verified=ev('e2',{status:'VERIFIED',verified_by:'user-1'});
 assert.equal(scoreProspect(ICP,[ev('e1'),verified],NOW).score,25);
 assert.equal(scoreProspect(ICP,[ev('e1'),verified,ev('e3',{status:'VERIFIED',verified_by:'user-1'})],NOW).score,25,'duplicates never inflate the score');
});
test('H — an unconfirmed proof still counts for nothing',()=>{
 assert.equal(scoreProspect(ICP,[ev('e1')],NOW).score,0);
 assert.equal(scoreProspect(ICP,[ev('e1',{status:'INFERRED_UNCONFIRMED'})],NOW).score,0);
 assert.equal(scoreProspect(ICP,[ev('e1',{status:'VERIFIED',verified_by:null})],NOW).score,0,'VERIFIED without a human is still ignored');
});

// ---------------------------------------------------------------- onboarding: text only, shown only when empty
test('Onboarding — the empty prospect list shows three first steps, nothing is stored',()=>{
 assert.match(page,/\{project&&<div className="empty-steps">.*prospects\.emptyStep1.*prospects\.emptyStep2.*prospects\.emptyStep3/);
 const block=page.slice(page.indexOf('className="empty-steps"'),page.indexOf('className="empty-steps"')+400);
 assert.doesNotMatch(block,/localStorage|api\(/);
});
