import {randomUUID} from 'node:crypto';
import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {smtpConfig} from '../../../../src/self-outreach/config';
import {smtpTransportFrom} from '../../../../src/self-outreach/transport';
import {SITE_URL} from '../../../../src/domain/seo';
import {EDITOR} from '../../../../src/domain/legal';
import {dedicatedNotifyEmail} from '../../../../src/dedicated/flag';
import {previousMonth} from '../../../../src/dedicated/model';
import {partnersEnabledIn} from '../../../../src/partners/flag';
// Programme partenaires (migration 052) — daily (vercel.json crons): generates the previous month's statement of every
// partner (idempotent: the run of the 1st does the work, later runs find nothing new) and, when some were generated, tells
// the administrator once by e-mail (best effort). No transfer is ever made: the administrator pays by hand, then marks the
// statement paid. Same authorization as the other jobs: "Authorization: Bearer <CRON_SECRET>". Flag off: nothing runs.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Relevés non configurés.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 if(!partnersEnabledIn(process.env))return json({skipped:'PARTNERS_DISABLED'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const month=previousMonth(new Date());
 const {data,error}=await admin.rpc('generate_partner_statements',{p_month:month});
 if(error)return json({error:'Relevés momentanément indisponibles.',code:'PARTNER_STATEMENTS_FAILED'},500);
 const generated=Number((data as {generated?:number})?.generated)||0;
 let notified=false;
 const cfg=smtpConfig(process.env);
 if(generated>0&&cfg){
  const transport=smtpTransportFrom(cfg,await import('nodemailer'));
  try{
   const sent=await transport.send({to:dedicatedNotifyEmail(process.env,EDITOR.legalEmail),subject:`[ProspectOS] ${generated} relevé(s) partenaires — ${month.slice(0,7)}`,
    text:`Les relevés partenaires de ${month.slice(0,7)} sont prêts.\n\nRelevés à payer (solde d’au moins 50 €) : ${SITE_URL}/partenaires/admin\n\nAucun virement n’est fait automatiquement : marquez chaque relevé payé avec la date et la référence du virement.`,
    messageId:`<partenaires-${randomUUID()}@${cfg.fromEmail.split('@')[1]}>`});
   notified=sent.kind==='SENT';
  }catch{}finally{await transport.close()}
 }
 console.info(JSON.stringify({event:'partner_statements',month,generated,notified}));
 return json({month,generated,notified});
}
