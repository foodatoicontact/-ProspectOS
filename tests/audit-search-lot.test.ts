// Audit of 11 nov. 2026, search lot (docs/AUDIT-2026-11-11.md §3): B4 zone reading shared by the register, the BODACC
// and the tenders; further checks are added below for B8, B6, B5 and B3.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {resolveRegistryZone,zoneDepartments,inZone} from '../src/discovery/registry/zone.ts';
import {registryUrl} from '../src/discovery/providers/registry.ts';
import {salesZoneClause} from '../src/discovery/providers/bodacc-sales.ts';
import {parseTenderQuery} from '../src/tenders/boamp.ts';

test('B4 — every form the audit found refused is now read; an unknown place is still never guessed',()=>{
 const ara={kind:'region',code:'84',label:'Auvergne-Rhône-Alpes'};
 for(const s of ['Auvergne-Rhône-Alpes','auvergne rhone alpes','Région Auvergne-Rhône-Alpes','Auvergne-Rhône-Alpes, France','ARA','AURA'])assert.deepEqual(resolveRegistryZone(s),ara,s);
 assert.deepEqual(resolveRegistryZone('PACA'),{kind:'region',code:'93',label:'Provence-Alpes-Côte d’Azur'});
 assert.deepEqual(resolveRegistryZone('IDF'),{kind:'region',code:'11',label:'Île-de-France'});
 assert.deepEqual(resolveRegistryZone('Lyon'),{kind:'department',code:'69',label:'Rhône'},'a prefecture gives its department');
 assert.deepEqual(resolveRegistryZone('département du Rhône'),{kind:'department',code:'69',label:'Rhône'});
 assert.deepEqual(resolveRegistryZone('Rhône, Isère'),{kind:'departments',codes:['69','38'],label:'Rhône, Isère'});
 assert.deepEqual(resolveRegistryZone('Rhône et Isère'),{kind:'departments',codes:['69','38'],label:'Rhône, Isère'});
 assert.deepEqual(resolveRegistryZone('69 / 38'),{kind:'departments',codes:['69','38'],label:'Rhône, Isère'});
 const mixed=resolveRegistryZone('Île-de-France, Oise')!;
 assert.equal(mixed.kind,'departments');assert.deepEqual((mixed as {codes:string[]}).codes.sort(),['60','75','77','78','91','92','93','94','95']);
 assert.equal(resolveRegistryZone('Rhône, Atlantide'),null,'one unknown place: the whole zone is unknown');
 assert.equal(resolveRegistryZone('Quelque part'),null);
 assert.deepEqual(resolveRegistryZone('Paris (75)'),{kind:'department',code:'75',label:'Paris'});
});
test('B4 — several departments: one register query, one BODACC clause, the admission checks each department',()=>{
 const z=resolveRegistryZone('Rhône, Isère')!;
 const url=registryUrl({key:'h',label:'H',section:null,codes:['55.10Z']} as any,z,[],1);
 assert.equal(url.searchParams.get('departement'),'69,38');
 assert.equal(salesZoneClause(z),'(numerodepartement="69" or numerodepartement="38")');
 assert.equal(inZone(z,{commune:'38185'}),true);assert.equal(inZone(z,{commune:'73065'}),false);
});
test('B4 — tenders take a region or a department name too (BOAMP only knows numbers)',()=>{
 assert.deepEqual(parseTenderQuery('nettoyage','Île-de-France').departments,['75','77','78','91','92','93','94','95']);
 assert.deepEqual(parseTenderQuery('nettoyage','69, 38').departments,['69','38']);
 assert.deepEqual(parseTenderQuery('nettoyage','Rhône, Isère').departments,['69','38']);
 assert.throws(()=>parseTenderQuery('nettoyage','Atlantide'),/DEPARTMENT_INVALID/);
});
test('B8 — a BODACC sale result carries its SIREN to the dedup and the « already seen » memory (raw_metadata.siren)',async()=>{
 const {ProjectNovelty}=await import('../src/discovery/novelty-engine.ts');
 const sale={name:'NB2M',website:null,phone:null,city:'Muret',source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',raw_metadata:{source_class:'COMPANY_CANDIDATE',company_name_status:'RESOLVED',siren:'106463037'}};
 const n=new ProjectNovelty({prospects:[{id:'p1',name:'Autre nom',siren:'106463037'}],runs:[],results:[]} as any,null);
 assert.equal(n.classify(sale as any).status,'ADDED');
 const read=(p:string)=>import('node:fs').then(f=>f.readFileSync(new URL(`../${p}`,import.meta.url),'utf8'));
 assert.match(await read('src/discovery/services.ts'),/c\.raw_metadata\?\.registry\?\.siren\?\?c\.raw_metadata\?\.siren/);
 assert.match(await read('src/discovery/repository.ts'),/sale_siren:normalized_payload->raw_metadata->>siren/);
});

// ---- B5 / B6: the public registers answer location and takeover criteria from structured, official data.
const crit=(key:string,label:string,rules?:unknown)=>({key,label,weight:10,...(rules?{rules}:{})}) as any;
const company=(over:Record<string,unknown>={})=>({siren:'933467151',nom_raison_sociale:'EXEMPLE SAS',statut_diffusion:'O',etat_administratif:'A',
 siege:{siret:'93346715100012',commune:'93066',region:'11',departement:'93',libelle_commune:'Saint-Denis',adresse:'1 rue X 93200 Saint-Denis'},...over}) as any;
test('B5 — a criterion\'s locations are checked against the register\'s head office (commune, department, region)',async()=>{
 const {locationObservations}=await import('../src/discovery/public-records.ts');
 const only=(locations:string[],extra:Record<string,unknown>={})=>crit('zone','Zone ciblée',{type:'target_fit',config:{match:'all_defined',locations,...extra}});
 let o=locationObservations(company(),[only(['Seine-Saint-Denis'])]);
 assert.equal(o.length,1);assert.equal(o[0]!.value,true);assert.equal(o[0]!.criterion,'zone');
 assert.equal(o[0]!.source_url,'https://annuaire-entreprises.data.gouv.fr/entreprise/933467151');assert.match(o[0]!.source_excerpt,/Saint-Denis, Seine-Saint-Denis \(93\)/);
 assert.equal(locationObservations(company(),[only(['IDF'])])[0]!.value,true,'a region by its short name');
 assert.equal(locationObservations(company(),[only(['Rhône, Isère'])])[0]!.value,false,'every value known, none contains it');
 assert.equal(locationObservations(company(),[only(['Quelque part'])]).length,0,'an unknown value: open, never guessed');
 // Other dimensions: all_defined is decided by a missing location only; any_defined by a present one only.
 assert.equal(locationObservations(company(),[only(['93'],{categories:['hôtel']})])[0]!.value,null);
 assert.equal(locationObservations(company(),[only(['69'],{categories:['hôtel']})])[0]!.value,false);
 assert.equal(locationObservations(company(),[only(['93'],{categories:['hôtel'],match:'any_defined'})])[0]!.value,true);
 assert.equal(locationObservations(company({statut_diffusion:'P'}),[only(['93'])]).length,0,'a non-diffusible company: nothing about its address');
 assert.equal(locationObservations(company(),[crit('zone','Zone')]).length,0,'no rule, no observation');
});
test('B6 — a takeover criterion is answered by the official BODACC purchase announcement; none, nothing written',async()=>{
 const {takeoverObservations,takeoverCriteria,enrichFromPublicRecords}=await import('../src/discovery/public-records.ts');
 const criteria=[crit('reprise','Entreprise reprise récemment'),crit('rachat','Changement de propriétaire'),crit('taille','10 à 49 salariés')];
 assert.deepEqual(takeoverCriteria(criteria).map(c=>c.key),['reprise','rachat']);
 const notice={id:'A1',published:'2026-11-17',url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',category:'Achat d’un fonds par une personne morale',siren:'933467151',
  buyer:'EXEMPLE SAS',activity:'boucherie-charcuterie',tradeName:null,establishment:null,city:'Saint-Denis',postalCode:'93200'};
 const o=takeoverObservations([notice],criteria);
 assert.deepEqual(o.map(x=>[x.criterion,x.value,x.source_url]),[['reprise',true,notice.url],['rachat',true,notice.url]]);
 assert.match(o[0]!.source_excerpt,/^Reprise de fonds publiée au BODACC le 17\/11\/2026 : boucherie-charcuterie, Saint-Denis — acquéreur : EXEMPLE SAS \(SIREN 933467151\)$/);
 assert.deepEqual(takeoverObservations([],criteria),[]);
 // The BODACC is asked only when a takeover criterion exists.
 const urls:string[]=[];
 const fetchImpl=(async(u:string|URL)=>{urls.push(String(u));return new Response(JSON.stringify(String(u).includes('bodacc')?{results:[]}:{results:[company()]}),{status:200})}) as typeof fetch;
 const repo={prospectIdentity:async()=>({id:'p',project_id:'pr',name:'Exemple',city:null}),storedObservations:async()=>[],projectCriteria:async()=>[crit('taille','10 à 49 salariés')],
  consumeAnalysis:async()=>{},saveObservations:async(_:string,x:unknown[])=>x};
 await enrichFromPublicRecords({repo,prospectId:'p',siren:'933467151',fetch:fetchImpl});
 assert.ok(!urls.some(u=>u.includes('bodacc')),'no takeover criterion: no BODACC request');
 await enrichFromPublicRecords({repo:{...repo,projectCriteria:async()=>criteria},prospectId:'p',siren:'933467151',fetch:fetchImpl});
 assert.ok(urls.some(u=>u.includes('bodacc')&&(new URL(u).searchParams.get('where')??'').includes('registre like "933467151"')));
});
test('B3 — the register\'s own count is kept with the run and shown when more companies exist than are displayed',async()=>{
 const {RegistryProvider}=await import('../src/discovery/providers/registry.ts');
 const {summarizeRuns}=await import('../src/discovery/run-history.ts');
 const fetchImpl=(async()=>new Response(JSON.stringify({results:[],total_results:1240,total_pages:62}),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch;
 const p=new RegistryProvider({fetch:fetchImpl,wait:async()=>{}});
 await p.searchCompanies({project_id:'x',query:'industriel',location:'Rhône',categories:['industriel'],max_results:20,optional_filters:{}} as any);
 assert.ok((p.lastSearch?.source_total??0)>=1240,'page 1 of each group counts');
 const [run]=summarizeRuns([{id:'r',query:'q',location:'l',categories:[],provider:'registry',status:'completed',started_at:'2026-11-18T10:00:00Z',completed_at:null,result_count:20,metrics:{search_source_total:1240}}]);
 assert.equal(run!.source_total,1240);
 const ui=(await import('node:fs')).readFileSync(new URL('../src/ui/v2/search/SearchNative.tsx',import.meta.url),'utf8');
 assert.match(ui,/c\?\.source_total!=null&&c\.source_total>m\.results\.length/);
 assert.match((await import('node:fs')).readFileSync(new URL('../src/discovery/services.ts',import.meta.url),'utf8'),/search_source_total:report\.source_total/);
});
