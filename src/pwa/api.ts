// ProspectOS installable (PWA, migration 057) — the signed-in account's own settings. Every function acts on the caller's
// own row only (auth.uid() in the database); this module validates and shapes.
//   GET  app/settings                 {install_prompt_refused, push:{delivery,signals,trial}, devices, vapid_public_key}
//   POST app/push/subscribe           {endpoint, keys:{p256dh,auth}, platform}   consent given on this device
//   POST app/push/unsubscribe         {endpoint}
//   POST app/push/preferences         {delivery,signals,trial}
//   POST app/install/refuse                                                     « Ne plus afficher », for every device
//   POST app/events                   {kind, device, platform}                   the four measured events
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
type Json=(value:unknown,status?:number)=>Response;
const platform=z.enum(['ios','android','desktop','other']);
const Subscribe=z.object({endpoint:z.string().url().max(1000).refine(u=>u.startsWith('https://')),
 keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),auth:z.string().regex(/^[A-Za-z0-9_-]{16,32}$/)}),platform}).strict();
const Unsubscribe=z.object({endpoint:z.string().max(1000)}).strict();
const Prefs=z.object({delivery:z.boolean(),signals:z.boolean(),trial:z.boolean()}).strict();
export const APP_EVENTS=['invitation_affichee','invitation_refusee','app_installee','notifications_activees'] as const;
const Event=z.object({kind:z.enum(APP_EVENTS),device:z.string().regex(/^[A-Za-z0-9-]{16,40}$/),platform}).strict();
export async function handleApp(request:Request,path:string[],db:SupabaseClient,json:Json,deps:{vapidPublicKey:string|null}):Promise<Response|null>{
 if(path[0]!=='app')return null;
 const route=path.slice(1).join('/');
 const call=async(fn:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(fn,args);
  if(error){if(String(error.message).includes('push_device_limit'))return json({error:'Trop d’appareils enregistrés pour ce compte (10 au plus).',code:'DEVICE_LIMIT'},409);
   if(error.code==='22023'||error.code==='23514')return json({error:'Données invalides.',code:'INVALID'},422);throw Error('DATABASE_REQUEST_FAILED')}
  return json({...(data as Record<string,unknown>),vapid_public_key:deps.vapidPublicKey})};
 if(request.method==='GET'&&route==='settings')return call('app_settings',{});
 if(request.method!=='POST')return json({error:'Route ou action non disponible'},404);
 let body:unknown;try{body=JSON.parse((await request.text())||'{}')}catch{return json({error:'JSON invalide'},400)}
 if(route==='push/subscribe'){const p=Subscribe.safeParse(body);if(!p.success)return json({error:'Abonnement invalide.',code:'INVALID'},422);
  return call('save_push_subscription',{p_endpoint:p.data.endpoint,p_p256dh:p.data.keys.p256dh,p_auth:p.data.keys.auth,p_platform:p.data.platform})}
 if(route==='push/unsubscribe'){const p=Unsubscribe.safeParse(body);if(!p.success)return json({error:'Données invalides.',code:'INVALID'},422);
  return call('delete_push_subscription',{p_endpoint:p.data.endpoint})}
 if(route==='push/preferences'){const p=Prefs.safeParse(body);if(!p.success)return json({error:'Données invalides.',code:'INVALID'},422);
  return call('set_push_preferences',{p_delivery:p.data.delivery,p_signals:p.data.signals,p_trial:p.data.trial})}
 if(route==='install/refuse')return call('refuse_install_prompt',{});
 if(route==='events'){const p=Event.safeParse(body);if(!p.success)return json({error:'Événement invalide.',code:'INVALID'},422);
  const {data,error}=await db.rpc('record_app_event',{p_kind:p.data.kind,p_device:p.data.device,p_platform:p.data.platform});
  if(error){if(error.code==='22023')return json({error:'Événement invalide.',code:'INVALID'},422);throw Error('DATABASE_REQUEST_FAILED')}
  return json(data)}
 return json({error:'Route ou action non disponible'},404);
}
