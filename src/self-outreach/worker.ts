// Self-Outreach jobs (cron): every state change goes through the migration-035 functions (atomic, idempotent, safe
// when two workers run). Fail closed: anything ambiguous stops instead of sending.
//   processSendQueue  claim (daily cap, suppression, reply, lease) → check right before SMTP → send → complete.
//   pollReplies       read recent inbound mail → record (match + stop follow-ups / bounce / opt-out, atomically).
//   prepareFollowUps  follow-ups due → a DRAFT for a person to approve (never sent without approval).
import type {MailTransport,SendResult} from './transport.ts';
import {proposeOutcome,type Inbox} from './inbox.ts';
export type Rpc=(fn:string,args:Record<string,unknown>)=>Promise<any>;
export type Log=(event:Record<string,unknown>)=>void;
const RESULT:Record<SendResult['kind'],string>={SENT:'SENT',RETRY:'RETRY',FAILED:'FAILED',BOUNCED:'BOUNCED',UNCERTAIN:'UNCERTAIN',AUTH:'ABORTED'};

export async function processSendQueue(d:{rpc:Rpc;transport:MailTransport;organizationIds:string[];sender:string;limit:number;dailyCap:number;log:Log}){
 const summary={claimed:0,sent:0,retry:0,failed:0,bounced:0,uncertain:0,aborted:0,not_permitted:0,stopped:null as string|null};
 if(!d.organizationIds.length||d.dailyCap<=0)return {...summary,stopped:'NOTHING_ALLOWED'};
 const claimed:any[]=await d.rpc('claim_outreach_sends',{p_organization_ids:d.organizationIds,p_sender:d.sender,p_limit:d.limit,p_daily_cap:d.dailyCap,p_lease_seconds:300})??[];
 summary.claimed=claimed.length;
 for(const m of claimed){
  const complete=(result:string,extra:{provider?:string|null;code?:string|null;retry?:number}={})=>d.rpc('complete_outreach_send',{p_message_id:m.message_id,p_lease_token:m.lease_token,
   p_result:result,p_provider_message_id:extra.provider??null,p_error_code:extra.code??null,p_retry_after_seconds:extra.retry??null});
  if(summary.stopped){await complete('ABORTED',{code:summary.stopped});summary.aborted++;continue}
  let permitted=false;try{permitted=await d.rpc('outreach_send_permitted',{p_message_id:m.message_id,p_lease_token:m.lease_token})===true}catch{permitted=false}
  if(!permitted){summary.not_permitted++;try{await complete('ABORTED',{code:'NOT_PERMITTED'})}catch{/* lease already gone */}continue}
  let r:SendResult;
  try{r=await d.transport.send({to:m.to_email,subject:m.subject,text:m.content,messageId:m.rfc_message_id,inReplyTo:m.in_reply_to})}
  catch{r={kind:'UNCERTAIN',code:'TRANSPORT_THREW'}}
  const result=RESULT[r.kind];
  try{await complete(result,{provider:r.kind==='SENT'?r.providerMessageId:null,code:r.kind==='SENT'?null:r.code,retry:r.kind==='RETRY'?r.retryAfterSeconds:undefined})}
  catch{d.log({event:'self_outreach.complete_failed',message_id:m.message_id,result})} // the lease expires → UNCERTAIN, never re-sent
  if(r.kind==='SENT')summary.sent++;else if(r.kind==='RETRY')summary.retry++;else if(r.kind==='FAILED')summary.failed++;else if(r.kind==='BOUNCED')summary.bounced++;
  else if(r.kind==='UNCERTAIN')summary.uncertain++;else{summary.aborted++;summary.stopped='SMTP_AUTH'}
  d.log({event:'self_outreach.send',message_id:m.message_id,result,code:r.kind==='SENT'?null:r.code});
 }
 return summary;
}

export async function pollReplies(d:{rpc:Rpc;inbox:Inbox;sinceDays:number;limit:number;log:Log}){
 const summary={read:0,recorded:0,duplicates:0,matched:0,errors:0};
 const mails=await d.inbox.fetchRecent(d.sinceDays,d.limit);summary.read=mails.length;
 for(const m of mails){
  const p=proposeOutcome(m);
  try{
   const r=await d.rpc('record_outreach_inbound',{p:{...m,proposed_outcome:p.outcome,classification_basis:p.basis}});
   if(r?.duplicate)summary.duplicates++;else{summary.recorded++;if(r?.match_method&&r.match_method!=='NONE')summary.matched++}
  }catch{summary.errors++;d.log({event:'self_outreach.inbound_failed'})}
 }
 return summary;
}

export type FollowUpSource={company:string;contactName:string;offer:string;signal:any;evidence:any[];commercialType:any};
export async function prepareFollowUps(d:{rpc:Rpc;organizationIds:string[];load:(candidateId:string)=>Promise<FollowUpSource|null>;
 generate:(s:FollowUpSource)=>{ok:true;subject:string;text:string;evidence_refs:unknown;generation_meta:Record<string,unknown>}|{ok:false;reason:string};log:Log}){
 const summary={due:0,drafted:0,refused:0};
 if(!d.organizationIds.length)return summary;
 const due:any[]=await d.rpc('outreach_followups_due',{p_organization_ids:d.organizationIds,p_limit:20})??[];summary.due=due.length;
 for(const x of due){
  const src=await d.load(x.candidate_id);if(!src){summary.refused++;continue}
  const g=d.generate(src);if(!g.ok){summary.refused++;d.log({event:'self_outreach.followup_refused',reason:g.reason});continue}
  try{await d.rpc('create_outreach_followup',{p_candidate_id:x.candidate_id,p_subject:g.subject,p_content:g.text,p_evidence_refs:g.evidence_refs,p_generation_meta:g.generation_meta});summary.drafted++}
  catch{summary.refused++}
 }
 return summary;
}
