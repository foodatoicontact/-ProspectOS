import {randomUUID} from 'node:crypto';
import {CONTACT_EMAIL} from '../../../../src/domain/contact';
import {createThrottle,notificationMail,parseProspectRequest} from '../../../../src/domain/prospect-request';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';

// "3 prospects de votre zone" (src/domain/prospect-request.ts). The request is emailed to ProspectOS's own contact address
// and nowhere else: the recipient is a constant, nothing is ever sent to the requester, nothing is stored. It reuses the
// SMTP configuration of the self-outreach engine for this single internal notification; the prospecting transport itself
// stays behind its two flags in the cron route. Same-origin form posts only, small bodies, a honeypot, a burst throttle.
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
 const raw=await request.text();
 if(raw.length>4000)return json(413,{error:'TOO_LARGE'});
 let body:unknown;try{body=JSON.parse(raw)}catch{return json(400,{error:'INVALID_REQUEST'})}
 const parsed=parseProspectRequest(body);
 if(!parsed.ok)return parsed.error==='SPAM'?json(200,{ok:true}):json(400,{error:parsed.error});
 const cfg=smtpConfig(process.env);
 if(!cfg)return json(503,{error:'UNAVAILABLE'});
 const mail=notificationMail(parsed.request,new Date());
 const transport=smtpTransportFrom(cfg,await import('nodemailer'));
 try{
  const sent=await transport.send({to:CONTACT_EMAIL,subject:mail.subject,text:mail.text,messageId:`<demande-${randomUUID()}@${cfg.fromEmail.split('@')[1]}>`});
  return sent.kind==='SENT'?json(200,{ok:true}):json(503,{error:'UNAVAILABLE'});
 }finally{await transport.close()}
}
