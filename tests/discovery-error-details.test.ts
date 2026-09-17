// Observability-only regression: the original Postgres/PostgREST error must reach server logs even
// though supabase-js resolves {data,error} as a plain object rather than throwing an Error instance
// (see repository.ts's checked()). The public API contract (ANALYSIS_FAILED, nothing more) is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CompanyAnalysisService, causeField, type DiscoveryRepository} from '../src/discovery/services.ts';
import type {DiscoveryRun, Observation} from '../src/discovery/types.ts';
import {DEFAULT_CRITERIA} from '../src/domain/core.ts';

test('causeField reads code/message/details/hint from a plain (non-Error) PostgREST-shaped object',()=>{
 const cause={operation:'save_discovery_observations',code:'22023',message:'Evidence fields required',details:null,hint:null};
 assert.equal(cause instanceof Error,false,'precondition: this mirrors what supabase-js actually resolves, never an Error instance');
 assert.equal(causeField(cause,'operation'),'save_discovery_observations');
 assert.equal(causeField(cause,'code'),'22023');
 assert.equal(causeField(cause,'message'),'Evidence fields required');
 assert.equal(causeField(cause,'details'),null);
 assert.equal(causeField(cause,'hint'),null);
});
test('causeField never throws on missing or non-object causes',()=>{
 assert.equal(causeField(undefined,'code'),null);
 assert.equal(causeField(null,'code'),null);
 assert.equal(causeField('plain string', 'code'),null);
 assert.equal(causeField({},'code'),null);
});

class FailingRepo implements DiscoveryRepository {
 dbCause:unknown;
 constructor(dbCause:unknown){this.dbCause=dbCause}
 async start(){return {id:'run',provider:'fixture',status:'running',result_count:0,error_message:null} as DiscoveryRun}
 async existing(){return []}
 async saveResults(){return []}
 async finish(){}
 async prospect(id:string){return {id,website:'https://alpha.fixture.example/',organization_id:'a',project_id:'p'}}
 async projectCriteria(){return DEFAULT_CRITERIA}
 async consumeAnalysis(){}
 async saveObservations(_id:string,_observations:Observation[]):Promise<unknown[]>{
  // Exactly the shape checked() throws: a generic wrapper message with the real, plain-object
  // PostgREST error preserved as .cause (never itself an Error instance).
  throw Error('DATABASE_REQUEST_FAILED',{cause:this.dbCause});
 }
}

test('analyze_company logs the original code/message/details/hint server-side, but the client only ever sees ANALYSIS_FAILED',async()=>{
 const dbCause={operation:'save_discovery_observations',code:'22023',message:'Evidence fields required',details:null,hint:null};
 const repo=new FailingRepo(dbCause);
 const logs:Record<string,unknown>[]=[];
 const fetchPage=async(url:string)=>({url,html:'<html><body><h1>Alpha Services</h1><p>Nous accompagnons les PME dans la gestion de leurs demandes clients.</p><p>Contact : 05 00 00 00 11</p></body></html>'});
 const service=new CompanyAnalysisService(repo,fetchPage,event=>logs.push(event));
 await assert.rejects(service.analyze_company('p1','test_fixture'),/ANALYSIS_FAILED/);
 assert.equal(logs.length,1);
 const event=logs[0];
 assert.equal(event.error,'ANALYSIS_FAILED');
 assert.equal(event.db_operation,'save_discovery_observations');
 assert.equal(event.db_code,'22023');
 assert.equal(event.db_message,'Evidence fields required');
 assert.equal(event.db_details,null);
 assert.equal(event.db_hint,null);
 // Non-sensitive shape metadata only — never raw excerpts, URLs, or claim text.
 assert.ok(typeof event.observation_count==='number'&&event.observation_count>0);
 assert.ok(typeof event.statuses==='string');
 assert.ok(!Object.values(event).some(v=>typeof v==='string'&&v.includes('05 00 00 00 11')),'no excerpt/content ever logged');
});

test('a failure with no database cause at all still logs cleanly, with all db_* fields null',async()=>{
 class NoDbCauseRepo extends FailingRepo {
  async saveObservations():Promise<unknown[]>{throw Error('something unrelated to the database failed');}
 }
 const repo=new NoDbCauseRepo(undefined);
 const logs:Record<string,unknown>[]=[];
 const fetchPage=async(url:string)=>({url,html:'<html><body><p>Bonjour</p></body></html>'});
 const service=new CompanyAnalysisService(repo,fetchPage,event=>logs.push(event));
 await assert.rejects(service.analyze_company('p1'),/ANALYSIS_FAILED/);
 const event=logs[0];
 assert.equal(event.db_operation,null);
 assert.equal(event.db_code,null);
 assert.equal(event.db_message,null);
});
