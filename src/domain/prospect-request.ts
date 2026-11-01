// "3 prospects de votre zone": a visitor asks, without an account, for 3 companies of their zone that have a concrete reason
// to be contacted now. The request is NOT stored: it is emailed to the founder, who prepares the 3 companies by hand from
// public sources (concierge test before any automation). Only what is needed to answer is collected: the activity sold,
// the department, a professional email. Nothing is ever sent to the requester automatically (no relay for third parties).
// Pure: validation, cleaning, throttling state and the notification text; app/api/public/demande-prospects sends it.
import {CREATIONS_DEPARTMENTS} from './company-creations.ts';

export const REQUEST_LIMITS={activity:160,target:160,email:200,message:600} as const;
const EMAIL=/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
// Free consumer mailboxes are accepted (many freelancers use one) but flagged so the answer is not mistaken for a company.
const PERSONAL_DOMAINS=new Set(['gmail.com','hotmail.com','hotmail.fr','outlook.com','outlook.fr','yahoo.com','yahoo.fr','live.fr','icloud.com','orange.fr','free.fr','sfr.fr','laposte.net','wanadoo.fr','gmx.fr','protonmail.com','proton.me']);

export type ProspectRequest={activity:string;target:string;department:{code:string;name:string};email:string;personalMailbox:boolean;message:string};
export type RequestError='INVALID_REQUEST'|'ACTIVITY_REQUIRED'|'DEPARTMENT_INVALID'|'EMAIL_INVALID'|'CONSENT_REQUIRED'|'SPAM';

// One line, no control characters (no header or log injection), trimmed and bounded.
export const cleanLine=(v:unknown,max:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const cleanText=(v:unknown,max:number)=>typeof v==='string'?v.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,max):'';

export function parseProspectRequest(body:unknown):{ok:true;request:ProspectRequest}|{ok:false;error:RequestError}{
 if(!body||typeof body!=='object'||Array.isArray(body))return {ok:false,error:'INVALID_REQUEST'};
 const b=body as Record<string,unknown>;
 // Honeypot: a field no person sees. Filled means a robot — answered like a success by the route, never emailed.
 if(cleanLine(b.website,200))return {ok:false,error:'SPAM'};
 const activity=cleanLine(b.activity,REQUEST_LIMITS.activity);
 if(activity.length<3)return {ok:false,error:'ACTIVITY_REQUIRED'};
 const department=CREATIONS_DEPARTMENTS.find(d=>d.code===cleanLine(b.department,3));
 if(!department)return {ok:false,error:'DEPARTMENT_INVALID'};
 const email=cleanLine(b.email,REQUEST_LIMITS.email).toLowerCase();
 if(!EMAIL.test(email))return {ok:false,error:'EMAIL_INVALID'};
 if(b.consent!==true)return {ok:false,error:'CONSENT_REQUIRED'};
 return {ok:true,request:{activity,target:cleanLine(b.target,REQUEST_LIMITS.target),department:{code:department.code,name:department.name},email,
  personalMailbox:PERSONAL_DOMAINS.has(email.split('@')[1]!),message:cleanText(b.message,REQUEST_LIMITS.message)}};
}

// Best-effort throttle per client address, kept in the server instance's memory (a serverless instance is short-lived:
// this slows a burst, it is not a quota). The honeypot and the same-origin check do the rest.
export function createThrottle({max,windowMs}:{max:number;windowMs:number}){
 const hits=new Map<string,number[]>();
 return (key:string,now=Date.now())=>{
  const recent=(hits.get(key)??[]).filter(t=>now-t<windowMs);
  if(recent.length>=max){hits.set(key,recent);return false}
  recent.push(now);hits.set(key,recent);
  if(hits.size>5000)for(const k of [...hits.keys()].slice(0,1000))hits.delete(k);
  return true;
 };
}

// The founder's notification: everything needed to prepare the 3 companies, and how to answer.
export function notificationMail(r:ProspectRequest,now:Date){
 const subject=`[ProspectOS] 3 prospects demandés : ${r.activity.slice(0,60)} · ${r.department.name} (${r.department.code})`;
 const text=[
  'Nouvelle demande « 3 prospects de votre zone » sur prospectos.fr.',
  '',
  `Activité du demandeur : ${r.activity}`,
  `Clients recherchés : ${r.target||'(non précisé)'}`,
  `Département : ${r.department.name} (${r.department.code})`,
  `Email : ${r.email}${r.personalMailbox?' (messagerie personnelle)':''}`,
  ...(r.message?['','Message :',r.message]:[]),
  '',
  `Reçue le ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'full',timeStyle:'short',timeZone:'Europe/Paris'}).format(now)}.`,
  'Promesse affichée : 3 entreprises avec leur source officielle, sous 24 h ouvrées. Répondre depuis votre messagerie.',
  'Cette demande n’est enregistrée nulle part ailleurs que dans cet email.',
 ].join('\n');
 return {subject:cleanLine(subject,180),text};
}
