import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {sendPendingPush} from '../../../../src/cockpit/dispatch';
import {sendQueuedWebPush} from '../../../../src/pwa/send';
// Cockpit administrateur (migration 056) — daily (vercel.json crons): records the trials that ended (TRIAL_ENDED, read from
// the end date of each trial), then sends the push notifications still waiting (a backstop: they are normally sent right
// after the request, the Stripe event or the statement that queued them). Same authorization as the other jobs.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Cockpit non configuré.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const {data,error}=await admin.rpc('sweep_admin_events');
 if(error)return json({error:'Cockpit momentanément indisponible.',code:'COCKPIT_SWEEP_FAILED'},500);
 const push=await sendPendingPush(admin);
 // The end-of-trial web push queued by the sweep (migration 057), and any other still waiting.
 const webPush=await sendQueuedWebPush(admin);
 console.info(JSON.stringify({event:'admin_cockpit',...(data as Record<string,unknown>),push,webPush}));
 return json({...(data as Record<string,unknown>),push,webPush});
}
