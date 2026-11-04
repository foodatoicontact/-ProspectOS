// ICP import — what the draft still needs from the person (docs/ICP_IMPORT.md). Deterministic: computed from the
// validated draft, never asked of the model. At most 5 questions, the most useful first.
//
// Two inputs: the profile itself (a critical field empty or under CRITICAL_CONFIDENCE) and the paths the extraction
// dropped because their value came without a source (dropUnsourced) — a value nobody can trace becomes a question.
import {CRITICAL_CONFIDENCE,type IcpProfile} from './schema.ts';

export const MAX_MISSING_QUESTIONS=5;
export type MissingQuestion={key:string;question:string};

const QUESTIONS={
 'company.activity':'Quelle est l’activité principale de votre entreprise, en une phrase ?',
 'offer.services':'Quels services ou produits vendez-vous ?',
 'segments':'Quels types de clients ciblez-vous (secteur d’activité, taille) ?',
 'company.interventionZones':'Dans quels départements intervenez-vous ?',
 'personas':'Chez vos clients, qui décide de l’achat (fonction) ?',
 'company.name':'Quel est le nom de votre entreprise ?',
 'segments.sizeRange':'Quelle taille d’entreprise ciblez-vous (nombre de salariés) ?',
 'offer.differentiators':'Qu’est-ce qui vous distingue de vos concurrents ?',
 'exclusions':'Y a-t-il des clients que vous ne voulez pas démarcher ?',
} as const;
type Key=keyof typeof QUESTIONS;

// A dropped path (e.g. "segments.0.sizeRange", "company.sites.2") → the question that recovers it.
function keyOfPath(path:string):Key|null{
 const p=path.split('.').filter(s=>!/^\d+$/.test(s));
 const two=p.slice(0,2).join('.');
 if(two==='segments.sizeRange')return 'segments.sizeRange';
 if(two==='company.sites'||two==='company.interventionZones')return 'company.interventionZones';
 if(two in QUESTIONS)return two as Key;
 if(p[0]==='segments')return 'segments';
 if(p[0]==='personas')return 'personas';
 if(p[0]==='exclusions')return 'exclusions';
 return null;
}

const weak=(leaf:{value:unknown;confidence:number})=>leaf.value===null||leaf.confidence<CRITICAL_CONFIDENCE;

export function missingQuestions(profile:IcpProfile,dropped:readonly string[]=[]):MissingQuestion[]{
 const keys:Key[]=[];
 const add=(k:Key|null)=>{if(k&&!keys.includes(k))keys.push(k)};
 if(weak(profile.company.activity))add('company.activity');
 if(!profile.offer.services.some(s=>!weak(s)))add('offer.services');
 if(profile.segments.length===0)add('segments');
 if(profile.company.interventionZones.length===0&&!profile.company.sites.some(s=>s.value?.department))add('company.interventionZones');
 if(profile.personas.length===0)add('personas');
 if(weak(profile.company.name))add('company.name');
 if(profile.segments.length>0&&profile.segments.every(s=>s.sizeRange.value===null))add('segments.sizeRange');
 for(const path of dropped)add(keyOfPath(path));
 return keys.slice(0,MAX_MISSING_QUESTIONS).map(key=>({key,question:QUESTIONS[key]}));
}

// The zero-invention rule applied to a raw extraction before it is validated: a leaf { value, source, confidence } whose
// value comes without a usable source loses its value (null, confidence 0) and its path is reported — never silently
// kept, never given a made-up source. A list item left without a value is removed. Everything else is untouched: an
// unknown field, a wrong type or an over-long source is left as is, for the strict schema to refuse.
export function dropUnsourced(raw:unknown):{value:unknown;dropped:string[]}{
 const dropped:string[]=[];
 const isLeaf=(o:Record<string,unknown>)=>{const k=Object.keys(o);return k.length===3&&'value' in o&&'source' in o&&'confidence' in o};
 const noSource=(s:unknown)=>s===null||s===undefined||(typeof s==='string'&&s.trim()==='');
 const walk=(node:unknown,path:string):unknown=>{
  if(Array.isArray(node)){
   const out:unknown[]=[];
   node.forEach((item,i)=>{
    const next=walk(item,`${path}.${i}`);
    if(next&&typeof next==='object'&&!Array.isArray(next)&&isLeaf(next as Record<string,unknown>)&&(next as {value:unknown}).value===null)return;
    out.push(next);
   });
   return out;
  }
  if(node&&typeof node==='object'){
   const o=node as Record<string,unknown>;
   if(isLeaf(o)){
    if(o.value!==null&&o.value!==undefined&&noSource(o.source)){dropped.push(path.replace(/^\./,''));return {value:null,source:null,confidence:0}}
    return o;
   }
   return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,walk(v,`${path}.${k}`)]));
  }
  return node;
 };
 return {value:walk(raw,''),dropped:dropped.slice(0,50)};
}
