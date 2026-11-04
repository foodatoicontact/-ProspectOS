// ICP import — normalising the model's answer before validation (docs/ICP_IMPORT.md §Normalisation). A deliberate
// relaxation, after smoke test #4 (4 Nov. 2026): one faulty value used to reject the whole answer, so a real document
// could never pass. Now each leaf and each list item is checked on its own, against the same value schemas as the
// profile (schema.ts VALUE), and what fails is taken out — never rewritten:
//  - a source longer than ICP_LIMITS.source is cut at that length, at a word boundary: the start of an exact passage
//    is still an exact passage, and the check against the document (dropUnverified) still runs after the cut;
//  - a value too long or invalid is emptied (null → a missing question), never shortened or "fixed";
//  - a list item that is not a well-formed { value, source, confidence } envelope, or whose value is refused, is
//    removed; a list longer than its bound keeps its first items;
//  - an unknown field below the root is dropped; apeCodes are never taken from the model (they come from the
//    deterministic mapping of step 4) — ignored, with a warning;
//  - every correction is reported with its path, a reason code and the rule that refused it; an item taken out of a
//    list also carries its length — and, for the smoke-test console only, its first 60 characters (EXCERPT_MAX).
// What stays strict, and rejects the whole answer (one retry): unreadable JSON, a root key missing or unknown, a wrong
// version, a root block of the wrong type. Then the result is validated as a whole by parseIcpProfile, as before.
import {ICP_LIMITS as L,VALUE,SEGMENT_KEY,ROOT_KEYS,ICP_PROFILE_VERSION} from './schema.ts';
import type {z} from 'zod';

export type FixCode='SOURCE_TRUNCATED'|'VALUE_DROPPED_TOO_LONG'|'VALUE_DROPPED_INVALID'|'ITEM_DROPPED_INVALID'|'ITEM_DROPPED_TOO_LONG'
 |'ITEM_DROPPED_OVER_LIMIT'|'FIELD_DROPPED_UNKNOWN'|'FIELD_MISSING'|'APE_CODES_IGNORED'|'SEGMENT_REF_DROPPED'|'KEY_REGENERATED'|'VALUE_TRIMMED';
export type Reason='too_long'|'invalid_value'|'wrong_shape'|'over_limit'|'unknown_field'|'not_requested'|'not_in_source';
// rule: which rule of the schema refused it, in words. For an item taken out of a list (ITEM_DROPPED_*): length, the
// size of what the model wrote (characters), and excerpt, its first 60 characters. The excerpt is for the operator's
// smoke-test console only (scripts/icp-import-smoke.ts); the server log (describeFixes) carries path, rule and length —
// never text of the document (SECURITY.md).
export type Fix={code:FixCode;path:string;reason:Reason;rule?:string;length?:number;excerpt?:string};
export const EXCERPT_MAX=60;
export const lengthOf=(v:unknown)=>(typeof v==='string'?v:JSON.stringify(v)??String(v)).length;
export function excerptOf(v:unknown):string{
 const t=typeof v==='string'?v:JSON.stringify(v)??String(v);
 return t.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g,' ').slice(0,EXCERPT_MAX);
}
// The first refusal of a value schema, in words: the field inside the value, the rule, the bound or the allowed values.
export function ruleOf(e:z.ZodError):string{
 const i=e.issues[0] as {code:string;path:(string|number)[];maximum?:number|bigint;minimum?:number|bigint;values?:unknown[];expected?:string;format?:string;message:string}|undefined;
 if(!i)return 'valeur refusée';
 const at=i.path.length?`${i.path.join('.')} : `:'';
 switch(i.code){
  case 'too_big':return `${at}trop long (${String(i.maximum)} max)`;
  case 'too_small':return `${at}trop court ou vide (${String(i.minimum)} min)`;
  case 'invalid_value':return `${at}valeur non admise (attendu ${(i.values??[]).map(String).join('|')})`;
  case 'invalid_type':return `${at}type ${i.expected} attendu`;
  case 'invalid_format':return `${at}format ${i.format??''} attendu`;
  case 'unrecognized_keys':return `${at}propriété inconnue`;
  case 'custom':return `${at}${i.message}`;
  default:return `${at}${i.code}`;
 }
}
export type StructureIssue={path:string;reason:Reason};
export type Normalized={ok:true;value:Record<string,unknown>;fixes:Fix[];emptied:string[]}|{ok:false;issues:StructureIssue[]};

const isObject=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
// An unknown key is named in a path only when it looks like an identifier (it is the model's text, not ours): anything
// else — spaces, punctuation, a long string — is reported as "*", so no content can travel through a path.
const keyName=(k:string)=>/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k)?k:'*';
const EMPTY={value:null,source:null,confidence:0};
// A list item whose label is blank (absent, null, empty text) carries nothing: it is removed silently — no correction is
// reported for it (it is not an error of the model's, just an empty slot), and the missing questions stay as they were.
const isBlank=(f:unknown)=>!isObject(f)||f.value===null||f.value===undefined||(typeof f.value==='string'&&f.value.trim()==='');
const LEAF_KEYS=new Set(['value','source','confidence']);

// Words compared without accents nor case (and without the punctuation around them).
const fold=(w:string)=>w.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,'');
function valueWords(value:unknown):Set<string>{
 const out=new Set<string>();
 const walk=(v:unknown)=>{if(typeof v==='string'){for(const w of v.split(/[\s'’]+/)){const f=fold(w);if(f.length>=2)out.add(f)}}else if(v&&typeof v==='object')Object.values(v).forEach(walk)};
 walk(value);return out;
}
// A source longer than the bound keeps the window of whole words, at most `max` characters, that holds the most words
// of the value (compared without accents nor case); on a tie, the one nearest the start. It is a contiguous piece of
// the model's source — so still an exact passage of the document when the source was (dropUnverified checks it after).
// A single word longer than the bound falls back to the first `max` characters.
export function cutSource(source:string,value?:unknown,max=L.source):string{
 if(source.length<=max)return source;
 const words=[...source.matchAll(/\S+/g)].map(m=>({start:m.index!,end:m.index!+m[0].length,key:fold(m[0])}));
 const wanted=valueWords(value);
 let best:{start:number;end:number;score:number}|null=null;
 for(let i=0;i<words.length;i++){
  let j=i;
  if(words[i]!.end-words[i]!.start>max)continue;
  while(j+1<words.length&&words[j+1]!.end-words[i]!.start<=max)j++;
  const hit=new Set(words.slice(i,j+1).map(w=>w.key).filter(k=>wanted.has(k)));
  if(!best||hit.size>best.score)best={start:words[i]!.start,end:words[j]!.end,score:hit.size};
 }
 if(!best)return source.slice(0,max);
 return source.slice(best.start,best.end).replace(/[\s,;:\-–—]+$/,'');
}
// ---------- how much of a value its source covers (after runs #10 and #11) ----------
// Words of a text, folded (no accents, no case), split on anything that is not a letter or a digit.
const foldedWords=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const PARTIAL_SOURCE_RATIO=0.5;
// A text value is "partially sourced" when fewer than half of its words of 4 letters or more (no accents, no case)
// appear in its source. Only a marking for the review screen: the value is kept. A value with no such word, a value
// that is not text, a missing source, are never marked.
export function isPartialSource(value:unknown,source:string|null|undefined):boolean{
 if(typeof value!=='string'||typeof source!=='string'||!source)return false;
 const wanted=[...new Set(foldedWords(value).filter(w=>(w.match(/[a-z]/g)??[]).length>=4))];
 if(!wanted.length)return false;
 const have=new Set(foldedWords(source));
 return wanted.filter(w=>have.has(w)).length/wanted.length<PARTIAL_SOURCE_RATIO;
}
// offer.proofs only: a proper noun (a word that starts with a capital letter) of the value that its source does not
// hold is taken out of the value, with the separator that goes with it; the rest is kept as written. Returns the value
// unchanged when nothing is taken out, '' when nothing is left. Compared without accents nor case.
export function trimProperNouns(value:string,source:string):string{
 const have=new Set(foldedWords(source));
 const tokens=value.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu)??[];
 const isWord=(t:string)=>/^[\p{L}\p{N}]/u.test(t);
 const gone=tokens.map(t=>isWord(t)&&/^\p{Lu}/u.test(t)&&foldedWords(t).some(w=>!have.has(w)));
 if(!gone.some(Boolean))return value;
 // A taken-out word goes with the separator before it — or, at the very start, the one after it.
 const drop=gone.slice();
 tokens.forEach((t,i)=>{if(!gone[i])return;if(i>0&&!isWord(tokens[i-1]!)&&tokens.slice(0,i-1).some((x,k)=>isWord(x)&&!gone[k]))drop[i-1]=true;else if(i+1<tokens.length&&!isWord(tokens[i+1]!))drop[i+1]=true});
 return tokens.filter((_,i)=>!drop[i]).join('').replace(/^[\s,;:.…\-–—/]+|[\s,;:.…\-–—/]+$/g,'').replace(/\s{2,}/g,' ').replace(/\s+(?:et|ou|and|or|&)$/i,'');
}

// A segment key from its label: lower case, no accents, underscores, ICP_LIMITS.segmentKey characters at most, a numeric
// suffix when it is already taken.
export function segmentKeyFrom(label:string,taken:readonly string[]):string{
 const base=(label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'segment');
 let key=base.slice(0,L.segmentKey).replace(/_+$/,'');let n=2;
 while(taken.includes(key)){const suffix=`_${n++}`;key=`${base.slice(0,L.segmentKey-suffix.length).replace(/_+$/,'')}${suffix}`}
 return key;
}
const tooLong=(e:z.ZodError)=>e.issues.some(i=>i.code==='too_big');

export function normalizeExtraction(raw:unknown):Normalized{
 const fixes:Fix[]=[];const emptied:string[]=[];
 const fix=(code:FixCode,path:string,reason:Reason,detail?:{rule:string;excerpt?:unknown})=>{fixes.push({code,path,reason,...(detail?{rule:detail.rule,...(code.startsWith('ITEM_DROPPED')&&detail.excerpt!==undefined?{length:lengthOf(detail.excerpt),excerpt:excerptOf(detail.excerpt)}:{})}:{})})};
 if(!isObject(raw))return {ok:false,issues:[{path:'(root)',reason:'wrong_shape'}]};
 const issues:StructureIssue[]=[];
 for(const k of ROOT_KEYS)if(!(k in raw))issues.push({path:k,reason:'wrong_shape'});
 for(const k of Object.keys(raw))if(!(ROOT_KEYS as readonly string[]).includes(k))issues.push({path:keyName(k),reason:'unknown_field'});
 if(raw.version!==ICP_PROFILE_VERSION)issues.push({path:'version',reason:'invalid_value'});
 for(const k of ['company','offer'] as const)if(k in raw&&!isObject(raw[k]))issues.push({path:k,reason:'wrong_shape'});
 for(const k of ['segments','personas','signals','exclusions'] as const)if(k in raw&&!Array.isArray(raw[k]))issues.push({path:k,reason:'wrong_shape'});
 if(issues.length)return {ok:false,issues};

 // One leaf. Returns the clean leaf, or null when it must go (in a list: the item is removed).
 const leaf=(x:unknown,schema:z.ZodType,path:string,inList:boolean):Record<string,unknown>|null=>{
  const drop=(reason:Reason,rule:string,excerpt:unknown)=>{
   fix(inList?(reason==='too_long'?'ITEM_DROPPED_TOO_LONG':'ITEM_DROPPED_INVALID'):(reason==='too_long'?'VALUE_DROPPED_TOO_LONG':'VALUE_DROPPED_INVALID'),path,reason,{rule,excerpt});
   emptied.push(path);return inList?null:{...EMPTY};
  };
  if(!isObject(x)||!('value' in x))return drop('wrong_shape','enveloppe {value, source, confidence} attendue',x);
  const extra=Object.keys(x).filter(k=>!LEAF_KEYS.has(k));
  if(extra.length)return drop('wrong_shape',`enveloppe {value, source, confidence} attendue (propriété en trop : ${keyName(extra[0]!)})`,x.value);
  if(x.value===null||x.value===undefined)return inList?null:{...EMPTY};
  let source=x.source;
  if(source!==null&&source!==undefined&&typeof source!=='string')return drop('wrong_shape','source : texte ou null attendu',x.value);
  if(typeof source==='string'){
   source=source.trim()||null;
   if(typeof source==='string'&&source.length>L.source){source=cutSource(source,x.value);fix('SOURCE_TRUNCATED',path,'too_long')}
  }
  const c=x.confidence;
  if(typeof c!=='number'||!Number.isFinite(c)||c<0||c>1)return drop('invalid_value','confidence : nombre entre 0 et 1 attendu',x.value);
  const v=schema.safeParse(x.value);
  if(!v.success)return drop(tooLong(v.error)?'too_long':'invalid_value',ruleOf(v.error),x.value);
  return {value:v.data,source:source??null,confidence:c};
 };
 const list=(x:unknown,path:string,max:number,item:(y:unknown,p:string)=>unknown|null):unknown[]=>{
  if(x===undefined){fix('FIELD_MISSING',path,'wrong_shape');return []}
  if(!Array.isArray(x)){fix('VALUE_DROPPED_INVALID',path,'wrong_shape');emptied.push(path);return []}
  const out:unknown[]=[];
  x.forEach((y,i)=>{const r=item(y,`${path}.${i}`);if(r!==null)out.push(r)});
  if(out.length>max){fix('ITEM_DROPPED_OVER_LIMIT',path,'over_limit',{rule:`${max} éléments max (${out.length} reçus) : les premiers sont gardés`,excerpt:out.slice(max).map(o=>isObject(o)&&'value' in o?o.value:isObject(o)&&isObject(o.label)?o.label.value:isObject(o)&&isObject(o.role)?o.role.value:o)});return out.slice(0,max)}
  return out;
 };
 const leafList=(x:unknown,path:string,max:number,schema:z.ZodType)=>list(x,path,max,(y,p)=>leaf(y,schema,p,true));
 // An object with known fields: unknown ones dropped (reported), missing leaves filled empty (reported).
 const fields=(x:Record<string,unknown>,path:string,known:readonly string[])=>{
  for(const k of Object.keys(x))if(!known.includes(k))fix('FIELD_DROPPED_UNKNOWN',`${path}.${keyName(k)}`,'unknown_field');
 };
 const single=(x:Record<string,unknown>,key:string,schema:z.ZodType,path:string)=>{
  if(!(key in x)){fix('FIELD_MISSING',`${path}.${key}`,'wrong_shape');return {...EMPTY}}
  return leaf(x[key],schema,`${path}.${key}`,false)!;
 };

 const co=raw.company as Record<string,unknown>;
 fields(co,'company',['name','activity','sites','interventionZones','coverage']);
 const company:Record<string,unknown>={
  name:single(co,'name',VALUE.name,'company'),activity:single(co,'activity',VALUE.activity,'company'),
  sites:leafList(co.sites,'company.sites',L.sites,VALUE.site),
  interventionZones:leafList(co.interventionZones,'company.interventionZones',L.zones,VALUE.zone),
 };
 if('coverage' in co){const cv=leaf(co.coverage,VALUE.coverage,'company.coverage',false)!;if(cv.value!==null)company.coverage=cv}

 const of=raw.offer as Record<string,unknown>;
 fields(of,'offer',['services','promises','differentiators','proofs']);
 const offer={
  services:leafList(of.services,'offer.services',L.services,VALUE.service),
  // A commitment whose text, value and unit are all null is an empty slot: removed silently (like a blank label).
  promises:list(of.promises,'offer.promises',L.promises,(y,p)=>isObject(y)&&isObject(y.value)&&['text','value','unit'].every(k=>(y.value as Record<string,unknown>)[k]==null)?null:leaf(y,VALUE.promise,p,true)),
  differentiators:leafList(of.differentiators,'offer.differentiators',L.differentiators,VALUE.differentiator),
  // A proof names clients, labels, certifications: a proper noun its own source does not hold is taken out (path only).
  proofs:list(of.proofs,'offer.proofs',L.proofs,(y,p)=>{
   const l=leaf(y,VALUE.proof,p,true);
   if(!l||typeof l.value!=='string'||typeof l.source!=='string')return l;
   const kept=trimProperNouns(l.value,l.source);
   if(kept===l.value)return l;
   fix('VALUE_TRIMMED',p,'not_in_source');
   if(!kept){emptied.push(p);return null}
   return {...l,value:kept};
  }),
 };

 const keys:string[]=[];
 const renamed=new Map<string,string>(); // a regenerated key: the signals that pointed to the old one follow it
 const segments=list(raw.segments,'segments',L.segments,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet segment attendu',excerpt:y});emptied.push(p);return null}
  fields(y,p,['key','label','apeCodes','sizeRange','priority','estimatedValue','salesCycle']);
  if(isBlank(y.label)){emptied.push(p);return null}
  const label=single(y,'label',VALUE.segmentLabel,p);
  if(label.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:`segment sans libellé utilisable (voir ${p}.label)`,excerpt:isObject(y.label)?y.label.value:y.label});emptied.push(p);return null}
  if(Array.isArray(y.apeCodes)?y.apeCodes.length>0:y.apeCodes!==undefined)fix('APE_CODES_IGNORED',`${p}.apeCodes`,'not_requested');
  // The key is a technical identifier, not a fact: an invalid or duplicate one is rebuilt from the label (reported).
  const parsed=SEGMENT_KEY.safeParse(y.key);
  let key=parsed.success&&!keys.includes(parsed.data)?parsed.data:null;
  if(key===null){key=segmentKeyFrom(String(label.value),keys);fix('KEY_REGENERATED',`${p}.key`,'invalid_value',{rule:'clé régénérée depuis le libellé'})}
  if(typeof y.key==='string'&&y.key!==key)renamed.set(y.key,key);
  keys.push(key);
  const opt=(k:string,schema:z.ZodType)=>k in y?leaf(y[k],schema,`${p}.${k}`,false)!:{...EMPTY};
  return {key,label,apeCodes:[],sizeRange:opt('sizeRange',VALUE.sizeRange),priority:opt('priority',VALUE.priority),
   estimatedValue:opt('estimatedValue',VALUE.estimatedValue),salesCycle:opt('salesCycle',VALUE.salesCycle)};
 });
 const personas=list(raw.personas,'personas',L.personas,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet persona attendu',excerpt:y});emptied.push(p);return null}
  fields(y,p,['role','painPoints','messageAngle']);
  if(isBlank(y.role)){emptied.push(p);return null}
  const role=single(y,'role',VALUE.role,p);
  if(role.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:isObject(y.role)&&y.role.value!=null?`persona sans fonction utilisable (voir ${p}.role)`:`persona sans fonction (role vide)`,excerpt:isObject(y.role)?y.role.value:y.role});emptied.push(p);return null}
  return {role,painPoints:leafList(y.painPoints,`${p}.painPoints`,L.painPoints,VALUE.painPoint),
   messageAngle:'messageAngle' in y?leaf(y.messageAngle,VALUE.messageAngle,`${p}.messageAngle`,false)!:{...EMPTY}};
 });
 const signals=list(raw.signals,'signals',L.signals,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet signal attendu',excerpt:y});return null}
  fields(y,p,['type','segmentRefs']);
  if(isBlank(y.type))return null;
  const type=single(y,'type',VALUE.signalType,p);
  if(type.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:isObject(y.type)&&y.type.value!=null?`signal sans type utilisable (voir ${p}.type)`:`signal sans type (type vide)`,excerpt:isObject(y.type)?y.type.value:y.type});return null}
  const refs=(Array.isArray(y.segmentRefs)?y.segmentRefs:[]).map(r=>typeof r==='string'&&renamed.has(r)?renamed.get(r)!:r);
  const kept=refs.filter((r):r is string=>typeof r==='string'&&keys.includes(r)).filter((r,i,a)=>a.indexOf(r)===i).slice(0,L.segmentRefs);
  if(kept.length!==refs.length||!Array.isArray(y.segmentRefs))fix('SEGMENT_REF_DROPPED',`${p}.segmentRefs`,'invalid_value');
  return {type,segmentRefs:kept};
 });
 const exclusions=list(raw.exclusions,'exclusions',L.exclusions,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet exclusion attendu',excerpt:y});emptied.push(p);return null}
  fields(y,p,['label','reason']);
  if(isBlank(y.label)){emptied.push(p);return null}
  const label=single(y,'label',VALUE.exclusionLabel,p);
  if(label.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:isObject(y.label)&&y.label.value!=null?`exclusion sans libellé utilisable (voir ${p}.label)`:`exclusion sans libellé (label vide)`,excerpt:isObject(y.label)?y.label.value:y.label});emptied.push(p);return null}
  return {label,reason:'reason' in y?leaf(y.reason,VALUE.exclusionReason,`${p}.reason`,false)!:{...EMPTY}};
 });
 return {ok:true,value:{version:ICP_PROFILE_VERSION,company,offer,segments,personas,signals,exclusions},fixes:fixes.slice(0,100),emptied:emptied.slice(0,50)};
}

// Warnings stored with the draft (icp_imports.warnings: at most 10 strings, 4 000 characters): one entry per correction
// code, followed by its paths — "SOURCE_TRUNCATED:company.activity,offer.services.0".
export function fixWarnings(fixes:readonly Fix[],room=10):string[]{
 const by=new Map<FixCode,string[]>();
 for(const f of fixes){const a=by.get(f.code)??[];if(!a.includes(f.path))a.push(f.path);by.set(f.code,a)}
 return [...by].slice(0,room).map(([code,paths])=>{let s=`${code}:${paths.join(',')}`;if(s.length>350)s=`${s.slice(0,340).replace(/,[^,]*$/,'')},…`;return s});
}
// For the logs and for the retry: path and reason only.
// The server log: path, code, reason, rule and length — never the excerpt, never any text of the document.
export const describeFixes=(fixes:readonly Fix[])=>fixes.slice(0,40).map(f=>`${f.path}: ${f.code} (${f.reason})${f.rule?` — ${f.rule}`:''}${f.length!==undefined?` — ${f.length} caractères`:''}`);

// The counts the logs carry for every call, so a refusal or a heavy normalisation can be read at a glance: sources too
// long, sources not in the document, values too long, APE codes returned, list items without their envelope. From
// codes and paths only.
export type Counts={source_too_long:number;source_not_in_document:number;value_too_long:number;ape_codes_ignored:number;list_item_wrong_shape:number;other:number};
export function countByCategory(fixes:readonly Fix[],unverified:readonly string[]=[],schemaIssues:readonly {path:string;code:string}[]=[]):Counts{
 const c:Counts={source_too_long:0,source_not_in_document:unverified.length,value_too_long:0,ape_codes_ignored:0,list_item_wrong_shape:0,other:0};
 for(const f of fixes){
  if(f.code==='SOURCE_TRUNCATED')c.source_too_long++;
  else if(f.code==='VALUE_DROPPED_TOO_LONG'||f.code==='ITEM_DROPPED_TOO_LONG')c.value_too_long++;
  else if(f.code==='APE_CODES_IGNORED')c.ape_codes_ignored++;
  else if(f.code==='ITEM_DROPPED_INVALID'&&f.reason==='wrong_shape')c.list_item_wrong_shape++;
  else c.other++;
 }
 for(const i of schemaIssues){
  const source=/(^|\.)source$/.test(i.path);
  if(i.code==='too_big')source?c.source_too_long++:c.value_too_long++;
  else if(/(^|\.)apeCodes(\.|$)/.test(i.path))c.ape_codes_ignored++;
  else if((i.code==='invalid_type'||i.code==='unrecognized_keys')&&/\.\d+(\.|$)/.test(i.path))c.list_item_wrong_shape++;
  else c.other++;
 }
 return c;
}
