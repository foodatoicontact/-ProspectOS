// Server side only: sends the pending push notifications of the cockpit (src/cockpit/push.ts) with the privileged client.
// Called right after something that may have queued one (a request form, a Stripe event, a job) and by the daily cockpit
// job as a backstop. Never throws.
import type {SupabaseClient} from '@supabase/supabase-js';
import {SITE_URL} from '../domain/seo.ts';
import {dispatchAdminPush,pushConfig} from './push.ts';
export const COCKPIT_URL=`${SITE_URL}/cockpit`;
export async function sendPendingPush(admin:SupabaseClient,env:Record<string,string|undefined>=process.env){
 try{
  const report=await dispatchAdminPush({rpc:async(fn,args)=>{const {data,error}=await admin.rpc(fn,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data},
   fetch,config:pushConfig(env),cockpitUrl:COCKPIT_URL});
  if(report.sent||report.failed)console.info(JSON.stringify({event:'admin_push',...report}));
  return report;
 }catch{return {sent:0,failed:0,skipped:'PUSH_FAILED'}}
}
