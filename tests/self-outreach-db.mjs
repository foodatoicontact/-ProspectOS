// Migration 035 — Self-Outreach on real PostgreSQL (PGlite), full migration chain. Tenant isolation, RLS, provenance,
// human approval, suppression (opt-out, hard bounce, manual) checked at every step, duplicates, the atomic daily cap
// and claim, lease expiry → UNCERTAIN (never re-sent), bounded retry, idempotent inbound matching, reply → follow-ups
// stopped. Fictitious companies, .example domains. Nothing is sent: there is no transport here.
// Run: node --experimental-strip-types tests/self-outreach-db.mjs
import {strict as assert} from 'node:assert';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();const sql=(t,p=[])=>db.query(t,p);
async function as(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await sql(`set role ${user===undefined?'anon':'authenticated'}`);try{return await sql(text,params)}finally{await sql('reset role')}}
async function service(text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');try{return await sql(text,params)}finally{await sql('reset role')}}
async function owner(user,text,params=[]){await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[user]);return sql(text,params)}
const results=[];const check=async(n,f)=>{try{await f();results.push([n,'PASS',''])}catch(e){results.push([n,'FAIL',String(e?.message??e).split('\n')[0]])}};
async function refused(op,pattern,what){let msg=null;try{await op()}catch(e){msg=String(e.message)}if(msg===null)throw Error(`BYPASS: ${what}`);if(!pattern.test(msg))throw Error(`refused for the wrong reason (${what}): ${msg}`)}
const h=t=>createHash('sha256').update(t).digest('hex');
const one=async(q,p)=>(await q).rows[0];

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('035_self_outreach.sql'));
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/migrations/checks/035_self_outreach.sql',import.meta.url),'utf8'));

 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const oa=(await as(A,`select public.create_organization('ProspectOS') id`)).rows[0].id,ob=(await as(B,`select public.create_organization('Other') id`)).rows[0].id;
 const pa=(await as(A,`insert into public.projects(organization_id,name,offer) values($1,'Self','ProspectOS aide les équipes commerciales à choisir quels comptes contacter, et pourquoi maintenant.') returning id`,[oa])).rows[0].id;
 const pb=(await as(B,`insert into public.projects(organization_id,name) values($1,'P') returning id`,[ob])).rows[0].id;
 const prospect=async(name)=>(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,$3,$4) returning id`,[oa,pa,name,`https://${name.toLowerCase()}.example`])).rows[0].id;
 const signal=async(pr,status='VERIFIED')=>{const ex=`${pr} recrute son premier SDR pour construire le pipeline outbound.`;
  const id=(await owner(A,`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,published_at,confidence,content_hash,event_key)
   values($1,$2,$3,'web_search','hiring_role','Offre SDR',$4,$5,'job_board',now(),now()-interval '2 days',0.8,$6,$7) returning id`,[oa,pa,pr,ex,`https://jobs.example/${h(ex).slice(0,8)}`,h(ex),`hiring:${h(ex).slice(0,6)}`])).rows[0].id;
  if(status==='VERIFIED')await as(A,`select public.review_signal($1,'verify',null)`,[id]);return id};
 const evidence=async(pr)=>(await owner(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at,verified_by) values($1,$2,'target_fit',true,'VERIFIED','https://x.example/a','Éditeur SaaS B2B.',now()-interval '1 day',$3) returning id`,[oa,pr,A])).rows[0].id;
 const contact=async(pr,email,o={})=>(await as(A,`select public.add_outreach_contact($1,'Claire Martin','CEO','https://x.example/team',$2,$3,$4,$5) c`,
  [pr,email,o.source??'company_website',o.url===undefined?'https://x.example/team':o.url,o.excerpt===undefined?`Contact : ${email}`:o.excerpt])).rows[0].c;
 const camp=(await as(A,`select public.create_outreach_campaign($1,'V1',true,3) c`,[pa])).rows[0].c;
 const SCORES=(o=80)=>JSON.stringify({fit:82,intent:10,timing:86,evidence_quality:70,outreach:o,threshold:75,signal_type:'HIRING_SDR',config_version:'self-outreach-v1',explanation:{lines:[]}});
 const MSG=JSON.stringify({subject:'ACME : une question sur votre prospection',generated_content:'Bonjour Claire, j’ai lu ceci : « ACME recrute son premier SDR ». Partant pour en parler ?',evidence_refs:{},generation_meta:{generator:'test'}});
 const candidate=async(pr,email,o={})=>{const ev=await evidence(pr);const s=await signal(pr);const c=await contact(pr,email);
  const r=(await as(A,`select public.create_outreach_candidate($1,$2,$3,$4::uuid[],$5::jsonb,$6::jsonb) r`,[camp.id,c.id,s,[ev],SCORES(o.score),MSG])).rows[0].r;return {...r,contact:c,signal:s,prospect:pr}};
 const msgOf=async cid=>one(sql(`select * from public.outreach_messages where candidate_id=$1 and sequence=0`,[cid]));
 const cand=async cid=>one(sql(`select * from public.outreach_candidates where id=$1`,[cid]));
 const approve=(mid)=>as(A,`select public.review_outreach_message($1,'APPROVE',null,null,'prospectos.example') r`,[mid]);
 const claim=(cap=10,limit=10)=>service(`select public.claim_outreach_sends($1::uuid[],'sales@prospectos.example',$2,$3,60) r`,[[oa],limit,cap]).then(r=>r.rows[0].r);
 const complete=(m,result,code=null)=>service(`select public.complete_outreach_send($1,$2,$3,'prov-1',$4,60) r`,[m.message_id,m.lease_token,result,code]);

 await check('A — provenance: a guessed / unsourced email is refused (no "pattern" source, excerpt must write the address)',async()=>{
  const pr=await prospect('Guess');
  await refused(()=>contact(pr,'claire.martin@guess.example',{source:'pattern'}),/check constraint|violates/,'pattern source');
  await refused(()=>contact(pr,'claire.martin@guess.example',{excerpt:'Contact : hello@guess.example'}),/check constraint|violates/,'address not in excerpt');
  await refused(()=>contact(pr,'claire.martin@guess.example',{url:null}),/check constraint|violates/,'no source URL');
  const ok=await contact(pr,'claire.martin@guess.example');assert.equal(ok.email_verified_at,null,'never presented as verified');
 });
 await check('B — a candidate needs a VERIFIED signal of its company and VERIFIED evidence; ≥ threshold → NEEDS_REVIEW only',async()=>{
  const pr=await prospect('Acme');const c=await contact(pr,'claire@acme.example');const s=await signal(pr,'PENDING_REVIEW');
  await refused(()=>as(A,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb)`,[camp.id,c.id,s,SCORES(),MSG]),/outreach_signal_not_verified/,'pending signal');
  const other=await prospect('Other');const s2=await signal(other);
  await refused(()=>as(A,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb)`,[camp.id,c.id,s2,SCORES(),MSG]),/outreach_signal_not_of_company/,'foreign signal');
  const k=await candidate(await prospect('Bravo'),'claire@bravo.example');assert.equal(k.candidate.status,'NEEDS_REVIEW');
  const low=await candidate(await prospect('Lowco'),'claire@lowco.example',{score:60});assert.equal(low.candidate.status,'QUALIFIED');
  await refused(()=>approve(low.message_id),/outreach_candidate_not_in_review/,'below threshold approved');
 });
 await check('C — nothing is claimable without human approval; a rejected candidate never sends',async()=>{
  const k=await candidate(await prospect('Charlie'),'claire@charlie.example');
  assert.equal((await claim()).filter(x=>x.message_id===k.message_id).length,0,'unapproved claimed');
  await as(A,`select public.review_outreach_message($1,'REJECT',null,null,null)`,[k.message_id]);
  assert.equal((await cand(k.candidate.id)).status,'REJECTED');
  await refused(()=>approve(k.message_id),/outreach_message_not_reviewable/,'approve after reject');
  assert.equal((await claim()).filter(x=>x.message_id===k.message_id).length,0);
 });
 await check('D — approval is audited, locks the final text, gives the RFC Message-ID; forbidden offers are refused',async()=>{
  const k=await candidate(await prospect('Delta'),'claire@delta.example');
  await refused(()=>as(A,`select public.review_outreach_message($1,'EDIT',null,'Bonjour, profitez de notre essai gratuit de ProspectOS dès maintenant.',null)`,[k.message_id]),/outreach_text_refused/,'free trial edit');
  await as(A,`select public.review_outreach_message($1,'EDIT',null,'Bonjour Claire, j’ai lu ceci : « Delta recrute son premier SDR ». Partant pour en parler ?',null)`,[k.message_id]);
  await approve(k.message_id);
  const m=await msgOf(k.candidate.id);
  assert.equal(m.review_status,'APPROVED');assert.equal(m.approved_by,A);assert.ok(m.approved_at);assert.match(m.rfc_message_id,/^<[0-9a-f-]+@prospectos\.example>$/);
  assert.equal(m.final_content,m.human_edit);assert.equal((await cand(k.candidate.id)).status,'READY_TO_SEND');
  const ev=(await sql(`select kind from public.outreach_events where candidate_id=$1 order by id`,[k.candidate.id])).rows.map(r=>r.kind);
  for(const e of ['candidate.created','candidate.qualified','candidate.needs_review','message.edited','candidate.approved','candidate.ready_to_send'])assert.ok(ev.includes(e),e);
 });
 // Clear the queue built so far (everything approved is sent) so each check below counts its own messages.
 const drain=async()=>{for(const m of await claim(500,50))await complete(m,'SENT')};
 await check('E — atomic claim: a claimed message is never claimed twice; double completion is refused',async()=>{
  await drain();
  const k=await candidate(await prospect('Echo'),'claire@echo.example');await approve(k.message_id);
  const first=await claim();assert.equal(first.length,1);assert.equal((await claim()).length,0,'claimed twice');
  await complete(first[0],'SENT');
  await refused(()=>complete(first[0],'SENT'),/outreach_lease_lost/,'double completion');
  const m=await msgOf(k.candidate.id);assert.equal(m.send_status,'SENT');assert.ok(m.sent_at);assert.equal((await cand(k.candidate.id)).status,'SENT');
 });
 await check('F — daily cap, atomic: never more than the cap per day; failed sends give the slot back',async()=>{
  await drain();await sql(`delete from public.outreach_daily_counters`);
  const ks=[];for(const n of ['Fox1','Fox2','Fox3'])ks.push(await candidate(await prospect(n),`claire@${n.toLowerCase()}.example`));
  for(const k of ks)await approve(k.message_id);
  const got=await claim(2);assert.equal(got.length,2,'cap 2');assert.equal((await claim(2)).length,0,'over the cap');
  await complete(got[0],'FAILED','SMTP_550');
  assert.equal((await claim(2)).length,1,'slot given back');
 });
 await check('G — suppression wins everywhere: at approval, at claim, right before SMTP; opt-out stops pending messages',async()=>{
  await drain();await sql(`delete from public.outreach_daily_counters`);
  const k=await candidate(await prospect('Golf'),'claire@golf.example');await approve(k.message_id);
  const got=await claim();assert.equal(got.length,1);
  // Suppression arrives between claim and send: the pre-send check refuses.
  await as(A,`select public.suppress_outreach_email($1,'claire@golf.example','OPT_OUT')`,[pa]);
  assert.equal((await service(`select public.outreach_send_permitted($1,$2) p`,[got[0].message_id,got[0].lease_token])).rows[0].p,false);
  await complete(got[0],'ABORTED','NOT_PERMITTED');
  assert.equal((await claim()).length,0,'suppressed claimed');
  assert.equal((await msgOf(k.candidate.id)).send_status,'CANCELLED');
  // Never recontacted by a future campaign.
  const camp2=(await as(A,`select public.create_outreach_campaign($1,'V2',false,5) c`,[pa])).rows[0].c;
  await refused(()=>as(A,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb)`,[camp2.id,k.contact.id,k.signal,SCORES(),MSG]),/outreach_email_suppressed/,'new campaign');
  const g2=await prospect('Golf2');await refused(()=>contact(g2,'claire@golf.example'),/outreach_email_suppressed|duplicate|unique/,'re-add suppressed');
 });
 await check('H — hard bounce at send → BOUNCED + global HARD_BOUNCE suppression',async()=>{
  await drain();
  const k=await candidate(await prospect('Hotel'),'claire@hotel.example');await approve(k.message_id);
  const [m]=await claim();await complete(m,'BOUNCED','SMTP_550');
  assert.equal((await cand(k.candidate.id)).status,'BOUNCED');
  assert.equal((await one(sql(`select reason from public.outreach_suppressions where email='claire@hotel.example'`))).reason,'HARD_BOUNCE');
 });
 await check('I — duplicates: same company or contact twice in a campaign, or one contact active twice, are refused',async()=>{
  const pr=await prospect('India');const k=await candidate(pr,'claire@india.example');
  await refused(()=>as(A,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb)`,[camp.id,k.contact.id,k.signal,SCORES(),MSG]),/duplicate|unique/,'same contact');
  const c2=(await as(A,`select public.add_outreach_contact($1,'Paul Durand','CTO','https://x.example/team','paul@india.example','company_website','https://x.example/team','paul@india.example') c`,[pr])).rows[0].c;
  await refused(()=>as(A,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb)`,[camp.id,c2.id,k.signal,SCORES(),MSG]),/duplicate|unique/,'same company');
  const camp3=(await as(A,`select public.create_outreach_campaign($1,'V3',false,5) c`,[pa])).rows[0].c;
  await refused(()=>as(A,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb)`,[camp3.id,k.contact.id,k.signal,SCORES(),MSG]),/duplicate|unique/,'active elsewhere');
 });
 await check('J — retry is bounded; a lost lease becomes UNCERTAIN and is never re-sent',async()=>{
  await drain();await sql(`delete from public.outreach_daily_counters`);
  const k=await candidate(await prospect('Juliet'),'claire@juliet.example');await approve(k.message_id);
  for(let i=0;i<3;i++){await sql(`update public.outreach_messages set next_attempt_at=null where candidate_id=$1`,[k.candidate.id]);const [m]=await claim();assert.ok(m,`attempt ${i}`);await complete(m,'RETRY','SMTP_421')}
  assert.equal((await msgOf(k.candidate.id)).send_status,'FAILED','third retry ends FAILED');
  const k2=await candidate(await prospect('Kilo'),'claire@kilo.example');await approve(k2.message_id);
  const [m2]=await claim();await sql(`update public.outreach_messages set lease_until=now()-interval '1 second' where id=$1`,[m2.message_id]);
  assert.equal((await claim()).length,0);
  assert.equal((await msgOf(k2.candidate.id)).send_status,'UNCERTAIN');
  await refused(()=>complete(m2,'SENT'),/outreach_lease_lost/,'late completion');
 });
 await check('K — reply matching: In-Reply-To → REPLIED + follow-ups stopped; idempotent; sender-only → NEEDS_REVIEW; ambiguous → all NEEDS_REVIEW',async()=>{
  await drain();
  const k=await candidate(await prospect('Lima'),'claire@lima.example');await approve(k.message_id);const [m]=await claim();await complete(m,'SENT');
  await service(`select public.create_outreach_followup($1,'Lima : relance','Bonjour Claire, je reviens simplement vers vous au sujet de mon message.', '{}'::jsonb,'{}'::jsonb)`,[k.candidate.id]);
  const rfc=(await msgOf(k.candidate.id)).rfc_message_id;
  const inbound={mailbox_key:'<r1@mail.example>',from_email:'claire@lima.example',subject:'Re',in_reply_to:rfc,references_ids:[rfc],received_at:new Date().toISOString(),auto_submitted:false,is_dsn:false,body_excerpt:'Oui volontiers',proposed_outcome:'POSITIVE'};
  const r=(await service(`select public.record_outreach_inbound($1::jsonb) r`,[JSON.stringify(inbound)])).rows[0].r;assert.equal(r.match_method,'IN_REPLY_TO');
  const c=await cand(k.candidate.id);assert.equal(c.status,'REPLIED');assert.equal(c.reply_status,'REPLIED');
  assert.equal((await one(sql(`select send_status from public.outreach_messages where candidate_id=$1 and sequence=1`,[k.candidate.id]))).send_status,'CANCELLED','follow-up stopped');
  assert.equal((await service(`select public.record_outreach_inbound($1::jsonb) r`,[JSON.stringify(inbound)])).rows[0].r.duplicate,true,'idempotent');
  assert.ok((await one(sql(`select email_verified_at from public.outreach_contacts where id=$1`,[k.contact.id]))).email_verified_at,'a reply proves the address');
  // Sender only, one candidate: possible reply → NEEDS_REVIEW, never REPLIED on the sender alone.
  const k2=await candidate(await prospect('Mike'),'claire@mike.example');await approve(k2.message_id);const [m2]=await claim();await complete(m2,'SENT');
  const r2=(await service(`select public.record_outreach_inbound($1::jsonb) r`,[JSON.stringify({...inbound,mailbox_key:'<r2@mail.example>',from_email:'claire@mike.example',in_reply_to:null,references_ids:[]})])).rows[0].r;
  assert.equal(r2.match_method,'SENDER_UNIQUE');const c2=await cand(k2.candidate.id);assert.equal(c2.status,'SENT');assert.equal(c2.reply_status,'NEEDS_REVIEW');
  await refused(()=>service(`select public.create_outreach_followup($1,'x relance','Bonjour, je reviens simplement vers vous au sujet de mon message.','{}'::jsonb,'{}'::jsonb)`,[k2.candidate.id]),/outreach_candidate_not_followable/,'follow-up after possible reply');
  const r3=(await service(`select public.record_outreach_inbound($1::jsonb) r`,[JSON.stringify({...inbound,mailbox_key:'<r3@mail.example>',from_email:'stranger@nowhere.example',in_reply_to:'<unknown@x>',references_ids:[]})])).rows[0].r;
  assert.equal(r3.match_method,'NONE');
  // Ambiguous: the same sender is the contact of two sent outreaches (here in two organizations) → both NEEDS_REVIEW.
  const prB=(await as(B,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Zulu','https://zulu.example') returning id`,[ob,pb])).rows[0].id;
  const exB='Zulu recrute son premier SDR pour le pipeline.';
  const sB=(await owner(B,`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,published_at,confidence,content_hash,event_key)
   values($1,$2,$3,'web_search','hiring_role','Offre SDR',$4,'https://jobs.example/zulu','job_board',now(),now(),0.8,$5,'hiring:zulu') returning id`,[ob,pb,prB,exB,h(exB)])).rows[0].id;
  await as(B,`select public.review_signal($1,'verify',null)`,[sB]);
  const campB=(await as(B,`select public.create_outreach_campaign($1,'Campagne B',true,3) c`,[pb])).rows[0].c;
  const cB=(await as(B,`select public.add_outreach_contact($1,'Claire Martin','CEO','https://x.example/team','claire@mike.example','company_website','https://x.example/team','claire@mike.example') c`,[prB])).rows[0].c;
  const kB=(await as(B,`select public.create_outreach_candidate($1,$2,$3,'{}'::uuid[],$4::jsonb,$5::jsonb) r`,[campB.id,cB.id,sB,SCORES(),MSG])).rows[0].r;
  await as(B,`select public.review_outreach_message($1,'APPROVE',null,null,'b.example')`,[kB.message_id]);
  const [mB]=(await service(`select public.claim_outreach_sends(array[$1]::uuid[],'s@b.example',5,10,60) r`,[ob])).rows[0].r;
  await service(`select public.complete_outreach_send($1,$2,'SENT',null,null,null)`,[mB.message_id,mB.lease_token]);
  const r4=(await service(`select public.record_outreach_inbound($1::jsonb) r`,[JSON.stringify({...inbound,mailbox_key:'<r4@mail.example>',from_email:'claire@mike.example',in_reply_to:null,references_ids:[]})])).rows[0].r;
  assert.equal(r4.match_method,'AMBIGUOUS');
  assert.equal((await one(sql(`select reply_status from public.outreach_candidates where id=$1`,[kB.candidate.id]))).reply_status,'NEEDS_REVIEW');
  assert.equal((await one(sql(`select organization_id from public.outreach_inbound where mailbox_key='<r4@mail.example>'`))).organization_id,null,'an ambiguous mail is attached to no tenant');
 });
 await check('L — DSN 5.x.x → BOUNCED + suppression; reply proposing UNSUBSCRIBE → global OPT_OUT',async()=>{
  await drain();
  const k=await candidate(await prospect('November'),'claire@november.example');await approve(k.message_id);const [m]=await claim();await complete(m,'SENT');
  await service(`select public.record_outreach_inbound($1::jsonb)`,[JSON.stringify({mailbox_key:'<dsn1@mail.example>',from_email:'mailer-daemon@mail.example',is_dsn:true,dsn_status:'5.1.1',dsn_recipient:'claire@november.example',references_ids:[],proposed_outcome:'BOUNCE'})]);
  assert.equal((await cand(k.candidate.id)).status,'BOUNCED');
  assert.equal((await one(sql(`select reason from public.outreach_suppressions where email='claire@november.example'`))).reason,'HARD_BOUNCE');
  const k2=await candidate(await prospect('Oscar'),'claire@oscar.example');await approve(k2.message_id);const [m2]=await claim();await complete(m2,'SENT');
  await service(`select public.record_outreach_inbound($1::jsonb)`,[JSON.stringify({mailbox_key:'<u1@mail.example>',from_email:'claire@oscar.example',in_reply_to:(await msgOf(k2.candidate.id)).rfc_message_id,references_ids:[],proposed_outcome:'UNSUBSCRIBE'})]);
  assert.equal((await one(sql(`select reason from public.outreach_suppressions where email='claire@oscar.example'`))).reason,'OPT_OUT');
 });
 await check('M — tenant isolation and RLS: another organization reads nothing and writes nothing; clients cannot write tables',async()=>{
  const k=await candidate(await prospect('Papa'),'claire@papa.example');
  for(const t of ['outreach_candidates','outreach_messages','outreach_contacts','outreach_campaigns','outreach_events'])
   assert.equal((await as(B,`select count(*)::int n from public.${t} where organization_id=$1`,[oa])).rows[0].n,0,t);
  await refused(()=>as(B,`select public.review_outreach_message($1,'APPROVE',null,null,'x.example')`,[k.message_id]),/member|denied|not allowed|42501/i,'foreign approve');
  await refused(()=>as(B,`select public.create_outreach_campaign($1,'X',false,5)`,[pa]),/member|denied|42501/i,'foreign campaign');
  await refused(()=>as(A,`update public.outreach_messages set send_status='READY' where id=$1`,[k.message_id]),/permission denied/,'client update');
  await refused(()=>as(A,`select count(*) from public.outreach_suppressions`),/permission denied/,'read suppressions');
  await refused(()=>as(A,`select public.claim_outreach_sends(array[$1]::uuid[],'s@x.example',5,10,60)`,[oa]),/permission denied/,'member claims');
  await refused(()=>as(A,`select public.record_outreach_inbound('{}'::jsonb)`),/permission denied/,'member inbound');
  await refused(()=>as(undefined,`select public.outreach_is_suppressed('a@b.example')`),/permission denied|Authentication/,'anon');
  // The org allowlist of the claim: organization B's approved messages are never claimed for A's sender.
  assert.ok((await service(`select public.claim_outreach_sends(array[$1]::uuid[],'s@x.example',5,10,60) r`,[ob])).rows[0].r.length===0);
 });
 await check('N — outcome UNSUBSCRIBE by a person → suppression; metrics funnel counts',async()=>{
  const k=await candidate(await prospect('Quebec'),'claire@quebec.example');
  await as(A,`select public.set_outreach_outcome($1,'UNSUBSCRIBE',null)`,[k.candidate.id]);
  assert.equal((await one(sql(`select reason from public.outreach_suppressions where email='claire@quebec.example'`))).reason,'OPT_OUT');
  const x=(await as(A,`select public.outreach_metrics($1) m`,[pa])).rows[0].m;
  assert.ok(x.sent>=1&&x.replied>=1&&x.bounce>=1&&x.unsubscribe>=1,JSON.stringify(x));assert.ok(x.by_signal_type.HIRING_SDR);assert.ok(x.by_score_band['75-89']);
 });
}catch(e){results.push(['setup','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,m] of results)console.log(`${s} ${n}${m?` — ${m}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;console.log(`SELF OUTREACH DB: ${results.length-failed}/${results.length} checks passed`);process.exit(failed?1:0);
