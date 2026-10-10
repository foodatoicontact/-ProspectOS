// O1 — the user's personal writing profile and the few-shot style examples learned from their own edits. No
// fine-tuning, no silent mutation: the profile changes only when its owner saves it (migration 027), and examples are
// pairs (generated → edited) of the same user's past messages, used for STYLE only — never as facts about a prospect.
export type StyleProfile={tone:'professional_conversational'|'formal'|'warm'|'direct';address_mode:'auto'|'vous'|'tu';length:'short'|'medium';
 max_chars:number;banned_phrases:string[];preferred_ctas:string[];instructions:string};
export const STYLE_INSTRUCTIONS_MAX=1500;
export const DEFAULT_STYLE_PROFILE:StyleProfile={tone:'professional_conversational',address_mode:'auto',length:'short',max_chars:600,
 banned_phrases:['Je me permets de vous contacter','J’ai été impressionné par','Votre parcours remarquable','Je suis tombé sur votre profil','Dans un monde en constante évolution','révolutionnaire','game changer','synergie','continuum'],
 preferred_ctas:[],
 instructions:['Phrases courtes.','Vocabulaire simple.','Professionnel mais naturel.','Éviter le jargon startup.','Éviter la fausse admiration et la fausse familiarité.','CTA léger.','Pas de mur de texte.','Ne jamais inventer de contexte.'].join('\n')};
const KEYS=['tone','address_mode','length','max_chars','banned_phrases','preferred_ctas','instructions'];
const strings=(v:unknown,max:number,len:[number,number])=>Array.isArray(v)&&v.length<=max&&v.every(s=>typeof s==='string'&&s.trim().length>=len[0]&&s.trim().length<=len[1]);
// Mirrors save_outreach_style_profile (migration 027): exact keys, closed values, bounded lists and instructions.
export function validateStyleProfile(v:unknown):{ok:true;profile:StyleProfile}|{ok:false;error:string}{
 const p=v as Record<string,unknown>;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!KEYS.includes(k)))return {ok:false,error:'INVALID_FIELDS'};
 if(!['professional_conversational','formal','warm','direct'].includes(p.tone as string)||!['auto','vous','tu'].includes(p.address_mode as string)||!['short','medium'].includes(p.length as string))return {ok:false,error:'INVALID_VALUE'};
 if(!Number.isInteger(p.max_chars)||(p.max_chars as number)<200||(p.max_chars as number)>2000)return {ok:false,error:'INVALID_MAX_CHARS'};
 if(!strings(p.banned_phrases??[],30,[2,120])||!strings(p.preferred_ctas??[],10,[2,200]))return {ok:false,error:'INVALID_LIST'};
 if(typeof (p.instructions??'')!=='string'||String(p.instructions??'').length>STYLE_INSTRUCTIONS_MAX)return {ok:false,error:'INVALID_INSTRUCTIONS'};
 return {ok:true,profile:{tone:p.tone,address_mode:p.address_mode,length:p.length,max_chars:p.max_chars,banned_phrases:(p.banned_phrases??[]) as string[],preferred_ctas:(p.preferred_ctas??[]) as string[],instructions:String(p.instructions??'')} as StyleProfile};
}
export function styleOf(row:Record<string,unknown>|null|undefined):StyleProfile{
 if(!row)return DEFAULT_STYLE_PROFILE;
 const r=validateStyleProfile(Object.fromEntries(KEYS.map(k=>[k,row[k]])));return r.ok?r.profile:DEFAULT_STYLE_PROFILE;
}
// Accent-, case-, apostrophe- and spacing-insensitive comparison form.
export const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’‘`´]/g,"'").toLowerCase().replace(/\s+/g,' ').trim();
export function bannedPhrasesIn(text:string,phrases:string[]):string[]{const t=fold(text);return phrases.filter(p=>fold(p)&&t.includes(fold(p)))}

export const MAX_STYLE_EXAMPLES=5;
export type StyleExampleRow={id:string;created_by:string|null;generated_content:string|null;content:string;created_at:string;prospect_name?:string|null};
export type StyleExample={id:string;generated:string;edited:string;prospect_name:string|null};
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// What an example may teach is the transformation, not its content: the old prospect's name, quoted passages and
// links are masked so no fact about another company can travel into a new message.
function mask(text:string,name:string|null|undefined){
 let t=text;if(name&&name.trim().length>=2)t=t.replace(new RegExp(escape(name.trim()),'gi'),'{entreprise}');
 return t.replace(/«[^»]*»/g,'« … »').replace(/“[^”]*”/g,'“…”').replace(/https?:\/\/\S+/g,'{lien}');
}
// The user's own messages (created_by = the user) that a person really edited, newest first, at most 5.
export function pickStyleExamples(rows:StyleExampleRow[],userId:string,max=MAX_STYLE_EXAMPLES):StyleExample[]{
 return rows.filter(r=>r.created_by===userId&&typeof r.generated_content==='string'&&r.generated_content.trim()&&r.content.trim()&&fold(r.generated_content)!==fold(r.content))
  .sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id)).slice(0,Math.min(max,MAX_STYLE_EXAMPLES))
  .map(r=>({id:r.id,generated:mask(r.generated_content!,r.prospect_name),edited:mask(r.content,r.prospect_name),prospect_name:r.prospect_name??null}));
}
