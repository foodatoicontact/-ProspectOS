import type {MailTransport} from '../self-outreach/transport.ts';
// First real opening of a demo link: one plain-text email to the person who created it (their own sign-in address,
// returned once by record_demo_share_view). Nothing about the visitor is sent — no address, no device: only that the
// link was opened, for which project, and when. Without SMTP configuration nothing is sent; the link list in the
// application still shows the views.
const EMAIL=/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
export function parisTime(at:Date):string{
 return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(at).replace(':',' h ');
}
export function firstViewEmail(o:{projectName:string;viewedAt:Date;siteUrl:string}):{subject:string;text:string}{
 const name=o.projectName.replace(/[\r\n]+/g,' ').slice(0,120);
 return {subject:`Votre démo « ${name} » vient d’être ouverte`,
  text:`Bonjour,\n\nLe lien de démo du projet « ${name} » a été ouvert pour la première fois ${parisTime(o.viewedAt)} (heure de Paris).\n\nLe nombre de vues et la date de dernière ouverture sont dans ProspectOS, sur le projet, bloc « Partager une démo » :\n${o.siteUrl}\n\nVous recevez ce message une seule fois par lien.\n\nProspectOS`};
}
export async function notifyFirstView(o:{to:string|null;projectName:string|null;viewedAt:Date;siteUrl:string;messageDomain:string;transport:()=>Promise<MailTransport>;id:()=>string}):Promise<'SENT'|'SKIPPED'|'FAILED'>{
 if(!o.to||!EMAIL.test(o.to)||!o.projectName)return 'SKIPPED';
 const mail=firstViewEmail({projectName:o.projectName,viewedAt:o.viewedAt,siteUrl:o.siteUrl});
 let transport:MailTransport|null=null;
 try{transport=await o.transport();const r=await transport.send({to:o.to,subject:mail.subject,text:mail.text,messageId:`<demo-${o.id()}@${o.messageDomain}>`});return r.kind==='SENT'?'SENT':'FAILED'}
 catch{return 'FAILED'}finally{await transport?.close().catch(()=>{})}
}
