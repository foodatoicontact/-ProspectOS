// Site analysis → ICP mapping: what an official page states the organization IS in its identity statements (its title,
// its h1 and the tagline right after it, its header tagline, its meta description) can document the user's own
// target_fit values — "Pierres Naturelles", "Pierre · Marbre · Granit" — as a sourced proposal to confirm, never as a
// fact. A short identity statement is not a menu; a menu, a link or a list item still is. It never documents a need,
// a commercial signal or an intent. The natural-stone vocabulary below is fixture data: the engine only ever reads
// the ICP it is given. Fictional companies, .example domains.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {ObservationSchema,type Observation,type StoredObservation} from '../src/discovery/types.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import {isReviewable,humanStatus} from '../src/components/evidence-presentation.ts';

const STONE_ICP:Criterion[]=[
 {key:'target_fit',label:'Correspond à la cible définie',weight:25,rules:{type:'target_fit',config:{match:'any_defined',categories:['pierre naturelle','marbre','granit']}}},
 {key:'need_fit',label:'Besoin correspondant à l’offre',weight:30,rules:{type:'need_fit',config:{signals:['protection des surfaces','traitement anti-taches']}}},
 {key:'commercial_signal',label:'Signal commercial observable',weight:25},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:20},
];
const NOW=new Date('2026-10-19T09:00:00Z');
const extract=(html:string,url='https://pierres.example/',criteria=STONE_ICP)=>new ObservationService().extract(html,url,criteria,'official_website',NOW);
const fit=(o:Observation[])=>o.find(x=>x.criterion==='target_fit'&&x.value===true);
const NAV='<header><nav><ul><li><a href="/catalogue">Catalogue</a></li><li><a href="/negoce">Négoce de matériaux</a></li><li><a href="/tarifs">Tarifs Professionnels</a></li></ul></nav></header>';
const SETRAAG=`<html><head><title>SARL SE.TRA.AG / Pierres Naturelles</title></head><body>${NAV}<h1>SARL SE.TRA.AG</h1><h2>Pierres Naturelles</h2><p>Catalogue</p><p>Négoce de matériaux</p><p>Tarifs Professionnels</p><p>12 route de Lyon, 69800 Saint-Priest</p><p>Tél : 04 72 00 00 00</p></body></html>`;
const SPMG=`<html><head><title>SPMG</title></head><body>${NAV}<h1>SPMG</h1><p>PIERRE · MARBRE · GRANIT</p><p>Tél : 04 67 00 00 00</p></body></html>`;
const stored=(o:Observation,evidence:string|null='e1'):StoredObservation=>({...o,id:'o1',prospect_id:'p1',organization_id:'org1',evidence_id:evidence,review_status:'NOT_VERIFIED'});

test('A — "Pierres Naturelles" on the official page is proposed for the target criterion, sourced and unverified',()=>{
 for(const html of [SETRAAG,`<html><head><title>Accueil</title></head><body>${NAV}<h1>SE.TRA.AG</h1><h2>Pierres Naturelles</h2><p>Tél : 04 72 00 00 00</p></body></html>`]){
  const o=fit(extract(html));
  assert.ok(o,'a target_fit proposal');
  assert.equal(o.observation_type,'TARGET_FIT_RULE_MATCH');
  assert.equal(o.status,'INFERRED','à confirmer, never observed as a fact');
  assert.ok(o.confidence<.85,'weaker than a full sentence');
  assert.match(o.claim,/« pierre naturelle »/);assert.match(o.claim,/à confirmer par un humain/);
  assert.match(o.source_excerpt,/Pierres Naturelles/);
  assert.equal(o.source_url,'https://pierres.example/');
 }
 // The proposal becomes an unconfirmed evidence: never VERIFIED, never verified by anyone.
 const ev=new EvidenceProposalService().propose(extract(SETRAAG),STONE_ICP).filter(e=>e.criterion==='target_fit');
 assert.equal(ev.length,1);assert.equal(ev[0].status,'INFERRED_UNCONFIRMED');assert.equal(ev[0].verified_by,null);
});

test('B — "Pierre · Marbre · Granit" as the tagline of the page: same behaviour',()=>{
 for(const html of [SPMG,`<html><body><header><span>PIERRE · MARBRE · GRANIT</span>${NAV}</header><p>Tél : 04 67 00 00 00</p></body></html>`,
  `<html><head><meta name="description" content="Pierre · Marbre · Granit"></head><body><p>Tél : 04 67 00 00 00</p></body></html>`]){
  const o=fit(extract(html));
  assert.ok(o,html);
  assert.equal(o.status,'INFERRED');
  assert.equal(o.source_excerpt.toLowerCase(),'pierre · marbre · granit');
  assert.match(o.claim,/« marbre »|« granit »/);
 }
});

test('C — an identity statement never documents a need, a commercial signal or an intent',()=>{
 // Even when the need vocabulary carries the very same words, a heading is not a need.
 const sameWords:Criterion[]=STONE_ICP.map(c=>c.key==='need_fit'?{...c,rules:{type:'need_fit',config:{signals:['pierre naturelle','marbre','granit','négoce de matériaux','tarifs professionnels']}}}:c);
 for(const criteria of [STONE_ICP,sameWords])for(const html of [SETRAAG,SPMG]){
  const o=extract(html,'https://pierres.example/',criteria);
  assert.equal(o.filter(x=>x.criterion==='need_fit'&&x.value!==null).length,0,'no need');
  assert.equal(o.filter(x=>x.criterion==='commercial_signal'&&x.value!==null).length,0,'no commercial signal');
  assert.equal(o.filter(x=>x.observation_type.startsWith('ICP_SIGNAL:')).length,0,'no intent proposal');
  assert.equal(new EvidenceProposalService().propose(o,criteria).filter(e=>e.criterion!=='target_fit'&&e.criterion!=='contactability').length,0);
 }
});

test('D — an unrelated site, a menu, a link or a sentence about clients gives no FIT observation',()=>{
 const none=(html:string)=>assert.equal(fit(extract(html)),undefined,html);
 none('<html><head><title>Dupont Plomberie — Chauffage</title></head><body><h1>Dupont Plomberie</h1><h2>Chauffage · Sanitaire · Dépannage</h2><p>Tél : 05 61 00 00 00</p></body></html>');
 none('<html><body><header><p>Accueil · Marbre · Contact</p></header><p>Tél : 05 61 00 00 00</p></body></html>');
 none('<html><body><header><nav><a href="/pierres">Pierres naturelles</a></nav></header><ul><li>Marbre</li></ul><p>Tél : 05 61 00 00 00</p></body></html>');
 none('<html><head><meta name="description" content="Nous accompagnons les professionnels de la pierre naturelle"></head><body><h1>Agence Web Durand</h1></body></html>');
 none('<html><body><main><p>Marbre</p><p>Pierres naturelles</p></main></body></html>');
 none('<html><body><footer><h1>Granit</h1></footer></body></html>');
 // No ICP value, no proposal: a bare phone number is never a FIT.
 assert.equal(fit(extract(SETRAAG,'https://pierres.example/',STONE_ICP.map(c=>c.key==='target_fit'?{...c,rules:undefined}:c))),undefined);
});

test('E — provenance: the real page URL and an excerpt present on that page; no excerpt, no proof',()=>{
 for(const html of [SETRAAG,SPMG]){
  const o=fit(extract(html,'https://site-officiel.example/'))!;
  assert.equal(o.source_url,'https://site-officiel.example/');
  assert.ok(html.includes(o.source_excerpt),'the excerpt is the page’s own text, verbatim');
  assert.equal(o.source_type,'official_website');
 }
 assert.throws(()=>ObservationSchema.parse({...fit(extract(SETRAAG))!,source_excerpt:''}),/Extrait requis/);
 const noExcerpt={...fit(extract(SETRAAG))!,source_excerpt:' '};
 assert.equal(new EvidenceProposalService().propose([noExcerpt],STONE_ICP).length,0);
});

test('F — no verified FIT before a human confirms; after confirmation, exactly the existing mechanism',()=>{
 const o=fit(extract(SETRAAG))!;
 assert.equal(isReviewable(stored(o),STONE_ICP),true,'offered for review on the target criterion');
 assert.deepEqual(humanStatus(stored(o),true,'fr'),{label:'À confirmer',tone:'pending'});
 const [proposal]=new EvidenceProposalService().propose([o],STONE_ICP);
 const before=scoreProspect(STONE_ICP,[proposal],NOW).breakdown.find(b=>b.key==='target_fit')!;
 assert.equal(before.state,'UNKNOWN');assert.equal(before.points,0);
 // What review_discovery_observation writes on "confirm" (status VERIFIED, verified_by the human): scored as usual.
 const confirmed:Evidence={...proposal,status:'VERIFIED',verified_by:'user-1'};
 const after=scoreProspect(STONE_ICP,[confirmed],NOW).breakdown.find(b=>b.key==='target_fit')!;
 assert.equal(after.state,'TRUE');assert.equal(after.points,25);
 const contradicted=scoreProspect(STONE_ICP,[{...proposal,status:'CONTRADICTED',verified_by:'user-1'}],NOW).breakdown.find(b=>b.key==='target_fit')!;
 assert.equal(contradicted.points,0);
});

test('a sentence of the page still wins over an identity statement, unchanged',()=>{
 const o=fit(extract('<html><head><title>Pierres Naturelles</title></head><body><p>Nous sommes une marbrerie spécialisée dans le marbre et le granit depuis 1980.</p></body></html>'))!;
 assert.equal(o.status,'OBSERVED');assert.equal(o.confidence,.85);
 assert.match(o.source_excerpt,/^Nous sommes une marbrerie/);
});
