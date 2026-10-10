// Migration 027 — O1/O2 outreach intelligence on real PostgreSQL (PGlite) with the full migration chain:
// the generated message kept next to the human version (immutable), provenance frozen at creation, a locked APPROVED
// text, personal style profiles (owner only), public content kept apart from evidence/signals (members only, written
// through functions, reviewed by a person) and the outreach references checked against tenant, owner and review.
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${msg}) — ${what}`)}
const h=t=>createHash('sha256').update(t).digest('hex');
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 const target=files.find(f=>f.startsWith('027_'));
 const before=files.filter(f=>!target||f<target),after=target?files.filter(f=>f>=target):[];
 for(const f of before)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2),A2=U(3);
 for(const [u,e] of [[A,'a@t'],[B,'b@t'],[A2,'a2@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const oa=(await as(A,`select public.create_organization('Org A') id`)).rows[0].id,ob=(await as(B,`select public.create_organization('Org B') id`)).rows[0].id;
 await sql(`insert into public.memberships(organization_id,user_id,role) values($1,$2,'member')`,[oa,A2]);
 const pa=(await as(A,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const prA=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'KERLAN','https://kerlan.example') returning id`,[oa,pa])).rows[0].id;
 const prA2=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'ACME','https://acme.example') returning id`,[oa,pa])).rows[0].id;
 const prB=(await as(B,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Other','https://other.example') returning id`,[ob,pb])).rows[0].id;
 // A legacy message written before migration 027: its original generated text is unknown.
 const legacy=(await as(A,`insert into public.outreach(organization_id,prospect_id,content,status) values($1,$2,'Ancien message édité','APPROVED') returning id`,[oa,prA2])).rows[0].id;
 await check('MIGRATION 027 present and applied on top of 001–026',async()=>{assert.ok(target,'a 027_* migration exists');for(const f of after)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'))});
 await check('IDEMPOTENT: re-applying 027 changes nothing',async()=>{for(const f of after)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'))});
 await check('LEGACY: an existing message keeps generated_content NULL — the original is never reconstructed from content',async()=>{
  const r=(await sql('select generated_content,content,created_by from public.outreach where id=$1',[legacy])).rows[0];
  assert.equal(r.generated_content,null);assert.equal(r.content,'Ancien message édité');assert.equal(r.created_by,null);
 });

 const insertOutreach=(u,o={})=>as(u,`insert into public.outreach(organization_id,prospect_id,content,generated_content,created_by,style_profile_id,public_content_ids,signal_ids,angle,provider)
  values($1,$2,$3,$4,$5,$6,coalesce($7::jsonb,'[]'),coalesce($8::jsonb,'[]'),$9::jsonb,'rule_based_v1') returning *`,
  [o.org??oa,o.prospect??prA,o.content??'Bonjour l’équipe KERLAN, message généré.',o.generated??null,o.created_by??null,o.style??null,o.pcs?JSON.stringify(o.pcs):null,o.sigs?JSON.stringify(o.sigs):null,o.angle?JSON.stringify(o.angle):null]).then(r=>r.rows[0]);
 let draft;
 await check('O1 CREATE: generated_content = content; created_by is the caller (a client-chosen author is ignored); a different original is refused',async()=>{
  draft=await insertOutreach(A,{created_by:B,angle:{type:'generic',source_id:null,label:'Générique',reason:'aucune donnée vérifiée',source_url:null,observed_at:null,excerpt:null}});
  assert.equal(draft.generated_content,draft.content);assert.equal(draft.created_by,A);assert.equal(draft.last_edited_by,null);
  await refused(()=>insertOutreach(A,{prospect:prA2,content:'Version humaine',generated:'Autre original'}),/generated_content/,'an original that differs from the first content');
 });
 await check('O1 EDIT: the human version replaces content only; generated_content, angle and references never change; editor recorded',async()=>{
  await as(A,`update public.outreach set content='Bonjour, message retouché par moi.' where id=$1`,[draft.id]);
  const r=(await sql('select * from public.outreach where id=$1',[draft.id])).rows[0];
  assert.equal(r.generated_content,'Bonjour l’équipe KERLAN, message généré.');assert.equal(r.content,'Bonjour, message retouché par moi.');
  assert.equal(r.last_edited_by,A);assert.ok(r.last_edited_at);
  for(const [col,val] of [['generated_content',"'réécrit'"],['angle',`'{"type":"signal"}'::jsonb`],['public_content_ids',`'[]'::jsonb||'["${U(9)}"]'::jsonb`],['signal_ids',`'["${U(9)}"]'::jsonb`],['evidence_ids',`'["${U(9)}"]'::jsonb`],['created_by',`'${A2}'`],['style_profile_id',`'${U(9)}'`],['last_edited_by',`'${A2}'`]])
   await refused(()=>as(A,`update public.outreach set ${col}=${val} where id=$1`,[draft.id]),/immutable|Invalid evidence/i,`changing ${col}`);
  await refused(()=>as(A,`update public.outreach set generated_content=content where id=$1`,[legacy]),/immutable/i,'reconstructing a legacy original from content');
  await refused(()=>as(A,`update public.outreach set generated_content=null where id=$1`,[draft.id]),/immutable/i,'erasing an original');
 });
 await check('O1 WORKFLOW: APPROVED text is locked; APPROVED → USED keeps both texts; USED stays terminal; the prospect status never moves',async()=>{
  const statusBefore=(await sql('select status from public.prospects where id=$1',[prA])).rows[0].status;
  await as(A,`update public.outreach set status='APPROVED' where id=$1`,[draft.id]);
  await refused(()=>as(A,`update public.outreach set content='changé après validation' where id=$1`,[draft.id]),/approved/i,'editing an approved text');
  await as(A,`update public.outreach set status='USED' where id=$1`,[draft.id]);
  const r=(await sql('select * from public.outreach where id=$1',[draft.id])).rows[0];
  assert.equal(r.status,'USED');assert.equal(r.generated_content,'Bonjour l’équipe KERLAN, message généré.');assert.equal(r.content,'Bonjour, message retouché par moi.');
  await refused(()=>as(A,`update public.outreach set status='APPROVED' where id=$1`,[draft.id]),/immutable/i,'leaving USED');
  assert.equal((await sql('select status from public.prospects where id=$1',[prA])).rows[0].status,statusBefore,'copy is not contacted');
 });

 // ——— style profiles ———
 const saveStyle=(u,org,p)=>as(u,'select public.save_outreach_style_profile($1,$2::jsonb) r',[org,JSON.stringify(p)]).then(r=>r.rows[0].r);
 const STYLE={tone:'professional_conversational',address_mode:'auto',length:'short',max_chars:600,banned_phrases:['Je me permets de vous contacter','synergie'],preferred_ctas:['Un échange de quelques minutes ?'],instructions:'Phrases courtes. Ne jamais inventer de contexte.'};
 let styleA;
 await check('STYLE: saved for the caller only (owner forced), unknown fields and long instructions refused, upsert per user',async()=>{
  styleA=await saveStyle(A,oa,STYLE);assert.equal(styleA.user_id,A);assert.equal(styleA.organization_id,oa);
  await refused(()=>saveStyle(A,oa,{...STYLE,user_id:A2}),/Invalid style profile/,'a client-chosen owner');
  await refused(()=>saveStyle(A,oa,{...STYLE,instructions:'x'.repeat(1501)}),/Invalid style profile/,'instructions over 1500');
  await refused(()=>saveStyle(A,oa,{...STYLE,tone:'aggressive'}),/Invalid style profile/,'an unknown tone');
  await refused(()=>saveStyle(B,oa,STYLE),/member/i,'a non-member writing into org A');
  const again=await saveStyle(A,oa,{...STYLE,length:'medium'});assert.equal(again.id,styleA.id);assert.equal(again.length,'medium');
 });
 await check('STYLE isolation: user A2 (same org) and tenant B never read A’s profile; no direct writes',async()=>{
  assert.equal((await as(A,'select count(*)::int n from public.outreach_style_profiles')).rows[0].n,1);
  assert.equal((await as(A2,'select count(*)::int n from public.outreach_style_profiles')).rows[0].n,0);
  assert.equal((await as(B,'select count(*)::int n from public.outreach_style_profiles')).rows[0].n,0);
  await refused(()=>as(A,`insert into public.outreach_style_profiles(organization_id,user_id,tone,address_mode,length) values($1,$2,'professional_conversational','auto','short')`,[oa,A]),/permission denied/i,'a direct insert');
  await refused(()=>as(A,`update public.outreach_style_profiles set instructions='x' where id=$1`,[styleA.id]),/permission denied/i,'a direct update');
 });
 await check('STYLE reference: an outreach may cite only its author’s own profile',async()=>{
  const ok=await insertOutreach(A,{prospect:prA2,style:styleA.id});assert.equal(ok.style_profile_id,styleA.id);
  await as(A,`update public.outreach set status='DISCARDED' where id=$1`,[ok.id]);
  await refused(()=>insertOutreach(A2,{prospect:prA2,style:styleA.id}),/style profile/i,'another member’s profile');
 });

 // ——— public content ———
 const savePc=(u,p,item)=>as(u,'select public.save_public_content($1,$2::jsonb) r',[p,JSON.stringify(item)]).then(r=>r.rows[0].r);
 const reviewPc=(u,id,d)=>as(u,'select public.review_public_content($1,$2) r',[id,d]).then(r=>r.rows[0].r);
 const pinPc=(u,id,p)=>as(u,'select public.pin_public_content($1,$2) r',[id,p]).then(r=>r.rows[0].r);
 const ITEM={source_url:'https://www.linkedin.com/posts/kerlan-123',author:'Kerlan',content:'Nous ouvrons un nouvel atelier à Vannes.',published_at:'2026-10-05T09:00:00Z'};
 let pc1,pc2;
 await check('PUBLIC CONTENT: saved by a member as user_provided / PENDING_REVIEW; hash by the database; duplicate kept once; strict fields',async()=>{
  pc1=await savePc(A,prA,ITEM);assert.equal(pc1.duplicate,false);
  const r=(await as(A,'select * from public.prospect_public_content where id=$1',[pc1.id])).rows[0];
  assert.equal(r.status,'PENDING_REVIEW');assert.equal(r.source_type,'user_provided');assert.equal(r.provider,'user');assert.equal(r.project_id,pa);
  assert.equal(r.content_hash,h(ITEM.content));assert.equal(r.created_by,A);assert.equal(r.pinned,false);
  assert.equal((await savePc(A,prA,ITEM)).duplicate,true);
  await refused(()=>savePc(A,prA,{...ITEM,status:'VERIFIED'}),/Invalid public content/,'a client-set status');
  await refused(()=>savePc(A,prA,{...ITEM,source_type:'authorized_provider'}),/Invalid public content/,'a client-chosen source type');
  await refused(()=>savePc(A,prA,{...ITEM,source_url:'javascript:alert(1)'}),/Invalid public content|check/i,'a non-http source');
  await refused(()=>savePc(A,prA,{...ITEM,content:' '}),/Invalid public content|check/i,'empty content');
  pc2=await savePc(A,prA,{...ITEM,content:'Notre usine de Lorient passe en 3x8.'});
 });
 await check('PUBLIC CONTENT isolation: tenant B cannot read, write, review or pin A’s content; no direct table writes',async()=>{
  assert.equal((await as(B,'select count(*)::int n from public.prospect_public_content')).rows[0].n,0);
  await refused(()=>savePc(B,prA,{...ITEM,content:'intrus'}),/member/i,'B writing on A’s prospect');
  await refused(()=>reviewPc(B,pc1.id,'verify'),/member|not found/i,'B reviewing');
  await refused(()=>pinPc(B,pc1.id,true),/member|not found/i,'B pinning');
  await refused(()=>as(A,`insert into public.prospect_public_content(organization_id,project_id,prospect_id,source_type,source_url,content,observed_at,provider,content_hash) values($1,$2,$3,'user_provided','https://x.example','x',now(),'user',$4)`,[oa,pa,prA,h('x')]),/permission denied/i,'a direct insert');
  await refused(()=>as(A,`update public.prospect_public_content set status='VERIFIED' where id=$1`,[pc1.id]),/permission denied/i,'a direct review');
 });
 await check('PUBLIC CONTENT review: the reviewer is the caller; only VERIFIED can be pinned; one pin per prospect; reject unpins',async()=>{
  await refused(()=>pinPc(A,pc1.id,true),/verified/i,'pinning unreviewed content');
  const v=await reviewPc(A2,pc1.id,'verify');assert.equal(v.status,'VERIFIED');assert.equal(v.reviewed_by,A2);
  await reviewPc(A,pc2.id,'verify');
  await pinPc(A,pc1.id,true);await pinPc(A,pc2.id,true);
  const pins=(await as(A,'select id from public.prospect_public_content where prospect_id=$1 and pinned',[prA])).rows.map(r=>r.id);assert.deepEqual(pins,[pc2.id]);
  const rj=await reviewPc(A,pc2.id,'reject');assert.equal(rj.status,'REJECTED');assert.equal(rj.pinned,false);
 });
 await check('OUTREACH references: public_content_ids must be VERIFIED content of the same prospect and tenant; signal_ids VERIFIED signals',async()=>{
  const ok=await insertOutreach(A,{prospect:prA,pcs:[pc1.id]});assert.deepEqual(ok.public_content_ids,[pc1.id]);
  await as(A,`update public.outreach set status='DISCARDED' where id=$1`,[ok.id]);
  await refused(()=>insertOutreach(A,{prospect:prA,pcs:[pc2.id]}),/public content/i,'rejected content');
  await refused(()=>insertOutreach(A,{prospect:prA2,pcs:[pc1.id]}),/public content/i,'another prospect’s content');
  const pcB=await savePc(B,prB,{...ITEM,content:'contenu B'});await reviewPc(B,pcB.id,'verify');
  await refused(()=>insertOutreach(A,{prospect:prA,pcs:[pcB.id]}),/public content/i,'another tenant’s content');
  await refused(()=>insertOutreach(A,{prospect:prA,sigs:[U(77)]}),/signal/i,'an unknown signal');
 });
 await check('FIT/INTENT data untouched: adding, verifying, pinning, rejecting and deleting public content changes no evidence, signal or prospect row',async()=>{
  await as(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at) values($1,$2,'need_fit',true,'NOT_VERIFIED','https://kerlan.example/a','Kerlan exploite trois sites.',now())`,[oa,prA]);
  await as(A,'select public.save_signals($1,null,$2::jsonb)',[prA,JSON.stringify([{provider:'user_provided',signal_type:'hiring_role',title:'Kerlan recrute',excerpt:'Kerlan recrute un RSSI.',source_url:'https://jobs.example/k',source_type:'user_provided',observed_at:'2026-10-05T09:00:00Z',content_hash:h('k'),event_key:'hiring_role:rssi'}])]);
  const snap=async()=>JSON.stringify((await sql(`select (select coalesce(json_agg(e order by e.id),'[]') from public.evidence e where e.prospect_id=$1) ev,(select coalesce(json_agg(s order by s.id),'[]') from public.signals s where s.prospect_id=$1) sg,(select row_to_json(p) from public.prospects p where p.id=$1) pr`,[prA])).rows[0]);
  const s0=await snap();
  const pc3=await savePc(A,prA,{...ITEM,content:'Troisième publication.'});await reviewPc(A,pc3.id,'verify');await pinPc(A,pc3.id,true);await reviewPc(A,pc3.id,'reject');
  await as(A,'select public.delete_public_content($1)',[pc3.id]);
  assert.equal(await snap(),s0);
  assert.equal((await as(A,'select count(*)::int n from public.prospect_public_content where id=$1',[pc3.id])).rows[0].n,0,'deleted');
 });
 await check('GRANTS: anon reads nothing and calls no function; every new table has RLS',async()=>{
  await refused(()=>as(undefined,'select * from public.prospect_public_content'),/permission denied/i,'anon read');
  await refused(()=>as(undefined,'select public.save_public_content($1,$2::jsonb)',[prA,'{}']),/permission denied/i,'anon RPC');
  const rls=(await sql(`select relname,relrowsecurity from pg_class where relname in ('outreach_style_profiles','prospect_public_content') order by relname`)).rows;
  assert.deepEqual(rls.map(r=>[r.relname,r.relrowsecurity]),[['outreach_style_profiles',true],['prospect_public_content',true]]);
 });
}finally{
 for(const [n,s,m] of results)console.log(`${s.padEnd(4)}  ${n}${m?` — ${m}`:''}`);
 const failed=results.filter(r=>r[1]!=='PASS').length;
 console.log(`\nOUTREACH INTELLIGENCE DB: ${results.length-failed}/${results.length} checks passed`);
 await db.close();if(failed)process.exitCode=1;
}
