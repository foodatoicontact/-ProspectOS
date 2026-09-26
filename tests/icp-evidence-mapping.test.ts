// ICP evidence mapping + human-readable evidence UX. Pure unit tests (no network, no database: the SQL
// side — storage, review, re-analysis, tenant isolation — is covered by tests/icp-evidence-mapping-db.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {prioritizeObservations} from '../src/discovery/services.ts';
import {toStorageSafeObservation} from '../src/discovery/repository.ts';
import {ICP_SIGNAL_PREFIX,icpSignalType,icpSignalHash,conceptsForLabel} from '../src/discovery/strategies/icp-concepts.ts';
import {presentObservations,presentObservation,ICP_SIGNAL_TYPE_PREFIX,evidenceAnchorId} from '../src/components/evidence-presentation.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import type {Observation,StoredObservation} from '../src/discovery/types.ts';

// Padel Tolosa regression: the project's ICP is plain data; no code knows this customer or sector.
const ICP:Criterion[]=[
 {key:'infra',label:'Infrastructure sportive physique réservable',weight:30},
 {key:'slot',label:'Réservation par créneau / à l’heure',weight:25},
 {key:'multi',label:'Capacité multi-terrains / multi-espaces',weight:20},
 {key:'hours',label:'Amplitude horaire étendue',weight:10},
 {key:'groups',label:'Offres groupes / entreprises / événements',weight:15},
];
const OBS_A='4 Terrains indoor + 1 terrain de badminton';
const OBS_B='Créneaux de 1h30 disponibles tous les jours de 7h30 à 00h.';
const URL_='https://padel.fixture.example/';
const html=(body:string)=>`<html><head><title>Padel Tolosa</title></head><body><h1>Padel Tolosa</h1>${body}</body></html>`;
const PADEL=html(`<p>${OBS_A}</p><p>${OBS_B}</p><p>Tél : 05 61 00 00 00</p>`);
const extract=(page:string,criteria=ICP)=>new ObservationService().extract(page,URL_,criteria,'official_website',new Date('2026-09-20T10:00:00Z'));
const proposalFor=(obs:Observation[],key:string)=>obs.find(o=>o.criterion===key&&o.observation_type.startsWith(ICP_SIGNAL_PREFIX));
const NOW=new Date('2026-09-21T10:00:00Z');
// What the existing review RPC does to the linked evidence (review_discovery_observation): status only,
// verified_by set by evidence_guard from the authenticated human.
const humanReview=(e:Evidence,decision:'confirm'|'contradict',user='human-1'):Evidence=>({...e,status:decision==='confirm'?'VERIFIED':'CONTRADICTED',verified_by:user});
const stored=(o:Observation,extra:Partial<StoredObservation>={}):StoredObservation=>({...toStorageSafeObservation(o),id:crypto.randomUUID(),prospect_id:'p1',organization_id:'o1',evidence_id:o.criterion&&o.value!==null&&o.status!=='UNKNOWN'?crypto.randomUUID():null,review_status:'NOT_VERIFIED',...extra});

test('1 — a relevant observation proposes an ICP criterion: the multi-terrain sentence → "Capacité multi-terrains / multi-espaces"',()=>{
 const p=proposalFor(extract(PADEL),'multi');
 assert.ok(p);
 assert.equal(p.source_excerpt,OBS_A);
 assert.equal(p.status,'INFERRED');assert.equal(p.value,true);
 assert.equal(p.observation_type,'ICP_SIGNAL:multi');
 assert.match(p.claim,/5 terrains/);assert.match(p.claim,/Capacité multi-terrains \/ multi-espaces/);assert.match(p.claim,/confirmer par un humain/);
});
test('1 — the schedule sentence → "Amplitude horaire étendue" (16,5 h a day, every day)',()=>{
 const p=proposalFor(extract(PADEL),'hours');
 assert.ok(p);assert.equal(p.source_excerpt,OBS_B);assert.match(p.claim,/16,5 h par jour, tous les jours/);
});
test('2 — a proposal never changes the score: it becomes INFERRED_UNCONFIRMED evidence, score 0',()=>{
 const obs=extract(PADEL);const evidence=new EvidenceProposalService().propose(obs,ICP);
 assert.ok(evidence.length>=3);
 assert.ok(evidence.every(e=>e.status==='INFERRED_UNCONFIRMED'&&e.verified_by===null));
 assert.equal(scoreProspect(ICP,evidence,NOW).score,0);
 assert.ok(scoreProspect(ICP,evidence,NOW).breakdown.every(b=>b.points===0&&b.state==='UNKNOWN'));
});
test('3 — a SUPPOSÉE (INFERRED_UNCONFIRMED) evidence gives no point, whatever its confidence',()=>{
 const e:Evidence={id:'e',criterion:'multi',value:true,status:'INFERRED_UNCONFIRMED',source_url:URL_,excerpt:OBS_A,observed_at:'2026-09-20T10:00:00Z',verified_by:null};
 assert.equal(scoreProspect(ICP,[e],NOW).score,0);
 // Even a (forged) verified_by without the VERIFIED status is not enough.
 assert.equal(scoreProspect(ICP,[{...e,verified_by:'someone'}],NOW).score,0);
});
test('4 — an OBSERVED, non-verified evidence gives no point',()=>{
 const e:Evidence={id:'e',criterion:'multi',value:true,status:'NOT_VERIFIED',source_url:URL_,excerpt:OBS_A,observed_at:'2026-09-20T10:00:00Z',verified_by:null};
 assert.equal(scoreProspect(ICP,[e],NOW).score,0);
});
test('5 — human validation → VERIFIED → the existing engine recomputes the score with the ICP weight (+20)',()=>{
 const evidence=new EvidenceProposalService().propose(extract(PADEL),ICP);
 const next=evidence.map(e=>e.criterion==='multi'?humanReview(e,'confirm'):e);
 const s=scoreProspect(ICP,next,NOW);
 assert.equal(s.score,20);
 assert.equal(s.breakdown.find(b=>b.key==='multi')!.state,'TRUE');
});
test('6 — human rejection → CONTRADICTED → no point',()=>{
 const evidence=new EvidenceProposalService().propose(extract(PADEL),ICP);
 assert.equal(scoreProspect(ICP,evidence.map(e=>e.criterion==='multi'?humanReview(e,'contradict'):e),NOW).score,0);
});
test('7 — ambiguous sentences stay without proposal (À CONFIRMER): negation, lone keyword, single unit, short opening hours',()=>{
 const cases=[
  'Pas de terrain couvert pour le moment : 4 terrains extérieurs en projet, sans réservation.',
  'Nos terrains sont magnifiques.',
  'Un terrain de padel.',
  'Ouvert de 9h à 18h.',
  'Horaires : 10h - 19h du lundi au vendredi.',
  'Les créneaux ne sont pas encore disponibles.',
  'Réservation impossible par téléphone.',
 ];
 for(const sentence of cases){
  const obs=extract(html(`<p>${sentence}</p>`));
  assert.ok(!obs.some(o=>o.observation_type.startsWith(ICP_SIGNAL_PREFIX)),`no proposal for: ${sentence}`);
 }
});
test('7 — a criterion whose label names no concept never receives a proposal, even when the page is rich',()=>{
 const other:Criterion[]=[{key:'budget',label:'Budget marketing élevé',weight:100}];
 assert.deepEqual(conceptsForLabel(other[0].label),[]);
 assert.ok(!extract(PADEL,other).some(o=>o.observation_type.startsWith(ICP_SIGNAL_PREFIX)));
});
test('7 — a unit the label does not name is not counted ("multi-sites" ignores "4 terrains")',()=>{
 const sites:Criterion[]=[{key:'sites',label:'Réseau multi-sites',weight:100}];
 assert.equal(proposalFor(extract(PADEL,sites),'sites'),undefined);
 assert.ok(proposalFor(extract(html('<p>Nos 3 agences à Lyon, Paris et Nantes.</p>'),sites),'sites'));
});
test('8 — one sentence can propose several criteria, each as its own row, none validated automatically',()=>{
 const obs=extract(PADEL);const hours=proposalFor(obs,'hours')!,slot=proposalFor(obs,'slot')!;
 assert.equal(hours.source_excerpt,OBS_B);assert.equal(slot.source_excerpt,OBS_B);
 assert.notEqual(hours.observation_type,slot.observation_type,'distinct storage keys: each is reviewable separately');
 assert.ok(obs.every(o=>(o.status as string)!=='VERIFIED'));
 assert.deepEqual(proposalFor(obs,'infra'),undefined);assert.deepEqual(proposalFor(obs,'groups'),undefined);
});
test('8 — group / company / event offers and bookable facilities are proposed only on explicit wording',()=>{
 const obs=extract(html('<p>Privatisation des terrains et séminaires pour les entreprises.</p><p>Réservez votre terrain en ligne.</p>'));
 assert.match(proposalFor(obs,'groups')!.claim,/offre entreprises et une offre événements/);
 assert.equal(proposalFor(obs,'infra')!.source_excerpt,'Réservez votre terrain en ligne.');
});
test('Invariant — the mapping module can only ever produce INFERRED proposals: no VERIFIED, no status other than INFERRED',async()=>{
 const src=await readFile(new URL('../src/discovery/strategies/icp-concepts.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/'VERIFIED'|"VERIFIED"|'OBSERVED'/);
 assert.match(src,/,true,'INFERRED',/);
 for(const o of extract(PADEL).filter(o=>o.observation_type.startsWith(ICP_SIGNAL_PREFIX))){assert.equal(o.status,'INFERRED');assert.ok(o.confidence<=.6)}
});
test('Invariant — sector-agnostic: no customer, project or vertical name in the mapping or presentation code',async()=>{
 for(const f of ['../src/discovery/strategies/icp-concepts.ts','../src/components/evidence-presentation.ts']){
  const src=await readFile(new URL(f,import.meta.url),'utf8');
  assert.doesNotMatch(src,/padel|tolosa|badminton|foodatoi|fournipro|bebureau|manutan|douglas|ana[iï]s|maroc/i,f);
 }
});
test('Invariant — engine confidence is never a validation: confidence 1 on an unverified row still scores 0',()=>{
 const obs=extract(PADEL).map(o=>({...o,confidence:1}));
 assert.equal(scoreProspect(ICP,new EvidenceProposalService().propose(obs,ICP),NOW).score,0);
});

// ---------------- UX ----------------
const FORBIDDEN_PRIMARY=/PHONE_RAW|GENERIC_KEYWORD_MATCH|UNKNOWN|INFERRED|OBSERVED|NOT_VERIFIED|ICP_SIGNAL|RAW\b|_/;
function rowsForPadel(){
 const obs=prioritizeObservations(extract(PADEL));
 const keyword=stored({...obs[0],criterion:'infra',observation_type:'GENERIC_KEYWORD_MATCH',status:'INFERRED',value:null,claim:'Extrait potentiellement pertinent — correspondance avec le critère à confirmer',source_excerpt:'Terrains de sport',confidence:.2});
 return [...obs.map(o=>stored(o)),keyword];
}
test('9 — technical labels are never a primary title or status (PHONE_RAW, GENERIC_KEYWORD_MATCH, UNKNOWN, enums)',()=>{
 for(const locale of ['fr','en'] as const){
  const view=presentObservations(rowsForPadel(),ICP,locale);
  for(const c of [...view.proposals,...view.others]){
   assert.doesNotMatch(c.title,FORBIDDEN_PRIMARY,c.title);
   assert.doesNotMatch(c.subtitle??'',FORBIDDEN_PRIMARY);
   assert.doesNotMatch(c.statusLabel,FORBIDDEN_PRIMARY,c.statusLabel);
  }
  // …but stay available under the technical details.
  assert.ok(view.others.some(c=>c.technical.type==='PHONE_RAW'));
 }
 const fr=presentObservations(rowsForPadel(),ICP,'fr');
 assert.ok(fr.others.some(c=>c.title==='Téléphone professionnel trouvé'&&c.statusLabel==='Observé — non vérifié'));
 assert.ok(fr.others.some(c=>c.title==='Information potentiellement pertinente'));
 const unknown=presentObservation(stored({...extract(PADEL).find(o=>o.status==='UNKNOWN')!}),ICP,'fr');
 assert.equal(unknown.title,'Information à examiner');
});
test('9 — a proposal card is titled by the ICP criterion, status "À confirmer", confidence only in the technical details',()=>{
 const view=presentObservations(rowsForPadel(),ICP,'fr');
 assert.deepEqual(view.proposals.map(c=>c.title),['Réservation par créneau / à l’heure','Capacité multi-terrains / multi-espaces','Amplitude horaire étendue']);
 for(const c of view.proposals){assert.equal(c.statusLabel,'À confirmer');assert.equal(c.tone,'pending');assert.ok(c.anchorId);assert.ok(Number.isInteger(c.technical.confidencePct))}
 assert.deepEqual(view.missing,['Infrastructure sportive physique réservable','Offres groupes / entreprises / événements']);
});
test('10 — source and excerpt are visible on every card: "Padel Tolosa — site officiel" and the quoted sentence',()=>{
 const view=presentObservations(rowsForPadel(),ICP,'fr');
 const multi=view.proposals.find(c=>c.criterion?.key==='multi')!;
 assert.equal(multi.row.source_excerpt,OBS_A);
 assert.equal(multi.sourceText,'Padel Tolosa — site officiel');
 assert.equal(presentObservations(rowsForPadel(),ICP,'en').proposals[0].sourceText,'Padel Tolosa — official website');
});
test('11 — the source link is the safe, original URL; a non-HTTP(S) URL is never rendered as a link',()=>{
 const card=presentObservations(rowsForPadel(),ICP,'fr').proposals[0];
 assert.equal(card.sourceHref,URL_);
 const evil=presentObservation({...card.row,source_url:'javascript:alert(1)'},ICP,'fr');
 assert.equal(evil.sourceHref,null);
});
test('11 — the card renders that link in a new tab without opener, and the anchor the ICP section scrolls to',async()=>{
 const src=await readFile(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
 assert.match(src,/<a href=\{c\.sourceHref\} target="_blank" rel="noopener noreferrer">/);
 assert.match(src,/id=\{c\.anchorId\?\?undefined\}/);
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/document\.getElementById\(evidenceAnchorId\(e\.id\)\)/);
 assert.equal(evidenceAnchorId('abc'),'evidence-review-abc');
});
test('12 — display: a sentence already reviewed by a human is shown with its review, never replaced by a newer unreviewed copy',()=>{
 const base=rowsForPadel().find(o=>o.criterion==='multi')!;
 const verified={...base,review_status:'VERIFIED' as const,collected_at:'2026-09-01T00:00:00.000Z'};
 const newer={...base,id:'newer',evidence_id:'e-newer',source_url:'https://padel.fixture.example/tarifs',collected_at:'2026-09-25T00:00:00.000Z'};
 const view=presentObservations([newer,verified],ICP,'fr');
 const multi=view.proposals.filter(c=>c.criterion?.key==='multi');
 assert.equal(multi.length,1);assert.equal(multi[0].row.id,verified.id);assert.equal(multi[0].statusLabel,'Vérifié');
});
test('13 — no duplicate proposal: one storage key per criterion and sentence, stable when the rest of the page changes',()=>{
 const a=proposalFor(extract(PADEL),'multi')!,b=proposalFor(extract(html(`<p>Nouveau bar !</p><p>${OBS_A}</p>`)),'multi')!;
 assert.equal(a.observation_type,b.observation_type);assert.equal(a.content_hash,b.content_hash);
 assert.equal(a.content_hash,icpSignalHash(OBS_A));
 assert.ok(icpSignalType('k'.repeat(60)).length<=60);
 // Across several analyzed pages carrying the same sentence, the display keeps one card.
 const rows=rowsForPadel();const copy=rows.map(o=>({...o,id:crypto.randomUUID(),source_url:URL_+'contact'}));
 assert.equal(presentObservations([...rows,...copy],ICP,'fr').proposals.length,3);
});
test('13 — an analysis saves every proposal before the "absent" rows and lists a missing criterion once, within the 40-row bound',()=>{
 const pages=[PADEL,html('<p>Rien ici.</p>'),html('<p>Toujours rien.</p>')];
 const all=pages.flatMap(p=>extract(p));
 const saved=prioritizeObservations(all);
 assert.ok(saved.length<=40);
 assert.equal(saved.filter(o=>o.status==='UNKNOWN'&&o.criterion==='infra').length,1);
 assert.ok(!saved.some(o=>o.status==='UNKNOWN'&&o.criterion==='multi'),'a criterion informed on one page is not also listed as absent');
 const many:Criterion[]=Array.from({length:30},(_,i)=>({key:`c${i}`,label:i===29?'Amplitude horaire étendue':`Critère ${i}`,weight:i<10?4:3}));
 const bounded=prioritizeObservations([html('<p>x</p>'),html('<p>y</p>'),html(`<p>${OBS_B}</p>`)].flatMap(p=>extract(p,many)));
 assert.ok(bounded.length<=40);assert.ok(bounded.some(o=>o.criterion==='c29'&&o.status==='INFERRED'),'a page-3 proposal survives the bound');
});
test('14 — no migration was added by this bloc: the RPCs, RLS and evidence_guard are the existing ones',async()=>{
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.equal(files.at(-1),'015_dynamic_safe_analysis.sql');
 const client=await readFile(new URL('../src/components/evidence-presentation.ts',import.meta.url),'utf8');
 assert.doesNotMatch(client,/service_role|SUPABASE_SERVICE|process\.env/);
});
test('15 — the score stays bounded and weight-based: all criteria verified → 100, duplicates never add more',()=>{
 const e=(criterion:string,id:string):Evidence=>({id,criterion,value:true,status:'VERIFIED',source_url:URL_,excerpt:'x',observed_at:'2026-09-20T10:00:00Z',verified_by:'human'});
 const all=ICP.flatMap(c=>[e(c.key,c.key+'1'),e(c.key,c.key+'2')]);
 assert.equal(scoreProspect(ICP,all,NOW).score,100);
 assert.equal(scoreProspect(ICP,[e('multi','a'),e('multi','b'),e('multi','c')],NOW).score,20);
});
test('Padel Tolosa regression — initial score 0 (nothing verified), then +20 once the multi-terrain proposal is confirmed',()=>{
 const obs=prioritizeObservations(extract(PADEL));
 const evidence=new EvidenceProposalService().propose(obs,ICP);
 assert.deepEqual(evidence.map(e=>e.criterion).sort(),['hours','multi','slot']);
 assert.equal(scoreProspect(ICP,evidence,NOW).score,0);
 const confirmed=evidence.map(e=>e.criterion==='multi'?humanReview(e,'confirm'):e);
 assert.equal(scoreProspect(ICP,confirmed,NOW).score,20);
 const view=presentObservations(obs.map(o=>stored(o)),ICP,'fr');
 const phone=view.others.find(c=>c.technical.type==='PHONE_RAW')!;
 assert.equal(phone.title,'Téléphone professionnel trouvé');assert.equal(phone.kind,'context');assert.equal(phone.anchorId,null);
});
test('Constant — the client-side ICP signal prefix equals the server one',()=>{assert.equal(ICP_SIGNAL_TYPE_PREFIX,ICP_SIGNAL_PREFIX)});

// ---------------- Blocker regression: the REAL Padel Tolosa ICP keys ----------------
// The production project was created from the default ICP: its keys stayed target_fit / need_fit /
// commercial_signal / contactability while the user rewrote the labels. Nothing may be mapped by key alone.
const PROD_ICP:Criterion[]=[
 {key:'target_fit',label:'Infrastructure sportive physique réservable',weight:30},
 {key:'need_fit',label:'Réservation par créneau / à l’heure',weight:25},
 {key:'commercial_signal',label:'Capacité multi-terrains / multi-espaces',weight:20},
 {key:'contactability',label:'Amplitude horaire étendue',weight:10},
 {key:'criterion_27f71a18-bb19-41f8-a113-b80762f9d61e',label:'Offres groupes / entreprises / événements',weight:15},
];
const PHONE='06 73 61 05 45';
const PROD_PAGE=html(`<p>${OBS_A}</p><p>${OBS_B}</p><p>Nous recrutons un coach !</p><p>Tél : ${PHONE}</p>`);
test('BLOCKER — PHONE_RAW + five ICP criteria (real keys): no criterion mapping, never a proposal, never a +N point',()=>{
 const obs=extract(PROD_PAGE,PROD_ICP);
 const phone=obs.find(o=>o.observation_type==='PHONE_RAW')!;
 assert.equal(phone.criterion,null);assert.equal(phone.value,null);
 assert.ok(!new EvidenceProposalService().propose(obs,PROD_ICP).some(e=>e.excerpt===PHONE));
 const view=presentObservations(prioritizeObservations(obs).map(o=>stored(o)),PROD_ICP,'fr');
 assert.ok(!view.proposals.some(c=>c.row.source_excerpt===PHONE));
 const card=view.others.find(c=>c.row.source_excerpt===PHONE)!;
 assert.equal(card.title,'Téléphone professionnel trouvé');assert.equal(card.kind,'context');assert.equal(card.criterion,null);assert.equal(card.anchorId,null);
});
test('BLOCKER — a legacy stored PHONE_RAW attached to "contactability" (relabeled "Amplitude horaire étendue") is shown as context only',()=>{
 const legacy:StoredObservation={criterion:'contactability',observation_type:'PHONE_RAW',claim:'Numéro de téléphone professionnel public documenté',value:true,status:'OBSERVED',
  source_url:'https://www.padeltolosa.fr/',source_title:'Padel Tolosa',source_excerpt:PHONE,source_type:'official_website',confidence:.8,collected_at:'2026-09-26T12:26:55.008Z',expires_at:'2026-12-25T12:26:55.008Z',
  content_hash:'legacy',id:'f8c62ab9',prospect_id:'p',organization_id:'o',evidence_id:'955d0641',review_status:'NOT_VERIFIED'};
 for(const locale of ['fr','en'] as const){
  const view=presentObservations([legacy],PROD_ICP,locale);
  assert.equal(view.proposals.length,0,'no card under "Amplitude horaire étendue"');
  assert.equal(view.others.length,1);assert.equal(view.others[0].kind,'context');assert.equal(view.others[0].criterion,null);assert.equal(view.others[0].anchorId,null);
  assert.deepEqual(view.contextEvidenceIds,['955d0641'],'the ICP section hides its evidence under that criterion');
  assert.ok(view.missing.includes('Amplitude horaire étendue'),'the criterion is still "not found"');
 }
});
test('BLOCKER — buttons and the "+N points" line exist only on proposal cards (static wiring)',async()=>{
 const src=await readFile(new URL('../src/components/ObservationsReview.tsx',import.meta.url),'utf8');
 assert.match(src,/\{c\.kind==='proposal'&&<div className="actions evidence-actions">/);
 assert.match(src,/\{c\.kind==='proposal'&&<><p className="evidence-label">\{tr\('evidence\.whyRelevant'\)\}<\/p><p>\{o\.claim\}<\/p>\{c\.criterion&&<p className="muted">\{proposalScoreNote\(/);
 assert.equal((src.match(/proposalScoreNote\(/g)??[]).length,1);
 assert.equal((src.match(/review\(o,'confirm'\)/g)??[]).length,1);
});
test('BLOCKER — multi-terrain sentence → only "Capacité multi-terrains / multi-espaces"; schedule → only "Amplitude" and "Réservation par créneau"',()=>{
 const obs=extract(PROD_PAGE,PROD_ICP).filter(o=>o.status!=='UNKNOWN'&&o.criterion);
 const forExcerpt=(x:string)=>obs.filter(o=>o.source_excerpt===x).map(o=>o.criterion).sort();
 assert.deepEqual(forExcerpt(OBS_A),['commercial_signal']);
 assert.deepEqual(forExcerpt(OBS_B),['contactability','need_fit']);
 assert.equal(proposalFor(obs,'commercial_signal')!.observation_type,'ICP_SIGNAL:commercial_signal');
 assert.equal(proposalFor(obs,'contactability')!.observation_type,'ICP_SIGNAL:contactability');
 // No cross-association: every mapped row is an ICP proposal, the phone and the recruiting line map to nothing.
 assert.ok(obs.every(o=>o.observation_type.startsWith(ICP_SIGNAL_PREFIX)),JSON.stringify(obs.map(o=>[o.criterion,o.observation_type])));
 assert.ok(!obs.some(o=>/recrutons/.test(o.source_excerpt)));
 const view=presentObservations(prioritizeObservations(extract(PROD_PAGE,PROD_ICP)).map(o=>stored(o)),PROD_ICP,'fr');
 assert.deepEqual(view.proposals.map(c=>[c.title,c.row.source_excerpt]),[
  ['Réservation par créneau / à l’heure',OBS_B],['Capacité multi-terrains / multi-espaces',OBS_A],['Amplitude horaire étendue',OBS_B]]);
 const s0=scoreProspect(PROD_ICP,new EvidenceProposalService().propose(obs,PROD_ICP),NOW);assert.equal(s0.score,0);
 const confirmed=new EvidenceProposalService().propose(obs,PROD_ICP).map(e=>e.criterion==='commercial_signal'?humanReview(e,'confirm'):e);
 assert.equal(scoreProspect(PROD_ICP,confirmed,NOW).score,20);
});
test('BLOCKER — key-based rules still work when the label keeps their meaning (default ICP unchanged)',()=>{
 const obs=extract(PROD_PAGE,[{key:'commercial_signal',label:'Signal commercial observable',weight:50},{key:'contactability',label:'Canal de contact professionnel documenté',weight:50}]);
 assert.equal(obs.find(o=>o.observation_type==='PHONE_RAW')!.criterion,'contactability');
 assert.equal(obs.find(o=>o.observation_type==='RECRUITING_SIGNAL')!.criterion,'commercial_signal');
});
test('BLOCKER — the UI trusts a stored criterion only through an explicit rule → criterion mapping (no fallback)',()=>{
 const base=rowsForPadel().find(o=>o.criterion==='multi')!;
 const as=(o:Partial<StoredObservation>)=>presentObservation({...base,...o},PROD_ICP,'fr').kind;
 assert.equal(as({criterion:'commercial_signal',observation_type:'ICP_SIGNAL:commercial_signal'}),'proposal');
 assert.equal(as({criterion:'contactability',observation_type:'ICP_SIGNAL:commercial_signal'}),'context','ICP_SIGNAL type and criterion disagree');
 assert.equal(as({criterion:'commercial_signal',observation_type:'RECRUITING_SIGNAL'}),'context','commercial rule on a relabeled key');
 assert.equal(as({criterion:'target_fit',observation_type:'GENERIC_KEYWORD_MATCH'}),'context');
 assert.equal(as({criterion:'target_fit',observation_type:'SOMETHING_NEW'}),'context','unknown rule type');
 assert.equal(as({criterion:'target_fit',observation_type:'TARGET_FIT_RULE_MATCH'}),'proposal','a user-authored target_fit rule');
});
