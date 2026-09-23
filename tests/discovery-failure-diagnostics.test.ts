import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DiscoveryService,type DiscoveryRepository} from '../src/discovery/services.ts';
import {BraveProvider} from '../src/discovery/providers/brave.ts';
import {diagnoseDiscoveryFailure} from '../src/discovery/failure-diagnostics.ts';

// Observability only: a failed Discovery still stores and throws the single generic DISCOVERY_FAILED;
// the server log now says which step failed and why, as fixed codes only. The real BraveProvider runs
// against an injected fake fetch — no network, no Brave request.
const KEY='BRAVE-TEST-KEY-7f3a9c';
const SECRETS=[KEY,'X-Subscription-Token','sk-live-9Qx','tok_prospect_secret','Acme Secrète SARL','acme-secrete.fr','contact@acme-secrete.fr','row-level detail'];
const input={project_id:'p',query:'paid media',location:'France',categories:[],max_results:3};
class Repo implements DiscoveryRepository {
 finished:{error?:string}[]=[];saveError?:Error;
 async start(){return {id:'run-1',provider:'brave',status:'running',result_count:0,error_message:null}}
 async existing(){return []}
 async saveResults(){if(this.saveError)throw this.saveError;return []}
 async finish(_id:string,_count:number,_metrics:unknown,error?:string){this.finished.push({error})}
 async prospect():Promise<never>{throw Error('unused')}
 async projectCriteria(){return []}
 async consumeAnalysis(){}
 async saveObservations(){return []}
}
const braveReturning=(response:()=>Promise<Response>)=>new BraveProvider(KEY,(async()=>response()) as typeof fetch);
const json=(body:unknown,status=200)=>async()=>new Response(JSON.stringify(body),{status});
async function failWith(provider:BraveProvider,repo=new Repo(),tweak?:(s:DiscoveryService)=>void){
 const logs:Record<string,unknown>[]=[];const service=new DiscoveryService(repo,provider,e=>logs.push(e));tweak?.(service);
 let thrown:unknown;await service.find_prospects(input).catch(e=>{thrown=e});
 // External behavior is unchanged: the same generic error, no cause attached, DISCOVERY_FAILED stored.
 assert.ok(thrown instanceof Error);assert.equal(thrown.message,'DISCOVERY_FAILED');assert.equal(thrown.cause,undefined);
 assert.deepEqual(repo.finished,[{error:'DISCOVERY_FAILED'}]);
 assert.equal(logs.length,1);const log=logs[0];assert.equal(log.error,'DISCOVERY_FAILED');
 for(const v of Object.values(log))assert.ok(v===null||typeof v==='string'||typeof v==='number','flat, loggable values only');
 const text=JSON.stringify(log);for(const s of SECRETS)assert.ok(!text.includes(s),`log must not contain ${s}`);
 assert.doesNotMatch(text,/https?:|www\.|@/,'no URL or address is ever logged');
 return log;
}
// A result carrying prospect content, an address and a token-like URL — none of it may reach the log.
const sensitiveResult={title:'Acme Secrète SARL recrute',url:'https://acme-secrete.fr/jobs?token=tok_prospect_secret',description:'Écrire à contact@acme-secrete.fr — sk-live-9Qx'};

test('Brave HTTP error → BRAVE_HTTP_<status> with the status', async () => {
 const log=await failWith(braveReturning(json({error:'rate limited',key:KEY},429)));
 assert.equal(log.stage,'provider_search');assert.equal(log.cause,'BRAVE_HTTP_429');assert.equal(log.http_status,429);
});
test('Brave timeout → PROVIDER_TIMEOUT', async () => {
 const log=await failWith(braveReturning(async()=>{throw new DOMException(`timeout ${KEY}`,'TimeoutError')}));
 assert.equal(log.cause,'PROVIDER_TIMEOUT');assert.equal(log.stage,'provider_search');
});
test('network failure → PROVIDER_NETWORK', async () => {
 const log=await failWith(braveReturning(async()=>{throw new TypeError(`fetch failed X-Subscription-Token ${KEY}`)}));
 assert.equal(log.cause,'PROVIDER_NETWORK');
});
test('unparseable Brave body → PROVIDER_RESPONSE_PARSE', async () => {
 const log=await failWith(braveReturning(async()=>new Response('<html>Acme Secrète SARL</html>',{status:200})));
 assert.equal(log.cause,'PROVIDER_RESPONSE_PARSE');assert.equal(log.fields,null);
});
test('Brave body with an invalid result shape → PROVIDER_RESPONSE_PARSE with the field path only', async () => {
 const log=await failWith(braveReturning(json({web:{results:[{title:'',url:'https://acme-secrete.fr/?token=tok_prospect_secret'}]}})));
 assert.equal(log.cause,'PROVIDER_RESPONSE_PARSE');assert.equal(log.fields,'web.results.0.title:too_small');
});
test('normalization/validation failure → NORMALIZATION_INVALID with field:code only, for that result alone', async () => {
 // Since the per-result isolation, an invalid result no longer fails the run: it is dropped and logged.
 const logs:Record<string,unknown>[]=[];const repo=new Repo();
 const found=await new DiscoveryService(repo,braveReturning(json({web:{results:[{...sensitiveResult,title:'   '}]}})),e=>logs.push(e)).find_prospects(input);
 assert.equal(found.status,'completed');assert.deepEqual(repo.finished,[{error:undefined}]);
 const log=logs.find(l=>l.event==='normalization_rejected')!;
 assert.equal(log.stage,'normalize');assert.equal(log.cause,'NORMALIZATION_INVALID');assert.equal(log.fields,'name:too_small');
 const text=JSON.stringify(logs);for(const s of SECRETS)assert.ok(!text.includes(s),`log must not contain ${s}`);
});
test('duplicate matching failure → DEDUPE_FAILED', async () => {
 const log=await failWith(braveReturning(json({web:{results:[sensitiveResult]}})),new Repo(),s=>{s.dedupe.match=()=>{throw Error('Acme Secrète SARL acme-secrete.fr')}});
 assert.equal(log.stage,'dedupe');assert.equal(log.cause,'DEDUPE_FAILED');
});
test('persistence failure → repository code + database error code, never the database message', async () => {
 const repo=new Repo();repo.saveError=Error('DATABASE_REQUEST_FAILED',{cause:{code:'42501',message:'row-level detail acme-secrete.fr'}});
 const log=await failWith(braveReturning(json({web:{results:[sensitiveResult]}})),repo);
 assert.equal(log.stage,'save');assert.equal(log.cause,'DATABASE_REQUEST_FAILED');assert.equal(log.db_code,'42501');
});
test('unknown error → UNKNOWN, the message is never logged', async () => {
 const provider=braveReturning(json({}));provider.searchCompanies=async()=>{throw Error(`secret ${KEY} sk-live-9Qx`)};
 const log=await failWith(provider);
 assert.equal(log.cause,'UNKNOWN');assert.equal(log.error_name,'Error');
});
test('diagnosis sanitizes hostile schema paths and codes', () => {
 const d=diagnoseDiscoveryFailure('normalize',{issues:[{path:['raw_metadata','https://acme-secrete.fr/x',3],code:'Acme Secrète'}]});
 assert.equal(d.fields,'raw_metadata.?.3:?');
 assert.equal(diagnoseDiscoveryFailure('save',{message:'x',cause:{code:'tok_prospect_secret'}}).db_code,null);
});
test('the browser-facing mapping of DISCOVERY_FAILED is untouched (same message, same 400)', () => {
 const api=readFileSync(new URL('../src/discovery/api.ts',import.meta.url),'utf8');
 assert.match(api,/DISCOVERY_FAILED:'La recherche a échoué\. Consultez son état ; aucune preuve n’a été validée\.'/);
 assert.match(api,/const log=\(event:Record<string,string\|number\|null>\)=>console\.info\(JSON\.stringify\(\{component:'discovery',\.\.\.event\}\)\);/,'the diagnosis goes to the server log only');
 assert.match(api,/return json\(\{error:messages\[code\]\?\?'Requête Discovery invalide',code:code in messages\?code:'INVALID_REQUEST'\}/);
});
