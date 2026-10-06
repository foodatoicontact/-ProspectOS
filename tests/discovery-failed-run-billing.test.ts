// A run whose source answered NO request gives its Discovery unit back (migration 021, server only); a run that
// delivered anything — even incomplete — stays billed, and a refund failure never hides the run's own error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RegistryProvider} from '../src/discovery/providers/registry.ts';
import {DiscoveryService,nothingAnswered,type DiscoveryRepository} from '../src/discovery/services.ts';
import type {Candidate,ProviderSearchReport} from '../src/discovery/types.ts';

const VIGIL={project_id:'p',query:'industriel',location:'Auvergne-Rhône-Alpes',categories:['industriel','agroalimentaire'],max_results:20,optional_filters:{provider:'registry' as const}};
class Repo implements DiscoveryRepository {
 released:string[]=[];failRelease=false;finished:Array<{error?:string}>=[];
 async start(_i:unknown,provider:string){return {id:'run-1',provider,status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(_r:unknown,rows:{candidate:Candidate}[]){return rows.map((r,i)=>({id:String(i),normalized_payload:r.candidate,dedupe_status:'unique' as const,duplicate_of:null,status:'pending' as const,prospect_id:null}))}
 async finish(_id:string,_n:number,_m:Record<string,unknown>,error?:string){this.finished.push({error})}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){return []}
 async releaseFailedRun(id:string){if(this.failRelease)throw Error('RELEASE_FAILED');this.released.push(id)}
}
const registry=(status:(url:URL)=>number)=>new RegistryProvider({wait:async()=>{},fetch:(async(u:string|URL)=>{const url=new URL(String(u));const s=status(url);return s===200?Response.json({results:[],total_pages:0}):new Response('',{status:s})}) as unknown as typeof fetch});

test('nothingAnswered: no request at all, or every request without an answer — never when one answered',()=>{
 const r=(o:Partial<ProviderSearchReport>):ProviderSearchReport=>({queries_planned:1,requests_sent:0,requests_failed:0,failure_codes:[],country:'FR',country_reason:'x',...o});
 assert.equal(nothingAnswered(undefined),true,'failed before the provider was even asked');
 assert.equal(nothingAnswered(r({requests_sent:0})),true);
 assert.equal(nothingAnswered(r({requests_sent:2,requests_failed:2})),true);
 assert.equal(nothingAnswered(r({requests_sent:3,requests_failed:2})),false);
 assert.equal(nothingAnswered(r({requests_sent:4,requests_failed:2,requests_answered:0})),true,'retries: the explicit answered count wins');
 assert.equal(nothingAnswered(r({requests_sent:4,requests_failed:1,requests_answered:2})),false);
});

test('register down (no answer): the run fails explicitly AND its unit is given back',async()=>{
 const repo=new Repo();
 await assert.rejects(new DiscoveryService(repo,registry(()=>503)).find_prospects(VIGIL),/DISCOVERY_FAILED/);
 assert.equal(repo.finished[0]!.error,'DISCOVERY_FAILED');assert.deepEqual(repo.released,['run-1']);
});

test('every request refused even after its 429 retry: no answer → given back',async()=>{
 const repo=new Repo();
 await assert.rejects(new DiscoveryService(repo,registry(()=>429)).find_prospects(VIGIL),/DISCOVERY_FAILED/);
 assert.deepEqual(repo.released,['run-1']);
});

test('partial run (one group answered): completed and billed, nothing given back',async()=>{
 const repo=new Repo();
 await new DiscoveryService(repo,registry(url=>url.searchParams.get('section_activite_principale')==='C'?503:200)).find_prospects(VIGIL);
 assert.equal(repo.finished[0]!.error,undefined);assert.deepEqual(repo.released,[]);
});

test('a failure AFTER the source answered (e.g. saving) stays billed: the source did its work',async()=>{
 const repo=new Repo();repo.saveResults=async()=>{throw Error('DATABASE_REQUEST_FAILED')};
 await assert.rejects(new DiscoveryService(repo,registry(()=>200)).find_prospects(VIGIL),/DISCOVERY_FAILED/);
 assert.deepEqual(repo.released,[]);
});

test('a refund that fails never hides the run’s own error',async()=>{
 const repo=new Repo();repo.failRelease=true;
 await assert.rejects(new DiscoveryService(repo,registry(()=>503)).find_prospects(VIGIL),/DISCOVERY_FAILED/);
});

test('the release goes through the server’s privileged client only',async()=>{
 const repoSrc=await readFile(new URL('../src/discovery/repository.ts',import.meta.url),'utf8');
 assert.match(repoSrc,/async releaseFailedRun\(id:string\)\{if\(!this\.writer\)return;await checked\(this\.writer\.db\.rpc\('release_failed_discovery',\{p_run_id:id\}\)\)\}/);
 const sql=await readFile(new URL('../db/migrations/021_discovery_failed_run_not_billed.sql',import.meta.url),'utf8');
 assert.match(sql,/revoke all on function public\.release_failed_discovery\(uuid\) from public,anon,authenticated;/);
 assert.match(sql,/grant execute on function public\.release_failed_discovery\(uuid\) to service_role;/);
});
