// Self-Outreach booking reply (migration 037, docs/SELF_OUTREACH.md §9) — the answer to a prospect who replied
// positively: thank them, give the campaign's scheduling link, offer an alternative. It states no fact about the company
// (nothing to source), carries no number, no urgency, no flattery and no free offer, and keeps the opt-out line. It is a
// DRAFT: a person approves it like every message; the database refuses an approved text without the current link.
import {checkComposedMessage} from '../outreach/fact-guard.ts';
import {refusedText} from './message.ts';
export const BOOKING_GENERATOR='self_outreach_booking_v1';
const MAX_CHARS=900;
const OPT_OUT='Si vous ne souhaitez plus recevoir de message de ma part, répondez simplement STOP.';
// The same shape as the database check (037): https, a host, URL characters only, no trailing punctuation.
const BOOKING_URL=/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[A-Za-z0-9._~%/?#&=+@:-]*)?$/;
export function normalizeBookingUrl(v:unknown):string|null{
 if(typeof v!=='string')return null;const s=v.trim();
 if(s.length<12||s.length>300||!BOOKING_URL.test(s)||/[.,;:!?]$/.test(s))return null;
 try{const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.port)return null}catch{return null}
 return s;
}
const firstName=(name:string)=>name.trim().split(/\s+/)[0]!.replace(/[^\p{L}'’-]/gu,'');
const reSubject=(s:string)=>{const t=s.replace(/[\r\n]+/g,' ').trim();return (/^re\s*:/i.test(t)?t:`Re: ${t}`).slice(0,140)};

export type BookingInput={contactName:string;senderName:string;bookingUrl:string;originalSubject:string;company:string};
export type BookingDraft={ok:true;subject:string;text:string}|{ok:false;reason:string};

export function generateBookingReply(i:BookingInput):BookingDraft{
 const url=normalizeBookingUrl(i.bookingUrl);if(!url)return {ok:false,reason:'BOOKING_URL_INVALID'};
 const fn=firstName(i.contactName);
 const text=[`Bonjour${fn?` ${fn}`:''},`,
  'Merci pour votre retour.',
  `Pour trouver un moment qui vous convient, vous pouvez choisir directement un créneau ici : ${url}`,
  'Si aucun ne vous arrange, proposez-moi simplement deux horaires en réponse à ce message.',
  i.senderName?`${i.senderName}`:'',
  OPT_OUT].filter(Boolean).join('\n\n');
 const subject=reSubject(i.originalSubject||`${i.company} : une question sur votre prospection`);
 const why=checkBookingText(text,i,url);if(!why.ok)return why;
 const s=refusedText(subject,'',[i.company,i.contactName,i.senderName].filter(Boolean));if(s)return {ok:false,reason:s};
 return {ok:true,subject,text};
}
// A draft or a person's edit: the link must be there, nothing forbidden, and no fact, number or other URL the sources
// cannot back (a booking reply has no source: it may only say what the template says).
export function checkBookingText(text:string,i:Pick<BookingInput,'company'|'contactName'|'senderName'>,bookingUrl:string):{ok:true}|{ok:false;reason:string}{
 const url=normalizeBookingUrl(bookingUrl);if(!url)return {ok:false,reason:'BOOKING_URL_INVALID'};
 if(!text.includes(url))return {ok:false,reason:'BOOKING_LINK_MISSING'};
 const why=refusedText(text,'',[i.company,i.contactName,i.senderName].filter(Boolean));if(why)return {ok:false,reason:why};
 const g=checkComposedMessage(text,{name:i.company,offer:`${i.senderName} ${i.contactName}`,sources:[],allowedUrls:[url],forbiddenNames:[],bannedPhrases:[],maxChars:MAX_CHARS,angleType:'signal'});
 return g.ok?{ok:true}:{ok:false,reason:`FACT_GUARD_${g.reason}`};
}
