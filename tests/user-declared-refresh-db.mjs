// UI-4 fix on real PostgreSQL (PGlite, full migration chain): a USER_DECLARED that leaves the action and the driving
// signal unchanged now re-states the recommendation through the real save_nba_actions (the old one EXPIRED as
// "superseded", the new one PENDING with the refreshed FIT profile) — the staging canary on Quick kept the old one as
// "unchanged". Recomputing again without a new declaration changes nothing (no churn). Fictitious company, .example domains.
// Run: node --experimental-strip-types tests/user-declared-refresh-db.mjs
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {buildOpportunity} from '../src/nba/engine.ts';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
const iso=d=>new Date(d).toISOString();const daysAgo=d=>new Date(Date.now()-d*86400000);
const h=t=>createHash('sha256').update(t).digest('hex');

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 for(const f of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));

 const A='00000000-0000-4000-8000-000000000001';
 await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,'a@t',now())`,[A]);
 const org=(await as(A,`select public.create_organization('Org') id`)).rows[0].id;
 const project=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[org])).rows[0].id;
 const CRITERIA=[{key:'target_fit',label:'Restauration en Occitanie',weight:35},{key:'local_decision',label:'Décision d’achat locale',weight:25},
  {key:'need_fit',label:'Besoin d’un canal direct',weight:25},{key:'contactability',label:'Canal de contact documenté',weight:15}];
 await as(A,`insert into public.icps(organization_id,project_id,criteria) values($1,$2,$3::jsonb)`,[org,project,JSON.stringify(CRITERIA)]);
 const pr=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Kantina','https://kantina.example') returning id`,[org,project])).rows[0].id;
 await as(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at) values($1,$2,'target_fit',true,'VERIFIED','https://presse.example/k','Kantina ouvre un restaurant à Toulouse.',now()-interval '3 days')`,[org,pr]);
 await as(A,'select public.save_signals($1,null,$2::jsonb)',[pr,JSON.stringify([{provider:'web_search',signal_type:'new_site',title:'Kantina ouvre à Toulouse',excerpt:'Kantina ouvre un restaurant à Toulouse.',
  source_url:'https://presse.example/kantina',source_type:'search_snippet',published_at:iso(daysAgo(4)),observed_at:iso(daysAgo(3)),matched_terms:[],content_hash:h('k'),event_key:'new_site:kantina'}])]);
 for(const r of (await as(A,`select id from public.signals where prospect_id=$1`,[pr])).rows)await as(A,'select public.review_signal($1,$2,null)',[r.id,'verify']);

 // The route's computation: what the member reads (RLS) → the pure engine → save_nba_actions.
 const compute=async()=>{
  const p=(await as(A,`select p.id,p.project_id,p.name,p.status,coalesce(json_agg(e.*) filter (where e.id is not null),'[]') evidence from public.prospects p left join public.evidence e on e.prospect_id=p.id where p.id=$1 group by p.id`,[pr])).rows[0];
  const signals=(await as(A,`select * from public.signals where prospect_id=$1 and status in ('VERIFIED','PENDING_REVIEW')`,[pr])).rows
   .map(r=>({...r,confidence:Number(r.confidence),event_date:r.event_date?iso(r.event_date).slice(0,10):null,published_at:r.published_at?iso(r.published_at):null,observed_at:iso(r.observed_at),matched_terms:r.matched_terms??[]}));
  const o=buildOpportunity({prospect:p,criteria:CRITERIA,evidence:p.evidence.map(e=>({...e,observed_at:iso(e.observed_at)})),signals,publicContent:[],profile:null,now:new Date()});
  return {o,item:{prospect_id:o.prospect_id,recommended_action:o.recommended_action,rule:o.rule,scores:o.scores,primary:o.primary,signal_ids:o.signal_ids,public_content_ids:o.public_content_ids,
   evidence_ids:o.evidence_ids,target:o.target,explanation:o.explanation,prepared_content:{kind:'none',reason:'NOT_PREPARED'},fingerprint:o.fingerprint,config_version:o.config_version,computed_at:o.computed_at,expires_at:o.expires_at}};
 };
 const save=async()=>{const {o,item}=await compute();return {o,r:(await as(A,'select public.save_nba_actions($1,$2::jsonb) r',[project,JSON.stringify([item])])).rows[0].r}};
 const pending=async()=>(await as(A,`select * from public.nba_actions where prospect_id=$1 and state='PENDING'`,[pr])).rows;

 let first;
 await check('BEFORE: the first computation is stored (WATCH, 1 verified + 3 missing, historical fingerprint)',async()=>{
  const {o,r}=await save();first=o;
  assert.equal(r.created,1);assert.equal(o.recommended_action,'WATCH');assert.doesNotMatch(o.fingerprint,/:ud/);
  const [row]=await pending();assert.equal(row.scores.fit.profile.missing.length,3);assert.deepEqual(row.scores.fit.profile.declared,[]);
 });
 await check('AFTER a declaration (same action, same signal): re-stated — old EXPIRED as superseded, new PENDING with the refreshed profile',async()=>{
  await as(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,note) values($1,$2,'local_decision',true,'USER_DECLARED','Test canary UI-4')`,[org,pr]);
  const {o,r}=await save();
  assert.equal(o.recommended_action,first.recommended_action,'action unchanged');assert.equal(o.primary.signal_id,first.primary.signal_id,'driving signal unchanged');
  assert.deepEqual([r.created,r.superseded,r.unchanged],[1,1,0],JSON.stringify(r));
  const rows=await pending();assert.equal(rows.length,1);const p=rows[0].scores.fit.profile;
  assert.deepEqual(p.declared,['Décision d’achat locale']);assert.equal(p.missing.length,2);
  assert.deepEqual([p.verified_score,p.verified_coverage,rows[0].evidence_quality_score],[first.scores.fit.profile.verified_score,first.scores.fit.profile.verified_coverage,first.scores.evidence_quality.score]);
  assert.notEqual(rows[0].recommended_action,'CONTACT');
  const old=(await as(A,`select state from public.nba_actions where fingerprint=$1`,[first.fingerprint])).rows;assert.deepEqual(old.map(x=>x.state),['EXPIRED']);
 });
 await check('NO CHURN: recomputing without a new declaration answers "unchanged"; a note-only edit too',async()=>{
  assert.deepEqual((await save()).r.unchanged,1);
  await as(A,`update public.evidence set note='Autre note' where prospect_id=$1 and status='USER_DECLARED'`,[pr]);
  assert.deepEqual((await save()).r.unchanged,1);
  assert.equal((await pending()).length,1);
 });
 await check('VALUE FLIP: declaring the criterion NOT met re-states again (TRUE and FALSE are distinct identities); FALSE is no counter-proof',async()=>{
  await as(A,`update public.evidence set value=false where prospect_id=$1 and status='USER_DECLARED'`,[pr]);
  const {o,r}=await save();assert.equal(r.superseded,1);
  assert.notEqual(o.rule,'OFF_TARGET');assert.equal(o.scores.fit.profile.negative_weight,0);
  assert.deepEqual((await pending())[0].scores.fit.profile.declared_false,['Décision d’achat locale']);
 });
}catch(e){results.push(['SETUP','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,m] of results)console.log(`${s.padEnd(4)}  ${n}${m?`  — ${m}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;
console.log(`\nUSER_DECLARED REFRESH DB: ${results.length-failed}/${results.length} checks passed`);
process.exit(failed?1:0);
