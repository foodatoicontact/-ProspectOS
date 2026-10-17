// Self-Outreach routes (/api/v1/self-outreach/…) — members of an organization listed in SELF_OUTREACH_ORG_IDS, with
// SELF_OUTREACH_ENABLED on. Every write goes through a migration-033 function as the member (RLS); nothing here sends
// an email (sending is the cron job's, behind SELF_OUTREACH_SEND_ENABLED). Errors never carry configuration values.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {configurationReport,selfOutreachEnabled,selfOutreachOrganizations,outreachScoreThreshold,messageDomain,type Env} from './config.ts';
import {checkContact} from './contact.ts';
import {outreachScore,scoresPayload} from './score.ts';
import {generateInitial,checkHumanEdit} from './message.ts';
import {loadCandidateSource} from './source.ts';
type Json=(value:unknown,status?:number)=>Response;
export type SelfOutreachDeps={env:Env;now:()=>Date;requireEntitlement:()=>Promise<void>};
const uuid=z.string().uuid();
const KNOWN:Record<string,[string,number]>={
 outreach_email_suppressed:['Cette adresse est en liste de suppression : elle ne peut plus être contactée.',409],
 outreach_signal_not_verified:['Le signal doit être vérifié par une personne avant tout outreach.',409],
 outreach_signal_not_of_company:['Ce signal ne concerne pas l’entreprise de ce contact.',409],
 outreach_evidence_not_verified_of_company:['Une preuve citée n’est pas une preuve vérifiée de cette entreprise.',409],
 outreach_campaign_not_active:['La campagne n’est pas active.',409],
 outreach_message_not_reviewable:['Ce message a déjà été revu.',409],
 outreach_candidate_not_in_review:['Ce candidat n’est pas en revue.',409],
 outreach_candidate_not_followable:['Cette relance n’est plus possible (réponse, suppression ou envoi incomplet).',409],
 outreach_text_refused:['Le texte contient une formule interdite (offre gratuite, formule creuse).',422],
 outreach_candidates_one_active_contact:['Ce contact a déjà un outreach actif.',409],
 outreach_candidates_campaign_id_prospect_id_key:['Cette entreprise est déjà dans la campagne.',409],
 outreach_candidates_campaign_id_contact_id_key:['Ce contact est déjà dans la campagne.',409],
 outreach_contacts_organization_id_email_key:['Ce contact existe déjà.',409],
};
function refuse(json:Json,e:unknown){const msg=String((e as {message?:string;cause?:{message?:string}})?.cause?.message??(e as {message?:string})?.message??'');
 for(const [k,[error,status]] of Object.entries(KNOWN))if(msg.includes(k))return json({error,code:k.toUpperCase()},status);
 if(/not found/i.test(msg))return json({error:'Introuvable.'},404);
 return json({error:'Opération refusée : vérifiez vos droits et les données.'},400)}
async function rpc(db:SupabaseClient,fn:string,args:Record<string,unknown>){const {data,error}=await db.rpc(fn,args);if(error)throw Error(error.message);return data}

export function isSelfOutreachPath(path:readonly string[]){return path[0]==='self-outreach'}
export async function handleSelfOutreach(request:Request,path:string[],body:unknown,db:SupabaseClient,json:Json,deps:SelfOutreachDeps):Promise<Response|null>{
 if(!isSelfOutreachPath(path))return null;
 if(!selfOutreachEnabled(deps.env))return json({error:'Route ou action non disponible'},404);
 const [,resource,id,sub]=path;const method=request.method;const b=(body??{}) as Record<string,unknown>;
 const allowed=selfOutreachOrganizations(deps.env);
 // The organization behind a project / candidate / message, read as the member (RLS): unknown → 404, not allowed → 403.
 const orgOf=async(table:string,rowId:string)=>{const {data}=await db.from(table).select('organization_id').eq('id',rowId).maybeSingle();return (data as {organization_id?:string}|null)?.organization_id??null};
 const gate=async(table:string,rowId:string)=>{const org=await orgOf(table,uuid.parse(rowId));if(!org)return json({error:'Introuvable.'},404);
  if(!allowed.includes(org.toLowerCase()))return json({error:'Réservé à l’organisation ProspectOS.',code:'SELF_OUTREACH_ORG_NOT_ALLOWED'},403);return null};
 try{
  if(resource==='config'&&method==='GET')return json(configurationReport(deps.env));
  if(resource==='projects'&&id){
   const g=await gate('projects',id);if(g)return g;
   if(method==='GET'&&sub==='queue'){
    const rows=await checked(db.from('outreach_candidates').select('*,prospects(name),outreach_contacts(contact_name,contact_role,email,email_source,email_source_url,email_verified_at,role_source_url),outreach_messages(*)')
     .eq('project_id',id).in('status',['NEEDS_REVIEW','READY_TO_SEND','SENDING','SENT','REPLIED']).order('outreach_score',{ascending:false}).limit(100));
    const signalIds=[...new Set((rows??[]).map((r:any)=>r.signal_id))];
    const evIds=[...new Set((rows??[]).flatMap((r:any)=>r.evidence_ids??[]))];
    const signals=signalIds.length?await checked(db.from('signals').select('id,title,excerpt,source_url,source_domain,event_date,published_at,status').in('id',signalIds)):[];
    const evidence=evIds.length?await checked(db.from('evidence').select('id,criterion,value,status,source_url,excerpt,observed_at').in('id',evIds)):[];
    return json({items:rows??[],signals,evidence,now:deps.now().toISOString()});
   }
   if(method==='GET'&&sub==='metrics')return json(await rpc(db,'outreach_metrics',{p_project_id:id}));
   if(method==='POST'&&sub==='campaigns'){
    const x=z.object({name:z.string().trim().min(2).max(120),followup_enabled:z.boolean().default(false),followup_delay_days:z.number().int().min(3).max(30).default(5)}).strict().parse(b);
    return json(await rpc(db,'create_outreach_campaign',{p_project_id:id,p_name:x.name,p_followup_enabled:x.followup_enabled,p_followup_delay_days:x.followup_delay_days}),201);
   }
   if(method==='POST'&&sub==='contacts'){
    const x=z.object({prospect_id:uuid,contact_name:z.string().max(120),contact_role:z.string().max(120),role_source_url:z.string().max(2048),email:z.string().max(254),
     email_source:z.string().max(40),email_source_url:z.string().max(2048).nullable().optional(),email_source_excerpt:z.string().max(1000).nullable().optional()}).strict().parse(b);
    const c=checkContact(x);if(!c.ok)return json({error:'Contact refusé : provenance de l’email ou du rôle insuffisante.',code:c.reason},422);
    const k=c.contact;
    return json(await rpc(db,'add_outreach_contact',{p_prospect_id:k.prospect_id,p_name:k.contact_name,p_role:k.contact_role,p_role_source_url:k.role_source_url,p_email:k.email,
     p_email_source:k.email_source,p_email_source_url:k.email_source_url??null,p_email_source_excerpt:k.email_source_excerpt??null}),201);
   }
   if(method==='POST'&&sub==='candidates'){
    await deps.requireEntitlement();
    const x=z.object({campaign_id:uuid,contact_id:uuid,signal_id:uuid}).strict().parse(b);
    const contact=await checked(db.from('outreach_contacts').select('id,prospect_id,project_id,contact_name,contact_role,email').eq('id',x.contact_id).single());
    if(contact.project_id!==id)return json({error:'Contact hors projet.'},409);
    const src=await loadCandidateSource(db,contact.prospect_id,x.signal_id,deps.now());
    if(!src)return json({error:'Signal introuvable pour cette entreprise.',code:'OUTREACH_SIGNAL_NOT_OF_COMPANY'},409);
    const score=outreachScore(src.opportunity,src.signal,src.classified,outreachScoreThreshold(deps.env));
    const evidence=src.evidence.filter((e:any)=>e.status==='VERIFIED'&&e.verified_by&&src.opportunity.evidence_ids.includes(e.id));
    const msg=generateInitial({company:src.prospect.name,contactName:contact.contact_name,offer:src.project.offer,senderName:(deps.env.OUTREACH_FROM_NAME??'').trim(),
     signal:src.signal as any,commercialType:src.classified?.commercial_type??'OTHER',evidence});
    if(!msg.ok)return json({error:'Aucun message sûr ne peut être généré pour ce signal.',code:msg.reason,score},422);
    const created=await rpc(db,'create_outreach_candidate',{p_campaign_id:x.campaign_id,p_contact_id:x.contact_id,p_signal_id:x.signal_id,p_evidence_ids:evidence.map((e:any)=>e.id),
     p_scores:scoresPayload(score,src.classified?.commercial_type??'OTHER'),p_message:{subject:msg.subject,generated_content:msg.text,evidence_refs:msg.evidence_refs,generation_meta:msg.generation_meta}});
    return json({...created,score},201);
   }
   if(method==='POST'&&sub==='suppressions'){
    const x=z.object({email:z.string().trim().max(254),reason:z.enum(['OPT_OUT','MANUAL','COMPLIANCE'])}).strict().parse(b);
    return json(await rpc(db,'suppress_outreach_email',{p_project_id:id,p_email:x.email,p_reason:x.reason}));
   }
  }
  if(resource==='messages'&&id&&sub==='review'&&method==='POST'){
   const g=await gate('outreach_messages',id);if(g)return g;
   const x=z.object({decision:z.enum(['APPROVE','EDIT','REJECT']),subject:z.string().trim().min(3).max(140).optional(),content:z.string().min(20).max(2000).optional()}).strict().parse(b);
   const m=await checked(db.from('outreach_messages').select('id,candidate_id,generated_content,human_edit').eq('id',id).single());
   if(x.decision==='EDIT'){
    if(!x.content)return json({error:'Texte requis.'},400);
    // The same rules as the generator: an edit may not add an unsourced fact or a forbidden offer.
    const k=await checked(db.from('outreach_candidates').select('prospect_id,signal_id,evidence_ids,outreach_contacts(contact_name)').eq('id',m.candidate_id).single());
    const src=await loadCandidateSource(db,k.prospect_id,k.signal_id,deps.now());if(!src)return json({error:'Signal introuvable.'},409);
    const check=checkHumanEdit(x.content,{company:src.prospect.name,contactName:(k as any).outreach_contacts?.contact_name??'',offer:src.project.offer,senderName:(deps.env.OUTREACH_FROM_NAME??'').trim(),
     signal:src.signal as any,evidence:src.evidence.filter((e:any)=>(k.evidence_ids??[]).includes(e.id))});
    if(!check.ok)return json({error:'Le texte modifié affirme un fait non sourcé ou contient une formule interdite.',code:check.reason},422);
   }
   return json(await rpc(db,'review_outreach_message',{p_message_id:id,p_decision:x.decision,p_subject:x.subject??null,p_content:x.content??null,p_message_domain:messageDomain(deps.env)}));
  }
  if(resource==='candidates'&&id&&sub==='outcome'&&method==='POST'){
   const g=await gate('outreach_candidates',id);if(g)return g;
   const x=z.object({outcome:z.enum(['POSITIVE','NEUTRAL','OBJECTION','NOT_INTERESTED','UNSUBSCRIBE','BOUNCE','UNKNOWN']).optional(),milestone:z.enum(['DEMO','PAID']).optional()}).strict()
    .refine(v=>!!v.outcome||!!v.milestone).parse(b);
   return json(await rpc(db,'set_outreach_outcome',{p_candidate_id:id,p_outcome:x.outcome??null,p_milestone:x.milestone??null}));
  }
  return json({error:'Route ou action non disponible'},404);
 }catch(e){
  if(e instanceof z.ZodError)return json({error:'Requête invalide.'},400);
  if(String((e as Error)?.message).includes('ENTITLEMENT')||String((e as Error)?.message).includes('BETA_ACCESS'))return json({error:'Accès requis.'},402);
  return refuse(json,e);
 }
}
