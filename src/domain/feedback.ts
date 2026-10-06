import {estimateFit,type EstimateEvidence} from './fit-estimate.ts';
import {scoreIntent,type IntentSignal,type IntentProfileInput} from './intent.ts';
import type {Criterion} from './core.ts';
// Signal Engine S8 — pipeline feedback. (1) What is frozen at the moment of contact (contact_snapshots, migration 025):
// FIT and INTENT as they were, the verified signals and evidence the contact rested on. (2) What produced answers:
// reply and meeting rates by FIT band, INTENT band, signal type, source kind and signal age at contact, computed only
// from the snapshots and each prospect's current status. Under MIN_SAMPLE contacts a rate is not shown: a small sample
// says nothing, and saying so is part of the answer. Pure, deterministic, no model.
export const MIN_SAMPLE=10;
export const ANSWERED_STATUSES=['Réponse','Intéressé','RDV','Gagné'] as const;
export const MEETING_STATUSES=['RDV','Gagné'] as const;
const DAY=86400000;

export type SnapshotSignal={id:string;type:string;source_type:string;age_days:number};
export type SnapshotPayload={fit_score:number|null;fit_estimated:number|null;intent_score:number;intent_estimated:number;signals:SnapshotSignal[];evidence_ids:string[]};
type SignalRow=IntentSignal&{source_type:string};

export function contactSnapshot(input:{criteria:Criterion[];evidence:EstimateEvidence[];signals:SignalRow[];profile:IntentProfileInput;now:Date}):SnapshotPayload{
 const fit=estimateFit(input.criteria,input.evidence,input.now);
 const intent=scoreIntent(input.signals,input.profile,input.now);
 const counted=new Set(intent.lines.filter(l=>l.points>0).map(l=>l.signal_id));
 const signals=input.signals.filter(s=>counted.has(s.id)).slice(0,20).map(s=>{
  const basis=s.event_date?`${s.event_date}T00:00:00Z`:s.published_at??s.observed_at;
  return {id:s.id,type:s.signal_type,source_type:s.source_type,age_days:Math.max(0,Math.floor((input.now.getTime()-new Date(basis).getTime())/DAY))};
 });
 const evidence_ids=input.evidence.filter(e=>e.status==='VERIFIED'&&e.verified_by).map(e=>e.id).slice(0,50);
 const anything=fit.verified.coverage>0||fit.to_verify.count>0;
 return {fit_score:anything?fit.verified.score:null,fit_estimated:anything?fit.estimated.score:null,intent_score:intent.score,intent_estimated:intent.estimated.score,signals,evidence_ids};
}

export type Snapshot={prospect_id:string;fit_score:number|null;intent_score:number;signals:SnapshotSignal[];contacted_at:string};
export type Bucket={key:string;contacted:number;answered:number;meetings:number;answer_rate:number|null;meeting_rate:number|null;insufficient:boolean};
export type FeedbackReport={contacted:number;answered:number;meetings:number;answer_rate:number|null;insufficient:boolean;
 by_fit:Bucket[];by_intent:Bucket[];by_signal_type:Bucket[];by_source:Bucket[];by_signal_age:Bucket[]};

export const fitBand=(s:number|null)=>s===null?'unscored':s>=70?'70-100':s>=40?'40-69':'0-39';
export const intentBand=(s:number)=>s>=60?'60-100':s>=30?'30-59':s>0?'1-29':'0';
export const ageBand=(d:number)=>d<=7?'0-7':d<=30?'8-30':d<=90?'31-90':'90+';
const rate=(n:number,d:number)=>d>=MIN_SAMPLE?Math.round(n/d*1000)/10:null;

// statusOf: each contacted prospect's CURRENT status. A prospect counts once (its latest snapshot).
export function feedbackReport(snapshots:Snapshot[],statusOf:Record<string,string|undefined>):FeedbackReport{
 const latest=new Map<string,Snapshot>();
 for(const s of [...snapshots].sort((a,b)=>a.contacted_at.localeCompare(b.contacted_at)))latest.set(s.prospect_id,s);
 const rows=[...latest.values()].map(s=>{const st=statusOf[s.prospect_id]??'';return {s,answered:(ANSWERED_STATUSES as readonly string[]).includes(st),meeting:(MEETING_STATUSES as readonly string[]).includes(st)}});
 const group=(keysOf:(s:Snapshot)=>string[],order:string[]):Bucket[]=>{
  const acc=new Map<string,{c:number;a:number;m:number}>();
  for(const r of rows)for(const k of new Set(keysOf(r.s))){const b=acc.get(k)??{c:0,a:0,m:0};b.c++;if(r.answered)b.a++;if(r.meeting)b.m++;acc.set(k,b)}
  const keys=[...acc.keys()].sort((x,y)=>{const ix=order.indexOf(x),iy=order.indexOf(y);return (ix<0?99:ix)-(iy<0?99:iy)||x.localeCompare(y)});
  return keys.map(k=>{const b=acc.get(k)!;return {key:k,contacted:b.c,answered:b.a,meetings:b.m,answer_rate:rate(b.a,b.c),meeting_rate:rate(b.m,b.c),insufficient:b.c<MIN_SAMPLE}});
 };
 const answered=rows.filter(r=>r.answered).length,meetings=rows.filter(r=>r.meeting).length;
 return {contacted:rows.length,answered,meetings,answer_rate:rate(answered,rows.length),insufficient:rows.length<MIN_SAMPLE,
  by_fit:group(s=>[fitBand(s.fit_score)],['70-100','40-69','0-39','unscored']),
  by_intent:group(s=>[intentBand(s.intent_score)],['60-100','30-59','1-29','0']),
  by_signal_type:group(s=>s.signals.length?s.signals.map(x=>x.type):['none'],[]),
  by_source:group(s=>s.signals.map(x=>x.source_type),[]),
  by_signal_age:group(s=>s.signals.map(x=>ageBand(x.age_days)),['0-7','8-30','31-90','90+'])};
}
