import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {newDemoToken,demoTokenHash,isDemoToken,demoLink} from './token.ts';
// Demo links, application side (migration 042). Runs as the signed-in user: the database decides who owns the project.
//   GET  demo-shares?project_id=…   the project's links (never a token, never a hash) — owners only (RLS)
//   POST demo-shares                {project_id, target?} → the link, returned this one time
//   POST demo-shares/<id>/revoke    disable a link
//   POST demo-shares/claim          {token} → copy the shared project into the caller's account (after sign-up)
type Json=(value:unknown,status?:number)=>Response;
const COLUMNS='id,project_id,target,expires_at,revoked_at,view_count,last_viewed_at,created_at';
const Create=z.object({project_id:z.string().uuid(),target:z.string().trim().max(300).optional()}).strict();
const refusal=(error:{message?:string;code?:string}|null,json:Json):Response|null=>{
 const m=String(error?.message??'');
 if(/demo_share_limit/.test(m))return json({error:'Ce projet a déjà 20 liens actifs. Désactivez-en un avant d’en créer un autre.',code:'DEMO_SHARE_LIMIT'},409);
 if(/demo_share_invalid/.test(m))return json({error:'Ce lien de démo n’est plus disponible.',code:'DEMO_SHARE_INVALID'},410);
 if(/demo_share_own/.test(m))return json({error:'Ce lien vient de votre propre espace : rien à copier.',code:'DEMO_SHARE_OWN'},409);
 if(error?.code==='42501'||/owner|member required/i.test(m))return json({error:'Seul le propriétaire du projet peut partager une démo.',code:'DEMO_SHARE_OWNER_REQUIRED'},403);
 if(error?.code==='P0002')return json({error:'Projet ou lien introuvable.',code:'DEMO_SHARE_NOT_FOUND'},404);
 return null;
};
export async function handleDemoShares(request:Request,path:string[],body:Record<string,unknown>,db:SupabaseClient,json:Json):Promise<Response|null>{
 if(path[0]!=='demo-shares')return null;
 const [,id,op]=path;
 if(request.method==='GET'&&!id){
  const pid=new URL(request.url).searchParams.get('project_id');
  if(!z.string().uuid().safeParse(pid).success)return json({error:'Projet requis'},400);
  const {data,error}=await db.from('demo_shares').select(COLUMNS).eq('project_id',pid!).order('created_at',{ascending:false}).limit(50);
  if(error)throw Error('DATABASE_REQUEST_FAILED');
  return json(data??[]);
 }
 if(request.method==='POST'&&!id){
  const b=Create.safeParse(body);if(!b.success)return json({error:'Demande invalide'},400);
  const token=newDemoToken();
  const {data,error}=await db.rpc('create_demo_share',{p_project_id:b.data.project_id,p_token_hash:demoTokenHash(token),p_target:b.data.target||null,p_days:14});
  if(error){const r=refusal(error,json);if(r)return r;throw Error('DATABASE_REQUEST_FAILED')}
  return json({share:data,link:demoLink(new URL(request.url).origin,token)},201);
 }
 if(request.method==='POST'&&id==='claim'&&!op){
  if(!isDemoToken(body.token))return json({error:'Ce lien de démo n’est plus disponible.',code:'DEMO_SHARE_INVALID'},410);
  const {data,error}=await db.rpc('claim_demo_share',{p_token_hash:demoTokenHash(body.token)});
  if(error){const r=refusal(error,json);if(r)return r;throw Error('DATABASE_REQUEST_FAILED')}
  return json(data);
 }
 if(request.method==='POST'&&id&&op==='revoke'){
  if(!z.string().uuid().safeParse(id).success)return json({error:'Lien requis'},400);
  const {error}=await db.rpc('revoke_demo_share',{p_id:id});
  if(error){const r=refusal(error,json);if(r)return r;throw Error('DATABASE_REQUEST_FAILED')}
  return json({revoked:true});
 }
 return null;
}
