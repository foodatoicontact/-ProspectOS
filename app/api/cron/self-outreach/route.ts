import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {selfOutreachEnabled,selfOutreachSendEnabled,selfOutreachOrganizations,maxNewOutreachPerDay,smtpConfig,imapConfig} from '../../../../src/self-outreach/config';
import {createSmtpTransport} from '../../../../src/self-outreach/transport';
import {createImapInbox} from '../../../../src/self-outreach/inbox';
import {processSendQueue,pollReplies,prepareFollowUps,type Rpc} from '../../../../src/self-outreach/worker';
import {loadCandidateSource} from '../../../../src/self-outreach/source';
import {generateFollowUp} from '../../../../src/self-outreach/message';
// Self-Outreach jobs (docs/SELF_OUTREACH.md). Same authorization as the signals cron: "Authorization: Bearer
// <CRON_SECRET>". Nothing runs unless SELF_OUTREACH_ENABLED; nothing is SENT unless SELF_OUTREACH_SEND_ENABLED and the
// SMTP configuration is complete. Scheduled once a day in vercel.json (approved 2026-10-26); with the send flag off it
// only reads replies and drafts follow-ups for approval.
// The response is a summary of counts: no address, no content, no configuration value.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Non configuré.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 if(!selfOutreachEnabled(process.env))return json({skipped:'SELF_OUTREACH_DISABLED'});
 const orgs=selfOutreachOrganizations(process.env);
 if(!orgs.length)return json({skipped:'NO_ORGANIZATION'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const rpc:Rpc=async(fn,args)=>{const {data,error}=await admin.rpc(fn,args);if(error)throw Error('RPC_FAILED');return data};
 const log=(event:Record<string,unknown>)=>console.info(JSON.stringify(event));
 const out:Record<string,unknown>={};
 try{
  out.replies=imapConfig(process.env)?await pollReplies({rpc,inbox:await createImapInbox(process.env),sinceDays:7,limit:200,log}):{skipped:'IMAP_NOT_CONFIGURED'};
 }catch(e){out.replies={error:String((e as Error).message).replace(/[^A-Z_]/g,'').slice(0,40)||'IMAP_FAILED'}}
 try{
  out.followups=await prepareFollowUps({rpc,organizationIds:orgs,log,
   load:async candidateId=>{
    const {data:k}=await admin.from('outreach_candidates').select('prospect_id,signal_id,evidence_ids,outreach_contacts(contact_name)').eq('id',candidateId).single();
    if(!k)return null;const src=await loadCandidateSource(admin,k.prospect_id,k.signal_id,new Date());if(!src)return null;
    return {company:src.prospect.name,contactName:(k as any).outreach_contacts?.contact_name??'',offer:src.project.offer,signal:src.signal,
     evidence:src.evidence.filter((e:any)=>(k.evidence_ids??[]).includes(e.id)),commercialType:src.classified?.commercial_type??'OTHER'};
   },
   generate:s=>generateFollowUp({...s,senderName:(process.env.OUTREACH_FROM_NAME??'').trim()})});
 }catch{out.followups={error:'FOLLOWUPS_FAILED'}}
 // Replies first, sends last: a reply read in this run stops a follow-up before it could be claimed.
 if(!selfOutreachSendEnabled(process.env))out.sends={skipped:'SEND_DISABLED'};
 else if(!smtpConfig(process.env))out.sends={skipped:'SMTP_NOT_CONFIGURED'};
 else{
  const transport=await createSmtpTransport(process.env);
  try{out.sends=await processSendQueue({rpc,transport,organizationIds:orgs,sender:smtpConfig(process.env)!.fromEmail,limit:5,dailyCap:maxNewOutreachPerDay(process.env),log})}
  catch{out.sends={error:'SEND_QUEUE_FAILED'}}
  finally{await transport.close()}
 }
 return json(out);
}
