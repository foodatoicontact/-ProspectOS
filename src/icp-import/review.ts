// ICP import, step 2B — the review screen's logic, pure and shared by the component and the tests (docs/ICP_IMPORT.md).
// What the screen shows comes from the database (the import row, re-validated); what a person changes is applied here,
// field by field, and the result is re-validated as a whole by parseIcpProfile before it can be sent. A value a person
// types is sourced as such (MANUAL_SOURCE, confidence 1): it never borrows a passage of the document.
import {parseIcpProfile,DEPARTMENT_CODES,CRITICAL_CONFIDENCE,type IcpProfile} from '../domain/icp/schema.ts';
import {DEPARTMENTS} from '../discovery/geo-fr.ts';
import type {MissingQuestion} from '../domain/icp/missing.ts';

import {IMPORT_LOCK_MS,isStale} from './lock.ts';
export {IMPORT_LOCK_MS};
export const POLL_MS=3000;
export const POLL_MAX_MS=15000;
export const MANUAL_SOURCE='Saisi par vous';
export const UNMONITORED=['WORKS','CONTRACT_RENEWAL'] as const;

export type ImportStatus='PENDING'|'EXTRACTED'|'FAILED'|'VALIDATED'|'DISCARDED';
export type ImportRow={id:string;project_id?:string;status:ImportStatus;source_type?:string;source_ref?:string;created_at:string;updated_at?:string;
 error?:string|null;missing_questions?:MissingQuestion[];warnings?:string[];token_usage?:number;stale?:boolean};

// A PENDING row past the lock is read as FAILED (IMPORT_STALE) — the server does the same, the client never trusts a
// spinner that cannot end.
export function readStatus(row:ImportRow,now:number):ImportRow{
 if(isStale(row,now))return {...row,status:'FAILED',error:'IMPORT_STALE',stale:true};
 return row;
}

export type View=
 |{kind:'empty'}
 |{kind:'pending';row:ImportRow;elapsedS:number}
 |{kind:'review';row:ImportRow;profile:IcpProfile}
 |{kind:'unreadable';row:ImportRow}
 |{kind:'failed';row:ImportRow;error:string}
 |{kind:'validated';row:ImportRow}
 |{kind:'discarded';row:ImportRow};
export function viewOf(row:ImportRow|null,profile:unknown,now:number):View{
 if(!row)return {kind:'empty'};
 const r=readStatus(row,now);
 switch(r.status){
  case 'PENDING':return {kind:'pending',row:r,elapsedS:Math.max(0,Math.floor((now-Date.parse(r.created_at))/1000))};
  case 'EXTRACTED':{const p=parseIcpProfile(profile);return p.ok?{kind:'review',row:r,profile:p.profile}:{kind:'unreadable',row:r}}
  case 'FAILED':return {kind:'failed',row:r,error:r.error??'AI_INVALID_RESULT'};
  case 'VALIDATED':return {kind:'validated',row:r};
  case 'DISCARDED':return {kind:'discarded',row:r};
  default:return {kind:'unreadable',row:r};
 }
}
// Next poll delay: steady while the network answers, backing off (never past POLL_MAX_MS) while it does not.
export const nextPollDelay=(failures:number)=>Math.min(POLL_MAX_MS,POLL_MS*2**Math.max(0,failures));

export type Confidence='empty'|'low'|'medium'|'high';
export function confidenceOf(leaf:{value:unknown;confidence:number}):Confidence{
 if(leaf.value===null)return 'empty';
 return leaf.confidence>=0.85?'high':leaf.confidence>=CRITICAL_CONFIDENCE?'medium':'low';
}

// ---------- edits ----------
export type Path=(string|number)[];
type Leaf={value:unknown;source:string|null;confidence:number};
const clone=(p:IcpProfile)=>structuredClone(p) as IcpProfile;
function at(root:unknown,path:Path):unknown{let n=root;for(const k of path){if(n===null||typeof n!=='object')return undefined;n=(n as Record<string|number,unknown>)[k]}return n}
const manual=(value:unknown):Leaf=>value===null||value===''?{value:null,source:null,confidence:0}:{value,source:MANUAL_SOURCE,confidence:1};
export type EditResult={ok:true;profile:IcpProfile}|{ok:false;issues:string[]};
function checked(p:IcpProfile):EditResult{const r=parseIcpProfile(p);return r.ok?{ok:true,profile:r.profile}:{ok:false,issues:r.issues}}

// Sets one leaf ({value, source, confidence}) to what the person typed; an empty text empties it.
export function setValue(profile:IcpProfile,path:Path,value:unknown):EditResult{
 const p=clone(profile);const parent=at(p,path.slice(0,-1)) as Record<string|number,unknown>|undefined;const key=path[path.length-1]!;
 if(!parent||typeof parent!=='object')return {ok:false,issues:[`${path.join('.')}: unknown field`]};
 const leaf=parent[key] as Leaf|undefined;
 if(!leaf||typeof leaf!=='object'||!('confidence' in leaf))return {ok:false,issues:[`${path.join('.')}: not an editable value`]};
 parent[key]=manual(typeof value==='string'?value.trim():value);
 return checked(p);
}
// Removes one item of a list; removing a segment also removes the signals' references to it.
export function removeAt(profile:IcpProfile,path:Path):EditResult{
 const p=clone(profile);const list=at(p,path.slice(0,-1));const i=path[path.length-1];
 if(!Array.isArray(list)||typeof i!=='number'||i<0||i>=list.length)return {ok:false,issues:[`${path.join('.')}: unknown item`]};
 const [gone]=list.splice(i,1) as [{key?:string}];
 if(path.length===2&&path[0]==='segments'&&gone?.key)for(const s of p.signals)s.segmentRefs=s.segmentRefs.filter(r=>r!==gone.key);
 return checked(p);
}
// Adds a typed value to a list of sourced values (services, differentiators, proofs, zones…).
export function addValue(profile:IcpProfile,listPath:Path,value:unknown):EditResult{
 const p=clone(profile);const list=at(p,listPath);
 if(!Array.isArray(list))return {ok:false,issues:[`${listPath.join('.')}: not a list`]};
 if(value===null||value==='')return {ok:true,profile};
 list.push(manual(typeof value==='string'?value.trim():value));
 return checked(p);
}
const slug=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30)||'segment';
const empty=():Leaf=>({value:null,source:null,confidence:0});
export function addSegment(profile:IcpProfile,label:string):EditResult{
 const p=clone(profile);const base=slug(label);let key=base,n=2;
 while(p.segments.some(s=>s.key===key))key=`${base}-${n++}`;
 p.segments.push({key,label:manual(label.trim()) as never,apeCodes:[],sizeRange:empty() as never,priority:empty() as never,estimatedValue:empty() as never,salesCycle:empty() as never});
 return checked(p);
}
export function addPersona(profile:IcpProfile,role:string):EditResult{
 const p=clone(profile);p.personas.push({role:manual(role.trim()) as never,painPoints:[],messageAngle:empty() as never});return checked(p);
}
export function addExclusion(profile:IcpProfile,label:string):EditResult{
 const p=clone(profile);p.exclusions.push({label:manual(label.trim()) as never,reason:empty() as never});return checked(p);
}
// "44, Maine-et-Loire et 35" → ['44','49','35']: codes or names of French departments; anything else is ignored.
export function parseDepartments(text:string):string[]{
 const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const out:string[]=[];
 for(const raw of text.split(/[,;/\n]|\s+et\s+/i)){
  const t=raw.trim();if(!t)continue;
  const code=t.toUpperCase();
  const hit=DEPARTMENT_CODES.includes(code)?code:DEPARTMENTS.find(d=>norm(d.name)===norm(t))?.code;
  if(hit&&!out.includes(hit))out.push(hit);
 }
 return out;
}
export function addZones(profile:IcpProfile,text:string):EditResult{
 let p:IcpProfile=profile;
 for(const code of parseDepartments(text)){
  if(p.company.interventionZones.some(z=>z.value===code))continue;
  const r=addValue(p,['company','interventionZones'],code);if(!r.ok)return r;p=r.profile;
 }
 return {ok:true,profile:p};
}

// One missing question answered: the answer goes where the question points, sourced as typed by the person.
export function answerQuestion(profile:IcpProfile,key:string,answer:string):EditResult{
 const a=answer.trim();if(!a)return {ok:true,profile};
 switch(key){
  case 'company.activity':return setValue(profile,['company','activity'],a.slice(0,500));
  case 'company.name':return setValue(profile,['company','name'],a.slice(0,200));
  case 'offer.services':{let p=profile;for(const s of a.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean).slice(0,10)){const r=addValue(p,['offer','services'],s.slice(0,200));if(!r.ok)return r;p=r.profile}return {ok:true,profile:p}}
  case 'offer.differentiators':return addValue(profile,['offer','differentiators'],a.slice(0,300));
  case 'segments':return addSegment(profile,a.slice(0,120));
  case 'personas':return addPersona(profile,a.slice(0,120));
  case 'exclusions':return addExclusion(profile,a.slice(0,120));
  case 'company.interventionZones':return addZones(profile,a);
  default:return {ok:true,profile}; // e.g. sizes: answered in the segment itself
 }
}

// The values a person should look at first: empty or under the critical confidence.
export function weakSpots(p:IcpProfile):string[]{
 const out:string[]=[];
 const look=(path:string,l:{value:unknown;confidence:number})=>{if(confidenceOf(l)==='empty'||confidenceOf(l)==='low')out.push(path)};
 look('company.name',p.company.name);look('company.activity',p.company.activity);
 p.offer.services.forEach((s,i)=>look(`offer.services.${i}`,s));
 p.segments.forEach((s,i)=>look(`segments.${i}.label`,s.label));
 return out;
}
export const isUnmonitored=(type:string|null)=>(UNMONITORED as readonly string[]).includes(type??'');
