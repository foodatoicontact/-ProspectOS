// Thomas iteration #3 (AppelGagnant benchmark, 2026-09-29): useful public facts are proposed under the RIGHT ICP
// criterion (never a wrong one), the official address is reported as a sourced location, cooperatives/networks are
// typed, and directories/rankings become SECONDARY SOURCES of company names — resolved on their own official site
// through the normal pipeline, never added because a page cites them. Evidence-first is unchanged throughout.
// Pure tests: no network (the provider is a fake fetch), no database.
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {ICP_SIGNAL_PREFIX} from '../src/discovery/strategies/icp-concepts.ts';
import {INTENT_NOTE_TYPES} from '../src/discovery/strategies/icp-intents.ts';
import {officialAddressIn,addressCity} from '../src/discovery/strategies/address.ts';
import {CompanyAnalysisService,DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';
import {reviewPriority} from '../src/discovery/review-priority.ts';
import {citedCompanyNames,planSecondaryExpansion,resolveSecondaryCandidates,secondaryQuery,MAX_NAMES_PER_SOURCE,MAX_SECONDARY_NAMES} from '../src/discovery/secondary-sources.ts';
import {planSearchQueries} from '../src/discovery/query-plan.ts';
import {MAX_PROVIDER_CALLS} from '../src/discovery/search-until-new.ts';
import {scoreProspect,type Criterion} from '../src/domain/core.ts';
import type {Candidate,DiscoveryInput,DiscoveryResult,DiscoveryRun,Observation} from '../src/discovery/types.ts';

const NOW=new Date('2026-09-29T10:00:00Z');
// Thomas's real ICP (AppelGagnant — BTP marchés publics), weights 30/35/25/10. Keys are user-created.
const SIZE:Criterion={key:'c_size',label:'Entreprise française du BTP structurée, environ 10 à 100 salariés, priorité Auvergne-Rhône-Alpes',weight:30};
const TENDER:Criterion={key:'c_tender',label:"Répond régulièrement aux marchés publics, appels d'offres ou DCE",weight:35};
const REFS:Criterion={key:'c_refs',label:'Références avec collectivités, bailleurs sociaux ou établissements publics',weight:25};
const DM:Criterion={key:'c_dm',label:'Contact professionnel décisionnaire documenté',weight:10};
const THOMAS=[SIZE,TENDER,REFS,DM];
// Another beta ICP (property development) where the wrong mappings were observed.
const FIT:Criterion={key:'c_fit',label:'Adéquation promotion immobilière / aménagement / foncier',weight:30};
const ACT:Criterion={key:'c_act',label:"Activité réelle de montage et développement d'opérations",weight:30};
const RECRUIT_DEFAULT:Criterion={key:'commercial_signal',label:'Signal de recrutement / alternance / croissance',weight:20};
const RECRUIT:Criterion={key:'c_recruit',label:'Signal de recrutement / alternance / croissance',weight:20};
const CONTACT:Criterion={key:'c_contact',label:'Contact professionnel joignable',weight:20};

const html=(lines:string[])=>`<html><head><title>Fixture BTP</title></head><body>${lines.map(l=>`<p>${l}</p>`).join('')}</body></html>`;
const SITE='https://www.entreprise-btp-fictive.example/';
const extract=(lines:string[],criteria:Criterion[],sourceType:Observation['source_type']='official_website')=>new ObservationService().extract(html(lines),SITE,criteria,sourceType,NOW);
const proposal=(obs:Observation[],c:Criterion)=>obs.find(o=>o.criterion===c.key&&o.value===true);
const noProposal=(obs:Observation[],c:Criterion)=>assert.equal(proposal(obs,c),undefined,`no proposal expected for « ${c.label} »`);

// A fictional BTP company site, written like Ribiere's official pages (public facts of the benchmark report).
const RIBIERE_LIKE=[
 'Entreprise générale de bâtiment et de génie civil.',
 "100 collaborateurs, 21 millions d'euros de chiffre d'affaires et plus de 200 projets réalisés.",
 '105 avenue du Port, 38150 Salaise-sur-Sanne',
 "Maître d'ouvrage : Grenoble Alpes Métropole",
 'Médiathèque — Ville de Vaulx-en-Velin — gros œuvre en béton architectonique, livrée en 2022',
 'Tél : 04 74 00 00 00',
];

// ================================================================ 10 — Ribiere non-regression
test('10.1 — "Maître d\'ouvrage : Grenoble Alpes Métropole" → proposed under the public-references criterion, source kept, INFERRED, human confirms',()=>{
 const obs=extract(RIBIERE_LIKE,THOMAS);
 const p=proposal(obs,REFS);
 assert.ok(p,'public reference proposed');
 assert.equal(p.observation_type,ICP_SIGNAL_PREFIX+REFS.key);
 assert.equal(p.status,'INFERRED');
 assert.equal(p.source_url,SITE);
 assert.match(p.source_excerpt,/Grenoble Alpes Métropole|Vaulx-en-Velin/);
 // Observation (the excerpt) and interpretation (the claim) are kept apart.
 assert.match(p.claim,/acteur public/);assert.match(p.claim,/à confirmer par un humain/);
 assert.ok(obs.every(o=>(o.status as string)!=='VERIFIED'));
});
test('10.2 — the real Ribiere snippet "Maitre d’ouvrage REGION AUVERGNE RHONE ALPES" is a public reference; a region named alone is not',()=>{
 assert.ok(proposal(extract(['Travaux de Gros œuvre : Démolition, Réhabilitation et Construction neuve Maitre d’ouvrage REGION AUVERGNE RHONE ALPES Architecte CHABAL Architectes Montant du projet : 3 M€'],[REFS]),REFS));
 assert.ok(proposal(extract(['Ville de Vaulx-en-Velin'],[REFS]),REFS),'an unambiguous public body standing alone (references table cell)');
 noProposal(extract(['Région Auvergne-Rhône-Alpes'],[REFS]),REFS);
});
test('10.3 — a place is not a public client: "dans la région", "sur la commune de", "la métropole lyonnaise", "son agglomération… clients privés"',()=>{
 for(const line of ['Nous intervenons dans la région Rhône-Alpes sur tous types de chantiers.','Chantier de maison individuelle sur la commune de Vienne.','Nos projets dans la métropole lyonnaise.',
  'Nous travaillons principalement sur Lyon et son agglomération et suivons nos clients privés sur toute la France.','Chantier livré en parfait état.'])
  noProposal(extract([line],[REFS]),REFS);
});
test('10.4 — "100 collaborateurs" → proposed under the size criterion (range 10–100 of the label); "270 professionnels" → note only',()=>{
 const p=proposal(extract(RIBIERE_LIKE,THOMAS),SIZE);
 assert.ok(p);assert.match(p.source_excerpt,/100 collaborateurs/);assert.equal(p.status,'INFERRED');
 const coop=extract(['Cabestan, coopérative de 270 professionnels et plus de 60 métiers.'],[SIZE]);
 noProposal(coop,SIZE);
 const note=coop.find(o=>o.criterion===SIZE.key&&o.observation_type===INTENT_NOTE_TYPES.insufficient);
 assert.ok(note,'kept as a contextual note explaining why');assert.equal(note.value,null);assert.match(note.claim,/hors de la fourchette/);
});
test('10.5 — explicit official address → sourced OFFICIAL_ADDRESS observation (department from the postal code), never a criterion',()=>{
 const a=extract(RIBIERE_LIKE,THOMAS).find(o=>o.observation_type==='OFFICIAL_ADDRESS');
 assert.ok(a);assert.equal(a.criterion,null);assert.equal(a.value,null);assert.equal(a.source_url,SITE);
 assert.match(a.claim,/38150 Salaise-sur-Sanne \(Isère, Auvergne-Rhône-Alpes\)/);
 const parsed=officialAddressIn(['105 avenue du Port, 38150 Salaise-sur-Sanne']);
 assert.equal(parsed&&addressCity(parsed),'Salaise-sur-Sanne (Isère)');
 // Not an address: no street, or no postal code — nothing is geocoded or guessed.
 assert.equal(officialAddressIn(['Nous intervenons en Isère et dans le Rhône.']),null);
 assert.equal(officialAddressIn(['Siège : Salaise-sur-Sanne']),null);
});
test('10.6 — analysis reports the official address to the prospect card (fill-if-empty), only for the official website',async()=>{
 const filled:Array<[string,string]>=[];
 const repo={prospect:async()=>({id:'p1',website:SITE,organization_id:'o',project_id:'pr'}),projectCriteria:async()=>THOMAS,consumeAnalysis:async()=>{},saveObservations:async(_:string,o:Observation[])=>o,fillProspectCity:async(id:string,city:string)=>{filled.push([id,city])}} as unknown as DiscoveryRepository;
 const page={url:SITE,html:html(RIBIERE_LIKE)};
 await new CompanyAnalysisService(repo,async()=>page).analyze_company('p1','official_website');
 assert.deepEqual(filled,[['p1','Salaise-sur-Sanne (Isère)']]);
 filled.length=0;
 await new CompanyAnalysisService(repo,async()=>page).analyze_company('p1','test_fixture');
 assert.deepEqual(filled,[],'a fixture or third-party page never fills the city');
 filled.length=0;
 await new CompanyAnalysisService(repo,async()=>({url:SITE,html:html(['Entreprise générale de bâtiment.'])})).analyze_company('p1','official_website');
 assert.deepEqual(filled,[],'no explicit address → nothing reported');
});

// ================================================================ 11 — mandatory negatives
test('11.1 — "Appel d\'offres" ≠ recruiting/growth signal (default key and user key), and alone ≠ "répond aux marchés publics"',()=>{
 for(const c of [RECRUIT_DEFAULT,RECRUIT])noProposal(extract(["Appel d'offres"],[c]),c);
 noProposal(extract(["Appel d'offres",'Actualités'],[TENDER]),TENDER);
 // …while the signal the label asks for still matches, and an explicit tender practice is proposed.
 assert.ok(proposal(extract(['Nous recrutons des conducteurs de travaux.'],[RECRUIT_DEFAULT]),RECRUIT_DEFAULT));
 assert.ok(proposal(extract(["Nous répondons régulièrement aux appels d'offres des collectivités."],[TENDER]),TENDER));
});
test('11.2 — "Parrainage" ≠ property-development fit; "Ateliers d\'étudiants" ≠ real operations activity',()=>{
 noProposal(extract(['Parrainage'],[FIT]),FIT);
 noProposal(extract(["Ateliers d'étudiants"],[ACT]),ACT);
 noProposal(extract(['Parrainage',"Ateliers d'étudiants"],[FIT,ACT]),ACT);
});
test('11.3 — professional phone and contact@ ≠ identifiable decision-maker; "Nous contacter" = contact channel, not recruiting',()=>{
 const obs=extract(['Tél : 04 74 00 00 00','contact@entreprise.fr','Nous contacter'],[DM,CONTACT,RECRUIT_DEFAULT]);
 noProposal(obs,DM);noProposal(obs,RECRUIT_DEFAULT);
 assert.ok(proposal(obs,CONTACT),'a real contact-channel criterion still receives the channel');
});
test('11.4 — WRONG_ICP_MAPPINGS = 0 on the whole negative set (every line against every criterion it must not satisfy)',()=>{
 const cases:Array<[string,Criterion[]]>=[
  ["Appel d'offres",[RECRUIT_DEFAULT,RECRUIT,TENDER,REFS,DM]],['Parrainage',[FIT,ACT,REFS,TENDER]],["Ateliers d'étudiants",[ACT,FIT,SIZE]],
  ['Tél : 04 74 00 00 00',[DM,REFS,TENDER,SIZE]],['contact@entreprise.fr',[DM,REFS,TENDER]],['Nous contacter',[DM,RECRUIT_DEFAULT,RECRUIT,TENDER]],
  ['Nous intervenons dans la région Rhône-Alpes.',[REFS]],['Entreprise générale de bâtiment et de génie civil.',[REFS,TENDER,DM]],
 ];
 let wrong=0;for(const [line,cs] of cases)for(const c of cs)if(proposal(extract([line],[c]),c))wrong++;
 assert.equal(wrong,0);
});

// ================================================================ 14 — evidence-first
test('14 — nothing auto-verified: INFERRED proposals are INFERRED_UNCONFIRMED, 0/100 before review, the exact weights after',()=>{
 const obs=extract(RIBIERE_LIKE,THOMAS);
 const evidence=new EvidenceProposalService().propose(obs,THOMAS);
 assert.ok(evidence.length>=2);
 assert.ok(evidence.every(e=>e.status==='INFERRED_UNCONFIRMED'&&e.verified_by===null));
 assert.equal(scoreProspect(THOMAS,evidence,NOW).score,0,'UNREVIEWED_SCORE = 0');
 assert.equal(scoreProspect(THOMAS,evidence.map(e=>({...e,verified_by:'forged'})),NOW).score,0);
 const confirmed=evidence.map(e=>({...e,status:'VERIFIED' as const,verified_by:'human-1'}));
 assert.equal(scoreProspect(THOMAS,confirmed,NOW).score,55,'size 30 + references 25 — Thomas’s manual result, only after human confirmation');
});

// ================================================================ 8 — entity types
const provider=new BraveProvider('benchmark-key');
const ARA='Auvergne-Rhône-Alpes, France';
const QUERY='entreprises BTP structurées gros œuvre maçonnerie travaux publics VRD marchés publics';
const normalize=(hit:{title:string;url:string;description?:string},query=QUERY,location=ARA):Candidate=>provider.normalizeResult({...hit,__quality:assessCandidateQuality(hit,location),__context:{query,categories:[],location}});
const meta=(c:Candidate)=>c.raw_metadata as Record<string,any>;
test('8 — Cabestan-like cooperative: identified, typed COOPERATIVE, never HIGH review priority; a company stays COMPANY',()=>{
 const coop=normalize({title:"Cabestan - Coopérative d'artisans du bâtiment en Auvergne-Rhône-Alpes",url:'https://www.cabestan.example/',description:'Cabestan, coopérative de 270 professionnels et plus de 60 métiers du bâtiment : gros œuvre, maçonnerie, rénovation en Auvergne-Rhône-Alpes.'});
 assert.equal(meta(coop).source_class,'COMPANY_CANDIDATE','still visible, correctly identified');
 assert.equal(meta(coop).entity_type,'COOPERATIVE');
 const prio=reviewPriority(meta(coop),coop.website);
 assert.notEqual(prio.level,'HIGH');assert.ok(prio.reasons.includes('cooperative_or_network'));
 const company=normalize({title:'Entreprise générale de bâtiment - RIBIERE',url:'https://www.ribiere.example/',description:"Travaux de Gros œuvre : Démolition, Réhabilitation et Construction neuve Maitre d’ouvrage REGION AUVERGNE RHONE ALPES"});
 assert.equal(meta(company).entity_type,'COMPANY');
 assert.equal(meta(normalize({title:'Annuaire entreprise de BTP en Auvergne-Rhône-Alpes - EPRO Bâtiment',url:'https://batiment.e-pro.example/entreprise-de-btp/region.html',description:'995 entreprises de BTP sont référencées'})).entity_type,'DIRECTORY');
 assert.equal(meta(normalize({title:'Entreprise de btp à vendre en Auvergne-Rhône-Alpes',url:'https://reprise.example/entreprise-btp-a-vendre/ara',description:'Annonces de cession'})).entity_type,'MARKETPLACE');
});

// ================================================================ 12 — secondary sources
const RANKING={title:'Top 10 des entreprises BTP en Auvergne-Rhône-Alpes',url:'https://www.classement-btp.example/top-entreprises-btp-aura',description:'Notre classement : 1. Alpha Construction · 2. Beta TP · 3. Gamma VRD · 4. Delta Bâtiment'};
test('12.1 — the ranking itself is NOT a company candidate, but the companies it names become secondary entity candidates (max 3 per source)',()=>{
 const ranking=normalize(RANKING);
 assert.notEqual(meta(ranking).source_class,'COMPANY_CANDIDATE');
 assert.deepEqual(citedCompanyNames(ranking).map(n=>n.name),['Alpha Construction','Beta TP','Gamma VRD']);
 assert.equal(MAX_NAMES_PER_SOURCE,3);
});
test('12.2 — generic names, place names, the listing site itself and already-known companies are rejected before any request',()=>{
 const page=normalize({title:'Top 20 des gros œuvres en Auvergne-Rhône-Alpes - Obat',url:'https://travaux.obat.example/gros-oeuvre/ara',description:'1. Entreprise BTP · 2. Maçonnerie Générale · 3. Grenoble · 4. Obat · 5. Omega Bâtisseurs'});
 assert.deepEqual(citedCompanyNames(page).map(n=>n.name),['Omega Bâtisseurs']);
 const plan=planSecondaryExpansion([normalize(RANKING)],[{name:'Beta TP'}]);
 assert.deepEqual(plan.names.map(n=>n.name),['Alpha Construction','Gamma VRD'],'Beta TP is already a prospect of the project');
 assert.equal(plan.skippedKnown,1);
});
test('12.3 — global limit, deduplication across sources, and no recursion',()=>{
 const pages=[1,2,3].map(i=>normalize({...RANKING,url:`https://www.classement-btp.example/top-${i}`,description:`1. Alpha Construction · 2. Nord${i} Bâtisseurs · 3. Sud${i} Travaux`}));
 const plan=planSecondaryExpansion(pages,[]);
 assert.equal(plan.names.length,MAX_SECONDARY_NAMES);
 assert.equal(plan.names.filter(n=>n.name==='Alpha Construction').length,1);
 // A result that itself came from an expansion never triggers another one.
 const derived={...normalize(RANKING),raw_metadata:{...normalize(RANKING).raw_metadata,secondary_origin:{name:'x',source_url:'u',source_title:'t',cited_name:'x',depth:1}}};
 assert.deepEqual(citedCompanyNames(derived),[]);
 assert.equal(secondaryQuery(plan.names.slice(0,2)),'"Alpha Construction" OR "Nord1 Bâtisseurs"');
});
test('12.4 — resolution keeps only a cited company found on its OWN official site; a non-resolvable name is rejected',()=>{
 const names=planSecondaryExpansion([normalize(RANKING)],[]).names;
 const found=[
  normalize({title:'Alpha Construction - Entreprise de gros œuvre et maçonnerie à Lyon',url:'https://www.alpha-construction.example/',description:'Alpha Construction, entreprise BTP de gros œuvre et maçonnerie en Auvergne-Rhône-Alpes, répond aux marchés publics.'}),
  normalize({title:'Omega Plomberie - plombier à Lyon',url:'https://www.omega-plomberie.example/',description:'Plomberie et chauffage à Lyon.'}),
  normalize(RANKING),
 ];
 const {resolved,unresolved}=resolveSecondaryCandidates(found,names);
 assert.deepEqual(resolved.map(r=>r.name),['Alpha Construction']);
 assert.equal(meta(resolved[0]!).secondary_origin.cited_name,'Alpha Construction');
 assert.equal(meta(resolved[0]!).secondary_origin.source_url,RANKING.url);
 assert.equal(unresolved,names.length-1,'Beta TP, Gamma VRD: not found on an official site → rejected');
});

// DiscoveryService end to end with the real Brave provider on a fake fetch: one extra request at most, inside the run budget.
type Stored={candidate:Candidate};
function repo(known:Array<{name:string;website:string}>=[]){
 const saved:Stored[]=[];let metrics:Record<string,unknown>={};
 const r:DiscoveryRepository={
  start:async()=>({id:'run-1',provider:'brave',status:'running',result_count:0,error_message:null}) as DiscoveryRun,
  existing:async()=>known.map((k,i)=>({id:`p${i}`,name:k.name,website:k.website,city:null,phone:null,address:null})),
  saveResults:async(_run,rows)=>{saved.push(...rows.map(x=>({candidate:x.candidate})));return rows.map((x,i)=>({id:`r${i}`,normalized_payload:x.candidate,dedupe_status:x.dedupe.status,duplicate_of:null,status:'pending',prospect_id:null,source_class:x.candidate.raw_metadata.source_class as DiscoveryResult['source_class']}))},
  finish:async(_id,_n,m)=>{metrics=m},prospect:async()=>{throw Error('unused')},projectCriteria:async()=>[],consumeAnalysis:async()=>{},saveObservations:async()=>[],
 };
 return {r,saved,metrics:()=>metrics};
}
const brave=(urls:string[])=>new BraveProvider('KEY',(async(url:URL)=>{
 urls.push(String(url));const q=url.searchParams.get('q')??'';
 const results=q.includes('"')
  ?[{title:'Alpha Construction - Entreprise de gros œuvre et maçonnerie à Lyon',url:'https://www.alpha-construction.example/',description:'Alpha Construction, entreprise BTP de gros œuvre et maçonnerie en Auvergne-Rhône-Alpes.'},
    {title:'Omega Plomberie - plombier à Lyon',url:'https://www.omega-plomberie.example/',description:'Entreprise BTP de plomberie à Lyon.'}]
  :[RANKING,{title:'Entreprise générale de bâtiment - RIBIERE',url:'https://www.ribiere.example/',description:'Entreprise BTP de gros œuvre et maçonnerie. Maitre d’ouvrage REGION AUVERGNE RHONE ALPES'}];
 return new Response(JSON.stringify({web:{results}}),{status:200});
}) as unknown as typeof fetch);
const INPUT={project_id:'p',query:'entreprises BTP gros œuvre',location:ARA,categories:[],max_results:20,optional_filters:{}};
test('12.5 — end to end: ranking → 1 resolution request → the cited company found on its own site joins the results as a normal candidate',async()=>{
 assert.ok(planSearchQueries(INPUT).queries.length<MAX_PROVIDER_CALLS,'this brief leaves budget for one resolution request');
 const urls:string[]=[];const {r,saved,metrics}=repo();
 await new DiscoveryService(r,brave(urls)).find_prospects(INPUT);
 const secondaryRequests=urls.filter(u=>(new URL(u).searchParams.get('q')??'').includes('"'));
 assert.equal(secondaryRequests.length,1);assert.ok(urls.length<=MAX_PROVIDER_CALLS,'never beyond the run budget');
 const alpha=saved.find(s=>s.candidate.name==='Alpha Construction');
 assert.ok(alpha);assert.equal(meta(alpha.candidate).source_class,'COMPANY_CANDIDATE');assert.equal(meta(alpha.candidate).secondary_origin.source_url,RANKING.url);
 assert.ok(meta(alpha.candidate).review_priority,'normal pipeline: review priority computed');
 assert.equal(saved.find(s=>s.candidate.name.startsWith('Omega')),undefined,'a page the expansion did not look for is never added');
 assert.ok(saved.some(s=>s.candidate.source_url===RANKING.url&&meta(s.candidate).source_class!=='COMPANY_CANDIDATE'),'the ranking stays a visible, non-candidate source');
 const m=metrics();
 assert.equal(m.secondary_sources,1);assert.equal(m.secondary_names_extracted,3);assert.equal(m.secondary_requests,1);assert.equal(m.secondary_candidates,1);assert.equal(m.secondary_unresolved,2);
});
test('12.6 — known name → no duplicate; budget already spent → no extra request',async()=>{
 const urls:string[]=[];const {r,saved,metrics}=repo([{name:'Alpha Construction',website:'https://www.alpha-construction.example/'}]);
 await new DiscoveryService(r,brave(urls)).find_prospects(INPUT);
 assert.equal(metrics().secondary_names_known,1);
 assert.equal(saved.filter(s=>s.candidate.name==='Alpha Construction').length,0,'already a prospect: never searched again');
 const spent:string[]=[];const p=brave(spent);const heavy={...INPUT,query:'entreprises BTP gros œuvre maçonnerie, travaux publics VRD, électricité plomberie CVC menuiserie',categories:['BTP','travaux publics','VRD']};
 const planned=planSearchQueries(heavy).queries.length;
 await new DiscoveryService(repo().r,p).find_prospects(heavy);
 assert.equal(spent.length,planned===MAX_PROVIDER_CALLS?MAX_PROVIDER_CALLS:planned+1);
 assert.ok(spent.length<=MAX_PROVIDER_CALLS);
});

// ================================================================ 13 — Thomas benchmark KPIs
// Evidence mapping: the Ribiere-like official pages (facts published in the benchmark report). Secondary discovery:
// the REAL 20 public results of the same market (run 79ced64b, 2026-09-27 — the 2026-09-29 run's raw results were
// not exported). Official-domain resolution needs a live provider request: not measurable offline.
test('13 — KPIs (printed): evidence mapping and secondary discovery on the Thomas benchmark',async()=>{
 const obs=extract([...RIBIERE_LIKE,'Parrainage',"Ateliers d'étudiants","Appel d'offres",'Nous contacter','contact@entreprise.fr'],[...THOMAS,FIT,ACT,RECRUIT_DEFAULT]);
 // The three useful public facts of the report: headcount, public-sector reference, official address.
 const relevant=[/100 collaborateurs/,/Grenoble Alpes Métropole|Vaulx-en-Velin/,/38150 Salaise-sur-Sanne/];
 const extracted=relevant.filter(r=>obs.some(o=>r.test(o.source_excerpt))).length;
 const mapped=obs.filter(o=>o.value===true&&[SIZE.key,REFS.key].includes(o.criterion??'')).length+(obs.some(o=>o.observation_type==='OFFICIAL_ADDRESS')?1:0);
 const wrong=obs.filter(o=>o.value===true&&[FIT.key,ACT.key,RECRUIT_DEFAULT.key,DM.key,TENDER.key].includes(o.criterion??'')).length;
 const real=JSON.parse(await readFile(new URL('./fixtures/thomas-real-run-2026-09-27.json',import.meta.url),'utf8')) as {query:string;location:string;categories:string[];rows:Array<{title:string;url:string;description:string}>};
 const context={query:real.query,categories:real.categories,location:real.location};
 const results=real.rows.map(h=>provider.normalizeResult({...h,__quality:assessCandidateQuality(h,real.location),__context:context}));
 const plan=planSecondaryExpansion(results,[],context);
 console.log(`THOMAS_KPI ${JSON.stringify({RELEVANT_OBSERVATIONS_EXTRACTED:extracted,RELEVANT_OBSERVATIONS_MAPPED_TO_ICP:mapped,WRONG_ICP_MAPPINGS:wrong,SECONDARY_SOURCES:plan.sources,ENTITY_NAMES_EXTRACTED:plan.extracted,SECONDARY_NAMES:plan.names.map(n=>n.name)})}`);
 assert.equal(wrong,0);
 assert.ok(mapped>=3);
 assert.ok(plan.sources>=2&&plan.names.length>=2);
 assert.ok(results.every(r=>meta(r).source_class!=='COMPANY_CANDIDATE'||!['DIRECTORY','BLOG_OR_CONTENT','NEWS_ARTICLE'].includes(meta(r).page_type)),'no directory or ranking in the shortlist');
});

// ================================================================ budget: "Rechercher de nouveaux acteurs" (search_new)
// 3 Brave requests per run, unchanged. After two PRIMARY_SEARCH passes, when the set-aside sources already cite
// companies to resolve, the third request is the SECONDARY_RESOLUTION instead of a third primary pass.
const OFFICIAL=(slug:string,name:string)=>({title:`${name} - Entreprise de gros œuvre et maçonnerie`,url:`https://www.${slug}.example/`,description:`${name}, entreprise BTP de gros œuvre et maçonnerie en Auvergne-Rhône-Alpes.`});
const KOMPASS={title:'Entreprises du Bâtiment en Rhône-Alpes - Kompass',url:'https://fr.kompass.example/a/batiment/rhone-alpes/',description:'GFE (Goncalves Frères Étanchéité) est une entreprise spécialisée dans l’étanchéité. Basée à Chambéry (Savoie).'};
type Hit={title:string;url:string;description:string};
let clock=0;
function newActorsRun(script:{passes:Hit[][];secondary?:Hit[]|'fail';tick?:number},known:Array<{name:string;website:string}>=[]){
 const calls:Array<'PRIMARY'|'SECONDARY'>=[];let primary=0;
 const p=new BraveProvider('KEY',(async(url:URL)=>{
  if(script.tick)clock+=script.tick;
  const secondary=(url.searchParams.get('q')??'').includes('"');calls.push(secondary?'SECONDARY':'PRIMARY');
  if(secondary&&script.secondary==='fail')return new Response('{}',{status:500});
  const results=secondary?(script.secondary??[]):(script.passes[primary++]??[]);
  return new Response(JSON.stringify({web:{results}}),{status:200});
 }) as unknown as typeof fetch);
 const r=repo(known);r.r.memory=async()=>({results:[],runs:[]});
 const input={project_id:'p',query:'entreprises BTP gros œuvre',location:ARA,categories:['BTP','VRD','maçonnerie'],max_results:20,optional_filters:{search_mode:'search_new' as const,desired_new_results:20}};
 return {run:()=>new DiscoveryService(r.r,p).find_prospects(input),calls,saved:r.saved,metrics:r.metrics};
}
const TWO_PASSES_WITH_CITATIONS=()=>[[OFFICIAL('ribiere-bench','Ribiere Bench'),RANKING],[OFFICIAL('cabestan-bench','Cabestan Bench'),KOMPASS],[OFFICIAL('never-fetched','Never Fetched')]];
test('B.1 — secondary names after 2 passes → no 3rd primary pass; call 3 = SECONDARY_RESOLUTION; total ≤ 3',async()=>{
 const t=newActorsRun({passes:TWO_PASSES_WITH_CITATIONS(),secondary:[OFFICIAL('alpha-construction','Alpha Construction')]});
 await t.run();
 assert.deepEqual(t.calls,['PRIMARY','PRIMARY','SECONDARY']);
 const m=t.metrics();
 assert.equal(m.provider_calls,3);assert.equal(m.primary_calls,2);assert.equal(m.secondary_resolution_calls,1);assert.equal(m.secondary_call_reserved,1);
 assert.equal(t.saved.some(s=>s.candidate.name==='Never Fetched'),false);
});
test('B.2 — no secondary name after 2 passes → 3rd primary pass allowed, total = 3',async()=>{
 const t=newActorsRun({passes:[[OFFICIAL('one-bench','One Bench')],[OFFICIAL('two-bench','Two Bench')],[OFFICIAL('three-bench','Three Bench')]]});
 await t.run();
 assert.deepEqual(t.calls,['PRIMARY','PRIMARY','PRIMARY']);
 assert.equal(t.metrics().secondary_resolution_calls,0);assert.equal(t.metrics().secondary_call_reserved,undefined);
});
test('B.3 — the resolved official site goes through the normal pipeline: COMPANY_CANDIDATE, review priority, novelty, never verified',async()=>{
 const t=newActorsRun({passes:TWO_PASSES_WITH_CITATIONS(),secondary:[OFFICIAL('alpha-construction','Alpha Construction')]});
 await t.run();
 const alpha=t.saved.find(s=>s.candidate.name==='Alpha Construction');
 assert.ok(alpha);const m=meta(alpha.candidate);
 assert.equal(m.source_class,'COMPANY_CANDIDATE');assert.ok(m.review_priority);assert.ok(m.novelty);assert.equal(m.secondary_origin.cited_name,'Alpha Construction');
 assert.doesNotMatch(JSON.stringify({...alpha.candidate,raw_metadata:{...m,location_state:undefined}}),/"VERIFIED"/,'no evidence status (location_state is the zone match, not a proof)');
});
test('B.4 — resolution fails → no false prospect, run completes, no 4th call',async()=>{
 const t=newActorsRun({passes:TWO_PASSES_WITH_CITATIONS(),secondary:'fail'});
 await t.run();
 assert.deepEqual(t.calls,['PRIMARY','PRIMARY','SECONDARY']);
 assert.equal(t.metrics().secondary_failed,1);assert.equal(t.metrics().secondary_candidates,0);
 assert.equal(t.saved.filter(s=>meta(s.candidate).secondary_origin).length,0);
});
test('B.5 — every cited name already known → no reservation, no duplicate',async()=>{
 const known=['Alpha Construction','Beta TP','Gamma VRD','Goncalves Frères Étanchéité'].map((name,i)=>({name,website:`https://k${i}.example/`}));
 const t=newActorsRun({passes:TWO_PASSES_WITH_CITATIONS()},known);
 await t.run();
 assert.deepEqual(t.calls,['PRIMARY','PRIMARY','PRIMARY'],'nothing to resolve: the budget stays with the primary search');
 assert.equal(t.saved.filter(s=>meta(s.candidate).secondary_origin).length,0);
});
test('B.6 — time budget too short → fail-safe: no extra pass, no resolution, never a 4th call',async()=>{
 clock=1_000_000;const now=mock.method(Date,'now',()=>clock);
 try{
  const t=newActorsRun({passes:TWO_PASSES_WITH_CITATIONS(),secondary:[OFFICIAL('alpha-construction','Alpha Construction')],tick:15_000});
  await t.run();
  assert.deepEqual(t.calls,['PRIMARY','PRIMARY']);
  assert.equal(t.metrics().secondary_resolution_calls,0);
 }finally{now.mock.restore()}
});
