// Signal-first query planning — the user's need_fit signals (optional_filters.criteria) take part in the search,
// within the existing budget of 3 provider requests per run. A signal query is PROVENANCE ONLY: a page found with
// "incident cyber" is not proof of an incident, never an observation, never a point of score.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planSearchQueries} from '../src/discovery/query-plan.ts';
import {buildSearchVariants,searchUntilNewTarget,MAX_PROVIDER_CALLS} from '../src/discovery/search-until-new.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {DEFAULT_CRITERIA,scoreProspect,type Criterion} from '../src/domain/core.ts';
import type {Candidate,DiscoveryRun} from '../src/discovery/types.ts';

const needFit=(signals:string[]):Criterion[]=>DEFAULT_CRITERIA.map(c=>c.key==='need_fit'?{...c,rules:{type:'need_fit',config:{signals}}}:{...c});
const VIGIL={query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire']};
const vigil=(signals=['recrutent un RSSI','incident cyber'])=>({...VIGIL,optional_filters:{provider:'brave' as const,criteria:needFit(signals)}});

type Hit={title:string;url:string;description?:string};
class Repo implements DiscoveryRepository {
 saved:Candidate[]=[];finished:Array<{metrics:Record<string,unknown>}>=[];observations=0;
 async start(){return {id:'run-1',provider:'brave',status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async memory(){return {results:[],runs:[]}}
 async saveResults(_run:unknown,rows:{candidate:Candidate}[]){this.saved=rows.map(r=>r.candidate);return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(_id:string,_n:number,metrics:Record<string,unknown>){this.finished.push({metrics})}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){this.observations++;return []}
}
// Every Brave request is recorded (its q); answer(q) says what that request returns.
function run(input:Record<string,unknown>,answer:(q:string)=>Hit[]=()=>[]){
 const sent:string[]=[];const metered:number[]=[];
 const brave=new BraveProvider('k',(async(url:URL)=>{const q=new URL(String(url)).searchParams.get('q')??'';sent.push(q);return Response.json({web:{results:answer(q)}})}) as unknown as typeof fetch);
 const repo=new Repo();
 const service=new DiscoveryService(repo,brave,()=>{},async(_r:DiscoveryRun,n:number)=>{metered.push(n)});
 return {sent,metered,repo,done:service.find_prospects({project_id:'p',max_results:20,...input})};
}

test('1 — Vigil exact: the main query is kept, then one query per meaningful need signal (3 at most)',()=>{
 const before=planSearchQueries(VIGIL).queries;
 assert.deepEqual(before,['industriel agroalimentaire auvergne-rhône-alpes'],'main is unchanged without signals');
 const after=planSearchQueries(vigil()).queries;
 assert.equal(after.length,3,JSON.stringify(after));
 assert.equal(after[0],before[0],'the main query stays first, unchanged');
 assert.match(after[1]!,/\brssi\b/i);assert.match(after[1]!,/auvergne-rhône-alpes/);
 assert.match(after[2]!,/\bincident cyber\b/i);assert.match(after[2]!,/auvergne-rhône-alpes/);
});

test('1b — Vigil exact through the real provider: those 3 requests are actually sent, no more',async()=>{
 const r=run(vigil());await r.done;
 assert.deepEqual(r.sent,planSearchQueries(vigil()).queries);
});

test('2 — no need signal: the plan is strictly the one of main',()=>{
 for(const input of [VIGIL,{query:'Distributeurs B2B au Maroc',location:'Maroc',categories:['Fournitures pro','Mobilier pro']},{query:'Restaurants indépendants',location:'Occitanie',categories:['restaurant']}]){
  const base=planSearchQueries(input);
  assert.deepEqual(planSearchQueries({...input,optional_filters:{criteria:DEFAULT_CRITERIA}}),base,'starter ICP (no rule)');
  assert.deepEqual(planSearchQueries({...input,optional_filters:{}}),base,'no criteria');
 }
});

test('3 — a meaningless signal ("des", "idéalement") never becomes a query',()=>{
 assert.deepEqual(planSearchQueries(vigil(['des','idéalement'])).queries,planSearchQueries(VIGIL).queries);
 assert.deepEqual(planSearchQueries(vigil(['des','incident cyber'])).queries.length,2);
});

test('4 — hard budget: at most 3 provider calls per run, whatever the number of signals (normal mode)',async()=>{
 const many=['recrutent un RSSI','incident cyber','conformité NIS2','ISO 27001','rançongiciel','audit sécurité'];
 assert.ok(planSearchQueries(vigil(many)).queries.length<=3);
 // A directory snippet citing companies would also ask for a secondary-resolution request: still 3 in all.
 const r=run(vigil(many),()=>[{title:'Annuaire des industriels',url:'https://annuaire.example/industrie',description:'1. Alpha Industrie 2. Beta Process 3. Gamma Usinage'}]);
 await r.done;
 assert.ok(r.sent.length<=MAX_PROVIDER_CALLS,`${r.sent.length} requests`);
 assert.equal(r.sent.length,3);
});

test('4b — hard budget in search-new: variants, signal queries and secondary resolution share the same 3 calls',async()=>{
 const many=['recrutent un RSSI','incident cyber','conformité NIS2','ISO 27001','rançongiciel'];
 const r=run({...vigil(many),optional_filters:{...vigil(many).optional_filters,search_mode:'search_new'}},()=>[{title:'Annuaire des industriels',url:'https://annuaire.example/industrie',description:'1. Alpha Industrie 2. Beta Process 3. Gamma Usinage'}]);
 await r.done;
 assert.ok(r.sent.length<=MAX_PROVIDER_CALLS,`${r.sent.length} requests`);
});

test('4c — priority: the signal queries are spent before a secondary-resolution request (search-new)',async()=>{
 const variants=buildSearchVariants(vigil());
 assert.equal(variants.filter(v=>v.kind==='signal').length,2,JSON.stringify(variants));
 const sent:string[]=[];
 // Each pass brings one new actor; the reservation for a secondary request is always wanted.
 const res=await searchUntilNewTarget<string>({variants,desiredNewResults:99,runPass:async v=>{sent.push(v.query);return [v.query]},countNew:all=>all.length,reserveLastCall:()=>true});
 assert.equal(res.providerCalls,3);
 assert.ok(sent.some(q=>/rssi/.test(q))&&sent.some(q=>/incident cyber/.test(q)),JSON.stringify(sent));
 assert.equal(res.lastCallReserved,false);
});

test('5 — dedup: one page found by several queries is one candidate, with every query in its provenance',async()=>{
 const page={title:'Fromageries Exemple — fabricant de fromages en Savoie',url:'https://www.fromageries-exemple.fr/',description:'Fromageries Exemple, fabricant de fromages AOP en Savoie, Auvergne-Rhône-Alpes.'};
 const r=run(vigil(),()=>[page]);await r.done;
 const same=r.repo.saved.filter(c=>c.website?.includes('fromageries-exemple'));
 assert.equal(same.length,1);
 assert.equal((same[0]!.raw_metadata.search_queries as string[]).length,3);
});

test('6 — list safety: an aggregated job board or a directory found by a signal query is never a candidate',async()=>{
 const r=run(vigil(),q=>/rssi/.test(q)?[{title:'Rssi, Auvergne-Rhône-Alpes : plus de 25 emplois',url:'https://fr.indeed.com/q-rssi-l-auvergne-rh%C3%B4ne-alpes-emplois.html',description:'Offres d’emploi RSSI en Auvergne-Rhône-Alpes.'}]:/incident/.test(q)?[{title:'Top 10 des industriels victimes de cyberattaques',url:'https://www.example-media.fr/top-10-cyberattaques-industrie',description:'Classement des cyberattaques.'}]:[]);
 await r.done;
 assert.ok(r.repo.saved.length>=2);
 assert.ok(r.repo.saved.every(c=>c.raw_metadata.source_class!=='COMPANY_CANDIDATE'),JSON.stringify(r.repo.saved.map(c=>[c.name,c.raw_metadata.source_class])));
});

test('7 — evidence-first: a result found by a signal query carries no evidence and no score',async()=>{
 const page={title:'Fromageries Exemple — fabricant de fromages en Savoie',url:'https://www.fromageries-exemple.fr/',description:'Fromageries Exemple recrute un RSSI après un incident cyber.'};
 const r=run(vigil(),q=>/rssi|incident/.test(q)?[page]:[]);await r.done;
 assert.equal(r.repo.observations,0,'Discovery never writes an observation');
 assert.doesNotMatch(JSON.stringify(r.repo.saved),/VERIFIED|"evidence"/);
 assert.equal(scoreProspect(needFit(['recrutent un RSSI','incident cyber']),[]).score,0);
});

test('8 — explicit human action: planning sends nothing, and the panel launches only from its search form',async()=>{
 let fetched=0;const original=globalThis.fetch;globalThis.fetch=(async()=>{fetched++;return new Response('{}')}) as typeof fetch;
 try{planSearchQueries(vigil());buildSearchVariants(vigil())}finally{globalThis.fetch=original}
 assert.equal(fetched,0);
 const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 const launches=[...panel.matchAll(/discovery`,'POST'/g)];
 assert.equal(launches.length,1);
 const searchFn=panel.indexOf('async function search(form:FormData)');
 assert.ok(searchFn>=0&&launches[0]!.index!>searchFn&&launches[0]!.index!<panel.indexOf('async function accept('),'the only launch is inside search(form)');
});

test('9 — cost accounting: the metered count is the number of requests actually sent',async()=>{
 for(const input of [{...VIGIL},vigil(['incident cyber']),vigil()]){
  const r=run(input);await r.done;
  assert.deepEqual(r.metered,[r.sent.length]);
  assert.equal(r.repo.finished[0]!.metrics.search_requests,r.sent.length);
 }
});
