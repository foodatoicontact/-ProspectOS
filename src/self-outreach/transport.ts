// Self-Outreach email transport — an SMTP abstraction; IONOS is only a configuration of it (host / port / user), never
// a dependency of the rest of the engine. The real transport can only be built when SELF_OUTREACH_SEND_ENABLED (and
// SELF_OUTREACH_ENABLED) are on and the SMTP configuration is complete; otherwise createSmtpTransport throws and no
// code path can send. Errors are reduced to a code: never a server response, a host, a user or a password.
import {selfOutreachSendEnabled,smtpConfig,type Env,type SmtpConfig} from './config.ts';
// unsubscribeUrl: a signed one-click link (RFC 8058) offered next to the mailto (the morning recap, src/digest); the
// prospecting emails keep the mailto alone.
export type OutgoingMail={to:string;subject:string;text:string;messageId:string;inReplyTo?:string|null;unsubscribeUrl?:string|null};
// SENT accepted by the server · RETRY not accepted, temporary · FAILED not accepted, permanent · BOUNCED recipient
// refused · UNCERTAIN the server may have accepted it (never re-sent automatically) · AUTH authorization problem: stop.
export type SendResult={kind:'SENT';providerMessageId:string|null}|{kind:'RETRY';code:string;retryAfterSeconds:number}|{kind:'FAILED'|'BOUNCED'|'UNCERTAIN'|'AUTH';code:string};
export interface MailTransport{readonly name:string;send(mail:OutgoingMail):Promise<SendResult>;close():Promise<void>}

type SmtpErr={code?:string;responseCode?:number;command?:string};
// Where the SMTP conversation failed decides whether the message could have been accepted.
export function classifySmtpError(e:unknown):SendResult{
 const err=(e&&typeof e==='object'?e:{}) as SmtpErr;const rc=err.responseCode??0;const cmd=(err.command??'').toUpperCase();const code=(err.code??'').toUpperCase();
 if(code==='EAUTH'||rc===530||rc===534||rc===535||rc===454&&cmd.startsWith('AUTH'))return {kind:'AUTH',code:'SMTP_AUTH'};
 if(cmd.startsWith('RCPT')&&rc>=550&&rc<560)return {kind:'BOUNCED',code:`SMTP_${rc}`};
 if(rc>=500&&rc<600)return {kind:'FAILED',code:`SMTP_${rc}`};
 if(rc>=400&&rc<500)return {kind:'RETRY',code:`SMTP_${rc}`,retryAfterSeconds:900};
 // No reply code: a connection / TLS / DNS failure before the message was handed over is safe to retry; a timeout or a
 // lost socket while (or after) sending DATA may have delivered it.
 if(cmd==='DATA'||cmd==='API'||code==='ETIMEDOUT'&&(cmd===''||cmd==='DATA'))return {kind:'UNCERTAIN',code:code?`SMTP_${code.replace(/^E/,'')}`:'SMTP_UNKNOWN'};
 if(['ECONNECTION','EDNS','ESOCKET','ETLS','ECONNREFUSED','EHOSTUNREACH','ENOTFOUND','ETIMEDOUT','EGREETING'].includes(code))return {kind:'RETRY',code:`SMTP_${code.replace(/^E/,'')}`,retryAfterSeconds:900};
 return {kind:'UNCERTAIN',code:'SMTP_UNKNOWN'};
}

export async function createSmtpTransport(env:Env):Promise<MailTransport>{
 if(!selfOutreachSendEnabled(env))throw Error('SEND_DISABLED');
 const cfg=smtpConfig(env);if(!cfg)throw Error('SMTP_NOT_CONFIGURED');
 return smtpTransportFrom(cfg,await import('nodemailer'));
}
type Nodemailer={createTransport:(o:Record<string,unknown>)=>{sendMail:(m:Record<string,unknown>)=>Promise<{messageId?:string;rejected?:unknown[];accepted?:unknown[]}>;close:()=>void}};
export function smtpTransportFrom(cfg:SmtpConfig,nodemailer:Nodemailer|{default:Nodemailer}):MailTransport{
 const nm='createTransport' in nodemailer?nodemailer:nodemailer.default;
 const t=nm.createTransport({host:cfg.host,port:cfg.port,secure:cfg.secure,requireTLS:!cfg.secure,auth:{user:cfg.user,pass:cfg.password},
  connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},logger:false,debug:false,pool:false});
 return {name:'smtp',
  async send(m){
   try{
    const info=await t.sendMail({from:{name:cfg.fromName||cfg.fromEmail,address:cfg.fromEmail},to:m.to,subject:m.subject,text:m.text,messageId:m.messageId,
     ...(m.inReplyTo?{inReplyTo:m.inReplyTo,references:[m.inReplyTo]}:{}),
     headers:m.unsubscribeUrl&&/^https:\/\/[^\s<>,]+$/.test(m.unsubscribeUrl)
      ?{'List-Unsubscribe':`<${m.unsubscribeUrl}>, <mailto:${cfg.fromEmail}?subject=STOP>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}
      :{'List-Unsubscribe':`<mailto:${cfg.fromEmail}?subject=STOP>`}});
    if((info.rejected??[]).length&&!(info.accepted??[]).length)return {kind:'BOUNCED',code:'SMTP_RECIPIENT_REJECTED'};
    return {kind:'SENT',providerMessageId:typeof info.messageId==='string'?info.messageId.slice(0,300):null};
   }catch(e){return classifySmtpError(e)}
  },
  async close(){try{t.close()}catch{/* nothing to release */}}};
}

// Tests and dry runs only: records what would be sent; never opens a socket.
export class MockTransport implements MailTransport{
 readonly name='mock';sent:OutgoingMail[]=[];private queue:SendResult[];
 constructor(results:SendResult[]=[]){this.queue=[...results]}
 async send(m:OutgoingMail):Promise<SendResult>{const r=this.queue.shift()??{kind:'SENT',providerMessageId:`mock-${this.sent.length+1}`};if(r.kind==='SENT')this.sent.push(m);return r}
 async close(){}
}
