// Fixture Discovery -> analyze end-to-end: a fixture-accepted prospect must never trigger a real
// network fetch, and Discovery's fixture dataset itself must be multi-sector, not restaurant-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryService,CompanyAnalysisService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {FixtureProvider,RESTAURANT_FIXTURE_COMPANIES,GENERIC_FIXTURE_COMPANIES,isFixtureUrl,createCompositePageFetcher} from '../src/discovery/providers/fixture.ts';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import type {DiscoveryInput,DiscoveryRun,Observation} from '../src/discovery/types.ts';
import {DEFAULT_CRITERIA,FOODATOI_CRITERIA,scoreProspect,type Criterion} from '../src/domain/core.ts';
import {validateUrl} from '../src/discovery/safe-fetch.ts';

const SAAS_CRITERIA:Criterion[]=[
 {key:'target_fit',label:'Correspond à la cible définie',weight:25},
 {key:'need_fit',label:'Besoin correspondant à l’offre',weight:30},
 {key:'commercial_signal',label:'Signal commercial observable',weight:25},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:20}
];

class MemoryRepo implements DiscoveryRepository {
 rows:any[]=[];observations:Observation[]=[];status='';calls=0;criteria:Criterion[]=DEFAULT_CRITERIA;website='https://alpha.fixture.example/';runProjectId='';
 async start(input:DiscoveryInput){this.runProjectId=input.project_id;return {id:'run',project_id:input.project_id,provider:'fixture',status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_r:DiscoveryRun,rows:any[]){this.rows=rows.map(({candidate,dedupe},i)=>({id:String(i),normalized_payload:candidate,dedupe_status:dedupe.status,duplicate_of:null,status:'pending',prospect_id:null}));return this.rows}
 async finish(_id:string,_count:number,_metrics:unknown,error?:string){this.status=error?'failed':'completed'}
 async prospect(id:string){if(id!=='accepted')throw Error('NOT_FOUND');return {id,website:this.website,organization_id:'a',project_id:this.runProjectId||'p'}}
 async projectCriteria(){return this.criteria}
 async consumeAnalysis(){this.calls++}
 async saveObservations(_id:string,obs:Observation[]){this.observations=obs;return obs}
 // Test-only helper mirroring accept_discovery_result's key guarantee: the created prospect
 // inherits the run's own project_id — never a different one. The SQL function itself (tenant
 // isolation, FK integrity, idempotency) is authoritatively covered in tests/discovery-db.mjs.
 acceptFirstResult(){const row=this.rows[0];return {id:'accepted-'+row.id,name:row.normalized_payload.name,project_id:this.runProjectId,organization_id:'a',website:row.normalized_payload.website}}
}

// A "real" fetcher stand-in: recording whether it was ever invoked and always throwing, so a test
// fails loudly the moment a fixture-sourced prospect leaks a real network attempt.
function spyRealFetcher(){const calls:string[]=[];const fetcher=async(url:string)=>{calls.push(url);throw Error('UNEXPECTED_REAL_FETCH')};return {calls,fetcher}}

// --- 1. Fixture discovery returns synthetic candidates, tailored to the project's own ICP ---
test('fixture discovery returns the generic dataset for a non-restaurant ICP (Test SaaS)',async()=>{
 const r=new MemoryRepo();
 const found=await new DiscoveryService(r,new FixtureProvider()).find_prospects({project_id:'p',query:'PME services',location:'Toulouse',categories:[],max_results:3,optional_filters:{criteria:SAAS_CRITERIA}});
 assert.equal(found.results.length,3);
 assert.ok(found.results.every((row:any)=>GENERIC_FIXTURE_COMPANIES.some(c=>c.name===row.normalized_payload.name)));
 assert.ok(!found.results.some((row:any)=>RESTAURANT_FIXTURE_COMPANIES.some(c=>c.name===row.normalized_payload.name)));
 assert.ok(found.results.every((row:any)=>/^TEST — /.test(row.normalized_payload.name)));
});
test('fixture discovery returns the restaurant dataset for the Foodatoi ICP',async()=>{
 const r=new MemoryRepo();
 const found=await new DiscoveryService(r,new FixtureProvider()).find_prospects({project_id:'p',query:'restaurants indépendants',location:'Toulouse',categories:[],max_results:3,optional_filters:{criteria:FOODATOI_CRITERIA}});
 assert.ok(found.results.every((row:any)=>RESTAURANT_FIXTURE_COMPANIES.some(c=>c.name===row.normalized_payload.name)));
});

// --- 2. Acceptance creates a prospect scoped to the run's own project (SQL-level authoritative
// coverage already in tests/discovery-db.mjs; this checks the JS-side wiring carries the right project_id) ---
test('accepting a fixture result creates a prospect scoped to the project that ran the search',async()=>{
 const r=new MemoryRepo();
 await new DiscoveryService(r,new FixtureProvider()).find_prospects({project_id:'saas-project-42',query:'PME',location:'Toulouse',categories:[],max_results:1,optional_filters:{criteria:SAAS_CRITERIA}});
 const prospect=r.acceptFirstResult();
 assert.equal(prospect.project_id,'saas-project-42');
 assert.ok(GENERIC_FIXTURE_COMPANIES.some(c=>c.name===prospect.name));
});

// --- 3 & 8 & 9. A fixture-accepted prospect never calls the real fetcher; a real prospect does; SSRF stays enforced ---
test('analyzing a fixture-accepted prospect makes zero real network calls',async()=>{
 const r=new MemoryRepo();r.website='https://alpha.fixture.example/';
 const {calls,fetcher:real}=spyRealFetcher();
 const result=await new CompanyAnalysisService(r,createCompositePageFetcher(real)).analyze_company('accepted','test_fixture');
 assert.equal(calls.length,0);
 assert.ok(result.pages_analyzed>=1);
});
test('a real (non-fixture) prospect is still routed to the real, policy-checked fetcher',async()=>{
 const r=new MemoryRepo();r.website='https://real-company.example/';
 const {calls,fetcher:real}=spyRealFetcher();
 await assert.rejects(new CompanyAnalysisService(r,createCompositePageFetcher(real)).analyze_company('accepted'),/ANALYSIS_FAILED/);
 assert.deepEqual(calls,['https://real-company.example/']);
});
test('a spoofed non-fixture-looking host is never treated as a fixture',()=>{
 assert.equal(isFixtureUrl('http://127.0.0.1/'),false);
 assert.equal(isFixtureUrl('https://burger.fixture.example.evil.com/'),false);
 assert.equal(isFixtureUrl('https://alpha.fixture.example/'),true);
});
test('existing SSRF protections are untouched for the real fetcher path',()=>{
 assert.throws(()=>validateUrl('http://127.0.0.1/'),/non-public IP/i);
 assert.throws(()=>validateUrl('http://localhost/'),/Localhost is forbidden/);
});

// --- 4, 5, 6. Fixture analysis produces observations, never auto-VERIFIED, score stays 0 ---
test('analyzing a fixture prospect produces real observations from its deterministic page',async()=>{
 const r=new MemoryRepo();r.website='https://alpha.fixture.example/';r.criteria=SAAS_CRITERIA;
 const real=async(_url:string)=>{throw Error('UNEXPECTED_REAL_FETCH')};
 const result=await new CompanyAnalysisService(r,createCompositePageFetcher(real)).analyze_company('accepted','test_fixture');
 assert.ok(result.pages_analyzed>=1);
 assert.ok(r.observations.length>0);
 // The only deterministic SaaS-agnostic rule is the phone -> contactability mapping (see
 // strategies/contact-channel.ts) — every other criterion can only ever reach OBSERVED with a
 // real value through a criterion-less contextual note (criterion===null), never on its own.
 assert.ok(r.observations.every(o=>o.status!=='OBSERVED'||o.criterion===null||o.criterion==='contactability'));
 assert.ok(r.observations.every(o=>o.criterion===null||SAAS_CRITERIA.some(c=>c.key===o.criterion)));
});
test('no fixture observation is ever auto-VERIFIED, and the score stays 0 before human review',async()=>{
 const r=new MemoryRepo();r.website='https://alpha.fixture.example/';r.criteria=SAAS_CRITERIA;
 const real=async(_url:string)=>{throw Error('UNEXPECTED_REAL_FETCH')};
 await new CompanyAnalysisService(r,createCompositePageFetcher(real)).analyze_company('accepted','test_fixture');
 const proposed=new EvidenceProposalService().propose(r.observations,SAAS_CRITERIA);
 assert.ok(proposed.every(e=>e.status!=='VERIFIED'));
 assert.equal(scoreProspect(SAAS_CRITERIA,proposed).score,0);
});

// --- 7. After human review, a valid proposal can contribute to the score via the existing engine ---
test('after human review of a valid proposal, the evidence contributes to the score per its weight',()=>{
 // A hand-built OBSERVED signal, at an arbitrary weight, exercising the general propose/score engine
 // in isolation from any specific extraction rule (the real phone -> contactability rule is covered
 // end-to-end, from the actual fixture page, by the next test below).
 const criteria:Criterion[]=[{key:'contactability',label:'Canal de contact professionnel documenté',weight:40},...SAAS_CRITERIA.filter(c=>c.key!=='contactability').map(c=>({...c,weight:20}))];
 const observation:Observation={criterion:'contactability',observation_type:'CONTACT_CHANNEL',claim:'Téléphone, email et formulaire de contact explicitement proposés',value:true,status:'OBSERVED',source_url:'https://alpha.fixture.example/',source_title:'TEST — Alpha Services',source_excerpt:'Notre équipe traite les demandes reçues par téléphone au 05 00 00 00 11, par email et par formulaire de contact.',source_type:'test_fixture',confidence:.9,collected_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),content_hash:'hash-contact'};
 const proposed=new EvidenceProposalService().propose([observation],criteria);
 assert.equal(proposed.length,1);
 assert.equal(scoreProspect(criteria,proposed).score,0,'not verified yet');
 const verified=proposed.map(e=>({...e,status:'VERIFIED',verified_by:'human-reviewer'}));
 assert.equal(scoreProspect(criteria,verified).score,40);
});

// --- The real, non-hardcoded phone -> contactability rule, end-to-end from the actual fixture page ---
test('a real PHONE_RAW extracted from the Alpha Services fixture page is proposed as contactability evidence, never auto-verified',()=>{
 const alpha=GENERIC_FIXTURE_COMPANIES.find(c=>c.name.includes('Alpha'))!;
 const observations=new ObservationService().extract(alpha.homepage,alpha.website,SAAS_CRITERIA,'test_fixture');
 const phoneObservation=observations.find(o=>o.observation_type==='PHONE_RAW');
 assert.ok(phoneObservation);
 assert.equal(phoneObservation!.criterion,'contactability');
 assert.equal(phoneObservation!.value,true);
 assert.equal(phoneObservation!.status,'OBSERVED');
 const proposed=new EvidenceProposalService().propose(observations,SAAS_CRITERIA);
 const contactProposal=proposed.find(e=>e.criterion==='contactability');
 assert.ok(contactProposal);
 assert.equal(contactProposal!.status,'NOT_VERIFIED');
 assert.equal(scoreProspect(SAAS_CRITERIA,proposed).score,0,'no point before human confirmation');
 const verified=proposed.map(e=>e.criterion==='contactability'?{...e,status:'VERIFIED',verified_by:'human-reviewer'}:e);
 assert.equal(scoreProspect(SAAS_CRITERIA,verified).breakdown.find(b=>b.key==='contactability')!.points,20);
});
test('without a contactability-like criterion in the ICP, the same phone number stays a contextual note',()=>{
 const alpha=GENERIC_FIXTURE_COMPANIES.find(c=>c.name.includes('Alpha'))!;
 const observations=new ObservationService().extract(alpha.homepage,alpha.website,FOODATOI_CRITERIA,'test_fixture');
 const phoneObservation=observations.find(o=>o.observation_type==='PHONE_RAW');
 assert.ok(phoneObservation);
 assert.equal(phoneObservation!.criterion,null);
 assert.equal(phoneObservation!.value,null);
 assert.equal(new EvidenceProposalService().propose(observations,FOODATOI_CRITERIA).length,0);
});

// --- The real, non-hardcoded explicit-event -> commercial_signal rule, from the actual fixture page ---
test('a real recruiting event extracted from the Nova Assistance fixture page is proposed as commercial_signal evidence, never auto-verified',()=>{
 const nova=GENERIC_FIXTURE_COMPANIES.find(c=>c.name.includes('Nova'))!;
 const observations=new ObservationService().extract(nova.homepage,nova.website,SAAS_CRITERIA,'test_fixture');
 const signalObservation=observations.find(o=>o.observation_type==='RECRUITING_SIGNAL');
 assert.ok(signalObservation);
 assert.equal(signalObservation!.criterion,'commercial_signal');
 assert.equal(signalObservation!.value,true);
 assert.equal(signalObservation!.status,'OBSERVED');
 const proposed=new EvidenceProposalService().propose(observations,SAAS_CRITERIA);
 const signalProposal=proposed.find(e=>e.criterion==='commercial_signal');
 assert.ok(signalProposal);
 assert.equal(signalProposal!.status,'NOT_VERIFIED');
 assert.equal(scoreProspect(SAAS_CRITERIA,proposed).score,0,'no point before human confirmation');
 const verified=proposed.map(e=>e.criterion==='commercial_signal'?{...e,status:'VERIFIED',verified_by:'human-reviewer'}:e);
 assert.equal(scoreProspect(SAAS_CRITERIA,verified).breakdown.find(b=>b.key==='commercial_signal')!.points,25,'uses the ICP\'s own weight, never a hardcoded one');
});
test('target_fit and need_fit never receive a value from Nova\'s real fixture page — no deterministic rule exists for them',()=>{
 const nova=GENERIC_FIXTURE_COMPANIES.find(c=>c.name.includes('Nova'))!;
 const observations=new ObservationService().extract(nova.homepage,nova.website,SAAS_CRITERIA,'test_fixture');
 const proposed=new EvidenceProposalService().propose(observations,SAAS_CRITERIA);
 for(const key of ['target_fit','need_fit']){
  assert.ok(observations.filter(o=>o.criterion===key).every(o=>o.status!=='OBSERVED'));
  assert.equal(proposed.filter(e=>e.criterion===key).length,0);
 }
});

// --- 10. No contamination between Test SaaS and Foodatoi on the new fixture pages ---
test('the same fixture page analyzed under two different ICPs never contaminates their criteria',()=>{
 const alphaHtml=GENERIC_FIXTURE_COMPANIES[0].homepage;
 const saasRun=new ObservationService().extract(alphaHtml,'https://alpha.fixture.example/',SAAS_CRITERIA,'test_fixture');
 const foodatoiRun=new ObservationService().extract(alphaHtml,'https://alpha.fixture.example/',FOODATOI_CRITERIA,'test_fixture');
 assert.ok(!saasRun.some(o=>FOODATOI_CRITERIA.some(c=>c.key===o.criterion)));
 assert.ok(!foodatoiRun.some(o=>SAAS_CRITERIA.some(c=>c.key===o.criterion)));
});

// --- 11. Arbitrary dynamic criteria work against fixture content without any hardcoded sector logic ---
test('a brand-new, never-hardcoded criterion can surface a non-conclusive candidate from fixture content',()=>{
 const criteria:Criterion[]=[{key:'client_request_handling',label:'Gestion des demandes clients',weight:100}];
 const alphaHtml=GENERIC_FIXTURE_COMPANIES[0].homepage;
 const observations=new ObservationService().extract(alphaHtml,'https://alpha.fixture.example/',criteria,'test_fixture');
 const match=observations.find(o=>o.criterion==='client_request_handling');
 assert.ok(match,'a candidate excerpt is surfaced for human review');
 assert.equal(match!.status,'INFERRED');
 assert.equal(match!.value,null);
 assert.equal(new EvidenceProposalService().propose(observations,criteria).length,0);
});
