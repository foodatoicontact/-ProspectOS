// Self-Outreach reply detection — an IMAP abstraction (read-only: messages are never moved, flagged or answered) and
// a conservative reading of each email: headers for matching (Message-ID / In-Reply-To / References), delivery reports
// (DSN) for bounces, Auto-Submitted for out-of-office, and a rule-based PROPOSED outcome read on the reply's own text
// only (the quoted original is removed first: our own "répondez STOP" is never read as the prospect's). The matching
// itself, and its effects, happen atomically in the database (record_outreach_inbound). Nothing ever replies.
import {imapConfig,type Env} from './config.ts';
export type InboundMail={mailbox_key:string;from_email:string;subject:string|null;in_reply_to:string|null;references_ids:string[];received_at:string|null;
 auto_submitted:boolean;is_dsn:boolean;dsn_status:string|null;dsn_recipient:string|null;body_excerpt:string|null};
export interface Inbox{readonly name:string;fetchRecent(sinceDays:number,limit:number):Promise<InboundMail[]>}
export type Proposed={outcome:'POSITIVE'|'NEUTRAL'|'OBJECTION'|'NOT_INTERESTED'|'UNSUBSCRIBE'|'BOUNCE'|'UNKNOWN';basis:string};

const f=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’`]/g,"'").toLowerCase();
// The reply above the quoted original.
export function ownText(body:string):string{
 const lines=body.replace(/\r/g,'').split('\n');const out:string[]=[];
 for(const l of lines){
  if(/^\s*>/.test(l))break;
  if(/^\s*(le .{3,80} a ecrit\s*:|on .{3,80} wrote\s*:|-{2,}\s*(original message|message d.origine)|de\s*:.*@|from\s*:.*@)/i.test(f(l)))break;
  out.push(l);
 }
 return out.join('\n').trim();
}
const RULES:[Proposed['outcome'],RegExp,string][]=[
 ['UNSUBSCRIBE',/(^|\n)\s*stop\s*\.?\s*($|\n)|desinscri|desabonn|unsubscribe|ne plus (me )?(recevoir|contacter|ecrire)|retirez.moi|supprimez.moi|remove me|opt.?out|ne m.ecrivez plus|plus de mails?/,'opt-out wording'],
 ['NOT_INTERESTED',/pas interess|not interested|aucun interet|ca ne nous interesse pas|non merci|no thanks|pas pour nous/,'refusal wording'],
 ['OBJECTION',/pas le moment|plus tard|deja (un|une|equipe|outil|solution)|already (have|use)|budget|trop cher|pas prioritaire|next quarter|trimestre prochain/,'objection wording'],
 ['POSITIVE',/interess|volontiers|avec plaisir|bonne idee|on peut en parler|disponible|dispo |appel|call|rendez.vous|\brdv\b|\bdemo\b|creneau|calendly|happy to|let.s talk|sounds good/,'interest wording'],
];
export function proposeOutcome(m:Pick<InboundMail,'is_dsn'|'dsn_status'|'auto_submitted'|'body_excerpt'|'subject'>):Proposed{
 if(m.is_dsn)return {outcome:m.dsn_status?.startsWith('5')?'BOUNCE':'UNKNOWN',basis:'delivery status notification'};
 const t=f(`${m.subject??''}\n${ownText(m.body_excerpt??'')}`);
 if(m.auto_submitted)return {outcome:'UNKNOWN',basis:'auto-submitted'};
 for(const [outcome,re,basis] of RULES)if(re.test(t))return {outcome,basis};
 return {outcome:t.trim()?'NEUTRAL':'UNKNOWN',basis:'no rule matched'};
}

const addr=(v:unknown):string=>{const s=typeof v==='string'?v:'';const m=/<([^<>@\s]+@[^<>\s]+)>/.exec(s)??/([^\s<>"]+@[^\s<>"]+)/.exec(s);return (m?.[1]??'').toLowerCase()};
const ids=(v:unknown):string[]=>(Array.isArray(v)?v.join(' '):typeof v==='string'?v:'').match(/<[^<>\s]+>/g)??[];
// One raw RFC 822 message → InboundMail (mailparser). mailbox_key: the Message-ID header, else IMAP uidvalidity:uid.
export async function parseInbound(source:Buffer|string,fallbackKey:string):Promise<InboundMail>{
 const {simpleParser}=await import('mailparser');
 const p=await simpleParser(source);const h=p.headers;
 const ct=h.get('content-type') as {value?:string;params?:Record<string,string>}|undefined;
 const report=/multipart\/report/i.test(ct?.value??'')&&/delivery-status/i.test(ct?.params?.['report-type']??'');
 const text=(p.text??'').slice(0,20000);
 const status=/Status:\s*([245]\.\d{1,3}\.\d{1,3})/i.exec(text)?.[1]??null;
 const recipient=/Final-Recipient:\s*rfc822;\s*([^\s]+@[^\s]+)/i.exec(text)?.[1]??/Original-Recipient:\s*rfc822;\s*([^\s]+@[^\s]+)/i.exec(text)?.[1]??null;
 const fromHeader=p.from?.value?.[0]?.address??addr(p.from?.text);
 const isDsn=report||(/mailer-daemon|postmaster/i.test(fromHeader??'')&&!!status);
 const auto=String(h.get('auto-submitted')??'no').toLowerCase();
 return {mailbox_key:(p.messageId??fallbackKey).slice(0,400),from_email:(fromHeader??'').toLowerCase().slice(0,254),subject:p.subject?.slice(0,300)??null,
  in_reply_to:ids(p.inReplyTo)[0]??null,references_ids:ids(p.references).slice(0,50),received_at:p.date?p.date.toISOString():null,
  auto_submitted:auto!=='no'&&auto!=='',is_dsn:isDsn,dsn_status:isDsn?status:null,dsn_recipient:isDsn&&recipient?recipient.toLowerCase().slice(0,254):null,
  body_excerpt:(isDsn?text:ownText(text)).slice(0,2000)||null};
}

export async function createImapInbox(env:Env):Promise<Inbox>{
 const cfg=imapConfig(env);if(!cfg)throw Error('IMAP_NOT_CONFIGURED');
 const {ImapFlow}=await import('imapflow');
 return {name:'imap',async fetchRecent(sinceDays,limit){
  const client=new ImapFlow({host:cfg.host,port:cfg.port,secure:cfg.port===993,auth:{user:cfg.user,pass:cfg.password},logger:false,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
   socketTimeout:30000});
  const out:InboundMail[]=[];
  try{
   await client.connect();
   const box=await client.mailboxOpen('INBOX',{readOnly:true});
   const since=new Date(Date.now()-sinceDays*86400000);
   const uids=((await client.search({since},{uid:true}))||[]).slice(-limit);
   for await(const msg of client.fetch(uids,{source:true,uid:true},{uid:true})){
    if(!msg.source)continue;
    out.push(await parseInbound(msg.source,`imap:${box.uidValidity}:${msg.uid}`));
   }
  }catch(e){throw Error(`IMAP_${String((e as {code?:string})?.code??'FAILED').replace(/[^A-Z_]/gi,'').toUpperCase().slice(0,30)||'FAILED'}`)}
  finally{try{await client.logout()}catch{/* closed */}}
  return out;
 }};
}
export class MockInbox implements Inbox{readonly name='mock';mails:InboundMail[];constructor(mails:InboundMail[]=[]){this.mails=mails} async fetchRecent(){return this.mails}}
