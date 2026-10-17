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
 version:'nba-v1-2026-10',
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
export type NbaSignal=IntentSignal&{source_type:string;provider?:string|null;event_key?:string|null};
export type NbaPublicContent={id:string;status:string;source_url:string;source_domain:string|null;author:string|null;content:string;published_at:string|null;observed_at:string};
export type NbaProspect={id:string;project_id:string;name:string;status:string};
export type NbaInput={prospect:NbaProspect;criteria:Criterion[];evidence:EstimateEvidence[];signals:NbaSignal[];publicContent:NbaPublicContent[];
 profile:IntentProfileInput;now:Date;config?:NbaConfig};

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

export function classifySignal(s:NbaSignal,now:Date,config:NbaConfig=NBA_DEFAULT_CONFIG):ClassifiedSignal|null{
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
 return {signal_id:s.id,commercial_type:entry.type,base_type:s.signal_type,basis,matched,evidence_status,confidence:s.confidence,date_basis,age_days:age,decay,
  freshness:round(freshness),timing:round(entry.timingWeight*freshness*factor),quality:round(Math.min(1,s.confidence)*factor),
  affinity:entry.affinity,need:entry.need,source_url:s.source_url,source_domain:s.source_domain,title:s.title,excerpt:s.excerpt};
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
export type Scores={
 fit:{score:number|null;basis:'verified'|'estimated'|'unknown';coverage:number;lines:ScoreLine[]};
 intent:{score:number;estimated:number;lines:ScoreLine[]};
 timing:{score:number;lines:ScoreLine[]};
 freshness:{score:number;lines:ScoreLine[]};
 evidence_quality:{score:number;lines:ScoreLine[]};
 opportunity:{score:number;lines:ScoreLine[]};
};
export type Driver={kind:'signal';signal:ClassifiedSignal}|{kind:'conversation';conversation:Conversation};

function fitOf(input:NbaInput):Scores['fit']{
 const f=estimateFit(input.criteria,input.evidence,input.now);
 const verifiedLines=f.verified.breakdown.filter(b=>b.state==='TRUE').map(b=>({label:b.label,value:b.points,ref:b.evidence_ids[0]?{kind:'evidence' as const,id:b.evidence_ids[0]}:undefined}));
 if(f.verified.coverage>0)return {score:f.verified.score,basis:'verified',coverage:f.verified.coverage,lines:verifiedLines};
 const est=f.estimated.breakdown.filter(b=>b.points>0);
 if(est.length)return {score:f.estimated.score,basis:'estimated',coverage:0,lines:est.map(b=>({label:b.label,value:b.points,ref:b.evidence_ids[0]?{kind:'evidence' as const,id:b.evidence_ids[0]}:undefined}))};
 return {score:null,basis:'unknown',coverage:0,lines:[]};
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
 const fit=fitOf(input);
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
 |'SOME_TIMING'|'FIT_WITHOUT_TIMING'|'NOT_ENOUGH';
type Ctx={input:NbaInput;scores:Scores;primary:Driver|null;signals:ClassifiedSignal[];conversation:Conversation|null;config:NbaConfig};
const fitAtLeast=(c:Ctx,min:number)=>c.scores.fit.score!==null&&c.scores.fit.score>=min;
const bestContact=(c:Ctx,status:EvidenceStatus)=>c.signals.filter(s=>s.affinity==='contact'&&s.evidence_status===status&&s.timing>0).sort((a,b)=>b.timing-a.timing)[0]??null;
export const RULES:readonly {id:RuleId;action:NbaAction;when:(c:Ctx)=>boolean}[]=[
 {id:'CLOSED_PROSPECT',action:'DISMISS',when:c=>c.config.closedStatuses.includes(c.input.prospect.status)},
 {id:'OFF_TARGET',action:'DISMISS',when:c=>c.scores.fit.score!==null&&c.scores.fit.score<c.config.fit.dismissBelow},
 {id:'EXPLICIT_RECENT_NEED',action:'CONTACT',when:c=>{const s=bestContact(c,'VERIFIED');return !!s&&s.need==='explicit'&&s.freshness>=c.config.freshness.explicitNeedMin&&fitAtLeast(c,c.config.fit.contactMin)}},
 {id:'RELEVANT_CONVERSATION',action:'ENGAGE',when:c=>!!c.conversation&&c.conversation.age_days<=c.config.engage.maxAgeDays&&fitAtLeast(c,c.config.fit.engageMin)},
 {id:'CONTACT_SIGNAL',action:'CONTACT',when:c=>{const s=bestContact(c,'VERIFIED');return !!s&&s.freshness>=c.config.freshness.contactMin&&fitAtLeast(c,c.config.fit.contactMin)&&c.scores.timing.score>=c.config.timing.contactMin}},
 {id:'SIGNAL_TO_VERIFY',action:'WATCH',when:c=>{const s=bestContact(c,'INFERRED');return !!s&&s.freshness>=c.config.freshness.inferredWatchMin&&fitAtLeast(c,c.config.fit.watchMin)}},
 {id:'SOME_TIMING',action:'WATCH',when:c=>c.scores.timing.score>=c.config.timing.watchMin&&fitAtLeast(c,c.config.fit.watchMin)},
 {id:'FIT_WITHOUT_TIMING',action:'WAIT',when:c=>fitAtLeast(c,c.config.fit.watchMin)},
 {id:'NOT_ENOUGH',action:'DISMISS',when:()=>true},
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

const ACTION_REASON:Record<RuleId,string>={
 CLOSED_PROSPECT:'Le prospect est déjà clos dans le pipeline (statut {status}) : aucune nouvelle action.',
 OFF_TARGET:'FIT {fit}/100, sous le seuil de {min}/100 : le compte est hors cible.',
 EXPLICIT_RECENT_NEED:'Le besoin est écrit dans une source vérifiée et récent (fraîcheur {fresh} %) : une prise de contact directe est plus pertinente qu’une surveillance.',
 RELEVANT_CONVERSATION:'Une conversation publique pertinente a été publiée {age} : intervenir sur le fond avant toute approche commerciale.',
 CONTACT_SIGNAL:'Un signal vérifié et encore frais (TIMING {timing}/100) donne une raison datée de contacter maintenant.',
 SIGNAL_TO_VERIFY:'Le signal n’a pas encore été vérifié par une personne : le vérifier avant d’agir.',
 SOME_TIMING:'Le compte correspond et un signal existe, mais il n’est pas assez fort ou récent pour une approche (TIMING {timing}/100).',
 FIT_WITHOUT_TIMING:'Bon compte (FIT {fit}/100) mais aucune raison datée d’agir maintenant (TIMING {timing}/100).',
 NOT_ENOUGH:'Ni l’adéquation à l’ICP ni un signal récent ne justifient une action.',
};
const fill=(t:string,v:Record<string,string|number>)=>t.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??''));

function explain(c:Ctx,rule:RuleId,target:Target):Explanation{
 const {scores,primary,input}=c;
 const evidenceRef=(id:string):Ref=>({kind:'evidence',id,source_url:input.evidence.find(e=>e.id===id)?.source_url??null});
 const why_this_account:Statement[]=[];const unknown:Statement[]=[];const inferred:Statement[]=[];
 if(scores.fit.basis==='verified'){
  const labels=scores.fit.lines.map(l=>l.label);
  why_this_account.push({kind:'fact',text:labels.length?`Critères ICP étayés par des preuves vérifiées : ${labels.join(', ')} (FIT ${scores.fit.score}/100).`:`Aucun critère ICP vérifié n’est satisfait (FIT ${scores.fit.score}/100).`,
   refs:scores.fit.lines.flatMap(l=>l.ref?[evidenceRef(l.ref.id)]:[])});
 }else if(scores.fit.basis==='estimated'){
  why_this_account.push({kind:'inference',text:`FIT estimé à ${scores.fit.score}/100 à partir de preuves non vérifiées : ${scores.fit.lines.map(l=>l.label).join(', ')}.`,refs:scores.fit.lines.flatMap(l=>l.ref?[evidenceRef(l.ref.id)]:[])});
 }else unknown.push({kind:'unknown',text:'Adéquation à l’ICP inconnue : aucune preuve sur ce compte.',refs:[]});
 const why_now:Statement[]=[];
 if(primary?.kind==='signal'){
  const s=primary.signal,e=entryOf(s.commercial_type),ref:Ref={kind:'signal',id:s.signal_id,source_url:s.source_url};
  const when=s.date_basis==='observed_only'?`relevé ${ago(s.age_days)} (date du fait inconnue)`:`${s.date_basis==='event'?'daté':'publié'} ${ago(s.age_days)}`;
  why_now.push({kind:s.evidence_status==='VERIFIED'?'fact':'inference',text:`${e.label.fr} : « ${clip(s.excerpt)} » (${[s.source_domain,when].filter(Boolean).join(', ')})${s.evidence_status==='VERIFIED'?'.':' — à vérifier.'}`,refs:[ref]});
  if(s.basis==='explicit_terms')inferred.push({kind:'inference',text:`Type « ${e.label.fr} » déduit des mots « ${s.matched} » écrits dans la source.`,refs:[ref]});
  else inferred.push({kind:'inference',text:`Type « ${e.label.fr} » déduit du type de signal « ${s.base_type} ».`,refs:[ref]});
  if(s.date_basis==='observed_only')unknown.push({kind:'unknown',text:'Date du fait inconnue : seule la date de relevé est connue.',refs:[ref]});
 }else if(primary?.kind==='conversation'){
  const v=primary.conversation,ref:Ref={kind:'public_content',id:v.content_id,source_url:v.source_url};
  why_now.push({kind:'fact',text:`${v.author??'Publication'} ${v.published_at?`le ${day(v.published_at)}`:''} : « ${clip(v.excerpt)} » (${[v.source_domain,ago(v.age_days)].filter(Boolean).join(', ')}).`,refs:[ref]});
  why_now.push({kind:'fact',text:`Pertinence : le contenu mentionne « ${v.matched} »${v.topic?` (${v.topic.label.fr})`:''}.`,refs:[ref]});
 }else{
  // No reason now — but if a signal exists, say which one and why it no longer counts, with its proof.
  const last=[...c.signals].sort((a,b)=>a.age_days-b.age_days)[0];
  if(last)why_now.push({kind:last.evidence_status==='VERIFIED'?'fact':'inference',text:`Le signal le plus récent (${entryOf(last.commercial_type).label.fr}, ${ago(last.age_days)}) ne compte plus : sa durée de vie est de ${last.decay.maxAgeDays} jours.`,
   refs:[{kind:'signal',id:last.signal_id,source_url:last.source_url}]});
  else why_now.push({kind:'unknown',text:'Aucun signal récent : rien ne justifie d’agir maintenant.',refs:[]});
 }
 if(target.role)inferred.push({kind:'inference',text:`Rôle cible recommandé : ${target.role} (règle du type de signal, aucune personne identifiée par ce moyen).`,refs:[]});
 if(!target.person)unknown.push({kind:'unknown',text:'Personne cible inconnue : aucune source fiable ne la nomme.',refs:[]});
 const fresh=primary?.kind==='signal'?Math.round(primary.signal.freshness*100):primary?.kind==='conversation'?Math.round(primary.conversation.freshness*100):0;
 const reason=fill(ACTION_REASON[rule],{status:input.prospect.status,fit:scores.fit.score??'—',min:c.config.fit.dismissBelow,fresh,timing:scores.timing.score,
  age:primary?.kind==='conversation'?ago(primary.conversation.age_days):''});
 return {why_this_account,why_now,why_this_action:[{kind:'rule',text:reason,refs:[]}],inferred,unknown};
}

// ------------------------------------------------------------
// 6. The opportunity
// ------------------------------------------------------------
export type Opportunity={
 prospect_id:string;project_id:string;recommended_action:NbaAction;rule:RuleId;scores:Scores;
 primary:{kind:'signal';signal_id:string;commercial_type:CommercialSignalType;evidence_status:EvidenceStatus;age_days:number}
  |{kind:'conversation';content_id:string;age_days:number;relevance_reason:string;suggested_angle:string}|null;
 signal_ids:string[];public_content_ids:string[];evidence_ids:string[];
 target:Target;explanation:Explanation;expires_at:string;fingerprint:string;config_version:string;computed_at:string;
};

export function buildOpportunity(input:NbaInput):Opportunity{
 const config=input.config??NBA_DEFAULT_CONFIG;validateConfig(config);
 const classified=input.signals.map(s=>classifySignal(s,input.now,config)).filter((x):x is ClassifiedSignal=>!!x);
 const conversation=relevantConversation(input.publicContent,input.profile,input.now);
 const {scores,primary,corroborating}=scoresOf(input,classified,conversation,config);
 const ctx:Ctx={input,scores,primary,signals:classified,conversation,config};
 const rule=RULES.find(r=>r.when(ctx))!;
 // The driver the decision rests on: for ENGAGE the conversation, for CONTACT the best verified contact signal.
 const driver:Driver|null=rule.action==='ENGAGE'&&conversation?{kind:'conversation',conversation}
  :rule.action==='CONTACT'?(()=>{const s=bestContact(ctx,'VERIFIED');return s?{kind:'signal' as const,signal:s}:primary})()
  :rule.id==='SIGNAL_TO_VERIFY'?(()=>{const s=bestContact(ctx,'INFERRED');return s?{kind:'signal' as const,signal:s}:primary})():primary;
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
  ?{kind:'signal',signal_id:driver.signal.signal_id,commercial_type:driver.signal.commercial_type,evidence_status:driver.signal.evidence_status,age_days:driver.signal.age_days}
  :driver?.kind==='conversation'?{kind:'conversation',content_id:driver.conversation.content_id,age_days:driver.conversation.age_days,
   relevance_reason:`Le contenu mentionne « ${driver.conversation.matched} »${driver.conversation.topic?` (${driver.conversation.topic.label.fr})`:''}.`,
   suggested_angle:driver.conversation.topic?.angle.fr??`Intervenir sur « ${driver.conversation.matched} », un sujet de votre offre.`}:null;
 const fingerprint=[rule.action,primaryOut?.kind==='signal'?primaryOut.signal_id:primaryOut?.kind==='conversation'?primaryOut.content_id:'none'].join(':');
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
