import {randomUUID} from 'node:crypto';
import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {checkSaleQuality,alertText,type Week} from '../../../../src/collect/sale-quality';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';
// Weekly check of the BODACC sale sort (migration 054, src/collect/sale-quality.ts) — Mondays (vercel.json crons), after the
// night's collection. Same authorization as the other jobs. The result is always logged (counts only); when something is
// off it is logged as a warning and, if OPS_ALERT_EMAIL and the SMTP configuration are set, mailed to that address.
export const runtime='nodejs';
export const maxDuration=30;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const EMAIL=/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Contrôle non configuré.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const until=new Date().toISOString().slice(0,10);
 const {data,error}=await admin.rpc('bodacc_sale_rule_weeks',{p_until:until,p_weeks:5});
 if(error||!Array.isArray(data))return json({error:'Contrôle momentanément indisponible.',code:'QUALITY_CHECK_FAILED'},500);
 const report=checkSaleQuality(data as Week[]);
 const event={event:'bodacc_sale_quality',...report};
 let mailed=false;
 if(report.alerts.length){
  console.warn(JSON.stringify(event));
  const to=process.env.OPS_ALERT_EMAIL?.trim(),cfg=smtpConfig(process.env);
  if(to&&EMAIL.test(to)&&cfg){
   const transport=smtpTransportFrom(cfg,await import('nodemailer'));
   try{const r=await transport.send({to,subject:`ProspectOS — alerte tri BODACC (${report.alerts.length})`,text:alertText(report),messageId:`<bodacc-quality-${randomUUID()}@${cfg.fromEmail.split('@')[1]}>`});mailed=r.kind==='SENT'}
   finally{await transport.close().catch(()=>{})}
  }
 }else console.info(JSON.stringify(event));
 return json({...report,mailed});
}
