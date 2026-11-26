import {randomUUID} from 'node:crypto';
import {PROSPECT_REQUEST_TO,createThrottle,cleanLine} from '../../../../src/domain/prospect-request';
import {parseWatchRequest} from '../../../../src/domain/watch-request';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {createAdminClient} from '../../../../src/server/admin-client';
import {hitForAddress} from '../../../../src/server/rate-limit';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';
import {sendPendingPush,COCKPIT_URL} from '../../../../src/cockpit/dispatch';

// « Demander un devis » de veille dédiée (src/domain/watch-request.ts, owner decision 26 nov. 2026), replacing the mailto.
// The request is stored (public.contact_requests through the server function submit_contact_request, migration 056;
// deleted after 12 months), which queues a push for the administrator (no personal data in it); ProspectOS's own mailbox
// gets a short notice pointing to the cockpit, nothing is ever sent to the requester. Same protections as the "3 prospects"
// form: same-origin posts only, small bodies, a honeypot, a burst throttle and the shared limit of migration 047.
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
 let admin;try{admin=createAdminClient()}catch{return json(503,{error:'UNAVAILABLE'})}
 const shared=await (async()=>{try{return await hitForAddress((fn,args)=>admin.rpc(fn,args),{bucket:'watch_request',limit:5,windowSeconds:3600},ip,
  e=>console.warn(JSON.stringify(e)))}catch{return {allowed:true,retryAfter:0}}})();
 if(!shared.allowed)return json(429,{error:'TOO_MANY_REQUESTS'});
 const raw=await request.text();
 if(raw.length>4000)return json(413,{error:'TOO_LARGE'});
 let body:unknown;try{body=JSON.parse(raw)}catch{return json(400,{error:'INVALID_REQUEST'})}
 const parsed=parseWatchRequest(body);
 if(!parsed.ok)return parsed.error==='SPAM'?json(200,{ok:true}):json(400,{error:parsed.error});
 const r=parsed.request;
 const {error}=await admin.rpc('submit_contact_request',{p_kind:'WATCH',p_activity:r.activity,p_target:r.target,p_department:r.department.code,
  p_email:r.email,p_company:r.company,p_message:r.message});
 if(error)return json(503,{error:'UNAVAILABLE'});
 await sendPendingPush(admin);
 // A short notice to ProspectOS's own mailbox (best effort): what was asked, not who asked — the e-mail stays in the cockpit.
 const cfg=smtpConfig(process.env);
 if(cfg){
  const transport=smtpTransportFrom(cfg,await import('nodemailer'));
  try{await transport.send({to:PROSPECT_REQUEST_TO,subject:cleanLine(`[ProspectOS] Demande de devis veille : ${r.activity.slice(0,60)} · ${r.department.name} (${r.department.code})`,180),
   text:`Nouvelle demande de devis de veille dédiée.\n\nActivité : ${r.activity}\nDépartement : ${r.department.name} (${r.department.code})\n\nLe détail et l’adresse de réponse sont dans le cockpit : ${COCKPIT_URL}`,
   messageId:`<veille-${randomUUID()}@${cfg.fromEmail.split('@')[1]}>`})}catch{}finally{await transport.close()}
 }
 return json(200,{ok:true});
}
