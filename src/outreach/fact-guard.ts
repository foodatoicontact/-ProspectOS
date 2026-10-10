// O2 — the factual guard on a composed message (AI output). Deterministic and fail-closed: anything specific about the
// prospect must come from the data the message was allowed to use (the angle and the VERIFIED sources), the offer or the
// company's own name. Otherwise the message is refused and the rule-based one is used instead.
import {fold,bannedPhrasesIn} from './style.ts';

export type GuardContext={name:string;offer:string;sources:string[];allowedUrls:string[];forbiddenNames:string[];bannedPhrases:string[];maxChars:number;angleType:string};
export type GuardResult={ok:true}|{ok:false;reason:'EMPTY'|'TOO_LONG'|'BANNED_PHRASE'|'FOREIGN_COMPANY'|'UNSUPPORTED_QUOTE'|'UNSUPPORTED_URL'|'UNSUPPORTED_NUMBER'|'UNSUPPORTED_CLAIM'};
// Kinds of company facts a message must never assert unless a source says so (FR + EN stems, folded).
const CLAIMS:RegExp[]=[/recrut|embauch|\bhiring\b|recruit/,/levee de fonds|\bleve\b|financement|funding|\braised?\b|tour de table/,/croissance|\bgrowth\b|en plein essor|forte expansion/,
 /partenariat|partenaire|partnership|\bpartner/,/incident|cyberattaque|piratage|\bbreach|\battaque\b|ransomware|rancongiciel/,/\bcontrat\b|marche public|appel d.offres|\bcontract\b|\btender\b/,
 /rachat|acquisition|\bacquis|acquired|\bfusion\b|merger/,/nomination|\bnomme|appointed|nouveau (directeur|dirigeant|president)|new (ceo|cto|director)/,/\blancement\b|\blance\b|\blaunch/,
 /certification|certifie|\bcertified\b/,/\bsalon\b|evenement|webinar|conference/,/chiffre d.affaires|\brevenue\b|\bca de\b/,
 /publication|\bpost\b|\barticle\b|vous avez ecrit|vous avez publie|you wrote|you posted/];
const QUOTE=/«\s*([^»]+?)\s*»|“([^”]+)”|"([^"]+)"/g;
const stripEllipsis=(s:string)=>s.replace(/(…|\.\.\.)\s*$/,'').trim();
export function checkComposedMessage(text:string,ctx:GuardContext):GuardResult{
 const t=text.trim();if(!t)return {ok:false,reason:'EMPTY'};
 if(t.length>ctx.maxChars)return {ok:false,reason:'TOO_LONG'};
 if(bannedPhrasesIn(t,ctx.bannedPhrases).length)return {ok:false,reason:'BANNED_PHRASE'};
 const ft=fold(t),own=fold(ctx.name);
 if(ctx.forbiddenNames.some(n=>{const f=fold(n);return f.length>=3&&f!==own&&ft.includes(f)}))return {ok:false,reason:'FOREIGN_COMPANY'};
 const sources=ctx.sources.map(fold);
 for(const m of t.matchAll(QUOTE)){const q=fold(stripEllipsis(m[1]??m[2]??m[3]??''));if(q&&!sources.some(s=>s.includes(q)))return {ok:false,reason:'UNSUPPORTED_QUOTE'}}
 for(const u of t.match(/https?:\/\/[^\s)»”"]+/g)??[]){const x=u.replace(/[.,;:!?]+$/,'');if(!ctx.allowedUrls.includes(x)&&!ctx.sources.some(s=>s.includes(x)))return {ok:false,reason:'UNSUPPORTED_URL'}}
 const corpus=fold([...ctx.sources,ctx.offer,ctx.name].join(' \n '));const digits=corpus.replace(/[\s.,  ]/g,'');
 for(const n of t.match(/\d[\d\s.,  ]*\d|\d/g)??[]){const d=n.replace(/[\s.,  ]/g,'');if(!digits.includes(d))return {ok:false,reason:'UNSUPPORTED_NUMBER'}}
 // A public-content angle may say it is a publication; every other kind of fact must be in the sources or the offer.
 const claimCorpus=ctx.angleType.startsWith('public_content')?`${corpus} publication post article vous avez publie`:corpus;
 if(CLAIMS.some(re=>re.test(ft)&&!re.test(claimCorpus)))return {ok:false,reason:'UNSUPPORTED_CLAIM'};
 return {ok:true};
}
