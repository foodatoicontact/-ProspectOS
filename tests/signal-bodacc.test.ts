// Signal Engine S10 — BODACC legal announcements (src/signals/providers/bodacc.ts). Searched by SIREN; every record must
// carry that exact SIREN; collective proceedings are an exclusion, never a positive signal. The records below follow
// the dataset's published shape (annonces-commerciales, JSON-encoded sub-fields); fictional companies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BodaccSignalProvider,classifyAnnouncement,sirenMatches,sirenOf,bodaccEnabled} from '../src/signals/providers/bodacc.ts';
import type {SignalTarget} from '../src/signals/provider.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const T:SignalTarget={prospect_id:'p',name:'KERLAN',website:null,siren:'893196019',city:'Rennes'};
const rec=(o:any={})=>({id:'B202601870123',dateparution:'2026-09-30',parution:'20260187',typeavis:'annonce',typeavis_lib:'Avis initial',familleavis:'modification',familleavis_lib:'Modifications diverses',
 commercant:'KERLAN',ville:'Rennes',registre:['893 196 019','893196019'],
 modificationsgenerales:JSON.stringify({descriptif:'Modification survenue sur l’administration : nomination de M. Paul Morel en qualité de président.'}),
 url_complete:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:B202601870123',...o});
function api(results:unknown[],status=200){const urls:string[]=[];
 const request=(async(u:URL)=>{urls.push(u.toString());return new Response(JSON.stringify({total_count:results.length,results}),{status})}) as unknown as typeof fetch;return {request,urls}}

test('query: by SIREN, last 12 months, newest first, one request; no key needed',async()=>{
 const {request,urls}=api([]);await new BodaccSignalProvider(request).searchSignals({target:T,types:[],now:NOW});
 const u=new URL(urls[0]);
 assert.equal(u.origin+u.pathname,'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records');
 assert.equal(u.searchParams.get('where'),`registre="893196019" and dateparution>=date'2025-10-06'`);
 assert.equal(u.searchParams.get('order_by'),'dateparution desc');
 assert.equal(new BodaccSignalProvider(request).supports({...T,siren:null}),false);
 assert.equal(new BodaccSignalProvider(request).supports({...T,siren:'12345'}),false);
});

test('mapping: executive change, new establishment, sale of a business, head-office transfer, capital increase',()=>{
 assert.equal((classifyAnnouncement(rec()) as any).type,'leadership_change');
 assert.equal((classifyAnnouncement(rec({familleavis:'creation',familleavis_lib:'Créations',modificationsgenerales:undefined,listeetablissements:JSON.stringify({etablissement:{origineFonds:'Création d’un établissement secondaire',activite:'Conseil en systèmes informatiques'}})})) as any).type,'new_site');
 assert.equal((classifyAnnouncement(rec({familleavis:'vente',familleavis_lib:'Ventes et cessions'})) as any).type,'acquisition');
 assert.equal((classifyAnnouncement(rec({modificationsgenerales:JSON.stringify({descriptif:'Transfert du siège social au 12 rue des Lices, Rennes.'})})) as any).type,'new_site');
 assert.equal((classifyAnnouncement(rec({modificationsgenerales:JSON.stringify({descriptif:'Augmentation du capital social portée à 500 000 euros.'})})) as any).type,'funding');
});

test('never a reason to call: collective proceedings (warned), struck off, filed accounts, corrections, a modification without a known event',()=>{
 assert.deepEqual(classifyAnnouncement(rec({familleavis:'collective',familleavis_lib:'Procédures collectives'})),{reject:'COLLECTIVE_PROCEDURE'});
 assert.deepEqual(classifyAnnouncement(rec({familleavis:'conciliation',familleavis_lib:'Procédures de conciliation'})),{reject:'COLLECTIVE_PROCEDURE'});
 assert.deepEqual(classifyAnnouncement(rec({familleavis:'radiation',familleavis_lib:'Radiations'})),{reject:'NOT_A_SIGNAL'});
 assert.deepEqual(classifyAnnouncement(rec({familleavis:'dpc',familleavis_lib:'Dépôts des comptes'})),{reject:'NOT_A_SIGNAL'});
 assert.deepEqual(classifyAnnouncement(rec({typeavis:'rectificatif',typeavis_lib:'Avis rectificatif'})),{reject:'CORRECTION'});
 assert.deepEqual(classifyAnnouncement(rec({modificationsgenerales:JSON.stringify({descriptif:'Modification de l’objet social.'})})),{reject:'NOT_A_SIGNAL'});
});

test('no homonym: a record whose register number is not this SIREN is refused, whatever its name',async()=>{
 assert.equal(sirenMatches(rec(),'893196019'),true);
 assert.equal(sirenMatches(rec({registre:['893 196 018']}),'893196019'),false);
 assert.equal(sirenMatches(rec({registre:'893 196 019'}),'893196019'),true,'a single string is read too');
 const p=new BodaccSignalProvider(api([rec({registre:['111 222 333'],commercant:'KERLAN'}),rec()]).request);
 const out=await p.searchSignals({target:T,types:[],now:NOW});
 assert.equal(out.length,1);assert.deepEqual(p.takeRejections(),{SIREN_MISMATCH:1});
});

test('signal: official date, legal source, the announcement’s own words, official URL; proceedings counted for the warning',async()=>{
 const p=new BodaccSignalProvider(api([rec(),rec({id:'C1',familleavis:'collective',familleavis_lib:'Procédures collectives'}),rec({id:'X',url_complete:'https://evil.example/x'})]).request);
 const out=await p.searchSignals({target:T,types:[],now:NOW});
 assert.deepEqual(out[0],{signal_type:'leadership_change',title:'Modifications diverses — KERLAN',
  excerpt:'Modifications diverses — Modification survenue sur l’administration : nomination de M. Paul Morel en qualité de président.',
  source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:B202601870123',source_type:'legal_announcement',
  published_at:'2026-09-30T00:00:00.000Z',event_date:null,metadata:{bodacc_id:'B202601870123',parution:'20260187',famille:'modification'}});
 assert.equal(out[1].source_url,'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:X','a non-bodacc.fr link is replaced by the official one');
 assert.equal(p.lastReport.collective_procedures,1);
});

test('failures: HTTP error fails the call (counted by the scan); a malformed record only costs that record',async()=>{
 await assert.rejects(new BodaccSignalProvider(api([],503).request).searchSignals({target:T,types:[],now:NOW}),/BODACC_HTTP_503/);
 const p=new BodaccSignalProvider(api([{dateparution:'hier',registre:['893196019'],familleavis:'vente',id:'Z'},rec()]).request);
 assert.equal((await p.searchSignals({target:T,types:[],now:NOW})).length,1);
});

test('SIREN only from the register’s own accepted result; BODACC on unless explicitly "false"',()=>{
 assert.equal(sirenOf([{provider:'registry',raw_payload:{siren:'893196019'}}]),'893196019');
 assert.equal(sirenOf([{provider:'brave',raw_payload:{siren:'893196019'}}]),null);
 assert.equal(sirenOf([{provider:'registry',raw_payload:{siren:'89319601'}}]),null);
 assert.equal(bodaccEnabled({}),true);assert.equal(bodaccEnabled({SIGNALS_BODACC_ENABLED:'false'}),false);
});
