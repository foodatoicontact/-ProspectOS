// Self-Outreach booking link and meetings (migration 037) — the composer, the link validation, the API routes and their
// gates. No database (tests/outreach-booking-meetings-db.mjs covers the SQL), no socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateBookingReply,checkBookingText,normalizeBookingUrl,BOOKING_GENERATOR} from '../src/self-outreach/booking.ts';
import {handleSelfOutreach} from '../src/self-outreach/api.ts';

const LINK='https://cal.example/kevin/echange';
const IN={contactName:'Claire Martin',senderName:'Kevin Cardia',bookingUrl:LINK,originalSubject:'Acme : une question sur votre prospection',company:'Acme'};

test('booking link: https, a host, URL characters only, no trailing punctuation, no credentials or port',()=>{
 for(const ok of [LINK,'https://calendly.com/kevin-cardia/30min','https://cal.com/kevin?duration=20'])assert.equal(normalizeBookingUrl(ok),ok,ok);
 assert.equal(normalizeBookingUrl(`  ${LINK}  `),LINK,'trimmed');
 for(const bad of ['http://cal.example/kevin','https://cal.example/kevin.','https://cal.example/a b','https://user:pw@cal.example/x','https://cal.example:8443/x',
  'javascript:alert(1)','https://cal.example/<script>','ftp://cal.example/x','',null,42])assert.equal(normalizeBookingUrl(bad),null,String(bad));
});
test('booking reply: thanks, the link, an alternative, the opt-out line; in the original thread; no fact, number or offer',()=>{
 const r=generateBookingReply(IN);assert.equal(r.ok,true);if(!r.ok)return;
 assert.equal(r.subject,'Re: Acme : une question sur votre prospection');
 assert.ok(r.text.startsWith('Bonjour Claire,'));assert.ok(r.text.includes(LINK));assert.match(r.text,/répondez simplement STOP/);
 assert.doesNotMatch(r.text,/\d/,'no number at all');assert.doesNotMatch(r.text,/gratuit|essai|urgent|j.esp[eè]re que vous allez bien/i);
 assert.equal(generateBookingReply({...IN,originalSubject:'Re: Acme'}).ok&&(generateBookingReply({...IN,originalSubject:'Re: Acme'}) as any).subject,'Re: Acme','no "Re: Re:"');
 assert.deepEqual(generateBookingReply({...IN,bookingUrl:'http://cal.example/x'}),{ok:false,reason:'BOOKING_URL_INVALID'});
 assert.equal(BOOKING_GENERATOR,'self_outreach_booking_v1');
});
test('booking edit: keeps the link, adds no other URL, number, unsourced fact or forbidden formula',()=>{
 const who={company:'Acme',contactName:'Claire Martin',senderName:'Kevin Cardia'};
 assert.deepEqual(checkBookingText(`Bonjour Claire, merci ! Choisissez un créneau ici : ${LINK}`,who,LINK),{ok:true});
 assert.equal((checkBookingText('Bonjour Claire, merci pour votre retour, parlons-en bientôt.',who,LINK) as any).reason,'BOOKING_LINK_MISSING');
 assert.equal((checkBookingText(`Bonjour Claire, voici ${LINK} ou https://evil.example/x`,who,LINK) as any).reason,'FACT_GUARD_UNSUPPORTED_URL');
 assert.equal((checkBookingText(`Bonjour Claire, ${LINK} : un échange de 20 minutes suffit.`,who,LINK) as any).reason,'FACT_GUARD_UNSUPPORTED_NUMBER');
 assert.notEqual(checkBookingText(`Bonjour Claire, profitez de notre essai gratuit : ${LINK}`,who,LINK).ok,true,'free offer');
});

// ------------------------------------------------------------ API
const ORG='4f802de0-fabe-4e89-93bc-3ed63257a74f',OTHER='11111111-1111-4111-8111-111111111111',ID='22222222-2222-4222-8222-222222222222';
const ENV={SELF_OUTREACH_ENABLED:'true',SELF_OUTREACH_ORG_IDS:ORG,OUTREACH_FROM_NAME:'Kevin Cardia',OUTREACH_FROM_EMAIL:'sales@prospectos.example'};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
// A fake client: every row belongs to `org`; the candidate has a campaign link (or not); RPC calls are recorded.
function fakeDb(org:string|null,o:{link?:string|null;rpc?:(fn:string,a:any)=>any}={}){
 const calls:[string,any][]=[];
 const row={organization_id:org,id:ID,candidate_id:ID,kind:'INITIAL',generated_content:'x',human_edit:null,prospects:{name:'Acme'},outreach_contacts:{contact_name:'Claire Martin'},
  outreach_campaigns:{booking_url:o.link===undefined?LINK:o.link},outreach_messages:[{sequence:0,subject:'Acme : une question sur votre prospection'}]};
 const q:any={select:()=>q,eq:()=>q,order:()=>q,in:()=>q,limit:()=>q,maybeSingle:async()=>({data:org?row:null}),single:async()=>({data:row,error:null}),then:(r:any)=>r({data:[],error:null})};
 return {calls,db:{from:()=>q,rpc:async(fn:string,a:any)=>{calls.push([fn,a]);return {data:o.rpc?o.rpc(fn,a):{ok:true},error:null}}} as any};
}
const call=(f:ReturnType<typeof fakeDb>,path:string[],body:any={},method='POST')=>handleSelfOutreach(new Request('http://x/api',{method}),path,body,f.db,json,{env:ENV,now:()=>new Date('2026-10-26T12:00:00Z'),requireEntitlement:async()=>{}});

test('API: every new route is refused to an organization the server does not serve',async()=>{
 for(const path of [['self-outreach','candidates',ID,'booking'],['self-outreach','candidates',ID,'meetings'],['self-outreach','meetings',ID,'status'],['self-outreach','campaigns',ID,'booking']]){
  const f=fakeDb(OTHER);const r=await call(f,path,{});assert.equal(r!.status,403,path.join('/'));assert.equal(f.calls.length,0,'no RPC');
 }
});
test('API: campaign link validated before the database; null clears it',async()=>{
 const f=fakeDb(ORG);
 assert.equal((await call(f,['self-outreach','campaigns',ID,'booking'],{booking_url:'http://cal.example/x'}))!.status,422);
 assert.equal((await call(f,['self-outreach','campaigns',ID,'booking'],{booking_url:LINK}))!.status,200);
 assert.equal((await call(f,['self-outreach','campaigns',ID,'booking'],{booking_url:null}))!.status,200);
 assert.deepEqual(f.calls.map(c=>c[1].p_booking_url),[LINK,null]);
 assert.equal((await call(f,['self-outreach','campaigns',ID,'booking'],{booking_url:LINK,extra:1}))!.status,400,'strict body');
});
test('API: POSITIVE drafts the booking reply at once; another outcome does not; no link is reported, never an error',async()=>{
 const f=fakeDb(ORG,{rpc:fn=>fn==='create_outreach_booking_reply'?{id:'m3',kind:'BOOKING'}:{ok:true}});
 const r=await (await call(f,['self-outreach','candidates',ID,'outcome'],{outcome:'POSITIVE'}))!.json();
 assert.equal(r.booking.status,'DRAFTED');
 const created=f.calls.find(c=>c[0]==='create_outreach_booking_reply')![1];assert.ok(created.p_content.includes(LINK));assert.match(created.p_subject,/^Re: /);
 const g=fakeDb(ORG);await call(g,['self-outreach','candidates',ID,'outcome'],{outcome:'OBJECTION'});
 assert.deepEqual(g.calls.map(c=>c[0]),['set_outreach_outcome'],'no booking for another outcome');
 const n=fakeDb(ORG,{link:null});const rn=await call(n,['self-outreach','candidates',ID,'outcome'],{outcome:'POSITIVE'});
 assert.equal(rn!.status,200,'the outcome is kept');assert.equal((await rn!.json()).booking.status,'NO_LINK');
 assert.equal((await call(fakeDb(ORG,{link:null}),['self-outreach','candidates',ID,'booking'],{}))!.status,409);
});
test('API: meetings take an ISO date with offset and a closed list of statuses',async()=>{
 const f=fakeDb(ORG);
 assert.equal((await call(f,['self-outreach','candidates',ID,'meetings'],{scheduled_for:'demain 14h'}))!.status,400);
 assert.equal((await call(f,['self-outreach','candidates',ID,'meetings'],{scheduled_for:'2026-10-28T14:00:00.000Z'}))!.status,201);
 assert.equal((await call(f,['self-outreach','meetings',ID,'status'],{status:'SCHEDULED'}))!.status,400);
 assert.equal((await call(f,['self-outreach','meetings',ID,'status'],{status:'HELD'}))!.status,200);
 assert.deepEqual(f.calls.map(c=>c[0]),['record_outreach_meeting','set_outreach_meeting_status']);
});
test('nothing new can send: the booking module and routes never build a transport; one daily job, behind the send flag',async()=>{
 for(const f of ['src/self-outreach/booking.ts','src/self-outreach/api.ts','src/components/SelfOutreachPanel.tsx'])
  assert.doesNotMatch(await readFile(new URL(`../${f}`,import.meta.url),'utf8'),/createSmtpTransport|nodemailer/,f);
 // The daily job is the only path that can send, and only behind SELF_OUTREACH_SEND_ENABLED (tests/self-outreach.test.ts).
 assert.equal(JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8')).crons.filter((c:any)=>c.path==='/api/cron/self-outreach').length,1);
});

// ------------------------------------------------------------ "Préparer un envoi" (POST projects/:id/prepare)
function prepDb(o:{signalStatus?:string;signalProject?:string;campaigns?:any[];contacts?:any[]}={}){
 const calls:[string,any][]=[];
 const tables:Record<string,any>={signals:{id:ID,prospect_id:'33333333-3333-4333-8333-333333333331',project_id:o.signalProject??ID,status:o.signalStatus??'VERIFIED'},projects:{organization_id:ORG}};
 const q=(t:string)=>{const self:any={select:()=>self,eq:()=>self,order:()=>self,in:()=>self,limit:()=>self,
  maybeSingle:async()=>({data:{organization_id:ORG}}),single:async()=>({data:tables[t]??{organization_id:ORG},error:null}),
  then:(r:any)=>r({data:t==='outreach_campaigns'?(o.campaigns??[]):t==='outreach_contacts'?(o.contacts??[]):[],error:null})};return self};
 return {calls,db:{from:(t:string)=>q(t),rpc:async(fn:string,a:any)=>{calls.push([fn,a]);return {data:{id:fn==='create_outreach_campaign'?'camp1':'c1'},error:null}}} as any};
}
const prep=(f:ReturnType<typeof prepDb>,body:any)=>handleSelfOutreach(new Request('http://x/api',{method:'POST'}),['self-outreach','projects',ID,'prepare'],body,f.db,json,{env:ENV,now:()=>new Date('2026-10-26T12:00:00Z'),requireEntitlement:async()=>{}});
const NEW={prospect_id:'33333333-3333-4333-8333-333333333331',contact_name:'Claire Martin',contact_role:'CEO',role_source_url:'https://acme.example/equipe',email:'claire@acme.example',email_source:'company_website',
 email_source_url:'https://acme.example/contact',email_source_excerpt:'Écrire à claire@acme.example'};
test('prepare: a generic or free-webmail address is refused with a readable reason, before any write',async()=>{
 for(const [email,code] of [['contact@acme.example','EMAIL_ROLE_MAILBOX'],['claire.martin@gmail.com','EMAIL_NOT_PROFESSIONAL']]){
  const f=prepDb();const r=await prep(f,{signal_id:ID,contact:{...NEW,email,email_source_excerpt:`Écrire à ${email}`}});
  assert.equal(r!.status,422);const j=await r!.json();assert.equal(j.code,code);assert.doesNotMatch(j.error,/EMAIL_/,'a sentence, not a code');assert.equal(f.calls.length,0,'nothing written');
 }
 const f=prepDb();const r=await prep(f,{signal_id:ID,contact:{...NEW,email_source_excerpt:'Écrire à la direction'}});
 assert.equal((await r!.json()).code,'EMAIL_NOT_IN_SOURCE');assert.equal(f.calls.length,0);
});
test('prepare: the signal must be VERIFIED and of this project; contact_id XOR a new contact',async()=>{
 assert.equal((await (await prep(prepDb({signalStatus:'PENDING_REVIEW'}),{signal_id:ID,contact:NEW}))!.json()).code,'OUTREACH_SIGNAL_NOT_VERIFIED');
 assert.equal((await prep(prepDb({signalProject:'11111111-1111-4111-8111-111111111111'}),{signal_id:ID,contact:NEW}))!.status,409);
 assert.equal((await prep(prepDb(),{signal_id:ID}))!.status,400,'no contact at all');
 assert.equal((await prep(prepDb(),{signal_id:ID,contact_id:ID,contact:NEW}))!.status,400,'both');
 assert.equal((await (await prep(prepDb(),{signal_id:ID,contact:{...NEW,prospect_id:'33333333-3333-4333-8333-333333333332'}}))!.json()).code,'OUTREACH_SIGNAL_NOT_OF_COMPANY','contact of another company');
});
test('prepare: the first time creates the project campaign (follow-ups after five days) and the contact; later ones reuse them',async()=>{
 const f=prepDb();await prep(f,{signal_id:ID,contact:NEW});
 const fns=f.calls.map(c=>c[0]);assert.ok(fns.includes('add_outreach_contact'));
 const camp=f.calls.find(c=>c[0]==='create_outreach_campaign');assert.ok(camp,'campaign created');assert.equal(camp![1].p_followup_enabled,true);assert.equal(camp![1].p_followup_delay_days,5);
 const g=prepDb({campaigns:[{id:'existing',status:'ACTIVE'}],contacts:[{id:'c0',prospect_id:'33333333-3333-4333-8333-333333333331'}]});await prep(g,{signal_id:ID,contact:NEW});
 assert.ok(!g.calls.some(c=>c[0]==='create_outreach_campaign'),'campaign reused');assert.ok(!g.calls.some(c=>c[0]==='add_outreach_contact'),'contact reused');
 const h=prepDb({contacts:[{id:'c9',prospect_id:'33333333-3333-4333-8333-33333333333f'}]});const r=await prep(h,{signal_id:ID,contact:NEW});
 assert.equal((await r!.json()).code,'OUTREACH_CONTACT_OTHER_COMPANY');
 assert.equal(f.calls.filter(c=>/send|claim/.test(c[0])).length,0,'nothing is sent');
});
