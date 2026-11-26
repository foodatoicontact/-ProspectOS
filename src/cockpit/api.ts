// Cockpit administrateur (migration 056, docs/ADMIN_COCKPIT.md) — administrator only: the database checks the INTERNAL
// entitlement in every function and RLS hides every row from anyone else; this module only shapes requests and answers.
//   GET cockpit/feed?kinds=SIGNUP,WATCH_REQUEST&from=2026-11-01&to=2026-11-26&before=123&limit=50
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {FEED_KINDS} from './model.ts';
type Json=(value:unknown,status?:number)=>Response;
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(`${v}T00:00:00Z`)));
const Feed=z.object({kinds:z.array(z.enum(FEED_KINDS)).max(FEED_KINDS.length),from:day.nullable(),to:day.nullable(),
 before:z.number().int().positive().nullable(),limit:z.number().int().min(1).max(200)});
function refusal(error:{message?:string;code?:string},json:Json):Response{
 if(/Admin access required/.test(String(error.message??'')))return json({error:'Accès administrateur requis.',code:'ADMIN_ACCESS_REQUIRED'},403);
 if(error.code==='22023'||error.code==='22007'||error.code==='22008')return json({error:'Filtres invalides.',code:'INVALID'},422);
 throw Error('DATABASE_REQUEST_FAILED');
}
export function parseFeedQuery(q:URLSearchParams){
 const list=(q.get('kinds')??'').split(',').map(k=>k.trim()).filter(Boolean);
 const num=(k:string)=>q.get(k)?Number(q.get(k)):null;
 return Feed.safeParse({kinds:list,from:q.get('from')||null,to:q.get('to')||null,before:num('before'),limit:num('limit')??50});
}
export async function handleCockpit(request:Request,path:string[],db:SupabaseClient,json:Json):Promise<Response|null>{
 if(path[0]!=='cockpit')return null;
 if(request.method==='GET'&&path[1]==='feed'&&path.length===2){
  const p=parseFeedQuery(new URL(request.url).searchParams);
  if(!p.success)return json({error:'Filtres invalides.',code:'INVALID'},422);
  if(p.data.from&&p.data.to&&p.data.from>p.data.to)return json({error:'La date de début est après la date de fin.',code:'INVALID'},422);
  const {data,error}=await db.rpc('admin_feed',{p_kinds:p.data.kinds.length?p.data.kinds:null,p_from:p.data.from,p_to:p.data.to,p_before:p.data.before,p_limit:p.data.limit});
  return error?refusal(error,json):json(data);
 }
 return json({error:'Route ou action non disponible'},404);
}
