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
 // Owner decision (25 nov. 2026): a sale is a signal only when it is a purchase by the shared rule (src/domain/bodacc-purchase.ts).
 const sale=(category:string,origin='Fonds acquis par achat au prix stipulé de 60000,00 euros.')=>rec({familleavis:'vente',familleavis_lib:'Ventes et cessions',modificationsgenerales:undefined,
  acte:JSON.stringify({vente:{categorieVente:category}}),listeetablissements:JSON.stringify({etablissement:{origineFonds:origin,adresse:{codePostal:'35000'}}})});
 assert.equal((classifyAnnouncement(sale("Achat d'un fonds par une personne morale (insertion provisoire)")) as any).type,'acquisition');
 assert.equal((classifyAnnouncement(sale("Mise en activité d'une société suite à achat")) as any).type,'acquisition');
 assert.deepEqual(classifyAnnouncement(sale("Autre achat, apport, attribution (immatriculation d'une personne morale, uniquement)",'Apport fusion')),{reject:'NOT_A_SIGNAL'},'a merger is never a « rachat »');
 assert.deepEqual(classifyAnnouncement(sale("Achat d'un fonds par une personne morale (insertion provisoire)",'Etablissement principal acquis par apport au montant évalué à 14000,00 euros.')),{reject:'NOT_A_SIGNAL'});
 assert.deepEqual(classifyAnnouncement(rec({familleavis:'vente',familleavis_lib:'Ventes et cessions'})),{reject:'NOT_A_SIGNAL'},'no category: no signal, never a guess');
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

// Owner request (2026-11-20): changes of executive are read where the BODACC writes them — listepersonnes.personne.administration —
// since the descriptif only says « modification survenue sur l'administration » (40 of 40 real notices of the 31 were missed).
const lp=(administration:string,typePersonne='pm')=>JSON.stringify({personne:{typePersonne,denomination:'KERLAN',administration,adresseSiegeSocial:{ville:'Rennes'}}});
const adminMod=JSON.stringify({descriptif:"modification survenue sur l'administration"});
test('executive change: read in listepersonnes.administration, role and name only, auditors and addresses dropped',()=>{
 const c=classifyAnnouncement(rec({modificationsgenerales:adminMod,listepersonnes:lp('Gérant partant : DURAND Marc ; nomination du Gérant : LEROY Anne ; nomination du Commissaire aux comptes titulaire : AUDIT OUEST')})) as any;
 assert.equal(c.type,'leadership_change');
 assert.equal(c.detail,"modification survenue sur l'administration — Gérant partant : DURAND Marc ; nomination du Gérant : LEROY Anne");
 const rep=classifyAnnouncement(rec({modificationsgenerales:adminMod,listepersonnes:lp('nomination du Président : HOLDING KER représenté par LEROY Anne : 12 rue des Lices 35000 Rennes')})) as any;
 assert.equal(rep.detail,"modification survenue sur l'administration — nomination du Président : HOLDING KER",'no address after « représenté par »');
 assert.doesNotMatch(rep.detail,/Lices|35000/);
});
test('executive change: not for auditors only, a natural person, a dissolution or a move to another registry',()=>{
 assert.deepEqual(classifyAnnouncement(rec({modificationsgenerales:adminMod,listepersonnes:lp('nomination du Commissaire aux comptes titulaire : AUDIT OUEST')})),{reject:'NOT_A_SIGNAL'});
 assert.deepEqual(classifyAnnouncement(rec({modificationsgenerales:adminMod,listepersonnes:lp('nomination du Gérant : LEROY Anne','pp')})),{reject:'NOT_A_SIGNAL'});
 assert.deepEqual(classifyAnnouncement(rec({modificationsgenerales:JSON.stringify({descriptif:"Cessation d'activité et dissolution de la société"}),listepersonnes:lp('nomination du Liquidateur : LEROY Anne')})),{reject:'NOT_A_SIGNAL'});
 const moved="Transfert du siège hors ressort d'une personne morale par voie modificative, modification survenue sur l'adresse du siège et l'administration";
 assert.equal((classifyAnnouncement(rec({modificationsgenerales:JSON.stringify({descriptif:moved}),listepersonnes:lp('nomination du Gérant : LEROY Anne')})) as any).type,'new_site','the new registry lists every executive again');
 assert.equal((classifyAnnouncement(rec({modificationsgenerales:JSON.stringify({descriptif:moved}),listepersonnes:lp('Gérant partant : DURAND Marc ; nomination du Gérant : LEROY Anne')})) as any).type,'leadership_change','a departure is a change wherever the company goes');
});

test('one buyer, one « rachat » signal within 30 days: the newest notice (owner decision, 25 nov. 2026)',async()=>{
 const sale=(id:string,date:string,category:string)=>rec({id,dateparution:date,familleavis:'vente',familleavis_lib:'Ventes et cessions',modificationsgenerales:undefined,
  url_complete:`https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${id}`,acte:JSON.stringify({vente:{categorieVente:category}}),
  listeetablissements:JSON.stringify({etablissement:{origineFonds:'Achat au prix stipulé de 60000,00 euros.',adresse:{codePostal:'35000'}}})});
 const {request}=api([sale('B3','2026-09-28',"Mise en activité d'une société suite à achat"),sale('B2','2026-09-10',"Achat d'un fonds par une personne morale (insertion provisoire)"),
  sale('B1','2026-06-02',"Achat d'un fonds par une personne morale (insertion provisoire)")]);
 const p=new BodaccSignalProvider(request);
 const out=await p.searchSignals({target:T,types:[],now:NOW});
 assert.deepEqual(out.map(s=>s.metadata?.bodacc_id),['B3','B1'],'B2 (18 days before B3) is the same purchase; B1, months earlier, is another one');
 assert.equal(p.takeRejections().DUPLICATE_PURCHASE,1);
});

test('a notice cancelled by a later notice of the same company is never a signal (migration 055, 25 nov. 2026)',async()=>{
 const sale=rec({id:'A202602204824',dateparution:'2026-09-17',familleavis:'vente',familleavis_lib:'Ventes et cessions',modificationsgenerales:undefined,
  url_complete:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A202602204824',acte:JSON.stringify({vente:{categorieVente:"Achat d'un fonds par une personne morale (insertion provisoire)"}}),
  listeetablissements:JSON.stringify({etablissement:{origineFonds:'Achat au prix stipulé de 60000,00 euros.',adresse:{codePostal:'35000'}}})});
 const cancel=rec({id:'A202602233148',dateparution:'2026-09-20',typeavis:'annulation',typeavis_lib:'Avis d’annulation',familleavis:'vente',familleavis_lib:'Ventes et cessions',modificationsgenerales:undefined,
  parutionavisprecedent:JSON.stringify({nomPublication:'BODACC A',numeroParution:'20260220',dateParution:'2026-09-17',numeroAnnonce:'4824'})});
 const p=new BodaccSignalProvider(api([cancel,sale]).request);
 assert.deepEqual(await p.searchSignals({target:T,types:[],now:NOW}),[]);
 assert.deepEqual(p.takeRejections(),{CORRECTION:1,CANCELLED:1});
 const alone=new BodaccSignalProvider(api([sale]).request);
 assert.equal((await alone.searchSignals({target:T,types:[],now:NOW})).length,1,'without its cancellation the sale is a signal');
});
