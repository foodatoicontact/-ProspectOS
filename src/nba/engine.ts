// Next Best Action V1 — the engine. Pure and deterministic: data in, one opportunity out; `now` is always a parameter,
// no network, no model, no randomness. It answers, for ONE prospect of a project:
//   which signals count now (classify) → FIT · INTENT · TIMING · FRESHNESS · EVIDENCE_QUALITY → OPPORTUNITY (score)
//   → CONTACT / ENGAGE / WATCH / WAIT / DISMISS (ordered rules, decide) → why, with the proof of every fact (explain).
//
// Reused, never re-implemented: FIT (scoreProspect / estimateFit, src/domain), INTENT (scoreIntent), the recency curve
// (recency-shaped decay of src/domain/intent.ts), signals and their human review (024), public content (027).
// A good ICP is NOT a reason to contact: without TIMING the answer is WAIT, whatever the FIT.
import {estimateFit,type EstimateEvidence} from '../domain/fit-estimate.ts';
import {scoreIntent,type IntentSignal,type IntentProfileInput} from '../domain/intent.ts';
import type {Criterion} from '../domain/core.ts';
import type {SignalType} from '../signals/types.ts';
import {relevanceOf,isGeoPlace,geoPlace,placeLabel,type GeoPlace,type GeoRelevance,type GeoRelevanceReason} from '../geo/model.ts';
import {resolveScope} from '../geo/gazetteer.ts';
import {frPlacesFromLegacyLocation} from '../geo/fr.ts';
import {REGISTRY,entryOf,decayOf,fold,CONVERSATION_DECAY,CONVERSATION_TIMING_WEIGHT,CONVERSATION_TOPICS,
 type CommercialSignalType,type Decay,type RegistryEntry,type ConversationTopic} from './registry.ts';

export const NBA_ACTIONS=['CONTACT','ENGAGE','WATCH','WAIT','DISMISS'] as const;
export type NbaAction=typeof NBA_ACTIONS[number];
export const NBA_STATES=['PENDING','APPROVED','DONE','SNOOZED','REJECTED','EXPIRED'] as const;
export type NbaState=typeof NBA_STATES[number];
export const NBA_OUTCOMES=['NO_RESPONSE','REPLIED','POSITIVE','MEETING','OPPORTUNITY','PAID','NOT_INTERESTED'] as const;
export type NbaOutcome=typeof NBA_OUTCOMES[number];
// Evidence-first: what the engine may say about a signal. VERIFIED = a person reviewed it (024 status VERIFIED);
// INFERRED = found by a provider, not reviewed yet (PENDING_REVIEW); UNKNOWN = nothing to say.
export type EvidenceStatus='VERIFIED'|'INFERRED'|'UNKNOWN';

// ------------------------------------------------------------
// Configuration — every threshold and weight in one versioned object. A stored action carries config_version, so a
// later change of these numbers never rewrites how an old recommendation was made.
// ------------------------------------------------------------
export type NbaConfig={
 version:string;
 weights:{fit:number;timing:number;intent:number;evidence_quality:number;freshness:number};
 fit:{contactMin:number;engageMin:number;watchMin:number;dismissBelow:number};
 timing:{contactMin:number;watchMin:number};
 freshness:{explicitNeedMin:number;contactMin:number;inferredWatchMin:number};
 engage:{maxAgeDays:number};
 statusFactor:{VERIFIED:number;INFERRED:number};
 // Diminishing returns across distinct signal types of one company (1, ½, ¼, then 0).
 multipliers:readonly number[];
 // An action with no dated signal behind it (WAIT / WATCH on FIT alone) is recomputed after this many days.
 defaultHorizonDays:number;
 closedStatuses:readonly string[];
 today:{defaultLimit:number;maxLimit:number};
};
export const NBA_DEFAULT_CONFIG:NbaConfig={
 // v1.1 (canary fix 1): UNKNOWN_FIT_FRESH_SIGNAL, state-derived WHY_THIS_ACTION, signal geographic relevance.
 // v1.2: generic geography (src/geo/), France and international.
 // v1.3 (canary 2): FIT semantics — UNKNOWN is not NEGATIVE (FitProfile, monotonic rules); a signal whose place is
 // UNKNOWN under a geographic ICP never drives CONTACT. Weights, thresholds and half-lives unchanged.
 version:'nba-v1.3-2026-10',
 weights:{fit:0.35,timing:0.30,intent:0.15,evidence_quality:0.10,freshness:0.10},
 fit:{contactMin:60,engageMin:50,watchMin:50,dismissBelow:30},
 timing:{contactMin:50,watchMin:15},
 freshness:{explicitNeedMin:0.7,contactMin:0.5,inferredWatchMin:0.5},
 engage:{maxAgeDays:7},
 statusFactor:{VERIFIED:1,INFERRED:0.5},
 multipliers:[1,0.5,0.25],
 defaultHorizonDays:30,
 closedStatuses:['Gagné','Perdu','Ignoré'],
 today:{defaultLimit:10,maxLimit:50},
};
export function validateConfig(c:NbaConfig):void{
 const w=Object.values(c.weights);
 if(w.some(x=>!Number.isFinite(x)||x<0)||Math.abs(w.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('NBA_CONFIG_WEIGHTS');
 if(c.fit.dismissBelow>c.fit.watchMin||c.fit.watchMin>c.fit.contactMin)throw Error('NBA_CONFIG_FIT');
 if(c.today.defaultLimit<1||c.today.defaultLimit>c.today.maxLimit)throw Error('NBA_CONFIG_TODAY');
}

// ------------------------------------------------------------
// Inputs
// ------------------------------------------------------------
// raw_metadata.location: the place Signal-first read in the article (department codes, region names) — the only
// structured place a signal carries today (migration 030, add_signal_candidate_to_project).
export type NbaSignal=IntentSignal&{source_type:string;provider?:string|null;event_key?:string|null;raw_metadata?:Record<string,unknown>|null};
export type NbaPublicContent={id:string;status:string;source_url:string;source_domain:string|null;author:string|null;content:string;published_at:string|null;observed_at:string};
export type NbaProspect={id:string;project_id:string;name:string;status:string};
export type NbaInput={prospect:NbaProspect;criteria:Criterion[];evidence:EstimateEvidence[];signals:NbaSignal[];publicContent:NbaPublicContent[];
 profile:IntentProfileInput;now:Date;config?:NbaConfig};

// ------------------------------------------------------------
// 0. Geographic relevance of a signal — generic, France and international (src/geo/model.ts). The ICP's scope is its
// target_fit locations resolved to generic places (src/geo/gazetteer.ts: exact names only); the signal's place is its
// structured location: raw_metadata.geo (generic, any country) or, for Signal-first France, raw_metadata.location
// translated by the France adapter. Nothing here knows a country's administrative levels; no text comparison.
//   MATCH     the signal's place is inside the scope;
//   MISMATCH  the signal's place is known and outside the scope: it adds nothing to TIMING for this ICP;
//   UNKNOWN   no scope, no structured place, or not precise enough to conclude: counted as before, never presumed
//             relevant — the uncertainty is written.
// ------------------------------------------------------------
export type IcpZone={places:GeoPlace[];labels:string[]};
export type SignalGeo={relevance:GeoRelevance;place:string|null;reason:GeoRelevanceReason};
export function icpZoneOf(criteria:Criterion[]):IcpZone|null{
 const labels=criteria.flatMap(c=>c.rules?.type==='target_fit'?c.rules.config.locations??[]:[]).map(l=>l.trim()).filter(Boolean);
 const places=resolveScope(labels);
 return places.length?{places,labels}:null;
}
export function signalPlaces(s:NbaSignal):GeoPlace[]{
 const meta=s.raw_metadata&&typeof s.raw_metadata==='object'?s.raw_metadata as Record<string,unknown>:null;
 if(!meta)return [];
 const geo=meta.geo;
 if(Array.isArray(geo))return geo.filter(isGeoPlace).map(geoPlace);
 if(isGeoPlace(geo))return [geoPlace(geo)];
 const loc=meta.location;
 if(loc&&typeof loc==='object')return frPlacesFromLegacyLocation(loc as Record<string,unknown>);
 return [];
}
export function geoRelevance(s:NbaSignal,zone:IcpZone|null):SignalGeo{
 const places=signalPlaces(s);
 const loc=s.raw_metadata&&typeof s.raw_metadata==='object'?(s.raw_metadata as Record<string,any>).location:null;
 const place=places[0]?placeLabel(places[0]):typeof loc?.text==='string'?loc.text:null;
 const r=relevanceOf(places,zone?.places??[]);
 return {relevance:r.relevance,place,reason:r.reason};
}

// ------------------------------------------------------------
// 1. Classification
// ------------------------------------------------------------
export type ClassifiedSignal={
 signal_id:string;commercial_type:CommercialSignalType;base_type:SignalType;
 // explicit_terms: the words the type needs are written in the signal; base_type: classified by its 024 type alone.
 basis:'explicit_terms'|'base_type'|'source_type'|'manual'|'fallback';matched:string|null;
 evidence_status:EvidenceStatus;confidence:number;date_basis:'event'|'published'|'observed_only';age_days:number;
 decay:Decay;freshness:number;timing:number;quality:number;affinity:RegistryEntry['affinity'];need:RegistryEntry['need'];
 source_url:string;source_domain:string|null;title:string;excerpt:string;
 // MISMATCH: timing is 0 for this ICP (freshness kept, to say what the signal was).
 geo:SignalGeo;
};
const DAY=86400000;
const round=(v:number,d=3)=>Math.round(v*10**d)/10**d;
// The recency curve of the Intent Engine (src/domain/intent.ts recency), with the registry's decay.
export function freshnessOf(ageDays:number,decay:Decay):number{
 if(!Number.isFinite(ageDays)||ageDays<0||ageDays>decay.maxAgeDays)return 0;
 return Math.pow(0.5,ageDays/decay.halfLifeDays);
}
function dateOf(s:NbaSignal,now:Date):{basis:ClassifiedSignal['date_basis'];age:number}{
 const [basis,iso]=s.event_date?['event' as const,`${s.event_date}T00:00:00Z`]:s.published_at?['published' as const,s.published_at]:['observed_only' as const,s.observed_at];
 return {basis,age:Math.floor((now.getTime()-new Date(iso).getTime())/DAY)};
}
export function evidenceStatusOf(status:string):EvidenceStatus{return status==='VERIFIED'?'VERIFIED':status==='PENDING_REVIEW'?'INFERRED':'UNKNOWN'}

export function classifySignal(s:NbaSignal,now:Date,config:NbaConfig=NBA_DEFAULT_CONFIG,zone:IcpZone|null=null):ClassifiedSignal|null{
 const evidence_status=evidenceStatusOf(s.status);
 if(evidence_status==='UNKNOWN')return null; // REJECTED (or unknown status): never a reason
 const text=fold(`${s.title} ${s.excerpt} ${s.matched_terms.join(' ')}`);
 let chosen:RegistryEntry|null=null,matched:string|null=null,basis:ClassifiedSignal['basis']='fallback';
 for(const e of REGISTRY){
  if(e.base&&!e.base.includes(s.signal_type))continue;
  if(e.sourceTypes&&!e.sourceTypes.includes(s.source_type))continue;
  if(e.manualOnly&&s.provider!=='user_provided')continue;
  if(e.terms){const m=e.terms.exec(text);if(!m)continue;matched=m[0];basis='explicit_terms'}
  else basis=e.manualOnly?'manual':e.base?'base_type':'fallback';
  chosen=e;break;
 }
 const entry=chosen??entryOf('OTHER');
 const {basis:date_basis,age}=dateOf(s,now);
 const decay=decayOf(entry,s.signal_type);
 const freshness=freshnessOf(age,decay);
 const factor=config.statusFactor[evidence_status];
 const geo=geoRelevance(s,zone);
 return {signal_id:s.id,commercial_type:entry.type,base_type:s.signal_type,basis,matched,evidence_status,confidence:s.confidence,date_basis,age_days:age,decay,
  freshness:round(freshness),timing:geo.relevance==='MISMATCH'?0:round(entry.timingWeight*freshness*factor),quality:round(Math.min(1,s.confidence)*factor),
  affinity:entry.affinity,need:entry.need,source_url:s.source_url,source_domain:s.source_domain,title:s.title,excerpt:s.excerpt,geo};
}

// ------------------------------------------------------------
// 2. Public conversations
// ------------------------------------------------------------
export type Conversation={content_id:string;author:string|null;published_at:string|null;age_days:number;freshness:number;timing:number;
 topic:ConversationTopic|null;matched:string;source_url:string;source_domain:string|null;excerpt:string};
export function relevantConversation(items:NbaPublicContent[],profile:IntentProfileInput,now:Date):Conversation|null{
 const terms=(profile?.terms??[]).map(t=>fold(t)).filter(t=>t.length>=2);
 const out:Conversation[]=[];
 for(const c of items){
  // Only a VERIFIED content with its OWN publication date: the day ProspectOS stored it is not when it was said.
  if(c.status!=='VERIFIED'||!c.published_at)continue;
  const age=Math.floor((now.getTime()-new Date(c.published_at).getTime())/DAY);
  const freshness=freshnessOf(age,CONVERSATION_DECAY);if(freshness<=0)continue;
  const text=fold(c.content);
  let topic:ConversationTopic|null=null,matched='';
  for(const t of CONVERSATION_TOPICS){const m=t.terms.exec(text);if(m){topic=t;matched=m[0];break}}
  if(!topic){const term=terms.find(t=>text.includes(t));if(!term)continue;matched=term}
  out.push({content_id:c.id,author:c.author?.trim()||null,published_at:c.published_at,age_days:age,freshness:round(freshness),timing:round(CONVERSATION_TIMING_WEIGHT*freshness),
   topic,matched,source_url:c.source_url,source_domain:c.source_domain,excerpt:c.content});
 }
 return out.sort((a,b)=>b.timing-a.timing||a.content_id.localeCompare(b.content_id))[0]??null;
}

// ------------------------------------------------------------
// 3. Scores — each 0–100, each with the lines it was made of.
// ------------------------------------------------------------
export type ScoreLine={label:string;value:number;ref?:{kind:'signal'|'public_content'|'evidence';id:string}};
// FIT semantics (v1.3) — what is known about the ICP, criterion by criterion, never a single number read as a verdict:
//   positive  criteria a person verified TRUE, or estimated TRUE from unverified observations (estimateFit);
//   negative  criteria a person verified FALSE — the only "unfavourable information";
//   unknown   everything else (no evidence, contradiction to review, an unverified FALSE observation).
// level = estimateFit's merged score (verified points + estimated points): it decides WATCH / WAIT and never decreases
// when a criterion goes from UNKNOWN to TRUE. verified_score = scoreProspect's score: it alone decides CONTACT.
//   UNKNOWN     nothing observed;
//   INCOMPLETE  no unfavourable information, level under the WATCH threshold: more information is needed;
//   SUFFICIENT  level at or above the WATCH threshold;
//   KNOWN_LOW   unfavourable information AND level under the WATCH threshold: a low FIT shown by evidence.
export type FitState='UNKNOWN'|'INCOMPLETE'|'SUFFICIENT'|'KNOWN_LOW';
export type FitProfile={
 total_weight:number;positive_weight:number;verified_positive_weight:number;negative_weight:number;unknown_weight:number;observed_weight:number;
 // Shares of the ICP's weight, 0–100.
 coverage:number;verified_coverage:number;
 level:number;verified_score:number;direction:'POSITIVE'|'NEGATIVE'|'MIXED'|'NONE';state:FitState;
 // Criterion labels, to explain without a number: what supports, what goes against (verified), what nobody knows.
 supporting:string[];against:string[];missing:string[];
 // UI-4 (labels only — no weight, level or state reads them): within supporting, the criteria a person VERIFIED with a
 // source, and those resting only on the person's own declaration (USER_DECLARED, never verified); declared_false: the
 // criteria (also in missing) the person declared NOT met — not counter-evidence: they stay in the unknown weight, never
 // against, so never OFF_TARGET. Absent on recommendations stored before UI-4.
 verified_supporting?:string[];declared?:string[];declared_false?:string[];
};
export type Scores={
 // score / basis / coverage: unchanged since v1 (stored, shown); profile: what the decision reads.
 fit:{score:number|null;basis:'verified'|'estimated'|'unknown';coverage:number;lines:ScoreLine[];profile:FitProfile};
 intent:{score:number;estimated:number;lines:ScoreLine[]};
 timing:{score:number;lines:ScoreLine[]};
 freshness:{score:number;lines:ScoreLine[]};
 evidence_quality:{score:number;lines:ScoreLine[]};
 opportunity:{score:number;lines:ScoreLine[]};
};
export type Driver={kind:'signal';signal:ClassifiedSignal}|{kind:'conversation';conversation:Conversation};

export function fitProfileOf(f:ReturnType<typeof estimateFit>,config:NbaConfig):FitProfile{
 const p:FitProfile={total_weight:0,positive_weight:0,verified_positive_weight:0,negative_weight:0,unknown_weight:0,observed_weight:0,coverage:0,verified_coverage:0,
  level:f.estimated.score,verified_score:f.verified.score,direction:'NONE',state:'UNKNOWN',supporting:[],against:[],missing:[],
  verified_supporting:[],declared:[],declared_false:[]};
 for(const line of f.estimated.breakdown){
  const verified=f.verified.breakdown.find(b=>b.key===line.key)!;
  p.total_weight+=line.weight;
  if(verified.state==='TRUE'){p.positive_weight+=line.weight;p.verified_positive_weight+=line.weight;p.supporting.push(line.label);p.verified_supporting!.push(line.label)}
  else if(verified.state==='FALSE'){p.negative_weight+=line.weight;p.against.push(line.label)}
  else if(line.state==='ESTIMATED'){p.positive_weight+=line.weight;p.supporting.push(line.label);if(line.declared===true)p.declared!.push(line.label)}
  else{p.unknown_weight+=line.weight;p.missing.push(line.label);if(line.declared===false)p.declared_false!.push(line.label)}
 }
 p.observed_weight=p.positive_weight+p.negative_weight;
 const share=(w:number)=>p.total_weight>0?Math.round(100*w/p.total_weight):0;
 p.coverage=share(p.observed_weight);p.verified_coverage=share(p.verified_positive_weight+p.negative_weight);
 p.direction=p.positive_weight>0&&p.negative_weight>0?'MIXED':p.positive_weight>0?'POSITIVE':p.negative_weight>0?'NEGATIVE':'NONE';
 p.state=p.level>=config.fit.watchMin?'SUFFICIENT':p.negative_weight>0?'KNOWN_LOW':p.observed_weight>0?'INCOMPLETE':'UNKNOWN';
 return p;
}
function fitOf(input:NbaInput,config:NbaConfig):Scores['fit']{
 const f=estimateFit(input.criteria,input.evidence,input.now);
 const profile=fitProfileOf(f,config);
 const verifiedLines=f.verified.breakdown.filter(b=>b.state==='TRUE').map(b=>({label:b.label,value:b.points,ref:b.evidence_ids[0]?{kind:'evidence' as const,id:b.evidence_ids[0]}:undefined}));
 if(f.verified.coverage>0)return {score:f.verified.score,basis:'verified',coverage:f.verified.coverage,lines:verifiedLines,profile};
 const est=f.estimated.breakdown.filter(b=>b.points>0);
 if(est.length)return {score:f.estimated.score,basis:'estimated',coverage:0,lines:est.map(b=>({label:b.label,value:b.points,ref:b.evidence_ids[0]?{kind:'evidence' as const,id:b.evidence_ids[0]}:undefined})),profile};
 return {score:null,basis:'unknown',coverage:0,lines:[],profile};
}

// One line per commercial type (the best signal of that type); duplicates and weaker signals of the same type are
// corroboration, never a second reason. Across types: diminishing returns, capped at 100.
export function timingOf(signals:ClassifiedSignal[],conversation:Conversation|null,config:NbaConfig):{score:number;lines:ScoreLine[];primary:Driver|null;corroborating:ClassifiedSignal[]}{
 const bestByType=new Map<string,ClassifiedSignal>();const corroborating:ClassifiedSignal[]=[];
 for(const s of [...signals].sort((a,b)=>b.timing-a.timing||a.signal_id.localeCompare(b.signal_id))){
  if(s.timing<=0)continue;
  if(bestByType.has(s.commercial_type))corroborating.push(s);else bestByType.set(s.commercial_type,s);
 }
 const drivers:Driver[]=[...bestByType.values()].map(signal=>({kind:'signal' as const,signal}));
 if(conversation&&conversation.timing>0)drivers.push({kind:'conversation',conversation});
 const t=(d:Driver)=>d.kind==='signal'?d.signal.timing:d.conversation.timing;
 drivers.sort((a,b)=>t(b)-t(a)||(a.kind==='signal'?a.signal.signal_id:a.conversation.content_id).localeCompare(b.kind==='signal'?b.signal.signal_id:b.conversation.content_id));
 const lines:ScoreLine[]=drivers.map((d,i)=>{const m=config.multipliers[i]??0;return d.kind==='signal'
  ?{label:`${entryOf(d.signal.commercial_type).label.fr} × ${m}`,value:round(100*d.signal.timing*m,1),ref:{kind:'signal',id:d.signal.signal_id}}
  :{label:`Conversation publique × ${m}`,value:round(100*d.conversation.timing*m,1),ref:{kind:'public_content',id:d.conversation.content_id}}});
 return {score:Math.min(100,Math.round(lines.reduce((a,l)=>a+l.value,0))),lines,primary:drivers[0]??null,corroborating};
}

export function scoresOf(input:NbaInput,classified:ClassifiedSignal[],conversation:Conversation|null,config:NbaConfig){
 const fit=fitOf(input,config);
 const intentRaw=scoreIntent(input.signals,input.profile,input.now);
 const intent={score:intentRaw.score,estimated:intentRaw.estimated.score,lines:intentRaw.lines.filter(l=>l.points>0).map(l=>({label:l.title,value:l.points,ref:{kind:'signal' as const,id:l.signal_id}}))};
 const timing=timingOf(classified,conversation,config);
 const p=timing.primary;
 const freshnessValue=p?p.kind==='signal'?p.signal.freshness:p.conversation.freshness:0;
 const freshness={score:Math.round(100*freshnessValue),lines:p?[{label:p.kind==='signal'?`Âge ${p.signal.age_days} j, demi-vie ${p.signal.decay.halfLifeDays} j, âge max ${p.signal.decay.maxAgeDays} j`
  :`Âge ${p.conversation.age_days} j, demi-vie ${CONVERSATION_DECAY.halfLifeDays} j, âge max ${CONVERSATION_DECAY.maxAgeDays} j`,value:Math.round(100*freshnessValue),
  ref:p.kind==='signal'?{kind:'signal' as const,id:p.signal.signal_id}:{kind:'public_content' as const,id:p.conversation.content_id}}]:[]};
 // Evidence quality: 60 % the proof behind "now" (source confidence × human review), 40 % the share of the ICP backed
 // by verified evidence. A conversation is a VERIFIED public content: its quality is the review itself (1).
 const nowQuality=p?p.kind==='signal'?p.signal.quality:1:0;
 const evidence_quality={score:Math.round(60*nowQuality+40*fit.coverage/100),lines:[
  {label:'Preuve du signal (confiance de la source × revue humaine)',value:round(60*nowQuality,1),ref:p?p.kind==='signal'?{kind:'signal' as const,id:p.signal.signal_id}:{kind:'public_content' as const,id:p.conversation.content_id}:undefined},
  {label:'Couverture ICP par des preuves vérifiées',value:round(40*fit.coverage/100,1)}]};
 const w=config.weights;
 const parts:[string,number,number][]=[['FIT',fit.score??0,w.fit],['TIMING',timing.score,w.timing],['INTENT',intent.score,w.intent],
  ['EVIDENCE_QUALITY',evidence_quality.score,w.evidence_quality],['FRESHNESS',freshness.score,w.freshness]];
 const opportunity={score:Math.round(parts.reduce((a,[,v,k])=>a+v*k,0)),lines:parts.map(([label,v,k])=>({label:`${label} ${v} × ${k}`,value:round(v*k,1)}))};
 const scores:Scores={fit,intent,timing:{score:timing.score,lines:timing.lines},freshness,evidence_quality,opportunity};
 return {scores,primary:timing.primary,corroborating:timing.corroborating};
}

// ------------------------------------------------------------
// 4. Decision — ordered rules; the first that applies decides. Each rule names itself in the result, so the action
// is always traceable to one written rule. OPPORTUNITY never decides alone.
// ------------------------------------------------------------
export type RuleId='CLOSED_PROSPECT'|'OFF_TARGET'|'EXPLICIT_RECENT_NEED'|'RELEVANT_CONVERSATION'|'CONTACT_SIGNAL'|'SIGNAL_TO_VERIFY'
 |'SOME_TIMING'|'FIT_FRESH_SIGNAL'|'FIT_WITHOUT_TIMING'|'UNKNOWN_FIT_FRESH_SIGNAL'|'INCOMPLETE_FIT_FRESH_SIGNAL'
 |'FIT_UNKNOWN_NO_TIMING'|'FIT_INCOMPLETE_NO_TIMING'|'LOW_FIT_NO_TIMING';
// v1.3.x: the former terminal rule, kept only to read recommendations stored before the split (never decided any more).
export type LegacyRuleId='NOT_ENOUGH';
type Ctx={input:NbaInput;scores:Scores;primary:Driver|null;signals:ClassifiedSignal[];conversation:Conversation|null;config:NbaConfig;zone:IcpZone|null};
// v1.3: WATCH / WAIT / ENGAGE read the FIT level (verified + estimated: it only grows when a criterion becomes TRUE);
// CONTACT reads the VERIFIED score alone. Neither ever reads a missing criterion as a failed one.
const fitAtLeast=(c:Ctx,min:number)=>c.scores.fit.profile.level>=min;
const verifiedFitAtLeast=(c:Ctx,min:number)=>c.scores.fit.profile.verified_score>=min;
const fitState=(c:Ctx)=>c.scores.fit.profile.state;
// A signal may drive CONTACT only when its place is known to be inside the ICP's zone (when the ICP has one): an
// UNKNOWN place can still make an account worth a check (WATCH), never a contact on its own.
const contactEligible=(c:Ctx,s:ClassifiedSignal)=>!c.zone||s.geo.relevance==='MATCH';
const contactTiming=(c:Ctx)=>timingOf(c.signals.filter(s=>contactEligible(c,s)),c.conversation,c.config).score;
// The best signal that still says "now" for this ICP: fresh enough to be checked (the existing inferred-watch
// freshness threshold), not outside the zone.
const freshSignal=(c:Ctx)=>c.signals.filter(s=>s.freshness>=c.config.freshness.inferredWatchMin&&s.geo.relevance!=='MISMATCH').sort((a,b)=>b.timing-a.timing||a.signal_id.localeCompare(b.signal_id))[0]??null;
const bestContact=(c:Ctx,status:EvidenceStatus)=>c.signals.filter(s=>s.affinity==='contact'&&s.evidence_status===status&&s.timing>0&&(status!=='VERIFIED'||contactEligible(c,s))).sort((a,b)=>b.timing-a.timing)[0]??null;
export const RULES:readonly {id:RuleId;action:NbaAction;when:(c:Ctx)=>boolean}[]=[
 {id:'CLOSED_PROSPECT',action:'DISMISS',when:c=>c.config.closedStatuses.includes(c.input.prospect.status)},
 // v1.3: off target only when unfavourable evidence says so — never because criteria are missing.
 {id:'OFF_TARGET',action:'DISMISS',when:c=>fitState(c)==='KNOWN_LOW'&&c.scores.fit.profile.level<c.config.fit.dismissBelow},
 {id:'EXPLICIT_RECENT_NEED',action:'CONTACT',when:c=>{const s=bestContact(c,'VERIFIED');return !!s&&s.need==='explicit'&&s.freshness>=c.config.freshness.explicitNeedMin&&verifiedFitAtLeast(c,c.config.fit.contactMin)}},
 {id:'RELEVANT_CONVERSATION',action:'ENGAGE',when:c=>!!c.conversation&&c.conversation.age_days<=c.config.engage.maxAgeDays&&fitAtLeast(c,c.config.fit.engageMin)},
 {id:'CONTACT_SIGNAL',action:'CONTACT',when:c=>{const s=bestContact(c,'VERIFIED');return !!s&&s.freshness>=c.config.freshness.contactMin&&verifiedFitAtLeast(c,c.config.fit.contactMin)&&contactTiming(c)>=c.config.timing.contactMin}},
 {id:'SIGNAL_TO_VERIFY',action:'WATCH',when:c=>{const s=bestContact(c,'INFERRED');return !!s&&s.freshness>=c.config.freshness.inferredWatchMin&&fitAtLeast(c,c.config.fit.watchMin)}},
 {id:'SOME_TIMING',action:'WATCH',when:c=>c.scores.timing.score>=c.config.timing.watchMin&&fitAtLeast(c,c.config.fit.watchMin)},
 // v1.3 (monotonicity): a fresh signal still to check keeps a good account in WATCH; without this rule, a criterion
 // becoming TRUE could move an account from INCOMPLETE_FIT_FRESH_SIGNAL (WATCH) to FIT_WITHOUT_TIMING (WAIT).
 {id:'FIT_FRESH_SIGNAL',action:'WATCH',when:c=>fitAtLeast(c,c.config.fit.watchMin)&&!!freshSignal(c)},
 {id:'FIT_WITHOUT_TIMING',action:'WAIT',when:c=>fitAtLeast(c,c.config.fit.watchMin)},
 // Canary fix 1 (FIX 1): an UNKNOWN FIT is not a low FIT. A fresh, non-rejected signal that is not outside the ICP's
 // zone makes the account worth a human check (WATCH) — never CONTACT: every CONTACT rule needs a verified FIT.
 {id:'UNKNOWN_FIT_FRESH_SIGNAL',action:'WATCH',when:c=>fitState(c)==='UNKNOWN'&&!!freshSignal(c)},
 // v1.3: a partly documented FIT with nothing against it is INCOMPLETE, not low — same check as an unknown one.
 {id:'INCOMPLETE_FIT_FRESH_SIGNAL',action:'WATCH',when:c=>fitState(c)==='INCOMPLETE'&&!!freshSignal(c)},
 // v1.3.x: the former terminal NOT_ENOUGH, split by FIT state. Same action (DISMISS), same thresholds: what reaches here
 // has no fresh signal for WATCH and a level under the WATCH threshold (SUFFICIENT never does). UNKNOWN and INCOMPLETE are
 // "to document", not rejected; KNOWN_LOW between dismissBelow and watchMin stays with the low-fit accounts. Exhaustive:
 // buildOpportunity refuses a case none of the rules covers rather than invent one.
 {id:'FIT_UNKNOWN_NO_TIMING',action:'DISMISS',when:c=>fitState(c)==='UNKNOWN'},
 {id:'FIT_INCOMPLETE_NO_TIMING',action:'DISMISS',when:c=>fitState(c)==='INCOMPLETE'},
 {id:'LOW_FIT_NO_TIMING',action:'DISMISS',when:c=>fitState(c)==='KNOWN_LOW'},
];

// ------------------------------------------------------------
// 5. Explanation — every sentence says what it is: a FACT (with the proof to open), an INFERENCE (a rule's reading,
// never presented as a fact), UNKNOWN (what nobody knows), or the RULE that decided.
// ------------------------------------------------------------
export type Ref={kind:'signal'|'public_content'|'evidence';id:string;source_url:string|null};
export type Statement={kind:'fact'|'inference'|'unknown'|'rule';text:string;refs:Ref[]};
export type Explanation={why_this_account:Statement[];why_now:Statement[];why_this_action:Statement[];inferred:Statement[];unknown:Statement[]};
export type Target={role:string|null;role_alternatives:string[];role_basis:'signal_type_rule'|null;
 person:{name:string;basis:'public_content_author';ref:Ref}|null};

const MAX_QUOTE=220;
const clip=(s:string)=>{const t=s.replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');if(t.length<=MAX_QUOTE)return t;const cut=t.slice(0,MAX_QUOTE);return `${cut.slice(0,Math.max(cut.lastIndexOf(' '),80)).replace(/[\s,;:.]+$/,'')}…`};
const day=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const ago=(d:number)=>d<=0?'aujourd’hui':d===1?'il y a 1 jour':`il y a ${d} jours`;

// WHY_THIS_ACTION is written from the state the rule saw — never a generic sentence that the data could contradict
// (canary fix 1, FIX 2: "ni un signal récent" was written next to a 5-day-old signal).
const named=(x:ClassifiedSignal)=>`${entryOf(x.commercial_type).label.fr}, ${ago(x.age_days)}`;
const zoneName=(z:IcpZone|null)=>z?.labels.join(', ')||'la zone de l’ICP';
// v1.3: the FIT said as what is known — never "insufficient" when the rest is simply not documented.
const fitLevel=(p:FitProfile)=>p.level>p.verified_score?`FIT ${p.level}/100, dont ${p.level-p.verified_score} points estimés à vérifier`:`FIT ${p.level}/100`;
const incompleteFit=(p:FitProfile)=>`Le compte correspond aux critères ${p.verified_positive_weight===p.positive_weight?'vérifiés':'documentés'} disponibles, mais seulement ${p.coverage} % de l’ICP est documenté`;
const lowFit=(p:FitProfile)=>`Des éléments vérifiés indiquent que le compte ne correspond pas suffisamment à la cible (défavorable : ${p.against.join(', ')} ; ${fitLevel(p)})`;
function actionReason(c:Ctx,rule:RuleId):string{
 const {scores,input}=c;const fp=scores.fit.profile;const fit=fitLevel(fp);
 const counting=[...c.signals].filter(x=>x.timing>0).sort((a,b)=>b.timing-a.timing||a.signal_id.localeCompare(b.signal_id))[0]??null;
 const fresh=freshSignal(c);
 const outside=c.signals.filter(x=>x.geo.relevance==='MISMATCH'&&x.freshness>0).sort((a,b)=>a.age_days-b.age_days)[0]??null;
 const expired=c.signals.filter(x=>x.freshness===0).sort((a,b)=>a.age_days-b.age_days)[0]??null;
 const tooOld=expired?` Le signal le plus récent (${named(expired)}) est trop ancien pour compter : sa durée de vie est de ${expired.decay.maxAgeDays} jours.`:'';
 const offZone=outside?` Le signal récent (${named(outside)}) concerne ${outside.geo.place??'un lieu'}, hors de ${zoneName(c.zone)} : il ne compte pas pour cet ICP.`:'';
 const fresh_=(x:ClassifiedSignal)=>Math.round(x.freshness*100);
 switch(rule){
  case 'CLOSED_PROSPECT':return `Le prospect est déjà clos dans le pipeline (statut ${input.prospect.status}) : aucune nouvelle action.`;
  case 'OFF_TARGET':return counting?`Un signal récent existe (${named(counting)}), mais ${lowFit(fp).replace(/^D/,'d')}.`:`${lowFit(fp)}.${tooOld}${offZone}`;
  case 'EXPLICIT_RECENT_NEED':{const x=bestContact(c,'VERIFIED')!;return `Le besoin est écrit dans une source vérifiée et récent (${named(x)}, fraîcheur ${fresh_(x)} %) : une prise de contact directe est plus pertinente qu’une surveillance.`}
  case 'RELEVANT_CONVERSATION':return `Une conversation publique pertinente a été publiée ${ago(c.conversation!.age_days)} : intervenir sur le fond avant toute approche commerciale.`;
  case 'CONTACT_SIGNAL':{const x=bestContact(c,'VERIFIED')!;return `Un signal vérifié et encore frais (${named(x)}, TIMING ${scores.timing.score}/100) donne une raison datée de contacter maintenant.`}
  case 'SIGNAL_TO_VERIFY':{const x=bestContact(c,'INFERRED')!;return `Un signal récent existe (${named(x)}) mais n’a pas encore été vérifié par une personne : le vérifier avant toute prise de contact.`}
  case 'SOME_TIMING':return `Le compte correspond à l’ICP (${fit}) et un signal existe${counting?` (${named(counting)})`:''}, mais il n’est pas assez fort ou récent pour une approche (TIMING ${scores.timing.score}/100).`;
  case 'FIT_FRESH_SIGNAL':return `Le compte correspond à l’ICP (${fit}) et un signal récent existe (${named(fresh!)}), mais il doit encore être vérifié ou renforcé avant une prise de contact (TIMING ${scores.timing.score}/100).`;
  case 'FIT_WITHOUT_TIMING':return counting
   ?`Le compte correspond à l’ICP (${fit}), mais le signal récent (${named(counting)}) est trop faible pour justifier une prise de contact maintenant (TIMING ${scores.timing.score}/100).`
   :`Le compte correspond à l’ICP (${fit}), mais aucun élément récent${c.zone?` dans ${zoneName(c.zone)}`:''} ne justifie une prise de contact maintenant.${tooOld}${offZone}`;
  case 'UNKNOWN_FIT_FRESH_SIGNAL':return `Un signal récent existe (${named(fresh!)}), mais l’adéquation à l’ICP et/ou le signal doivent encore être vérifiés avant toute prise de contact.`;
  case 'INCOMPLETE_FIT_FRESH_SIGNAL':return `Un signal récent existe (${named(fresh!)}). ${incompleteFit(fp)} : des informations supplémentaires sont nécessaires avant une prise de contact.`;
  // v1.3.x: each says exactly the FIT state; an UNKNOWN or INCOMPLETE FIT is never called off target.
  case 'FIT_UNKNOWN_NO_TIMING':{
   const base='L’adéquation à l’ICP n’est pas encore documentée : aucune information ne permet de dire si le compte correspond ou non à la cible';
   return counting?`${base}, et le meilleur signal encore pris en compte (${named(counting)}) a perdu l’essentiel de sa fraîcheur (${fresh_(counting)} %) : à documenter avant toute action.${offZone}`
    :`${base}, et aucun élément récent ne justifie une action : à documenter.${tooOld}${offZone}`;
  }
  case 'FIT_INCOMPLETE_NO_TIMING':{
   const base=`Les éléments disponibles sont favorables, mais une partie de l’ICP reste non documentée (${fp.coverage} % documenté${fp.missing.length?` ; à documenter : ${fp.missing.join(', ')}`:''})`;
   return counting?`${base}, et le meilleur signal encore pris en compte (${named(counting)}) a perdu l’essentiel de sa fraîcheur (${fresh_(counting)} %) : pas assez pour justifier une vérification.${offZone}`
    :`${base}, et aucun élément récent ne justifie une action.${tooOld}${offZone}`;
  }
  case 'LOW_FIT_NO_TIMING':{
   const base=`Des éléments vérifiés sont défavorables (${fp.against.join(', ')} ; ${fit}), sans atteindre le seuil qui écarte un compte comme hors cible`;
   return counting?`${base}, et le signal récent (${named(counting)}) ne suffit pas à justifier une action.${offZone}`
    :`${base}, et aucun élément récent ne justifie une action.${tooOld}${offZone}`;
  }
 }
}

function explain(c:Ctx,rule:RuleId,target:Target):Explanation{
 const {scores,primary,input}=c;
 const evidenceRef=(id:string):Ref=>({kind:'evidence',id,source_url:input.evidence.find(e=>e.id===id)?.source_url??null});
 const why_this_account:Statement[]=[];const unknown:Statement[]=[];const inferred:Statement[]=[];
 if(scores.fit.basis==='verified'){
  const labels=scores.fit.lines.map(l=>l.label);
  const fp=scores.fit.profile;
  if(labels.length)why_this_account.push({kind:'fact',text:`Critères ICP étayés par des preuves vérifiées : ${labels.join(', ')} (FIT vérifié ${scores.fit.score}/100, ${fp.verified_coverage} % de l’ICP vérifié).`,
   refs:scores.fit.lines.flatMap(l=>l.ref?[evidenceRef(l.ref.id)]:[])});
  if(fp.against.length)why_this_account.push({kind:'fact',text:`Critères ICP vérifiés non satisfaits : ${fp.against.join(', ')}.`,refs:[]});
 }else if(scores.fit.basis==='estimated'){
  // UI-4: a criterion resting only on the person's declaration is never called a proof (said apart, below).
  const declared=new Set(scores.fit.profile.declared??[]);const sourced=scores.fit.lines.filter(l=>!declared.has(l.label));
  why_this_account.push({kind:'inference',text:sourced.length?`FIT estimé à ${scores.fit.score}/100 à partir de preuves non vérifiées : ${sourced.map(l=>l.label).join(', ')}.`
   :`FIT estimé à ${scores.fit.score}/100 à partir de vos seules déclarations, sans source.`,refs:sourced.flatMap(l=>l.ref?[evidenceRef(l.ref.id)]:[])});
 }else unknown.push({kind:'unknown',text:'Adéquation à l’ICP inconnue : aucune preuve sur ce compte.',refs:[]});
 // UI-4: what the person declared, without a source — an inference for the estimate, never a fact nor a proof.
 if(scores.fit.profile.declared?.length)inferred.push({kind:'inference',text:`Déclaré par vous, sans source (non vérifié) : ${scores.fit.profile.declared.join(', ')}.`,refs:[]});
 if(scores.fit.profile.declared_false?.length)unknown.push({kind:'unknown',text:`Déclaré non rempli par vous, sans source (non vérifié, ce n’est pas une contre-preuve) : ${scores.fit.profile.declared_false.join(', ')}.`,refs:[]});
 if(scores.fit.profile.observed_weight>0&&scores.fit.profile.missing.length)
  unknown.push({kind:'unknown',text:`Critères ICP non documentés (${100-scores.fit.profile.coverage} % de l’ICP) : ${scores.fit.profile.missing.join(', ')}.`,refs:[]});
 const why_now:Statement[]=[];
 if(primary?.kind==='signal'){
  const s=primary.signal,e=entryOf(s.commercial_type),ref:Ref={kind:'signal',id:s.signal_id,source_url:s.source_url};
  const when=s.date_basis==='observed_only'?`relevé ${ago(s.age_days)} (date du fait inconnue)`:`${s.date_basis==='event'?'daté':'publié'} ${ago(s.age_days)}`;
  why_now.push({kind:s.evidence_status==='VERIFIED'?'fact':'inference',text:`${e.label.fr} : « ${clip(s.excerpt)} » (${[s.source_domain,when].filter(Boolean).join(', ')})${s.evidence_status==='VERIFIED'?'.':' — à vérifier.'}`,refs:[ref]});
  if(s.basis==='explicit_terms')inferred.push({kind:'inference',text:`Type « ${e.label.fr} » déduit des mots « ${s.matched} » écrits dans la source.`,refs:[ref]});
  else inferred.push({kind:'inference',text:`Type « ${e.label.fr} » déduit du type de signal « ${s.base_type} ».`,refs:[ref]});
  if(s.date_basis==='observed_only')unknown.push({kind:'unknown',text:'Date du fait inconnue : seule la date de relevé est connue.',refs:[ref]});
  if(s.geo.relevance==='MATCH')why_now.push({kind:'fact',text:`Lieu du signal : ${s.geo.place??'—'}, dans ${zoneName(c.zone)}.`,refs:[ref]});
  else unknown.push({kind:'unknown',text:s.geo.reason==='scope_undefined'?'Pertinence géographique non établie : l’ICP ne définit pas de zone exploitable.'
   :s.geo.reason==='place_unknown'?'Pertinence géographique non établie : le lieu du signal n’est pas connu de façon structurée.'
   :s.geo.reason==='mixed_places'?`Pertinence géographique non établie : le signal cite des lieux dans et hors de ${zoneName(c.zone)}.`
   :`Pertinence géographique non établie : le lieu connu du signal (${s.geo.place??'—'}) n’est pas assez précis pour ${zoneName(c.zone)}.`,refs:[ref]});
 }else if(primary?.kind==='conversation'){
  const v=primary.conversation,ref:Ref={kind:'public_content',id:v.content_id,source_url:v.source_url};
  why_now.push({kind:'fact',text:`${v.author??'Publication'} ${v.published_at?`le ${day(v.published_at)}`:''} : « ${clip(v.excerpt)} » (${[v.source_domain,ago(v.age_days)].filter(Boolean).join(', ')}).`,refs:[ref]});
  why_now.push({kind:'fact',text:`Pertinence : le contenu mentionne « ${v.matched} »${v.topic?` (${v.topic.label.fr})`:''}.`,refs:[ref]});
 }else{
  // No reason now — but if a signal exists, say which one and why it no longer counts, with its proof.
  const last=[...c.signals].sort((a,b)=>a.age_days-b.age_days)[0];
  const lastRef=last?[{kind:'signal' as const,id:last.signal_id,source_url:last.source_url}]:[];
  if(last&&last.freshness===0)why_now.push({kind:last.evidence_status==='VERIFIED'?'fact':'inference',text:`Le signal le plus récent (${named(last)}) ne compte plus : sa durée de vie est de ${last.decay.maxAgeDays} jours.`,refs:lastRef});
  else if(last&&last.geo.relevance==='MISMATCH')why_now.push({kind:'fact',text:`Le signal le plus récent (${named(last)}) concerne ${last.geo.place??'un lieu'}, hors de ${zoneName(c.zone)} : il ne compte pas pour cet ICP.`,refs:lastRef});
  else if(last)why_now.push({kind:last.evidence_status==='VERIFIED'?'fact':'inference',text:`Le signal le plus récent (${named(last)}) ne compte pas pour le moment.`,refs:lastRef});
  else why_now.push({kind:'unknown',text:'Aucun signal sur ce compte.',refs:[]});
 }
 for(const x of c.signals.filter(x=>x.geo.relevance==='MISMATCH'&&x.freshness>0&&!(primary?.kind==='signal'&&primary.signal.signal_id===x.signal_id)&&why_now.every(w=>w.refs.every(r=>r.id!==x.signal_id))))
  why_now.push({kind:'fact',text:`Signal non compté : ${named(x)}, à ${x.geo.place??'un lieu'}, hors de ${zoneName(c.zone)}.`,refs:[{kind:'signal',id:x.signal_id,source_url:x.source_url}]});
 if(target.role)inferred.push({kind:'inference',text:`Rôle cible recommandé : ${target.role} (règle du type de signal, aucune personne identifiée par ce moyen).`,refs:[]});
 if(!target.person)unknown.push({kind:'unknown',text:'Personne cible inconnue : aucune source fiable ne la nomme.',refs:[]});
 return {why_this_account,why_now,why_this_action:[{kind:'rule',text:actionReason(c,rule),refs:[]}],inferred,unknown};
}

// ------------------------------------------------------------
// 6. The opportunity
// ------------------------------------------------------------
export type Opportunity={
 prospect_id:string;project_id:string;recommended_action:NbaAction;rule:RuleId;scores:Scores;
 primary:{kind:'signal';signal_id:string;commercial_type:CommercialSignalType;evidence_status:EvidenceStatus;age_days:number;geo_relevance:GeoRelevance;place:string|null}
  |{kind:'conversation';content_id:string;age_days:number;relevance_reason:string;suggested_angle:string}|null;
 signal_ids:string[];public_content_ids:string[];evidence_ids:string[];
 target:Target;explanation:Explanation;expires_at:string;fingerprint:string;config_version:string;computed_at:string;
};

export function buildOpportunity(input:NbaInput):Opportunity{
 const config=input.config??NBA_DEFAULT_CONFIG;validateConfig(config);
 const zone=icpZoneOf(input.criteria);
 const classified=input.signals.map(s=>classifySignal(s,input.now,config,zone)).filter((x):x is ClassifiedSignal=>!!x);
 const conversation=relevantConversation(input.publicContent,input.profile,input.now);
 const {scores,primary,corroborating}=scoresOf(input,classified,conversation,config);
 const ctx:Ctx={input,scores,primary,signals:classified,conversation,config,zone};
 const rule=RULES.find(r=>r.when(ctx));
 if(!rule)throw new Error(`NBA: no rule applies (FIT state ${scores.fit.profile.state}, level ${scores.fit.profile.level})`);
 // The driver the decision rests on: for ENGAGE the conversation, for CONTACT the best verified contact signal.
 const driver:Driver|null=rule.action==='ENGAGE'&&conversation?{kind:'conversation',conversation}
  :rule.action==='CONTACT'?(()=>{const s=bestContact(ctx,'VERIFIED');return s?{kind:'signal' as const,signal:s}:primary})()
  :rule.id==='SIGNAL_TO_VERIFY'?(()=>{const s=bestContact(ctx,'INFERRED');return s?{kind:'signal' as const,signal:s}:primary})()
  :rule.id==='UNKNOWN_FIT_FRESH_SIGNAL'?(()=>{const s=freshSignal(ctx);return s?{kind:'signal' as const,signal:s}:primary})():primary;
 const roles=driver?.kind==='signal'?[...entryOf(driver.signal.commercial_type).targetRoles]:[];
 const target:Target={role:roles[0]??null,role_alternatives:roles.slice(1),role_basis:roles.length?'signal_type_rule':null,
  person:driver?.kind==='conversation'&&driver.conversation.author?{name:driver.conversation.author,basis:'public_content_author',ref:{kind:'public_content',id:driver.conversation.content_id,source_url:driver.conversation.source_url}}:null};
 const explanation=explain({...ctx,primary:driver},rule.id,target);
 // Expiry: when the driver stops counting (its age reaches the decay's max age, or the ENGAGE window closes); an
 // action with no dated driver is recomputed after the default horizon.
 const nowMs=input.now.getTime();
 const expires=driver?.kind==='signal'?nowMs+Math.max(0,driver.signal.decay.maxAgeDays-driver.signal.age_days)*DAY
  :driver?.kind==='conversation'?nowMs+Math.max(0,(rule.action==='ENGAGE'?config.engage.maxAgeDays:CONVERSATION_DECAY.maxAgeDays)-driver.conversation.age_days)*DAY
  :nowMs+config.defaultHorizonDays*DAY;
 const signal_ids=[...new Set([driver?.kind==='signal'?driver.signal.signal_id:null,...classified.filter(s=>s.timing>0).map(s=>s.signal_id)].filter((x):x is string=>!!x))].slice(0,20);
 const public_content_ids=conversation&&(driver?.kind==='conversation'||conversation.timing>0)?[conversation.content_id]:[];
 const evidence_ids=[...new Set(scores.fit.lines.flatMap(l=>l.ref?[l.ref.id]:[]))].slice(0,50);
 const primaryOut:Opportunity['primary']=driver?.kind==='signal'
  ?{kind:'signal',signal_id:driver.signal.signal_id,commercial_type:driver.signal.commercial_type,evidence_status:driver.signal.evidence_status,age_days:driver.signal.age_days,
   geo_relevance:driver.signal.geo.relevance,place:driver.signal.geo.place}
  :driver?.kind==='conversation'?{kind:'conversation',content_id:driver.conversation.content_id,age_days:driver.conversation.age_days,
   relevance_reason:`Le contenu mentionne « ${driver.conversation.matched} »${driver.conversation.topic?` (${driver.conversation.topic.label.fr})`:''}.`,
   suggested_angle:driver.conversation.topic?.angle.fr??`Intervenir sur « ${driver.conversation.matched} », un sujet de votre offre.`}:null;
 // The engine version is part of the identity: a new version always re-states its reasons, even for the same action.
 const fingerprint=[config.version,rule.action,primaryOut?.kind==='signal'?primaryOut.signal_id:primaryOut?.kind==='conversation'?primaryOut.content_id:'none'].join(':');
 void corroborating;
 return {prospect_id:input.prospect.id,project_id:input.prospect.project_id,recommended_action:rule.action,rule:rule.id,scores,primary:primaryOut,
  signal_ids,public_content_ids,evidence_ids,target,explanation,expires_at:new Date(expires).toISOString(),fingerprint,config_version:config.version,computed_at:input.now.toISOString()};
}

// ------------------------------------------------------------
// 7. Queue and Today — what deserves attention, not everything.
// ------------------------------------------------------------
export const ACTION_PRIORITY:Record<NbaAction,number>={CONTACT:0,ENGAGE:1,WATCH:2,WAIT:3,DISMISS:4};
export type QueueItem={recommended_action:NbaAction;opportunity_score:number;timing_score:number;freshness_score:number;prospect_id:string;state?:NbaState};
// Actionable first (CONTACT, ENGAGE), then by OPPORTUNITY, then TIMING, then FRESHNESS; ties by prospect id.
export const byPriority=(a:QueueItem,b:QueueItem)=>ACTION_PRIORITY[a.recommended_action]-ACTION_PRIORITY[b.recommended_action]
 ||b.opportunity_score-a.opportunity_score||b.timing_score-a.timing_score||b.freshness_score-a.freshness_score||a.prospect_id.localeCompare(b.prospect_id);
// Today: only what a person can act on now (CONTACT, ENGAGE, then WATCH), pending, ranked, capped. Never WAIT or
// DISMISS: "voici les N actions", not "voici tous les leads".
export function todayOf<T extends QueueItem>(items:T[],limit:number,config:NbaConfig=NBA_DEFAULT_CONFIG):T[]{
 const n=Math.max(1,Math.min(config.today.maxLimit,Math.floor(Number.isFinite(limit)?limit:config.today.defaultLimit)));
 return items.filter(i=>(i.state??'PENDING')==='PENDING'&&['CONTACT','ENGAGE','WATCH'].includes(i.recommended_action)).sort(byPriority).slice(0,n);
}

// ------------------------------------------------------------
// 8. Human decisions — the transitions the database enforces too (migration 031).
// ------------------------------------------------------------
export const TRANSITIONS:Record<NbaState,readonly NbaState[]>={
 PENDING:['APPROVED','DONE','SNOOZED','REJECTED','EXPIRED'],
 APPROVED:['DONE','REJECTED','EXPIRED'],
 SNOOZED:['PENDING','REJECTED','EXPIRED'],
 DONE:[],REJECTED:[],EXPIRED:[],
};
export const canTransition=(from:NbaState,to:NbaState)=>TRANSITIONS[from].includes(to);
