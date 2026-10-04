// Discovery from the official company register (API Recherche d'entreprises): companies legally identified by
// their SIREN, kept by STRUCTURED rules only (head office in the zone, or an active production site of at least
// 20 employees in the zone) — never by a list of names. The 50 companies below are the real API answer for the
// Vigil brief (section C, region 84, 200–1 999 employees, pages 1–2), stored verbatim minus the `dirigeants`
// field (personal data, unused). The 19 names are a TEST ORACLE for this dataset only, never a business rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admitRegistryCompany,isProductionSite,employeeTranchesFor} from '../src/discovery/registry/admission.ts';
import {proposeNafGroups} from '../src/discovery/registry/naf.ts';
import {resolveRegistryZone} from '../src/discovery/registry/zone.ts';
import {RegistryProvider} from '../src/discovery/providers/registry.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {DiscoveryInputSchema,CandidateSchema,type Candidate} from '../src/discovery/types.ts';
import {scoreProspect,DEFAULT_CRITERIA} from '../src/domain/core.ts';

type Raw=Record<string,any>;
const page=(n:number):Raw=>JSON.parse(readFileSync(new URL(`./fixtures/registry/vigil-section-c-aura-200-1999-page-${n}.json`,import.meta.url),'utf8'));
const DATASET:Raw[]=[...page(1).results,...page(2).results];
const AURA=resolveRegistryZone('Auvergne-Rhône-Alpes')!;

const EXPECTED_RETAINED=['LAFARGE BETONS','BETON VICAT','CLAUGER','COTELAC','ALKERN FRANCE','PRECIA MOLEN SERVICE','KP1','EPALIA','OTTOBOCK RESEAU ORTHOPEDIE & SERVICES',
 'CAFES CHOCOLATS VOISIN','TRESCAL','VICAT','LA PANIERE','STRADAL','SARL CHEVALLIER','LAFARGE CIMENTS','LA DETECTION ELECTRONIQUE FRANCAISE','DESAUTEL','SOCIETE D\'ETUDES ET D\'APPLICATIONS DE COMPOSANTS GUIRAUD FRERES'].sort();

const retainedNames=(rows:Raw[])=>rows.filter(r=>admitRegistryCompany(r,AURA).admitted).map(r=>r.nom_raison_sociale as string).sort();

test('dataset — the real 50-company answer is reproduced exactly (2 pages × 25, 788 results in all)',()=>{
 assert.equal(DATASET.length,50);
 assert.equal(new Set(DATASET.map(r=>r.siren)).size,50);
 assert.equal(page(1).total_results,788);
 assert.ok(DATASET.every(r=>!('dirigeants' in r)),'no personal data kept in the fixture');
});

test('dataset — exactly the 19 expected companies are retained, the 31 others set aside',()=>{
 assert.deepEqual(retainedNames(DATASET),EXPECTED_RETAINED);
 assert.equal(DATASET.filter(r=>!admitRegistryCompany(r,AURA).admitted).length,31);
});

test('dataset — shops, restaurants and chains with no production site in the zone are set aside',()=>{
 for(const name of ['BOULANGERIES PAUL','PATISSERIE E.LADUREE','LINDT ET SPRUNGLI','HARIBO RICQLES ZAN','DIM FRANCE SAS','CLAUDIE PIERLOT','FAST RETAILING FRANCE','AUBADE PARIS','FURSAC','SESSUN','JSR','PIERRE HERME FRANCE']){
  const row=DATASET.find(r=>r.nom_raison_sociale===name);assert.ok(row,name);
  const v=admitRegistryCompany(row!,AURA);assert.equal(v.admitted,false,name);
 }
 // only closed sites in the zone, wholesale, engineering, logistics
 for(const name of ['HEIDELBERG MATERIALS FRANCE BETONS','EQIOM','APROLIS','SERVICES ORGANISATION METHODES','PRODUITS DE REVETEMENT DU BATIMENT'])assert.equal(admitRegistryCompany(DATASET.find(r=>r.nom_raison_sociale===name)!,AURA).admitted,false,name);
});

test('dataset — the verdict never depends on the name: every row renamed gives the same 19 SIRENs',()=>{
 const before=DATASET.filter(r=>admitRegistryCompany(r,AURA).admitted).map(r=>r.siren).sort();
 const renamed=DATASET.map(r=>({...r,nom_complet:'ENTREPRISE X',nom_raison_sociale:'ENTREPRISE X',sigle:null}));
 assert.deepEqual(renamed.filter(r=>admitRegistryCompany(r,AURA).admitted).map(r=>r.siren).sort(),before);
});

// ——— synthetic rules ———
const site=(o:Raw={})=>({siret:'00000000000001',activite_principale:'25.62B',etat_administratif:'A',region:'84',commune:'69123',libelle_commune:'LYON',tranche_effectif_salarie:'12',est_siege:false,statut_diffusion_etablissement:'O',...o});
const company=(o:Raw={})=>({siren:'000000001',nom_complet:'ACME',nom_raison_sociale:'ACME',etat_administratif:'A',statut_diffusion:'O',section_activite_principale:'C',activite_principale:'25.62B',tranche_effectif_salarie:'32',
 siege:{region:'11',commune:'75101',libelle_commune:'PARIS',code_postal:'75001',etat_administratif:'A',activite_principale:'70.10Z',statut_diffusion_etablissement:'O'},matching_etablissements:[],...o});

test('rule A — a head office in the zone is enough',()=>{
 const v=admitRegistryCompany(company({siege:{region:'84',commune:'38185',libelle_commune:'GRENOBLE',code_postal:'38000',etat_administratif:'A',activite_principale:'25.62B',statut_diffusion_etablissement:'O'}}),AURA);
 assert.equal(v.admitted,true);assert.equal(v.admitted&&v.rule,'SIEGE_IN_ZONE');
});

test('rule B — an active production site (section C) of 20 employees or more in the zone is enough',()=>{
 const v=admitRegistryCompany(company({matching_etablissements:[site()]}),AURA);
 assert.equal(v.admitted,true);assert.equal(v.admitted&&v.rule,'PRODUCTION_SITE_IN_ZONE');
 assert.equal(isProductionSite(site({tranche_effectif_salarie:'21'})),true);
});

test('rule B — each failing condition alone sets the company aside',()=>{
 const cases:Array<[string,Raw]>=[
  ['closed site',site({etat_administratif:'F'})],['tranche 11 (10–19)',site({tranche_effectif_salarie:'11'})],['unknown headcount',site({tranche_effectif_salarie:'NN'})],['no headcount',site({tranche_effectif_salarie:null})],
  ['retail 47.xx',site({activite_principale:'47.71Z',tranche_effectif_salarie:'21'})],['restaurant 56.xx',site({activite_principale:'56.10C',tranche_effectif_salarie:'21'})],
  ['wholesale 46.xx',site({activite_principale:'46.69B',tranche_effectif_salarie:'21'})],['engineering 71.xx',site({activite_principale:'71.12B',tranche_effectif_salarie:'22'})],
  ['outside section C',site({activite_principale:'52.10B',tranche_effectif_salarie:'21'})],['former NAF (rev. 1) code',site({activite_principale:'26.6E',tranche_effectif_salarie:'21'})],
  ['other region',site({region:'11',commune:'75101'})],
 ];
 for(const [label,s] of cases)assert.equal(admitRegistryCompany(company({matching_etablissements:[s]}),AURA).admitted,false,label);
});

test('a closed company is never retained, even with its head office in the zone',()=>{
 assert.equal(admitRegistryCompany(company({etat_administratif:'C',siege:{region:'84',commune:'69123',libelle_commune:'LYON',code_postal:'69001',etat_administratif:'A',statut_diffusion_etablissement:'O'}}),AURA).admitted,false);
});

test('department zone — sites are matched on their commune code',()=>{
 const rhone=resolveRegistryZone('Rhône (69)')!;assert.equal(rhone.kind,'department');
 assert.equal(admitRegistryCompany(company({matching_etablissements:[site({commune:'69123'})]}),rhone).admitted,true);
 assert.equal(admitRegistryCompany(company({matching_etablissements:[site({commune:'38185'})]}),rhone).admitted,false);
 assert.equal(resolveRegistryZone('Quelque part'),null,'an unknown place is never guessed');
});

test('employee range — only INSEE bands fully inside the range',()=>{
 assert.deepEqual(employeeTranchesFor({min:200,max:2000}),['31','32','41','42']);
 assert.deepEqual(employeeTranchesFor({min:50,max:199}),['21','22']);
});

test('NAF — business words map to official NAF labels, explicitly; an unknown word is never mapped',()=>{
 const p=proposeNafGroups(['industriel','agroalimentaire','blockchain']);
 const ind=p.groups.find(g=>g.key==='industriel')!,agro=p.groups.find(g=>g.key==='agroalimentaire')!;
 assert.equal(ind.section,'C');assert.equal(ind.label,'Section C — Industrie manufacturière');
 assert.deepEqual(agro.divisions.map(d=>d.label),['Division 10 — Industries alimentaires','Division 11 — Fabrication de boissons']);
 assert.ok(agro.codes.every(c=>/^1[01]\.\d{2}[A-Z]$/.test(c))&&agro.codes.includes('10.71A')&&agro.codes.includes('11.01Z'));
 assert.ok(p.groups.every(g=>g.explanation.length>0));
 assert.deepEqual(p.unmapped,['blockchain']);
 assert.deepEqual(proposeNafGroups(['restaurant']).groups,[]);
});

// ——— provider ———
const VIGIL={project_id:'p',query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire'],max_results:20,optional_filters:{employee_range:{min:200,max:2000}}};
type Served=(url:URL)=>Raw|Response;
function provider(serve:Served){
 const sent:URL[]=[];
 const p=new RegistryProvider({fetch:(async(u:string|URL)=>{const url=new URL(String(u));sent.push(url);const r=serve(url);return r instanceof Response?r:Response.json(r)}) as unknown as typeof fetch,wait:async()=>{}});
 return {p,sent};
}
const empty={results:[],total_results:0,page:1,per_page:25,total_pages:0};
// Replay: the section C query answers with the real pages 1–2; the agri-food query had no real capture, so it answers empty.
const replay:Served=url=>url.searchParams.get('section_activite_principale')==='C'?(Number(url.searchParams.get('page'))<=2?{...page(Number(url.searchParams.get('page'))),total_pages:2}:empty):empty;

test('provider — Vigil: two separate registry queries (industry, agri-food) with structured filters',async()=>{
 const {p,sent}=provider(replay);await p.searchCompanies(DiscoveryInputSchema.parse(VIGIL));
 const ind=sent.filter(u=>u.searchParams.get('section_activite_principale')==='C'),agro=sent.filter(u=>u.searchParams.has('activite_principale'));
 assert.ok(ind.length>=1&&agro.length>=1);
 for(const u of sent){assert.equal(u.origin+u.pathname,'https://recherche-entreprises.api.gouv.fr/search');assert.equal(u.searchParams.get('region'),'84');assert.equal(u.searchParams.get('tranche_effectif_salarie'),'31,32,41,42');assert.equal(u.searchParams.get('etat_administratif'),'A');assert.equal(u.searchParams.get('per_page'),'25');assert.ok(!u.searchParams.has('q'),'no free-text query')}
 assert.ok(agro[0]!.searchParams.get('activite_principale')!.split(',').every(c=>/^1[01]\./.test(c)));
});

test('provider — replay of the real dataset: 19 companies, source exhausted, every request accounted for',async()=>{
 const {p,sent}=provider(replay);const raws=await p.searchCompanies(DiscoveryInputSchema.parse(VIGIL));
 assert.deepEqual(raws.map(r=>p.normalizeResult(r).name).sort(),EXPECTED_RETAINED);
 assert.equal(p.lastSearch!.requests_sent,sent.length);assert.equal(p.lastSearch!.requests_failed,0);
 assert.equal(sent.filter(u=>u.searchParams.get('section_activite_principale')==='C').length,2,'stops when the source is exhausted');
});

test('provider — stops paginating once enough companies are admissible',async()=>{
 const {p,sent}=provider(replay);const raws=await p.searchCompanies(DiscoveryInputSchema.parse({...VIGIL,max_results:5}));
 assert.equal(raws.length,5);assert.equal(sent.filter(u=>u.searchParams.get('section_activite_principale')==='C').length,1);
});

test('provider — agri-food is never drowned by the industry query; one SIREN found by both is one company',async()=>{
 const mk=(i:number,naf:string)=>company({siren:String(100000000+i),nom_complet:`SOC ${i}`,nom_raison_sociale:`SOC ${i}`,activite_principale:naf,matching_etablissements:[site({activite_principale:naf,siret:String(10000000000000+i)})]});
 const ind=Array.from({length:25},(_,i)=>mk(i,'25.62B')),agro=[mk(100,'10.71A'),mk(101,'11.01Z'),ind[0]!];
 const {p}=provider(url=>url.searchParams.get('section_activite_principale')==='C'?{results:ind,total_results:25,page:1,per_page:25,total_pages:1}:{results:agro,total_results:3,page:1,per_page:25,total_pages:1});
 const out=(await p.searchCompanies(DiscoveryInputSchema.parse({...VIGIL,max_results:6}))).map(r=>p.normalizeResult(r));
 assert.equal(out.length,6);assert.equal(new Set(out.map(c=>c.raw_metadata.siren)).size,6);
 assert.ok(out.some(c=>c.raw_metadata.siren==='100000100')&&out.some(c=>c.raw_metadata.siren==='100000101'),'agri-food companies interleaved in the first results');
});

test('provider — nothing is sent when the zone or the sector cannot be mapped (never guessed)',async()=>{
 for(const input of [{...VIGIL,location:'Quelque part'},{...VIGIL,query:'blockchain',categories:['blockchain']}]){
  const {p,sent}=provider(replay);assert.deepEqual(await p.searchCompanies(DiscoveryInputSchema.parse(input)),[]);assert.equal(sent.length,0);
  assert.match(p.lastSearch!.failure_codes.join(','),/REGISTRY_(ZONE|SECTOR)_UNMAPPED/);
 }
});

test('provider — a failing page is counted, the others are kept; all failing raises',async()=>{
 const half=provider(url=>url.searchParams.has('activite_principale')?new Response('',{status:429}):replay(url));
 const raws=await half.p.searchCompanies(DiscoveryInputSchema.parse(VIGIL));
 assert.equal(raws.length,19);assert.equal(half.p.lastSearch!.requests_failed,1);assert.deepEqual(half.p.lastSearch!.failure_codes,['HTTP_429']);
 const none=provider(()=>new Response('',{status:500}));
 await assert.rejects(none.p.searchCompanies(DiscoveryInputSchema.parse(VIGIL)),/REGISTRY_UNAVAILABLE/);
});

test('provider — requests are spaced to respect the official rate limit',async()=>{
 const waits:number[]=[];const sent:URL[]=[];
 const p=new RegistryProvider({fetch:(async(u:string|URL)=>{sent.push(new URL(String(u)));return Response.json(replay(new URL(String(u))))}) as unknown as typeof fetch,wait:async(ms:number)=>{waits.push(ms)}});
 await p.searchCompanies(DiscoveryInputSchema.parse(VIGIL));
 assert.equal(waits.length,sent.length-1);assert.ok(waits.every(ms=>ms>=1000/7),JSON.stringify(waits));
});

test('normalize — a legally identified company, with its provenance, no personal or financial data',async()=>{
 const {p}=provider(replay);const raws=await p.searchCompanies(DiscoveryInputSchema.parse(VIGIL));
 const c=p.normalizeResult(raws.find(r=>(r as Raw).siren==='971506191'));
 CandidateSchema.parse(c);
 assert.equal(c.name,'CLAUGER');assert.equal(c.discovered_source,'registry');assert.equal(c.website,null);
 assert.equal(c.source_url,'https://annuaire-entreprises.data.gouv.fr/entreprise/971506191');
 assert.equal(c.deduplication_key,'siren:971506191');
 const m=c.raw_metadata as Raw;
 assert.equal(m.siren,'971506191');assert.equal(m.source_class,'COMPANY_CANDIDATE');assert.equal(m.entity_type,'COMPANY');
 assert.equal(m.registry.admission.rule,'SIEGE_IN_ZONE');assert.equal(m.registry.naf,'33.20B');assert.equal(m.registry.tranche_effectif_salarie,'42');
 assert.ok(m.registry.sites_in_zone.length>=1&&m.registry.sites_in_zone.every((s:Raw)=>s.siret&&s.commune&&s.activite_principale));
 assert.match(m.provenance.source,/Recherche d.entreprises/);assert.match(m.provenance.licence,/Licence Ouverte/);
 assert.doesNotMatch(JSON.stringify(c),/dirigeants|finances|date_de_naissance|resultat_net/);
});

// ——— through the existing Discovery pipeline ———
class Repo implements DiscoveryRepository {
 saved:Candidate[]=[];observations=0;
 async start(){return {id:'run-1',provider:'registry',status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_r:unknown,rows:{candidate:Candidate}[]){this.saved=rows.map(r=>r.candidate);return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(){}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){this.observations++;return []}
}

test('pipeline — 19 distinct SIRENs reach the review list as company candidates; distinct SIRENs are never merged',async()=>{
 const {p}=provider(replay);const repo=new Repo();
 await new DiscoveryService(repo,p).find_prospects(VIGIL);
 assert.equal(repo.saved.length,19);
 assert.equal(new Set(repo.saved.map(c=>c.raw_metadata.siren)).size,19);
 assert.ok(repo.saved.every(c=>c.raw_metadata.source_class==='COMPANY_CANDIDATE'));
 assert.deepEqual(repo.saved.map(c=>c.name).sort(),EXPECTED_RETAINED);
});

test('evidence-first — the register proves identity, never a need: no observation, no evidence, no score',async()=>{
 const {p}=provider(replay);const repo=new Repo();
 await new DiscoveryService(repo,p).find_prospects({...VIGIL,optional_filters:{...VIGIL.optional_filters,criteria:DEFAULT_CRITERIA.map(c=>c.key==='need_fit'?{...c,rules:{type:'need_fit' as const,config:{signals:['recrutent un RSSI','incident cyber']}}}:c)}});
 assert.equal(repo.observations,0);
 const json=JSON.stringify(repo.saved);
 assert.doesNotMatch(json,/VERIFIED|need_fit|commercial_signal|"evidence"|cyber|RSSI/i);
 assert.equal(scoreProspect(DEFAULT_CRITERIA,[]).score,0);
});

test('dedup — two legal entities sharing a name stay two companies; the same SIREN twice is one',async()=>{
 const twin=(siren:string)=>company({siren,nom_complet:'ACME',nom_raison_sociale:'ACME',siege:{region:'84',commune:'69123',libelle_commune:'LYON',code_postal:'69001',etat_administratif:'A',statut_diffusion_etablissement:'O'}});
 const {p}=provider(url=>url.searchParams.get('section_activite_principale')==='C'?{results:[twin('111111111'),twin('222222222'),twin('111111111')],total_results:3,page:1,per_page:25,total_pages:1}:empty);
 const repo=new Repo();await new DiscoveryService(repo,p).find_prospects(VIGIL);
 assert.deepEqual(repo.saved.map(c=>c.raw_metadata.siren).sort(),['111111111','222222222']);
});
