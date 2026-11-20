// GET/POST /account/morning-digest — the member's own choice about the morning recap (migration 040). GET says whether the
// recap can be offered on this server (flag, signing secret and SMTP all configured) and whether the member enabled it;
// POST {enabled} stores the choice through set_morning_digest, which records the consent. No entitlement is needed to
// unsubscribe; nothing is ever enabled for someone without this explicit call.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {morningDigestAvailable} from './morning.ts';
import type {Env} from '../self-outreach/config.ts';

type Json=(data:unknown,status?:number)=>Response;
const Body=z.object({enabled:z.boolean()}).strict();

export async function handleMorningDigest(request:Request,path:string[],body:unknown,db:SupabaseClient,json:Json,deps:{env:Env;userId:string}):Promise<Response|null>{
 if(path[0]!=='account'||path[1]!=='morning-digest'||path.length!==2)return null;
 const available=morningDigestAvailable(deps.env);
 if(request.method==='GET'){
  const {data,error}=await db.from('morning_digest_subscriptions').select('enabled,consented_at').eq('user_id',deps.userId).maybeSingle();
  if(error)return json({error:'Préférence momentanément indisponible.'},503);
  return json({available,enabled:!!data?.enabled,consented_at:data?.consented_at??null});
 }
 if(request.method!=='POST')return json({error:'Méthode non autorisée'},405);
 const parsed=Body.safeParse(body);if(!parsed.success)return json({error:'Choix invalide.',code:'INVALID_CHOICE'},400);
 // Turning it on is only offered where it can work; turning it off is always accepted.
 if(parsed.data.enabled&&!available)return json({error:'Le récap du matin n’est pas encore disponible.',code:'MORNING_DIGEST_UNAVAILABLE'},409);
 const {data,error}=await db.rpc('set_morning_digest',{p_enabled:parsed.data.enabled});
 if(error)return json({error:'Préférence momentanément indisponible.'},503);
 return json({available,...(data as {enabled:boolean;consented_at:string|null})});
}
