// Migration 050 — the SIREN on the prospect record, read by the search: the same SIREN is the same company (the record
// is enriched, not duplicated), two different SIRENs are two companies whatever the website or the name say.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {DeduplicationService} from '../src/discovery/deduplication.ts';
import {ProjectNovelty,strongProspectMatch} from '../src/discovery/novelty-engine.ts';
import {enrichFromPublicRecords} from '../src/discovery/public-records.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const reg=(siren:string,over:Record<string,unknown>={})=>({name:'HOTEL DU PARC',website:null,phone:null,city:'Pantin',source_url:`https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
 raw_metadata:{source_class:'COMPANY_CANDIDATE',company_name_status:'RESOLVED',registry:{siren}},...over});

test('dedup: the same SIREN links to the existing record (enrich, no duplicate), before any other identifier',()=>{
 const d=new DeduplicationService();
 const known=[{id:'p1',name:'Hôtel du Parc — accueil',website:'https://autre-site.example/',city:'Paris',siren:'123456789'}];
 assert.deepEqual(d.match({name:'HOTEL DU PARC',city:'Pantin',siren:'123456789'},known),{status:'duplicate_candidate',duplicate_of:'p1',reason:'Même SIREN : entreprise déjà dans ce projet'});
 assert.equal(d.match({name:'HOTEL DU PARC',city:'Pantin',siren:'987654321'},known).status,'unique');
 assert.equal(d.match({name:'HOTEL DU PARC',city:'Pantin',siren:'12345'},known).status,'unique','a malformed SIREN is ignored');
});
test('novelty: same SIREN = ADDED even with another website and town; different SIRENs = different actors even with the same site',()=>{
 const memory={prospects:[{id:'p1',name:'Autre nom',website:'https://chaine.example/',city:'Lyon',siren:'123456789'}],runs:[],results:[]};
 const n=new ProjectNovelty(memory as any,null);
 assert.deepEqual(n.classify(reg('123456789',{website:'https://ailleurs.example/'}) as any),{status:'ADDED',basis:'siren',prospect_id:'p1',run_id:null,result_id:null});
 const n2=new ProjectNovelty(memory as any,null);
 assert.equal(n2.classify(reg('987654321',{website:'https://chaine.example/',city:'Lyon'}) as any).status,'NEW','a chain\'s shared site does not merge two SIRENs');
 // A record created from a register result keeps « siren:<n> » as its dedupe key: recognised even before migration 050.
 assert.equal(strongProspectMatch(reg('555555555') as any,[{id:'p9',name:'X',discovery_dedupe_key:'siren:555555555'}]),'p9');
 // Earlier results: the same SIREN seen in a previous run is SEEN.
 const n3=new ProjectNovelty({prospects:[],runs:[{id:'r1',location:null}],results:[{id:'x',discovery_run_id:'r1',status:'pending',prospect_id:null,company_name:'Nom différent',
  website:null,city:null,source_url:'https://annuaire-entreprises.data.gouv.fr/entreprise/444444444',source_class:'COMPANY_CANDIDATE',siren:'444444444'}]} as any,null);
 assert.equal(n3.classify(reg('444444444') as any).status,'SEEN');
});
test('public registers: the identified SIREN is kept on the record; a refusal (another record has it) does not fail the analysis',async()=>{
 const company={siren:'123456789',nom_complet:'HOTEL DU PARC',etat_administratif:'A',statut_diffusion:'O',siege:{libelle_commune:'Pantin',siret:'',adresse:'1 rue X 93500 Pantin'}};
 const fetchImpl=(async()=>new Response(JSON.stringify({results:[company]}),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch;
 const kept:string[]=[];
 const repo={prospectIdentity:async()=>({id:'p1',project_id:'pr',name:'Hotel du Parc',city:'Pantin'}),storedObservations:async()=>[],projectCriteria:async()=>[],consumeAnalysis:async()=>{},
  saveObservations:async(_:string,o:unknown[])=>o,fillProspectSiren:async(_:string,s:string)=>{kept.push(s);throw Error('duplicate key')}};
 const r=await enrichFromPublicRecords({repo,prospectId:'p1',siren:'123456789',fetch:fetchImpl});
 assert.deepEqual(kept,['123456789']);assert.equal(r.company.siren,'123456789');
});
test('wiring: the search reads the register SIREN for the project dedup and the novelty memory',()=>{
 const s=read('src/discovery/services.ts');
 assert.match(s,/this\.dedupe\.match\(withRegistrySiren\(candidate\),known\)/);
 assert.match(s,/siren:k\.siren\?\?null/);
 const r=read('src/discovery/repository.ts');
 assert.match(r,/select\('id,name,website,city,siren,channels\(kind,value\)'\)/);
 assert.match(r,/siren:normalized_payload->raw_metadata->registry->>siren/);
 assert.match(r,/update\(\{siren\}\)\.eq\('id',id\)\.is\('siren',null\)/,'never overwrites a SIREN');
});
