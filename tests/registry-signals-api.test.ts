// Signaux SIRENE — presets (configuration validated, replaceable by REGISTRY_SIGNAL_PRESETS_JSON) and the HTTP routes
// (src/registry-signals/api.ts) with a fake database: flag off = 404, validation, configuration refused before any unit
// is consumed, refusals mapped to stable codes, the route wired after authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPresets,NAF_CODE} from '../src/registry-signals/presets.ts';
import {registrySignalsConfig} from '../src/registry-signals/config.ts';
import {handleRegistrySignals,isRegistrySignalsPath,type RegistrySignalsDeps} from '../src/registry-signals/api.ts';

test('presets — defaults validate; NAF codes as the register writes them; ambiguities documented; env replaces them',()=>{
 const p=loadPresets({});
 assert.deepEqual(Object.keys(p).sort(),['commerce_ouverture','paramedical_installation']);
 assert.equal(p.paramedical_installation!.max_age_days,183);assert.equal(p.commerce_ouverture!.max_age_days,92);
 for(const preset of Object.values(p))for(const code of preset.naf_codes)assert.match(code,NAF_CODE,code);
 assert.deepEqual(p.paramedical_installation!.naf_codes,['86.90F']);
 assert.ok(p.paramedical_installation!.ambiguities.some(a=>/86\.90F/.test(a)),'the shared code is said');
 assert.equal(p.commerce_ouverture!.naf_codes.some(c=>/^47\.[89]/.test(c)),false,'no market stall or distance selling: no shop');
 for(const c of ['56.10A','56.10C','96.02A','96.02B','47.24Z'])assert.ok(p.commerce_ouverture!.naf_codes.includes(c),c);
 const custom=loadPresets({REGISTRY_SIGNAL_PRESETS_JSON:JSON.stringify({boulangeries:{label:'Boulangeries',max_age_days:30,naf_codes:['10.71C','47.24Z']}})});
 assert.deepEqual(Object.keys(custom),['boulangeries']);assert.deepEqual(custom.boulangeries!.name_keywords,[]);
 for(const bad of ['{',JSON.stringify({x:{label:'X',max_age_days:30,naf_codes:['5610A']}}),JSON.stringify({}),JSON.stringify({ok:{label:'X',max_age_days:0,naf_codes:['56.10A']}})])
  assert.throws(()=>loadPresets({REGISTRY_SIGNAL_PRESETS_JSON:bad}),/REGISTRY_PRESETS_INVALID/);
});
test('config — flag, key presence, bounded numbers with defaults',()=>{
 const d=registrySignalsConfig({});
 assert.deepEqual([d.enabled,d.placesApiKey,d.sireneCacheTtlS,d.placesCacheTtlS,d.sireneMinIntervalMs,d.maxRetries],[false,'',86400,3600,150,4]);
 const c=registrySignalsConfig({REGISTRY_SIGNALS_ENABLED:'true',GOOGLE_PLACES_API_KEY:' k ',REGISTRY_SIGNALS_SIRENE_MIN_INTERVAL_MS:'10',REGISTRY_SIGNALS_SIRENE_CACHE_TTL_S:'0'});
 assert.deepEqual([c.enabled,c.placesApiKey,c.sireneMinIntervalMs,c.sireneCacheTtlS],[true,'k',150,0],'below the API pace falls back to the default');
});

const PROJECT='11111111-1111-4111-8111-111111111111',CAND='22222222-2222-4222-8222-222222222222';
const json=(v:unknown,status=200)=>Response.json(v,{status});
const req=(method:string)=>new Request('https://x.example/api',{method});
const fakeDb=()=>{const rpcs:Array<[string,unknown]>=[];
 return {rpcs,db:{rpc:async(name:string,args:unknown)=>{rpcs.push([name,args]);
  if(name==='ignore_registry_signal_candidate')return {data:{status:'IGNORED'},error:null};
  if(name==='add_registry_signal_candidate_to_project')return {data:null,error:{message:'CANDIDATE_IGNORED'}};
  return {data:null,error:{message:'unexpected'}}},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:CAND,google_place_id:null,google_match_status:'non_confirme'},error:null})})})})} as any}};
const deps=(o:Partial<RegistrySignalsDeps>={}):RegistrySignalsDeps=>({config:registrySignalsConfig({REGISTRY_SIGNALS_ENABLED:'true',GOOGLE_PLACES_API_KEY:'k'}),userId:'u',
 now:()=>new Date('2026-10-30T09:00:00Z'),requireEntitlement:async()=>{},writer:()=>{throw Error('no writer in tests')},env:{},...o});

test('routes — flag off answers 404 everywhere; unrelated paths are not handled',async()=>{
 const f=fakeDb();
 const off=await handleRegistrySignals(req('POST'),['projects',PROJECT,'registry-signals'],{preset:'commerce_ouverture',postal_code:'33185'},f.db,json,deps({config:registrySignalsConfig({})}));
 assert.equal(off?.status,404);assert.equal(f.rpcs.length,0);
 assert.equal(await handleRegistrySignals(req('GET'),['prospects',PROJECT],{},f.db,json,deps()),null);
 assert.equal(isRegistrySignalsPath(['registry-signal-presets']),true);assert.equal(isRegistrySignalsPath(['projects',PROJECT,'signal-discovery']),false);
});
test('routes — validation and configuration refuse before any unit is consumed',async()=>{
 const f=fakeDb();
 const bad=await handleRegistrySignals(req('POST'),['projects',PROJECT,'registry-signals'],{preset:'commerce_ouverture',postal_code:'3318'},f.db,json,deps());
 assert.equal(bad?.status,400);
 const unknown=await handleRegistrySignals(req('POST'),['projects',PROJECT,'registry-signals'],{preset:'inconnu',postal_code:'33185'},f.db,json,deps());
 assert.equal((await unknown!.json()).code,'UNKNOWN_PRESET');
 const noKey=await handleRegistrySignals(req('POST'),['projects',PROJECT,'registry-signals'],{preset:'commerce_ouverture',postal_code:'33185'},f.db,json,
  deps({config:registrySignalsConfig({REGISTRY_SIGNALS_ENABLED:'true'})}));
 assert.equal(noKey?.status,503);assert.equal((await noKey!.json()).code,'PLACES_NOT_CONFIGURED');
 const noWriter=await handleRegistrySignals(req('POST'),['projects',PROJECT,'registry-signals'],{preset:'commerce_ouverture',postal_code:'33185'},f.db,json,deps());
 assert.equal((await noWriter!.json()).code,'CONFIGURATION_REQUIRED');
 assert.equal(f.rpcs.length,0,'no start_registry_signal_run: no unit consumed');
 const presets=await handleRegistrySignals(req('GET'),['registry-signal-presets'],{},f.db,json,deps());
 assert.deepEqual((await presets!.json()).map((p:{key:string})=>p.key).sort(),['commerce_ouverture','paramedical_installation']);
});
test('routes — review actions go through the 038 functions; refusals are stable codes; Google details only for a confirmed place',async()=>{
 const f=fakeDb();
 const ign=await handleRegistrySignals(req('POST'),['registry-signal-candidates',CAND,'ignore'],{},f.db,json,deps());
 assert.equal(ign?.status,200);assert.deepEqual(f.rpcs[0],['ignore_registry_signal_candidate',{p_candidate_id:CAND}]);
 const add=await handleRegistrySignals(req('POST'),['registry-signal-candidates',CAND,'add'],{},f.db,json,deps());
 assert.equal(add?.status,409);assert.equal((await add!.json()).code,'CANDIDATE_IGNORED');
 const both=await handleRegistrySignals(req('POST'),['registry-signal-candidates',CAND,'add'],{name:'X',prospect_id:PROJECT},f.db,json,deps());
 assert.equal(both?.status,400);
 const g=await handleRegistrySignals(req('GET'),['registry-signal-candidates',CAND,'google'],{},f.db,json,deps());
 assert.equal(g?.status,404);assert.equal((await g!.json()).code,'NO_CONFIRMED_PLACE');
});
test('route wiring — after authentication, with the server config and the Discovery entitlement',()=>{
 const route=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');const h=route.indexOf('async function handler(');
 assert.ok(route.indexOf('const {db,user}=await authenticatedDb(request);',h)<route.indexOf('handleRegistrySignals(request',h));
 assert.match(route,/config:registrySignalsConfig\(process\.env\),userId:user\.id/);
 assert.match(route,/requireEntitlement:\(\)=>requireActiveEntitlement\(db,user\.id\),writer:\(\)=>createAdminClient\(\)/);
 assert.doesNotMatch(route.slice(route.indexOf('handleRegistrySignals(request')),/GOOGLE_PLACES_API_KEY/,'the key is read by the config module only');
});
