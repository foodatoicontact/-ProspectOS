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
//    list also carries the first 60 characters of what the model wrote (EXCERPT_MAX) — nothing else of the document.
// What stays strict, and rejects the whole answer (one retry): unreadable JSON, a root key missing or unknown, a wrong
// version, a root block of the wrong type. Then the result is validated as a whole by parseIcpProfile, as before.
import {ICP_LIMITS as L,VALUE,SEGMENT_KEY,ROOT_KEYS,ICP_PROFILE_VERSION} from './schema.ts';
import type {z} from 'zod';

export type FixCode='SOURCE_TRUNCATED'|'VALUE_DROPPED_TOO_LONG'|'VALUE_DROPPED_INVALID'|'ITEM_DROPPED_INVALID'|'ITEM_DROPPED_TOO_LONG'
 |'ITEM_DROPPED_OVER_LIMIT'|'FIELD_DROPPED_UNKNOWN'|'FIELD_MISSING'|'APE_CODES_IGNORED'|'SEGMENT_REF_DROPPED';
export type Reason='too_long'|'invalid_value'|'wrong_shape'|'over_limit'|'unknown_field'|'not_requested';
// rule: which rule of the schema refused it, in words; excerpt: for an item taken out of a list (ITEM_DROPPED_*), the
// first 60 characters of what the model wrote, so the log says WHAT was dropped (docs/ICP_IMPORT.md §Journal).
export type Fix={code:FixCode;path:string;reason:Reason;rule?:string;excerpt?:string};
export const EXCERPT_MAX=60;
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
const LEAF_KEYS=new Set(['value','source','confidence']);

// The longest prefix of the passage that fits, ending at a word boundary when there is one.
export function cutSource(source:string,max=L.source):string{
 if(source.length<=max)return source;
 const head=source.slice(0,max);
 const space=head.search(/\s\S*$/);
 const cut=space>=Math.floor(max/2)&&!/\s/.test(source[max]??' ')?head.slice(0,space):head;
 return cut.replace(/[\s,;:.\-–—]+$/,'');
}
const tooLong=(e:z.ZodError)=>e.issues.some(i=>i.code==='too_big');

export function normalizeExtraction(raw:unknown):Normalized{
 const fixes:Fix[]=[];const emptied:string[]=[];
 const fix=(code:FixCode,path:string,reason:Reason,detail?:{rule:string;excerpt?:unknown})=>{fixes.push({code,path,reason,...(detail?{rule:detail.rule,...(code.startsWith('ITEM_DROPPED')&&detail.excerpt!==undefined?{excerpt:excerptOf(detail.excerpt)}:{})}:{})})};
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
   if(typeof source==='string'&&source.length>L.source){source=cutSource(source);fix('SOURCE_TRUNCATED',path,'too_long')}
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
  promises:leafList(of.promises,'offer.promises',L.promises,VALUE.promise),
  differentiators:leafList(of.differentiators,'offer.differentiators',L.differentiators,VALUE.differentiator),
  proofs:leafList(of.proofs,'offer.proofs',L.proofs,VALUE.proof),
 };

 const keys:string[]=[];
 const segments=list(raw.segments,'segments',L.segments,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet segment attendu',excerpt:y});emptied.push(p);return null}
  const key=SEGMENT_KEY.safeParse(y.key);
  if(!key.success||keys.includes(key.data)){fix('ITEM_DROPPED_INVALID',`${p}.key`,'invalid_value',{rule:key.success?'clé de segment en double':`clé de segment : minuscules, chiffres, - ou _, ${L.segmentKey} caractères max`,excerpt:y.key});emptied.push(p);return null}
  fields(y,p,['key','label','apeCodes','sizeRange','priority','estimatedValue','salesCycle']);
  const label=single(y,'label',VALUE.segmentLabel,p);
  if(label.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:isObject(y.label)&&y.label.value!=null?`segment sans libellé utilisable (voir ${p}.label)`:`segment sans libellé (label vide)`,excerpt:isObject(y.label)?y.label.value:y.label});emptied.push(p);return null}
  if(Array.isArray(y.apeCodes)?y.apeCodes.length>0:y.apeCodes!==undefined)fix('APE_CODES_IGNORED',`${p}.apeCodes`,'not_requested');
  keys.push(key.data);
  const opt=(k:string,schema:z.ZodType)=>k in y?leaf(y[k],schema,`${p}.${k}`,false)!:{...EMPTY};
  return {key:key.data,label,apeCodes:[],sizeRange:opt('sizeRange',VALUE.sizeRange),priority:opt('priority',VALUE.priority),
   estimatedValue:opt('estimatedValue',VALUE.estimatedValue),salesCycle:opt('salesCycle',VALUE.salesCycle)};
 });
 const personas=list(raw.personas,'personas',L.personas,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet persona attendu',excerpt:y});emptied.push(p);return null}
  fields(y,p,['role','painPoints','messageAngle']);
  const role=single(y,'role',VALUE.role,p);
  if(role.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:isObject(y.role)&&y.role.value!=null?`persona sans fonction utilisable (voir ${p}.role)`:`persona sans fonction (role vide)`,excerpt:isObject(y.role)?y.role.value:y.role});emptied.push(p);return null}
  return {role,painPoints:leafList(y.painPoints,`${p}.painPoints`,L.painPoints,VALUE.painPoint),
   messageAngle:'messageAngle' in y?leaf(y.messageAngle,VALUE.messageAngle,`${p}.messageAngle`,false)!:{...EMPTY}};
 });
 const signals=list(raw.signals,'signals',L.signals,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet signal attendu',excerpt:y});return null}
  fields(y,p,['type','segmentRefs']);
  const type=single(y,'type',VALUE.signalType,p);
  if(type.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value',{rule:isObject(y.type)&&y.type.value!=null?`signal sans type utilisable (voir ${p}.type)`:`signal sans type (type vide)`,excerpt:isObject(y.type)?y.type.value:y.type});return null}
  const refs=Array.isArray(y.segmentRefs)?y.segmentRefs:[];
  const kept=refs.filter((r):r is string=>typeof r==='string'&&keys.includes(r)).filter((r,i,a)=>a.indexOf(r)===i).slice(0,L.segmentRefs);
  if(kept.length!==refs.length||!Array.isArray(y.segmentRefs))fix('SEGMENT_REF_DROPPED',`${p}.segmentRefs`,'invalid_value');
  return {type,segmentRefs:kept};
 });
 const exclusions=list(raw.exclusions,'exclusions',L.exclusions,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape',{rule:'objet exclusion attendu',excerpt:y});emptied.push(p);return null}
  fields(y,p,['label','reason']);
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
export const describeFixes=(fixes:readonly Fix[])=>fixes.slice(0,40).map(f=>`${f.path}: ${f.code} (${f.reason})${f.rule?` — ${f.rule}`:''}${f.excerpt!==undefined?` — « ${f.excerpt} »`:''}`);

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
