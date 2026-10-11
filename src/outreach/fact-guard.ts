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
 const offer=fold(ctx.offer);
 const proof=sources.map(s=>withoutName(s,own)).join(' \n ')+(ctx.angleType.startsWith('public_content')?' publication post article vous avez publie':'');
 for(const sentence of t.split(/(?<=[.!?…])\s+|\n+/)){
  const s=fold(sentence).replace(/[.!?…]+$/,'').trim();
  if(!s||(s.split(' ').length>=3&&offer.includes(s)))continue;
  const family=CLAIMS.findIndex(re=>re.test(withoutName(s,own))&&!re.test(proof));
  if(family>=0)return {ok:false,reason:'UNSUPPORTED_CLAIM',category:CLAIM_CATEGORIES[family]};
 }
 return {ok:true};
}
