// UX A/B, variant B "Workflow-first" (Figma: B — REIMAGINED, a decision cockpit). Pure views of data the page already
// holds: INTENT from the Signals panel (scoreIntent, unchanged), the prospect's ICP evidence, the public content rows the
// Public Content panel loaded. Nothing is fetched, scored or selected here. The Figma's conceptual metrics with no
// ProspectOS source (the mockup's "86" overall score, its certainty gauge, a priority) have no view: they are omitted, not invented.
// Statuses are never upgraded: verified / to confirm / unknown, exactly as the data says.
import type {IntentScore,IntentLine} from '../domain/intent.ts';
import type {SignalType} from '../signals/types.ts';

// Hero — why this prospect deserves attention now: the strongest VERIFIED signal that still counts, as it is.
export type HeroView={state:'loading'}|{state:'none'}|{state:'to_confirm';count:number;title:string|null}
 |{state:'verified';signal_type:SignalType;title:string;source_domain:string|null;age_days:number;count:number};
const counting=(i:IntentScore)=>i.lines.filter(l=>l.verified&&l.points>0);
const toReview=(i:IntentScore)=>i.estimated.lines.filter(l=>!l.verified&&l.points>0).sort((a,b)=>b.points-a.points);
export function heroView(intent:IntentScore|null):HeroView{
 if(!intent)return {state:'loading'};
 const c=counting(intent);
 if(c.length){
  const top=[...c].sort((a,b)=>b.points-a.points||a.signal_id.localeCompare(b.signal_id))[0];
  return {state:'verified',signal_type:top.signal_type,title:top.title,source_domain:top.source_domain,age_days:top.age_days,count:c.length};
 }
 const r=toReview(intent);
 if(intent.pending.count>0||r.length)return {state:'to_confirm',count:Math.max(intent.pending.count,r.length),title:r[0]?.title??null};
 return {state:'none'};
}

// Reason card — the existing verified INTENT, with no score shown when no verified signal backs it.
export type ReasonView={state:'loading'}|{state:'ready';score:number|null;verified:number;to_confirm:number};
export function reasonView(intent:IntentScore|null):ReasonView{
 if(!intent)return {state:'loading'};
 const verified=counting(intent).length;
 return {state:'ready',score:verified?intent.score:null,verified,to_confirm:Math.max(intent.pending.count,toReview(intent).length)};
}

// Evidence timeline — date → event / proof → source / status, most recent first. Every item is kept by default: the
// component folds the list (fewer rows on a phone) and unfolds it on demand; nothing is dropped.
export type TimelineStatus='verified'|'to_confirm'|'unknown';
export type TimelineItem={kind:'signal'|'evidence'|'content';id:string;title:string;detail:string|null;source:string|null;date:string|null;age_days:number;status:TimelineStatus};
type EvidenceIn={id:string;criterion:string;value:boolean;status:string;source_url:string;excerpt:string;observed_at:string;verified_by:string|null};
type ContentIn={id:string;source_url:string;source_domain:string|null;author:string|null;content:string;published_at:string|null;observed_at:string;status:'PENDING_REVIEW'|'VERIFIED'|'REJECTED'};
const DAY=86_400_000;
const hostOf=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'||u.protocol==='http:'?u.hostname:null}catch{return null}};
const clip=(s:string,n=140)=>{const t=s.trim().replace(/\s+/g,' ');return t.length>n?`${t.slice(0,n-1)}…`:t};
const ageOf=(iso:string,now:Date)=>{const t=Date.parse(iso);return Number.isFinite(t)?Math.max(0,Math.floor((now.getTime()-t)/DAY)):null};
// Evidence: only what supports a criterion (value true); a contradicted proof is no proof. An inference stays "to confirm".
const evidenceStatus=(s:string):TimelineStatus|null=>s==='VERIFIED'?'verified':s==='NOT_VERIFIED'||s==='INFERRED_UNCONFIRMED'?'to_confirm':s==='CONTRADICTED'?null:'unknown';
export function timelineView(i:{now:Date;intent:IntentScore|null;criteria:{key:string;label:string}[];evidence:EvidenceIn[];content:ContentIn[]},limit=Number.POSITIVE_INFINITY):{items:TimelineItem[];more:number}{
 const items:TimelineItem[]=[];
 if(i.intent){
  const seen=new Set<string>();
  const add=(l:IntentLine)=>{if(seen.has(l.signal_id))return;seen.add(l.signal_id);items.push({kind:'signal',id:l.signal_id,title:l.title,detail:null,source:l.source_domain,date:null,age_days:l.age_days,status:l.verified?'verified':'to_confirm'})};
  [...i.intent.lines,...i.intent.archived].filter(l=>l.verified).forEach(add);
  i.intent.estimated.lines.filter(l=>!l.verified).forEach(add);
 }
 const labels=new Map(i.criteria.map(c=>[c.key,c.label]));
 for(const e of i.evidence){
  const status=evidenceStatus(e.status),age=ageOf(e.observed_at,i.now);
  if(!e.value||!status||age===null)continue;
  items.push({kind:'evidence',id:e.id,title:labels.get(e.criterion)??e.criterion,detail:clip(e.excerpt),source:hostOf(e.source_url),date:e.observed_at.slice(0,10),age_days:age,status});
 }
 for(const c of i.content){
  if(c.status==='REJECTED')continue;
  const when=c.published_at??c.observed_at,age=ageOf(when,i.now);
  if(age===null)continue;
  items.push({kind:'content',id:c.id,title:clip(c.content,110),detail:c.author,source:c.source_domain??hostOf(c.source_url),date:when.slice(0,10),age_days:age,status:c.status==='VERIFIED'?'verified':'to_confirm'});
 }
 items.sort((a,b)=>a.age_days-b.age_days||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
 return {items:items.slice(0,limit),more:Math.max(0,items.length-limit)};
}
