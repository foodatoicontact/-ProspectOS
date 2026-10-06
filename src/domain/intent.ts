import type {SignalType,SignalStatus} from '../signals/types.ts';
import {SIGNAL_TYPES} from '../signals/types.ts';
// INTENT score (Signal Engine S5, docs/SIGNAL_ENGINE_V1_PLAN.md §8–9): "is there a recent reason to contact this company
// now?". A second dimension next to FIT (core.ts), never mixed with it: FIT reads the ICP criteria, INTENT reads
// verified signals only. Deterministic and explainable, line by line:
//   points = weight(type) × confidence(source) × recency(age, type) × relevance(profile)
// Only VERIFIED signals count. Per type, diminishing returns (1, ½, ¼, then 0) and a cap at the type's weight, so ten job
// ads never weigh like ten different reasons. Total capped at 100. No model, no randomness: `now` is a parameter.
// INTENT estimé (2026-10-06, like FIT estimé): signals still to review also count, in an ESTIMATE shown next to the
// verified INTENT, with the same rules (their source's confidence, caps, diminishing returns). Rejected never count.

// Half-life and maximum age per type, in days: urgent facts fade fast, budget facts last months.
export const DECAY:Record<SignalType,{halfLifeDays:number;maxAgeDays:number}>={
 incident_cyber:{halfLifeDays:5,maxAgeDays:30},
 event:{halfLifeDays:7,maxAgeDays:21},
 hiring_role:{halfLifeDays:21,maxAgeDays:90},
 leadership_change:{halfLifeDays:30,maxAgeDays:120},
 product_launch:{halfLifeDays:30,maxAgeDays:120},
 partnership:{halfLifeDays:30,maxAgeDays:120},
 new_site:{halfLifeDays:45,maxAgeDays:180},
 expansion:{halfLifeDays:45,maxAgeDays:180},
 tech_change:{halfLifeDays:45,maxAgeDays:180},
 funding:{halfLifeDays:60,maxAgeDays:270},
 acquisition:{halfLifeDays:60,maxAgeDays:270},
 certification:{halfLifeDays:60,maxAgeDays:180},
 public_contract_won:{halfLifeDays:60,maxAgeDays:180},
 headcount_growth:{halfLifeDays:90,maxAgeDays:365},
};
// Default weights when the project has no intent profile yet (the profile's own weights replace them entirely).
export const DEFAULT_INTENT_WEIGHTS:Record<SignalType,number>={
 funding:30,incident_cyber:30,leadership_change:25,hiring_role:25,acquisition:20,new_site:20,expansion:20,tech_change:20,
 public_contract_won:20,product_launch:15,headcount_growth:15,partnership:10,certification:10,event:5,
};
const MULTIPLIERS=[1,0.5,0.25];
const DAY=86400000;

export type IntentSignal={id:string;signal_type:SignalType;status:SignalStatus;title:string;excerpt:string;source_url:string;source_domain:string|null;
 confidence:number;event_date:string|null;published_at:string|null;observed_at:string;matched_terms:string[]};
export type IntentProfileInput={types:Partial<Record<SignalType,number>>;terms:string[]}|null;
export type Strength='strong'|'medium'|'weak'|'archive';
export type IntentLine={signal_id:string;signal_type:SignalType;title:string;source_url:string;source_domain:string|null;
 date_basis:'event'|'published'|'observed_only';age_days:number;weight:number;confidence:number;recency:number;relevance:number;
 multiplier:number;points:number;strength:Strength;verified:boolean};
export type IntentScore={score:number;lines:IntentLine[];archived:IntentLine[];pending:{count:number;potential:number};
 estimated:{score:number;lines:IntentLine[];to_verify:number}};

export function recency(ageDays:number,type:SignalType):number{
 const {halfLifeDays,maxAgeDays}=DECAY[type];
 if(!Number.isFinite(ageDays)||ageDays<0||ageDays>maxAgeDays)return 0;
 return Math.pow(0.5,ageDays/halfLifeDays);
}
export const strengthOf=(r:number):Strength=>r>=0.7?'strong':r>=0.35?'medium':r>0?'weak':'archive';
const round1=(v:number)=>Math.round(v*10)/10;

// The fact's own date first (event), then its publication, then the day it was read.
function dated(s:IntentSignal,now:Date):{basis:IntentLine['date_basis'];age:number}{
 const [basis,iso]=s.event_date?['event' as const,`${s.event_date}T00:00:00Z`]:s.published_at?['published' as const,s.published_at]:['observed_only' as const,s.observed_at];
 return {basis,age:Math.floor((now.getTime()-new Date(iso).getTime())/DAY)};
}
function weightOf(type:SignalType,profile:IntentProfileInput):number{
 return profile?profile.types[type]??0:DEFAULT_INTENT_WEIGHTS[type];
}
function relevanceOf(s:IntentSignal,profile:IntentProfileInput):number{
 if(weightOf(s.signal_type,profile)<=0)return 0;
 const terms=(profile?.terms??[]).map(t=>t.trim().toLowerCase()).filter(Boolean);
 const text=`${s.title} ${s.excerpt} ${s.matched_terms.join(' ')}`.toLowerCase();
 return terms.some(t=>text.includes(t))?1:0.6;
}
function line(s:IntentSignal,profile:IntentProfileInput,now:Date):IntentLine{
 const {basis,age}=dated(s,now);const r=recency(age,s.signal_type);
 const weight=weightOf(s.signal_type,profile),relevance=relevanceOf(s,profile);
 return {signal_id:s.id,signal_type:s.signal_type,title:s.title,source_url:s.source_url,source_domain:s.source_domain,date_basis:basis,age_days:age,
  weight,confidence:s.confidence,recency:Math.round(r*1000)/1000,relevance,multiplier:1,points:weight*s.confidence*r*relevance,strength:strengthOf(r),verified:s.status==='VERIFIED'};
}

// Stable order whatever the input order: raw points, then id.
const order=(a:IntentLine,b:IntentLine)=>b.points-a.points||a.signal_id.localeCompare(b.signal_id);
// Per type: diminishing returns (1, ½, ¼, then 0), capped at the type's weight.
function capped(all:IntentLine[]):IntentLine[]{
 const lines:IntentLine[]=[];
 for(const type of SIGNAL_TYPES){
  let total=0;
  all.filter(l=>l.signal_type===type&&l.points>0).sort(order).forEach((l,i)=>{
   const multiplier=MULTIPLIERS[i]??0;
   const points=Math.max(0,Math.min(l.points*multiplier,l.weight-total));
   total+=points;lines.push({...l,multiplier,points:round1(points)});
  });
 }
 return lines.sort(order);
}
const total=(lines:IntentLine[])=>Math.min(100,Math.round(lines.reduce((t,l)=>t+l.points,0)));

export function scoreIntent(signals:IntentSignal[],profile:IntentProfileInput,now:Date):IntentScore{
 const known=signals.filter(s=>(SIGNAL_TYPES as readonly string[]).includes(s.signal_type));
 const verified=known.filter(s=>s.status==='VERIFIED').map(s=>line(s,profile,now));
 const pendingRaw=known.filter(s=>s.status==='PENDING_REVIEW').map(s=>line(s,profile,now));
 const archived=verified.filter(l=>l.recency===0&&l.weight>0).sort(order).map(l=>({...l,points:0}));
 const lines=capped(verified);
 const estimatedLines=capped([...verified,...pendingRaw]);
 const pendingLines=pendingRaw.filter(l=>l.points>0);
 return {
  score:total(lines),
  lines,archived,
  pending:{count:pendingLines.length,potential:round1(pendingLines.reduce((t,l)=>t+l.points,0))},
  estimated:{score:total(estimatedLines),lines:estimatedLines,to_verify:estimatedLines.filter(l=>!l.verified&&l.points>0).length},
 };
}
