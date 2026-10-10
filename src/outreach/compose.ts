// O2 — the rule-based composer (the safe default and the fallback of the AI composer). The factual template of
// src/domain/core.ts (unchanged) plus, right after the greeting, one sentence quoting the selected angle VERBATIM with
// its source domain and its own date: a verified signal (the existing "why now"), or a verified public content. The
// evidence angle is the template's own quote; the generic angle adds nothing. Nothing is paraphrased or inferred.
import {generateOutreach,type Criterion,type Evidence} from '../domain/core.ts';
import {whyNow,withWhyNow} from '../domain/why-now.ts';
import type {IntentSignal,IntentProfileInput} from '../domain/intent.ts';
import {selectAngle,type Angle,type PublicContentItem} from './angle.ts';
import {DEFAULT_STYLE_PROFILE,bannedPhrasesIn,type StyleProfile} from './style.ts';

export type Composed={text:string;evidence_ids:string[];signal_ids:string[];public_content_ids:string[];angle:Angle;provider:'rule_based_v1'|'ai_composer_v1';why_now:string|null};
export type ComposeInput={name:string;offer:string;criteria:Criterion[];evidence:Evidence[];signals:IntentSignal[];profile:IntentProfileInput;publicContent:PublicContentItem[];now:Date;locale:'fr'|'en';style?:StyleProfile};

const MAX_QUOTE=220;
const clip=(s:string)=>{const t=s.replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');if(t.length<=MAX_QUOTE)return t;const cut=t.slice(0,MAX_QUOTE);return `${cut.slice(0,Math.max(cut.lastIndexOf(' '),80)).replace(/[\s,;:.]+$/,'')}…`};
const domainOf=(c:PublicContentItem)=>c.source_domain??(()=>{try{return new URL(c.source_url).hostname.toLowerCase()}catch{return null}})();
const formatDay=(iso:string,locale:'fr'|'en')=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString(locale==='en'?'en-GB':'fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
export function publicContentSentence(c:PublicContentItem,locale:'fr'|'en'):string{
 // Only the content's own publication date is shown; the day ProspectOS recorded it is not the date of the fact.
 const where=[domainOf(c),c.published_at?formatDay(c.published_at,locale):null].filter(Boolean).join(', ');
 const quote=clip(c.content);
 return locale==='en'?`I read this publication about you: “${quote}”${where?` (${where})`:''}.`:`j’ai lu cette publication vous concernant : « ${quote} »${where?` (${where})`:''}.`;
}
// The template's generic opening is the only sentence the template owns that a style profile may ban; it is replaced
// by a neutral one. Quoted excerpts are never touched.
const GENERIC_OPENING_FR='je me permets de vous contacter au sujet de votre activité.';
export function applyStyleToTemplate(text:string,style:StyleProfile):string{
 if(text.includes(GENERIC_OPENING_FR)&&bannedPhrasesIn(GENERIC_OPENING_FR,style.banned_phrases).length)return text.replace(GENERIC_OPENING_FR,'je vous écris au sujet de votre activité.');
 return text;
}
export function composeRuleBased(input:ComposeInput):Composed{
 const base=generateOutreach(input.name,input.offer,input.criteria,input.evidence,input.now,input.locale);
 const angle=selectAngle({publicContent:input.publicContent,signals:input.signals,profile:input.profile,evidence:input.evidence,evidenceIds:base.evidence_ids,now:input.now});
 let text=applyStyleToTemplate(base.text,input.style??DEFAULT_STYLE_PROFILE);let signal_ids:string[]=[];let public_content_ids:string[]=[];let why_now:string|null=null;
 if(angle.type==='signal'){const why=whyNow(input.signals,input.profile,input.now,input.locale);if(why){text=withWhyNow(text,input.name,why,input.locale);signal_ids=why.signal_ids;why_now=why.sentence}}
 else if(angle.type==='public_content_pinned'||angle.type==='public_content'){
  const c=input.publicContent.find(x=>x.id===angle.source_id)!;const sentence=publicContentSentence(c,input.locale);
  text=withWhyNow(text,input.name,{sentence,signal_ids:[]},input.locale);public_content_ids=[c.id];why_now=sentence;
 }
 return {text,evidence_ids:base.evidence_ids,signal_ids,public_content_ids,angle,provider:'rule_based_v1',why_now};
}
