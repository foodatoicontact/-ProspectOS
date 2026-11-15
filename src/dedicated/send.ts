// Veille dédiée — the acceptance e-mails, sent from the request that recorded the acceptance (best effort: the journal
// already holds the acceptance). The SMTP transport is built here only when the existing SMTP configuration is complete;
// without it nothing is sent and the event is logged. Never called by the general API route for anything else.
import {randomUUID} from 'node:crypto';
import {smtpConfig} from '../self-outreach/config.ts';
import {smtpTransportFrom} from '../self-outreach/transport.ts';
import {SITE_URL} from '../domain/seo.ts';
import {EDITOR} from '../domain/legal.ts';
import {dedicatedNotifyEmail,type Env} from './flag.ts';
import {sendAcceptanceEmails,type AcceptedMail} from './notify.ts';
export async function notifyAcceptance(accepted:AcceptedMail,env:Env=process.env):Promise<void>{
 const cfg=smtpConfig(env);
 if(!cfg){console.info(JSON.stringify({event:'dedicated_accepted_mail',sent:false,reason:'SMTP_NOT_CONFIGURED'}));return}
 const r=await sendAcceptanceEmails({accepted,adminTo:dedicatedNotifyEmail(env,EDITOR.legalEmail),siteUrl:SITE_URL,messageDomain:cfg.fromEmail.split('@')[1]!,
  transport:async()=>smtpTransportFrom(cfg,await import('nodemailer')),id:randomUUID});
 console.info(JSON.stringify({event:'dedicated_accepted_mail',...r}));
}
