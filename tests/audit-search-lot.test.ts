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
