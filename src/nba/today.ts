// Zero-Friction ZF1 — "Aujourd'hui": stored Next Best Action rows → cards in human language. Pure, deterministic, and
// faithful to the engine: it never changes an action, a score or a threshold, it only chooses how to SAY the engine's
// state. Every sentence comes from the row (primary signal, FIT profile, explanation, target); nothing is invented.
//   Level 1  who, action, why this company, why now, what is left to verify.
//   Level 2  favourable elements, missing information, timing, place.
//   Level 3  scores, coverage, rule, statements with their provenance (advanced).
// WAIT and DISMISS never take space: they are counted. 0 CONTACT is a valid day.
import {REGISTRY} from './registry.ts';
import type {Statement} from './engine.ts';

export type TodayRow={id:string;prospect_id:string;recommended_action:'CONTACT'|'ENGAGE'|'WATCH'|'WAIT'|'DISMISS';rule:string;state:string;
 opportunity_score:number;fit_score:number|null;fit_basis:string;intent_score:number;timing_score:number;freshness_score:number;evidence_quality_score:number;
 primary_kind:string|null;primary_signal_type:string|null;primary_evidence_status:string|null;signal_age_days:number|null;
 primary_detail:{signal_id?:string;geo_relevance?:string;place?:string|null;content_id?:string;relevance_reason?:string;suggested_angle?:string}|null;
 scores?:{fit?:{profile?:{state?:string;coverage?:number;supporting?:string[];missing?:string[];against?:string[]};lines?:{label:string}[]}}|null;
 target?:{role:string|null;person:{name:string}|null}|null;
 explanation:{why_this_account:Statement[];why_now:Statement[];why_this_action:Statement[];inferred:Statement[];unknown:Statement[]};
 prepared_content?:{kind:string}|null;computed_at?:string;prospects?:{name:string}|null};

export type TodaySection='contact'|'verify'|'engage'|'watch';
export type PrimaryAction={kind:'PREPARE_MESSAGE'|'OPEN_CONVERSATION'|'VERIFY_SIGNAL'|'VERIFY_INFORMATION'|'NONE';signalId?:string|null};
export type TodayCard={id:string;prospectId:string;name:string;section:TodaySection;action:TodayRow['recommended_action'];primary:PrimaryAction;
 whyNow:string|null;whyCompany:string;toVerify:string[];proof:{text:string;url:string|null}|null;
 details:{favourable:string[];missing:string[];timing:string|null;place:string|null};
 advanced:{rule:string;scores:{label:string;value:string}[];statements:Statement[]}};
export type TodayModel={sections:Record<TodaySection,TodayCard[]>;hidden:{wait:number;dismiss:number};watched:number;total:number};

const SECTION_ORDER:TodaySection[]=['contact','verify','engage','watch'];
const label=(t:string|null)=>t?REGISTRY.find(e=>e.type===t)?.label.fr??null:null;
const ago=(d:number)=>d<=0?'aujourd’hui':d===1?'il y a 1 jour':`il y a ${d} jours`;
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();

function whyNowOf(r:TodayRow):string|null{
 if(r.primary_kind==='conversation')return r.signal_age_days===null?'Une conversation publique pertinente.':`Une conversation publique pertinente, ${ago(r.signal_age_days)}.`;
 if(r.primary_kind!=='signal')return null;
 const what=label(r.primary_signal_type)??'Un signal';
 const place=r.primary_detail?.geo_relevance==='MATCH'&&r.primary_detail.place?` à ${r.primary_detail.place}`:'';
 const when=r.signal_age_days===null?'':`, ${ago(r.signal_age_days)}`;
 return `${what}${place}${when}.`;
}
function proofOf(r:TodayRow):TodayCard['proof']{
 const s=r.explanation.why_now.find(x=>x.refs.some(ref=>ref.kind==='signal'||ref.kind==='public_content'));
 if(!s)return null;
 return {text:clean(s.text),url:s.refs.find(ref=>ref.source_url)?.source_url??null};
}
function missingOf(r:TodayRow):string[]{
 const p=r.scores?.fit?.profile;
 if(p?.missing?.length)return [...p.missing];
 // Rows computed before v1.3 carry no profile: say only what the explanation says is unknown about the ICP.
 return r.explanation.unknown.filter(u=>/ICP/.test(u.text)).map(u=>clean(u.text));
}
export function primaryActionOf(r:TodayRow):PrimaryAction{
 if(r.recommended_action==='CONTACT')return {kind:'PREPARE_MESSAGE'};
 if(r.recommended_action==='ENGAGE')return {kind:'OPEN_CONVERSATION'};
 if(r.recommended_action!=='WATCH')return {kind:'NONE'};
 // The engine marks the driving signal INFERRED: a person checking it is exactly what the WATCH rules wait for.
 if(r.primary_kind==='signal'&&r.primary_evidence_status==='INFERRED')return {kind:'VERIFY_SIGNAL',signalId:r.primary_detail?.signal_id??null};
 const state=r.scores?.fit?.profile?.state;
 if(state==='UNKNOWN'||state==='INCOMPLETE'||(!state&&missingOf(r).length))return {kind:'VERIFY_INFORMATION'};
 return {kind:'NONE'};
}
export function cardOf(r:TodayRow):TodayCard{
 const primary=primaryActionOf(r);
 const p=r.scores?.fit?.profile;
 const favourable=p?.supporting?.length?[...p.supporting]:(r.scores?.fit?.lines??[]).map(l=>l.label);
 const missing=missingOf(r);
 const toVerify=[...(primary.kind==='VERIFY_SIGNAL'?['Le signal lui-même : sa source n’a pas encore été vérifiée.']:[]),...(primary.kind==='VERIFY_INFORMATION'||primary.kind==='VERIFY_SIGNAL'?missing:[])];
 const section:TodaySection=r.recommended_action==='CONTACT'?'contact':r.recommended_action==='ENGAGE'?'engage':primary.kind==='NONE'?'watch':'verify';
 const whyCompany=favourable.length?`Correspond à votre cible : ${favourable.join(' ; ')}.`:p?.state==='UNKNOWN'||!p?'Correspondance à votre cible pas encore documentée.':'Correspondance à votre cible partiellement documentée.';
 const place=r.primary_detail?.place??null;
 return {id:r.id,prospectId:r.prospect_id,name:r.prospects?.name??'—',section,action:r.recommended_action,primary,whyNow:whyNowOf(r),whyCompany,toVerify,proof:proofOf(r),
  details:{favourable,missing,timing:r.signal_age_days===null?null:`Signal ${ago(r.signal_age_days)}`,place:place?`${place}${r.primary_detail?.geo_relevance==='MATCH'?' — dans votre zone':''}`:null},
  advanced:{rule:r.rule,scores:[['Opportunité',r.opportunity_score],['FIT',r.fit_score===null?'—':`${r.fit_score} (${r.fit_basis})`],['Couverture ICP',p?.coverage===undefined?'—':`${p.coverage} %`],
   ['INTENT',r.intent_score],['TIMING',r.timing_score],['Fraîcheur',r.freshness_score],['Qualité de preuve',r.evidence_quality_score]].map(([l,v])=>({label:String(l),value:String(v)})),
   statements:[...r.explanation.why_this_account,...r.explanation.why_now,...r.explanation.why_this_action,...r.explanation.inferred,...r.explanation.unknown]}};
}
// Only PENDING recommendations are today's; within a section, the engine's own ranking (opportunity) is kept.
export function buildTodayModel(rows:TodayRow[]):TodayModel{
 const pending=rows.filter(r=>r.state==='PENDING');
 const sections:Record<TodaySection,TodayCard[]>={contact:[],verify:[],engage:[],watch:[]};
 for(const r of [...pending].sort((a,b)=>b.opportunity_score-a.opportunity_score||a.prospect_id.localeCompare(b.prospect_id))){
  if(r.recommended_action==='WAIT'||r.recommended_action==='DISMISS')continue;
  const c=cardOf(r);sections[c.section].push(c);
 }
 const wait=pending.filter(r=>r.recommended_action==='WAIT').length,dismiss=pending.filter(r=>r.recommended_action==='DISMISS').length;
 return {sections,hidden:{wait,dismiss},watched:sections.watch.length+sections.verify.length+wait,total:SECTION_ORDER.reduce((t,s)=>t+sections[s].length,0)};
}
export {SECTION_ORDER};
