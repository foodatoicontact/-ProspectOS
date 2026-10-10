// O2 — the angle selector: which verified fact a message opens with. Deterministic (no model), in a fixed priority:
// a VERIFIED public content the user PINNED, then the strongest VERIFIED signal (the "why now" of src/domain/why-now.ts),
// then a RECENT VERIFIED public content, then the VERIFIED evidence the factual template quotes, else a generic message.
// Public content is never evidence nor a signal: it only chooses the angle, it never moves FIT or INTENT.
import {whyNow} from '../domain/why-now.ts';
import type {IntentSignal,IntentProfileInput} from '../domain/intent.ts';
import type {Evidence} from '../domain/core.ts';

export type PublicContentItem={id:string;status:string;pinned:boolean;source_type:string;source_url:string;source_domain?:string|null;author:string|null;content:string;published_at:string|null;observed_at:string};
export type AngleType='public_content_pinned'|'signal'|'public_content'|'evidence'|'generic';
export type Angle={type:AngleType;source_id:string|null;label:string;reason:string;source_url:string|null;observed_at:string|null;excerpt:string|null};
export const RECENT_PUBLIC_CONTENT_DAYS=90;
export type AngleInput={publicContent:PublicContentItem[];signals:IntentSignal[];profile:IntentProfileInput;evidence:Evidence[];evidenceIds:string[];now:Date};

const dateOf=(c:PublicContentItem)=>c.published_at??c.observed_at;
// Newest first; ties broken by id so the same input always gives the same angle.
const newest=(a:PublicContentItem,b:PublicContentItem)=>dateOf(b).localeCompare(dateOf(a))||a.id.localeCompare(b.id);
const label=(s:string)=>{const t=s.replace(/\s+/g,' ').trim();return t.length<=120?t:`${t.slice(0,119)}…`};
const fromContent=(type:AngleType,c:PublicContentItem,reason:string):Angle=>({type,source_id:c.id,label:label(c.content),reason,source_url:c.source_url,observed_at:c.observed_at,excerpt:c.content});

export function selectAngle(input:AngleInput):Angle{
 const verified=input.publicContent.filter(c=>c.status==='VERIFIED'&&c.content.trim());
 const pinned=verified.filter(c=>c.pinned).sort(newest)[0];
 if(pinned)return fromContent('public_content_pinned',pinned,'PINNED_VERIFIED_PUBLIC_CONTENT');
 const why=whyNow(input.signals,input.profile,input.now);
 const signal=why?input.signals.find(s=>s.id===why.signal_ids[0]&&s.status==='VERIFIED'):undefined;
 if(signal)return {type:'signal',source_id:signal.id,label:label(signal.title),reason:'STRONGEST_VERIFIED_SIGNAL',source_url:signal.source_url,observed_at:signal.observed_at,excerpt:signal.excerpt};
 const horizon=input.now.getTime()-RECENT_PUBLIC_CONTENT_DAYS*86400000,limit=input.now.getTime()+86400000;
 const recent=verified.filter(c=>{const t=Date.parse(dateOf(c));return Number.isFinite(t)&&t>=horizon&&t<=limit}).sort(newest)[0];
 if(recent)return fromContent('public_content',recent,'RECENT_VERIFIED_PUBLIC_CONTENT');
 const ev=input.evidenceIds.map(id=>input.evidence.find(e=>e.id===id&&e.status==='VERIFIED'&&e.excerpt.trim())).find(Boolean);
 if(ev)return {type:'evidence',source_id:ev.id,label:label(ev.excerpt),reason:'VERIFIED_EVIDENCE',source_url:ev.source_url,observed_at:ev.observed_at,excerpt:ev.excerpt};
 return {type:'generic',source_id:null,label:'',reason:'NO_VERIFIED_DATA',source_url:null,observed_at:null,excerpt:null};
}
