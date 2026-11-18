// Base entreprises de la veille (migration 049, docs/LEAD_BASE.md) — administrator only (the database checks the INTERNAL
// entitlement in every function; this module only shapes requests and answers). Behind DEDICATED_TRACKING_ENABLED.
//   GET  leads/contracts/<id>/pool?days=60&limit=100   the sorted pool of a client (its profile, leads, companies waiting)
//   POST leads/contracts/<id>/profile                  {trade_label,departments[],kinds[],naf_prefixes[]}
//   POST leads/contracts/<id>/reserve                  {sirens[]} — exclusive per trade
//   POST leads/assignments/<id>/release
//   GET  leads/companies/<siren>                       one company, its whole history
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {LEAD_KINDS,tradeKey} from './model.ts';
type Json=(value:unknown,status?:number)=>Response;
const uuid=z.string().uuid();
const Profile=z.object({trade_label:z.string().trim().min(2).max(80),departments:z.array(z.string().trim().toUpperCase().regex(/^(\d{2,3}|2[AB])$/)).min(1).max(120),
 kinds:z.array(z.enum(LEAD_KINDS)).min(1).max(4),naf_prefixes:z.array(z.string().trim().toUpperCase().regex(/^\d{2}(\.\d{1,2}[A-Z]?)?$/)).max(40).default([])}).strict();
const Reserve=z.object({sirens:z.array(z.string().regex(/^\d{9}$/)).min(1).max(500)}).strict();
const KNOWN:Record<string,[string,number,string]>={
 lead_profile_missing:['Ce client n’a pas encore de profil : indiquez son métier, ses départements et les événements qui l’intéressent.',409,'PROFILE_MISSING'],
 lead_trade_locked:['Ce client a déjà des leads réservés pour son métier : libérez-les avant de changer de métier.',409,'TRADE_LOCKED'],
 lead_contract_not_found:['Contrat introuvable.',404,'NOT_FOUND'],
 lead_assignment_not_found:['Réservation introuvable ou déjà libérée.',404,'NOT_FOUND'],
};
function refusal(error:{message?:string;code?:string},json:Json):Response{
 const m=String(error.message??'');
 for(const [k,[text,status,code]] of Object.entries(KNOWN))if(m.includes(k))return json({error:text,code},status);
 if(/Admin access required/.test(m))return json({error:'Accès administrateur requis.',code:'ADMIN_ACCESS_REQUIRED'},403);
 if(error.code==='22023'||error.code==='23514')return json({error:'Données invalides.',code:'INVALID'},422);
 throw Error('DATABASE_REQUEST_FAILED');
}
export async function handleLeads(request:Request,path:string[],db:SupabaseClient,json:Json,deps:{enabled:boolean}):Promise<Response|null>{
 if(path[0]!=='leads')return null;
 if(!deps.enabled)return json({error:'Route ou action non disponible'},404);
 const [,a,b,c]=path;
 const call=async(fn:string,args:Record<string,unknown>,status=200)=>{const {data,error}=await db.rpc(fn,args);return error?refusal(error,json):json(data,status)};
 let body:unknown={};
 if(request.method==='POST'){const raw=await request.text();if(raw.length>40000)return json({error:'Corps trop volumineux'},413);try{body=JSON.parse(raw||'{}')}catch{return json({error:'JSON invalide'},400)}}
 if(a==='contracts'&&b&&uuid.safeParse(b).success){
  if(request.method==='GET'&&c==='pool'){
   const q=new URL(request.url).searchParams;const days=Math.min(400,Math.max(1,Number(q.get('days'))||60));const limit=Math.min(500,Math.max(1,Number(q.get('limit'))||100));
   return call('admin_lead_pool',{p_contract_id:b,p_days:days,p_limit:limit});
  }
  if(request.method==='POST'&&c==='profile'){
   const p=Profile.safeParse(body);if(!p.success)return json({error:'Profil invalide : métier, au moins un département et un type d’événement.',code:'INVALID'},422);
   const key=tradeKey(p.data.trade_label);if(key.length<2)return json({error:'Métier invalide.',code:'INVALID'},422);
   return call('admin_set_lead_profile',{p_contract_id:b,p_trade_key:key,p_trade_label:p.data.trade_label,p_departments:p.data.departments,p_kinds:p.data.kinds,p_naf_prefixes:p.data.naf_prefixes});
  }
  if(request.method==='POST'&&c==='reserve'){
   const p=Reserve.safeParse(body);if(!p.success)return json({error:'Sélection invalide.',code:'INVALID'},422);
   return call('admin_assign_leads',{p_contract_id:b,p_sirens:[...new Set(p.data.sirens)]});
  }
 }
 if(a==='assignments'&&b&&uuid.safeParse(b).success&&c==='release'&&request.method==='POST')return call('admin_release_lead',{p_assignment_id:b});
 if(a==='companies'&&b&&/^\d{9}$/.test(b)&&request.method==='GET')return call('admin_company',{p_siren:b});
 return json({error:'Route ou action non disponible'},404);
}
