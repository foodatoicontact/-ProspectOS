// Web push (migration 057) — server side only: sends the queued notifications to the devices of each account, signed with
// the VAPID keys of ProspectOS (RFC 8292) and encrypted for each device (RFC 8291) by the `web-push` library.
//   WEB_PUSH_VAPID_PUBLIC_KEY   the public key (also given to browsers, through GET /api/v1/app/settings)
//   WEB_PUSH_VAPID_PRIVATE_KEY  the private key — a secret, never sent anywhere
//   WEB_PUSH_SUBJECT            optional, default mailto:contact@prospectos.fr (how a push service reaches the sender)
// The payload is {kind,url} only: the device shows a fixed text in its own language (public/sw.js). No company name, no
// signal content, nothing personal goes through Apple's, Google's or Mozilla's push services. Never throws.
type Env=Record<string,string|undefined>;
export type VapidConfig={publicKey:string;privateKey:string;subject:string};
export function vapidConfig(env:Env):VapidConfig|null{
 const publicKey=(env.WEB_PUSH_VAPID_PUBLIC_KEY??'').trim(),privateKey=(env.WEB_PUSH_VAPID_PRIVATE_KEY??'').trim();
 if(!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey)||!/^[A-Za-z0-9_-]{40,50}$/.test(privateKey))return null;
 const subject=(env.WEB_PUSH_SUBJECT??'mailto:contact@prospectos.fr').trim();
 if(!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject))return null;
 return {publicKey,privateKey,subject};
}
export type Claimed={id:number;kind:string;url:string;subscriptions:{endpoint:string;p256dh:string;auth:string}[]};
export type Sender=(sub:{endpoint:string;keys:{p256dh:string;auth:string}},payload:string,options:Record<string,unknown>)=>Promise<{statusCode:number}>;
export type UserPushDeps={rpc:(fn:string,args:Record<string,unknown>)=>Promise<unknown>;config:VapidConfig|null;send:Sender|null};
export const pushPayload=(c:Pick<Claimed,'kind'|'url'>)=>JSON.stringify({kind:c.kind,url:c.url});
export async function sendUserPushes(d:UserPushDeps):Promise<{sent:number;failed:number;gone:number;skipped?:string}>{
 if(!d.config||!d.send)return {sent:0,failed:0,gone:0,skipped:'WEB_PUSH_NOT_CONFIGURED'};
 let claimed:unknown;
 try{claimed=await d.rpc('claim_user_push',{p_limit:50})}catch{return {sent:0,failed:0,gone:0,skipped:'QUEUE_UNAVAILABLE'}}
 let sent=0,failed=0,gone=0;
 for(const c of Array.isArray(claimed)?claimed as Claimed[]:[]){
  let ok=false;
  for(const s of c.subscriptions){
   try{
    const r=await d.send({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},pushPayload(c),
     {TTL:24*3600,urgency:'normal',topic:c.kind.toLowerCase().replace(/_/g,'-'),vapidDetails:d.config,timeout:5000});
    if(r.statusCode>=200&&r.statusCode<300)ok=true;
   }catch(e){
    const code=(e as {statusCode?:number})?.statusCode;
    if(code===404||code===410){gone++;try{await d.rpc('drop_push_subscription',{p_endpoint:s.endpoint})}catch{}}
   }
  }
  try{await d.rpc('finish_user_push',{p_id:c.id,p_sent:ok})}catch{}
  if(ok)sent++;else failed++;
 }
 return {sent,failed,gone};
}
