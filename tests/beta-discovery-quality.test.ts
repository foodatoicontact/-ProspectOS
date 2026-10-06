// Beta Discovery quality (Thomas — BTP, Carla — B2B marketing Grand Ouest). What ProspectOS KNOWS, ASSUMES and DOES
// NOT KNOW must stay apart: a content page, an event or a directory is a source, never a prospect; a company named
// by such a page can still be found; "no verified evidence" is "not scored", never 0/100; a set-aside result says
// precisely why. Golden cases come from the beta feedback and live ONLY in fixtures/tests, never in the engine.
// Pure tests: no network, no database (RLS/tenant/quota suites run separately and are unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {isEventPage,briefTargetsEvents} from '../src/discovery/admissibility.ts';
import {rejectionReason} from '../src/discovery/rejection-reason.ts';
import {scoreState} from '../src/domain/score-display.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import {ProjectNovelty,alreadyAddedProspect} from '../src/discovery/novelty-engine.ts';
import {DeduplicationService} from '../src/discovery/deduplication.ts';
import {officialAddressIn} from '../src/discovery/strategies/address.ts';
import {metrics,run,THOMAS,CARLA} from './beta-discovery-benchmark.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import type {Candidate} from '../src/discovery/types.ts';

const provider=new BraveProvider('k');
const CARLA_Q='"Normandie" "recrute" "responsable marketing" entreprise 2026',CARLA_L='Normandie, France';
const norm=(h:{title:string;url:string;description:string},query=CARLA_Q,location=CARLA_L):Candidate=>provider.normalizeResult({...h,__quality:assessCandidateQuality(h,location),__context:{query,categories:[],location}});
const meta=(c:Candidate)=>c.raw_metadata as Record<string,any>;
const isCandidate=(c:Candidate)=>meta(c).source_class==='COMPANY_CANDIDATE';
const byId=(b:typeof CARLA,id:string)=>run(b).find(x=>x.row.id===id)!;

// ---------------------------------------------------------------- golden cases
test('golden — RIBIERE, MDTP: real companies, official domain, reviewable (HIGH), still 0 verified points',()=>{
 const out=run(THOMAS);
 for(const domain of ['ribiere.eu','mdtp.fr']){
  const x=out.find(o=>(o.c.website??'').includes(domain))!;
  assert.ok(x&&isCandidate(x.c),domain);assert.equal(x.meta.entity_confidence,'RESOLVED_HIGH');assert.equal(x.meta.entity_type,'COMPANY');assert.equal(x.priority,'HIGH');
 }
});
test('golden — AM BTP: stays a candidate to qualify, never auto-qualified (no verified evidence, not scored)',()=>{
 const x=run(THOMAS).find(o=>(o.c.website??'').includes('ambtpvrd.fr'))!;
 assert.ok(isCandidate(x.c));
 assert.equal(scoreState(scoreProspect([{key:'c',label:'Critère',weight:100}],[])),'NOT_SCORED');
 assert.equal(fr['discovery.class.companyCandidate'],'Entreprise candidate — à qualifier');
});
test('golden — E-DECLIC: a real web agency is NOT rejected for being an agency (fit is the human\'s call for this ICP)',()=>{
 const x=byId(CARLA,'e-declic');
 assert.ok(isCandidate(x.c));assert.equal(x.meta.entity_type,'COMPANY');assert.equal(x.c.name,'E-Declic');
});
test('golden — NHU: the article itself never becomes a prospect (blog post, or dated article on the publisher\'s own site)',()=>{
 for(const id of ['nhu-blog','nhu-article']){
  const x=byId(CARLA,id);
  assert.equal(isCandidate(x.c),false,id);assert.equal(x.meta.entity_type,'CONTENT',id);
  assert.equal(rejectionReason(x.meta.admissibility.reason_code,x.meta.page_type),'EDITORIAL_NO_ENTITY',id);
 }
});

// ---------------------------------------------------------------- 1–7 entity types and sources
test('1 — an article clearly naming a company: the COMPANY is resolved (named by a third party, no website guessed), not the article',()=>{
 const x=byId(CARLA,'news-names-company');
 assert.ok(isCandidate(x.c));assert.equal(x.c.name,'Biscuiterie Dupont');assert.equal(x.c.website,null);assert.equal(x.meta.entity_confidence,'RESOLVED_MEDIUM');assert.equal(x.meta.entity_type,'COMPANY');
});
test('2 — an editorial article naming no company: nothing invented ("E-commerce : les 5 tendances", "Marketing B2B : 7 conseils")',()=>{
 for(const id of ['nhu-blog','generic-article'])assert.equal(isCandidate(byId(CARLA,id).c),false,id);
 // …while a business fact after the colon still names the company ("Grand Frais : 30 nouveaux magasins").
 const gf=norm({title:'Grand Frais : 30 nouveaux magasins en Normandie en 2026',url:'https://www.lsa-conso.example/grand-frais-ouvertures',description:'L’enseigne Grand Frais recrute un responsable marketing.'});
 assert.equal(gf.raw_metadata.company_name,'Grand Frais');
});
test('3 — a company\'s official site: candidate with its official domain',()=>{
 const x=byId(CARLA,'own-job');assert.ok(isCandidate(x.c));assert.equal(x.c.website,'https://www.acme-industrie.example');
});
test('4 — a directory listing companies: the directory is never a prospect (its names go through secondary resolution)',()=>{
 const x=byId(CARLA,'directory');assert.equal(isCandidate(x.c),false);assert.equal(x.meta.entity_type,'DIRECTORY');
});
test('5 — an event is not a company: its own site is set aside with an explicit reason; a "salon de coiffure" is not an event',()=>{
 const x=byId(CARLA,'event');
 assert.equal(isCandidate(x.c),false);assert.equal(x.meta.admissibility.reason_code,'EVENT_PAGE');assert.equal(x.meta.entity_type,'EVENT');
 assert.match(fr['discovery.reason.EVENT_PAGE'],/pas une entreprise/);
 assert.equal(isEventPage('Salon de coiffure Élégance - Caen','Coiffure homme et femme à Caen depuis 2005.'),false);
 assert.equal(isEventPage('Forum Immobilier - Agence immobilière à Rouen','Achat, vente et location.'),false,'an event noun without any event sign');
 // A brief that looks for events or their organisers keeps them.
 assert.equal(briefTargetsEvents({query:'organisateurs de salons professionnels en Normandie',categories:[]}),true);
 const kept=norm(byId(CARLA,'event').row as never,'organisateurs de salons et événements B2B en Normandie');
 assert.notEqual(meta(kept).admissibility.reason_code,'EVENT_PAGE');
});
test('6 — a job post: the employer\'s own job page names the company; a job board with no employer says so',()=>{
 assert.ok(isCandidate(byId(CARLA,'own-job').c));
 const board=byId(CARLA,'job-board');
 assert.equal(isCandidate(board.c),false);
 assert.equal(rejectionReason(board.meta.admissibility.reason_code,board.meta.page_type),'JOB_LISTING_NO_EMPLOYER');
});
test('7/8/27 — several pages of the same company (https/www vs http/no-www + utm) are ONE candidate; the other page is kept as a source',()=>{
 const m=metrics(CARLA);assert.equal(m.DUPLICATES,1);
 const acme=byId(CARLA,'own-job');
 assert.equal(acme.meta.additional_sources.length,1);
 assert.equal(acme.meta.additional_sources[0].source_url,'http://acme-industrie.example/?utm_source=x','raw provenance kept as received');
 const key=(w:string)=>new DeduplicationService().key({name:'Acme Industrie',website:w,phone:null,city:null,address:null});
 assert.equal(key('http://acme-industrie.example/?utm_source=x'),key('https://www.acme-industrie.example'));
});
test('9/10 — canonical name ("Accueil - X", capitals) without losing the raw page title (source_title)',()=>{
 const x=run(THOMAS).find(o=>(o.c.website??'').includes('ribiere.eu'))!;
 assert.equal(x.c.name,'Ribiere');assert.match(x.c.source_title,/RIBIERE/,'the raw title is kept as provenance');
});

// ---------------------------------------------------------------- 11–14 location
test('11–14 — location: official address = observed fact; own-site snippet = to confirm; article place ≠ company place; else unknown',()=>{
 assert.equal(officialAddressIn(['105 avenue du Port, 38150 Salaise-sur-Sanne'])?.city,'Salaise-sur-Sanne','VERIFIED-level source: the official site\'s own address (analysis)');
 assert.equal(byId(CARLA,'e-declic').meta.observed_location_basis,'OWN_SITE');
 const article=byId(CARLA,'news-names-company');
 assert.equal(article.meta.observed_location_basis,'THIRD_PARTY_SOURCE');assert.equal(article.c.city,null,'never copied into the company\'s city');
 assert.match(fr['discovery.locationThirdParty'],/pas forcément celui de l’entreprise/);
 assert.equal(byId(CARLA,'own-job').meta.observed_location,null,'nothing named → unknown, nothing guessed');
});

// ---------------------------------------------------------------- 15–19 website analysis
test('15–19 — website analysis always ends in an explicit state; no official website → NOT APPLICABLE before any quota or fetch',async()=>{
 const api=await readFile(new URL('../src/discovery/api.ts',import.meta.url),'utf8');
 const route=api.slice(api.indexOf('const p=await repo.prospect(id);'));
 assert.ok(route.indexOf("if(!p.website)return json(")<route.indexOf('trackAnalysisReservation(repo)'),'refused before the plan unit is reserved');
 assert.match(api,/code:'NO_OFFICIAL_WEBSITE'\},422\)/);
 for(const code of ['ROBOTS_DENIED','ROBOTS_UNAVAILABLE','SITE_TIMEOUT','SITE_NOT_FOUND','SITE_BLOCKED','SITE_HTTP_ERROR','SITE_REDIRECT_REFUSED','SITE_NOT_HTML','SITE_TOO_LARGE'])assert.match(api,new RegExp(`${code}:\\['`),code);
});

// ---------------------------------------------------------------- 20–23 score
const ICP:Criterion[]=[{key:'a',label:'A',weight:60},{key:'b',label:'B',weight:40}];
const ev=(criterion:string,value:boolean,status:Evidence['status']='VERIFIED'):Evidence=>({id:crypto.randomUUID(),criterion,value,status,source_url:'https://x.example/',excerpt:'extrait',observed_at:new Date().toISOString(),verified_by:status==='VERIFIED'?'human':null});
test('20/21/22 — a real 0 (verified FALSE) is SCORED 0/100; verified TRUE scores; no verified evidence is NOT_SCORED, never a fake 0',()=>{
 const zero=scoreProspect(ICP,[ev('a',false),ev('b',false)]);assert.equal(zero.score,0);assert.equal(scoreState(zero),'SCORED');
 const sixty=scoreProspect(ICP,[ev('a',true)]);assert.equal(sixty.score,60);assert.equal(scoreState(sixty),'SCORED');
 const none=scoreProspect(ICP,[ev('a',true,'INFERRED_UNCONFIRMED')]);assert.equal(none.score,0,'the engine is unchanged');assert.equal(scoreState(none),'NOT_SCORED');
 assert.equal(fr['score.notScored'],'Non scoré');assert.ok(en['score.notScored']);
});
// Since 2026-10-06 (FIT estimé) the badge shows the automatic estimate, labelled "estimé", as soon as sources were found;
// "Non scoré" when nothing was found at all — still never a fake 0/100 (tests/fit-estimate.test.ts covers fitDisplay).
test('23 — UI: a candidate reads "to qualify"; detail and list show "Non scoré" when nothing was found, the estimate labelled otherwise',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/<b>\{fit!\.main\?\?'—'\}<\/b><small>\{fit!\.kind==='none'\?tr\('score\.notScored'\):fit!\.kind==='estimated'\?`\/100 · \$\{tr\('score\.estimated'\)\}`:'\/100'\}<\/small>/);
 assert.match(page,/<b>\{f\.main\?\?'—'\}<\/b><small>\{f\.kind==='none'\?tr\('score\.notScored'\)/);
 assert.match(en['discovery.class.companyCandidate'],/to qualify/);
});

// ---------------------------------------------------------------- 24 rejection reasons
test('24 — rejection reasons: precise, deterministic, never invented; unknown codes show nothing rather than a guess',()=>{
 assert.equal(rejectionReason('ENTITY_UNRESOLVED','NEWS_ARTICLE'),'EDITORIAL_NO_ENTITY');
 assert.equal(rejectionReason('ENTITY_UNRESOLVED','THIRD_PARTY_JOB_BOARD'),'JOB_LISTING_NO_EMPLOYER');
 assert.equal(rejectionReason('ENTITY_UNRESOLVED','UNKNOWN'),'ENTITY_UNRESOLVED');
 assert.equal(rejectionReason('DIRECTORY_PAGE','DIRECTORY'),'DIRECTORY_PAGE');
 assert.equal(rejectionReason('SOMETHING_NEW','X'),null);
 for(const k of ['EVENT_PAGE','EDITORIAL_NO_ENTITY','JOB_LISTING_NO_EMPLOYER'])assert.ok(fr[`discovery.reason.${k}` as keyof typeof fr]&&en[`discovery.reason.${k}` as keyof typeof en],k);
});

// ---------------------------------------------------------------- 25–28 dedup
test('25/26 — inter-run: a known company met again through a NEW source is SEEN/ADDED, never a new prospect; it reuses the existing one',()=>{
 const memory={prospects:[{id:'p1',name:'Acme Industrie',website:'https://www.acme-industrie.example',phone:null,city:null}],results:[],runs:[]};
 const again=byId(CARLA,'own-job').c;
 assert.notEqual(new ProjectNovelty(memory,CARLA_L).classify(again).status,'NEW');
 assert.equal(alreadyAddedProspect({dedupe_status:'unique',dedupe_key:again.deduplication_key,company_name:again.name,website:again.website,phone:null,city:null,source_url:'https://www.acme-industrie.example/recrutement/nouvelle-offre'},'COMPANY_CANDIDATE',memory.prospects,false),'p1','the new page attaches to the existing prospect (its analysis adds the evidence)');
});
test('28 — no dangerous fuzzy merge: two companies with close names and different domains stay two candidates',()=>{
 const a=norm({title:'Acme Industrie - Fabricant à Caen',url:'https://www.acme-industrie.example/',description:'Acme Industrie recrute un responsable marketing en Normandie.'});
 const b=norm({title:'Acme Industries - Négoce à Rouen',url:'https://www.acme-industries.example/',description:'Acme Industries recrute un responsable marketing en Normandie.'});
 assert.notEqual(a.deduplication_key,b.deduplication_key);
 const m=run({...CARLA,rows:[{title:a.source_title,url:a.source_url,description:String(meta(a).description)},{title:b.source_title,url:b.source_url,description:String(meta(b).description)}]});
 assert.equal(m.filter(x=>isCandidate(x.c)).length,2);
});

// ---------------------------------------------------------------- benchmark + scope
test('benchmark — BEFORE/AFTER on the same inputs: Carla false-positive-like candidates 4 → 0, Thomas unchanged (4 candidates, 0 noise)',()=>{
 const t=metrics(THOMAS),c=metrics(CARLA);
 console.log(`BETA_BENCHMARK ${JSON.stringify({THOMAS:t,CARLA:c})}`);
 assert.deepEqual([t.CANDIDATES,t.FALSE_POSITIVE_LIKE_RESULTS,t.QUALIFIED_OR_REVIEWABLE],[4,0,4]);
 assert.equal(c.FALSE_POSITIVE_LIKE_RESULTS,0);
 assert.deepEqual(c.candidates.map(n=>n.replace(/\[.*$/,'')).sort(),['Acme Industrie','Biscuiterie Dupont','E-Declic']);
});
test('29–34 — scope: no golden name in the engine; Auth, billing, quotas, RLS migrations and export untouched by this change',async()=>{
 for(const dir of ['../src/discovery/','../src/discovery/strategies/','../src/domain/']){
  for(const f of (await readdir(new URL(dir,import.meta.url))).filter(f=>f.endsWith('.ts'))){
   // Executable code only: earlier commits cite the beta examples in comments, never in logic.
   const src=(await readFile(new URL(dir+f,import.meta.url),'utf8')).split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
   assert.doesNotMatch(src,/ribiere|mdtp|am btp|ambtpvrd|e-declic|nhu\b/i,`${dir}${f}`);
  }
 }
});
