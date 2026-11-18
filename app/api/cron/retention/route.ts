import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
// Retention (migration 048, audit 2026-11-11 R1): once a night, public.run_retention() deletes what is past its retention
// period — contact details of people on prospects without activity for 3 years, unreviewed or rejected signals, BODACC
// announcements older than 13 months (except those a list cites), lists of the référentiel past 3 years. Always on: a
// retention period is a commitment of the privacy policy, not an option. Same authorization as the other jobs.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Conservation non configurée.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const {data,error}=await admin.rpc('run_retention');
 if(error){console.error(JSON.stringify({event:'retention',error:'DATABASE_REQUEST_FAILED'}));return json({error:'Conservation momentanément indisponible.',code:'RETENTION_FAILED'},500)}
 console.info(JSON.stringify({event:'retention',...(data as Record<string,unknown>)}));
 return json(data);
}
