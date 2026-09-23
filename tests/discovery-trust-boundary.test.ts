import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {SupabaseDiscoveryRepository} from '../src/discovery/repository.ts';
import {DiscoveryInputSchema} from '../src/discovery/types.ts';

// Server side of the Discovery trust boundary (migration 014). The database half — grants, RLS, the
// accept gate, the ignore RPC — is proven against real Postgres in tests/discovery-trust-boundary-db.mjs.
// Here: the privileged server path can only ever write for the verified user, into a run that user can
// already read, with a classification this server computed.

type Call={table?:string;op:string;args:unknown[]};
// Minimal thenable query builder: records every call, resolves to the configured {data,error}.
function fakeClient(result:(c:Call[])=>{data:unknown;error:unknown}){
 const calls:Call[]=[];
 const builder=(table:string)=>{const own:Call[]=[];const b:any={};for(const op of ['select','eq','single','insert','update','upsert','delete'])b[op]=(...args:unknown[])=>{const c={table,op,args};own.push(c);calls.push(c);return b};b.then=(ok:any,ko:any)=>Promise.resolve(result(own)).then(ok,ko);return b};
 return {calls,client:{from:(t:string)=>builder(t),rpc:(name:string,args:unknown)=>{const c={op:'rpc',args:[name,args]};calls.push(c);return Promise.resolve(result([c]))}} as any};
}
const run={id:'11111111-1111-4111-8111-111111111111',status:'running',provider:'brave',result_count:0,error_message:null};
const candidate=(raw:Record<string,unknown>)=>({candidate:{name:'Grand Frais',canonical_url:null,website:null,city:null,address:null,phone:null,discovered_source:'brave',source_url:'https://www.indeed.fr/emplois?q=grand+frais',source_title:'Grand Frais recrute',discovery_timestamp:'2026-09-23T00:00:00.000Z',confidence:0.5,raw_metadata:raw,deduplication_key:'name:grand frais'},dedupe:{status:'unique' as const,duplicate_of:null,reason:'new'}});

test('server write path: the run is read with the USER client before any privileged write', async () => {
 const user=fakeClient(()=>({data:{id:run.id},error:null}));
 const admin=fakeClient(()=>({data:[],error:null}));
 await new SupabaseDiscoveryRepository(user.client,{db:admin.client,userId:'user-A'}).saveResults(run,[candidate({source_class:'COMPANY_CANDIDATE'})]);
 assert.deepEqual(user.calls.map(c=>c.op),['select','eq','single']);
 assert.equal(user.calls[0].table,'discovery_runs');
 assert.equal(admin.calls.length,1);
 assert.equal(admin.calls[0].args[0],'save_discovery_results');
 assert.ok(!user.calls.some(c=>c.op==='rpc'||c.op==='insert'),'the user client never writes discovery results');
});

test('confused deputy: a run the user cannot read (RLS) never reaches the privileged client', async () => {
 const user=fakeClient(()=>({data:null,error:{message:'JSON object requested, multiple (or no) rows returned'}}));
 const admin=fakeClient(()=>({data:[],error:null}));
 await assert.rejects(new SupabaseDiscoveryRepository(user.client,{db:admin.client,userId:'user-A'}).saveResults(run,[candidate({source_class:'COMPANY_CANDIDATE'})]),/DATABASE_REQUEST_FAILED/);
 assert.equal(admin.calls.length,0,'no privileged call is made for a run outside the user’s tenant');
});

test('confused deputy: the privileged RPC carries the verified user id and never a tenant/project/run column per row', async () => {
 const user=fakeClient(()=>({data:{id:run.id},error:null}));
 const admin=fakeClient(()=>({data:[],error:null}));
 await new SupabaseDiscoveryRepository(user.client,{db:admin.client,userId:'user-A'}).saveResults(run,[candidate({source_class:'COMPANY_CANDIDATE',organization_id:'org-B',project_id:'p-B'})]);
 const args=admin.calls[0].args[1] as {p_user_id:string;p_run_id:string;p_rows:Record<string,unknown>[]};
 assert.equal(args.p_user_id,'user-A');
 assert.equal(args.p_run_id,run.id);
 for(const k of ['organization_id','project_id','discovery_run_id','provider','status','prospect_id'])assert.ok(!(k in args.p_rows[0]),`${k} is never supplied per row — the database takes it from the run`);
});

test('source_class sent to the database is validated server-side: unknown values become NULL (fail closed)', async () => {
 const user=fakeClient(()=>({data:{id:run.id},error:null}));
 const admin=fakeClient(()=>({data:[],error:null}));
 await new SupabaseDiscoveryRepository(user.client,{db:admin.client,userId:'user-A'}).saveResults(run,[candidate({source_class:'COMPANY_CANDIDATE'}),candidate({source_class:'ADMIN'}),candidate({}),candidate({source_class:'IRRELEVANT'})]);
 const rows=(admin.calls[0].args[1] as {p_rows:{source_class:unknown}[]}).p_rows;
 assert.deepEqual(rows.map(r=>r.source_class),['COMPANY_CANDIDATE',null,null,'IRRELEVANT']);
});

test('no privileged writer configured: fails closed, nothing is written', async () => {
 const user=fakeClient(()=>({data:{id:run.id},error:null}));
 await assert.rejects(new SupabaseDiscoveryRepository(user.client).saveResults(run,[candidate({source_class:'COMPANY_CANDIDATE'})]),/CONFIGURATION_REQUIRED/);
 assert.ok(!user.calls.some(c=>c.op==='rpc'||c.op==='insert'));
});

test('the browser cannot inject a classification or results through the Discovery request body', () => {
 const base={project_id:'p1',query:'restaurants',location:'Lyon',categories:[],max_results:5};
 assert.equal(DiscoveryInputSchema.safeParse(base).success,true);
 assert.equal(DiscoveryInputSchema.safeParse({...base,source_class:'COMPANY_CANDIDATE'}).success,false);
 assert.equal(DiscoveryInputSchema.safeParse({...base,results:[{source_class:'COMPANY_CANDIDATE'}]}).success,false);
 assert.equal(DiscoveryInputSchema.safeParse({...base,optional_filters:{source_class:'COMPANY_CANDIDATE'}}).success,false);
});

test('api.ts: the privileged writer is bound to the JWT-verified user and created before any quota is consumed', async () => {
 const api=await readFile(new URL('../src/discovery/api.ts',import.meta.url),'utf8');
 assert.match(api,/new SupabaseDiscoveryRepository\(db,\{db:writer,userId:user\.id\}\)/);
 assert.ok(api.indexOf('createAdminClient()')<api.indexOf('find_prospects(input)'),'fail fast before the run starts');
 assert.doesNotMatch(api,/userId:\s*b\.|userId:\s*body|p_user_id/,'the user id never comes from the request body');
 assert.match(api,/db\.rpc\('ignore_discovery_result',\{p_result_id:id\}\)/);
 assert.doesNotMatch(api,/from\('discovery_results'\)\.update/,'no direct update of discovery results remains');
});

test('migration 014: authenticated loses INSERT/UPDATE, the privileged write RPC is service_role only', async () => {
 const sql=await readFile(new URL('../db/migrations/014_discovery_trust_boundary.sql',import.meta.url),'utf8');
 assert.match(sql,/revoke insert, update on public\.discovery_results from authenticated;/);
 assert.match(sql,/revoke all on function public\.save_discovery_results\(uuid,uuid,jsonb\) from public,anon,authenticated;/);
 assert.match(sql,/grant execute on function public\.save_discovery_results\(uuid,uuid,jsonb\) to service_role;/);
 assert.doesNotMatch(sql,/grant execute on function public\.save_discovery_results[^;]*authenticated/);
 assert.match(sql,/if r\.source_class is distinct from 'COMPANY_CANDIDATE' then raise exception 'CANDIDATE_NOT_ACCEPTABLE'/);
 assert.doesNotMatch(sql,/disable row level security/i);
});

// Walks every relative import reachable from a 'use client' module: none may reach the service-role
// client or name the service-role key.
test('no client-reachable module imports admin-client or reads the service-role key', async () => {
 const root=new URL('..',import.meta.url);
 const files=async(dir:string):Promise<string[]>=>(await readdir(new URL(dir,root),{withFileTypes:true,recursive:true})).filter(e=>e.isFile()&&/\.(ts|tsx)$/.test(e.name)).map(e=>join(e.parentPath,e.name));
 const all=[...await files('app/'),...await files('src/')];
 const entries=[];for(const f of all)if(/^['"]use client['"]/m.test(await readFile(f,'utf8')))entries.push(f);
 assert.ok(entries.some(f=>f.endsWith('app/page.tsx')));
 const seen=new Set<string>();const queue=[...entries];
 const resolve=async(from:string,spec:string)=>{const base=new URL(spec,`file://${from}`).pathname;for(const c of [base,`${base}.ts`,`${base}.tsx`,`${base}/index.ts`])if(all.includes(c))return c;return null};
 while(queue.length){const f=queue.pop()!;if(seen.has(f))continue;seen.add(f);const src=await readFile(f,'utf8');for(const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)){const r=await resolve(f,m[1]);if(r)queue.push(r)}}
 const reached=[...seen];
 assert.ok(reached.some(f=>f.endsWith('src/components/DiscoveryPanel.tsx')));
 assert.ok(!reached.some(f=>f.endsWith('src/server/admin-client.ts')||f.endsWith('src/discovery/api.ts')||f.endsWith('src/discovery/repository.ts')),'no server-only module is client-reachable');
 for(const f of reached)assert.doesNotMatch(await readFile(f,'utf8'),/SUPABASE_SERVICE_ROLE_KEY/,`${f} must never name the service-role key`);
});
