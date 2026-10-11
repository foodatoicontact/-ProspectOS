// UX A/B instrumentation — server-side only, in the existing append-only public.events table, no migration.
// - organization_id and prospect_id come from a row the server read with the user's OWN (RLS) client; the user id comes
//   from the session. Nothing that authorizes anything is taken from the client: the x-prospectos-ux header is only a
//   label (A|B;hashed|forced), validated, and never read by any check.
// - actor_id is left NULL on purpose and the user id goes in payload.user_id: beta_analytics' last_business_activity_at
//   is max(events.created_at) where actor_id = the user (migrations 013/018), so a ux.* event never counts as activity.
// - Closed payload: no message text, prompt, source, key or credential. Production writes nothing. A failure never breaks
//   the user's request. A view is recorded once per user/prospect/variant per 30 minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordUxEvent,UX_VIEW_DEDUPE_MINUTES} from '../src/server/ux-events.ts';

const ORG='10000000-0000-4000-8000-000000000001',PROSPECT='20000000-0000-4000-8000-000000000002',USER='30000000-0000-4000-8000-000000000003',OUTREACH='40000000-0000-4000-8000-000000000004';
function fakeAdmin(o:{recent?:boolean;insertError?:boolean;throws?:boolean}={}){
 const inserts:any[]=[],filters:any[]=[];
 const query:any={select:()=>query,eq:(k:string,v:unknown)=>{filters.push(['eq',k,v]);return query},is:(k:string,v:unknown)=>{filters.push(['is',k,v]);return query},
  gte:(k:string,v:unknown)=>{filters.push(['gte',k,v]);return query},limit:async()=>({data:o.recent?[{id:'e'}]:[],error:null})};
 const admin:any={from:(t:string)=>{if(o.throws)throw Error('boom');assert.equal(t,'events');return {...query,insert:async(row:unknown)=>{inserts.push(row);return {error:o.insertError?{message:'x'}:null}}}}};
 return {admin,inserts,filters};
}
const PREVIEW={VERCEL_ENV:'preview'};
const base=(admin:any,over:Record<string,unknown>={})=>({admin,env:PREVIEW,now:()=>new Date('2026-10-11T12:00:00Z'),
 kind:'outreach_generated',ux:{variant:'B',assignment:'hashed'},userId:USER,row:{organization_id:ORG,prospect_id:PROSPECT},
 outreach:{id:OUTREACH,angle_type:'evidence',provider:'ai_composer_v1'},...over}) as any;

test('records one ux.* event: server-derived ids, actor_id NULL, closed payload',async()=>{
 const f=fakeAdmin();
 assert.equal(await recordUxEvent(base(f.admin)),'recorded');
 assert.deepEqual(f.inserts,[{organization_id:ORG,prospect_id:PROSPECT,actor_id:null,kind:'ux.outreach_generated',
  payload:{schema:1,experiment:'prospect_detail_v1',variant:'B',assignment:'hashed',user_id:USER,outreach_id:OUTREACH,angle_type:'evidence',provider:'ai_composer_v1'}}]);
});
for(const kind of ['prospect_detail_viewed','outreach_generated','outreach_edited','outreach_approved','outreach_copied'])
 test(`allowed kind ${kind}`,async()=>{const f=fakeAdmin();assert.equal(await recordUxEvent(base(f.admin,{kind,...(kind==='prospect_detail_viewed'?{outreach:undefined}:{})})),'recorded');assert.equal(f.inserts[0].kind,`ux.${kind}`)});
test('any other kind is refused (no generic event writer)',async()=>{
 for(const kind of ['outreach_contacted','prospect.update','ux.prospect_detail_viewed','',undefined]){const f=fakeAdmin();assert.equal(await recordUxEvent(base(f.admin,{kind})),'skipped');assert.equal(f.inserts.length,0)}
});
test('Production, tests, no header or an invalid label → nothing written',async()=>{
 for(const env of [{VERCEL_ENV:'production'},{NODE_ENV:'test'},{}]){const f=fakeAdmin();assert.equal(await recordUxEvent(base(f.admin,{env})),'skipped');assert.equal(f.inserts.length,0)}
 for(const ux of [null,{variant:'C',assignment:'hashed'},{variant:'B',assignment:'default'}]){const f=fakeAdmin();assert.equal(await recordUxEvent(base(f.admin,{ux})),'skipped');assert.equal(f.inserts.length,0)}
});
test('malformed ids → nothing written (ids only ever come from server rows, validated again)',async()=>{
 for(const over of [{userId:'x'},{row:{organization_id:'x',prospect_id:PROSPECT}},{row:{organization_id:ORG,prospect_id:'x'}},{outreach:{id:'x'}}]){const f=fakeAdmin();assert.equal(await recordUxEvent(base(f.admin,over)),'skipped');assert.equal(f.inserts.length,0)}
});
test('payload never carries text: unknown angle type / provider dropped, no content field possible',async()=>{
 const f=fakeAdmin();
 await recordUxEvent(base(f.admin,{outreach:{id:OUTREACH,angle_type:'Bonjour DIMO, voici le message',provider:'sk-ant-FAKE-secret',content:'MESSAGE-TEXT',prompt:'PROMPT'}}));
 const p=f.inserts[0].payload;assert.equal(p.angle_type,undefined);assert.equal(p.provider,undefined);
 assert.deepEqual(Object.keys(p).sort(),['assignment','experiment','outreach_id','schema','user_id','variant']);
 assert.doesNotMatch(JSON.stringify(f.inserts),/MESSAGE-TEXT|PROMPT|sk-ant|Bonjour/);
});
test(`a view is recorded once per user/prospect/variant within ${30} minutes`,async()=>{
 assert.equal(UX_VIEW_DEDUPE_MINUTES,30);
 const fresh=fakeAdmin();assert.equal(await recordUxEvent(base(fresh.admin,{kind:'prospect_detail_viewed',outreach:undefined})),'recorded');
 assert.deepEqual(fresh.filters,[['eq','kind','ux.prospect_detail_viewed'],['eq','prospect_id',PROSPECT],['is','actor_id',null],['eq','payload->>user_id',USER],['eq','payload->>variant','B'],['gte','created_at','2026-10-11T11:30:00.000Z']]);
 const dup=fakeAdmin({recent:true});assert.equal(await recordUxEvent(base(dup.admin,{kind:'prospect_detail_viewed',outreach:undefined})),'deduped');assert.equal(dup.inserts.length,0);
});
test('a failure is swallowed: analytics never breaks the request',async()=>{
 assert.equal(await recordUxEvent(base(fakeAdmin({insertError:true}).admin)),'failed');
 assert.equal(await recordUxEvent(base(fakeAdmin({throws:true}).admin)),'failed');
 assert.equal(await recordUxEvent(base(null as any)),'failed');
});

// ——— route wiring (source) ———
const route=readFileSync(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
test('route — the label comes only from the x-prospectos-ux header, parsed strictly',()=>{
 assert.match(route,/const ux=parseUxHeader\(request\.headers\.get\(UX_HEADER\)\)/);
});
test('route — generated is recorded only after a successful insert, from the server rows',()=>{
 const post=route.slice(route.indexOf("if(resource==='outreach'&&request.method==='POST')"),route.indexOf("if(resource==='outreach'&&request.method==='GET'&&!id)"));
 const at=post.indexOf("kind:'outreach_generated'");assert.ok(at>0);
 assert.ok(at>post.indexOf("if(insertError.code==='23505')"),'after the insert error handling');
 assert.match(post,/row:\{organization_id:p\.organization_id,prospect_id:p\.id\}/);
});
test('route — edited / approved / copied only after a successful PATCH, from the updated row; DISCARDED records nothing',()=>{
 const patch=route.slice(route.indexOf("if(resource==='outreach'&&request.method==='PATCH'&&id)"),route.indexOf("return json(changed);"));
 const at=patch.indexOf('recordUxEvent(');assert.ok(at>0);
 assert.ok(at>patch.indexOf("if(updateError)"),'after the update error handling (400/409 record nothing)');
 assert.match(patch,/UX_KIND_BY_ACTION\[action\]/);
 assert.match(patch,/row:\{organization_id:changed\.organization_id,prospect_id:changed\.prospect_id\}/);
});
test('route — UX_KIND_BY_ACTION maps only SAVE/APPROVED/USED',async()=>{
 const {UX_KIND_BY_ACTION}=await import('../src/server/ux-events.ts');
 assert.deepEqual(UX_KIND_BY_ACTION,{SAVE:'outreach_edited',APPROVED:'outreach_approved',USED:'outreach_copied'});
});
test('route — ux-events accepts only a view, on a prospect the user can read under RLS',()=>{
 const block=route.slice(route.indexOf("if(resource==='ux-events'"),route.indexOf("if(resource==='ux-events'")+900);
 assert.match(block,/kind:z\.literal\('prospect_detail_viewed'\),prospect_id:z\.string\(\)\.uuid\(\)\}\)\.strict\(\)/);
 assert.match(block,/db\.from\('prospects'\)\.select\('id,organization_id'\)\.eq\('id',b\.prospect_id\)\.maybeSingle\(\)/);
 assert.match(block,/userId:user\.id/);
 assert.doesNotMatch(block,/body\.organization_id|body\.user_id|body\.actor_id/);
});
test('route — the prospect history never shows ux.* events',()=>{
 assert.match(route,/if\(resource==='events'&&request\.method==='GET'\)\{[^\n]*\.not\('kind','like','ux\.%'\)/);
});
test('route — the label never reaches an authorization or business decision',()=>{
 const uses=[...route.matchAll(/\bux\b(?![-\w])/g)].length;
 assert.ok(uses>0);
 for(const m of route.matchAll(/requireActiveEntitlement|reserve_ai_outreach|isOutreachAction|allowedFrom/g))assert.doesNotMatch(route.slice(m.index!-80,m.index!+120),/\bux\b/);
});
