import {randomUUID} from 'node:crypto';
import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';
import {SITE_URL} from '../../../../src/domain/seo';
import {EDITOR} from '../../../../src/domain/legal';
import {dedicatedTrackingEnabled,dedicatedNotifyEmail} from '../../../../src/dedicated/flag';
import {previousMonth} from '../../../../src/dedicated/model';
import {runDedicatedStatements} from '../../../../src/dedicated/notify';
// Veille dédiée (migration 043, src/dedicated) — daily (vercel.json crons): generates the previous month's statements
// (idempotent: the 1st does the work, later runs find nothing new) and, from the 5th, announces once each statement its
// client has not validated. Same authorization as the other jobs: "Authorization: Bearer <CRON_SECRET>". Without
// DEDICATED_TRACKING_ENABLED nothing runs.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Relevés non configurés.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 if(!dedicatedTrackingEnabled(process.env))return json({skipped:'DEDICATED_TRACKING_DISABLED'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 const cfg=smtpConfig(process.env);
 try{
  const summary=await runDedicatedStatements({rpc,month:previousMonth(new Date()),notifyTo:dedicatedNotifyEmail(process.env,EDITOR.legalEmail),siteUrl:SITE_URL,
   messageDomain:cfg?cfg.fromEmail.split('@')[1]!:null,transport:cfg?async()=>smtpTransportFrom(cfg,await import('nodemailer')):null,id:randomUUID});
  console.info(JSON.stringify({event:'dedicated_statements',...summary}));
  return json(summary);
 }catch{return json({error:'Relevés momentanément indisponibles.',code:'DEDICATED_STATEMENTS_FAILED'},500)}
}
