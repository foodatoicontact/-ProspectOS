// Public simulator V1 — funnel analytics. Closed schema, five kinds, enum values only: never the offer text, the target
// text, a matched word, personal data or generated content. The public endpoint only validates and writes ONE structured
// log line: no database, no Supabase, no external call. Anything else is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSimEvent,simLogLine,SIM_EVENT_KINDS,SIM_EVENT_ENDPOINT,SIM_EVENT_MAX_BYTES} from '../src/simulator/events.ts';

const SID='0f8fad5b-d9cb-469f-a165-70867728950e';
const ok=[
 {kind:'simulator.viewed',sid:SID},
 {kind:'simulator.started',sid:SID,region:'occ'},
 {kind:'simulator.completed',sid:SID,scenario_id:'restauration',fallback:false,prospects:3},
 {kind:'simulator.prospect_opened',sid:SID,scenario_id:'btp',slot:2},
 {kind:'simulator.signup_clicked',sid:SID,scenario_id:'generique'},
 {kind:'simulator.signup_clicked',sid:SID,scenario_id:'cabinets',slot:1},
];
test('the five kinds, the endpoint, the size cap',()=>{
 assert.deepEqual([...SIM_EVENT_KINDS],['simulator.viewed','simulator.started','simulator.completed','simulator.prospect_opened','simulator.signup_clicked']);
 assert.equal(SIM_EVENT_ENDPOINT,'/api/public/simulator-event');assert.equal(SIM_EVENT_MAX_BYTES,1024);
 for(const e of ok)assert.deepEqual(parseSimEvent(e),e,e.kind);
});
test('closed schema — free text, extra fields, unknown values and bad ids are refused',()=>{
 const bad:unknown[]=[
  null,'x',[],{},{kind:'simulator.viewed'},{kind:'simulator.viewed',sid:'not-a-uuid'},
  {kind:'simulator.started',sid:SID,region:'occ',offer:'Un logiciel de caisse'},
  {kind:'simulator.started',sid:SID,region:'occ',target:'Restaurants'},
  {kind:'simulator.started',sid:SID,region:'Occitanie'},
  {kind:'simulator.completed',sid:SID,scenario_id:'restauration',fallback:false,prospects:3,matched:['restauration']},
  {kind:'simulator.completed',sid:SID,scenario_id:'autre',fallback:false,prospects:3},
  {kind:'simulator.completed',sid:SID,scenario_id:'restauration',fallback:false,prospects:4},
  {kind:'simulator.prospect_opened',sid:SID,scenario_id:'btp',slot:0},
  {kind:'simulator.signup_clicked',sid:SID,scenario_id:'btp',email:'a@b.example'},
  {kind:'simulator.message_generated',sid:SID},
 ];
 for(const b of bad)assert.equal(parseSimEvent(b),null,JSON.stringify(b));
});
test('the log line: one JSON object, the event and the time only',()=>{
 const line=simLogLine(ok[2] as never,new Date('2026-10-11T10:00:00Z'));
 assert.deepEqual(JSON.parse(line),{type:'simulator_event',at:'2026-10-11T10:00:00.000Z',kind:'simulator.completed',sid:SID,scenario_id:'restauration',fallback:false,prospects:3});
 assert.ok(!line.includes('\n'));
});
test('endpoint — 204 and one log line for a valid event; 400 / 413 / 405 otherwise; never a database',async()=>{
 const {POST,GET}=await import('../app/api/public/simulator-event/route.ts');
 const logs:string[]=[];const orig=console.info;console.info=(...a:unknown[])=>{logs.push(a.map(String).join(' '))};
 try{
  const req=(body:string,headers:Record<string,string>={'content-type':'application/json'})=>new Request('http://localhost/api/public/simulator-event',{method:'POST',headers,body});
  let r=await POST(req(JSON.stringify(ok[1])));
  assert.equal(r.status,204);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0]).kind,'simulator.started');
  r=await POST(req(JSON.stringify({...ok[1],offer:'Un logiciel de caisse'})));assert.equal(r.status,400);
  r=await POST(req('{not json'));assert.equal(r.status,400);
  r=await POST(req(JSON.stringify({...ok[0],pad:'x'.repeat(2000)})));assert.equal(r.status,413);
  assert.equal(logs.length,1,'nothing logged for a refused event');
  assert.equal((await GET()).status,405);
 }finally{console.info=orig}
 const src=readFileSync(new URL('../app/api/public/simulator-event/route.ts',import.meta.url),'utf8')+readFileSync(new URL('../src/simulator/events.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/supabase|createClient|createAdminClient|\.from\(|rpc\(|anthropic|insert/i,'no database, no provider');
 assert.doesNotMatch(src,/x-forwarded-for|user-agent|cookie|authorization/i,'no visitor identifier read');
});
test('client sender — beacon to the one endpoint, best effort, no other network call',()=>{
 const src=readFileSync(new URL('../src/simulator/events.ts',import.meta.url),'utf8');
 assert.match(src,/navigator\.sendBeacon\(SIM_EVENT_ENDPOINT,/);
 assert.equal((src.match(/fetch\(/g)??[]).length,1,'a single keepalive fallback');
 assert.match(src,/fetch\(SIM_EVENT_ENDPOINT,\{method:'POST',keepalive:true/);
});
