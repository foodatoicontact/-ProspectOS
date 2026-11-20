import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {digestSecret,morningDigestAvailable} from '../../../../src/digest/morning';
import {runMorningDigest} from '../../../../src/digest/send';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';
import {SITE_URL} from '../../../../src/domain/seo';
import {EDITOR} from '../../../../src/domain/legal';
// Morning recap (migration 040, src/digest) — daily, after the signals monitoring (vercel.json crons). Vercel Cron calls
// it with "Authorization: Bearer <CRON_SECRET>"; nothing else is read from the request. Without CRON_SECRET: 503; wrong
// secret: 401. Without MORNING_DIGEST_ENABLED, MORNING_DIGEST_SECRET and the SMTP configuration, nothing is claimed and
// nothing is sent. Only members who enabled the recap themselves are claimed (set_morning_digest).
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Récap non configuré.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 const secret=digestSecret(process.env),cfg=smtpConfig(process.env);
 if(!morningDigestAvailable(process.env)||!secret||!cfg)return json({skipped:'MORNING_DIGEST_DISABLED'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 try{
  const summary=await runMorningDigest({rpc,secret,siteUrl:SITE_URL,contact:EDITOR.legalEmail,messageDomain:cfg.fromEmail.split('@')[1]!,now:()=>new Date(),
   transport:async()=>smtpTransportFrom(cfg,await import('nodemailer')),log:event=>console.info(JSON.stringify(event))});
  console.info(JSON.stringify({event:'morning_digest',...summary}));
  return json(summary);
 }catch{return json({error:'Récap momentanément indisponible.',code:'MORNING_DIGEST_FAILED'},500)}
}
