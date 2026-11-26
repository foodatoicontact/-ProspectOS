// Server side only: sends the queued web push notifications (src/pwa/webpush.ts) with the privileged client. Called after
// what may have queued one (a veille delivery created, the monitoring job, the daily cockpit job). Never throws.
import type {SupabaseClient} from '@supabase/supabase-js';
import {sendUserPushes,vapidConfig,type Sender} from './webpush.ts';
export async function sendQueuedWebPush(admin:SupabaseClient,env:Record<string,string|undefined>=process.env){
 try{
  const config=vapidConfig(env);
  const send:Sender|null=config?(await import('web-push')).default.sendNotification as unknown as Sender:null;
  const report=await sendUserPushes({rpc:async(fn,args)=>{const {data,error}=await admin.rpc(fn,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data},config,send});
  if(report.sent||report.failed||report.gone)console.info(JSON.stringify({event:'web_push',...report}));
  return report;
 }catch{return {sent:0,failed:0,gone:0,skipped:'WEB_PUSH_FAILED'}}
}
