// Today 2.0 (UI-3, docs/UI_V2.md) — presentation model only. Built on top of the ZF1 model (src/nba/today.ts:
// buildTodayModel / cardOf) from the same stored NBA rows: nothing here changes an action, a score, a threshold or the
// engine's order. It only splits what the card already says into the V2 hierarchy:
//   Level 1  company · signal (TYPE · place · age) · status · one short explanation · one action · "Voir pourquoi"
//   Level 2  signal, source, freshness (age), place, favourable elements, missing information — never a score
//   Level 3  scores, coverage, rule, evidence states, statements with their provenance, raw place
import {buildTodayModel,cardOf,SECTION_ORDER,type TodayCard,type TodayRow,type TodaySection,type PrimaryAction} from '../../../nba/today.ts';
import {REGISTRY} from '../../../nba/registry.ts';
import {placeName} from '../../../ux/place-phrase.ts';
import {translate,type TKey} from '../../../i18n/index.ts';
import type {Statement} from '../../../nba/engine.ts';
import {statusForSection,type UiStatus} from '../status.ts';
import type {Locale} from '../../../i18n/locale.ts';

export type V2Signal={kind:'signal'|'conversation';type:string;place:string|null;age:string|null};
export type V2ActionTone='contact'|'primary';
export type V2Action={kind:PrimaryAction['kind'];label:string|null;tone:V2ActionTone|null;signalId:string|null};
export type V2Card={
 id:string;prospectId:string;name:string;initial:string;section:TodaySection;status:UiStatus;
 signal:V2Signal|null;explanation:string;note:string|null;action:V2Action;
 level2:{source:{label:string;url:string|null}|null;proof:string|null;freshness:string|null;place:string|null;favourable:string[];missing:string[]};
 level3:{scores:{label:string;value:string}[];rule:string;evidence:{label:string;value:string}[];statements:Statement[]};
};
// watched: what the "en veille" chip counts (ZF1.1: WATCH with nothing to do + WAIT) — the cards that filter shows.
// counts.document: accounts "à documenter" (v1.3.x, hidden.document) — a plain count, never a card nor a filter.
export type V2Today={cards:V2Card[];watched:V2Card[];counts:{contact:number;verify:number;engage:number;watched:number;document:number};total:number};

const ACTION_KEY:Record<Exclude<PrimaryAction['kind'],'NONE'>,TKey>={PREPARE_MESSAGE:'today.action.prepare',OPEN_CONVERSATION:'today.action.conversation',
 VERIFY_SIGNAL:'today.action.verifySignal',VERIFY_INFORMATION:'today.action.completeInfo'};

export function ageText(days:number|null,locale:Locale):string|null{
 if(days===null)return null;
 if(locale==='fr')return days<=0?'aujourd’hui':days===1?'il y a 1 jour':`il y a ${days} jours`;
 return days<=0?'today':days===1?'1 day ago':`${days} days ago`;
}
const safeUrl=(u:string|null|undefined)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};
export function sourceLabel(u:string|null):string|null{
 const h=safeUrl(u);if(!h)return null;
 return new URL(h).hostname.replace(/^www\./,'');
}

function signalOf(r:TodayRow,locale:Locale):V2Signal|null{
 const age=ageText(r.signal_age_days,locale);
 const place=r.primary_detail?.place?placeName(r.primary_detail.place):null;
 if(r.primary_kind==='conversation')return {kind:'conversation',type:locale==='fr'?'Conversation publique':'Public conversation',place:null,age};
 if(r.primary_kind!=='signal')return null;
 const entry=r.primary_signal_type?REGISTRY.find(e=>e.type===r.primary_signal_type):undefined;
 return {kind:'signal',type:entry?.label[locale]??(locale==='fr'?'Signal':'Signal'),place,age};
}

// The short line under the explanation: what is missing, in one sentence, never a list (the list is level 2).
function noteOf(c:TodayCard,locale:Locale):string|null{
 if(c.primary.kind==='VERIFY_SIGNAL')return c.missingSummary;
 const fitMissing=c.details.missing.length;
 if(c.primary.kind!=='VERIFY_INFORMATION'||fitMissing===0)return null;
 if(locale==='fr')return fitMissing===1?'1 information à documenter.':`${fitMissing} informations à documenter.`;
 return fitMissing===1?'1 piece of information to document.':`${fitMissing} pieces of information to document.`;
}

export function v2CardOf(c:TodayCard,r:TodayRow,locale:Locale):V2Card{
 const profile=r.scores?.fit?.profile;
 const kind=c.primary.kind;
 const action:V2Action={kind,label:kind==='NONE'?null:translate(locale,ACTION_KEY[kind]),
  tone:kind==='NONE'?null:kind==='PREPARE_MESSAGE'?'contact':'primary',signalId:c.primary.signalId??null};
 const src=c.proof?.url??null;
 return {
  id:c.id,prospectId:c.prospectId,name:c.name,initial:(c.name.trim()[0]??'?').toUpperCase(),section:c.section,status:statusForSection(c.section),
  signal:signalOf(r,locale),explanation:c.whyCompany,note:noteOf(c,locale),action,
  level2:{source:src||c.proof?{label:sourceLabel(src)??(locale==='fr'?'source non liée':'no linked source'),url:safeUrl(src)}:null,proof:c.proof?.text??null,
   freshness:c.details.timing,place:c.details.place,favourable:c.details.favourable,missing:c.details.missing},
  level3:{scores:c.advanced.scores,rule:c.advanced.rule,
   evidence:[['Signal',r.primary_evidence_status??'—'],['FIT',profile?.state??'—'],['Base FIT',r.fit_basis||'—']].map(([label,value])=>({label:label!,value:value!})),
   statements:c.advanced.statements},
 };
}

// Engine order kept: sections in ZF1 order, each in the engine's own ranking (buildTodayModel).
export function todayV2(rows:TodayRow[],locale:Locale):V2Today{
 const m=buildTodayModel(rows);
 const byId=new Map(rows.map(r=>[r.id,r]));
 const cards=SECTION_ORDER.flatMap(s=>m.sections[s].map(c=>v2CardOf(c,byId.get(c.id)!,locale)));
 // WAIT never takes space in the default view (ZF1), but the "en veille" filter must show every company its chip counts:
 // the WATCH cards with nothing to do, then the PENDING WAIT rows in the engine's own ranking (same order as buildTodayModel).
 const waiting=rows.filter(r=>r.state==='PENDING'&&r.recommended_action==='WAIT')
  .sort((a,b)=>b.opportunity_score-a.opportunity_score||a.prospect_id.localeCompare(b.prospect_id)).map(r=>v2CardOf(cardOf(r),r,locale));
 const watched=[...cards.filter(c=>c.section==='watch'),...waiting];
 return {cards,watched,counts:{contact:m.sections.contact.length,verify:m.sections.verify.length,engage:m.sections.engage.length,watched:m.watched,document:m.hidden.document},total:m.total};
}
