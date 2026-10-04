// The company register made selectable in ProspectOS: explicit choice, explicit launch, one Discovery quota per
// run (database: tests/discovery-registry-db.mjs), no provider cost, the QuickStart headcount carried to the
// register as a structured filter only, non-public register entries never shown, and fixture/Brave unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createDiscoveryProvider,discoveryProviderConfig,isMeteredSearchProvider,providerSpecificFilters} from '../src/discovery/providers/index.ts';
import {RegistryProvider} from '../src/discovery/providers/registry.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {FixtureProvider} from '../src/discovery/providers/fixture.ts';
import {admitRegistryCompany} from '../src/discovery/registry/admission.ts';
import {resolveRegistryZone} from '../src/discovery/registry/zone.ts';
import {summarizeRuns,replayFields} from '../src/discovery/run-history.ts';
import {computeRunCostMetrics} from '../src/discovery/cost-metrics.ts';
import {diagnoseDiscoveryFailure} from '../src/discovery/failure-diagnostics.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {DiscoveryInputSchema,type Candidate} from '../src/discovery/types.ts';
import {planSearchQueries} from '../src/discovery/query-plan.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

type Raw=Record<string,any>;
const AURA=resolveRegistryZone('Auvergne-Rhône-Alpes')!;
const page=(n:number):Raw=>JSON.parse(readFileSync(new URL(`./fixtures/registry/vigil-section-c-aura-200-1999-page-${n}.json`,import.meta.url),'utf8'));
const VIGIL={project_id:'p',query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire'],max_results:20,optional_filters:{provider:'registry' as const,employee_range:{min:200,max:2000}}};
const empty={results:[],total_results:0,page:1,per_page:25,total_pages:0};

test('API — the register is a provider of its own: explicit id, never a fallback to or from Brave',()=>{
 assert.ok(createDiscoveryProvider('registry',{})instanceof RegistryProvider);
 assert.ok(createDiscoveryProvider('brave',{BRAVE_SEARCH_API_KEY:'k'})instanceof BraveProvider);
 assert.ok(createDiscoveryProvider('fixture',{})instanceof FixtureProvider);
 assert.ok(createDiscoveryProvider(undefined,{})instanceof FixtureProvider,'no choice is still the TEST provider, as before');
 assert.throws(()=>createDiscoveryProvider('brave',{}),/BRAVE_NOT_CONFIGURED/,'Brave without a key fails explicitly — never replaced by the register');
 assert.equal(DiscoveryInputSchema.parse(VIGIL).optional_filters.provider,'registry');
});

test('API — discovery-config lists the register as available, live, keyless, with a non-evidence label',()=>{
 const providers=discoveryProviderConfig({}).providers;
 assert.deepEqual(providers.map(p=>p.id),['fixture','brave','registry']);
 const registry=providers.find(p=>p.id==='registry')!;
 assert.equal(registry.available,true);assert.equal(registry.mode,'live');assert.equal(registry.label,'Registre des entreprises — données publiques');
 assert.equal(providers.find(p=>p.id==='brave')!.available,false,'Brave still depends on its own key');
 assert.equal(discoveryProviderConfig({BRAVE_SEARCH_API_KEY:'k'}).providers.find(p=>p.id==='brave')!.available,true);
});

test('D — the register costs nothing: never metered in the cost ledger; a run shows 0 provider cost',async()=>{
 assert.equal(isMeteredSearchProvider('registry'),false);
 assert.equal(isMeteredSearchProvider('brave'),true);assert.equal(isMeteredSearchProvider('fixture'),false);
 const rows:Record<string,unknown>={discovery_runs:{id:'r',provider:'registry',result_count:19},discovery_results:[],api_usage_events:[]};
 const q=(table:string)=>{const data=rows[table];const chain:any={select:()=>chain,eq:()=>chain,in:()=>chain,single:()=>chain,then:(ok:any)=>ok({data,error:null})};return chain};
 const m=await computeRunCostMetrics({from:q} as any,'r');
 assert.equal(m.provider_cost_micros,0);assert.equal(m.total_estimated_cost_micros,0);
 assert.match(m.cost_unavailable_reason??'',/registre public/i);
});

test('E — the QuickStart headcount reaches the register only, as a structured filter',async()=>{
 assert.deepEqual(providerSpecificFilters('registry',{min:200,max:2000}),{employee_range:{min:200,max:2000}});
 assert.deepEqual(providerSpecificFilters('brave',{min:200,max:2000}),{},'never sent with a Brave search');
 assert.deepEqual(providerSpecificFilters('fixture',{min:200,max:2000}),{});
 assert.deepEqual(providerSpecificFilters('registry',null),{});
 // the Brave plan ignores it entirely, whatever the filters carry
 const brave={...VIGIL,optional_filters:{employee_range:{min:200,max:2000}}};
 assert.ok(planSearchQueries(brave).queries.every(q=>!/200|2000|salari/.test(q)));
 // QuickStart → prefill → panel → optional_filters
 const page_=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page_,/setDiscoveryPrefill\(\{projectId:id,\.\.\.p\.discovery,employeeRange:p\.employeeRange\}\)/);
 const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/providerSpecificFilters\(provider,fields\.employeeRange\)/);
 // … and to the register query itself
 const sent:URL[]=[];
 const p=new RegistryProvider({fetch:(async(u:string|URL)=>{sent.push(new URL(String(u)));return Response.json(empty)}) as unknown as typeof fetch,wait:async()=>{}});
 await p.searchCompanies(DiscoveryInputSchema.parse(VIGIL));
 assert.ok(sent.length&&sent.every(u=>u.searchParams.get('tranche_effectif_salarie')==='31,32,41,42'));
});

const site=(o:Raw={})=>({siret:'00000000000001',activite_principale:'25.62B',etat_administratif:'A',region:'84',commune:'69123',libelle_commune:'LYON',tranche_effectif_salarie:'12',est_siege:false,statut_diffusion_etablissement:'O',...o});
const company=(o:Raw={})=>({siren:'000000001',nom_complet:'ACME',nom_raison_sociale:'ACME',etat_administratif:'A',statut_diffusion:'O',activite_principale:'25.62B',tranche_effectif_salarie:'32',
 siege:{region:'11',commune:'75101',libelle_commune:'PARIS',code_postal:'75001',etat_administratif:'A',statut_diffusion_etablissement:'O'},matching_etablissements:[site()],...o});

test('F — a register entry that is not publicly diffusible is never a candidate; a non-public site is never used or shown',()=>{
 assert.equal(admitRegistryCompany(company(),AURA).admitted,true,'control');
 for(const status of ['P','N',null,undefined]){
  const v=admitRegistryCompany(company({statut_diffusion:status}),AURA);
  assert.equal(v.admitted,false,String(status));assert.equal(!v.admitted&&v.reason,'NOT_PUBLICLY_DIFFUSIBLE');
 }
 assert.equal(admitRegistryCompany(company({matching_etablissements:[site({statut_diffusion_etablissement:'P'})]}),AURA).admitted,false,'only a non-public production site');
 const head=company({siege:{region:'84',commune:'69123',libelle_commune:'LYON',code_postal:'69001',etat_administratif:'A',statut_diffusion_etablissement:'P'},matching_etablissements:[]});
 assert.equal(admitRegistryCompany(head,AURA).admitted,false,'a non-public head office is not used');
 const mixed=admitRegistryCompany(company({matching_etablissements:[site({siret:'1',statut_diffusion_etablissement:'P'}),site({siret:'2'})]}),AURA);
 assert.ok(mixed.admitted&&mixed.sites.every(s=>s.siret==='2'),'only public sites are kept');
 // the real 50 are all public: unchanged
 assert.ok([...page(1).results,...page(2).results].every((r:Raw)=>r.statut_diffusion==='O'));
});

test('J/K — a failing register: total failure is explicit (REGISTRY_UNAVAILABLE), partial failure keeps what was obtained',async()=>{
 assert.equal(diagnoseDiscoveryFailure('provider_search',Error('REGISTRY_UNAVAILABLE')).cause,'REGISTRY_UNAVAILABLE');
 const replay=(url:URL)=>url.searchParams.get('section_activite_principale')==='C'?(Number(url.searchParams.get('page'))<=2?{...page(Number(url.searchParams.get('page'))),total_pages:2}:empty):empty;
 // the agri-food group fails on its own (e.g. a parameter the API refuses): the industry group is kept
 const p=new RegistryProvider({fetch:(async(u:string|URL)=>{const url=new URL(String(u));return url.searchParams.has('activite_principale')?new Response('',{status:400}):Response.json(replay(url))}) as unknown as typeof fetch,wait:async()=>{}});
 assert.equal((await p.searchCompanies(DiscoveryInputSchema.parse(VIGIL))).length,19);
 assert.deepEqual(p.lastSearch!.failure_codes,['HTTP_400']);assert.deepEqual(p.lastAdmission!.failed_groups,['agroalimentaire']);
});

class Repo implements DiscoveryRepository {
 saved:Candidate[]=[];finished:Array<{metrics:Record<string,unknown>;error?:string}>=[];observations=0;provider='';
 async start(_i:unknown,provider:string){this.provider=provider;return {id:'run-1',provider,status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_r:unknown,rows:{candidate:Candidate}[]){this.saved=rows.map(r=>r.candidate);return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(_id:string,_n:number,metrics:Record<string,unknown>,error?:string){this.finished.push({metrics,error})}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){this.observations++;return []}
}

test('J — through the pipeline: a register down fails the run explicitly, with its failure codes in the run metrics',async()=>{
 const repo=new Repo();const logs:Record<string,unknown>[]=[];
 const p=new RegistryProvider({fetch:(async()=>new Response('',{status:503})) as unknown as typeof fetch,wait:async()=>{}});
 await assert.rejects(new DiscoveryService(repo,p,e=>logs.push(e)).find_prospects(VIGIL),/DISCOVERY_FAILED/);
 assert.equal(repo.provider,'registry');
 assert.equal(repo.finished[0]!.error,'DISCOVERY_FAILED');assert.equal(repo.finished[0]!.metrics.search_failure_codes,'HTTP_503,HTTP_503');
 assert.ok(logs.some(l=>l.cause==='REGISTRY_UNAVAILABLE'));
});

test('L — the QuickStart never launches a search: it only prefills the form',async()=>{
 const page_=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const confirm=/confirm:async\(id,p\)=>\{[^\n]*/.exec(page_)![0];
 assert.doesNotMatch(confirm,/api\(|discovery`,'POST'|find_prospects/);
 const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.equal([...panel.matchAll(/discovery`,'POST'/g)].length,1,'one launch, inside the search form');
});

test('N — the history keeps and shows the register as the run’s source; a replay pre-selects it again',()=>{
 const [run]=summarizeRuns([{id:'r',query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel'],provider:'registry',filters_json:{max_results:20,employee_range:{min:200,max:2000}},status:'completed',started_at:'2026-10-04T19:00:00Z',completed_at:null,result_count:19}]);
 assert.equal(run!.provider,'registry');assert.deepEqual(run!.employee_range,{min:200,max:2000});
 const f=replayFields(run!,false,true);assert.equal(f.provider,'registry');assert.deepEqual(f.employeeRange,{min:200,max:2000});
 assert.equal(replayFields(run!,false,false).provider,'fixture','demo: never a real source');
 assert.equal(fr['discovery.providerRegistry'],'Registre des entreprises — données publiques');assert.ok(en['discovery.providerRegistry']);
 // Brave and fixture rows read exactly as before
 const [brave,fixture]=summarizeRuns([{id:'b',query:'q',location:'l',categories:[],provider:'brave',status:'completed',started_at:'2026-10-04T18:00:00Z',completed_at:null,result_count:1},{id:'f',query:'q',location:'l',categories:[],provider:'fixture',status:'completed',started_at:'2026-10-04T17:00:00Z',completed_at:null,result_count:1}]);
 assert.equal(brave!.provider,'brave');assert.equal(fixture!.provider,'fixture');
 assert.equal(replayFields(brave!,true).provider,'brave');
});

test('UI — the register option is a public-data source, never presented as evidence, never asking for a key',async()=>{
 const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/<option value="registry"[^>]*>\{tr\('discovery\.providerRegistry'\)\}<\/option>/);
 assert.match(fr['discovery.registryNote'],/identit/i);assert.match(fr['discovery.registryNote'],/n.est pas une preuve/i);
 assert.doesNotMatch(fr['discovery.registryNote']+fr['discovery.providerRegistry'],/clé|API key/i);
});

// ——— trust boundary: every register request is bounded in time, size and redirects ———
test('bounds — a register request that hangs is aborted by its own timeout; the group fails alone',async()=>{
 const seen:RequestInit[]=[];
 const p=new RegistryProvider({timeoutMs:20,wait:async()=>{},fetch:(async(_u:string|URL,init:RequestInit)=>{seen.push(init);return new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason)))}) as unknown as typeof fetch});
 // AbortSignal.timeout's timer does not keep Node's event loop alive on its own (a server does): hold it open here.
 const keepAlive=setInterval(()=>{},50);
 try{await assert.rejects(p.searchCompanies(DiscoveryInputSchema.parse(VIGIL)),/REGISTRY_UNAVAILABLE/)}finally{clearInterval(keepAlive)}
 assert.deepEqual(p.lastSearch!.failure_codes,['TIMEOUT','TIMEOUT']);
 assert.ok(seen.every(i=>i.redirect==='error'),'redirects are refused, like Brave');
});

test('bounds — an oversized register response is refused, never parsed',async()=>{
 const huge=JSON.stringify({results:[],total_pages:1,pad:'x'.repeat(2_100_000)});
 const p=new RegistryProvider({wait:async()=>{},fetch:(async()=>new Response(huge,{status:200,headers:{'content-type':'application/json'}})) as unknown as typeof fetch});
 await assert.rejects(p.searchCompanies(DiscoveryInputSchema.parse(VIGIL)),/REGISTRY_UNAVAILABLE/);
 assert.deepEqual(p.lastSearch!.failure_codes,['RESPONSE_TOO_LARGE','RESPONSE_TOO_LARGE']);
});

test('bounds — pagination stops at the run time budget, keeping what was found (well under the 60 s route limit)',async()=>{
 let clock=0;const sent:URL[]=[];
 const full=(i:number)=>({siren:String(200000000+i),nom_raison_sociale:`S${i}`,etat_administratif:'A',statut_diffusion:'O',siege:{region:'84',commune:'69123',etat_administratif:'A',statut_diffusion_etablissement:'O'},matching_etablissements:[]});
 const p=new RegistryProvider({timeBudgetMs:1000,now:()=>clock,wait:async()=>{},fetch:(async(u:string|URL)=>{const url=new URL(String(u));sent.push(url);clock+=600;const n=Number(url.searchParams.get('page'));return Response.json({results:[full(n)],total_pages:9})}) as unknown as typeof fetch});
 const out=await p.searchCompanies(DiscoveryInputSchema.parse({...VIGIL,categories:['industriel']}));
 assert.equal(sent.length,2,'no request is started once the budget is spent');assert.equal(out.length,2);
 assert.ok(p.lastSearch!.failure_codes.includes('TIME_BUDGET_REACHED'));
 const {REGISTRY_TIME_BUDGET_MS,REGISTRY_REQUEST_TIMEOUT_MS}=await import('../src/discovery/providers/registry.ts');
 assert.ok(REGISTRY_TIME_BUDGET_MS+REGISTRY_REQUEST_TIMEOUT_MS<=45000&&REGISTRY_REQUEST_TIMEOUT_MS<=12000);
});
