import {scoreIntent,type IntentSignal,type IntentProfileInput} from './intent.ts';
// Signal Engine S7 — "why now", the sentence a message can open with. Deterministic template only (docs plan §15 S7):
// the strongest VERIFIED signal that still scores is quoted VERBATIM, with its source's domain and its own date when
// it has one. Nothing is paraphrased, summarized or inferred, so the sentence can never carry a fact that is not in
// the excerpt a person verified. A signal still to review, rejected, too old or untracked is never quoted.
export type WhyNow={sentence:string;signal_ids:string[]};
const MAX_EXCERPT=220;
const clip=(s:string)=>{const t=s.replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');if(t.length<=MAX_EXCERPT)return t;const cut=t.slice(0,MAX_EXCERPT);return `${cut.slice(0,Math.max(cut.lastIndexOf(' '),80)).replace(/[\s,;:.]+$/,'')}…`};
const dayOf=(s:IntentSignal):string|null=>s.event_date??(s.published_at?s.published_at.slice(0,10):null);
const formatDay=(day:string,locale:'fr'|'en')=>new Date(`${day}T12:00:00Z`).toLocaleDateString(locale==='en'?'en-GB':'fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});

export function whyNow(signals:IntentSignal[],profile:IntentProfileInput,now:Date,locale:'fr'|'en'='fr'):WhyNow|null{
 const best=scoreIntent(signals,profile,now).lines.find(l=>l.points>0&&l.verified);
 const s=best?signals.find(x=>x.id===best.signal_id&&x.status==='VERIFIED'):undefined;
 if(!s||!s.excerpt.trim())return null;
 const day=dayOf(s);const where=[s.source_domain,day?formatDay(day,locale):null].filter(Boolean).join(', ');
 const quote=clip(s.excerpt);
 const sentence=locale==='en'
  ?`I saw this recent news about you: “${quote}”${where?` (${where})`:''}.`
  :`j’ai vu cette actualité récente vous concernant : « ${quote} »${where?` (${where})`:''}.`;
 return {sentence,signal_ids:[s.id]};
}

// The factual template (generateOutreach) opens with "Bonjour l’équipe <name>, " / "Hello <name> team, ". The why-now
// sentence goes right after that greeting; the rest of the template follows, unchanged, as its own sentence.
export function withWhyNow(text:string,name:string,why:WhyNow|null,locale:'fr'|'en'='fr'):string{
 if(!why)return text;
 const greeting=locale==='en'?`Hello ${name} team, `:`Bonjour l’équipe ${name}, `;
 if(!text.startsWith(greeting))return text;
 const rest=text.slice(greeting.length);
 return `${greeting}${why.sentence} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}
