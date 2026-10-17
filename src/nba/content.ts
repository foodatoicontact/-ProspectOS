// Next Best Action V1 — prepared content. A DRAFT only: nothing here sends, posts, comments or messages anything.
//
// CONTACT: the existing rule-based composer (src/outreach/compose.ts — factual template + the verified "why now" quoted
//   verbatim), unchanged.
// ENGAGE: SUGGESTED_COMMENT (an idea contributed on the topic of the post — never a compliment, never a fact about the
//   author or the company) and SUGGESTED_DM_AFTER_ENGAGEMENT (names the post by its date and topic, then the offer).
// Every text goes through the existing factual guard (src/outreach/fact-guard.ts) with the sources it may use, and
// through the NBA's own refusals: no free trial, free beta or free test is ever offered, no false familiarity. A text
// that fails is not proposed (null + reason): the person writes their own.
import {composeRuleBased} from '../outreach/compose.ts';
import {checkComposedMessage} from '../outreach/fact-guard.ts';
import type {Criterion,Evidence} from '../domain/core.ts';
import type {IntentProfileInput} from '../domain/intent.ts';
import {fold,CONVERSATION_TOPICS} from './registry.ts';
import type {NbaPublicContent,NbaSignal,Opportunity} from './engine.ts';

// Free offers and false familiarity (folded). The offer itself is checked too: a draft never carries them.
export const NBA_FORBIDDEN=/\b(essai|test|beta|periode d'essai|demo) gratuit(e|s)?\b|\bgratuit(e|ement)? (pendant|pour) \d+\b|\bfree (trial|beta|test)\b|\b(cher|chere) ami\b|\bcomme convenu\b|\bsuite a notre (echange|conversation|appel)\b|\bravi de (te|vous) revoir\b|\bas discussed\b|\bgreat to reconnect\b/;
// Flattery the engine must never write (folded).
export const NBA_FLATTERY=/\bbravo\b|\bfelicitations?\b|\bsuper post\b|\bexcellent post\b|\bgreat post\b|\bpassionnant\b|\binspirant\b|\bbrillant\b|\bamazing\b|\blove this\b|\bincroyable\b/;
const MAX_CHARS=900;

export type Prepared={kind:'contact_draft';text:string;signal_ids:string[];evidence_ids:string[]}
 |{kind:'engage';suggested_comment:string|null;suggested_dm_after_engagement:string|null;content_id:string;angle:string}
 |{kind:'none';reason:string};
export type PrepareInput={opportunity:Opportunity;name:string;offer:string;criteria:Criterion[];evidence:Evidence[];signals:NbaSignal[];
 publicContent:NbaPublicContent[];profile:IntentProfileInput;now:Date};

// Names are not words: a company called "Bravo" or an author called "Incroyable" is never flattery. They are removed
// (folded, whole words) before the checks; the offer is checked as written.
function refused(text:string,offer:string,names:string[]=[]):string|null{
 let f=` ${fold(text)} `;
 for(const n of names.map(fold).filter(x=>x.length>=2))f=f.split(n).join(' ');
 if(NBA_FORBIDDEN.test(f)||NBA_FORBIDDEN.test(fold(offer)))return 'FORBIDDEN_OFFER_OR_FAMILIARITY';
 if(NBA_FLATTERY.test(f))return 'FLATTERY';
 return null;
}
const dayFr=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',timeZone:'UTC'});

export function prepareContent(p:PrepareInput):Prepared{
 const o=p.opportunity;
 if(o.recommended_action==='CONTACT'){
  // Only the VERIFIED material the composer is allowed to quote; a content still to review is never used.
  const signals=p.signals.filter(s=>s.status==='VERIFIED');
  const composed=composeRuleBased({name:p.name,offer:p.offer,criteria:p.criteria,evidence:p.evidence,signals,profile:p.profile,
   publicContent:p.publicContent.filter(c=>c.status==='VERIFIED').map(c=>({...c,pinned:false,source_type:'user_provided'})),now:p.now,locale:'fr'});
  const why=refused(composed.text,p.offer,[p.name]);if(why)return {kind:'none',reason:why};
  // The composer writes each source's own date next to its quote: the stored dates are part of what it may say.
  const sources=[...signals.map(s=>`${s.title} ${s.excerpt} ${s.event_date??''} ${s.published_at??''}`),...p.evidence.filter(e=>e.status==='VERIFIED').map(e=>e.excerpt),
   ...p.publicContent.filter(c=>c.status==='VERIFIED').map(c=>`${c.content} ${c.published_at??''}`)];
  const guard=checkComposedMessage(composed.text,{name:p.name,offer:p.offer,sources,allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:MAX_CHARS,angleType:composed.angle.type});
  if(!guard.ok)return {kind:'none',reason:`FACT_GUARD_${guard.reason}`};
  return {kind:'contact_draft',text:composed.text,signal_ids:composed.signal_ids,evidence_ids:composed.evidence_ids};
 }
 if(o.recommended_action==='ENGAGE'&&o.primary?.kind==='conversation'){
  const c=p.publicContent.find(x=>x.id===(o.primary as {content_id:string}).content_id&&x.status==='VERIFIED');
  if(!c)return {kind:'none',reason:'CONVERSATION_NOT_VERIFIED'};
  const topic=CONVERSATION_TOPICS.find(t=>t.terms.test(fold(c.content)))??null;
  // Without a known topic the engine has no reviewed angle: it proposes the angle as an idea, no comment text.
  const comment=topic?topic.comment.fr:null;
  const subject=topic?topic.label.fr:'ce sujet';
  const offer=p.offer.trim();
  const dm=offer?`Bonjour${c.author?` ${c.author.split(/\s+/)[0]}`:''}, je réagis à votre publication${c.published_at?` du ${dayFr(c.published_at)}`:''} sur ${subject}. ${offer} Seriez-vous ouvert à un court échange ?`:null;
  const sources=[c.content,c.author??'',c.published_at??''];
  const check=(t:string|null)=>{if(!t)return null;if(refused(t,offer,[p.name,c.author??'']))return null;
   const g=checkComposedMessage(t,{name:p.name,offer,sources,allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:MAX_CHARS,angleType:'public_content'});return g.ok?t:null};
  return {kind:'engage',suggested_comment:check(comment),suggested_dm_after_engagement:check(dm),content_id:c.id,angle:o.primary.suggested_angle};
 }
 return {kind:'none',reason:'NO_CONTENT_FOR_ACTION'};
}
