// UI-4 — POST /evidence with status USER_DECLARED: an ICP criterion completed from what the person knows, WITHOUT a
// source (migration 033). USER_DECLARED ≠ VERIFIED: it never carries a source (none is accepted, none is invented), and
// its author is never sent by the client — the evidence guard stamps declared_by from the authenticated session
// (auth.uid()), exactly as it stamps verified_by for a verification. The prospect is read under the caller's RLS (a
// prospect of another organization is "not found"), and the criterion must belong to the project's own ICP.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';

export const USER_DECLARED_NOTE_MAX=280;
// Closed body: anything else (source_url, excerpt, verified_by, declared_by, observed_at, organization_id…) is refused.
export const UserDeclaredBody=z.object({
 prospect_id:z.string().uuid(),
 criterion:z.string().min(1).max(100),
 value:z.boolean(),
 status:z.literal('USER_DECLARED'),
 note:z.string().max(USER_DECLARED_NOTE_MAX).optional(),
}).strict();
export const USER_DECLARED_COLUMNS='id,prospect_id,criterion,value,status,note,declared_by,observed_at,created_at';
export type UserDeclaredResult={status:number;body:unknown};

export async function handleUserDeclared(body:unknown,db:SupabaseClient,user:{id:string}|null,now:Date=new Date()):Promise<UserDeclaredResult>{
 if(!user?.id)return {status:401,body:{error:'Authentification requise'}};
 const parsed=UserDeclaredBody.safeParse(body);
 if(!parsed.success)return {status:400,body:{error:'Déclaration invalide'}};
 const d=parsed.data;const note=d.note?.trim()||null;
 const {data:p,error:pe}=await db.from('prospects').select('id,project_id,organization_id').eq('id',d.prospect_id).maybeSingle();
 if(pe)return {status:500,body:{error:'Lecture impossible'}};
 if(!p)return {status:404,body:{error:'Prospect introuvable'}};
 const {data:icp,error:ie}=await db.from('icps').select('criteria').eq('project_id',p.project_id).maybeSingle();
 if(ie)return {status:500,body:{error:'Lecture impossible'}};
 const criteria:unknown=icp?.criteria;
 if(!Array.isArray(criteria)||!criteria.some(c=>(c as {key?:unknown})?.key===d.criterion))return {status:400,body:{error:'Critère hors ICP'}};
 // No source, no author from the client: declared_by is set by the database guard from the session.
 const {data:row,error}=await db.from('evidence').insert({prospect_id:p.id,organization_id:p.organization_id,criterion:d.criterion,value:d.value,
  status:'USER_DECLARED',source_url:null,excerpt:null,note,observed_at:now.toISOString()}).select(USER_DECLARED_COLUMNS).single();
 if(error||!row)return {status:500,body:{error:'Enregistrement impossible'}};
 return {status:201,body:row};
}
