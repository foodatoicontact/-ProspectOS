// Self-Outreach message generation — short, rule-based, every fact sourced. Structure:
//   1. SIGNAL OBSERVÉ   the verified signal, quoted verbatim with its source and date;
//   2. PROBLÈME         a general consequence of that kind of signal (never a claim about the company);
//   3. LIEN             the project's own offer text (what ProspectOS does), as written;
//   4. CTA              low friction, no date, no urgency; then a plain opt-out line.
// Nothing is hard-coded about a prospect: no flattery, no false familiarity, no "j'espère que vous allez bien", no
// free trial / beta / test, no invented number or name. The text goes through the outreach fact guard
// (src/outreach/fact-guard.ts: every quote, number, URL and fact word must be in the verified sources) and the NBA
// forbidden-offer and flattery checks. Refused → no message (never a weaker one sent instead).
import {checkComposedMessage} from '../outreach/fact-guard.ts';
import {NBA_FORBIDDEN,NBA_FLATTERY} from '../nba/content.ts';
import {fold,entryOf,type CommercialSignalType} from '../nba/registry.ts';
export const OUTREACH_GENERATOR='self_outreach_rule_v1';
const MAX_CHARS=1200;
// Banned openings and empty formulas (folded).
export const SELF_OUTREACH_BANNED=[/j.espere que vous allez bien/,/j.espere que tu vas bien/,/je me permets de vous contacter/,/n.hesitez pas a/,/\burgent\b/,/derniere chance/,/offre limitee/,
 /\bgaranti/,/\b(x|fois) plus de/,/intelligence artificielle revolutionnaire/];
// The consequence of a kind of signal — a general statement about that situation, never about the company. No fact word
// of the guard's families (hiring, funding, launch…) so it cannot assert anything the source does not say.
const PROBLEM:Partial<Record<CommercialSignalType,string>>={
 HIRING_FIRST_SALES:'Un premier commercial a d’abord besoin de savoir quels comptes appeler, et pourquoi maintenant plutôt que dans six mois.',
 HIRING_SDR:'Une personne qui prospecte passe vite plus de temps à chercher qui contacter qu’à parler aux bons comptes.',
 HIRING_BDR:'Une personne qui prospecte passe vite plus de temps à chercher qui contacter qu’à parler aux bons comptes.',
 HIRING_AE:'Un Account Executive avance plus vite quand chaque compte de sa liste arrive avec une raison claire d’être contacté.',
 HIRING_HEAD_OF_SALES:'Structurer une équipe commerciale passe souvent par une question simple : sur quels comptes concentrer l’effort, et à quel moment.',
 PIPELINE_BUILDING:'Construire un pipeline sortant, c’est surtout choisir les bons comptes au bon moment, preuve à l’appui.',
 COMMERCIAL_ACCELERATION:'Accélérer la prospection sans perdre en pertinence demande de savoir quels comptes méritent d’être contactés maintenant.',
 PUBLIC_COMMERCIAL_NEED:'Le sujet que vous évoquez, trouver les bons comptes et le bon moment, est celui sur lequel nous travaillons.',
};
const DEFAULT_PROBLEM='Ce type de moment pose souvent la même question : quels comptes contacter, et pourquoi maintenant.';
const day=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const clip=(s:string,max=220)=>{const t=s.replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');if(t.length<=max)return t;const c=t.slice(0,max);return `${c.slice(0,Math.max(c.lastIndexOf(' '),80))}…`};
const firstName=(name:string)=>name.trim().split(/\s+/)[0]!.replace(/[^\p{L}'’-]/gu,'');

export type MessageInput={company:string;contactName:string;offer:string;senderName:string;
 signal:{id:string;title:string;excerpt:string;source_url:string;source_domain:string|null;event_date:string|null;published_at:string|null;status:string};
 commercialType:CommercialSignalType;evidence:{id:string;excerpt:string;status:string}[]};
export type GeneratedMessage={ok:true;subject:string;text:string;evidence_refs:{signal_ids:string[];evidence_ids:string[];source_urls:string[]};generation_meta:Record<string,unknown>}
 |{ok:false;reason:string};

export function refusedText(text:string,offer:string,names:string[]):string|null{
 let f=` ${fold(text)} `;for(const n of names.map(fold).filter(x=>x.length>=2))f=f.split(n).join(' ');
 if(NBA_FORBIDDEN.test(f)||NBA_FORBIDDEN.test(fold(offer)))return 'FORBIDDEN_OFFER_OR_FAMILIARITY';
 if(NBA_FLATTERY.test(f))return 'FLATTERY';
 if(SELF_OUTREACH_BANNED.some(re=>re.test(f)))return 'BANNED_FORMULA';
 return null;
}
// The verified material a message may quote (and the dates it may write).
export function sourcesOf(i:Pick<MessageInput,'signal'|'evidence'>):string[]{
 const s=i.signal,dates=[s.event_date,s.published_at].filter((d):d is string=>!!d);
 return [`${s.title} ${s.excerpt} ${dates.join(' ')} ${dates.map(day).join(' ')} ${s.source_domain??''}`,...i.evidence.filter(e=>e.status==='VERIFIED').map(e=>e.excerpt)];
}
const OPT_OUT='Si vous ne souhaitez plus recevoir de message de ma part, répondez simplement STOP.';

export function generateInitial(i:MessageInput):GeneratedMessage{
 if(i.signal.status!=='VERIFIED')return {ok:false,reason:'SIGNAL_NOT_VERIFIED'};
 const offer=i.offer.replace(/\s+/g,' ').trim();if(offer.length<20)return {ok:false,reason:'OFFER_MISSING'};
 const fn=firstName(i.contactName);const date=i.signal.event_date??i.signal.published_at;
 const where=[i.signal.source_domain,date?day(date):null].filter(Boolean).join(', ');
 const text=[`Bonjour${fn?` ${fn}`:''},`,
  `J’ai lu ceci${where?` (${where})`:''} : « ${clip(i.signal.excerpt)} ».`,
  PROBLEM[i.commercialType]??DEFAULT_PROBLEM,
  offer.endsWith('.')?offer:`${offer}.`,
  'Si le sujet est d’actualité chez vous, je peux vous montrer comment nous l’abordons, au moment qui vous convient.',
  i.senderName?`${i.senderName}`:'',
  OPT_OUT].filter(Boolean).join('\n\n');
 return finish(i,text,`${i.company} : une question sur votre prospection`,'INITIAL');
}
export function generateFollowUp(i:Pick<MessageInput,'company'|'contactName'|'offer'|'senderName'|'signal'|'evidence'|'commercialType'>):GeneratedMessage{
 const fn=firstName(i.contactName);
 const text=[`Bonjour${fn?` ${fn}`:''},`,'Je reviens simplement vers vous au sujet de mon message précédent.',
  'Si la question des comptes à contacter en priorité est d’actualité, je peux vous montrer comment nous l’abordons. Sinon, aucun souci : je ne vous relancerai pas davantage.',
  i.senderName?`${i.senderName}`:'',OPT_OUT].filter(Boolean).join('\n\n');
 return finish(i as MessageInput,text,`${i.company} : une question sur votre prospection`,'FOLLOW_UP');
}
function finish(i:MessageInput,text:string,subject:string,kind:string):GeneratedMessage{
 const names=[i.company,i.contactName,i.senderName].filter(Boolean);
 const why=refusedText(text,i.offer,names)??refusedText(subject,'',names);if(why)return {ok:false,reason:why};
 const sources=sourcesOf(i);
 const guard=checkComposedMessage(text,{name:i.company,offer:`${i.offer} ${i.senderName} ${i.contactName}`,sources,allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:MAX_CHARS,angleType:'signal'});
 if(!guard.ok)return {ok:false,reason:`FACT_GUARD_${guard.reason}${'category' in guard?`_${guard.category.toUpperCase()}`:''}`};
 return {ok:true,subject:subject.replace(/[\r\n]+/g,' ').slice(0,140),text,
  evidence_refs:{signal_ids:[i.signal.id],evidence_ids:i.evidence.filter(e=>e.status==='VERIFIED').map(e=>e.id),source_urls:[i.signal.source_url]},
  generation_meta:{generator:OUTREACH_GENERATOR,kind,commercial_type:i.commercialType,signal_label:entryOf(i.commercialType).label.fr,guard:'fact-guard+nba-forbidden'}};
}
// A person's edit is checked with the same rules before it can be approved: no new unsourced fact, no forbidden offer.
export function checkHumanEdit(text:string,i:Pick<MessageInput,'company'|'contactName'|'offer'|'senderName'|'signal'|'evidence'>):{ok:true}|{ok:false;reason:string}{
 const why=refusedText(text,i.offer,[i.company,i.contactName,i.senderName]);if(why)return {ok:false,reason:why};
 const g=checkComposedMessage(text,{name:i.company,offer:`${i.offer} ${i.senderName} ${i.contactName}`,sources:sourcesOf(i),allowedUrls:[],forbiddenNames:[],bannedPhrases:[],maxChars:2000,angleType:'signal'});
 return g.ok?{ok:true}:{ok:false,reason:`FACT_GUARD_${g.reason}`};
}
