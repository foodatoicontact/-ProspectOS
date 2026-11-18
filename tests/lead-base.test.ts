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
 assert.match(read('src/ui/v2/dedicated/Dedicated.tsx'),/leads=\{\(contractId,prepare\)=><LeadBase api=\{api\} contractId=\{contractId\} onPrepare=\{prepare\}\/>\}/);
 assert.doesNotMatch(read('src/ui/v2/dedicated/LeadBase.tsx'),/#[0-9a-f]{3,6}\b|rgba?\(/i,'theme tokens only');
});
