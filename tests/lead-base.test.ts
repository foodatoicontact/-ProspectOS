// Base entreprises de la veille (migration 049, src/leads): the administrator's API and the panel's helpers.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {handleLeads} from '../src/leads/api.ts';
import {tradeKey,deliveryLines,KIND_SOURCE} from '../src/leads/model.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const json=(v:unknown,status=200)=>Response.json(v,{status});
const C='5f0c1d9e-8b7a-4c3d-9e2f-1a2b3c4d5e6f';
function fakeDb(answer:{data?:unknown;error?:{message:string;code?:string}}={data:{ok:true}}){
 const calls:[string,Record<string,unknown>][]=[];
 return {calls,db:{rpc:async(fn:string,args:Record<string,unknown>)=>{calls.push([fn,args]);return {data:answer.data??null,error:answer.error??null}}} as any};
}
const req=(method:string,url:string,body?:unknown)=>new Request(`https://x.test/api/v1/${url}`,{method,body:body===undefined?undefined:JSON.stringify(body)});

test('trade key: the label without accents, lower case — two clients of « Sécurité incendie » share one trade',()=>{
 assert.equal(tradeKey('Sécurité incendie'),'securite-incendie');
 assert.equal(tradeKey('  Référencement IA / GEO '),'referencement-ia-geo');
 assert.equal(tradeKey('SÉCURITÉ   Incendie'),tradeKey('sécurité incendie'));
});
test('delivery lines: only reserved leads with a name and an https source, in the simple form format (no stray ;)',()=>{
 const lines=deliveryLines([{siren:'900000001',name:'HÔTEL; EXEMPLE',commune:'Pantin',kind:'VENTE_FONDS',source_url:'https://www.bodacc.fr/a',reserved:true},
  {siren:'900000002',name:'NON RÉSERVÉ',commune:'X',kind:'CREATION',source_url:'https://www.bodacc.fr/b',reserved:false},
  {siren:'900000003',name:null,commune:'X',kind:'CREATION',source_url:'https://www.bodacc.fr/c',reserved:true},
  {siren:'900000004',name:'SANS LIEN',commune:null,kind:'TRANSFERT_SIEGE',source_url:'http://insecure',reserved:true}]);
 assert.equal(lines,`900000001;HÔTEL EXEMPLE;Pantin;${KIND_SOURCE.VENTE_FONDS};https://www.bodacc.fr/a`);
});
test('API: off without the veille flag; routes to the admin functions with validated arguments',async()=>{
 let f=fakeDb();assert.equal((await handleLeads(req('GET',`leads/contracts/${C}/pool`),['leads','contracts',C,'pool'],f.db,json,{enabled:false}))!.status,404);
 assert.equal(await handleLeads(req('GET','dedicated'),['dedicated'],f.db,json,{enabled:true}),null,'other paths are not taken');
 f=fakeDb();await handleLeads(req('GET',`leads/contracts/${C}/pool?days=9999&limit=0`),['leads','contracts',C,'pool'],f.db,json,{enabled:true});
 assert.deepEqual(f.calls[0],['admin_lead_pool',{p_contract_id:C,p_days:400,p_limit:100}]);
 f=fakeDb();const r=await handleLeads(req('POST',`leads/contracts/${C}/profile`,{trade_label:'Sécurité incendie',departments:['75','2a'],kinds:['VENTE_FONDS'],naf_prefixes:['43.21']}),['leads','contracts',C,'profile'],f.db,json,{enabled:true});
 assert.equal(r!.status,200);
 assert.deepEqual(f.calls[0],['admin_set_lead_profile',{p_contract_id:C,p_trade_key:'securite-incendie',p_trade_label:'Sécurité incendie',p_departments:['75','2A'],p_kinds:['VENTE_FONDS'],p_naf_prefixes:['43.21']}]);
 f=fakeDb();assert.equal((await handleLeads(req('POST',`leads/contracts/${C}/profile`,{trade_label:'X',departments:[],kinds:['VENTE_FONDS']}),['leads','contracts',C,'profile'],f.db,json,{enabled:true}))!.status,422);
 assert.equal(f.calls.length,0,'an invalid profile never reaches the database');
 f=fakeDb();await handleLeads(req('POST',`leads/contracts/${C}/reserve`,{sirens:['900000001','900000001','900000002']}),['leads','contracts',C,'reserve'],f.db,json,{enabled:true});
 assert.deepEqual(f.calls[0],['admin_assign_leads',{p_contract_id:C,p_sirens:['900000001','900000002']}]);
 f=fakeDb();assert.equal((await handleLeads(req('GET','leads/companies/12345'),['leads','companies','12345'],f.db,json,{enabled:true}))!.status,404);
});
test('API: the database refusals become sentences — admin only, profile missing, trade locked',async()=>{
 for(const [message,status,code] of [['Admin access required',403,'ADMIN_ACCESS_REQUIRED'],['lead_profile_missing',409,'PROFILE_MISSING'],['lead_trade_locked',409,'TRADE_LOCKED']] as const){
  const f=fakeDb({error:{message,code:'P0001'}});
  const r=await handleLeads(req('GET',`leads/contracts/${C}/pool`),['leads','contracts',C,'pool'],f.db,json,{enabled:true});
  assert.equal(r!.status,status);assert.equal((await r!.json()).code,code);
 }
});
test('wiring: after the veille handler, behind DEDICATED_TRACKING_ENABLED; a delivery of a lead held by a competitor is explained',()=>{
 const route=read('app/api/v1/[...path]/route.ts');
 assert.ok(route.indexOf('handleLeads(request')>route.indexOf('handleDedicated(request'));
 assert.match(route,/handleLeads\(request,path,db,json,\{enabled:dedicatedTrackingEnabled\(process\.env\)\}\)/);
 assert.match(read('src/dedicated/api.ts'),/lead_reserved_for_other_client:\['Une entreprise de cette livraison est réservée à un autre client du même métier/);
 assert.match(read('src/ui/v2/dedicated/Dedicated.tsx'),/leads=\{\(contractId,prepare,clientName\)=><LeadBase api=\{api\} contractId=\{contractId\} clientName=\{clientName\} onPrepare=\{prepare\} onDelivered=\{load\}\/>\}/);
 assert.doesNotMatch(read('src/ui/v2/dedicated/LeadBase.tsx'),/#[0-9a-f]{3,6}\b|rgba?\(/i,'theme tokens only');
});

test('delivery from the base: one card per reserved lead, sections in yield order, every sentence from the announcement',async()=>{
 const {buildLeadDelivery}=await import('../src/leads/model.ts');
 const lead=(o:Record<string,unknown>)=>({siren:'900000001',name:'HÔTEL EXEMPLE',naf:'55.10Z',employee_band:'11',department:'93',commune:'Pantin',kind:'VENTE_FONDS',event_on:'2026-11-17',
  source_url:'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',activity:'hôtel de tourisme',events:1,reserved:true,other_trades:0,lists:0,...o}) as any;
 const doc=buildLeadDelivery({clientName:'Détec Incendie',profile:{trade_label:'Sécurité incendie',departments:['93','94']},today:'2026-11-18',leads:[
  lead({siren:'900000003',kind:'CREATION',name:'NOUVELLE SAS',activity:null,event_on:'2026-11-16'}),lead({}),lead({siren:'900000002',kind:'TRANSFERT_SIEGE',name:'ENTREPÔT DÉMO',commune:'Rungis',department:'94'}),
  lead({siren:'900000004',reserved:false}),lead({siren:'900000005',source_url:'http://insecure'}),lead({siren:'900000006',name:null})]});
 assert.deepEqual(doc.items.map(i=>i.siren),['900000001','900000002','900000003'],'reserved, sourced, named; sales first, then moves, then creations');
 assert.deepEqual(doc.sections.map(s=>s.key),['reprises','demenagements','creations']);
 assert.equal(doc.skipped,2,'reserved but unusable leads are counted, never filled in');
 const c=doc.items[0]!;
 assert.equal(c.fact,'Achat d’un fonds de commerce publié au BODACC : hôtel de tourisme.');
 assert.equal(c.hook,'J’ai vu dans le BODACC du 17 novembre 2026 que HÔTEL EXEMPLE a repris un fonds à Pantin.');
 assert.deepEqual(c.chips,['NAF 55.10Z','10 à 19 salariés']);assert.equal(c.event_label,'17 novembre 2026');assert.equal(c.source_label,'BODACC — annonces commerciales');
 assert.equal(doc.items[2]!.fact,'Création de la société publiée au BODACC.');
 assert.deepEqual(doc.header,{prepared_for:'Détec Incendie',eyebrow:'Sécurité incendie · départements 93, 94 · 18 novembre 2026',
  lead:'Entreprises repérées dans les annonces officielles du BODACC et vérifiées au registre des entreprises : actives, sans opposition à la prospection, jamais une entreprise individuelle.',title_count:3});
 assert.equal(doc.scope,'Sécurité incendie — 3 entreprises, 18 novembre 2026');
 // The same document format the delivery import validates (src/dedicated/api.ts DocDelivery): section colours, keys, lengths.
 for(const s of doc.sections){assert.match(s.color,/^#[0-9a-fA-F]{6}$/);assert.match(s.key,/^[a-z0-9-]{1,30}$/)}
 for(const i of doc.items){assert.ok(i.event_label.length<=40&&i.badge.length<=40&&i.chips.length<=6);assert.match(i.source_url,/^https:\/\//)}
});
test('API deliver: the reserved leads become the next delivery through create_dedicated_delivery (no PDF, admin checked by the database)',async()=>{
 const calls:[string,any][]=[];
 const pool={profile:{trade_label:'Sécurité incendie',departments:['93']},waiting_enrichment:0,leads:[{siren:'900000001',name:'HÔTEL EXEMPLE',naf:null,employee_band:null,department:'93',commune:'Pantin',
  kind:'VENTE_FONDS',event_on:'2026-11-17',source_url:'https://www.bodacc.fr/x',activity:null,events:1,reserved:true,other_trades:0,lists:0}]};
 const db={rpc:async(fn:string,args:any)=>{calls.push([fn,args]);return fn==='admin_lead_pool'?{data:pool,error:null}:{data:{id:'d',number:3,items:1},error:null}}} as any;
 const r=await handleLeads(req('POST',`leads/contracts/${C}/deliver`,{client_name:'Détec Incendie'}),['leads','contracts',C,'deliver'],db,json,{enabled:true,now:()=>new Date('2026-11-18T09:00:00Z')});
 assert.equal(r!.status,201);assert.deepEqual(await r!.json(),{id:'d',number:3,items:1,skipped_leads:0});
 assert.equal(calls[1]![0],'create_dedicated_delivery');
 assert.deepEqual(Object.keys(calls[1]![1]).sort(),['p_contract_id','p_header','p_items','p_scope','p_sections'],'no PDF: the client reads the cards in the veille space');
 const empty={rpc:async(fn:string)=>fn==='admin_lead_pool'?{data:{...pool,leads:[]},error:null}:{data:null,error:null}} as any;
 assert.equal((await handleLeads(req('POST',`leads/contracts/${C}/deliver`,{client_name:'X'}),['leads','contracts',C,'deliver'],empty,json,{enabled:true}))!.status,409);
});
