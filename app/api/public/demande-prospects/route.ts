import {randomUUID} from 'node:crypto';
import {PROSPECT_REQUEST_TO,createThrottle,notificationMail,parseProspectRequest} from '../../../../src/domain/prospect-request';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {createAdminClient} from '../../../../src/server/admin-client';
import {hitForAddress} from '../../../../src/server/rate-limit';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';

// "3 prospects de votre zone" (src/domain/prospect-request.ts). Owner decision (26 nov. 2026): the request is stored for the
// administrator's cockpit (public.contact_requests through the server function submit_contact_request, migration 056;
// deleted after 12 months) and emailed to ProspectOS's own mailbox: the recipient is a constant, nothing is ever sent to the
// requester. It reuses the SMTP configuration of the self-outreach engine for this single internal notification; the
// prospecting transport itself stays behind its two flags in the cron route. Same-origin form posts only, small bodies, a
// honeypot, a burst throttle. Answered as received when it was stored or emailed (either is enough to answer it).
export const dynamic='force-dynamic';
export const runtime='nodejs';
const throttle=createThrottle({max:5,windowMs:60*60*1000});
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});

export async function POST(request:Request){
 const origin=request.headers.get('origin');
 const host=request.headers.get('host');
 try{if(!origin||!host||new URL(origin).host!==host)return json(403,{error:'FORBIDDEN'})}catch{return json(403,{error:'FORBIDDEN'})}
 const ip=(request.headers.get('x-forwarded-for')??'').split(',')[0]!.trim()||'unknown';
 if(!throttle(ip))return json(429,{error:'TOO_MANY_REQUESTS'});
 // The same limit shared by every server instance (migration 047): 5 requests an hour per client address, fail-open.
 const shared=await (async()=>{try{const admin=createAdminClient();return await hitForAddress((fn,args)=>admin.rpc(fn,args),{bucket:'prospect_request',limit:5,windowSeconds:3600},ip,
  e=>console.warn(JSON.stringify(e)))}catch{return {allowed:true,retryAfter:0}}})();
 if(!shared.allowed)return json(429,{error:'TOO_MANY_REQUESTS'});
 const raw=await request.text();
 if(raw.length>4000)return json(413,{error:'TOO_LARGE'});
 let body:unknown;try{body=JSON.parse(raw)}catch{return json(400,{error:'INVALID_REQUEST'})}
 const parsed=parseProspectRequest(body);
 if(!parsed.ok)return parsed.error==='SPAM'?json(200,{ok:true}):json(400,{error:parsed.error});
 const r=parsed.request;
 const stored=await (async()=>{try{const {error}=await createAdminClient().rpc('submit_contact_request',{p_kind:'PROSPECTS',p_activity:r.activity,p_target:r.target,
  p_department:r.department.code,p_email:r.email,p_company:'',p_message:r.message});return !error}catch{return false}})();
 const cfg=smtpConfig(process.env);
 let mailed=false;
 if(cfg){
  const mail=notificationMail(r,new Date());
  const transport=smtpTransportFrom(cfg,await import('nodemailer'));
  try{mailed=(await transport.send({to:PROSPECT_REQUEST_TO,subject:mail.subject,text:mail.text,messageId:`<demande-${randomUUID()}@${cfg.fromEmail.split('@')[1]}>`})).kind==='SENT'}
  catch{mailed=false}finally{await transport.close()}
 }
 return stored||mailed?json(200,{ok:true}):json(503,{error:'UNAVAILABLE'});
}
