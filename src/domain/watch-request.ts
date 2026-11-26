// « Demander un devis » de veille dédiée (owner decision, 26 nov. 2026): a real form instead of a mailto. The request is
// stored (public.contact_requests, kind WATCH, migration 056; deleted after 12 months), shown in the administrator's
// cockpit, and announced by a push without any personal data. Only what is needed to prepare a quote is collected: the
// activity sold, the clients sought, the department, the company (optional), a professional e-mail, a message (optional).
// Pure: validation and cleaning; app/api/public/demande-veille stores it.
import {CREATIONS_DEPARTMENTS} from './company-creations.ts';
import {cleanLine,type RequestError} from './prospect-request.ts';

export const WATCH_LIMITS={activity:160,target:160,company:160,email:200,message:600} as const;
const EMAIL=/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
export type WatchRequest={activity:string;target:string;department:{code:string;name:string};company:string;email:string;message:string};
const cleanText=(v:unknown,max:number)=>typeof v==='string'?v.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,max):'';

export function parseWatchRequest(body:unknown):{ok:true;request:WatchRequest}|{ok:false;error:RequestError}{
 if(!body||typeof body!=='object'||Array.isArray(body))return {ok:false,error:'INVALID_REQUEST'};
 const b=body as Record<string,unknown>;
 if(cleanLine(b.website,200))return {ok:false,error:'SPAM'};
 const activity=cleanLine(b.activity,WATCH_LIMITS.activity);
 if(activity.length<3)return {ok:false,error:'ACTIVITY_REQUIRED'};
 const department=CREATIONS_DEPARTMENTS.find(d=>d.code===cleanLine(b.department,3));
 if(!department)return {ok:false,error:'DEPARTMENT_INVALID'};
 const email=cleanLine(b.email,WATCH_LIMITS.email).toLowerCase();
 if(!EMAIL.test(email))return {ok:false,error:'EMAIL_INVALID'};
 if(b.consent!==true)return {ok:false,error:'CONSENT_REQUIRED'};
 return {ok:true,request:{activity,target:cleanLine(b.target,WATCH_LIMITS.target),department:{code:department.code,name:department.name},
  company:cleanLine(b.company,WATCH_LIMITS.company),email,message:cleanText(b.message,WATCH_LIMITS.message)}};
}
