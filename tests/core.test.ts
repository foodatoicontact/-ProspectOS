import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreProspect,generateOutreach,safeLink,csv,allowedAction,DEFAULT_CRITERIA} from '../src/domain/core.ts';
const criteria=[{key:'phone_orders',label:'Commandes par téléphone',weight:100}];
const now=new Date('2026-09-16T12:00:00Z');
const evidence={id:'1',criterion:'phone_orders',value:true,status:'VERIFIED',source_url:'https://example.com',excerpt:'Commandez par téléphone',observed_at:'2026-09-16',verified_by:'human'};
test('unknown never earns points',()=>assert.equal(scoreProspect(criteria,[],now).score,0));
test('verified earns weight',()=>assert.equal(scoreProspect(criteria,[evidence],now).score,100));
test('false is known without points',()=>{const s=scoreProspect(criteria,[{...evidence,value:false}],now);assert.equal(s.score,0);assert.equal(s.coverage,100)});
test('inference not promoted',()=>assert.equal(scoreProspect(criteria,[{...evidence,status:'INFERRED_UNCONFIRMED'}],now).score,0));
test('missing reviewer never verified',()=>assert.equal(scoreProspect(criteria,[{...evidence,verified_by:null}],now).score,0));
test('stale and future evidence ignored',()=>{for(const date of ['2020-01-01','2027-01-01'])assert.equal(scoreProspect(criteria,[{...evidence,observed_at:date}],now).score,0)});
test('duplicates counted once',()=>assert.equal(scoreProspect(criteria,[evidence,evidence],now).score,100));
test('conflicting observations need review',()=>{const s=scoreProspect(criteria,[evidence,{...evidence,id:'2',value:false}],now);assert.equal(s.score,0);assert.equal(s.breakdown[0].state,'CONFLICT')});
test('unknown DM does not invent phone orders',()=>assert.doesNotMatch(generateOutreach('Test','Foodatoi',criteria,[],now).text,/vous prenez|vous proposez|par téléphone/));
test('verified DM cites evidence ids',()=>assert.deepEqual(generateOutreach('Test','Foodatoi',criteria,[evidence],now).evidence_ids,['1']));
test('NOT_VERIFIED evidence is never used as a fact in the draft',()=>{const r=generateOutreach('Test','Foodatoi',criteria,[{...evidence,status:'NOT_VERIFIED',verified_by:null}],now);assert.deepEqual(r.evidence_ids,[]);assert.doesNotMatch(r.text,/vous prenez|vous proposez|par téléphone/)});
test('CONTRADICTED evidence is never used as a fact in the draft',()=>{const r=generateOutreach('Test','Foodatoi',criteria,[{...evidence,status:'CONTRADICTED'}],now);assert.deepEqual(r.evidence_ids,[]);assert.doesNotMatch(r.text,/vous prenez|vous proposez|par téléphone/)});
test('INFERRED_UNCONFIRMED evidence is never used as a fact in the draft',()=>{const r=generateOutreach('Test','Foodatoi',criteria,[{...evidence,status:'INFERRED_UNCONFIRMED'}],now);assert.deepEqual(r.evidence_ids,[]);assert.doesNotMatch(r.text,/vous prenez|vous proposez|par téléphone/)});
test('no VERIFIED evidence at all falls back to a generic, offer-only message',()=>{const r=generateOutreach('Test','Foodatoi',criteria,[],now);assert.deepEqual(r.evidence_ids,[]);assert.match(r.text,/Foodatoi/);assert.match(r.text,/Test/)});
test('dangerous links rejected',()=>{for(const u of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.com'])assert.equal(safeLink(u),null)});
test('CSV prevents formulas and escapes quotes',()=>assert.match(csv([['=1+1','a"b']]),/"'=1\+1","a""b"/));
test('LinkedIn final actions are human',()=>{assert.equal(allowedAction('linkedin_send'),false);assert.equal(allowedAction('mark_contacted'),true)});

// --- Post-release message-quality patch: the wording must never expose an internal criterion
// label/key/observation-type, and must never turn an unproven inference into a stated fact. Uses
// DEFAULT_CRITERIA (target_fit/need_fit/commercial_signal/contactability) — generic, not Foodatoi —
// to also prove the engine carries no restaurant-specific special-casing.
const nowMsg=new Date('2026-09-18T12:00:00Z');
const recruitingExcerpt='Nova Assistance recrute actuellement plusieurs conseillers pour renforcer son équipe suite à une forte croissance de son activité.';
function novaEvidence(overrides={}){return {id:'e1',criterion:'commercial_signal',value:true,status:'VERIFIED',verified_by:'human-1',source_url:'https://nova.fixture.example/',excerpt:recruitingExcerpt,observed_at:'2026-09-17',...overrides};}
test('A — a single VERIFIED recruiting-style signal produces a natural message quoting the verified fact, never the internal criterion label',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence()],nowMsg);
 assert.match(r.text,/recrute actuellement plusieurs conseillers/);
 assert.doesNotMatch(r.text,/Signal commercial observable|commercial_signal/i);
 assert.deepEqual(r.evidence_ids,['e1']);
});
test('B — with VERIFIED and NOT_VERIFIED evidence together, only the VERIFIED one may personalize',()=>{
 const verified=novaEvidence({id:'v1'});
 const notVerified=novaEvidence({id:'nv1',criterion:'need_fit',status:'NOT_VERIFIED',verified_by:null,excerpt:'Nous cherchons une solution à tout prix.'});
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[verified,notVerified],nowMsg);
 assert.deepEqual(r.evidence_ids,['v1']);
 assert.doesNotMatch(r.text,/cherchons une solution/);
});
test('C — only NOT_VERIFIED evidence falls back to the generic message',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence({status:'NOT_VERIFIED',verified_by:null})],nowMsg);
 assert.deepEqual(r.evidence_ids,[]);
 assert.doesNotMatch(r.text,/recrute actuellement/);
 assert.match(r.text,/je me permets de vous contacter/);
});
test('D — UNKNOWN status is never factualized',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence({status:'UNKNOWN',verified_by:null})],nowMsg);
 assert.deepEqual(r.evidence_ids,[]);
 assert.doesNotMatch(r.text,/recrute actuellement/);
});
test('E — CONTRADICTED status is never factualized',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence({status:'CONTRADICTED'})],nowMsg);
 assert.deepEqual(r.evidence_ids,[]);
 assert.doesNotMatch(r.text,/recrute actuellement/);
});
test('F — an expired VERIFIED proof is never factualized',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence({observed_at:'2020-01-01'})],nowMsg);
 assert.deepEqual(r.evidence_ids,[]);
 assert.doesNotMatch(r.text,/recrute actuellement/);
});
test('G — VERIFIED without verified_by is never factualized',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence({verified_by:null})],nowMsg);
 assert.deepEqual(r.evidence_ids,[]);
 assert.doesNotMatch(r.text,/recrute actuellement/);
});
test('H — VERIFIED without an exploitable excerpt never becomes a fact, and nothing is invented in its place',()=>{
 const r=generateOutreach('Nova','Notre offre',DEFAULT_CRITERIA,[novaEvidence({excerpt:''})],nowMsg);
 assert.deepEqual(r.evidence_ids,[]);
 assert.match(r.text,/je me permets de vous contacter/);
});
test('I — an absurd internal criterion label never leaks into the message',()=>{
 const weirdCriteria=[{key:'commercial_signal',label:'SUPER_INTERNAL_AI_SIGNAL_123',weight:100}];
 const r=generateOutreach('Nova','Notre offre',weirdCriteria,[novaEvidence()],nowMsg);
 assert.doesNotMatch(r.text,/SUPER_INTERNAL_AI_SIGNAL_123/);
});
test('J — internal observation-type identifiers are never exposed even when used as a criterion key',()=>{
 const weirdCriteria=[{key:'RECRUITING_SIGNAL',label:'Signal',weight:50},{key:'NEED_FIT_SIGNAL_MATCH',label:'Fit',weight:30},{key:'PHONE_RAW',label:'Phone',weight:20}];
 const r=generateOutreach('Nova','Notre offre',weirdCriteria,[novaEvidence({criterion:'RECRUITING_SIGNAL'})],nowMsg);
 for(const banned of ['RECRUITING_SIGNAL','NEED_FIT_SIGNAL_MATCH','PHONE_RAW'])assert.doesNotMatch(r.text,new RegExp(banned));
});
test('K — the user-authored offer is used verbatim as the value proposition',()=>{
 const r=generateOutreach('Nova','Automatisation du traitement des demandes entrantes pour PME',DEFAULT_CRITERIA,[],nowMsg);
 assert.match(r.text,/Automatisation du traitement des demandes entrantes pour PME/);
});
test('L — the offer is never reworded into a claimed prospect need',()=>{
 const r=generateOutreach('Nova','Automatisation du traitement des demandes entrantes pour PME',DEFAULT_CRITERIA,[],nowMsg);
 assert.doesNotMatch(r.text,/vous avez (certainement )?besoin|votre besoin/i);
});
test('multi-sector: the highest-weight satisfied criterion wins, with no hardcoded per-sector key priority',()=>{
 const criteria=[{key:'target_fit',label:'Cible',weight:10},{key:'commercial_signal',label:'Signal',weight:90}];
 const targetFit=novaEvidence({id:'t1',criterion:'target_fit',excerpt:'Basé à Toulouse, PME locale.'});
 const commercialSignal=novaEvidence({id:'c1',criterion:'commercial_signal'});
 const r=generateOutreach('Nova','Notre offre',criteria,[targetFit,commercialSignal],nowMsg);
 assert.deepEqual(r.evidence_ids,['c1'],'the heavier-weighted criterion (90) is preferred over the lighter one (10), regardless of key name');
});
