// O2 — the rule-based composer (the safe default and the fallback of the AI composer). The factual template of
// src/domain/core.ts (unchanged) plus, right after the greeting, one sentence quoting the selected angle VERBATIM with
// its source domain and its own date: a verified signal (the existing "why now"), or a verified public content. The
// evidence angle is the template's own quote; the generic angle adds nothing. Nothing is paraphrased or inferred.
import {generateOutreach,type Criterion,type Evidence} from '../domain/core.ts';
import {whyNow,withWhyNow,outreachGreeting,type Address} from '../domain/why-now.ts';
import type {IntentSignal,IntentProfileInput} from '../domain/intent.ts';
import {selectAngle,type Angle,type PublicContentItem} from './angle.ts';
import {DEFAULT_STYLE_PROFILE,bannedPhrasesIn,type StyleProfile} from './style.ts';

export type Composed={text:string;evidence_ids:string[];signal_ids:string[];public_content_ids:string[];angle:Angle;provider:'rule_based_v1'|'ai_composer_v1';why_now:string|null};
export type ComposeInput={name:string;offer:string;criteria:Criterion[];evidence:Evidence[];signals:IntentSignal[];profile:IntentProfileInput;publicContent:PublicContentItem[];now:Date;locale:'fr'|'en';style?:StyleProfile};

const MAX_QUOTE=220;
const clip=(s:string)=>{const t=s.replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');if(t.length<=MAX_QUOTE)return t;const cut=t.slice(0,MAX_QUOTE);return `${cut.slice(0,Math.max(cut.lastIndexOf(' '),80)).replace(/[\s,;:.]+$/,'')}…`};
const domainOf=(c:PublicContentItem)=>c.source_domain??(()=>{try{return new URL(c.source_url).hostname.toLowerCase()}catch{return null}})();
const formatDay=(iso:string,locale:'fr'|'en')=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString(locale==='en'?'en-GB':'fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
export function publicContentSentence(c:PublicContentItem,locale:'fr'|'en',address:Address='vous'):string{
 // Only the content's own publication date is shown; the day ProspectOS recorded it is not the date of the fact.
 const where=[domainOf(c),c.published_at?formatDay(c.published_at,locale):null].filter(Boolean).join(', ');
 const quote=clip(c.content);
 return locale==='en'?`I read this publication about you: “${quote}”${where?` (${where})`:''}.`:`j’ai lu cette publication ${address==='tu'?'concernant ton entreprise':'vous concernant'} : « ${quote} »${where?` (${where})`:''}.`;
}
// The template's generic opening is the only sentence the template owns that a style profile may ban; it is replaced
// by a neutral one. Quoted excerpts are never touched.
const GENERIC_OPENING_FR='je me permets de vous contacter au sujet de votre activité.';
export function applyStyleToTemplate(text:string,style:StyleProfile):string{
 if(text.includes(GENERIC_OPENING_FR)&&bannedPhrasesIn(GENERIC_OPENING_FR,style.banned_phrases).length)return text.replace(GENERIC_OPENING_FR,'je vous écris au sujet de votre activité.');
 return text;
}
// O1 — the factual template (src/domain/core.ts, frozen by the scoring invariant) in the 'tu' wording. Its parts are
// taken back by position — the quoted excerpt verbatim, never searched for or rewritten — and the offer as written;
// only ProspectOS's own words change. A text that is not exactly that template is returned as it is.
export function tutoyerTemplate(text:string,name:string,offer:string):string{
 const head=outreachGreeting(name,'fr','vous'),tail=` ${offer.trim()||'Je souhaite vous présenter notre offre et vérifier si elle correspond à vos besoins.'} Seriez-vous ouvert à un court échange ?`;
 if(text.length<head.length+tail.length||!text.startsWith(head)||!text.endsWith(tail))return text;
 const middle=text.slice(head.length,text.length-tail.length),intro='j’ai remarqué ceci sur votre site : « ',close=' ».';
 const opening=middle==='je me permets de vous contacter au sujet de votre activité.'?'je t’écris au sujet de ton activité.'
  :middle.startsWith(intro)&&middle.endsWith(close)?`j’ai remarqué ceci sur ton site : « ${middle.slice(intro.length,middle.length-close.length)} ».`:null;
 if(opening===null)return text;
 return `${outreachGreeting(name,'fr','tu')}${opening} ${offer.trim()||'Je souhaite te présenter notre offre et vérifier si elle correspond à tes besoins.'} Est-ce qu’un court échange t’intéresserait ?`;
}
// The style profile's max_chars, applied to the finished message without a blind slice. The message is always
// [protected head: greeting + verified quote / "why now" sentence][offer][closing question]; the head is never touched.
// In order, the first candidate that fits wins: the closing question in its short form; trailing offer sentences dropped
// (the first one stays); the first offer sentence shortened on a word boundary with "…" (kept only if ≥ 40 characters
// remain); the offer left out. If head + short question alone exceed max_chars, that is the message, over the limit:
// a verified quote is never cut or altered. A text without that structure is returned unchanged (never sliced).
const CLOSING={fr:{vous:['Seriez-vous ouvert à un court échange ?','Seriez-vous ouvert à un échange ?'],tu:['Est-ce qu’un court échange t’intéresserait ?','Ça t’intéresserait d’en parler ?']},
 en:{vous:['Would you be open to a short conversation?','Open to a quick chat?'],tu:['Would you be open to a short conversation?','Open to a quick chat?']}};
const DEFAULT_OFFER={fr:{vous:'Je souhaite vous présenter notre offre et vérifier si elle correspond à vos besoins.',tu:'Je souhaite te présenter notre offre et vérifier si elle correspond à tes besoins.'},
 en:{vous:'I’d like to introduce our offer and check whether it fits your needs.',tu:'I’d like to introduce our offer and check whether it fits your needs.'}};
const MIN_SHORTENED_OFFER=40;
export function fitToMaxChars(text:string,o:{offer:string;locale:'fr'|'en';address:Address;maxChars:number}):string{
 if(text.length<=o.maxChars)return text;
 const [closing,shortClosing]=CLOSING[o.locale][o.address],offer=o.offer.trim()||DEFAULT_OFFER[o.locale][o.address];
 const tail=` ${offer} ${closing}`;
 if(!text.endsWith(tail))return text;
 const head=text.slice(0,text.length-tail.length),fits=(t:string)=>t.length<=o.maxChars;
 const sentences=offer.split(/(?<=[.!?])\s+/);
 const withOffer=(part:string)=>`${head} ${part} ${shortClosing}`;
 for(let k=sentences.length;k>=1;k--){const t=withOffer(sentences.slice(0,k).join(' '));if(fits(t))return t}
 const budget=o.maxChars-head.length-shortClosing.length-2;
 const words=sentences[0].replace(/[.!?]+$/,'').split(' ');
 for(let n=words.length-1;n>=1;n--){const part=`${words.slice(0,n).join(' ').replace(/[\s,;:.!?…]+$/,'')}…`;if(part.length<MIN_SHORTENED_OFFER)break;if(part.length<=budget)return withOffer(part)}
 return `${head} ${shortClosing}`;
}
export function composeRuleBased(input:ComposeInput):Composed{
 // O1: the user's address_mode — 'tu' tutoies the template and the angle sentence (French); 'auto' and 'vous' keep 'vous'.
 const address:Address=input.locale==='fr'&&input.style?.address_mode==='tu'?'tu':'vous';
 const base=generateOutreach(input.name,input.offer,input.criteria,input.evidence,input.now,input.locale);
 const angle=selectAngle({publicContent:input.publicContent,signals:input.signals,profile:input.profile,evidence:input.evidence,evidenceIds:base.evidence_ids,now:input.now});
 let text=applyStyleToTemplate(address==='tu'?tutoyerTemplate(base.text,input.name,input.offer):base.text,input.style??DEFAULT_STYLE_PROFILE);let signal_ids:string[]=[];let public_content_ids:string[]=[];let why_now:string|null=null;
 if(angle.type==='signal'){const why=whyNow(input.signals,input.profile,input.now,input.locale,address);if(why){text=withWhyNow(text,input.name,why,input.locale,address);signal_ids=why.signal_ids;why_now=why.sentence}}
 else if(angle.type==='public_content_pinned'||angle.type==='public_content'){
  const c=input.publicContent.find(x=>x.id===angle.source_id)!;const sentence=publicContentSentence(c,input.locale,address);
  text=withWhyNow(text,input.name,{sentence,signal_ids:[]},input.locale,address);public_content_ids=[c.id];why_now=sentence;
 }
 // max_chars only when a style profile is given (the live route always passes one); legacy / demo calls are unchanged.
 if(input.style)text=fitToMaxChars(text,{offer:input.offer,locale:input.locale,address,maxChars:input.style.max_chars});
 return {text,evidence_ids:base.evidence_ids,signal_ids,public_content_ids,angle,provider:'rule_based_v1',why_now};
}
