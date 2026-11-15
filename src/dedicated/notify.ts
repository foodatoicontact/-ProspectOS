import type {MailTransport} from '../self-outreach/transport.ts';
import {eur,monthLabel} from './model.ts';
// Monthly job of the veille dédiée (migration 043): on the 1st (and every day after, idempotent) the statements of the
// previous month are generated; from the 5th, every statement still not validated by its client is announced ONCE to the
// administrator by e-mail. Without SMTP configuration the statements are still generated and the dashboard shows the
// alert; a failed send is released so that the next run tries again.
export type Reminder={id:string;month:string;signed_count:number;amount_ht_cents:number;contract:string;organization:string};
export function reminderEmail(r:Reminder,siteUrl:string):{subject:string;text:string}{
 const clean=(s:string)=>s.replace(/[\r\n]+/g,' ').slice(0,160);
 return {subject:`Relevé ${monthLabel(r.month)} non validé — ${clean(r.organization)}`,
  text:`Bonjour,\n\nLe relevé de ${monthLabel(r.month)} du contrat « ${clean(r.contract)} » (${clean(r.organization)}) n’a pas été validé par le client au 5 du mois.\n\nSignatures déclarées : ${r.signed_count}\nMontant HT : ${eur(r.amount_ht_cents)}\n\nLe détail et le journal sont dans ProspectOS, menu du compte, « Veille dédiée — suivi » :\n${siteUrl}\n\nVous recevez ce message une seule fois par relevé.\n\nProspectOS`};
}
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export async function runDedicatedStatements(o:{rpc:Rpc;month:string;notifyTo:string;siteUrl:string;messageDomain:string|null;
 transport:(()=>Promise<MailTransport>)|null;id:()=>string}):Promise<{month:string;generated:number;reminders:number;sent:number;failed:number}>{
 const g=await o.rpc('generate_dedicated_statements',{p_month:o.month}) as {generated:number};
 const due=await o.rpc('claim_dedicated_reminders',{}) as Reminder[];
 let sent=0,failed=0;
 if(due.length){
  let transport:MailTransport|null=null;
  try{transport=o.transport&&o.messageDomain?await o.transport():null}catch{transport=null}
  try{
   for(const r of due){
    const mail=reminderEmail(r,o.siteUrl);
    let ok=false;
    if(transport){try{ok=(await transport.send({to:o.notifyTo,subject:mail.subject,text:mail.text,messageId:`<dedicated-${o.id()}@${o.messageDomain}>`})).kind==='SENT'}catch{ok=false}}
    if(ok)sent++;else{failed++;await o.rpc('release_dedicated_reminder',{p_statement_id:r.id})}
   }
  }finally{await transport?.close().catch(()=>{})}
 }
 return {month:o.month,generated:g.generated,reminders:due.length,sent,failed};
}
