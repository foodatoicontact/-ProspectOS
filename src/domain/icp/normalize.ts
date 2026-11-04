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
//  - every correction is reported with its path and a reason code — never the value, never the document.
// What stays strict, and rejects the whole answer (one retry): unreadable JSON, a root key missing or unknown, a wrong
// version, a root block of the wrong type. Then the result is validated as a whole by parseIcpProfile, as before.
import {ICP_LIMITS as L,VALUE,SEGMENT_KEY,ROOT_KEYS,ICP_PROFILE_VERSION} from './schema.ts';
import type {z} from 'zod';

export type FixCode='SOURCE_TRUNCATED'|'VALUE_DROPPED_TOO_LONG'|'VALUE_DROPPED_INVALID'|'ITEM_DROPPED_INVALID'|'ITEM_DROPPED_TOO_LONG'
 |'ITEM_DROPPED_OVER_LIMIT'|'FIELD_DROPPED_UNKNOWN'|'FIELD_MISSING'|'APE_CODES_IGNORED'|'SEGMENT_REF_DROPPED';
export type Reason='too_long'|'invalid_value'|'wrong_shape'|'over_limit'|'unknown_field'|'not_requested';
export type Fix={code:FixCode;path:string;reason:Reason};
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
 const fix=(code:FixCode,path:string,reason:Reason)=>{fixes.push({code,path,reason})};
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
  const drop=(code:'VALUE'|'ITEM',reason:Reason)=>{
   fix(inList?(reason==='too_long'?'ITEM_DROPPED_TOO_LONG':'ITEM_DROPPED_INVALID'):(reason==='too_long'?'VALUE_DROPPED_TOO_LONG':'VALUE_DROPPED_INVALID'),path,reason);
   emptied.push(path);return inList?null:{...EMPTY};
  };
  if(!isObject(x)||!('value' in x)||Object.keys(x).some(k=>!LEAF_KEYS.has(k)))return drop('VALUE','wrong_shape');
  if(x.value===null||x.value===undefined)return inList?null:{...EMPTY};
  let source=x.source;
  if(source!==null&&source!==undefined&&typeof source!=='string')return drop('VALUE','wrong_shape');
  if(typeof source==='string'){
   source=source.trim()||null;
   if(typeof source==='string'&&source.length>L.source){source=cutSource(source);fix('SOURCE_TRUNCATED',path,'too_long')}
  }
  const c=x.confidence;
  if(typeof c!=='number'||!Number.isFinite(c)||c<0||c>1)return drop('VALUE','invalid_value');
  const v=schema.safeParse(x.value);
  if(!v.success)return drop('VALUE',tooLong(v.error)?'too_long':'invalid_value');
  return {value:v.data,source:source??null,confidence:c};
 };
 const list=(x:unknown,path:string,max:number,item:(y:unknown,p:string)=>unknown|null):unknown[]=>{
  if(x===undefined){fix('FIELD_MISSING',path,'wrong_shape');return []}
  if(!Array.isArray(x)){fix('VALUE_DROPPED_INVALID',path,'wrong_shape');emptied.push(path);return []}
  const out:unknown[]=[];
  x.forEach((y,i)=>{const r=item(y,`${path}.${i}`);if(r!==null)out.push(r)});
  if(out.length>max){fix('ITEM_DROPPED_OVER_LIMIT',path,'over_limit');return out.slice(0,max)}
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
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape');emptied.push(p);return null}
  const key=SEGMENT_KEY.safeParse(y.key);
  if(!key.success||keys.includes(key.data)){fix('ITEM_DROPPED_INVALID',`${p}.key`,'invalid_value');emptied.push(p);return null}
  fields(y,p,['key','label','apeCodes','sizeRange','priority','estimatedValue','salesCycle']);
  const label=single(y,'label',VALUE.segmentLabel,p);
  if(label.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value');emptied.push(p);return null}
  if(Array.isArray(y.apeCodes)?y.apeCodes.length>0:y.apeCodes!==undefined)fix('APE_CODES_IGNORED',`${p}.apeCodes`,'not_requested');
  keys.push(key.data);
  const opt=(k:string,schema:z.ZodType)=>k in y?leaf(y[k],schema,`${p}.${k}`,false)!:{...EMPTY};
  return {key:key.data,label,apeCodes:[],sizeRange:opt('sizeRange',VALUE.sizeRange),priority:opt('priority',VALUE.priority),
   estimatedValue:opt('estimatedValue',VALUE.estimatedValue),salesCycle:opt('salesCycle',VALUE.salesCycle)};
 });
 const personas=list(raw.personas,'personas',L.personas,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape');emptied.push(p);return null}
  fields(y,p,['role','painPoints','messageAngle']);
  const role=single(y,'role',VALUE.role,p);
  if(role.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value');emptied.push(p);return null}
  return {role,painPoints:leafList(y.painPoints,`${p}.painPoints`,L.painPoints,VALUE.painPoint),
   messageAngle:'messageAngle' in y?leaf(y.messageAngle,VALUE.messageAngle,`${p}.messageAngle`,false)!:{...EMPTY}};
 });
 const signals=list(raw.signals,'signals',L.signals,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape');return null}
  fields(y,p,['type','segmentRefs']);
  const type=single(y,'type',VALUE.signalType,p);
  if(type.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value');return null}
  const refs=Array.isArray(y.segmentRefs)?y.segmentRefs:[];
  const kept=refs.filter((r):r is string=>typeof r==='string'&&keys.includes(r)).filter((r,i,a)=>a.indexOf(r)===i).slice(0,L.segmentRefs);
  if(kept.length!==refs.length||!Array.isArray(y.segmentRefs))fix('SEGMENT_REF_DROPPED',`${p}.segmentRefs`,'invalid_value');
  return {type,segmentRefs:kept};
 });
 const exclusions=list(raw.exclusions,'exclusions',L.exclusions,(y,p)=>{
  if(!isObject(y)){fix('ITEM_DROPPED_INVALID',p,'wrong_shape');emptied.push(p);return null}
  fields(y,p,['label','reason']);
  const label=single(y,'label',VALUE.exclusionLabel,p);
  if(label.value===null){fix('ITEM_DROPPED_INVALID',p,'invalid_value');emptied.push(p);return null}
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
export const describeFixes=(fixes:readonly Fix[])=>fixes.slice(0,40).map(f=>`${f.path}: ${f.code} (${f.reason})`);
