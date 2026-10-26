// Self-Outreach dry run — the whole pipeline on a local PostgreSQL (PGlite, every migration) with the real engine
// modules, a MOCK transport and a MOCK mailbox: SIGNAL → QUALIFICATION → CONTACT → MESSAGE → APPROVAL → QUEUE →
// MOCK SEND → MOCK REPLY → STOP. Fictitious company (.example). No network, no credential, no real email.
// Run: node --experimental-strip-types scripts/self-outreach-dry-run.ts
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {buildOpportunity,classifySignal,icpZoneOf,NBA_DEFAULT_CONFIG,type NbaSignal} from '../src/nba/engine.ts';
import {outreachScore,scoresPayload} from '../src/self-outreach/score.ts';
import {checkContact} from '../src/self-outreach/contact.ts';
import {generateInitial,generateFollowUp} from '../src/self-outreach/message.ts';
import {MockTransport} from '../src/self-outreach/transport.ts';
import {MockInbox} from '../src/self-outreach/inbox.ts';
import {processSendQueue,pollReplies,prepareFollowUps} from '../src/self-outreach/worker.ts';

const db=new PGlite();const sql=(t:string,p:unknown[]=[])=>db.query<any>(t,p);
const as=async(u:string,t:string,p:unknown[]=[])=>{await sql('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false)",[u]);await sql('set role authenticated');try{return await sql(t,p)}finally{await sql('reset role')}};
const rpc=async(fn:string,args:Record<string,unknown>)=>{await sql('reset role');await sql("select set_config('request.jwt.claim.sub','',false)");await sql('set role service_role');
 try{const keys=Object.keys(args);const r=await sql(`select public.${fn}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) r`,keys.map(k=>{const v=args[k];return v!==null&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v}));return r.rows[0].r}finally{await sql('reset role')}};
const step=(name:string,detail:unknown)=>console.log(`\n■ ${name}\n${typeof detail==='string'?detail:JSON.stringify(detail,null,1)}`);
const h=(t:string)=>createHash('sha256').update(t).digest('hex');

await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
for(const f of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(`../db/migrations/${f}`,import.meta.url),'utf8'));
const A='00000000-0000-4000-8000-000000000001';await sql(`insert into auth.users(id,email) values($1,'kevin@t')`,[A]);
const org=(await as(A,`select public.create_organization('ProspectOS') id`)).rows[0].id;
// The operator-held allow-list (docs/SELF_OUTREACH.md §8 step 2) — same insert an operator runs as the owner.
await sql(`insert into prospectos_private.self_outreach_organizations(organization_id,note) values($1,'dry run') on conflict (organization_id) do nothing`,[org]);
const OFFER='ProspectOS aide les équipes commerciales à identifier les comptes qui correspondent à leur cible et à documenter pourquoi les contacter maintenant.';
const project=(await as(A,`insert into public.projects(organization_id,name,offer) values($1,'Vendre ProspectOS',$2) returning id`,[org,OFFER])).rows[0].id;
const CRITERIA=[{key:'icp',label:'Éditeur SaaS B2B en France',weight:70,rules:{type:'target_fit',config:{locations:['France'],match:'any_defined'}}},{key:'team',label:'Équipe commerciale à construire',weight:30}];
await as(A,`insert into public.icps(organization_id,project_id,criteria) values($1,$2,$3::jsonb)`,[org,project,JSON.stringify(CRITERIA)]);
const pr=(await as(A,`insert into public.prospects(organization_id,project_id,name,website) values($1,$2,'Acmé Logiciels','https://acme.example') returning id`,[org,project])).rows[0].id;
for(const [k,ex] of [['icp','Acmé Logiciels édite un logiciel SaaS B2B, basé à Lyon.'],['team','Nous recrutons pour construire notre équipe commerciale.']])
 await sql(`insert into public.evidence(organization_id,prospect_id,criterion,value,status,source_url,excerpt,observed_at,verified_by) values($1,$2,$3,true,'VERIFIED','https://acme.example/a-propos',$4,now()-interval '3 days',$5)`,[org,pr,k,ex,A]);
const ex='Acmé Logiciels recrute son premier Account Executive pour construire le pipeline outbound.';
const sid=(await sql(`insert into public.signals(organization_id,project_id,prospect_id,provider,signal_type,title,excerpt,source_url,source_type,observed_at,published_at,confidence,content_hash,event_key,raw_metadata)
 values($1,$2,$3,'web_search','hiring_role','Premier Account Executive (H/F)',$4,'https://jobs.example/acme-ae','job_board',now(),now()-interval '2 days',0.8,$5,'hiring:acme-ae','{"geo":{"country":"FR","label":"Lyon"}}'::jsonb) returning id`,[org,project,pr,ex,h(ex)])).rows[0].id;
step('1 SIGNAL',{signal_id:sid,status:'PENDING_REVIEW → revue humaine'});
await as(A,`select public.review_signal($1,'verify',null)`,[sid]);

// QUALIFICATION — the NBA engine, unchanged, then the explainable outreach score.
const sig=(await sql(`select * from public.signals where id=$1`,[sid])).rows[0];
const nbaSig:NbaSignal={...sig,confidence:Number(sig.confidence),event_date:sig.event_date,published_at:sig.published_at?.toISOString?.()??sig.published_at,observed_at:sig.observed_at?.toISOString?.()??sig.observed_at,matched_terms:sig.matched_terms??[]};
const evidence=(await sql(`select * from public.evidence where prospect_id=$1`,[pr])).rows.map((e:any)=>({...e,observed_at:e.observed_at.toISOString()}));
const now=new Date();
const opp=buildOpportunity({prospect:{id:pr,project_id:project,name:'Acmé Logiciels',status:'À analyser'},criteria:CRITERIA as any,evidence,signals:[nbaSig],publicContent:[],profile:null,now});
const classified=classifySignal(nbaSig,now,NBA_DEFAULT_CONFIG,icpZoneOf(CRITERIA as any));
const score=outreachScore(opp,nbaSig,classified,75);
step('2 QUALIFICATION',{nba:`${opp.recommended_action} (${opp.rule})`,commercial_type:classified?.commercial_type,geo:classified?.geo.relevance,
 scores:{fit:score.fit,intent:score.intent,timing:score.timing,evidence_quality:score.evidence_quality,outreach:score.outreach,threshold:score.threshold,eligible_for_review:score.eligible},lines:score.explanation.lines.map(l=>`${l.component} ${l.value}×${l.weight}: ${l.why}`)});

// CONTACT — a guessed address is refused, a sourced one is accepted.
const guessed=checkContact({prospect_id:pr,contact_name:'Claire Martin',contact_role:'CEO',role_source_url:'https://acme.example/equipe',email:'claire.martin@acme.example',email_source:'company_website',email_source_url:'https://acme.example/equipe',email_source_excerpt:'Claire Martin, CEO et fondatrice'});
const sourced=checkContact({prospect_id:pr,contact_name:'Claire Martin',contact_role:'CEO',role_source_url:'https://acme.example/equipe',email:'claire.martin@acme.example',email_source:'company_website',email_source_url:'https://acme.example/contact',email_source_excerpt:'Partenariats et presse : claire.martin@acme.example'});
if(!sourced.ok)throw Error('contact');const k=sourced.contact;
const contact=(await as(A,`select public.add_outreach_contact($1,$2,$3,$4,$5,$6,$7,$8) c`,[pr,k.contact_name,k.contact_role,k.role_source_url,k.email,k.email_source,k.email_source_url,k.email_source_excerpt])).rows[0].c;
step('3 CONTACT',{guessed_pattern:guessed,accepted:{email:contact.email,email_source:contact.email_source,email_source_url:contact.email_source_url,email_verified_at:contact.email_verified_at}});

// MESSAGE
const msg=generateInitial({company:'Acmé Logiciels',contactName:contact.contact_name,offer:OFFER,senderName:'Kevin — ProspectOS',
 signal:{...nbaSig,published_at:nbaSig.published_at as string},commercialType:classified!.commercial_type,evidence:evidence.map((e:any)=>({id:e.id,excerpt:e.excerpt,status:e.status}))});
if(!msg.ok)throw Error(msg.reason);
step('4 MESSAGE',`Objet : ${msg.subject}\n\n${msg.text}\n\nrefs: ${JSON.stringify(msg.evidence_refs)}`);
const camp=(await as(A,`select public.create_outreach_campaign($1,'Premiers commerciaux',true,3) c`,[project])).rows[0].c;
const created=(await as(A,`select public.create_outreach_candidate($1,$2,$3,$4::uuid[],$5::jsonb,$6::jsonb) r`,[camp.id,contact.id,sid,msg.evidence_refs.evidence_ids,
 JSON.stringify(scoresPayload(score,classified!.commercial_type)),JSON.stringify({subject:msg.subject,generated_content:msg.text,evidence_refs:msg.evidence_refs,generation_meta:msg.generation_meta})])).rows[0].r;

// APPROVAL — nothing is claimable before.
const transport=new MockTransport();
const before=await processSendQueue({rpc,transport,organizationIds:[org],sender:'sales@prospectos.example',limit:5,dailyCap:10,log:()=>{}});
await as(A,`select public.review_outreach_message($1,'APPROVE',null,null,'prospectos.example')`,[created.message_id]);
const approved=(await sql(`select review_status,approved_by,approved_at,send_status,rfc_message_id from public.outreach_messages where id=$1`,[created.message_id])).rows[0];
step('5 APPROVAL',{claimable_before_approval:before.claimed,after:approved});

// QUEUE + MOCK SEND
const sends=await processSendQueue({rpc,transport,organizationIds:[org],sender:'sales@prospectos.example',limit:5,dailyCap:10,log:()=>{}});
step('6-7 QUEUE + MOCK SEND',{summary:sends,mock_sent:transport.sent.map(m=>({to:m.to,messageId:m.messageId})),again:(await processSendQueue({rpc,transport,organizationIds:[org],sender:'sales@prospectos.example',limit:5,dailyCap:10,log:()=>{}})).claimed});

// A follow-up becomes due (sent 4 days ago in this simulation) → a DRAFT awaiting approval, never sent by itself.
await sql(`update public.outreach_messages set sent_at=now()-interval '4 days' where id=$1`,[created.message_id]);
const fu=await prepareFollowUps({rpc,organizationIds:[org],log:()=>{},load:async()=>({company:'Acmé Logiciels',contactName:'Claire Martin',offer:OFFER,signal:nbaSig,evidence:[],commercialType:classified!.commercial_type}),
 generate:s=>generateFollowUp({...s,senderName:'Kevin — ProspectOS'})});

// MOCK REPLY → STOP
const inbox=new MockInbox([{mailbox_key:'<reply-1@acme.example>',from_email:'claire.martin@acme.example',subject:'Re: '+msg.subject,in_reply_to:approved.rfc_message_id,references_ids:[approved.rfc_message_id],
 received_at:now.toISOString(),auto_submitted:false,is_dsn:false,dsn_status:null,dsn_recipient:null,body_excerpt:'Oui volontiers, le sujet est d’actualité.\n\nLe 15 oct., Kevin a écrit :\n> répondez simplement STOP.'}]);
const replies=await pollReplies({rpc,inbox,sinceDays:7,limit:50,log:()=>{}});
const final=(await sql(`select status,reply_status from public.outreach_candidates where id=$1`,[created.candidate.id])).rows[0];
const messages=(await sql(`select sequence,kind,review_status,send_status from public.outreach_messages where candidate_id=$1 order by sequence`,[created.candidate.id])).rows;
const inbound=(await sql(`select match_method,proposed_outcome from public.outreach_inbound`)).rows;
const suppressed=(await sql(`select count(*)::int n from public.outreach_suppressions`)).rows[0].n;
step('8-9 MOCK REPLY → STOP',{followups_drafted_before_reply:fu,replies,candidate:final,messages,inbound,suppressions:suppressed,
 followups_due_after_reply:(await rpc('outreach_followups_due',{p_organization_ids:[org],p_limit:10})).length});
const events=(await sql(`select kind,from_status,to_status from public.outreach_events where candidate_id=$1 order by id`,[created.candidate.id])).rows.map((e:any)=>`${e.kind}${e.to_status?` → ${e.to_status}`:''}`);
step('AUDIT TRAIL',events.join('\n'));
const ok=before.claimed===0&&sends.sent===1&&transport.sent.length===1&&final.status==='REPLIED'&&messages.every((m:any)=>m.sequence===0||m.send_status==='CANCELLED')&&suppressed===0&&!guessed.ok;
console.log(`\nDRY RUN: ${ok?'PASS':'FAIL'} — real emails sent: 0`);process.exit(ok?0:1);
