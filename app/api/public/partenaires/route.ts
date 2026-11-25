import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {PROSPECT_REQUEST_TO,createThrottle} from '../../../../src/domain/prospect-request';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';
import {createAdminClient} from '../../../../src/server/admin-client';
import {hitForAddress} from '../../../../src/server/rate-limit';
import {siretValid} from '../../../../src/partners/model';
import {partnersEnabledIn} from '../../../../src/partners/flag';
// « Devenir partenaire » (/partenaires, migration 052): the application is stored (partner_applications, read by the
// administrator only) and announced to ProspectOS's own mailbox (best effort). Nothing is sent to the applicant and no
// partner is created: the administrator validates by hand. Same-origin posts only, small bodies, a honeypot, a burst
// throttle and the shared limit per address (migration 047). Flag off: 404.
export const dynamic='force-dynamic';
export const runtime='nodejs';
const throttle=createThrottle({max:5,windowMs:60*60*1000});
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const Application=z.object({name:z.string().trim().min(2).max(120),company:z.string().trim().min(2).max(160),siret:z.string().trim().refine(siretValid),
 email:z.string().trim().toLowerCase().email().max(254),pitch:z.string().trim().min(10).max(2000),consent:z.literal(true),website:z.string().max(0).optional()}).strict();
export async function POST(request:Request){
 if(!partnersEnabledIn(process.env))return json(404,{error:'NOT_FOUND'});
 const origin=request.headers.get('origin'),host=request.headers.get('host');
 try{if(!origin||!host||new URL(origin).host!==host)return json(403,{error:'FORBIDDEN'})}catch{return json(403,{error:'FORBIDDEN'})}
 const ip=(request.headers.get('x-forwarded-for')??'').split(',')[0]!.trim()||'unknown';
 if(!throttle(ip))return json(429,{error:'TOO_MANY_REQUESTS'});
 let admin;try{admin=createAdminClient()}catch{return json(503,{error:'UNAVAILABLE'})}
 const shared=await hitForAddress((fn,args)=>admin.rpc(fn,args),{bucket:'partner_application',limit:5,windowSeconds:3600},ip,e=>console.warn(JSON.stringify(e))).catch(()=>({allowed:true,retryAfter:0}));
 if(!shared.allowed)return json(429,{error:'TOO_MANY_REQUESTS'});
 const raw=await request.text();if(raw.length>6000)return json(413,{error:'TOO_LARGE'});
 let body:unknown;try{body=JSON.parse(raw)}catch{return json(400,{error:'INVALID_REQUEST'})}
 // Honeypot: a filled hidden field is a robot — answered like a success, nothing stored.
 if(body&&typeof body==='object'&&typeof (body as {website?:unknown}).website==='string'&&(body as {website:string}).website.length>0)return json(200,{ok:true});
 const p=Application.safeParse(body);
 if(!p.success)return json(400,{error:'INVALID_REQUEST',fields:[...new Set(p.error.issues.map(i=>String(i.path[0])))]});
 const {data,error}=await admin.rpc('submit_partner_application',{p_name:p.data.name,p_company:p.data.company,p_siret:p.data.siret.replace(/\s/g,''),p_email:p.data.email,p_pitch:p.data.pitch});
 if(error)return json(503,{error:'UNAVAILABLE'});
 const cfg=smtpConfig(process.env);
 if(cfg){
  const transport=smtpTransportFrom(cfg,await import('nodemailer'));
  try{await transport.send({to:PROSPECT_REQUEST_TO,subject:`[ProspectOS] Candidature partenaire : ${p.data.company.slice(0,80)}`,
   text:['Nouvelle candidature au programme partenaires.','',`Nom : ${p.data.name}`,`Entreprise : ${p.data.company}`,`SIRET : ${p.data.siret}`,`E-mail : ${p.data.email}`,'',
    'Comment il compte recommander ProspectOS :',p.data.pitch,'',`Référence : ${(data as {id?:string})?.id??''}`,'Validation à la main : créer le partenaire depuis /partenaires/admin.'].join('\n'),
   messageId:`<partenaire-${randomUUID()}@${cfg.fromEmail.split('@')[1]}>`})}catch{}finally{await transport.close()}
 }
 return json(200,{ok:true});
}
