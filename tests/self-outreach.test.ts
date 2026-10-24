// Self-Outreach — pure parts and orchestration with mocks (docs/SELF_OUTREACH.md). No socket is ever opened: the SMTP
// library is replaced by a fake, the mailbox by fixtures, the database by a recorded RPC. No real email is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selfOutreachEnabled,selfOutreachSendEnabled,smtpConfig,configurationReport,outreachScoreThreshold,maxNewOutreachPerDay,selfOutreachOrganizations} from '../src/self-outreach/config.ts';
import {createSmtpTransport,smtpTransportFrom,classifySmtpError,MockTransport} from '../src/self-outreach/transport.ts';
import {checkContact,roleRank} from '../src/self-outreach/contact.ts';
import {outreachScore,scoresPayload} from '../src/self-outreach/score.ts';
import {generateInitial,generateFollowUp,checkHumanEdit} from '../src/self-outreach/message.ts';
import {proposeOutcome,ownText,parseInbound,MockInbox} from '../src/self-outreach/inbox.ts';
import {processSendQueue,pollReplies,prepareFollowUps} from '../src/self-outreach/worker.ts';
import {handleSelfOutreach} from '../src/self-outreach/api.ts';
import {buildOpportunity,classifySignal,icpZoneOf,NBA_DEFAULT_CONFIG,type NbaSignal} from '../src/nba/engine.ts';

const SECRET='S3cr3t-Pa55w0rd!';
const ENV={SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_SEND_ENABLED:'true',OUTREACH_SMTP_HOST:'smtp.mail.example',OUTREACH_SMTP_PORT:'465',OUTREACH_SMTP_USER:'sales@prospectos.example',
 OUTREACH_SMTP_PASSWORD:SECRET,OUTREACH_FROM_EMAIL:'sales@prospectos.example',OUTREACH_FROM_NAME:'Kevin de ProspectOS'};

// ------------------------------------------------------------ flags & configuration
test('flags: OFF by default; SEND needs both flags; the send flag alone enables nothing',()=>{
 assert.equal(selfOutreachEnabled({}),false);assert.equal(selfOutreachSendEnabled({}),false);
 assert.equal(selfOutreachSendEnabled({SELF_OUTREACH_SEND_ENABLED:'true'}),false);
 assert.equal(selfOutreachSendEnabled({SELF_OUTREACH_ENABLED:'true'}),false);
 assert.equal(selfOutreachSendEnabled(ENV),true);
 assert.equal(outreachScoreThreshold({}),75);assert.equal(maxNewOutreachPerDay({}),10);assert.equal(maxNewOutreachPerDay({MAX_NEW_OUTREACH_PER_DAY:'99999'}),10,'out of range → default');
 assert.deepEqual(selfOutreachOrganizations({SELF_OUTREACH_ORG_IDS:'not-a-uuid, 4F802DE0-FABE-4E89-93BC-3ED63257A74F'}),['4f802de0-fabe-4e89-93bc-3ed63257a74f']);
});
test('configuration report and errors never carry a credential',()=>{
 const report=JSON.stringify(configurationReport(ENV));
 assert.doesNotMatch(report,new RegExp(SECRET));assert.doesNotMatch(report,/smtp\.mail\.example|sales@/);
 assert.equal(smtpConfig({...ENV,OUTREACH_SMTP_PORT:'587'})!.secure,false,'587 = STARTTLS required');
});
test('SEND disabled → no transport can be built, even with a complete SMTP configuration',async()=>{
 await assert.rejects(createSmtpTransport({...ENV,SELF_OUTREACH_SEND_ENABLED:'false'}),/SEND_DISABLED/);
 await assert.rejects(createSmtpTransport({...ENV,SELF_OUTREACH_ENABLED:'false'}),/SEND_DISABLED/);
 await assert.rejects(createSmtpTransport({...ENV,OUTREACH_SMTP_PASSWORD:''}),/SMTP_NOT_CONFIGURED/);
});

// ------------------------------------------------------------ SMTP (fake library: no socket)
const fakeNodemailer=(behaviour:(m:any)=>any,seen:any={})=>({createTransport:(o:any)=>{seen.options=o;return {sendMail:async(m:any)=>{seen.mail=m;return behaviour(m)},close:()=>{seen.closed=true}}}});
test('SMTP mock success: TLS enforced, Message-ID and List-Unsubscribe set, provider id stored',async()=>{
 const seen:any={};
 const t=smtpTransportFrom(smtpConfig(ENV)!,fakeNodemailer(()=>({messageId:'<p1@ionos>',accepted:['claire@acme.example'],rejected:[]}),seen));
 const r=await t.send({to:'claire@acme.example',subject:'ACME : une question',text:'Bonjour',messageId:'<m1@prospectos.example>'});
 assert.deepEqual(r,{kind:'SENT',providerMessageId:'<p1@ionos>'});
 assert.equal(seen.options.secure,true);assert.equal(seen.options.tls.rejectUnauthorized,true);assert.equal(seen.options.tls.minVersion,'TLSv1.2');
 assert.ok(seen.options.connectionTimeout&&seen.options.socketTimeout);assert.equal(seen.mail.messageId,'<m1@prospectos.example>');
 assert.match(seen.mail.headers['List-Unsubscribe'],/^<mailto:sales@prospectos\.example\?subject=STOP>$/);
});
test('SMTP mock failures are classified by where they happened; no server text, host or password leaks',async()=>{
 const err=(o:any)=>Object.assign(new Error(`Invalid login ${SECRET} smtp.mail.example`),o);
 const cases:[any,string][]=[[{code:'EAUTH',responseCode:535,command:'AUTH PLAIN'},'AUTH'],[{responseCode:550,command:'RCPT TO'},'BOUNCED'],[{responseCode:421,command:'MAIL FROM'},'RETRY'],
  [{responseCode:554,command:'DATA'},'FAILED'],[{code:'ETIMEDOUT',command:'DATA'},'UNCERTAIN'],[{code:'ECONNECTION',command:'CONN'},'RETRY'],[{},'UNCERTAIN']];
 for(const [e,kind] of cases){
  const t=smtpTransportFrom(smtpConfig(ENV)!,fakeNodemailer(()=>{throw err(e)}));
  const r=await t.send({to:'a@acme.example',subject:'x',text:'y',messageId:'<m@x.example>'});
  assert.equal(r.kind,kind,JSON.stringify(e));assert.doesNotMatch(JSON.stringify(r),new RegExp(`${SECRET}|smtp\\.mail|Invalid login`));
 }
 assert.equal(classifySmtpError({responseCode:450,command:'RCPT TO'}).kind,'RETRY');
});

// ------------------------------------------------------------ contacts: never guessed
const C={prospect_id:'p',contact_name:'Claire Martin',contact_role:'CEO',role_source_url:'https://acme.example/equipe',email:'claire.martin@acme.example',
 email_source:'company_website',email_source_url:'https://acme.example/contact',email_source_excerpt:'Écrivez à claire.martin@acme.example'};
test('email provenance: a guessed address is refused; only a sourced, professional, personal address passes',()=>{
 assert.equal(checkContact(C).ok,true);
 assert.deepEqual(checkContact({...C,email_source:'pattern'}),{ok:false,reason:'EMAIL_SOURCE_NOT_ALLOWED'});
 assert.deepEqual(checkContact({...C,email_source_excerpt:'Contact : hello@acme.example'}),{ok:false,reason:'EMAIL_NOT_IN_SOURCE'},'prenom.nom computed: not written anywhere');
 assert.deepEqual(checkContact({...C,email_source_url:null}),{ok:false,reason:'EMAIL_SOURCE_URL_REQUIRED'});
 assert.deepEqual(checkContact({...C,email:'contact@acme.example',email_source_excerpt:'contact@acme.example'}),{ok:false,reason:'EMAIL_ROLE_MAILBOX'});
 assert.deepEqual(checkContact({...C,email:'claire@gmail.com',email_source_excerpt:'claire@gmail.com'}),{ok:false,reason:'EMAIL_NOT_PROFESSIONAL'});
 assert.deepEqual(checkContact({...C,role_source_url:''}),{ok:false,reason:'ROLE_SOURCE_REQUIRED'},'no invented decision maker');
 assert.equal(checkContact({...C,email_source:'direct_exchange',email_source_url:null,email_source_excerpt:null}).ok,true);
 assert.ok(roleRank('VP Sales')<roleRank('CEO')&&roleRank('CEO')<roleRank('Partnerships')&&roleRank('Partnerships')<roleRank('Comptable'));
 assert.equal(roleRank('Head of Partnerships',['Partnerships']),0,'the role the signal names first wins');
});

// ------------------------------------------------------------ scoring
const NOW=new Date('2026-10-17T12:00:00Z');const daysAgo=(d:number)=>new Date(NOW.getTime()-d*86400000).toISOString();
const CRITERIA=[{key:'icp',label:'Éditeur SaaS B2B',weight:85,rules:{type:'target_fit' as const,config:{locations:['France'],match:'any_defined' as const}}},{key:'other',label:'Équipe de 10 à 200',weight:15}];
const EVID=[{id:'e1',criterion:'icp',value:true,status:'VERIFIED',source_url:'https://acme.example/a-propos',excerpt:'Éditeur SaaS B2B pour les équipes commerciales.',observed_at:daysAgo(5),verified_by:'u1'}];
const SIG=(o:Partial<NbaSignal>={}):NbaSignal=>({id:'s1',signal_type:'hiring_role',status:'VERIFIED',title:'ACME recrute son premier SDR',excerpt:'ACME recrute son premier SDR pour construire le pipeline outbound.',
 source_url:'https://jobs.example/acme-sdr',source_domain:'jobs.example',source_type:'job_board',confidence:0.8,event_date:null,published_at:daysAgo(2),observed_at:daysAgo(2),matched_terms:[],provider:'web_search',
 raw_metadata:{geo:{country:'FR',label:'Paris'}},...o});
const scoreOf=(sig:NbaSignal,evidence=EVID)=>{const o=buildOpportunity({prospect:{id:'p',project_id:'x',name:'ACME',status:'À analyser'},criteria:CRITERIA,evidence,signals:[sig],publicContent:[],profile:null,now:NOW});
 return outreachScore(o,sig,classifySignal(sig,NOW,NBA_DEFAULT_CONFIG,icpZoneOf(CRITERIA)),75)};
// Both criteria of the ICP documented by verified evidence (an excellent, fully documented account).
const FULL=[...EVID,{id:'e2',criterion:'other',value:true,status:'VERIFIED',source_url:'https://acme.example/equipe',excerpt:'Une équipe de 40 personnes.',observed_at:daysAgo(5),verified_by:'u1'}];
test('scoring: four explained components, OUTREACH 0–100, ≥ 75 = eligible for REVIEW only',()=>{
 const partial=scoreOf(SIG());assert.equal(partial.fit,85);assert.equal(partial.eligible,partial.outreach>=75,'the threshold alone decides once no gate applies');
 const s=scoreOf(SIG(),FULL as any);
 assert.deepEqual(s.explanation.lines.map(l=>l.component),['fit','timing','intent','evidence_quality']);
 for(const l of s.explanation.lines)assert.ok(l.why.length>10,l.component);
 assert.equal(s.outreach,Math.round(0.35*s.fit+0.30*s.timing+0.15*s.intent+0.20*s.evidence_quality));
 assert.ok(s.outreach>=75&&s.eligible,JSON.stringify(s));
 assert.equal(s.fit,100,'the verified FIT, as CONTACT reads it');
});
test('scoring gates: unverified signal, signal outside the zone, or no verified evidence are never eligible',()=>{
 const pending=scoreOf(SIG({status:'PENDING_REVIEW'}));assert.equal(pending.eligible,false);assert.ok(pending.gates.includes('SIGNAL_NOT_VERIFIED'));
 assert.ok(scoresPayload(pending,'HIRING_SDR').outreach<75,'stored under the threshold: never in the review queue');
 const abroad=scoreOf(SIG({raw_metadata:{geo:{country:'BE',label:'Bruxelles'}}}));assert.ok(abroad.gates.includes('SIGNAL_OUTSIDE_ICP_ZONE'));assert.equal(abroad.eligible,false);
 const noEvidence=scoreOf(SIG(),[]);assert.equal(noEvidence.fit,0);assert.equal(noEvidence.eligible,false);
});

// ------------------------------------------------------------ messages
const MI={company:'ACME',contactName:'Claire Martin',offer:'ProspectOS aide les équipes commerciales à identifier les comptes qui correspondent à leur cible et à documenter pourquoi les contacter maintenant.',
 senderName:'Kevin',signal:{id:'s1',title:'ACME recrute son premier SDR',excerpt:'ACME recrute son premier SDR pour construire le pipeline outbound.',source_url:'https://jobs.example/acme-sdr',
 source_domain:'jobs.example',event_date:null,published_at:'2026-10-15T08:00:00Z',status:'VERIFIED'},commercialType:'HIRING_FIRST_SALES' as const,evidence:[{id:'e1',excerpt:'Éditeur SaaS B2B.',status:'VERIFIED'}]};
test('message: signal → problem → ProspectOS → low-friction CTA → opt-out; every quote sourced; refs stored',()=>{
 const m=generateInitial(MI);assert.ok(m.ok,JSON.stringify(m));if(!m.ok)return;
 const parts=m.text.split('\n\n');
 assert.match(parts[0]!,/^Bonjour Claire,$/);
 assert.match(parts[1]!,/^J’ai lu ceci \(jobs\.example, 15 octobre 2026\) : « ACME recrute son premier SDR pour construire le pipeline outbound »\.$/);
 assert.ok(m.text.includes(MI.offer));assert.match(m.text,/je peux vous montrer comment nous l’abordons/);assert.match(m.text,/répondez simplement STOP\.$/);
 assert.doesNotMatch(m.text,/gratuit|free|essai|bêta|beta|j’espère que vous allez bien|bravo|félicitations/i);
 assert.deepEqual(m.evidence_refs,{signal_ids:['s1'],evidence_ids:['e1'],source_urls:['https://jobs.example/acme-sdr']});
 assert.equal(m.generation_meta.generator,'self_outreach_rule_v1');
 assert.ok(m.text.length<1200);
});
test('message: unverified signal, a free-trial offer or flattery → no message (never a weaker one)',()=>{
 assert.deepEqual(generateInitial({...MI,signal:{...MI.signal,status:'PENDING_REVIEW'}}),{ok:false,reason:'SIGNAL_NOT_VERIFIED'});
 const trial=generateInitial({...MI,offer:'ProspectOS, avec un essai gratuit de quatorze jours pour toutes les équipes.'});assert.equal(trial.ok,false);
 assert.equal(checkHumanEdit('Bonjour Claire, bravo pour cette superbe annonce, je suis sûr que vous allez cartonner.',MI).ok,false);
});
test('unsupported claim protection: a human edit may not add a fact the sources do not say',()=>{
 assert.deepEqual(checkHumanEdit('Bonjour Claire, j’ai vu que ACME vient de lever des fonds, félicitations. Partant pour en parler ?',MI).ok,false);
 assert.equal(checkHumanEdit('Bonjour Claire, j’ai vu que ACME a 45 commerciaux. Partant pour en parler ?',MI).ok,false);
 assert.equal(checkHumanEdit('Bonjour Claire, j’ai lu ceci : « ACME recrute son premier SDR ». Partant pour en parler ?',MI).ok,true);
 const f=generateFollowUp(MI);assert.ok(f.ok);if(f.ok)assert.doesNotMatch(f.text,/«/,'a follow-up adds no new fact');
});

// ------------------------------------------------------------ replies (IMAP fixtures)
test('reply classification is proposed, conservative, and never reads the quoted original',()=>{
 const reply=(t:string)=>proposeOutcome({is_dsn:false,dsn_status:null,auto_submitted:false,subject:'Re: ACME',body_excerpt:t});
 assert.equal(reply('Oui volontiers, appelons-nous jeudi.').outcome,'POSITIVE');
 assert.equal(reply('Merci mais pas intéressé.').outcome,'NOT_INTERESTED');
 assert.equal(reply('STOP').outcome,'UNSUBSCRIBE');assert.equal(reply('Merci de me désinscrire.').outcome,'UNSUBSCRIBE');
 assert.equal(reply('Nous avons déjà un outil pour ça.').outcome,'OBJECTION');
 const quoted='Bien reçu, je regarde.\n\nLe 15 oct. 2026, Kevin <sales@prospectos.example> a écrit :\n> Si vous ne souhaitez plus recevoir de message, répondez simplement STOP.';
 assert.equal(ownText(quoted),'Bien reçu, je regarde.');assert.notEqual(reply(quoted).outcome,'UNSUBSCRIBE');
 assert.equal(proposeOutcome({is_dsn:false,dsn_status:null,auto_submitted:true,subject:'Absence',body_excerpt:'Je suis absent'}).outcome,'UNKNOWN');
});
test('parseInbound: reply headers and a delivery status notification',async()=>{
 const raw=['From: Claire <claire@acme.example>','To: sales@prospectos.example','Subject: Re: ACME','Message-ID: <r1@acme.example>','In-Reply-To: <m1@prospectos.example>',
  'References: <m1@prospectos.example>','Date: Thu, 16 Oct 2026 09:00:00 +0200','Content-Type: text/plain; charset=utf-8','','Oui volontiers.','','> ancien message'].join('\r\n');
 const r=await parseInbound(raw,'imap:1:1');
 assert.equal(r.from_email,'claire@acme.example');assert.equal(r.in_reply_to,'<m1@prospectos.example>');assert.deepEqual(r.references_ids,['<m1@prospectos.example>']);
 assert.equal(r.body_excerpt,'Oui volontiers.');assert.equal(r.is_dsn,false);assert.equal(r.mailbox_key,'<r1@acme.example>');
 const dsn=['From: Mail Delivery System <mailer-daemon@mail.example>','To: sales@prospectos.example','Subject: Undelivered','Message-ID: <d1@mail.example>',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="b"','','--b','Content-Type: text/plain','','Delivery failed.','--b','Content-Type: message/delivery-status','',
  'Final-Recipient: rfc822; claire@gone.example','Action: failed','Status: 5.1.1','--b--'].join('\r\n');
 const d=await parseInbound(dsn,'imap:1:2');
 assert.equal(d.is_dsn,true);assert.equal(d.dsn_status,'5.1.1');assert.equal(d.dsn_recipient,'claire@gone.example');
});

// ------------------------------------------------------------ worker orchestration (recorded RPC, mock transport)
const recorder=(answers:Record<string,(a:any)=>any>)=>{const calls:[string,any][]=[];return {calls,rpc:async(fn:string,args:any)=>{calls.push([fn,args]);return answers[fn]?.(args)}}};
const CLAIMED=(n:number)=>Array.from({length:n},(_,i)=>({message_id:`m${i}`,lease_token:`t${i}`,to_email:`c${i}@acme.example`,subject:'S',content:'Bonjour',rfc_message_id:`<m${i}@p.example>`,kind:'INITIAL',in_reply_to:null}));
test('send queue: checked right before SMTP; not permitted → nothing sent; results completed; idempotent keys passed',async()=>{
 const r=recorder({claim_outreach_sends:()=>CLAIMED(2),outreach_send_permitted:a=>a.p_message_id==='m0'});
 const t=new MockTransport();
 const s=await processSendQueue({rpc:r.rpc,transport:t,organizationIds:['o'],sender:'sales@p.example',limit:5,dailyCap:10,log:()=>{}});
 assert.equal(t.sent.length,1);assert.equal(t.sent[0]!.messageId,'<m0@p.example>');
 assert.deepEqual(s,{claimed:2,sent:1,retry:0,failed:0,bounced:0,uncertain:0,aborted:0,not_permitted:1,stopped:null});
 const completes=r.calls.filter(c=>c[0]==='complete_outreach_send').map(c=>[c[1].p_message_id,c[1].p_result]);
 assert.deepEqual(completes,[['m0','SENT'],['m1','ABORTED']]);
});
test('send queue: an authorization error stops the batch (fail closed); a throwing transport is UNCERTAIN, never retried',async()=>{
 const r=recorder({claim_outreach_sends:()=>CLAIMED(3),outreach_send_permitted:()=>true});
 const t=new MockTransport([{kind:'AUTH',code:'SMTP_AUTH'}]);
 const s=await processSendQueue({rpc:r.rpc,transport:t,organizationIds:['o'],sender:'s@p.example',limit:5,dailyCap:10,log:()=>{}});
 assert.equal(s.stopped,'SMTP_AUTH');assert.equal(t.sent.length,0);
 assert.deepEqual(r.calls.filter(c=>c[0]==='complete_outreach_send').map(c=>c[1].p_result),['ABORTED','ABORTED','ABORTED']);
 assert.equal(r.calls.filter(c=>c[0]==='outreach_send_permitted').length,1,'no further attempt after AUTH');
 const r2=recorder({claim_outreach_sends:()=>CLAIMED(1),outreach_send_permitted:()=>true});
 await processSendQueue({rpc:r2.rpc,transport:{name:'x',send:async()=>{throw Error('boom')},close:async()=>{}},organizationIds:['o'],sender:'s@p.example',limit:5,dailyCap:10,log:()=>{}});
 assert.equal(r2.calls.find(c=>c[0]==='complete_outreach_send')![1].p_result,'UNCERTAIN');
 const r3=recorder({});
 assert.equal((await processSendQueue({rpc:r3.rpc,transport:new MockTransport(),organizationIds:[],sender:'s@p.example',limit:5,dailyCap:10,log:()=>{}})).stopped,'NOTHING_ALLOWED');
 assert.equal(r3.calls.length,0,'no organization: not even a claim');
});
test('reply polling: each mail recorded once with its proposed outcome; follow-ups drafted only when generated safely',async()=>{
 const r=recorder({record_outreach_inbound:a=>({match_method:a.p.in_reply_to?'IN_REPLY_TO':'NONE'})});
 const inbox=new MockInbox([{mailbox_key:'<r1@x>',from_email:'claire@acme.example',subject:'Re',in_reply_to:'<m1@p.example>',references_ids:[],received_at:null,auto_submitted:false,is_dsn:false,dsn_status:null,dsn_recipient:null,body_excerpt:'STOP'}]);
 const s=await pollReplies({rpc:r.rpc,inbox,sinceDays:7,limit:50,log:()=>{}});
 assert.deepEqual(s,{read:1,recorded:1,duplicates:0,matched:1,errors:0});
 assert.equal(r.calls[0]![1].p.proposed_outcome,'UNSUBSCRIBE');
 const f=recorder({outreach_followups_due:()=>[{candidate_id:'k1'},{candidate_id:'k2'}]});
 const out=await prepareFollowUps({rpc:f.rpc,organizationIds:['o'],log:()=>{},load:async id=>id==='k1'?{company:'ACME',contactName:'Claire',offer:MI.offer,signal:MI.signal,evidence:[],commercialType:'HIRING_SDR'}:null,
  generate:s=>generateFollowUp({...s,senderName:'Kevin'})});
 assert.deepEqual(out,{due:2,drafted:1,refused:1});
 assert.equal(f.calls.filter(c=>c[0]==='create_outreach_followup').length,1);
});

// ------------------------------------------------------------ API gates
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const fakeDb=(org:string|null)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:org?{organization_id:org}:null}),
 single:async()=>({data:{id:'m',candidate_id:'k',generated_content:'x',human_edit:null},error:null})})})}),rpc:async()=>({data:{status:'APPROVED'},error:null})}) as any;
const call=(env:any,path:string[],org:string|null,body:any={},method='POST')=>handleSelfOutreach(new Request('http://x/api',{method}),path,body,fakeDb(org),json,{env,now:()=>NOW,requireEntitlement:async()=>{}});
test('API: flag OFF → 404; organization not allowed → 403; config never returns a secret',async()=>{
 assert.equal((await call({},['self-outreach','config'],null,{},'GET'))!.status,404);
 const ORG='4f802de0-fabe-4e89-93bc-3ed63257a74f',OTHER='11111111-1111-4111-8111-111111111111',MID='22222222-2222-4222-8222-222222222222';
 const env={...ENV,SELF_OUTREACH_ORG_IDS:ORG};
 assert.equal((await call(env,['self-outreach','messages',MID,'review'],OTHER,{decision:'APPROVE'}))!.status,403);
 assert.equal((await call(env,['self-outreach','messages',MID,'review'],ORG,{decision:'APPROVE'}))!.status,200);
 const cfg=await (await call(env,['self-outreach','config'],null,{},'GET'))!.text();assert.doesNotMatch(cfg,new RegExp(SECRET));
 assert.equal((await call(env,['self-outreach','messages',MID,'review'],ORG,{decision:'SEND_NOW'}))!.status,400,'no "send" decision exists');
 assert.equal(await call(env,['next-best-actions'],ORG),null,'other routes untouched');
});
test('no code path builds the real transport except the cron route, behind both flags',async()=>{
 const files=['src/self-outreach/api.ts','src/self-outreach/worker.ts','src/self-outreach/source.ts','src/self-outreach/message.ts','app/api/v1/[...path]/route.ts'];
 for(const f of files)assert.doesNotMatch(await readFile(new URL(`../${f}`,import.meta.url),'utf8'),/createSmtpTransport|nodemailer/,f);
 const cron=await readFile(new URL('../app/api/cron/self-outreach/route.ts',import.meta.url),'utf8');
 assert.match(cron,/if\(!selfOutreachSendEnabled\(process\.env\)\)out\.sends=\{skipped:'SEND_DISABLED'\}/);
 const vercel=await readFile(new URL('../vercel.json',import.meta.url),'utf8');assert.doesNotMatch(vercel,/self-outreach/,'not scheduled without approval');
});

test('merge with main — the fragments that other blocks’ byte-identical pins set aside are exactly the known ones',async()=>{
 const {withoutSelfOutreach}=await import('./self-outreach-strip.ts');
 const {readFileSync}=await import('node:fs');
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 const stripped=withoutSelfOutreach(page);
 assert.equal(page.length-stripped.length>300,true,'import, flag state x2, nav entry and panel are present');
 assert.ok(page.includes("<SelfOutreachPanel key={`so-${projectId}`}"));
 for(const f of ['../src/i18n/fr.ts','../src/i18n/en.ts'])assert.doesNotThrow(()=>withoutSelfOutreach(readFileSync(new URL(f,import.meta.url),'utf8')),f);
});

test('account flag — shown only to the organizations the routes serve (flag AND SELF_OUTREACH_ORG_IDS)',async()=>{
 const {selfOutreachEnabledFor}=await import('../src/self-outreach/config.ts');
 const ORG='4f802de0-fabe-4e89-93bc-3ed63257a74f',OTHER='be37bcbd-1ab9-4572-bcd4-91d3ac81a805';
 assert.equal(selfOutreachEnabledFor({SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_ORG_IDS:ORG},ORG),true);
 assert.equal(selfOutreachEnabledFor({SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_ORG_IDS:ORG},` ${ORG.toUpperCase()} `),true);
 assert.equal(selfOutreachEnabledFor({SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_ORG_IDS:ORG},OTHER),false,'another customer');
 assert.equal(selfOutreachEnabledFor({SELF_OUTREACH_ENABLED:'true'},ORG),false,'empty list = none');
 assert.equal(selfOutreachEnabledFor({SELF_OUTREACH_ENABLED:'false',SELF_OUTREACH_ORG_IDS:ORG},ORG),false,'flag off');
 assert.equal(selfOutreachEnabledFor({SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_ORG_IDS:ORG},null),false);
 const route=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(route,/self_outreach_enabled:selfOutreachEnabledForAny\(process\.env,memberships\.map\(\(m:any\)=>m\.organization_id\)\),/);
 // An owner of the served organization who also joined another team (whose membership becomes the workspace) still sees it.
 const {selfOutreachEnabledForAny}=await import('../src/self-outreach/config.ts');
 const env={SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_ORG_IDS:ORG};
 assert.equal(selfOutreachEnabledForAny(env,[OTHER,ORG]),true,'served organization among the memberships');
 assert.equal(selfOutreachEnabledForAny(env,[OTHER]),false,'none served');
 assert.equal(selfOutreachEnabledForAny(env,[]),false);
 assert.equal(selfOutreachEnabledForAny({...env,SELF_OUTREACH_ENABLED:'false'},[ORG]),false,'flag off');
 assert.doesNotMatch(route,/selfOutreachEnabled\(process\.env\)/,'never the bare flag');
});

test('v2 shell — reached from the account menu (like Bêta Analytics), rendered by the same panel as the legacy screen',async()=>{
 const {viewTitle,navForView}=await import('../src/ui/v2/shell/nav.ts');
 assert.equal(viewTitle('outreach','fr'),'Outreach ProspectOS');assert.equal(viewTitle('outreach','en'),'ProspectOS outreach');
 assert.equal(navForView('outreach',{live:true,today:true,actions:true},'activity'),null,'no primary entry is current on this screen');
 const menu=await readFile(new URL('../src/ui/v2/shell/UserMenu.tsx',import.meta.url),'utf8');
 assert.match(menu,/\{live&&p\.selfOutreach&&<Item icon="contact" label=\{t\.selfOutreach\} onClick=\{act\(p\.selfOutreach\)\}\/>\}/,'live accounts the server allows only');
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.ok(page.includes(",selfOutreach:mode==='live'&&soOn?()=>{setV2Nav(null);setView('outreach');setFromList(false)}:null}}"),'v2 entry: same flag as the legacy one');
 // One panel for both shells: it lives in the shared workspace, which the v2 shell renders for a view without a v2 screen.
 const workspace=page.slice(page.indexOf(' const workspace=<>'),page.indexOf(' const overlays=<>'));
 assert.equal(workspace.split('<SelfOutreachPanel ').length-1,1);
 assert.ok(page.indexOf('<SelfOutreachPanel ')<page.indexOf(' if(v2){'),'defined before the v2 branch, never duplicated in it');
 const v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));
 assert.match(v2,/:undefined\}>\n  <div className=\{contentClass\}>\{banners\}\{workspace\}<\/div><\/Shell>/,'no v2 screen for outreach: the shared workspace');
});

test('035 is frozen as applied: its bytes are the ones the staging runner recorded',async()=>{
 const {createHash}=await import('node:crypto');
 const m=await readFile(new URL('../db/migrations/035_self_outreach.sql',import.meta.url),'utf8');
 // Recorded on Staging (supabase_migrations.schema_migrations, 2026-10-24): any edit makes the runner refuse to run.
 assert.equal(createHash('md5').update(m).digest('hex'),'981a5a5ea61ec390def9d66249f5ccd2');
 const doc=await readFile(new URL('../docs/SELF_OUTREACH.md',import.meta.url),'utf8');
 assert.match(doc,/No API role can do it: the table has no grant to `anon`, `authenticated` or\n   `service_role`/);
});
