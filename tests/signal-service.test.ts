// Signal Engine S2 — the SignalProvider contract and the scan orchestrator (src/signals/). Same shape as Discovery:
// providers return raw items, the service normalizes them through the strict schema, rejects with a reason code,
// deduplicates, stays within a request and time budget, and hands only valid candidates to save_signals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runSignalScan,contentHash,eventKey,type SignalRepository} from '../src/signals/service.ts';
import {FixtureSignalProvider} from '../src/signals/providers/fixture.ts';
import type {SignalProvider,SignalTarget,RawSignal} from '../src/signals/provider.ts';

const NOW=new Date('2026-10-06T12:00:00Z');
const T:SignalTarget={prospect_id:'p1',name:'ACME',website:'https://acme.example',siren:null,city:'Lyon'};
function repo(){const saved:any[]=[];const r:SignalRepository={saveSignals:async(prospectId,runId,list)=>{saved.push({prospectId,runId,list});return {inserted:list.length,duplicates:0}}};return {r,saved}}
const raw=(o:Partial<RawSignal>={}):RawSignal=>({signal_type:'hiring_role',title:'ACME recrute un RSSI',excerpt:'ACME recrute un RSSI à Lyon.',source_url:'https://jobs.example/acme/rssi',
 source_type:'job_board',published_at:'2026-10-02T09:00:00Z',event_date:null,metadata:{rank:1},...o});
function provider(items:RawSignal[],o:Partial<SignalProvider>={}):SignalProvider{
 return {id:'web_search',mode:'test',supports:()=>true,searchSignals:async()=>items,...o};
}

test('hash and event key: stable, normalized (case, spaces, accents), never the raw URL',()=>{
 assert.equal(contentHash('  ACME   recrute un RSSI. '),contentHash('acme recrute un rssi.'));
 assert.match(contentHash('x'),/^[0-9a-f]{64}$/);
 assert.equal(eventKey('hiring_role','2026-10-02','ACME recrute un RSSI'),eventKey('hiring_role','2026-10-02','acme  recrute un rssi'));
 assert.notEqual(eventKey('hiring_role','2026-10-02','A'),eventKey('funding','2026-10-02','A'));
 assert.ok(eventKey('funding',null,'x'.repeat(500)).length<=200);
});

test('scan: valid items become candidates (provider, observed date, matched profile terms), saved per prospect',async()=>{
 const {r,saved}=repo();
 const res=await runSignalScan({targets:[T],providers:[provider([raw()])],profile:{types:{hiring_role:25},terms:['RSSI','DevSecOps']},budget:{maxRequests:4,deadlineMs:10000},now:NOW,runId:'run1',repo:r});
 assert.equal(saved.length,1);assert.equal(saved[0].prospectId,'p1');assert.equal(saved[0].runId,'run1');
 const c=saved[0].list[0];
 assert.equal(c.provider,'web_search');assert.equal(c.observed_at,NOW.toISOString());assert.deepEqual(c.matched_terms,['RSSI']);
 assert.match(c.content_hash,/^[0-9a-f]{64}$/);assert.equal('status' in c,false);assert.equal('confidence' in c,false);
 assert.deepEqual(res.report,{targets:1,requests_sent:1,requests_failed:0,candidates:1,rejected:{},inserted:1,duplicates:0,out_of_time:false});
});

test('rejections are counted by reason, never saved: no URL, no excerpt, unknown type, future date, untracked type',async()=>{
 const {r,saved}=repo();
 const res=await runSignalScan({targets:[T],providers:[provider([
  raw({source_url:'not a url'}),raw({excerpt:' '}),raw({signal_type:'mood' as any}),raw({published_at:'2099-01-01T00:00:00Z'}),raw({signal_type:'event'}),raw(),
 ])],profile:{types:{hiring_role:25},terms:[]},budget:{maxRequests:4,deadlineMs:10000},now:NOW,runId:null,repo:r});
 assert.equal(saved[0].list.length,1);
 assert.deepEqual(res.report.rejected,{INVALID_SIGNAL:3,FUTURE_DATE:1,TYPE_NOT_TRACKED:1});
});

test('dedup inside one scan: the same excerpt twice, or the same event from two sources, is sent once',async()=>{
 const {r,saved}=repo();
 await runSignalScan({targets:[T],providers:[provider([raw(),raw(),raw({source_url:'https://acme.example/carrieres/rssi',source_type:'official_website',excerpt:'Nous recrutons notre RSSI.'})])],
  profile:null,budget:{maxRequests:4,deadlineMs:10000},now:NOW,runId:null,repo:r});
 assert.equal(saved[0].list.length,1);
});

test('budget: no provider call once the request budget or the deadline is spent; the report says so',async()=>{
 const {r}=repo();let calls=0;
 const p=provider([raw()],{searchSignals:async()=>{calls++;return [raw()]}});
 const two:SignalTarget[]=[T,{...T,prospect_id:'p2',name:'BETA'}];
 const res=await runSignalScan({targets:two,providers:[p],profile:null,budget:{maxRequests:1,deadlineMs:10000},now:NOW,runId:null,repo:r});
 assert.equal(calls,1);assert.equal(res.report.requests_sent,1);
 let t=0;const clock=()=>t;
 const slow=provider([raw()],{searchSignals:async()=>{t+=6000;return [raw()]}});
 const late=await runSignalScan({targets:two,providers:[slow],profile:null,budget:{maxRequests:10,deadlineMs:5000},now:NOW,runId:null,repo:r,clock});
 assert.equal(late.report.out_of_time,true);assert.equal(late.report.requests_sent,1);
});

test('a failing provider is counted, never fatal; a provider that does not support the target is skipped',async()=>{
 const {r}=repo();
 const res=await runSignalScan({targets:[T],providers:[
  provider([],{searchSignals:async()=>{throw Error('PROVIDER_FAILED')}}),
  provider([raw()],{id:'bodacc',supports:t=>!!t.siren}),
 ],profile:null,budget:{maxRequests:4,deadlineMs:10000},now:NOW,runId:null,repo:r});
 assert.equal(res.report.requests_failed,1);assert.equal(res.report.requests_sent,1);assert.equal(res.report.candidates,0);
});

test('fixture provider: deterministic TEST signals, no network, clearly marked',async()=>{
 const p=new FixtureSignalProvider();
 const a=await p.searchSignals({target:T,types:['hiring_role','funding'],now:NOW});
 const b=await p.searchSignals({target:T,types:['hiring_role','funding'],now:NOW});
 assert.deepEqual(a,b);assert.ok(a.length>0);
 assert.ok(a.every(s=>s.title.startsWith('TEST — ')&&s.source_type==='test_fixture'&&s.source_url.includes('.fixture.example')));
 assert.equal(p.mode,'test');
 const src=await readFile(new URL('../src/signals/providers/fixture.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/fetch\(/);
});

test('no LinkedIn fetching anywhere in the Signal Engine',async()=>{
 for(const f of ['../src/signals/service.ts','../src/signals/provider.ts','../src/signals/providers/fixture.ts']){
  assert.doesNotMatch(await readFile(new URL(f,import.meta.url),'utf8'),/linkedin\.com/i,f);
 }
});
