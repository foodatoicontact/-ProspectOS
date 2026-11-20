// Morning recap email (migration 040). Pure: configuration, the signed unsubscribe link, the start of the day in Paris,
// and the plain-text email. The cron route (app/api/cron/morning-digest) claims the subscribers and sends; the account
// route (src/digest/api.ts) stores each member's own choice; the public unsubscribe route checks the link.
// What the email says is what the database holds: new PENDING_REVIEW signals with their official source, never a
// verdict, never a contact detail, never a person's data. Nothing is sent to someone who did not enable it.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {smtpConfig,type Env} from '../self-outreach/config.ts';

const on=(v:string|undefined)=>{const x=(v??'').trim().toLowerCase();return x==='true'||x==='1'};
// The secret that signs unsubscribe links: at least 32 characters, or the feature is off.
export const digestSecret=(env:Env)=>{const s=env.MORNING_DIGEST_SECRET??'';return s.length>=32?s:null};
// Sending needs the flag, the signing secret and a complete SMTP configuration — all three, or no code path sends.
export const morningDigestAvailable=(env:Env)=>on(env.MORNING_DIGEST_ENABLED)&&!!digestSecret(env)&&!!smtpConfig(env);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function unsubscribeToken(secret:string,userId:string):string{
 return createHmac('sha256',secret).update(`morning-digest:unsubscribe:${userId.toLowerCase()}`).digest('base64url').slice(0,32);
}
export function verifyUnsubscribe(secret:string|null,userId:unknown,token:unknown):string|null{
 if(!secret||typeof userId!=='string'||!UUID.test(userId)||typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token))return null;
 const a=Buffer.from(unsubscribeToken(secret,userId)),b=Buffer.from(token);
 return a.length===b.length&&timingSafeEqual(a,b)?userId.toLowerCase():null;
}
export const UNSUBSCRIBE_PATH='/api/public/recap/desabonnement';
export const unsubscribeUrl=(siteUrl:string,secret:string,userId:string)=>`${siteUrl}${UNSUBSCRIBE_PATH}?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(secret,userId)}`;

// Midnight in Paris today, as an instant: a subscriber is claimed once per Paris day.
export function parisDayStart(now:Date):Date{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  .formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const asUtc=Date.UTC(parts.year!,parts.month!-1,parts.day!,parts.hour!,parts.minute!,parts.second!);
 const offset=asUtc-Math.floor(now.getTime()/1000)*1000;
 return new Date(Date.UTC(parts.year!,parts.month!-1,parts.day!)-offset);
}

export type DigestSignal={project_name:string;prospect_name:string;signal_type:string;title:string;excerpt:string;source_url:string;published_at:string|null};
const TYPE_LABEL:Record<string,string>={hiring_role:'Recrutement',leadership_change:'Changement de dirigeant',funding:'Financement ou capital',acquisition:'Rachat ou cession',
 new_site:'Nouvel établissement',expansion:'Développement',product_launch:'Lancement',partnership:'Partenariat',certification:'Certification',tech_change:'Changement d’outil',
 public_contract_won:'Marché public remporté',headcount_growth:'Croissance des effectifs',incident_cyber:'Incident',event:'Événement'};
// One line, no control characters: the subject and every value stay single-line text (no header injection).
const line=(v:unknown,max:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const safeUrl=(v:string)=>/^https?:\/\/[^\s]+$/.test(v)?v:'';
const dateFr=(iso:string|null)=>{if(!iso)return null;const d=new Date(iso);return Number.isNaN(d.getTime())?null:new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(d)};

export const MAX_SIGNALS_IN_EMAIL=15;
export function digestEmail(signals:readonly DigestSignal[],o:{siteUrl:string;unsubscribe:string;contact:string}):{subject:string;text:string}|null{
 const shown=signals.filter(s=>safeUrl(s.source_url)).slice(0,MAX_SIGNALS_IN_EMAIL);
 if(!shown.length)return null;// nothing new: no email
 const n=signals.length;
 const subject=line(n===1?'ProspectOS · 1 nouveau signal sur vos prospects':`ProspectOS · ${n} nouveaux signaux sur vos prospects`,140);
 const items=shown.map((s,i)=>{
  const when=dateFr(s.published_at);
  return [`${i+1}. ${line(s.prospect_name,120)} (${line(s.project_name,80)}) · ${TYPE_LABEL[s.signal_type]??'Signal'}`,
   `   ${line(s.title,200)}`,
   ...(line(s.excerpt,300)&&line(s.excerpt,300)!==line(s.title,200)?[`   « ${line(s.excerpt,300)} »`]:[]),
   `   Source${when?` (publiée le ${when})`:''} : ${safeUrl(s.source_url)}`].join('\n');
 });
 const text=[
  'Bonjour,',
  '',
  `Depuis votre dernier récap, ProspectOS a trouvé ${n===1?'un nouveau signal':`${n} nouveaux signaux`} sur les prospects que vous suivez. Chacun attend votre vérification à sa source : rien n’est validé sans vous.`,
  '',
  ...items.flatMap(t=>[t,'']),
  ...(n>shown.length?[`Et ${n-shown.length} autre${n-shown.length>1?'s':''} dans ProspectOS.`,'']:[]),
  `Les vérifier dans ProspectOS : ${o.siteUrl}/`,
  '',
  '—',
  'Vous recevez ce récap parce que vous l’avez activé dans ProspectOS (écran « Aujourd’hui »). Pas d’email les jours sans nouveauté.',
  `Ne plus le recevoir, en un clic : ${o.unsubscribe}`,
  `ProspectOS · ${o.contact}`,
 ].join('\n');
 return {subject,text};
}
