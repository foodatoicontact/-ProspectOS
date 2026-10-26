// Migration 037 — booking link and meetings on real PostgreSQL (PGlite), full migration chain. A booking reply is only
// drafted after a reply a person marked POSITIVE, needs the campaign's CURRENT link in the approved text, is re-checked
// at claim and right before SMTP, threads on the prospect's own reply, never consumes the daily cap of new outreach, and
// is cancelled by any other outcome or by an opt-out. Meetings need a real reply, are recorded by a person, one
// SCHEDULED at a time, HELD / NO_SHOW only once past; HELD sets the DEMO milestone; metrics add meetings and 30 days
// without changing an existing key. Tenant isolation as in 035. Fictitious companies, .example domains. Nothing is sent.
// Run: node tests/outreach-booking-meetings-db.mjs
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
const LINK='https://cal.example/kevin/echange';
const BOOKING_TEXT=(link=LINK)=>`Bonjour Claire,\n\nMerci pour votre retour.\n\nVous pouvez choisir directement un créneau ici : ${link}\n\nSi vous ne souhaitez plus recevoir de message de ma part, répondez simplement STOP.`;

try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 assert.ok(files.includes('037_outreach_booking_meetings.sql'),'migration 037 present');
 for(const f of files)await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/migrations/checks/035_self_outreach.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../db/migrations/checks/037_outreach_booking_meetings.sql',import.meta.url),'utf8'));

 const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const A=U(1),B=U(2);
 for(const [u,e] of [[A,'a@t'],[B,'b@t']])await sql(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`,[u,e]);
 const oa=(await as(A,`select public.create_organization('ProspectOS') id`)).rows[0].id,ob=(await as(B,`select public.create_organization('Other') id`)).rows[0].id;
 const pa=(await as(A,`insert into public.projects(organization_id,name,offer) values($1,'Self','ProspectOS aide les équipes commerciales à choisir quels comptes contacter, et pourquoi maintenant.') returning id`,[oa])).rows[0].id;
 await sql('reset role');await sql('insert into prospectos_private.self_outreach_organizations(organization_id) values($1)',[oa]);
 const prospect=async(name)=>(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,$3,$4) returning id`,[oa,pa,name,`https://${name.toLowerCase()}.example`])).rows[0].id;
 const signal=async(pr)=>{const ex=`${pr} recrute son premier SDR pour construire le pipeline outbound.`;
  const id=(await owner(A,`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,published_at,confidence,content_hash,event_key)
   values($1,$2,$3,'web_search','hiring_role','Offre SDR',$4,$5,'job_board',now(),now()-interval '2 days',0.8,$6,$7) returning id`,[oa,pa,pr,ex,`https://jobs.example/${h(ex).slice(0,8)}`,h(ex),`hiring:${h(ex).slice(0,6)}`])).rows[0].id;
  await as(A,`select public.review_signal($1,'verify',null)`,[id]);return id};
 const evidence=async(pr)=>(await owner(A,`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at,verified_by) values($1,$2,'target_fit',true,'VERIFIED','https://x.example/a','Éditeur SaaS B2B.',now()-interval '1 day',$3) returning id`,[oa,pr,A])).rows[0].id;
 const contact=async(pr,email)=>(await as(A,`select public.add_outreach_contact($1,'Claire Martin','CEO','https://x.example/team',$2,'company_website','https://x.example/team',$3) c`,[pr,email,`Contact : ${email}`])).rows[0].c;
 const camp=(await as(A,`select public.create_outreach_campaign($1,'V1',true,3) c`,[pa])).rows[0].c;
 const SCORES=JSON.stringify({fit:82,intent:10,timing:86,evidence_quality:70,outreach:80,threshold:75,signal_type:'HIRING_SDR',config_version:'self-outreach-v1',explanation:{lines:[]}});
 const MSG=JSON.stringify({subject:'ACME : une question sur votre prospection',generated_content:'Bonjour Claire, j’ai lu ceci : « ACME recrute son premier SDR ». Partant pour en parler ?',evidence_refs:{},generation_meta:{generator:'test'}});
 const cand=async cid=>one(sql(`select * from public.outreach_candidates where id=$1`,[cid]));
 const msg=async(cid,seq)=>one(sql(`select * from public.outreach_messages where candidate_id=$1 and sequence=$2`,[cid,seq]));
 const approve=(mid)=>as(A,`select public.review_outreach_message($1,'APPROVE',null,null,'prospectos.example') r`,[mid]);
 const claim=(cap=10,limit=20)=>service(`select public.claim_outreach_sends($1::uuid[],'sales@prospectos.example',$2,$3,60) r`,[[oa],limit,cap]).then(r=>r.rows[0].r);
 const complete=(m,result,code=null)=>service(`select public.complete_outreach_send($1,$2,$3,'prov-1',$4,60) r`,[m.message_id,m.lease_token,result,code]);
 const drain=async()=>{for(const m of await claim(500,50))await complete(m,'SENT')};
 const setLink=(url)=>as(A,`select public.set_outreach_campaign_booking($1,$2) r`,[camp.id,url]);
 const draft=(cid,text=BOOKING_TEXT())=>as(A,`select public.create_outreach_booking_reply($1,'Re: ACME : une question sur votre prospection',$2) r`,[cid,text]).then(r=>r.rows[0].r);
 const outcome=(cid,o)=>as(A,`select public.set_outreach_outcome($1,$2,null)`,[cid,o]);
 // A candidate whose initial message was SENT, then answered (In-Reply-To: our Message-ID) with the given Message-ID.
 let seq=0;
 const replied=async(name,o={})=>{
  await drain();
  const pr=await prospect(name),ev=await evidence(pr),s=await signal(pr),c=await contact(pr,`claire@${name.toLowerCase()}.example`);
  const k=(await as(A,`select public.create_outreach_candidate($1,$2,$3,$4::uuid[],$5::jsonb,$6::jsonb) r`,[camp.id,c.id,s,[ev],SCORES,MSG])).rows[0].r;
  await approve(k.message_id);const mine=(await claim()).filter(x=>x.message_id===k.message_id);assert.equal(mine.length,1,'initial claimed');await complete(mine[0],'SENT');
  const rfc=(await msg(k.candidate.id,0)).rfc_message_id;const key=`<reply-${++seq}@mail.example>`;
  if(o.reply!==false)await service(`select public.record_outreach_inbound($1::jsonb)`,[JSON.stringify({mailbox_key:key,from_email:c.email,subject:'Re',in_reply_to:rfc,references_ids:[rfc],
   received_at:new Date().toISOString(),auto_submitted:false,is_dsn:false,body_excerpt:'Oui volontiers, avec plaisir',proposed_outcome:'POSITIVE'})]);
  return {id:k.candidate.id,email:c.email,rfc,replyKey:key};
 };

 await check('A — booking link: https only, no trailing punctuation, members of a served organization only',async()=>{
  for(const bad of ['http://cal.example/kevin','https://cal.example/kevin.','javascript:alert(1)','https://cal.example/a b','https://cal.example/<x>'])
   await refused(()=>setLink(bad),/check constraint|violates/,bad);
  await refused(()=>as(B,`select public.set_outreach_campaign_booking($1,$2)`,[camp.id,LINK]),/member required|not_allowed/i,'another organization');
  assert.equal((await setLink(LINK)).rows[0].r.booking_url,LINK);
  assert.equal((await one(sql(`select booking_url from public.outreach_campaigns where id=$1`,[camp.id]))).booking_url,LINK);
 });
 await check('B — no booking draft without a REPLIED candidate marked POSITIVE, without the link, or for a suppressed address',async()=>{
  const k=await replied('Alpha');
  await refused(()=>draft(k.id),/outreach_candidate_not_bookable/,'no outcome yet');
  await outcome(k.id,'NEUTRAL');await refused(()=>draft(k.id),/outreach_candidate_not_bookable/,'neutral');
  await outcome(k.id,'POSITIVE');
  await refused(()=>draft(k.id,'Bonjour Claire, merci pour votre retour, je vous propose un échange cette semaine.'),/outreach_booking_link_missing/,'text without the link');
  await refused(()=>draft(k.id,`Bonjour, profitez de notre essai gratuit : ${LINK}`),/outreach_text_refused/,'free trial');
  const sent=await replied('Bravo',{reply:false});await outcome(sent.id,'POSITIVE');await refused(()=>draft(sent.id),/outreach_candidate_not_bookable/,'sent but never replied');
  await setLink(null);await refused(()=>draft(k.id),/outreach_booking_url_missing/,'no link');await setLink(LINK);
  const d=await draft(k.id);assert.equal(d.kind,'BOOKING');assert.equal(d.sequence,3);assert.equal(d.send_status,'DRAFT');assert.equal(d.review_status,'PENDING');
  assert.equal((await draft(k.id)).already,true,'one draft per candidate');
  const s=await replied('Charlie');await outcome(s.id,'POSITIVE');await as(A,`select public.suppress_outreach_email($1,$2,'MANUAL')`,[pa,s.email]);
  await refused(()=>draft(s.id),/outreach_email_suppressed/,'suppressed');
 });
 await check('C — approved booking reply: claimed outside the daily cap, in the prospect’s thread, sent once; candidate stays REPLIED',async()=>{
  const k=await replied('Delta');await outcome(k.id,'POSITIVE');const d=await draft(k.id);
  assert.equal((await claim()).filter(x=>x.message_id===d.id).length,0,'unapproved booking claimed');
  await approve(d.id);const m=await msg(k.id,3);assert.equal(m.review_status,'APPROVED');assert.equal(m.send_status,'READY');assert.ok(m.final_content.includes(LINK));
  // Today's cap is already used up by new outreach: the booking reply still goes.
  await sql(`update public.outreach_daily_counters set sent=10`);
  const got=(await claim(10)).filter(x=>x.message_id===d.id);assert.equal(got.length,1,'booking claimed at the cap');
  assert.equal(got[0].kind,'BOOKING');assert.equal(got[0].in_reply_to,k.replyKey,'threaded on the prospect’s reply');
  assert.equal((await one(sql(`select slot_day from public.outreach_messages where id=$1`,[d.id]))).slot_day,null,'no daily slot used');
  assert.equal((await service(`select public.outreach_send_permitted($1,$2) p`,[got[0].message_id,got[0].lease_token])).rows[0].p,true);
  await complete(got[0],'SENT');
  assert.equal((await msg(k.id,3)).send_status,'SENT');const c=await cand(k.id);assert.equal(c.status,'REPLIED');assert.equal(c.outcome,'POSITIVE');
  await refused(()=>draft(k.id),/outreach_booking_already_sent/,'second booking after send');
  assert.equal((await claim()).filter(x=>x.message_id===d.id).length,0,'sent twice');
  await sql(`update public.outreach_daily_counters set sent=0`);
  const ev=(await sql(`select kind from public.outreach_events where candidate_id=$1 order by id`,[k.id])).rows.map(r=>r.kind);
  for(const e of ['booking.drafted','booking.approved','send.claimed','send.sent'])assert.ok(ev.includes(e),e);
 });
 await check('D — the approved text must carry the CURRENT link: a link changed after the draft blocks approval until edited',async()=>{
  const k=await replied('Echo');await outcome(k.id,'POSITIVE');const d=await draft(k.id);
  const NEW='https://cal.example/kevin/nouveau';await setLink(NEW);
  await refused(()=>approve(d.id),/outreach_booking_link_missing/,'stale link approved');
  await refused(()=>as(A,`select public.review_outreach_message($1,'EDIT',null,$2,null)`,[d.id,BOOKING_TEXT()]),/outreach_booking_link_missing/,'edit keeps the old link');
  await as(A,`select public.review_outreach_message($1,'EDIT',null,$2,null)`,[d.id,BOOKING_TEXT(NEW)]);await approve(d.id);
  // Changed again between approval and claim: cancelled at claim, never sent with a dead link.
  await setLink(LINK);const got=(await claim()).filter(x=>x.message_id===d.id);assert.equal(got.length,0);
  assert.equal((await msg(k.id,3)).send_status,'CANCELLED');
 });
 await check('E — another outcome cancels a pending booking reply; POSITIVE again re-opens it; re-checked right before SMTP',async()=>{
  const k=await replied('Foxtrot');await outcome(k.id,'POSITIVE');const d=await draft(k.id);
  await outcome(k.id,'OBJECTION');assert.equal((await msg(k.id,3)).send_status,'CANCELLED');
  await refused(()=>approve(d.id),/outreach_message_not_reviewable/,'cancelled approved');
  await outcome(k.id,'POSITIVE');const again=await draft(k.id);assert.equal(again.id,d.id,'same slot re-opened');assert.equal(again.send_status,'DRAFT');assert.equal(again.rfc_message_id,null);
  await approve(d.id);const [got]=(await claim()).filter(x=>x.message_id===d.id);assert.ok(got,'claimed');
  // The outcome changes after the claim: the check right before SMTP refuses.
  await sql(`update public.outreach_candidates set outcome='NOT_INTERESTED' where id=$1`,[k.id]);
  assert.equal((await service(`select public.outreach_send_permitted($1,$2) p`,[got.message_id,got.lease_token])).rows[0].p,false);
  await complete(got,'ABORTED','NOT_PERMITTED');
  await sql(`update public.outreach_candidates set outcome='POSITIVE' where id=$1`,[k.id]);
  // An opt-out stops it for good: cancelled, and the suppressed address is never claimed.
  await as(A,`select public.suppress_outreach_email($1,$2,'OPT_OUT')`,[pa,k.email]);
  assert.equal((await msg(k.id,3)).send_status,'CANCELLED');assert.equal((await claim()).filter(x=>x.message_id===d.id).length,0);
 });
 await check('F — new outreach keeps its daily cap: at the cap an INITIAL waits while a BOOKING reply behind it is claimed',async()=>{
  const k=await replied('Golf');await outcome(k.id,'POSITIVE');const d=await draft(k.id);await approve(d.id);
  const pr=await prospect('Hotel'),ev=await evidence(pr),s=await signal(pr),c=await contact(pr,'claire@hotel.example');
  const n=(await as(A,`select public.create_outreach_candidate($1,$2,$3,$4::uuid[],$5::jsonb,$6::jsonb) r`,[camp.id,c.id,s,[ev],SCORES,MSG])).rows[0].r;await approve(n.message_id);
  await sql(`update public.outreach_messages set scheduled_for=now()-interval '1 hour' where id=$1`,[n.message_id]); // the INITIAL comes first in the queue
  await sql(`update public.outreach_daily_counters set sent=10`);
  const got=await claim(10);assert.deepEqual(got.map(x=>x.kind),['BOOKING'],'only the booking reply');
  assert.equal((await msg(n.candidate.id,0)).send_status,'READY','initial waits for tomorrow');
  for(const x of got)await complete(x,'SENT');await sql(`update public.outreach_daily_counters set sent=0`);
 });
 await check('G — meetings: need a reply, bounded time, one SCHEDULED at a time, HELD / NO_SHOW once past, HELD → DEMO milestone',async()=>{
  const k=await replied('India');const silent=await replied('Juliet',{reply:false});
  const rec=(cid,iso)=>as(A,`select public.record_outreach_meeting($1,$2::timestamptz) r`,[cid,iso]).then(r=>r.rows[0].r);
  const st=(mid,s)=>as(A,`select public.set_outreach_meeting_status($1,$2) r`,[mid,s]);
  const at=d=>new Date(Date.now()+d*86400000).toISOString();
  await refused(()=>rec(silent.id,at(2)),/outreach_meeting_needs_reply/,'no reply');
  await refused(()=>rec(k.id,at(-90)),/outreach_meeting_invalid_time/,'too old');await refused(()=>rec(k.id,at(400)),/outreach_meeting_invalid_time/,'too far');
  const future=await rec(k.id,at(3));assert.equal(future.status,'SCHEDULED');
  await refused(()=>rec(k.id,at(4)),/outreach_meetings_one_scheduled|duplicate key/,'two scheduled');
  await refused(()=>st(future.id,'HELD'),/outreach_meeting_in_future/,'held in the future');
  await st(future.id,'CANCELLED');await refused(()=>st(future.id,'HELD'),/outreach_meeting_not_scheduled/,'held after cancel');
  const past=await rec(k.id,at(-1));await st(past.id,'HELD');
  const c=await cand(k.id);assert.equal(new Date(c.demo_at).toISOString(),new Date(past.scheduled_for).toISOString(),'demo_at = meeting time');
  const other=await replied('Kilo');const p2=await rec(other.id,at(-2));await st(p2.id,'NO_SHOW');assert.equal((await cand(other.id)).demo_at,null,'no-show is not a demo');
  await refused(()=>st(p2.id,'SCHEDULED'),/Invalid status/,'back to scheduled');
  const ev=(await sql(`select kind from public.outreach_events where candidate_id=$1 order by id`,[k.id])).rows.map(r=>r.kind);
  for(const e of ['meeting.scheduled','meeting.cancelled','meeting.held','milestone.demo'])assert.ok(ev.includes(e),e);
 });
 await check('H — metrics: every 035 key unchanged, plus meetings and last_30_days',async()=>{
  const x=(await as(A,`select public.outreach_metrics($1) m`,[pa])).rows[0].m;
  for(const key of ['discovered','qualified','needs_review','approved','rejected','sent','replied','positive','objection','not_interested','unsubscribe','bounce','demo','paid','by_signal_type','by_score_band'])
   assert.ok(key in x,key);
  assert.equal(x.meetings.held,1);assert.equal(x.meetings.no_show,1);assert.equal(x.meetings.cancelled,1);assert.equal(x.meetings.scheduled,0);
  assert.ok(x.last_30_days.sent>=10,'sent in 30 days');assert.ok(x.last_30_days.replied>=8);assert.ok(x.last_30_days.positive>=1);
  assert.equal(x.last_30_days.meetings_held,1);assert.equal(x.last_30_days.meetings_booked,2,'cancelled meetings are not booked');
  assert.equal(x.demo,1);
 });
 await check('I — tenant isolation: another organization reads no meeting and calls nothing; clients write no table directly',async()=>{
  const k=await replied('Lima');const mt=(await as(A,`select public.record_outreach_meeting($1,now()+interval '1 day') r`,[k.id])).rows[0].r;
  assert.equal((await as(B,`select count(*)::int n from public.outreach_meetings`)).rows[0].n,0,'B reads A’s meetings');
  assert.ok((await as(A,`select count(*)::int n from public.outreach_meetings`)).rows[0].n>=1);
  await refused(()=>as(B,`select public.record_outreach_meeting($1,now()+interval '2 day')`,[k.id]),/member required/i,'B records on A');
  await refused(()=>as(B,`select public.set_outreach_meeting_status($1,'CANCELLED')`,[mt.id]),/member required/i,'B cancels A’s meeting');
  await refused(()=>as(B,`select public.create_outreach_booking_reply($1,'Re: x',$2)`,[k.id,BOOKING_TEXT()]),/member required/i,'B drafts on A');
  await refused(()=>as(A,`insert into public.outreach_meetings(organization_id,project_id,candidate_id,scheduled_for) values($1,$2,$3,now())`,[oa,pa,k.id]),/permission denied/,'direct insert');
  await refused(()=>as(A,`update public.outreach_meetings set status='HELD'`),/permission denied/,'direct update');
  await refused(()=>as(undefined,`select count(*) from public.outreach_meetings`),/permission denied/,'anon read');
  // An organization removed from the database list does nothing more, even as its own member.
  await sql('reset role');await sql('delete from prospectos_private.self_outreach_organizations where organization_id=$1',[oa]);
  await refused(()=>as(A,`select public.set_outreach_meeting_status($1,'CANCELLED')`,[mt.id]),/self_outreach_org_not_allowed/,'not served');
  assert.equal((await as(A,`select count(*)::int n from public.outreach_meetings`)).rows[0].n,0,'not served: nothing readable');
  await sql('reset role');await sql('insert into prospectos_private.self_outreach_organizations(organization_id) values($1)',[oa]);
 });
 await check('J — re-applying 037 keeps every row and function (idempotent)',async()=>{
  const before=(await sql(`select (select count(*) from public.outreach_meetings)::int m,(select count(*) from public.outreach_messages where kind='BOOKING')::int b`)).rows[0];
  await db.exec(await readFile(new URL('../db/migrations/037_outreach_booking_meetings.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../db/migrations/checks/037_outreach_booking_meetings.sql',import.meta.url),'utf8'));
  assert.deepEqual((await sql(`select (select count(*) from public.outreach_meetings)::int m,(select count(*) from public.outreach_messages where kind='BOOKING')::int b`)).rows[0],before);
 });
}catch(e){results.push(['setup','FAIL',String(e?.message??e).split('\n')[0]])}
for(const [n,s,m] of results)console.log(`${s} ${n}${m?` — ${m}`:''}`);
const failed=results.filter(r=>r[1]!=='PASS').length;console.log(`OUTREACH BOOKING DB: ${results.length-failed}/${results.length} checks passed`);process.exit(failed?1:0);
