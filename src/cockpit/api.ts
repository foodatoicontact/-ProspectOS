// Cockpit administrateur (migration 056, docs/ADMIN_COCKPIT.md) — administrator only: the database checks the INTERNAL
// entitlement in every function and RLS hides every row from anyone else; this module only shapes requests and answers.
//   GET cockpit/feed?kinds=SIGNUP,WATCH_REQUEST&from=2026-11-01&to=2026-11-26&before=123&limit=50
//   GET cockpit/clients?q=boulangerie&offset=0            the list of organizations (migration 059)
//   GET cockpit/clients/<id>                              one sheet, with its latest Stripe invoices (read now, never stored)
//   POST cockpit/clients/<id>/notes {body}                a timestamped note (append-only)
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FEED_KINDS} from './model.ts';
import {stripeDashboard,type InvoiceReader} from './clients.ts';
type Json=(value:unknown,status?:number)=>Response;
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(`${v}T00:00:00Z`)));
const Feed=z.object({kinds:z.array(z.enum(FEED_KINDS)).max(FEED_KINDS.length),from:day.nullable(),to:day.nullable(),
 before:z.number().int().positive().nullable(),limit:z.number().int().min(1).max(200)});
function refusal(error:{message?:string;code?:string},json:Json):Response{
 if(/Admin access required/.test(String(error.message??'')))return json({error:'Accès administrateur requis.',code:'ADMIN_ACCESS_REQUIRED'},403);
 if(/admin_client_not_found/.test(String(error.message??'')))return json({error:'Organisation introuvable.',code:'NOT_FOUND'},404);
 if(error.code==='22023'||error.code==='22007'||error.code==='22008')return json({error:'Filtres invalides.',code:'INVALID'},422);
 throw Error('DATABASE_REQUEST_FAILED');
}
export function parseFeedQuery(q:URLSearchParams){
 const list=(q.get('kinds')??'').split(',').map(k=>k.trim()).filter(Boolean);
 const num=(k:string)=>q.get(k)?Number(q.get(k)):null;
 return Feed.safeParse({kinds:list,from:q.get('from')||null,to:q.get('to')||null,before:num('before'),limit:num('limit')??50});
}
const uuid=z.string().uuid();
const Note=z.object({body:z.string().trim().min(1).max(2000)}).strict();
export async function handleCockpit(request:Request,path:string[],db:SupabaseClient,json:Json,deps:{invoices?:InvoiceReader}={}):Promise<Response|null>{
 if(path[0]!=='cockpit')return null;
 if(path[1]==='clients'){
  if(request.method==='GET'&&path.length===2){
   const q=new URL(request.url).searchParams;const query=(q.get('q')??'').trim().slice(0,80);const offset=Math.max(0,Math.min(100000,Number(q.get('offset'))||0));
   const {data,error}=await db.rpc('admin_clients',{p_query:query||null,p_limit:50,p_offset:offset});
   return error?refusal(error,json):json(data);
  }
  const id=path[2];
  if(!id||!uuid.safeParse(id).success)return json({error:'Organisation introuvable.',code:'NOT_FOUND'},404);
  if(request.method==='GET'&&path.length===3){
   const {data,error}=await db.rpc('admin_client',{p_org:id});
   if(error)return refusal(error,json);
   // Only now, the database having checked the administrator: the invoices, from Stripe.
   const sheet=data as {billing?:{customer_id?:string|null}|null};
   const customer=sheet?.billing?.customer_id;
   const read=customer&&/^cus_[A-Za-z0-9]+$/.test(customer)&&deps.invoices?await deps.invoices(customer):null;
   return json({...(data as Record<string,unknown>),stripe:read?{mode:read.mode,customer_url:stripeDashboard(read.mode,`customers/${customer}`),invoices:read.invoices}
    :{mode:null,customer_url:null,invoices:null,unavailable:!!customer}});
  }
  if(request.method==='POST'&&path.length===4&&path[3]==='notes'){
   let body:unknown;try{body=JSON.parse((await request.text())||'{}')}catch{return json({error:'JSON invalide'},400)}
   const p=Note.safeParse(body);if(!p.success)return json({error:'Note vide ou trop longue (2 000 caractères au plus).',code:'INVALID'},422);
   const {data,error}=await db.rpc('admin_add_note',{p_org:id,p_body:p.data.body});
   return error?refusal(error,json):json(data,201);
  }
  return json({error:'Route ou action non disponible'},404);
 }
 if(request.method==='GET'&&path[1]==='feed'&&path.length===2){
  const p=parseFeedQuery(new URL(request.url).searchParams);
  if(!p.success)return json({error:'Filtres invalides.',code:'INVALID'},422);
  if(p.data.from&&p.data.to&&p.data.from>p.data.to)return json({error:'La date de début est après la date de fin.',code:'INVALID'},422);
  const {data,error}=await db.rpc('admin_feed',{p_kinds:p.data.kinds.length?p.data.kinds:null,p_from:p.data.from,p_to:p.data.to,p_before:p.data.before,p_limit:p.data.limit});
  return error?refusal(error,json):json(data);
 }
 return json({error:'Route ou action non disponible'},404);
}
