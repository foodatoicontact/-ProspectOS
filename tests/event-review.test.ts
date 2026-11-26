// Annonces à relire (migration 055, owner decision 25 nov. 2026): the INDETERMINE sale notices are shown to the
// administrator only, read-only, and never become a lead, a delivery or a public figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleLeads} from '../src/leads/api.ts';
import {LEAD_KINDS,KIND_LABEL} from '../src/leads/model.ts';
const read=(p:string)=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const json=(value:unknown,status=200)=>Response.json(value,{status});

test('route: GET leads/review reads admin_events_to_review (the database checks the administrator), nothing else',async()=>{
 const calls:[string,unknown][]=[];
 const db={rpc:async(fn:string,args:unknown)=>{calls.push([fn,args]);return {data:[],error:null}}} as any;
 const r=await handleLeads(new Request('https://x/api/v1/leads/review'),['leads','review'],db,json,{enabled:true});
 assert.equal(r!.status,200);assert.deepEqual(calls,[['admin_events_to_review',{p_limit:200}]]);
 assert.equal((await handleLeads(new Request('https://x/api/v1/leads/review',{method:'POST',body:'{}'}),['leads','review'],db,json,{enabled:true}))!.status,404,'read-only');
 assert.equal((await handleLeads(new Request('https://x/api/v1/leads/review'),['leads','review'],db,json,{enabled:false}))!.status,404,'behind the veille flag');
 const refused={rpc:async()=>({data:null,error:{message:'Admin access required',code:'42501'}})} as any;
 assert.equal((await handleLeads(new Request('https://x/api/v1/leads/review'),['leads','review'],refused,json,{enabled:true}))!.status,403);
});

test('the new kinds are labelled for the company sheet but can never be chosen for a client',()=>{
 assert.deepEqual([...LEAD_KINDS],['VENTE_FONDS','TRANSFERT_SIEGE','ETABLISSEMENT','CREATION']);
 for(const k of ['FUSION','APPORT','VENTE_JUDICIAIRE','INDETERMINE'])assert.ok(KIND_LABEL[k],k);
 const ui=read('src/ui/v2/dedicated/EventReview.tsx');
 assert.match(ui,/api\('leads\/review'\)/);assert.doesNotMatch(ui.replace(/^\s*\/\/.*$/gm,''),/'POST'|reserve|deliver/i,'the review list only reads');
 assert.match(read('src/ui/v2/dedicated/Dedicated.tsx'),/<EventReview api=\{api\}\/>/,'shown in the administrator\'s panel only');
 assert.doesNotMatch(read('src/ui/v2/dedicated/DedicatedViews.tsx'),/EventReview/,'never in the client view');
});
