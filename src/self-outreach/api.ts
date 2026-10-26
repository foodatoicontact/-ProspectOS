// Self-Outreach routes (/api/v1/self-outreach/…) — members of an organization listed in SELF_OUTREACH_ORG_IDS, with
// SELF_OUTREACH_ENABLED on. Every write goes through a migration-035 function as the member (RLS); nothing here sends
// an email (sending is the cron job's, behind SELF_OUTREACH_SEND_ENABLED). Errors never carry configuration values.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {configurationReport,selfOutreachEnabled,selfOutreachOrganizations,outreachScoreThreshold,messageDomain,type Env} from './config.ts';
import {checkContact} from './contact.ts';
import {outreachScore,scoresPayload} from './score.ts';
import {generateInitial,checkHumanEdit} from './message.ts';
import {loadCandidateSource} from './source.ts';
import {generateBookingReply,checkBookingText,normalizeBookingUrl} from './booking.ts';
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
 outreach_booking_url_missing:['Ajoutez d’abord le lien de prise de rendez-vous de la campagne.',409],
 outreach_candidate_not_bookable:['Le lien de rendez-vous ne s’envoie qu’après une réponse marquée positive.',409],
 outreach_booking_link_missing:['Le message doit contenir le lien de rendez-vous actuel de la campagne.',422],
 outreach_booking_already_sent:['La réponse avec le lien de rendez-vous a déjà été validée ou envoyée.',409],
 outreach_meeting_needs_reply:['Un rendez-vous ne s’enregistre qu’après une réponse du prospect.',409],
 outreach_meeting_invalid_time:['Date de rendez-vous hors limites (60 jours avant à un an après).',422],
 outreach_meeting_not_scheduled:['Ce rendez-vous n’est plus planifié.',409],
 outreach_meeting_in_future:['Un rendez-vous ne peut être marqué tenu ou manqué qu’une fois passé.',409],
 outreach_meetings_one_scheduled:['Ce prospect a déjà un rendez-vous planifié.',409],
 outreach_campaigns_booking_url_check:['Lien de rendez-vous invalide (https uniquement, sans ponctuation finale).',422],
};
function refuse(json:Json,e:unknown){const msg=String((e as {message?:string;cause?:{message?:string}})?.cause?.message??(e as {message?:string})?.message??'');
 for(const [k,[error,status]] of Object.entries(KNOWN))if(msg.includes(k))return json({error,code:k.toUpperCase()},status);
 if(/not found/i.test(msg))return json({error:'Introuvable.'},404);
 return json({error:'Opération refusée : vérifiez vos droits et les données.'},400)}
async function rpc(db:SupabaseClient,fn:string,args:Record<string,unknown>){const {data,error}=await db.rpc(fn,args);if(error)throw Error(error.message);return data}


// The BOOKING draft for one candidate: the campaign's link, the contact's first name, the original subject. Returns the
// database's answer, or a refusal code (no link, unsafe text) — never a weaker text.
async function draftBooking(db:SupabaseClient,env:Env,candidateId:string):Promise<{status:'DRAFTED'|'ALREADY';message:unknown}|{status:'NO_LINK'|'REFUSED';reason:string}>{
 const k=await checked(db.from('outreach_candidates').select('id,prospects(name),outreach_contacts(contact_name),outreach_campaigns(booking_url),outreach_messages(sequence,subject)').eq('id',candidateId).single()) as any;
 const url=normalizeBookingUrl(k?.outreach_campaigns?.booking_url);if(!url)return {status:'NO_LINK',reason:'OUTREACH_BOOKING_URL_MISSING'};
 const initial=(k.outreach_messages??[]).find((m:any)=>m.sequence===0);
 const d=generateBookingReply({contactName:k.outreach_contacts?.contact_name??'',senderName:(env.OUTREACH_FROM_NAME??'').trim(),bookingUrl:url,originalSubject:initial?.subject??'',company:k.prospects?.name??''});
 if(!d.ok)return {status:'REFUSED',reason:d.reason};
 const r=await rpc(db,'create_outreach_booking_reply',{p_candidate_id:candidateId,p_subject:d.subject,p_content:d.text});
 return {status:r?.already?'ALREADY':'DRAFTED',message:r};
}

// One candidate: its company's source (signal, evidence, offer), the explained score, the generated message, then the
// database function (which re-checks the signal, the evidence, the suppression list and the campaign).
async function createCandidate(db:SupabaseClient,deps:SelfOutreachDeps,json:Json,id:string,x:{campaign_id:string;contact_id:string;signal_id:string}):Promise<Response>{
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
const CONTACT_REFUSAL:Record<string,string>={EMAIL_INVALID:'Adresse email invalide.',EMAIL_SOURCE_NOT_ALLOWED:'Source de l’email non reconnue.',
 EMAIL_NOT_PROFESSIONAL:'Adresse de messagerie gratuite (Gmail, Outlook…) : une adresse professionnelle est requise.',
 EMAIL_ROLE_MAILBOX:'Adresse générique (contact@, info@…) : il faut l’adresse d’une personne.',CONTACT_INCOMPLETE:'Nom et rôle requis.',
 ROLE_SOURCE_REQUIRED:'Lien de la page où le rôle est indiqué requis.',EMAIL_SOURCE_URL_REQUIRED:'Lien de la page où l’email est publié requis.',
 EMAIL_NOT_IN_SOURCE:'L’extrait doit contenir l’adresse email telle qu’elle est écrite sur la page.'};

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
    const rows=await checked(db.from('outreach_candidates').select('*,prospects(name),outreach_contacts(contact_name,contact_role,email,email_source,email_source_url,email_verified_at,role_source_url),outreach_messages(*),outreach_meetings(*),outreach_campaigns(booking_url)')
     .eq('project_id',id).in('status',['NEEDS_REVIEW','READY_TO_SEND','SENDING','SENT','REPLIED']).order('outreach_score',{ascending:false}).limit(100));
    const signalIds=[...new Set((rows??[]).map((r:any)=>r.signal_id))];
    const evIds=[...new Set((rows??[]).flatMap((r:any)=>r.evidence_ids??[]))];
    const signals=signalIds.length?await checked(db.from('signals').select('id,title,excerpt,source_url,source_domain,event_date,published_at,status').in('id',signalIds)):[];
    const evidence=evIds.length?await checked(db.from('evidence').select('id,criterion,value,status,source_url,excerpt,observed_at').in('id',evIds)):[];
    return json({items:rows??[],signals,evidence,now:deps.now().toISOString()});
   }
   if(method==='GET'&&sub==='metrics')return json(await rpc(db,'outreach_metrics',{p_project_id:id}));
   if(method==='GET'&&sub==='campaigns')return json({items:await checked(db.from('outreach_campaigns').select('id,name,status,booking_url,followup_enabled,followup_delay_days').eq('project_id',id).order('created_at',{ascending:true}))});
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
    return await createCandidate(db,deps,json,id,x);
   }
   // Every VERIFIED signal of the project's companies, with the company, its existing outreach contacts and whether it
   // is already in an active outreach: what "Préparer un envoi" can start from. Read as the member (RLS).
   if(method==='GET'&&sub==='sources'){
    const sigs=await checked(db.from('signals').select('id,prospect_id,title,excerpt,source_url,source_domain,event_date,published_at,observed_at').eq('project_id',id).eq('status','VERIFIED').order('observed_at',{ascending:false}).limit(200));
    const pids=[...new Set((sigs??[]).map((r:any)=>r.prospect_id))];
    const prospects=pids.length?await checked(db.from('prospects').select('id,name,website').in('id',pids)):[];
    const contacts=pids.length?await checked(db.from('outreach_contacts').select('id,prospect_id,contact_name,contact_role,email,email_source').in('prospect_id',pids)):[];
    const active=pids.length?await checked(db.from('outreach_candidates').select('prospect_id,status').in('prospect_id',pids).in('status',['DISCOVERED','QUALIFIED','NEEDS_REVIEW','APPROVED','READY_TO_SEND','SENDING','SENT','REPLIED'])):[];
    return json({items:(prospects??[]).map((p:any)=>({prospect:p,signals:(sigs??[]).filter((s:any)=>s.prospect_id===p.id),contacts:(contacts??[]).filter((c:any)=>c.prospect_id===p.id),
     active:(active??[]).some((a:any)=>a.prospect_id===p.id)})).sort((a:any,b:any)=>Number(a.active)-Number(b.active))});
   }
   // "Préparer un envoi": the project's campaign (created once), the contact (an existing one, or a new one with its
   // provenance, checked like POST contacts), then the candidate and its generated message (same path as POST candidates).
   // Nothing is sent: a candidate at or above the threshold lands in the review queue; below it, it is kept with its score.
   if(method==='POST'&&sub==='prepare'){
    await deps.requireEntitlement();
    const x=z.object({signal_id:uuid,contact_id:uuid.optional(),contact:z.object({prospect_id:uuid,contact_name:z.string().max(120),contact_role:z.string().max(120),role_source_url:z.string().max(2048),
     email:z.string().max(254),email_source:z.string().max(40),email_source_url:z.string().max(2048).nullable().optional(),email_source_excerpt:z.string().max(1000).nullable().optional()}).strict().optional()})
     .strict().refine(v=>!!v.contact_id!==!!v.contact,'contact_id or contact').parse(b);
    const sig=await checked(db.from('signals').select('id,prospect_id,project_id,status').eq('id',x.signal_id).single());
    if(sig.project_id!==id)return json({error:'Signal hors projet.'},409);
    if(sig.status!=='VERIFIED')return json({error:'Le signal doit être vérifié par une personne avant tout envoi.',code:'OUTREACH_SIGNAL_NOT_VERIFIED'},409);
    let contactId=x.contact_id??null;
    if(x.contact){
     if(x.contact.prospect_id!==sig.prospect_id)return json({error:'Ce contact n’appartient pas à l’entreprise du signal.',code:'OUTREACH_SIGNAL_NOT_OF_COMPANY'},409);
     const c=checkContact(x.contact);if(!c.ok)return json({error:CONTACT_REFUSAL[c.reason]??'Contact refusé : provenance de l’email ou du rôle insuffisante.',code:c.reason},422);
     const k=c.contact;
     const existing=await checked(db.from('outreach_contacts').select('id,prospect_id').eq('project_id',id).eq('email',k.email).limit(1));
     if(existing?.length){if(existing[0].prospect_id!==sig.prospect_id)return json({error:'Cette adresse est déjà le contact d’une autre entreprise.',code:'OUTREACH_CONTACT_OTHER_COMPANY'},409);contactId=existing[0].id}
     else contactId=(await rpc(db,'add_outreach_contact',{p_prospect_id:k.prospect_id,p_name:k.contact_name,p_role:k.contact_role,p_role_source_url:k.role_source_url,p_email:k.email,
      p_email_source:k.email_source,p_email_source_url:k.email_source_url??null,p_email_source_excerpt:k.email_source_excerpt??null}))?.id;
    }
    const camps=await checked(db.from('outreach_campaigns').select('id,status').eq('project_id',id).eq('status','ACTIVE').order('created_at',{ascending:true}).limit(1));
    const campaignId=camps?.[0]?.id??(await rpc(db,'create_outreach_campaign',{p_project_id:id,p_name:'Prospection',p_followup_enabled:true,p_followup_delay_days:5}))?.id;
    return await createCandidate(db,deps,json,id,{campaign_id:campaignId,contact_id:contactId!,signal_id:x.signal_id});
   }
   if(method==='POST'&&sub==='suppressions'){
    const x=z.object({email:z.string().trim().max(254),reason:z.enum(['OPT_OUT','MANUAL','COMPLIANCE'])}).strict().parse(b);
    return json(await rpc(db,'suppress_outreach_email',{p_project_id:id,p_email:x.email,p_reason:x.reason}));
   }
  }
  if(resource==='messages'&&id&&sub==='review'&&method==='POST'){
   const g=await gate('outreach_messages',id);if(g)return g;
   const x=z.object({decision:z.enum(['APPROVE','EDIT','REJECT']),subject:z.string().trim().min(3).max(140).optional(),content:z.string().min(20).max(2000).optional()}).strict().parse(b);
   const m=await checked(db.from('outreach_messages').select('id,candidate_id,kind,generated_content,human_edit').eq('id',id).single());
   if(x.decision==='EDIT'&&m.kind==='BOOKING'){
    if(!x.content)return json({error:'Texte requis.'},400);
    const k=await checked(db.from('outreach_candidates').select('prospects(name),outreach_contacts(contact_name),outreach_campaigns(booking_url)').eq('id',m.candidate_id).single()) as any;
    const check=checkBookingText(x.content,{company:k.prospects?.name??'',contactName:k.outreach_contacts?.contact_name??'',senderName:(deps.env.OUTREACH_FROM_NAME??'').trim()},k.outreach_campaigns?.booking_url??'');
    if(!check.ok)return json({error:'Le texte doit garder le lien de rendez-vous et ne rien affirmer d’autre (ni chiffre, ni autre lien, ni formule interdite).',code:check.reason},422);
   }else if(x.decision==='EDIT'){
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
   const r=await rpc(db,'set_outreach_outcome',{p_candidate_id:id,p_outcome:x.outcome??null,p_milestone:x.milestone??null});
   // POSITIVE on a reply → the booking reply is drafted at once (still a DRAFT a person approves). Its absence never
   // undoes the outcome: no link yet, or a candidate that cannot be booked, is reported and left as it is.
   if(x.outcome!=='POSITIVE')return json(r);
   try{return json({...r,booking:await draftBooking(db,deps.env,id)})}
   catch(e){const msg=String((e as Error)?.message??'');const code=Object.keys(KNOWN).find(k=>msg.includes(k));return json({...r,booking:{status:'REFUSED',reason:code?code.toUpperCase():'BOOKING_NOT_DRAFTED'}})}
  }
  if(resource==='candidates'&&id&&sub==='booking'&&method==='POST'){
   const g=await gate('outreach_candidates',id);if(g)return g;
   z.object({}).strict().parse(b);
   const d=await draftBooking(db,deps.env,id);
   if(d.status==='NO_LINK')return json({error:KNOWN.outreach_booking_url_missing[0],code:d.reason},409);
   if(d.status==='REFUSED')return json({error:'Aucun message de rendez-vous sûr ne peut être généré.',code:d.reason},422);
   return json(d,d.status==='DRAFTED'?201:200);
  }
  if(resource==='candidates'&&id&&sub==='meetings'&&method==='POST'){
   const g=await gate('outreach_candidates',id);if(g)return g;
   const x=z.object({scheduled_for:z.string().datetime({offset:true})}).strict().parse(b);
   return json(await rpc(db,'record_outreach_meeting',{p_candidate_id:id,p_scheduled_for:x.scheduled_for}),201);
  }
  if(resource==='meetings'&&id&&sub==='status'&&method==='POST'){
   const g=await gate('outreach_meetings',id);if(g)return g;
   const x=z.object({status:z.enum(['HELD','NO_SHOW','CANCELLED'])}).strict().parse(b);
   return json(await rpc(db,'set_outreach_meeting_status',{p_meeting_id:id,p_status:x.status}));
  }
  if(resource==='campaigns'&&id&&sub==='booking'&&method==='POST'){
   const g=await gate('outreach_campaigns',id);if(g)return g;
   const x=z.object({booking_url:z.string().max(300).nullable()}).strict().parse(b);
   const url=x.booking_url===null||x.booking_url.trim()===''?null:normalizeBookingUrl(x.booking_url);
   if(x.booking_url!==null&&x.booking_url.trim()!==''&&!url)return json({error:KNOWN.outreach_campaigns_booking_url_check[0],code:'OUTREACH_BOOKING_URL_INVALID'},422);
   return json(await rpc(db,'set_outreach_campaign_booking',{p_campaign_id:id,p_booking_url:url}));
  }
  return json({error:'Route ou action non disponible'},404);
 }catch(e){
  if(e instanceof z.ZodError)return json({error:'Requête invalide.'},400);
  if(String((e as Error)?.message).includes('ENTITLEMENT')||String((e as Error)?.message).includes('BETA_ACCESS'))return json({error:'Accès requis.'},402);
  return refuse(json,e);
 }
}
