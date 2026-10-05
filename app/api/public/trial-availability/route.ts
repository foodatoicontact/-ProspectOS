import {createClient} from '@supabase/supabase-js';
// Public: whether a free-trial seat is still open (migration 020). The landing page and the demo read it to stop
// promising a trial that sign-up would refuse. Only the boolean is relayed; anything else — no configuration, a
// database error, an unexpected value — is "unknown" (null), never "open": the pages then keep their default
// copy and activate_trial stays the only gate.
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return new Response(JSON.stringify({available:null}),{headers});
 try{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc('trial_available');
  return new Response(JSON.stringify({available:error?null:typeof data==='boolean'?data:null}),{headers});
 }catch{return new Response(JSON.stringify({available:null}),{headers})}
}
