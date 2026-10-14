// Signal-first Discovery V1, step 4: from search results to the reviewable list — ICP pre-filter, grouping of the
// same event seen on several sources, and a deterministic REVIEW ORDER. Deterministic, no model, no network, no
// clock read (`now` is always passed in).
//
// What this is not: a probability, a score, a qualification. The review order only says which candidate a person
// should look at first (an announced near opening before a far one, a very recent event before an undated one). A
// candidate is never "Prospect qualifié", never VERIFIED, never a FIT or INTENT input: it becomes a PENDING_REVIEW
// signal only after a person adds it to a project (P2), and counts for INTENT only once a person verifies it there
// (review_signal, unchanged).
import {createHash} from 'node:crypto';
import {compareLocation,foldPlace,locationTarget,type LocationState} from '../discovery/geo-fr.ts';
import {entityCore,nonCommercialKind,sameCanonicalOrganization,type NonCommercialKind} from '../discovery/admissibility.ts';
import type {RawSignal} from '../signals/provider.ts';
import {extractEvent,periodOf,type AnnouncedDate,type ExtractedEvent,type ExtractRejection,type SearchHit} from './extract.ts';
import {resolveEventEntity,type EntityResolution} from './entity.ts';

const DAY_MS=86400000;
export const NEAR_FUTURE_DAYS=90;
export const VERY_RECENT_DAYS=30;

export type IcpTarget={activity_terms:string[];location:string};
export type IcpMatch='IN'|'OUT'|'UNKNOWN';
export type OtherSource={source_url:string;source_domain:string|null;published_at:string|null;excerpt:string};
export type ReviewTier=1|2|3|4|5;
export type SignalDiscoveryCandidate=ExtractedEvent&EntityResolution&{
 icp_match:IcpMatch;
 icp_reasons:string[];
 event_key:string;
 other_sources:OtherSource[];
 review_tier:ReviewTier;
 review_label:string;
};

// Labels of the review order. Words of time, never of likelihood.
export const REVIEW_TIER_LABELS:Record<ReviewTier,string>={
 1:'Événement annoncé dans les 90 prochains jours',
 2:'Événement annoncé au-delà de 90 jours',
 3:'Événement très récent (30 derniers jours)',
 4:'Date de l’événement inconnue',
 5:'Événement passé (31 à 180 jours)',
};

// ------------------------------------------------------------
// ICP pre-filter — nothing is deleted: OUT goes to a separate, collapsed group the person can still open.
// ------------------------------------------------------------
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ').trim();
function mentionsTerm(text:string,term:string):boolean{
 const t=fold(term).replace(/[^a-z0-9' -]/g,'').trim();if(t.length<3)return false;
 const stem=t.replace(/(?:s|x)$/,'');
 return new RegExp(`(?:^|[^a-z0-9])${stem.replace(/[-\s]+/g,'[- ]?')}(?:s|x)?(?:$|[^a-z0-9])`).test(fold(text));
}
type Zone=typeof ZONE_REASON[LocationState];
// P4: the zone from the departments and regions extract.ts resolved for the event's own place (communes included).
function placeZone(zone:ReturnType<typeof locationTarget>,location:ExtractedEvent['location']):Zone{
 if(!location)return 'ZONE_UNKNOWN';
 if(location.departments.some(d=>zone.places.departments.has(d)))return 'ZONE_MATCH';
 if(zone.cityTokens.some(t=>` ${foldPlace(location.text)} `.includes(` ${t} `)))return 'ZONE_MATCH';
 if(!zone.places.regions.size||!location.regions.length)return 'ZONE_UNKNOWN';
 return location.regions.some(r=>zone.places.regions.has(r))?'ZONE_COMPATIBLE':'ZONE_MISMATCH';
}
const ZONE_REASON={VERIFIED:'ZONE_MATCH',COMPATIBLE:'ZONE_COMPATIBLE',UNKNOWN:'ZONE_UNKNOWN',MISMATCH:'ZONE_MISMATCH'} as const satisfies Record<LocationState,string>;
export function icpPrefilter(event:ExtractedEvent,entity:EntityResolution,target:IcpTarget):{match:IcpMatch;reasons:string[];location_state:LocationState;non_commercial:NonCommercialKind|null}{
 const reasons:string[]=[];
 const text=`${event.headline} ${event.excerpt}`;
 const terms=target.activity_terms.filter(t=>mentionsTerm(text,t));
 if(terms.length)reasons.push(...terms.slice(0,3).map(t=>`activity_term:${t}`));else reasons.push('no_activity_term');
 // The place of the event (its own mention) first; else whatever place the result writes.
 const where=event.location?event.location.text:text;
 let state:LocationState='UNKNOWN';
 if(target.location.trim()){
  const zone=locationTarget(target.location);
  // P4: the departments and regions extract.ts resolved for the event's own place (communes included) decide first;
  // the literal comparison of geo-fr only when they say nothing.
  const own=placeZone(zone,event.location);
  if(own!=='ZONE_UNKNOWN')state=(Object.keys(ZONE_REASON) as LocationState[]).find(k=>ZONE_REASON[k]===own)!;
  else{state=compareLocation(zone,where).state;if(state==='UNKNOWN'&&event.location)state=compareLocation(zone,text).state}
 }
 // Zone words only: nothing here is verified (geo-fr's own state names are not reused in the reasons).
 const zone=ZONE_REASON[state];
 reasons.push(`location:${zone}`);
 // The organization's kind is read from WHO the event is about (its name, the subject of the event sentence), never
 // from the source: a signal is almost always found in a newspaper, and "… – X Magazine" made the event OUT (P4).
 const kind=nonCommercialKind(entity.entity_name??'',event.subject_text,'');
 if(kind)reasons.push(`non_commercial:${kind}`);
 const match:IcpMatch=kind||state==='MISMATCH'?'OUT':terms.length&&(zone==='ZONE_MATCH'||zone==='ZONE_COMPATIBLE')?'IN':'UNKNOWN';
 return {match,reasons,location_state:state,non_commercial:kind};
}

// ------------------------------------------------------------
// Same event, several sources.
// ------------------------------------------------------------
const hash=(s:string)=>createHash('sha256').update(fold(s)).digest('hex');
const periodKey=(d:AnnouncedDate|null)=>!d||d.year===null?'nodate':d.month?`${d.year}-${String(d.month).padStart(2,'0')}`:`${d.year}`;
// Two places agree when they share a department, or — neither resolved — read the same.
function samePlace(a:ExtractedEvent,b:ExtractedEvent):boolean{
 if(!a.location||!b.location)return true;
 const da=a.location.departments,db=b.location.departments;
 if(da.length&&db.length)return da.some(d=>db.includes(d));
 if(da.length||db.length)return false;
 return foldPlace(a.location.text)===foldPlace(b.location.text);
}
const placeKey=(e:ExtractedEvent)=>!e.location?'noplace':e.location.departments.length?e.location.departments.join('+'):foldPlace(e.location.text);
export function eventKeyOf(c:ExtractedEvent&EntityResolution):string{
 const who=c.entity_name?entityCore(c.entity_name):`unresolved-${hash(c.excerpt).slice(0,16)}`;
 return `${c.signal_type}:${who}:${placeKey(c)}:${periodKey(c.event_date)}`.slice(0,200);
}
// Two results describe the same event: same type, same resolved organization, and place and period that do not
// contradict each other (equal, or unknown on one side). An unresolved organization is never merged with another
// result, except the very same excerpt.
function sameEvent(a:SignalDiscoveryCandidate,b:SignalDiscoveryCandidate):boolean{
 if(a.signal_type!==b.signal_type)return false;
 if(!a.entity_name||!b.entity_name)return hash(a.excerpt)===hash(b.excerpt);
 if(!(sameCanonicalOrganization(a.entity_name,b.entity_name)||entityCore(a.entity_name)===entityCore(b.entity_name)))return false;
 if(!samePlace(a,b))return false;
 const da=periodKey(a.event_date),db=periodKey(b.event_date);
 return da==='nodate'||db==='nodate'||da.startsWith(db)||db.startsWith(da);
}
const granularityRank=(d:AnnouncedDate|null)=>!d||d.year===null?0:d.granularity==='DAY'?4:d.granularity==='MONTH'?3:d.granularity==='PERIOD'?2:1;
// The source shown first: the most precise one (resolved organization, resolved domain, most precise date, most
// recent publication), then the URL. Facts are never mixed across sources: the kept candidate carries its own.
const icpRank=(m:IcpMatch)=>m==='IN'?0:m==='UNKNOWN'?1:2;
function better(a:SignalDiscoveryCandidate,b:SignalDiscoveryCandidate):number{
 return Number(!!b.entity_name)-Number(!!a.entity_name)
  // P4: the source that places the event in the zone and names the activity is the one a person reviews first.
  ||icpRank(a.icp_match)-icpRank(b.icp_match)
  ||Number(!!b.entity_domain)-Number(!!a.entity_domain)
  ||Number(b.entity_confidence==='HIGH')-Number(a.entity_confidence==='HIGH')
  ||Number(b.location?.basis==='EVENT_MENTION')-Number(a.location?.basis==='EVENT_MENTION')
  ||granularityRank(b.event_date)-granularityRank(a.event_date)
  ||(b.published_at??'').localeCompare(a.published_at??'')
  ||a.source_url.localeCompare(b.source_url);
}
export function mergeSameEvents(list:SignalDiscoveryCandidate[]):{kept:SignalDiscoveryCandidate[];merged:number}{
 const groups:SignalDiscoveryCandidate[][]=[];
 for(const c of list){const g=groups.find(g=>g.some(x=>sameEvent(x,c)));if(g)g.push(c);else groups.push([c])}
 const kept=groups.map(g=>{
  const [best,...others]=[...g].sort(better);
  return {...best!,other_sources:others.map(o=>({source_url:o.source_url,source_domain:o.source_domain,published_at:o.published_at,excerpt:o.excerpt}))};
 });
 return {kept,merged:list.length-kept.length};
}

// ------------------------------------------------------------
// Review order (deterministic, never a probability).
// ------------------------------------------------------------
export function reviewTier(c:Pick<ExtractedEvent,'event_date'|'event_tense'>,now:Date):ReviewTier{
 const p=c.event_date?periodOf(c.event_date):null;
 if(!p)return 4;
 const t=now.getTime();
 // "Near" needs a date at least as precise as a part of the year: "en 2027" alone is never ranked as near.
 if(p.start>t)return p.start-t<=NEAR_FUTURE_DAYS*DAY_MS&&c.event_date!.granularity!=='YEAR'?1:2;
 if(p.end>=t)return 3; // the written period includes today
 return t-p.end<=VERY_RECENT_DAYS*DAY_MS?3:5;
}
function orderKey(c:SignalDiscoveryCandidate):number{
 const p=c.event_date?periodOf(c.event_date):null;
 if(c.review_tier===1||c.review_tier===2)return p!.start; // the soonest first
 if(c.review_tier===3||c.review_tier===5)return -(p?.end??0); // the most recent first
 return -(c.published_at?Date.parse(c.published_at):-8.64e15); // undated event: the latest publication first, unknown last
}
// Ties: a resolved organization first (less work for the reviewer), then the URL.
export const byReviewOrder=(a:SignalDiscoveryCandidate,b:SignalDiscoveryCandidate)=>a.review_tier-b.review_tier||orderKey(a)-orderKey(b)
 ||Number(!!b.entity_name)-Number(!!a.entity_name)||a.source_url.localeCompare(b.source_url);

// ------------------------------------------------------------
// The whole pure pipeline for one run: results → events → entities → ICP → grouping → review order.
// ------------------------------------------------------------
export type SignalDiscoveryOutcome={
 review:SignalDiscoveryCandidate[];
 out_of_icp:SignalDiscoveryCandidate[];
 rejected:Partial<Record<ExtractRejection,number>>;
 merged:number;
 truncated:number;
};
export function buildCandidate(hit:SearchHit,target:IcpTarget,now:Date):{ok:true;candidate:SignalDiscoveryCandidate}|{ok:false;reason:ExtractRejection}{
 const r=extractEvent(hit,now);
 if(!r.ok)return r;
 const entity=resolveEventEntity(r.event);
 const icp=icpPrefilter(r.event,entity,target);
 const base={...r.event,...entity};
 const review_tier=reviewTier(r.event,now);
 return {ok:true,candidate:{...base,icp_match:icp.match,icp_reasons:icp.reasons,event_key:eventKeyOf(base),other_sources:[],review_tier,review_label:REVIEW_TIER_LABELS[review_tier]}};
}
export function rankSignalCandidates(hits:SearchHit[],input:{target:IcpTarget;now:Date;max_results:number}):SignalDiscoveryOutcome{
 const rejected:Partial<Record<ExtractRejection,number>>={};
 const built:SignalDiscoveryCandidate[]=[];
 const seenUrls=new Set<string>();
 for(const hit of hits){
  const url=hit.url.replace(/#.*$/,'').replace(/\/$/,'');if(seenUrls.has(url))continue;seenUrls.add(url);
  const r=buildCandidate(hit,input.target,input.now);
  if(r.ok)built.push(r.candidate);else rejected[r.reason]=(rejected[r.reason]??0)+1;
 }
 const {kept,merged}=mergeSameEvents(built);
 const sorted=[...kept].sort(byReviewOrder);
 const inScope=sorted.filter(c=>c.icp_match!=='OUT'),out=sorted.filter(c=>c.icp_match==='OUT');
 // IN before UNKNOWN inside the review list, each in review order.
 const review=[...inScope.filter(c=>c.icp_match==='IN'),...inScope.filter(c=>c.icp_match==='UNKNOWN')];
 const max=Math.max(1,Math.floor(input.max_results));
 return {review:review.slice(0,max),out_of_icp:out,rejected,merged,truncated:Math.max(0,review.length-max)};
}

// ------------------------------------------------------------
// Hand-off to the existing Signal Engine (used in P2, once a person adds the candidate to a project).
// ------------------------------------------------------------
// The raw signal the add action will save through save_signals (provider discovery_recycled → PENDING_REVIEW, the
// database decides). Rules: source_type stays search_snippet; event_date is set ONLY for a past event written with
// its exact day; a future or approximate date stays in metadata.announced_event, never in event_date; the
// publication date is never copied into event_date.
export function toPendingSignal(c:SignalDiscoveryCandidate,now:Date):RawSignal{
 const d=c.event_date;const p=d?periodOf(d):null;
 const exactPastDay=d&&d.granularity==='DAY'&&d.year!==null&&p&&p.end<now.getTime()?`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`:null;
 const title=(c.entity_name?`${c.entity_name} — ${c.headline}`:c.headline).slice(0,300);
 return {
  signal_type:c.signal_type,title,excerpt:c.excerpt,source_url:c.source_url,source_type:c.source_type,
  published_at:c.published_at,event_date:exactPastDay,
  metadata:{origin:'signal_discovery',observed_on_page:false,excerpt_origin:c.excerpt_origin,announced_event:d?{...d,tense:c.event_tense}:null,
   event_tense:c.event_tense,location:c.location,entity_name_status:c.entity_name_status,entity_domain_status:c.entity_domain_status,event_key:c.event_key},
 };
}

// An organization already in the project: the candidate is attached to it instead of creating a duplicate (P2).
export function matchExistingProspect<T extends {id:string;name:string}>(c:Pick<SignalDiscoveryCandidate,'entity_name'>,prospects:readonly T[]):T|null{
 if(!c.entity_name)return null;
 return prospects.find(p=>sameCanonicalOrganization(p.name,c.entity_name!)||entityCore(p.name)===entityCore(c.entity_name!)&&entityCore(p.name).length>=3)??null;
}
