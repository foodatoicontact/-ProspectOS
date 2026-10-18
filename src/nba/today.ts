// Zero-Friction ZF1 — "Aujourd'hui": stored Next Best Action rows → cards in human language. Pure, deterministic, and
// faithful to the engine: it never changes an action, a score or a threshold, it only chooses how to SAY the engine's
// state. Every sentence comes from the row (primary signal, FIT profile, explanation, target); nothing is invented.
//   Level 1  who, status, why now, why this company (one sentence), what is missing (short summary), one action —
//            readable in about 3 seconds (ZF1.1: the full list of missing criteria moved to level 2).
//   Level 2  favourable elements, the complete missing information, timing, place, proof and source.
//   Level 3  scores, coverage, rule, statements with their provenance (advanced).
// WAIT and DISMISS never take space: they are counted. 0 CONTACT is a valid day. A DISMISS whose FIT is not documented
// (v1.3.x FIT_UNKNOWN_NO_TIMING / FIT_INCOMPLETE_NO_TIMING) is counted apart, "à documenter": not rejected.
import {REGISTRY} from './registry.ts';
import {placeName,placePhrase} from '../ux/place-phrase.ts';
import type {Statement} from './engine.ts';

export type TodayRow={id:string;prospect_id:string;recommended_action:'CONTACT'|'ENGAGE'|'WATCH'|'WAIT'|'DISMISS';rule:string;state:string;
 opportunity_score:number;fit_score:number|null;fit_basis:string;intent_score:number;timing_score:number;freshness_score:number;evidence_quality_score:number;
 primary_kind:string|null;primary_signal_type:string|null;primary_evidence_status:string|null;signal_age_days:number|null;
 primary_detail:{signal_id?:string;geo_relevance?:string;place?:string|null;content_id?:string;relevance_reason?:string;suggested_angle?:string}|null;
 scores?:{fit?:{profile?:{state?:string;coverage?:number;supporting?:string[];missing?:string[];against?:string[];verified_supporting?:string[];declared?:string[];declared_false?:string[];verified_score?:number};lines?:{label:string}[]}}|null;
 target?:{role:string|null;person:{name:string}|null}|null;
 explanation:{why_this_account:Statement[];why_now:Statement[];why_this_action:Statement[];inferred:Statement[];unknown:Statement[]};
 prepared_content?:{kind:string}|null;computed_at?:string;prospects?:{name:string}|null};

export type TodaySection='contact'|'verify'|'engage'|'watch';
export type PrimaryAction={kind:'PREPARE_MESSAGE'|'OPEN_CONVERSATION'|'VERIFY_SIGNAL'|'VERIFY_INFORMATION'|'NONE';signalId?:string|null};
export type TodayCard={id:string;prospectId:string;name:string;section:TodaySection;action:TodayRow['recommended_action'];primary:PrimaryAction;
 whyNow:string|null;whyCompany:string;missingSummary:string|null;proof:{text:string;url:string|null}|null;
 // UI-4: verified = the favourable criteria a person verified with a source (null on rows stored before UI-4: unknown);
 // declared / declaredFalse = what the person declared without a source — never shown as verified.
 details:{favourable:string[];missing:string[];timing:string|null;place:string|null;verified:string[]|null;declared:string[];declaredFalse:string[]};
 advanced:{rule:string;scores:{label:string;value:string}[];statements:Statement[]}};
// watched = companies we keep an eye on WITHOUT asking anything of the user (WATCH with nothing to check, WAIT): never the
// cards already counted "à vérifier" — each company appears once in the summary.
// hidden.document: accounts the engine cannot judge yet (FIT not documented, nothing fresh) — never a card, never "en veille",
// never counted with the accounts really set aside (hidden.dismiss).
export type TodayModel={sections:Record<TodaySection,TodayCard[]>;hidden:{wait:number;dismiss:number;document:number};watched:number;total:number};
export type HiddenKind='wait'|'dismiss'|'document';
const DOCUMENT_RULES=new Set(['FIT_UNKNOWN_NO_TIMING','FIT_INCOMPLETE_NO_TIMING']);
// Where a row that takes no card is counted. Rows stored before v1.3.x carry rule NOT_ENOUGH (never rewritten): their
// stored FIT state says which it was — UNKNOWN / INCOMPLETE to document, KNOWN_LOW (or no state) set aside.
export function hiddenKindOf(r:Pick<TodayRow,'recommended_action'|'rule'|'scores'>):HiddenKind|null{
 if(r.recommended_action==='WAIT')return 'wait';
 if(r.recommended_action!=='DISMISS')return null;
 if(DOCUMENT_RULES.has(r.rule))return 'document';
 if(r.rule==='NOT_ENOUGH'){const st=r.scores?.fit?.profile?.state;return st==='UNKNOWN'||st==='INCOMPLETE'?'document':'dismiss'}
 return 'dismiss';
}

const SECTION_ORDER:TodaySection[]=['contact','verify','engage','watch'];
const label=(t:string|null)=>t?REGISTRY.find(e=>e.type===t)?.label.fr??null:null;
const ago=(d:number)=>d<=0?'aujourd’hui':d===1?'il y a 1 jour':`il y a ${d} jours`;
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();

function whyNowOf(r:TodayRow):string|null{
 if(r.primary_kind==='conversation')return r.signal_age_days===null?'Une conversation publique pertinente.':`Une conversation publique pertinente, ${ago(r.signal_age_days)}.`;
 if(r.primary_kind!=='signal')return null;
 const what=label(r.primary_signal_type)??'Un signal';
 const place=r.primary_detail?.geo_relevance==='MATCH'&&r.primary_detail.place?` ${placePhrase(r.primary_detail.place)}`:'';
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
// The verified FIT a CONTACT needs (NBA_DEFAULT_CONFIG.fit.contactMin, kept equal by tests/user-declared-guidance.test.ts):
// a constant here so the client never loads the engine.
export const CONTACT_VERIFIED_FIT_MIN=60;
// UI-4: criteria still unknown — neither verified, nor declared by the person (a criterion declared NOT met is answered).
export function undocumentedOf(r:TodayRow):string[]{
 const p=r.scores?.fit?.profile;const answered=new Set(p?.declared_false??[]);
 return (p?.missing??[]).filter(m=>!answered.has(m));
}
export function primaryActionOf(r:TodayRow):PrimaryAction{
 if(r.recommended_action==='CONTACT')return {kind:'PREPARE_MESSAGE'};
 if(r.recommended_action==='ENGAGE')return {kind:'OPEN_CONVERSATION'};
 if(r.recommended_action!=='WATCH')return {kind:'NONE'};
 // The engine marks the driving signal INFERRED: a person checking it is exactly what the WATCH rules wait for.
 if(r.primary_kind==='signal'&&r.primary_evidence_status==='INFERRED')return {kind:'VERIFY_SIGNAL',signalId:r.primary_detail?.signal_id??null};
 const state=r.scores?.fit?.profile?.state;
 if(state==='UNKNOWN'||state==='INCOMPLETE'||(!state&&missingOf(r).length))return {kind:'VERIFY_INFORMATION'};
 // UI-4: a FIT made SUFFICIENT by the person's own declarations is not a documented one. While criteria stay unknown and the
 // verified FIT is below what CONTACT needs, keep asking to complete them — the only road to CONTACT is verified evidence.
 // Without any declaration, or with a verified FIT already enough, nothing changes.
 const p=r.scores?.fit?.profile;
 if(state==='SUFFICIENT'&&p?.declared?.length&&undocumentedOf(r).length&&typeof p.verified_score==='number'&&p.verified_score<CONTACT_VERIFIED_FIT_MIN)return {kind:'VERIFY_INFORMATION'};
 return {kind:'NONE'};
}
export function cardOf(r:TodayRow):TodayCard{
 const primary=primaryActionOf(r);
 const p=r.scores?.fit?.profile;
 const favourable=p?.supporting?.length?[...p.supporting]:(r.scores?.fit?.lines??[]).map(l=>l.label);
 const missing=missingOf(r);
 const signalLine=primary.kind==='VERIFY_SIGNAL'?['Le signal lui-même : sa source n’a pas encore été vérifiée.']:[];
 const section:TodaySection=r.recommended_action==='CONTACT'?'contact':r.recommended_action==='ENGAGE'?'engage':primary.kind==='NONE'?'watch':'verify';
 // One sentence, never a list: the criteria themselves are in level 2. A partial FIT is never presented as a full match.
 const whyCompany=!p?(favourable.length?'Correspond à votre cible sur les critères vérifiés.':'Correspondance à votre cible pas encore documentée.')
  :p.state==='SUFFICIENT'?'Correspond à votre cible.'
  :favourable.length?'Correspond à votre cible sur les critères déjà vérifiés.'
  :p.state==='UNKNOWN'?'Correspondance à votre cible pas encore documentée.':'Correspondance à votre cible partiellement documentée.';
 // Honest and non-causal: the engine does not know which single fact would change the decision (ZF5), so this never names one.
 const missingSummary=primary.kind==='VERIFY_SIGNAL'?'Le signal doit être vérifié avant toute décision.'
  :primary.kind==='VERIFY_INFORMATION'?'Des informations manquent encore avant de décider si ce compte doit être contacté.':null;
 const place=r.primary_detail?.place??null;
 return {id:r.id,prospectId:r.prospect_id,name:r.prospects?.name??'—',section,action:r.recommended_action,primary,whyNow:whyNowOf(r),whyCompany,missingSummary,proof:proofOf(r),
  details:{favourable,missing:[...signalLine,...missing],verified:p?.verified_supporting?[...p.verified_supporting]:null,declared:[...(p?.declared??[])],declaredFalse:[...(p?.declared_false??[])],timing:r.signal_age_days===null?null:`Signal ${ago(r.signal_age_days)}`,place:place?`${placeName(place)}${r.primary_detail?.geo_relevance==='MATCH'?' — dans votre zone':''}`:null},
  advanced:{rule:r.rule,scores:[['Opportunité',r.opportunity_score],['FIT',r.fit_score===null?'—':`${r.fit_score} (${r.fit_basis})`],['Couverture ICP',p?.coverage===undefined?'—':`${p.coverage} %`],
   ['INTENT',r.intent_score],['TIMING',r.timing_score],['Fraîcheur',r.freshness_score],['Qualité de preuve',r.evidence_quality_score],...(place?[['Lieu (données)',place]]:[])].map(([l,v])=>({label:String(l),value:String(v)})),
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
 const hidden={wait:0,dismiss:0,document:0};
 for(const r of pending){const k=hiddenKindOf(r);if(k)hidden[k]++}
 return {sections,hidden,watched:sections.watch.length+hidden.wait,total:SECTION_ORDER.reduce((t,s)=>t+sections[s].length,0)};
}
export {SECTION_ORDER};
