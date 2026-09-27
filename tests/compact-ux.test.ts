// V2 P0-b — compact UX. Pure display helpers, the paged history read, and the wiring that keeps the pages
// short (summary first, detail on demand). Real rendering at 390 px is exercised with Playwright (see the
// P0-b report); here nothing touches the network or a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {formatPhone,contactsIn,separateGluedContacts} from '../src/components/contact-format.ts';
import {summarizeProspect} from '../src/components/prospect-summary.ts';
import {presentObservations,bestFirst,shortReason,presentObservation} from '../src/components/evidence-presentation.ts';
import {HISTORY_FIRST_PAGE,HISTORY_MORE_PAGE,HISTORY_MAX} from '../src/discovery/run-history.ts';
import {handleDiscovery} from '../src/discovery/api.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import type {StoredObservation} from '../src/discovery/types.ts';

const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
const review=await readFile(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');

// ---------------------------------------------------------------- contact (19, 20)
test('19 — a phone glued to the next words is displayed clean: "06.26.16.24.94Du Lundi au Samedi"',()=>{
 const raw='06.26.16.24.94Du Lundi au Samedi';
 assert.deepEqual(contactsIn(raw).map(c=>[c.kind,c.display]),[['phone','06 26 16 24 94']]);
 assert.equal(separateGluedContacts(raw),'06.26.16.24.94 · Du Lundi au Samedi');
 assert.equal(formatPhone('+33 6 26 16 24 94'),'06 26 16 24 94');
 assert.equal(formatPhone('04.90.00.00.01'),'04 90 00 00 01');
 assert.equal(separateGluedContacts('Tél06 26 16 24 94'),'Tél 06 26 16 24 94');
 assert.deepEqual(contactsIn('SIRET 123 456 789 00012'),[],'a company number is not a phone');
 assert.equal(separateGluedContacts('Contactez-nous au 04 90 00 00 01'),'Contactez-nous au 04 90 00 00 01','a clean sentence is unchanged');
});
test('20 — an e-mail glued to the next words is displayed clean',()=>{
 const raw='contact@studio-b.exampleDu lundi au samedi';
 assert.deepEqual(contactsIn(raw).map(c=>[c.kind,c.display]),[['email','contact@studio-b.example']]);
 assert.equal(separateGluedContacts(raw),'contact@studio-b.example · Du lundi au samedi');
 assert.deepEqual(contactsIn('Mail : Bonjour@Studio.fr.').map(c=>c.display),['bonjour@studio.fr']);
});

// ---------------------------------------------------------------- synthesis (11) and evidence (13, 14, visual dedup)
const ICP:Criterion[]=[{key:'lieu',label:'Lieu physique',weight:25},{key:'cours',label:'Cours / séances',weight:25},{key:'planning',label:'Planning',weight:20},{key:'contact',label:'Contact',weight:15},{key:'discipline',label:'Discipline cible',weight:15}];
const NOW=new Date('2026-09-27T10:00:00Z');
const row=(id:string,criterion:string|null,excerpt:string,extra:Partial<StoredObservation>={}):StoredObservation=>({id,prospect_id:'p',organization_id:'o',evidence_id:criterion?`ev-${id}`:null,review_status:'NOT_VERIFIED',criterion,observation_type:criterion?`ICP_SIGNAL:${criterion}`:'GENERIC_KEYWORD_MATCH',claim:`Le site indique quelque chose : cela peut correspondre au critère « x ». Proposition à confirmer par un humain.`,value:criterion?true:null,status:'INFERRED',source_url:'https://site.example/',source_title:'Site',source_excerpt:excerpt,source_type:'official_website',confidence:.55,collected_at:'2026-09-26T10:00:00Z',expires_at:'2026-12-26T10:00:00Z',content_hash:id,...extra});
const ROWS=[
 row('a1','lieu','675 chemin du Périgord'),row('a2','lieu','675 chemin du Périgord 84130 Le Pontet'),
 row('c1','cours','Prenez votre premier cours'),row('p1','planning','Planning des cours : lundi 18h30'),
 row('k1',null,'06.26.16.24.94Du Lundi au Samedi'),row('k2',null,'Accès facile'),row('k3',null,'Parking'),row('k4',null,'Vestiaires'),
];
test('11 — the synthesis is derived from the existing state only: signals, verified (existing score), to confirm, missing',()=>{
 const view=presentObservations(ROWS,ICP,'fr');
 const evidence:Evidence[]=ROWS.filter(r=>r.evidence_id).map(r=>({id:r.evidence_id!,criterion:r.criterion!,value:true,status:'INFERRED_UNCONFIRMED',source_url:r.source_url,excerpt:r.source_excerpt,observed_at:r.collected_at,verified_by:null}));
 const scored=scoreProspect(ICP,evidence,NOW);
 const s=summarizeProspect(ICP,scored.breakdown,view.summary,evidence);
 assert.deepEqual({total:s.total,withSignal:s.withSignal,verified:s.verified},{total:5,withSignal:3,verified:0});
 assert.deepEqual(s.toConfirm,['Lieu physique','Cours / séances','Planning']);
 assert.deepEqual(s.missing,['Contact','Discipline cible']);
 // A human confirmation is the only way to "verified" — and it is the existing engine that says so.
 const confirmed=evidence.map(e=>e.criterion==='cours'?{...e,status:'VERIFIED' as const,verified_by:'human'}:e);
 const after=summarizeProspect(ICP,scoreProspect(ICP,confirmed,NOW).breakdown,view.summary,confirmed);
 assert.equal(after.verified,1);assert.equal(scoreProspect(ICP,confirmed,NOW).score,25);
});
test('13 / visual dedup — the more complete near-duplicate is shown first; nothing is removed',()=>{
 const view=presentObservations(ROWS,ICP,'fr');
 const lieu=view.groups.find(g=>g.criterion.key==='lieu')!;
 assert.deepEqual(lieu.cards.map(c=>c.row.source_excerpt),['675 chemin du Périgord 84130 Le Pontet','675 chemin du Périgord']);
 assert.equal(lieu.cards.length,2,'both proofs stay, each with its own review');
 // Pending proofs come before the ones a human already decided on.
 const cards=[presentObservation(row('v','cours','Cours de yoga',{review_status:'VERIFIED'}),ICP,'fr'),presentObservation(row('w','cours','Cours collectifs'),ICP,'fr')];
 assert.deepEqual(bestFirst(cards).map(c=>c.row.id),['w','v']);
 assert.equal(shortReason('Le site indique une adresse physique : cela peut correspondre au critère « Lieu ». Proposition à confirmer par un humain.'),'Le site indique une adresse physique');
});
test('14 / 15 / 16 — other proofs, other findings and technical details are collapsed; other findings 3 at a time',()=>{
 assert.match(review,/\{g\.cards\.length>1&&<details className="evidence-more"><summary>/);
 assert.match(review,/<details className="evidence-others"><summary>\{tr\('evidence\.otherFindings'\)\} \(\{view\.others\.length\}\)<\/summary>\{view\.others\.slice\(0,othersShown\)\.map\(card\)\}/);
 assert.match(review,/const OTHERS_PAGE=3;/);
 assert.doesNotMatch(review,/<details[^>]*\bopen\b/,'nothing is expanded by default');
 assert.match(review,/<details className="technical"><summary>\{tr\('evidence\.technicalDetails'\)\}<\/summary>/);
 assert.doesNotMatch(page,/<details[^>]*\bopen=/);
});
test('17 / 18 — score and human review unchanged: same engine, same review calls, no new score',async()=>{
 assert.match(page,/const scored=current\?scoreProspect\(criteria,current\.evidence\):null;/);
 assert.equal((review.match(/review\(o,'confirm'\)/g)??[]).length,1);
 assert.match(review,/review\(o,'contradict'\)/);assert.match(review,/review\(o,'unverify'\)/);
 const summary=await readFile(new URL('../src/components/prospect-summary.ts',import.meta.url),'utf8');
 assert.doesNotMatch(summary.replace(/\/\/.*$/gm,''),/score|weight|points/i,'the synthesis counts states, it never computes points');
});
test('11 / 12 — prospect page order: header, synthesis, score/coverage, contacts, compact ICP, proofs',()=>{
 const at=(needle:string)=>{const i=page.indexOf(needle);assert.ok(i>0,needle);return i};
 const order=[at('<h2>{current.name}</h2>'),at('className="prospect-synthesis"'),at('<div className="coverage">'),at("tr('detail.channelsTitle')"),at('<div className="signals compact">'),at('<ObservationsReview key=')];
 assert.deepEqual([...order].sort((a,b)=>a-b),order);
 // One line per criterion; a tap opens its block of proofs.
 assert.match(page,/if\(g\)return <button key=\{b\.key\} className="signal-row"[^>]*onClick=\{\(\)=>reviewCriterion\(g\.anchorId\)\}>/);
 assert.doesNotMatch(page.slice(at('<div className="signals compact">'),at('<ObservationsReview key=')),/g\.excerpts\.map/,'no copy of every excerpt in the ICP summary');
});
test('21 — a failed analysis is one compact card with a retry; no proof is invented',()=>{
 assert.match(review,/const failed=error&&rows\.length===0;/);
 assert.match(review,/\{failed\?<div className="analysis-failed" role="alert"><b>\{tr\('evidence\.analysisFailedTitle'\)\}<\/b><p>\{error\}<\/p>/);
 assert.match(review,/\{rows\.length>0&&<div className="observations">/,'no criterion block without analyzed rows');
});

// ---------------------------------------------------------------- history & results (1–10)
test('1 / 2 / 3 — history: 5 first, then 10 more per tap, never more than 50; the API is paged',()=>{
 assert.equal(HISTORY_FIRST_PAGE,5);assert.equal(HISTORY_MORE_PAGE,10);assert.equal(HISTORY_MAX,50);
 assert.match(panel,/api\(`projects\/\$\{projectId\}\/discovery\?limit=\$\{Math\.min\(want\+1,HISTORY_MAX\)\}&offset=0`\)/);
 assert.match(panel,/api\(`projects\/\$\{projectId\}\/discovery\?limit=\$\{HISTORY_MORE_PAGE\+1\}&offset=\$\{shown\}`\)/);
 assert.match(panel,/\{hasMoreRuns&&<button className="more-button"/,'no "more" button when everything is shown');
});
test('4 — long queries and zones are clamped to 2 lines (1 line for a zone in a history card)',()=>{
 assert.match(panel,/<h4 className="run-query clamp-2" title=\{h\.query\}>\{h\.query\}<\/h4>/);
 assert.match(panel,/<span className="clamp-1">\{h\.location\}<\/span>/);
 assert.match(panel,/<p className="clamp-2"><b>\{runs\[0\]\.query\}<\/b><\/p>/);
 assert.match(css,/\.clamp-2\{-webkit-line-clamp:2;line-clamp:2\}/);
});
test('5 — back from a prospect: the same number of results and the same scroll are restored',()=>{
 assert.match(panel,/sessionStorage\.setItem\(scrollKey\(projectId\),JSON\.stringify\(\{y:window\.scrollY,shown:resultsShown\}\)\)/);
 assert.match(panel,/setResultsShown\(shown\);if\(y>0\)/);
});
test('6 / 7 — results: 6 first, 6 more per tap, with a one-line summary; long content in "Voir le détail"',()=>{
 assert.match(panel,/const RESULTS_PAGE=6;/);
 assert.match(panel,/\{candidates\.slice\(0,resultsShown\)\.map\(resultCard\)\}/);
 assert.match(panel,/onClick=\{\(\)=>setResultsShown\(n=>n\+RESULTS_PAGE\)\}/);
 assert.match(panel,/resultsSummaryLabel\(locale,results\.length,counts\.added,counts\.ignored,counts\.unresolved\)/);
 assert.match(panel,/<details className="result-detail"><summary>\{tr\('discovery\.viewDetail'\)\}<\/summary>/);
});
test('8 / 9 / 10 — states: added (open the prospect, no add button), ignored, unresolved (visible, compact)',()=>{
 assert.match(panel,/const state=r\.status==='accepted'\?'added':r\.status==='ignored'\?'ignored':canAdd\?'candidate':'unresolved'/);
 assert.match(panel,/r\.status==='pending'\?<><button disabled=\{busy\} className="primary" onClick=\{\(\)=>accept/,'the add button only for a pending candidate');
 assert.match(panel,/candidate:'discovery\.state\.candidate',added:'discovery\.addedToProject',ignored:'discovery\.ignoredBadge',unresolved:'discovery\.state\.unresolved'/);
});
test('History API — ?limit & ?offset are bounded and read-only; no parameter keeps the former 50',async()=>{
 const P='11111111-1111-4111-8111-111111111111';
 const run=(limitQuery:string)=>{const calls:Array<{op:string;args:unknown[]}>=[];const b:any={};for(const op of ['select','eq','in','order','range','limit'])b[op]=(...args:unknown[])=>{calls.push({op,args});return b};b.then=(r:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(r);
  const db={from:()=>b} as any;return handleDiscovery(new Request(`https://x.test/api/v1/projects/${P}/discovery${limitQuery}`,{method:'GET'}),['projects',P,'discovery'],null,db,{id:'u'}).then(res=>({res:res!,calls}))};
 const def=await run('');assert.equal(def.res.status,200);assert.deepEqual(def.calls.find(c=>c.op==='range')!.args,[0,49]);
 const paged=await run('?limit=11&offset=5');assert.deepEqual(paged.calls.find(c=>c.op==='range')!.args,[5,15]);
 for(const bad of ['?limit=0','?limit=51','?offset=-1','?limit=abc'])assert.ok((await run(bad)).res.status>=400,bad);
});
test('Mobile — touch targets ≥ 44 px on the new controls; no new dependency',async()=>{
 for(const rule of [/\.more-button\{[^}]*min-height:44px/,/\.result-detail>summary,[^{]*\{min-height:44px/,/\.signals\.compact \.signal-row\{[^}]*min-height:44px/,/\.evidence-proof\.compact \.evidence-actions button\{min-height:44px/,/\.analysis-failed button\{min-height:44px/])assert.match(css,rule);
 const {execSync}=await import('node:child_process');
 const before=JSON.parse(execSync('git show f1cc9da:package.json',{cwd:new URL('..',import.meta.url),encoding:'utf8'}));
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.deepEqual(pkg.dependencies,before.dependencies);assert.deepEqual(pkg.devDependencies,before.devDependencies);
});
