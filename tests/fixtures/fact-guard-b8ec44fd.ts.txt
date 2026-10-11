// O2 — the factual guard on a composed message (AI output). Deterministic and fail-closed: anything specific about the
// prospect must come from the data the message was allowed to use (the angle and the VERIFIED sources). The offer (our
// own pitch) and the company's name may appear in the message, but never prove a fact about the prospect; a number is
// sourced only as a whole token. Otherwise the message is refused and the rule-based one is used instead.
import {fold,bannedPhrasesIn} from './style.ts';

export type GuardContext={name:string;offer:string;sources:string[];allowedUrls:string[];forbiddenNames:string[];bannedPhrases:string[];maxChars:number;angleType:string};
// Kinds of company facts a message must never assert unless a source says so (FR + EN stems, folded). Each family has a
// canonical name, returned with an UNSUPPORTED_CLAIM refusal so an attempt can be diagnosed without keeping its text.
export const CLAIM_CATEGORIES=['hiring','funding','growth','partnership','incident','contract','acquisition','appointment','launch','certification','event','revenue','publication'] as const;
export type ClaimCategory=typeof CLAIM_CATEGORIES[number];
export type GuardResult={ok:true}|{ok:false;reason:'EMPTY'|'TOO_LONG'|'BANNED_PHRASE'|'FOREIGN_COMPANY'|'UNSUPPORTED_QUOTE'|'UNSUPPORTED_URL'|'UNSUPPORTED_NUMBER'}|{ok:false;reason:'UNSUPPORTED_CLAIM';category:ClaimCategory};
const CLAIMS:RegExp[]=[/recrut|embauch|\bhiring\b|recruit/,/levee de fonds|\bleve\b|financement|funding|\braised?\b|tour de table/,/croissance|\bgrowth\b|en plein essor|forte expansion/,
 /partenariat|partenaire|partnership|\bpartner/,/incident|cyberattaque|piratage|\bbreach|\battaque\b|ransomware|rancongiciel/,/\bcontrat\b|marche public|appel d.offres|\bcontract\b|\btender\b/,
 /rachat|acquisition|\bacquis|acquired|\bfusion\b|merger/,/nomination|\bnomme|appointed|nouveau (directeur|dirigeant|president)|new (ceo|cto|director)/,/\blancement\b|\blance\b|\blaunch/,
 /certification|certifie|\bcertified\b/,/\bsalon\b|evenement|webinar|conference/,/chiffre d.affaires|\brevenue\b|\bca de\b/,
 /publication|\bpost\b|\barticle\b|vous avez ecrit|vous avez publie|you wrote|you posted/];
const QUOTE=/«\s*([^»]+?)\s*»|“([^”]+)”|"([^"]+)"/g;
const stripEllipsis=(s:string)=>s.replace(/(…|\.\.\.)\s*$/,'').trim();
// Numbers as exact tokens (27 is not 2027): digits joined by a space before exactly 3 digits (thousands), or by a dot or
// a comma before digits (decimals), make one number; separators are normalised (2 500 = 2500, 4,5 = 4.5). Folded text:
// every kind of space is already a plain one.
const numbersIn=(folded:string)=>(folded.match(/\d+(?: \d{3}(?!\d)|[.,]\d+)*/g)??[]).map(n=>n.replace(/ /g,'').replace(/,/g,'.'));
// Without the company's name: a name is no claim, and no proof either.
const withoutName=(folded:string,own:string)=>own.length>=2?folded.split(own).join(' '):folded;
// Offer-attributed sentence: our offer may support a fact word only where the sentence clearly speaks about our solution
// — never about the prospect. Deterministic and bounded, all three required:
//  (a) it starts with an offer subject (the brand the offer opens with, nous / notre approche…, we / our …) followed by a
//      capability verb (aide, permet, propose — help, let, enable, offer), a modal and a you-pronoun allowed in between;
//  (b) after that prefix it names nobody on the prospect side (no tu/ton/vous/votre/you/your…, nor the prospect's name);
//  (c) each occurrence of the fact family sits, after that prefix, inside ≥ 3 consecutive words copied verbatim from the
//      offer (the subject and verb never count as cover).
// Anything else (ambiguous, mixed, prospect-side) is judged exactly as before: the offer never proves a prospect fact.
const words=(folded:string)=>folded.replace(/[^a-z0-9']+/g,' ').trim();
const CAPABILITY='aide|aider|aidons|aident|aidera|permet|permettre|permettons|permettent|permettra|propose|proposer|proposons|proposent|help|helps|let|lets|enable|enables|offer|offers';
const GENERIC_SUBJECTS="nous|notre (?:approche|solution|offre|service|outil|plateforme|methode)|nos (?:services|solutions|outils)|we|our (?:approach|solution|offer|service|tool|platform)";
// Words of a company name too generic to identify the prospect on their own.
const GENERIC_NAME_WORDS=new Set(['software','group','groupe','sas','sa','sarl','france','solutions','solution','services','service','consulting','conseil','international','the','les','la','le','de','des','du','et','and']);
const PROSPECT_SIDE=new Set(['tu','toi','ton','ta','tes','te','tien','tienne','tiens','tiennes','vous','votre','vos','you','your','yours']);
const escapeRe=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function offerBrand(offerWords:string):string|null{
 const first=offerWords.split(' ');const k=first.findIndex(w=>new RegExp(`^(?:${CAPABILITY})$`).test(w));
 return k>=1&&k<=3?first.slice(0,k).join(' '):null;
}
function offerAttributedPrefix(sentence:string,offerWords:string,own:string):number|null{
 const brand=offerBrand(offerWords);
 const subject=brand?`${escapeRe(brand)}|${GENERIC_SUBJECTS}`:GENERIC_SUBJECTS;
 const m=new RegExp(`^(?:(?:bonjour|hello|salut|hi) )?(?:${subject}) (?:(?:peut|peuvent|pourrait|pourraient|pouvons|pourrions|va|vont|allons|can|could|will) )?(?:t'|te |vous |you )?(?:${CAPABILITY})(?= |$)`).exec(sentence);
 if(!m)return null;
 const rest=sentence.slice(m[0].length).trim();
 if(rest.split(' ').some(w=>PROSPECT_SIDE.has(w)||w.startsWith("t'")))return null;
 const nameWords=words(own).split(' ').filter(w=>w.length>=3&&!GENERIC_NAME_WORDS.has(w));
 if((own.length>=2&&` ${rest} `.includes(` ${words(own)} `))||rest.split(' ').some(w=>nameWords.includes(w)))return null;
 return m[0].length;
}
function coveredByOffer(sentence:string,re:RegExp,offerWords:string):boolean{
 const tokens=sentence.split(' ');const starts:number[]=[];let at=0;for(const t of tokens){starts.push(at);at+=t.length+1}
 const index=(char:number)=>{let i=0;while(i+1<starts.length&&starts[i+1]<=char)i++;return i};
 const padded=` ${offerWords} `;const global=new RegExp(re.source,'g');let any=false;
 for(const match of sentence.matchAll(global)){
  any=true;const a=index(match.index!),b=index(match.index!+Math.max(match[0].length-1,0));let ok=false;
  for(let i=a;i>=0&&!ok;i--)for(let j=b;j<tokens.length&&!ok;j++)if(j-i+1>=3&&padded.includes(` ${tokens.slice(i,j+1).join(' ')} `))ok=true;
  if(!ok)return false;
 }
 return any;
}
export function checkComposedMessage(text:string,ctx:GuardContext):GuardResult{
 const t=text.trim();if(!t)return {ok:false,reason:'EMPTY'};
 if(t.length>ctx.maxChars)return {ok:false,reason:'TOO_LONG'};
 if(bannedPhrasesIn(t,ctx.bannedPhrases).length)return {ok:false,reason:'BANNED_PHRASE'};
 const ft=fold(t),own=fold(ctx.name);
 if(ctx.forbiddenNames.some(n=>{const f=fold(n);return f.length>=3&&f!==own&&ft.includes(f)}))return {ok:false,reason:'FOREIGN_COMPANY'};
 const sources=ctx.sources.map(fold);
 for(const m of t.matchAll(QUOTE)){const q=fold(stripEllipsis(m[1]??m[2]??m[3]??''));if(q&&!sources.some(s=>s.includes(q)))return {ok:false,reason:'UNSUPPORTED_QUOTE'}}
 for(const u of t.match(/https?:\/\/[^\s)»”"]+/g)??[]){const x=u.replace(/[.,;:!?]+$/,'');if(!ctx.allowedUrls.includes(x)&&!ctx.sources.some(s=>s.includes(x)))return {ok:false,reason:'UNSUPPORTED_URL'}}
 const known=new Set(numbersIn(fold([...ctx.sources,ctx.offer,ctx.name].join(' \n '))));
 for(const n of numbersIn(ft))if(!known.has(n))return {ok:false,reason:'UNSUPPORTED_NUMBER'};
 // A fact about the prospect is proven by the prospect's own sources only — never by the offer nor by the company's
 // name. A sentence copied from the offer (3 words or more) is the offer speaking, not a claim; a paraphrase carrying a
 // fact word cannot be told apart from a claim, so it needs the sources too. A public-content angle may say it is a
 // publication.
 const offer=fold(ctx.offer),offerWords=words(offer);
 const proof=sources.map(s=>withoutName(s,own)).join(' \n ')+(ctx.angleType.startsWith('public_content')?' publication post article vous avez publie':'');
 for(const sentence of t.split(/(?<=[.!?…])\s+|\n+/)){
  const s=fold(sentence).replace(/[.!?…]+$/,'').trim();
  if(!s||(s.split(' ').length>=3&&offer.includes(s)))continue;
  const w=words(s),prefix=offerAttributedPrefix(w,offerWords,own),complement=prefix===null?'':w.slice(prefix).trim();
  const family=CLAIMS.findIndex(re=>re.test(withoutName(s,own))&&!re.test(proof)&&!(prefix!==null&&!re.test(w.slice(0,prefix))&&coveredByOffer(complement,re,offerWords)));
  if(family>=0)return {ok:false,reason:'UNSUPPORTED_CLAIM',category:CLAIM_CATEGORIES[family]};
 }
 return {ok:true};
}
