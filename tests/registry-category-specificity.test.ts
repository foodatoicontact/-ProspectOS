// Registry category specificity (canary 2f1ea224, PASS_WITH_WARNINGS): "industriel" + "agroalimentaire" were
// queried as a UNION — the whole NAF section C plus the 44 agri-food codes — so only 10/20 results were agri-food.
// Product decision: a requested group whose NAF scope lies entirely inside another requested group's scope
// replaces it (the most precise one wins). Inclusion is computed from the groups' declared NAF scopes (section,
// divisions, codes), never from their words. Independent groups keep the existing combination.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as naf from '../src/discovery/registry/naf.ts';
import {RegistryProvider} from '../src/discovery/providers/registry.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {DiscoveryInputSchema,type Candidate} from '../src/discovery/types.ts';

const keys=(terms:string[])=>naf.proposeNafGroups(terms).groups.map(g=>g.key);
// Synthetic scopes for the pure reduction (the real table has only two groups, one inside the other).
type Scope={key:string;section:string|null;codes:string[]};
const reduce=(groups:Scope[])=>{const fn=(naf as Record<string,unknown>).reduceNafGroups as undefined|((g:Scope[])=>{groups:Scope[];narrowed:Array<{key:string;into:string[]}>});
 assert.equal(typeof fn,'function','reduceNafGroups is exported');return fn!(groups)};

test('A — ["industriel","agroalimentaire"] → agroalimentaire only',()=>{
 assert.deepEqual(keys(['industriel','agroalimentaire']),['agroalimentaire']);
 assert.deepEqual(keys(['agroalimentaire','industriel']),['agroalimentaire'],'order does not matter');
});

test('B — ["agroalimentaire"] → agroalimentaire',()=>{assert.deepEqual(keys(['agroalimentaire']),['agroalimentaire'])});

test('C — ["industriel"] → industriel (a broad group alone is kept)',()=>{assert.deepEqual(keys(['industriel']),['industriel'])});

test('D — a broad scope and a scope truly inside it → only the specialized one (from the declared scopes, not the words)',()=>{
 assert.deepEqual(keys(['Industrie manufacturière','agro-alimentaire']),['agroalimentaire']);
 const r=reduce([{key:'broad',section:'C',codes:[]},{key:'dairy',section:null,codes:['10.51A','10.51C']}]);
 assert.deepEqual(r.groups.map(g=>g.key),['dairy']);
 assert.deepEqual(r.narrowed,[{key:'broad',into:['dairy']}]);
 const lists=reduce([{key:'food',section:null,codes:['10.51A','10.51C','10.71A']},{key:'dairy',section:null,codes:['10.51A','10.51C']}]);
 assert.deepEqual(lists.groups.map(g=>g.key),['dairy'],'a code list inside a larger code list');
 assert.deepEqual(reduce([{key:'broad',section:'C',codes:[]},{key:'retail',section:null,codes:['47.11F']}]).groups.map(g=>g.key),['broad','retail'],'a code outside section C is not inside it');
 assert.deepEqual(reduce([{key:'broad',section:'C',codes:[]},{key:'mixed',section:null,codes:['10.51A','47.11F']}]).groups.map(g=>g.key),['broad','mixed'],'partly outside: not included, both kept');
});

test('E — two independent specialized groups → both kept, in order',()=>{
 const r=reduce([{key:'dairy',section:null,codes:['10.51A','10.51C']},{key:'drinks',section:null,codes:['11.01Z','11.02B']}]);
 assert.deepEqual(r.groups.map(g=>g.key),['dairy','drinks']);assert.deepEqual(r.narrowed,[]);
 const overlap=reduce([{key:'a',section:null,codes:['10.51A','10.71A']},{key:'b',section:null,codes:['10.71A','11.01Z']}]);
 assert.deepEqual(overlap.groups.map(g=>g.key),['a','b'],'overlapping but neither inside the other: both kept');
});

test('F — a duplicate category is one group',()=>{assert.deepEqual(keys(['agroalimentaire','agroalimentaire']),['agroalimentaire'])});

test('G — business query "agroalimentaire" + category "industriel" → agroalimentaire only',()=>{
 assert.deepEqual(keys(['industriel','agroalimentaire'/* the query, appended last as the provider does */]),['agroalimentaire']);
 const p=naf.proposeNafGroups(['industriel','agroalimentaire']) as ReturnType<typeof naf.proposeNafGroups>&{requested?:string[];narrowed?:unknown};
 assert.deepEqual(p.requested,['industriel','agroalimentaire'],'what was asked is kept for the record');
 assert.deepEqual(p.narrowed,[{key:'industriel',into:['agroalimentaire']}]);
});

const empty={results:[],total_results:0,page:1,per_page:25,total_pages:0};
const CANARY={project_id:'p',query:'agroalimentaire',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire'],max_results:20,optional_filters:{provider:'registry' as const}};

test('provider — the canary input sends no generic industry query: the 44 agri-food codes only, before any request',async()=>{
 const sent:URL[]=[];
 const p=new RegistryProvider({wait:async()=>{},fetch:(async(u:string|URL)=>{sent.push(new URL(String(u)));return Response.json(empty)}) as unknown as typeof fetch});
 await p.searchCompanies(DiscoveryInputSchema.parse(CANARY));
 assert.ok(sent.length>=1);
 assert.equal(sent.filter(u=>u.searchParams.has('section_activite_principale')).length,0,'no section C query');
 for(const u of sent){const codes=u.searchParams.get('activite_principale')!.split(',');assert.equal(codes.length,44);assert.ok(codes.every(c=>/^1[01]\.\d{2}[A-Z]$/.test(c)))}
 assert.equal(p.lastSearch!.queries_planned,1);
});

const co=(i:number,naf_:string)=>({siren:String(300000000+i),nom_complet:`SOC ${i}`,nom_raison_sociale:`SOC ${i}`,etat_administratif:'A',statut_diffusion:'O',activite_principale:naf_,
 siege:{region:'84',commune:'69123',libelle_commune:'LYON',code_postal:'69001',etat_administratif:'A',statut_diffusion_etablissement:'O'},matching_etablissements:[]});
class Repo implements DiscoveryRepository {
 finished:Array<Record<string,unknown>>=[];
 async start(){return {id:'run-1',provider:'registry',status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_r:unknown,rows:{candidate:Candidate}[]){return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(_id:string,_n:number,metrics:Record<string,unknown>){this.finished.push(metrics)}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){return []}
}

test('observability — the run metrics carry the requested/kept groups, NAF scope and admission counts; no URL, no name',async()=>{
 // page 1: 3 admitted (one listed twice) + 1 inactive + 1 non-diffusible; page 2 refused (counted as a failed request).
 const results=[co(1,'10.71A'),co(2,'11.01Z'),co(3,'10.51C'),co(1,'10.71A'),{...co(4,'10.71A'),etat_administratif:'C'},{...co(5,'10.71A'),statut_diffusion:'P'}];
 const p=new RegistryProvider({wait:async()=>{},fetch:(async(u:string|URL)=>new URL(String(u)).searchParams.get('page')==='1'?Response.json({results,total_pages:2}):new Response('',{status:503})) as unknown as typeof fetch});
 const repo=new Repo();await new DiscoveryService(repo,p,()=>{}).find_prospects(CANARY);
 const m=repo.finished[0]!;
 assert.equal(m.registry_groups_requested,'industriel,agroalimentaire');
 assert.equal(m.registry_groups_kept,'agroalimentaire');
 assert.equal(m.registry_groups_narrowed,'industriel>agroalimentaire');
 assert.equal(m.registry_naf_scope,'agroalimentaire:codes:44');
 assert.equal(m.registry_naf_code_count,44);
 assert.equal(m.registry_examined,6);
 assert.equal(m.registry_admitted,3);
 assert.equal(m.registry_rejected,2);
 assert.match(String(m.registry_rejected_reasons),/^[A-Z_]+:1,[A-Z_]+:1$/);
 assert.equal(m.registry_duplicates,1);
 assert.equal(m.search_requests_failed,1);
 assert.doesNotMatch(JSON.stringify(m),/https?:|SOC \d|LYON|30000000\d/,'no URL, no company data in the metrics');
});
