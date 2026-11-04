// ICP import, step 2B (docs/ICP_IMPORT.md) — the review screen: its API routes (validate, discard, retry), its pure logic
// (state read from the database, edits, questions, projection) and its browser client (resume after a reload, lost
// network). The database is a recording fake here; tests/icp-import-db.mjs runs the same flow on PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleIcpImport,type IcpImportDeps} from '../src/icp-import/api.ts';
import {viewOf,readStatus,setValue,removeAt,addValue,addZones,answerQuestion,parseDepartments,confidenceOf,nextPollDelay,isUnmonitored,MANUAL_SOURCE,IMPORT_LOCK_MS,POLL_MAX_MS,type ImportRow} from '../src/icp-import/review.ts';
import {icpClient,loadLatest,saveDraft,loadDraft,clearDraft,clearAllDrafts} from '../src/icp-import/client.ts';
import {StructureIcpError} from '../src/server/ai.ts';
import {ICP_MESSAGES,errorText,SIGNAL_LABELS} from '../src/icp-import/messages.ts';
import {projectCriteria,projectOffer} from '../src/domain/icp/projection.ts';
import {parseIcpProfile,type IcpProfile} from '../src/domain/icp/schema.ts';
import {DEFAULT_CRITERIA} from '../src/domain/core.ts';

const fixture=()=>(parseIcpProfile(JSON.parse(readFileSync(new URL('./fixtures/icp/protection-incendie.expected.json',import.meta.url),'utf8'))) as {profile:IcpProfile}).profile;
const P='11111111-1111-4111-8111-111111111111',IMP='33333333-3333-4333-8333-333333333333',NEW='44444444-4444-4444-8444-444444444444';
const NOW=Date.parse('2026-11-04T10:00:00Z');const ago=(s:number)=>new Date(NOW-s*1000).toISOString();
const json=(value:unknown,status=200)=>Response.json(value,{status});
const src=(f:string)=>readFileSync(new URL(f,import.meta.url),'utf8');

// A recording fake of the user's database client: icp_imports rows, the project's ICP, and the RPCs.
function fakeDb(rows:Record<string,any>,icp:any=null,rpcError?:Record<string,string>){
 const rpc:{fn:string;args:any}[]=[];
 const chain=(table:string)=>{const f:Record<string,unknown>={};const b:any={};
  b.select=()=>b;b.eq=(k:string,v:unknown)=>{f[k]=v;return b};b.order=()=>b;b.limit=()=>b;
  b.maybeSingle=async()=>({data:table==='icps'?icp:table==='icp_imports'?rows[f.id as string]??null:null,error:null});
  b.single=async()=>({data:{organization_id:'org'},error:null});
  b.then=(r:any)=>Promise.resolve({data:Object.values(rows),error:null}).then(r);return b};
 const db:any={from:chain,rpc:async(fn:string,args:any)=>{rpc.push({fn,args});if(rpcError?.[fn])return {data:null,error:{message:rpcError[fn]}};
  if(fn==='validate_icp_import')return {data:{import_id:args.p_import_id,status:'VALIDATED',offer_written:args.p_offer!==null,criteria_written:args.p_criteria!==null},error:null};
  if(fn==='start_icp_import')return {data:NEW,error:null};return {data:true,error:null}}};
 return {db,rpc};
}
const deps=(over?:Partial<IcpImportDeps>):IcpImportDeps=>({userId:'u',now:()=>NOW,requireEntitlement:async()=>{},admin:()=>({rpc:async()=>({data:true,error:null})}) as any,aiProvider:'anthropic',
 resolveCredential:async()=>({status:'NONE'}),structure:async()=>({profile:fixture(),dropped:[],usage:{provider:'anthropic',model:'m',credential_source:'PLATFORM',attempts:[{input_tokens:1,output_tokens:1}],input_tokens:1,output_tokens:1,total_tokens:2}}),
 meter:async()=>{},release:async()=>{},log:()=>{},...over});
const post=(path:string,body:unknown,headers:Record<string,string>={'content-type':'application/json'})=>new Request(`https://x.test/api/v1/icp-imports/${path}`,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
const extracted=(over:Record<string,unknown>={})=>({id:IMP,project_id:P,status:'EXTRACTED',created_at:ago(300),extracted:fixture(),missing_questions:[{key:'segments',question:'Quels types de clients ciblez-vous ?'},{key:'personas',question:'Qui décide ?'}],...over});

// =============================================================== full flow
test('full flow — fire-protection draft: EXTRACTED, reviewed, one field corrected, validated by a click; criteria projected, weights still 100',async()=>{
 const {db,rpc}=fakeDb({[IMP]:extracted()},{criteria:DEFAULT_CRITERIA,projected_criteria:null});
 const detail=await (await handleIcpImport(new Request(`https://x.test/api/v1/icp-imports/${IMP}`),['icp-imports',IMP],db,json,deps()))!.json();
 const view=viewOf(detail.import,detail.profile,NOW);
 assert.equal(view.kind,'review');
 // The person answers the first missing question and corrects the activity.
 let p=(view as {profile:IcpProfile}).profile;
 const a=answerQuestion(p,'segments','Établissements recevant du public');assert.ok(a.ok);p=a.profile;
 const e=setValue(p,['company','activity'],'Installation et maintenance de matériel incendie');assert.ok(e.ok);p=e.profile;
 assert.equal(p.company.activity.source,MANUAL_SOURCE);assert.equal(p.company.activity.confidence,1);
 const res=(await handleIcpImport(post(`${IMP}/validate`,{profile:p,keep_offer:false,keep_criteria:false}),['icp-imports',IMP,'validate'],db,json,deps()))!;
 assert.equal(res.status,200);const out=await res.json();
 const call=rpc.find(c=>c.fn==='validate_icp_import')!.args;
 assert.equal(call.p_import_id,IMP);assert.deepEqual(call.p_profile,p);
 assert.equal(call.p_criteria.reduce((s:number,c:{weight:number})=>s+c.weight,0),100);
 assert.deepEqual(call.p_criteria.map((c:any)=>[c.key,c.weight]),DEFAULT_CRITERIA.map(c=>[c.key,c.weight]),'keys and weights untouched');
 const target=call.p_criteria.find((c:any)=>c.key==='target_fit');
 assert.deepEqual(target.rules.config.categories,['Établissements recevant du public']);assert.ok(target.rules.config.locations.includes('Nantes'));
 assert.match(call.p_offer,/^Atlantique Sécurité Incendie : Installation et maintenance de matériel incendie\.\nServices : Extincteurs/);
 assert.deepEqual(out.criteria_changed,['target_fit']);
});

test('validate — keeping the current offer or criteria sends null (nothing overwritten); a hand-edited rule is kept; an invalid profile is refused before the database',async()=>{
 const hand=DEFAULT_CRITERIA.map(c=>c.key==='target_fit'?{...c,rules:{type:'target_fit' as const,config:{locations:['Vendée'],match:'any_defined' as const}}}:c);
 const {db,rpc}=fakeDb({[IMP]:extracted()},{criteria:hand,projected_criteria:null});
 await handleIcpImport(post(`${IMP}/validate`,{profile:fixture(),keep_offer:true,keep_criteria:true}),['icp-imports',IMP,'validate'],db,json,deps());
 const kept=rpc.at(-1)!.args;assert.equal(kept.p_offer,null);assert.equal(kept.p_criteria,null);
 const out=await (await handleIcpImport(post(`${IMP}/validate`,{profile:fixture(),keep_offer:false,keep_criteria:false}),['icp-imports',IMP,'validate'],db,json,deps()))!.json();
 assert.deepEqual(out.criteria_kept,['target_fit']);assert.deepEqual(rpc.at(-1)!.args.p_criteria,hand,'a rule written by hand is never overwritten');
 const n=rpc.length;
 const bad={...fixture(),company:{...fixture().company,ceo:{value:'X',source:'x',confidence:1}}};
 const r=(await handleIcpImport(post(`${IMP}/validate`,{profile:bad,keep_offer:false,keep_criteria:false}),['icp-imports',IMP,'validate'],db,json,deps()))!;
 assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_PROFILE');
 assert.equal((await handleIcpImport(post(`${IMP}/validate`,{profile:fixture()}),['icp-imports',IMP,'validate'],db,json,deps()))!.status,400,'the two choices are explicit');
 assert.equal(rpc.length,n,'nothing reaches the database');
 const {db:pendingDb}=fakeDb({[IMP]:extracted({status:'PENDING',created_at:ago(10),extracted:null})});
 assert.equal((await (await handleIcpImport(post(`${IMP}/validate`,{profile:fixture(),keep_offer:false,keep_criteria:false}),['icp-imports',IMP,'validate'],pendingDb,json,deps()))!.json()).code,'IMPORT_NOT_REVIEWABLE');
 const {db:other}=fakeDb({},null,{validate_icp_import:'Authenticated tenant member required'});
 assert.equal((await handleIcpImport(post(`${IMP}/validate`,{profile:fixture(),keep_offer:true,keep_criteria:true}),['icp-imports',IMP,'validate'],other,json,deps()))!.status,404,'another tenant’s import does not exist for you');
});

test('discard and retry — rejecting calls discard_icp_import; a retry needs the source again, starts a new import of the same project, then rejects the old draft',async()=>{
 const {db,rpc}=fakeDb({[IMP]:extracted()});
 assert.deepEqual(await (await handleIcpImport(post(`${IMP}/discard`,''),['icp-imports',IMP,'discard'],db,json,deps()))!.json(),{discarded:true});
 assert.equal(rpc.at(-1)!.fn,'discard_icp_import');
 rpc.length=0;
 const text='Atlantique Sécurité Incendie installe et entretient des extincteurs en Loire-Atlantique depuis 1998.';
 const r=(await handleIcpImport(post(`${IMP}/retry`,{text}),['icp-imports',IMP,'retry'],db,json,deps()))!;
 assert.equal(r.status,201);
 assert.deepEqual(rpc.map(c=>c.fn),['start_icp_import','discard_icp_import'],'the old draft is rejected only once the new import has started');
 assert.equal(rpc[0]!.args.p_project_id,P,'the project comes from the import itself, not from the request');
 rpc.length=0;
 const {db:busyDb,rpc:busyRpc}=fakeDb({[IMP]:extracted()},null,{start_icp_import:'icp_import_in_progress'});
 assert.equal((await (await handleIcpImport(post(`${IMP}/retry`,{text}),['icp-imports',IMP,'retry'],busyDb,json,deps()))!.json()).code,'ICP_IMPORT_IN_PROGRESS');
 assert.deepEqual(busyRpc.map(c=>c.fn),['start_icp_import'],'a retry that could not start never loses the draft');
 // A retry whose extraction fails (FAILED) leaves the previous draft untouched: still EXTRACTED, still readable.
 const {db:failDb,rpc:failRpc}=fakeDb({[IMP]:extracted()});
 const failing=deps({structure:async()=>{throw new StructureIcpError('AI_INVALID_RESULT',null,true)}});
 assert.equal((await handleIcpImport(post(`${IMP}/retry`,{text}),['icp-imports',IMP,'retry'],failDb,json,failing))!.status,502);
 assert.deepEqual(failRpc.map(c=>c.fn),['start_icp_import'],'no discard_icp_import when the new import is not EXTRACTED');
 const still=await (await handleIcpImport(new Request(`https://x.test/api/v1/icp-imports/${IMP}`),['icp-imports',IMP],failDb,json,deps()))!.json();
 assert.equal(still.import.status,'EXTRACTED');assert.equal(still.profile_state,'valid');
 const {db:runningDb}=fakeDb({[IMP]:extracted({status:'PENDING',created_at:ago(20),extracted:null})});
 assert.equal((await (await handleIcpImport(post(`${IMP}/retry`,{text}),['icp-imports',IMP,'retry'],runningDb,json,deps()))!.json()).code,'ICP_IMPORT_IN_PROGRESS');
 let entitled=false;
 await handleIcpImport(post(`${IMP}/retry`,{text}),['icp-imports',IMP,'retry'],db,json,deps({requireEntitlement:async()=>{entitled=true}}));
 assert.ok(entitled,'a retry is an AI call: the access check runs');
 assert.equal((await handleIcpImport(post(`${IMP}/publish`,''),['icp-imports',IMP,'publish'],db,json,deps()))!.status,404,'no other action exists');
});

// =============================================================== state from the database
test('state — read from the database: a running import stays "pending", a PENDING past 2 minutes is FAILED (IMPORT_STALE), a corrupted draft is "to re-import"',()=>{
 const row=(o:Partial<ImportRow>):ImportRow=>({id:IMP,status:'PENDING',created_at:ago(30),...o});
 assert.equal(viewOf(null,null,NOW).kind,'empty');
 const pending=viewOf(row({}),null,NOW);assert.equal(pending.kind,'pending');assert.equal((pending as {elapsedS:number}).elapsedS,30);
 const stale=viewOf(row({created_at:new Date(NOW-IMPORT_LOCK_MS).toISOString()}),null,NOW);
 assert.equal(stale.kind,'failed');assert.equal((stale as {error:string}).error,'IMPORT_STALE');
 assert.equal(readStatus(row({created_at:new Date(NOW-IMPORT_LOCK_MS+1000).toISOString()}),NOW).status,'PENDING');
 assert.equal(viewOf(row({status:'EXTRACTED'}),fixture(),NOW).kind,'review');
 for(const broken of [null,{version:1},{...fixture(),version:2},{...fixture(),company:'x'}])assert.equal(viewOf(row({status:'EXTRACTED'}),broken,NOW).kind,'unreadable');
 assert.equal(viewOf(row({status:'FAILED',error:'PDF_SCANNED'}),null,NOW).kind,'failed');
 assert.equal(viewOf(row({status:'VALIDATED'}),null,NOW).kind,'validated');assert.equal(viewOf(row({status:'DISCARDED'}),null,NOW).kind,'discarded');
 assert.match(errorText('fr','IMPORT_STALE',undefined),/Relancez-le/);assert.match(errorText('en','IMPORT_STALE',undefined),/Run it again/);
});

test('resume after a reload — the client finds the running import in the database, polls it, then shows its draft; a lost network is a result, never a crash',async()=>{
 const state={status:'PENDING',fail:false};const seen:string[]=[];
 const fetcher=async(url:string,init?:RequestInit)=>{
  seen.push(`${init?.method??'GET'} ${url}`);
  assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer tok');
  if(state.fail)throw new TypeError('fetch failed');
  if(url.includes('?project_id='))return Response.json([{id:IMP,status:state.status,created_at:ago(20)}]);
  return Response.json({import:{id:IMP,status:state.status,created_at:ago(20),missing_questions:[]},profile:fixture(),profile_state:'valid'});
 };
 const client=icpClient('tok',fetcher);
 const first=await loadLatest(client,P);
 assert.ok(first.ok);assert.equal(first.data.row!.status,'PENDING');assert.equal(first.data.detail,null);
 assert.equal(viewOf(first.data.row,null,NOW).kind,'pending','after a reload, the running import is shown as running');
 state.fail=true;
 const lost=await loadLatest(client,P);
 assert.equal(lost.ok,false);assert.equal((lost as {network?:boolean}).network,true);
 assert.deepEqual([0,1,2,3,10].map(nextPollDelay),[3000,6000,12000,POLL_MAX_MS,POLL_MAX_MS],'backs off, never past 15 s');
 state.fail=false;state.status='EXTRACTED';
 const done=await loadLatest(client,P);
 assert.ok(done.ok);assert.equal(viewOf(done.data.row,done.data.detail!.profile,NOW).kind,'review');
 assert.deepEqual(seen.filter(s=>s.startsWith('GET')).length,4);
 const up=await client.create(P,{kind:'file',file:new Blob([new Uint8Array([0x25,0x50,0x44,0x46,0x2d])]),name:'plaquette.pdf'});
 assert.ok(up.ok);assert.match(seen.at(-1)!,/^POST \/api\/v1\/icp-imports\/file\?project_id=/,'a file is sent as the raw body');
});

// =============================================================== edits
test('edits — every value editable and sourced as typed; lists editable; questions answered one at a time; nothing invalid gets through',()=>{
 let p=fixture();
 const r=removeAt(p,['company','sites',5]);assert.ok(r.ok);assert.equal(r.profile.company.sites.length,5);
 const s=addValue(p,['offer','services'],'Formation incendie');assert.ok(s.ok);assert.equal(s.profile.offer.services.at(-1)!.source,MANUAL_SOURCE);
 const emptied=setValue(p,['company','name'],'  ');assert.ok(emptied.ok);assert.deepEqual(emptied.profile.company.name,{value:null,source:null,confidence:0});
 assert.equal(setValue(p,['company','ceo'],'X').ok,false,'no field outside the schema');
 assert.equal(setValue(p,['company','name'],'x'.repeat(201)).ok,false,'bounds of the schema');
 assert.deepEqual(parseDepartments('44, Maine-et-Loire et 35 ; vendee / 99'),['44','49','35','85']);
 const z=addZones(p,'85, 44');assert.ok(z.ok);assert.deepEqual(z.profile.company.interventionZones.map(x=>x.value),['44','49','85'],'no duplicate');
 const q=answerQuestion(p,'personas','Responsable sécurité');assert.ok(q.ok);assert.equal(q.profile.personas[0]!.role.value,'Responsable sécurité');
 const seg=answerQuestion(answerQuestion(p,'segments','ERP').ok?answerQuestion(p,'segments','ERP').profile as IcpProfile:p,'segments','ERP');
 assert.ok(seg.ok);assert.deepEqual(seg.profile.segments.map(x=>x.key),['erp','erp-2'],'unique keys');
 p={...seg.profile,signals:[{type:{value:'HIRING',source:'nous recrutons',confidence:0.7},segmentRefs:['erp']}]};
 const noSeg=removeAt(p,['segments',0]);assert.ok(noSeg.ok);assert.deepEqual(noSeg.profile.signals[0]!.segmentRefs,[],'removing a segment removes its references');
 assert.deepEqual([{value:null,confidence:0},{value:'x',confidence:0.3},{value:'x',confidence:0.7},{value:'x',confidence:0.9}].map(confidenceOf),['empty','low','medium','high']);
});

test('projection — deterministic and idempotent; weights never change; nothing projected when the profile says nothing',()=>{
 const p=fixture();
 const a=projectCriteria(p,null,null),b=projectCriteria(p,a.criteria,a.criteria);
 assert.deepEqual(b.changed,[]);assert.deepEqual(b.criteria,a.criteria);
 assert.equal(a.criteria.reduce((s,c)=>s+c.weight,0),100);
 const custom=[{key:'target_fit',label:'Cible',weight:60},{key:'x',label:'Autre',weight:40}];
 assert.deepEqual(projectCriteria(p,custom,null).criteria.map(c=>c.weight),[60,40]);
 const none=projectCriteria({...p,segments:[],company:{...p.company,sites:[],interventionZones:[]}},custom,null);
 assert.deepEqual(none.changed,[]);assert.deepEqual(none.criteria,custom);
 assert.ok(projectOffer(p).length<=4000);assert.match(projectOffer(p),/Engagements : Devis sous 24 h, Intervention sous 48 h/);
});

// =============================================================== the screen
test('screen — WORKS and CONTRACT_RENEWAL shown "not monitored yet", never as active; VALIDATED only from a click; texts in the local dictionary',()=>{
 assert.ok(isUnmonitored('WORKS')&&isUnmonitored('CONTRACT_RENEWAL')&&!isUnmonitored('HIRING'));
 assert.equal(ICP_MESSAGES.fr.unmonitored,'Non surveillé pour l’instant');
 const ui=src('../src/components/IcpImport.tsx');
 assert.match(ui,/isUnmonitored\(s\.type\.value\)&&<span className="icp-badge unmonitored"/);
 assert.doesNotMatch(ui+JSON.stringify(ICP_MESSAGES),/surveillé activement|actively monitored|"actif"/i);
 // One call to validate, inside the handler of the « Valider » button; no effect, timer or poll can reach it.
 assert.equal(ui.match(/client\.validate\(/g)?.length,1);
 assert.match(ui,/onClick=\{validate\}/);
 const effects=[...ui.matchAll(/useEffect\(\(\)=>\{([\s\S]*?)\},\[/g)].map(m=>m[1]).join('\n');
 assert.doesNotMatch(effects,/validate|discard|erase/);
 // Local dictionary: same keys in both languages; nothing added to the app-wide fr.ts / en.ts.
 assert.deepEqual(Object.keys(ICP_MESSAGES.en).sort(),Object.keys(ICP_MESSAGES.fr).sort());
 assert.deepEqual(Object.keys(SIGNAL_LABELS.en).sort(),Object.keys(SIGNAL_LABELS.fr).sort());
 for(const f of ['../src/i18n/fr.ts','../src/i18n/en.ts'])assert.doesNotMatch(src(f),/icpImport|icp-import|Importer mon entreprise/);
 assert.doesNotMatch(ui,/from '\.\.\/i18n\/(fr|en)'/);
});

test('screen — mobile first and one-handed: decisive buttons in a bottom bar, 44 px targets, 16 px inputs; errors and slow loads stay readable',()=>{
 const ui=src('../src/components/IcpImport.tsx');
 assert.match(ui,/\.icp-bar\{position:sticky;bottom:0/);
 assert.match(ui,/\.icp-bar button\{min-height:48px/);
 for(const rule of [/\.icp-tabs button\{flex:1;min-height:44px/,/\.icp-import \.text-button\{font-size:13px;min-height:44px/,/\.icp-actions button\{min-height:44px/,/\.icp-add button\{min-height:44px/])assert.match(ui,rule);
 assert.match(ui,/\.icp-import input,\.icp-import textarea\{font-size:16px\}/,'no zoom on focus on a phone');
 assert.match(ui,/env\(safe-area-inset-bottom\)/);
 assert.match(ui,/role="status" aria-live="polite"/,'a long load is announced and explained, never a blank screen');
 assert.match(ui,/pendingElapsed/);assert.match(ui,/class Guard extends Component/,'a render error falls back to "to re-import"');
 assert.match(ui,/\.icp-field\.is-empty input/,'empty fields stand out');
 assert.match(ui,/aria-expanded=\{open\}.*\{t\('source'\)\}/,'the source shows on tap');
 const page=src('../app/page.tsx');
 // In the v2 shell (the production UI), at the top of « Offre et cible »; the legacy screens stay byte-identical.
 assert.match(page.slice(page.indexOf(' if(v2){')),/view==='icp'&&mode==='live'&&project&&<v2\.IcpImport key=\{project\.id\}/,'only for a signed-in user on a real project');
 assert.doesNotMatch(page.slice(0,page.indexOf(' if(v2){')),/IcpImport/);
 assert.match(src('../src/ui/v2/shell/AppShell.tsx'),/export \{IcpImport\} from '\.\.\/\.\.\/\.\.\/components\/IcpImport\.tsx';/);
 assert.match(ui,/\.pos-ui \.icp-bar\{bottom:calc\(var\(--pos-bottomnav-h/,'above the bottom navigation on a phone');
});

test('retry that failed — the screen offers the previous draft again; it stays pinned while it is a draft',async()=>{
 const rows=[{id:NEW,status:'FAILED',error:'AI_INVALID_RESULT',created_at:ago(10)},{id:IMP,status:'EXTRACTED',created_at:ago(600)}];
 const fetcher=async(url:string)=>url.includes('?project_id=')?Response.json(rows)
  :Response.json({import:rows.find(r=>url.endsWith(r.id)),profile:url.endsWith(IMP)?fixture():null,profile_state:url.endsWith(IMP)?'valid':'none'});
 const client=icpClient('tok',fetcher);
 const latest=await loadLatest(client,P);
 assert.ok(latest.ok);assert.equal(latest.data.row!.status,'FAILED');assert.equal(latest.data.previousDraft,IMP);
 const back=await loadLatest(client,P,IMP);
 assert.ok(back.ok);assert.equal(back.data.row!.id,IMP);assert.equal(viewOf(back.data.row,back.data.detail!.profile,NOW).kind,'review');
 rows[1]!.status='DISCARDED';
 const gone=await loadLatest(client,P,IMP);assert.ok(gone.ok);assert.equal(gone.data.row!.id,NEW,'a pin no longer a draft falls back to the latest import');
 const ui=src('../src/components/IcpImport.tsx');
 assert.match(ui,/\{previousDraft&&<button type="button" onClick=\{\(\)=>\{pinned\.current=previousDraft;/);
});

test('browser draft — kept in sessionStorage only, cleared on validation, rejection, deletion, sign-out and an expired session',()=>{
 const mem=()=>{const m=new Map<string,string>();return {get length(){return m.size},key:(i:number)=>[...m.keys()][i]??null,getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)},clear:()=>m.clear(),m}};
 const session=mem(),local=mem();
 Object.assign(globalThis,{sessionStorage:session,localStorage:local});
 try{
  saveDraft(IMP,fixture());
  assert.equal(session.m.size,1);assert.equal(local.m.size,0,'never in localStorage');
  assert.deepEqual(loadDraft(IMP),fixture());
  clearDraft(IMP);assert.equal(session.m.size,0);
  saveDraft(IMP,fixture());saveDraft(NEW,fixture());session.setItem('other','x');local.setItem(`prospectos.icp-review.${P}`,'{}');
  clearAllDrafts();
  assert.deepEqual([...session.m.keys()],['other'],'only the import drafts');assert.equal(local.m.size,0,'an older localStorage draft goes too');
 }finally{delete (globalThis as any).sessionStorage;delete (globalThis as any).localStorage}
 assert.equal(loadDraft(IMP),null,'no storage: no draft, no error');
 const ui=src('../src/components/IcpImport.tsx');
 for(const handler of ['async function validate','async function discard','async function erase']){
  const body=ui.slice(ui.indexOf(handler),ui.indexOf('\n }',ui.indexOf(handler)));
  assert.match(body,/clearDraft\(row\.id\)/,`${handler} clears the draft`);
 }
 assert.match(ui,/const signedOut=useCallback\(\(\)=>\{clearAllDrafts\(\);onUnauthorized\(\)\}/);
 assert.doesNotMatch(ui+src('../src/icp-import/client.ts').replace(/\/\/.*$/gm,''),/localStorage\.setItem/);
 assert.match(src('../src/ui/v2/shell/UserMenu.tsx'),/onClick=\{act\(\(\)=>\{clearAllDrafts\(\);p\.onSignOut\(\)\}\)\}/,'the sign-out of the account menu');
});

test('migration 041 is frozen: its bytes are the ones reviewed; any further change goes to a new migration (042)',async()=>{
 const {createHash}=await import('node:crypto');
 const sql=readFileSync(new URL('../db/migrations/041_icp_import.sql',import.meta.url));
 assert.equal(createHash('sha256').update(sql).digest('hex'),FROZEN_041_SHA256,'041 is frozen (docs/ICP_IMPORT.md): write a 042 instead');
});
const FROZEN_041_SHA256='3809aa68f8c8981b946f958d942a6cfa5c8d88fff570eed6e6d4e607da007b4f';

test('coverage — shown with its source and removable like any single value',()=>{
 const p={...fixture(),company:{...fixture().company,coverage:{value:'NATIONAL' as const,source:'France entière',confidence:0.9}}};
 const r=removeAt(p,['company','coverage']);assert.ok(r.ok);assert.deepEqual(r.profile.company.coverage,{value:null,source:null,confidence:0});
 assert.match(src('../src/components/IcpImport.tsx'),/p\.company\.coverage\?\.value&&/);
 assert.equal(ICP_MESSAGES.fr.coverageNATIONAL,'France entière');
});
