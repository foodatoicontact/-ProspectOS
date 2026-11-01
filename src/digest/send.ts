// Morning recap — one batch (app/api/cron/morning-digest). Claims today's subscribers (migration 040), reads each one's
// new signals, sends one email when there is something new, records the result. A failed send is not recorded as sent:
// the same signals are offered again the next morning. An SMTP authorization problem stops the batch at once.
import {randomUUID} from 'node:crypto';
import type {MailTransport} from '../self-outreach/transport.ts';
import {digestEmail,parisDayStart,unsubscribeUrl,type DigestSignal} from './morning.ts';

export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
type Claimed={user_id:string;email:string;since:string;claimed_at:string};
export type DigestSummary={claimed:number;sent:number;nothing_new:number;failed:number;stopped:string|null};
const EMAIL=/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export async function runMorningDigest(d:{rpc:Rpc;transport:()=>Promise<MailTransport>;secret:string;siteUrl:string;contact:string;messageDomain:string;
 now:()=>Date;batch?:number;budgetMs?:number;log?:(e:Record<string,string|number|null>)=>void}):Promise<DigestSummary>{
 const started=Date.now(),budget=d.budgetMs??45000;
 const claimed=await d.rpc('claim_morning_digests',{p_limit:d.batch??50,p_day_start:parisDayStart(d.now()).toISOString()}) as Claimed[]|null;
 const rows=Array.isArray(claimed)?claimed:[];
 const summary:DigestSummary={claimed:rows.length,sent:0,nothing_new:0,failed:0,stopped:null};
 if(!rows.length)return summary;
 let transport:MailTransport|null=null;
 try{
  for(const r of rows){
   if(Date.now()-started>=budget){summary.stopped='TIME_BUDGET_REACHED';break}
   const signals=(await d.rpc('morning_digest_signals',{p_user:r.user_id,p_since:r.since,p_limit:30}) as DigestSignal[]|null)??[];
   const mail=EMAIL.test(r.email)?digestEmail(signals,{siteUrl:d.siteUrl,unsubscribe:unsubscribeUrl(d.siteUrl,d.secret,r.user_id),contact:d.contact}):null;
   // Nothing new (or no usable address): checked, no email.
   if(!mail){await d.rpc('mark_morning_digest',{p_user:r.user_id,p_checked_at:r.claimed_at,p_sent:false});summary.nothing_new++;continue}
   transport??=await d.transport();
   const res=await transport.send({to:r.email,subject:mail.subject,text:mail.text,messageId:`<recap-${randomUUID()}@${d.messageDomain}>`,unsubscribeUrl:unsubscribeUrl(d.siteUrl,d.secret,r.user_id)});
   if(res.kind==='SENT'){await d.rpc('mark_morning_digest',{p_user:r.user_id,p_checked_at:r.claimed_at,p_sent:true});summary.sent++;continue}
   summary.failed++;d.log?.({event:'morning_digest_send_failed',kind:res.kind,code:'code' in res?res.code:null});
   if(res.kind==='AUTH'){summary.stopped='SMTP_AUTH';break}
  }
 }finally{await transport?.close()}
 return summary;
}
