// Signal Engine S1: the TypeScript contract (src/signals/types.ts) stays the database's own (migration 024).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SIGNAL_TYPES,SIGNAL_PROVIDERS,SIGNAL_SOURCE_TYPES,signalConfidence,SignalCandidateSchema,IntentProfileSchema} from '../src/signals/types.ts';

const migration=await readFile(new URL('../db/migrations/024_signals.sql',import.meta.url),'utf8');
const list=(re:RegExp)=>[...migration.match(re)![1].matchAll(/'([a-z_]+)'/g)].map(m=>m[1]);

test('closed lists: signal types, providers and source types are exactly the database checks',()=>{
 assert.deepEqual(list(/signal_type text not null check\(signal_type in \(([^)]*)\)\)/s),[...SIGNAL_TYPES]);
 assert.deepEqual(list(/provider text not null check\(provider in \(([^)]*)\)\)/),[...SIGNAL_PROVIDERS]);
 assert.deepEqual(list(/source_type text not null check\(source_type in \(([^)]*)\)\)/),[...SIGNAL_SOURCE_TYPES]);
});

test('confidence: the same rule as prospectos_private.signal_confidence',()=>{
 assert.equal(signalConfidence('official_website','2026-09-20',null),1);
 assert.equal(signalConfidence('job_board',null,'2026-10-02T09:00:00Z'),0.8);
 assert.equal(signalConfidence('search_snippet',null,null),0.42);
 assert.equal(signalConfidence('user_provided',null,'2026-10-02T09:00:00Z'),0.7);
 assert.match(migration,/when 'official_website' then 1\.0 when 'legal_announcement' then 1\.0 when 'public_procurement' then 1\.0\s+when 'news' then 0\.8 when 'job_board' then 0\.8 when 'user_provided' then 0\.7 when 'search_snippet' then 0\.6 else 0\.5 end\)\s+\*\(case when p_event_date is null and p_published_at is null then 0\.7 else 1\.0 end\)/);
});

test('candidate: strict, sourced, no status nor confidence from a client',()=>{
 const ok={provider:'web_search',signal_type:'hiring_role',title:'ACME recrute un RSSI',excerpt:'ACME recrute un RSSI à Lyon.',source_url:'https://jobs.example/rssi',
  source_type:'job_board',published_at:'2026-10-02T09:00:00Z',observed_at:'2026-10-05T09:00:00Z',content_hash:'a'.repeat(64),event_key:'hiring_role:rssi'};
 assert.equal(SignalCandidateSchema.safeParse(ok).success,true);
 for(const bad of [{...ok,status:'VERIFIED'},{...ok,confidence:1},{...ok,signal_type:'mood'},{...ok,source_url:'javascript:alert(1)'},{...ok,excerpt:'  '},{...ok,content_hash:'x'}])
  assert.equal(SignalCandidateSchema.safeParse(bad).success,false,JSON.stringify(bad).slice(0,60));
});

test('intent profile: closed types, integer weights 0–50, at most 30 terms',()=>{
 assert.equal(IntentProfileSchema.safeParse({types:{hiring_role:25,funding:30},terms:['RSSI']}).success,true);
 for(const bad of [{types:{mood:10}},{types:{funding:60}},{types:{funding:2.5}},{types:{},terms:['x']},{types:{},extra:1}])
  assert.equal(IntentProfileSchema.safeParse(bad).success,false,JSON.stringify(bad));
});

test('signals are never evidence: the Signal Engine never writes evidence, and the FIT score never reads signals',async()=>{
 const core=await readFile(new URL('../src/domain/core.ts',import.meta.url),'utf8');
 assert.doesNotMatch(core,/signal_type|SIGNAL_TYPES|from '\.\.\/signals/);
 const body=migration.split('\n').filter(l=>!l.startsWith('--')).join('\n');
 assert.doesNotMatch(body,/(insert into|update|delete from) public\.evidence/i);
});

test('account export includes signals and intent profiles, best-effort until migration 024 exists',async()=>{
 const account=await readFile(new URL('../src/server/account.ts',import.meta.url),'utf8');
 assert.match(account,/const signals=await selectOptional\(db,'signals','\*'\);/);
 assert.match(account,/zip\.file\('signals\.json'/);assert.match(account,/zip\.file\('intent_profiles\.json'/);
});
