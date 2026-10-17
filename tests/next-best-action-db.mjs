// Migration 031 — Next Best Action on real PostgreSQL (PGlite) with the full migration chain. End to end: real signals
// (024, reviewed by a person), real public content (027), real evidence → the pure engine (src/nba/engine.ts) and its
// drafts (src/nba/content.ts) → save_nba_actions → queue / decisions / outcome / expiry. Plus tenant isolation, RLS,
// immutability and the transitions. Fictitious companies, .example domains. Nothing is sent anywhere.
// Run: node --experimental-strip-types tests/next-best-action-db.mjs
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {buildOpportunity} from '../src/nba/engine.ts';
import {prepareContent} from '../src/nba/content.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
// The table owner acting for a member (fixtures only: the audit triggers read auth.uid()).
async function owner(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user]);return sql(text,params)}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg})`)}
const h=t=>createHash('sha256').update(t).digest('hex');
const iso=d=>d.toISOString();
const daysAgo=d=>new Date(Date.now()-d*86400000);

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('031_next_best_action.sql'),'migration 031 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/migrations/checks/031_next_best_action.sql',import.meta.url),'utf8'));

 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const org=async u=>(await as(u,`select public.create_organization('Org') id`)).rows[0].id;
 const oa=await org(A),ob=await org(B);
 const pa=(await as(A,`insert into public.projects(organization_id,name,offer) values($1,'P','Nous aidons les équipes commerciales à choisir quels comptes contacter chaque semaine.') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const CRITERIA=[{key:'target_fit',label:'Correspond à la cible définie',weight:82},{key:'need_fit',label:'Besoin',weight:18}];
 await as(A,`insert into public.icps(organization_id,project_id,criteria) values($1,$2,$3::jsonb)`,[oa,pa,JSON.stringify(CRITERIA)]);
 const prospect=async(u,o,p,name)=>(await as(u,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,$3,$4) returning id`,[o,p,name,`https://${name.toLowerCase()}.example`])).rows[0].id;
 const prB1=await prospect(A,oa,pa,'Bravo'),prC1=await prospect(A,oa,pa,'Canopee'),prA1=await prospect(A,oa,pa,'Alto'),prD1=await prospect(A,oa,pa,'Delta');
 const prOther=await prospect(B,ob,pb,'Other');
 for(const p of [prA1,prB1,prC1,prD1])await owner(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at,verified_by)
  values($1,$2,'target_fit',true,'VERIFIED','https://registry.example/x','Éditeur SaaS B2B, 40 salariés.',now()-interval '3 days',$3)`,[oa,p,A]);
 const saveSignals=(u,p,list)=>as(u,'select public.save_signals($1,null,$2::jsonb) r',[p,JSON.stringify(list)]).then(r=>r.rows[0].r);
 const reviewSignal=(u,id,d)=>as(u,'select public.review_signal($1,$2,null) r',[id,d]);
 const sig=(o)=>({provider:'web_search',signal_type:'hiring_role',title:'Bravo recrute un SDR',excerpt:'Bravo recrute un SDR pour construire son pipeline outbound.',
  source_url:'https://jobs.example/bravo/sdr',source_type:'job_board',published_at:iso(daysAgo(2)),observed_at:iso(daysAgo(1)),matched_terms:[],content_hash:h('bravo-sdr'),event_key:'hiring_role:bravo-sdr',...o});
 await saveSignals(A,prB1,[sig({})]);
 await saveSignals(A,prD1,[sig({title:'Delta recrute un SDR',excerpt:'Delta recrute un SDR.',source_url:'https://jobs.example/delta/sdr',published_at:iso(daysAgo(182)),observed_at:iso(daysAgo(181)),content_hash:h('delta'),event_key:'hiring_role:delta'})]);
 for(const r of (await as(A,`select id from public.signals where organization_id=$1`,[oa])).rows)await reviewSignal(A,r.id,'verify');
 const pc=(await as(A,'select public.save_public_content($1,$2::jsonb) r',[prC1,JSON.stringify({source_url:'https://social.example/canopee/post',author:'Claire Martin',
  content:'200 appels cette semaine pour 3 rendez-vous. Il faut revoir notre façon de prospecter.',published_at:iso(daysAgo(1))})])).rows[0].r;
 await as(A,'select public.review_public_content($1,$2)',[pc.id,'verify']);

 // The engine, fed with what the member reads (RLS), exactly like the route does.
 const compute=async(u,project,now=new Date())=>{
  const prospects=(await as(u,`select p.id,p.project_id,p.name,p.status,coalesce(json_agg(e.*) filter (where e.id is not null),'[]') evidence
   from public.prospects p left join public.evidence e on e.prospect_id=p.id where p.project_id=$1 group by p.id order by p.name`,[project])).rows;
  const signals=(await as(u,`select * from public.signals where project_id=$1 and status in ('VERIFIED','PENDING_REVIEW')`,[project])).rows
   .map(r=>({...r,confidence:Number(r.confidence),event_date:r.event_date?iso(r.event_date).slice(0,10):null,published_at:r.published_at?iso(r.published_at):null,observed_at:iso(r.observed_at),matched_terms:r.matched_terms??[]}));
  const content=(await as(u,`select * from public.prospect_public_content where project_id=$1 and status='VERIFIED'`,[project])).rows
   .map(r=>({...r,published_at:r.published_at?iso(r.published_at):null,observed_at:iso(r.observed_at)}));
  const offer=(await as(u,'select offer from public.projects where id=$1',[project])).rows[0]?.offer??'';
  return prospects.map(p=>{
   const evidence=p.evidence.map(e=>({...e,observed_at:new Date(e.observed_at).toISOString()}));
   const s=signals.filter(x=>x.prospect_id===p.id),c=content.filter(x=>x.prospect_id===p.id);
   const o=buildOpportunity({prospect:p,criteria:CRITERIA,evidence,signals:s,publicContent:c,profile:null,now});
   const prepared=prepareContent({opportunity:o,name:p.name,offer,criteria:CRITERIA,evidence,signals:s,publicContent:c,profile:null,now});
   return {o,item:{prospect_id:o.prospect_id,recommended_action:o.recommended_action,rule:o.rule,scores:o.scores,primary:o.primary,signal_ids:o.signal_ids,public_content_ids:o.public_content_ids,
    evidence_ids:o.evidence_ids,target:o.target,explanation:o.explanation,prepared_content:prepared,fingerprint:o.fingerprint,config_version:o.config_version,computed_at:o.computed_at,expires_at:o.expires_at}};
  });
 };
 const save=(u,project,items)=>as(u,'select public.save_nba_actions($1,$2::jsonb) r',[project,JSON.stringify(items)]).then(r=>r.rows[0].r);
 const decide=(u,id,d,o={})=>as(u,'select public.decide_nba_action($1,$2,$3,$4,$5) r',[id,d,o.reason??null,o.until??null,o.human??null]).then(r=>r.rows[0].r);
 const outcome=(u,id,x)=>as(u,'select public.record_nba_outcome($1,$2,null) r',[id,x]).then(r=>r.rows[0].r);
 const open=async(u,p)=>(await as(u,`select * from public.nba_actions where prospect_id=$1 and state in ('PENDING','SNOOZED','APPROVED')`,[p])).rows[0];

 let computed;
 await check('DRY RUN: signal → evidence → scores → action → why now → draft, for the four reference companies',async()=>{
  computed=await compute(A,pa);
  const by=Object.fromEntries(computed.map(x=>[x.o.prospect_id,x]));
  assert.equal(by[prA1].o.recommended_action,'WAIT');
  assert.equal(by[prB1].o.recommended_action,'CONTACT');assert.equal(by[prB1].o.primary.commercial_type,'HIRING_SDR');
  assert.equal(by[prB1].item.prepared_content.kind,'contact_draft');assert.match(by[prB1].item.prepared_content.text,/Bravo recrute un SDR pour construire son pipeline outbound/);
  assert.equal(by[prC1].o.recommended_action,'ENGAGE');assert.equal(by[prC1].o.target.person.name,'Claire Martin');
  assert.equal(by[prC1].item.prepared_content.kind,'engage');
  assert.equal(by[prD1].o.recommended_action,'WAIT');
  assert.deepEqual(await save(A,pa,computed.map(x=>x.item)),{created:4,unchanged:0,superseded:0,kept_approved:0});
  const row=await open(A,prB1);
  assert.equal(row.state,'PENDING');assert.equal(row.recommended_action,'CONTACT');assert.equal(row.primary_signal_type,'HIRING_SDR');assert.equal(row.primary_evidence_status,'VERIFIED');
  assert.ok(row.timing_score>=80&&row.fit_score===82&&row.fit_basis==='verified',JSON.stringify([row.timing_score,row.fit_score]));
  assert.equal(row.explanation.why_now[0].refs[0].source_url,'https://jobs.example/bravo/sdr');
  const ev=(await as(A,'select kind,to_state from public.nba_action_events where action_id=$1',[row.id])).rows;assert.deepEqual(ev,[{kind:'created',to_state:'PENDING'}]);
 });

 await check('RECOMPUTE: same reason → unchanged; a new reason supersedes a pending one; an approved one is kept',async()=>{
  assert.deepEqual(await save(A,pa,computed.map(x=>x.item)),{created:0,unchanged:4,superseded:0,kept_approved:0});
  const a1=await open(A,prA1);
  const changed={...computed.find(x=>x.o.prospect_id===prA1).item,fingerprint:'WATCH:other'};
  assert.deepEqual(await save(A,pa,[changed]),{created:1,unchanged:0,superseded:1,kept_approved:0});
  assert.equal((await as(A,'select state from public.nba_actions where id=$1',[a1.id])).rows[0].state,'EXPIRED');
  assert.equal((await as(A,`select count(*)::int n from public.nba_actions where prospect_id=$1 and state in ('PENDING','SNOOZED','APPROVED')`,[prA1])).rows[0].n,1);
  const b=await open(A,prB1);await decide(A,b.id,'APPROVED',{human:'CONTACT'});
  assert.deepEqual(await save(A,pa,[{...computed.find(x=>x.o.prospect_id===prB1).item,fingerprint:'CONTACT:other'}]),{created:0,unchanged:0,superseded:0,kept_approved:1});
 });

 await check('DECISIONS: approve → done → outcome; snooze needs a date, wakes up; reject is terminal; invalid transitions refused; history kept',async()=>{
  const b=await open(A,prB1);
  await refused(()=>outcome(A,b.id,'REPLIED'),/OUTCOME_REQUIRES_DONE/,'an outcome before DONE');
  await decide(A,b.id,'DONE',{human:'CONTACT',reason:'Message envoyé à la main'});
  assert.deepEqual(await outcome(A,b.id,'MEETING'),{id:b.id,outcome:'MEETING'});
  await refused(()=>decide(A,b.id,'PENDING'),/INVALID_TRANSITION/,'reopening a DONE action');
  const hist=(await as(A,'select kind,from_state,to_state,human_action,outcome from public.nba_action_events where action_id=$1 order by created_at,kind',[b.id])).rows;
  assert.deepEqual(hist.map(r=>`${r.kind}:${r.from_state??'-'}>${r.to_state}`),['created:->PENDING','decision:PENDING>APPROVED','decision:APPROVED>DONE','outcome:DONE>DONE']);
  assert.equal(hist.find(r=>r.kind==='outcome').outcome,'MEETING');
  const c=await open(A,prC1);
  await refused(()=>decide(A,c.id,'SNOOZED'),/Invalid snooze/,'a snooze without date');
  await refused(()=>decide(A,c.id,'SNOOZED',{until:iso(new Date(Date.now()+100*86400000))}),/Invalid snooze/,'a snooze beyond 90 days');
  await decide(A,c.id,'SNOOZED',{until:iso(new Date(Date.now()+1500))});
  assert.equal((await open(A,prC1)).state,'SNOOZED');
  await sql('select pg_sleep(1.6)');
  assert.deepEqual((await as(A,'select public.refresh_nba_states($1) r',[pa])).rows[0].r,{expired:0,unsnoozed:1});
  assert.equal((await open(A,prC1)).state,'PENDING');
  await decide(A,c.id,'REJECTED',{reason:'Pas le bon moment'});
  await refused(()=>decide(A,c.id,'APPROVED'),/INVALID_TRANSITION/,'approving a rejected action');
 });

 await check('EXPIRY: an action whose reason stopped counting is EXPIRED by refresh; a decision on it is refused',async()=>{
  const d=computed.find(x=>x.o.prospect_id===prD1).item;
  const past={...d,fingerprint:'WAIT:expiring',computed_at:iso(new Date(Date.now()-23*3600000)),expires_at:iso(new Date(Date.now()-3600000))};
  await save(A,pa,[past]);
  const row=(await as(A,`select id,state from public.nba_actions where prospect_id=$1 and fingerprint='WAIT:expiring'`,[prD1])).rows[0];
  await refused(()=>decide(A,row.id,'APPROVED'),/RECOMMENDATION_EXPIRED/,'approving an expired reason');
  const r=(await as(A,'select public.refresh_nba_states($1) r',[pa])).rows[0].r;assert.equal(r.expired,1);
  assert.equal((await as(A,'select state from public.nba_actions where id=$1',[row.id])).rows[0].state,'EXPIRED');
 });

 await check('EVIDENCE: a reference to another prospect’s signal, a rejected signal, an unreviewed content or foreign evidence is refused',async()=>{
  const base=computed.find(x=>x.o.prospect_id===prA1).item;
  const bravoSignal=(await as(A,'select id from public.signals where prospect_id=$1',[prB1])).rows[0].id;
  await refused(()=>save(A,pa,[{...base,fingerprint:'X:1',signal_ids:[bravoSignal]}]),/Invalid signal reference/,'another prospect’s signal');
  await saveSignals(A,prA1,[sig({title:'Alto',excerpt:'Alto recrute.',source_url:'https://jobs.example/alto',content_hash:h('alto'),event_key:'hiring_role:alto'})]);
  const altoSig=(await as(A,'select id from public.signals where prospect_id=$1',[prA1])).rows[0].id;await reviewSignal(A,altoSig,'reject');
  await refused(()=>save(A,pa,[{...base,fingerprint:'X:2',signal_ids:[altoSig]}]),/Invalid signal reference/,'a rejected signal');
  const pc2=(await as(A,'select public.save_public_content($1,$2::jsonb) r',[prA1,JSON.stringify({source_url:'https://social.example/alto',author:'X',content:'Post à revoir.',published_at:iso(daysAgo(1))})])).rows[0].r;
  await refused(()=>save(A,pa,[{...base,fingerprint:'X:3',public_content_ids:[pc2.id]}]),/Invalid public content reference/,'an unreviewed public content');
  const foreignEv=(await owner(B,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt) values($1,$2,'x',true,'NOT_VERIFIED','https://o.example','o') returning id`,[ob,prOther])).rows[0].id;
  await refused(()=>save(A,pa,[{...base,fingerprint:'X:4',evidence_ids:[foreignEv]}]),/Invalid evidence reference/,'another tenant’s evidence');
  await refused(()=>save(A,pa,[{...base,fingerprint:'X:5',extra:1}]),/Invalid recommendation/,'an unknown field');
  await refused(()=>save(A,pa,[{...base,fingerprint:'X:6',recommended_action:'SEND'}]),/check/i,'an action outside the list');
 });

 await check('TENANTS / RLS: another organization reads nothing, writes nothing, decides nothing; anon has no access',async()=>{
  assert.equal((await as(B,'select count(*)::int n from public.nba_actions')).rows[0].n,0);
  assert.equal((await as(B,'select count(*)::int n from public.nba_action_events')).rows[0].n,0);
  const any=(await as(A,'select id from public.nba_actions limit 1')).rows[0].id;
  await refused(()=>decide(B,any,'REJECTED'),/tenant member required/i,'deciding another tenant’s action');
  await refused(()=>outcome(B,any,'PAID'),/tenant member required/i,'an outcome on another tenant’s action');
  await refused(()=>save(B,pa,[computed[0].item]),/tenant member required/i,'writing into another tenant’s project');
  await refused(()=>as(B,'select public.refresh_nba_states($1)',[pa]),/tenant member required/i,'refreshing another tenant’s project');
  await refused(()=>save(A,pb,[computed[0].item]),/tenant member required/i,'writing into a project of another tenant');
  await refused(()=>as(A,`update public.nba_actions set state='DONE' where id=$1`,[any]),/permission denied/i,'a direct client update');
  await refused(()=>as(A,`insert into public.nba_action_events(organization_id,action_id,to_state,kind,recommended_action) values($1,$2,'DONE','decision','CONTACT')`,[oa,any]),/permission denied/i,'a direct history write');
  await refused(()=>as(A,`delete from public.nba_actions where id=$1`,[any]),/permission denied/i,'a direct delete');
  await refused(()=>as(undefined,'select * from public.nba_actions'),/permission denied/i,'anon read');
  await refused(()=>as(undefined,'select public.save_nba_actions($1,$2::jsonb)',[pa,'[]']),/permission denied/i,'anon RPC');
 });

 await check('IMMUTABLE: what was computed never changes, even for the table owner; terminal states stay terminal',async()=>{
  const row=(await as(A,`select id from public.nba_actions where state='PENDING' limit 1`)).rows[0];
  await refused(()=>sql(`update public.nba_actions set opportunity_score=100 where id=$1`,[row.id]),/immutable/i,'rewriting a score');
  await refused(()=>sql(`update public.nba_actions set explanation='{}'::jsonb where id=$1`,[row.id]),/immutable/i,'rewriting the explanation');
  const done=(await as(A,`select id from public.nba_actions where state='DONE' limit 1`)).rows[0];
  await refused(()=>sql(`update public.nba_actions set state='PENDING' where id=$1`,[done.id]),/Terminal/i,'reopening a terminal action');
 });

 await check('FEEDBACK: recommended action, human action, decision and outcome are kept side by side for later analysis',async()=>{
  const r=(await as(A,`select recommended_action,human_action,state,outcome,primary_signal_type,timing_score,fit_score from public.nba_actions where outcome is not null`)).rows;
  assert.deepEqual(r.map(x=>[x.recommended_action,x.human_action,x.state,x.outcome,x.primary_signal_type]),[['CONTACT','CONTACT','DONE','MEETING','HIRING_SDR']]);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,m] of results)console.log(`${s.padEnd(4)}  ${n}${m?`  — ${m}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;
console.log(`\nNEXT BEST ACTION DB: ${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
