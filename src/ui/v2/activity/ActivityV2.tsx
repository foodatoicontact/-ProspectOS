'use client';
// Activité 2.0 (UI-5C, docs/UI_V2.md) — the v2 "Activité" entry. Rendered by the v2 shell only (UI_V2_ENABLED); flag OFF,
// app/page.tsx renders the legacy screens exactly as before. "Activité" leads to the screen that already exists for the
// account (nav.ts): "À faire" (Next Best Action) when it is on, else the overview of the pipeline.
// - ActionsNative: the NBA list, rendered by ActionsPanel through its `view` prop — the panel's own state, calls and human
//   decisions (Valider, Fait, Reporter 7 j, Rejeter, Recalculer, filtres). One compact row per action: what to do, on which
//   company, why now, when; the explanation, the prepared content and the indicators stay one tap away ("Détails").
// - ActivityOverview: the same figures and pipeline as the legacy dashboard; a status opens the filtered prospects list.
// Nothing here calls the API, computes a score or decides.
import {useState,type ReactNode} from 'react';
import './activity.css';
import type {Locale} from '../../../i18n/locale.ts';
import {translate,type TKey} from '../../../i18n/index.ts';
import type {ActionRow,ActionsView} from '../../../components/ActionsPanel.tsx';
import {SECTIONS,typeLabel} from '../../../components/ActionsPanel.tsx';
import {COMMERCIAL_SIGNAL_TYPES} from '../../../nba/registry.ts';
import type {Statement} from '../../../nba/engine.ts';
import {Button,Icon} from '../primitives.tsx';

export const ACTIVITY_TEXT:Record<Locale,{title:string;introActions:string;introOverview:string;dismiss:string;details:string;filters:string;
 indicators:string;opportunity:string;open:string;more:(n:number)=>string;empty:string;pipeline:string;figures:string}>={
 fr:{title:'Activité',introActions:'Ce qui mérite votre attention : quelle entreprise, pourquoi maintenant, et depuis quand. Rien n’est envoyé sans vous.',
  introOverview:'Où en sont vos prospects. Chaque statut est une décision de votre part.',dismiss:'Fermer le message',details:'Détails',
  filters:'Filtrer',indicators:'Indicateurs',opportunity:'Opportunité',open:'Ouvrir la fiche',more:n=>`${n} de plus`,empty:'Rien ici pour l’instant.',
  pipeline:'Votre pipeline',figures:'En chiffres'},
 en:{title:'Activity',introActions:'What deserves your attention: which company, why now, and since when. Nothing is sent without you.',
  introOverview:'Where your prospects stand. Every status is your decision.',dismiss:'Dismiss message',details:'Details',
  filters:'Filter',indicators:'Indicators',opportunity:'Opportunity',open:'Open the record',more:n=>`${n} more`,empty:'Nothing here yet.',
  pipeline:'Your pipeline',figures:'At a glance'},
};

export type ActivityV2Props={locale:Locale;intro:'actions'|'overview';
 top:ReactNode;notice:string;onDismissNotice:()=>void;paywall:{text:string;action:string;onAction:()=>void;onDismiss:()=>void}|null;children:ReactNode};

export function ActivityV2(p:ActivityV2Props){
 const t=ACTIVITY_TEXT[p.locale];
 return <div className="pos-activity" data-testid="activity-v2">
  <div className="pos-activity__main">
   {p.top}
   {p.paywall&&<div className="pos-banner pos-banner--verify" role="status"><p>{p.paywall.text}</p>
    <Button variant="primary" size="sm" onClick={p.paywall.onAction}>{p.paywall.action}</Button>
    <Button variant="quiet" size="sm" aria-label={t.dismiss} onClick={p.paywall.onDismiss}><Icon name="close" size={16}/></Button></div>}
   {p.notice&&<div className="pos-banner" role="status"><p>{p.notice}</p>
    <Button variant="quiet" size="sm" aria-label={t.dismiss} onClick={p.onDismissNotice}><Icon name="close" size={16}/></Button></div>}
   <header className="pos-activity__head">
    <h2 className="pos-activity__title">{t.title}</h2>
    <p className="pos-activity__intro">{p.intro==='actions'?t.introActions:t.introOverview}</p>
   </header>
   {p.children}
  </div>
 </div>;
}

// ── À faire (Next Best Action) ─────────────────────────────────────────────────────────────────────────────────────────
const ACTION_TONE:Record<string,'contact'|'engage'|'watch'|'wait'>={CONTACT:'contact',ENGAGE:'engage',WATCH:'watch',WAIT:'wait'};
const safeHref=(u:string|null)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};

function Statements({items,locale}:{items:Statement[];locale:Locale}){
 const tr=(k:TKey)=>translate(locale,k);
 return <ul className="pos-astatements">{items.map((s,i)=><li key={i}>
  {s.kind!=='fact'&&<span className={`pos-akind pos-akind--${s.kind}`}>{tr(`nba.kind.${s.kind}` as TKey)}</span>}{s.text}
  {s.refs.map(r=>{const href=safeHref(r.source_url);return href?<a key={r.id} href={href} target="_blank" rel="noreferrer">{tr('nba.openSource')}<Icon name="external" size={12}/></a>:null})}</li>)}</ul>;
}

function ActionItem({row,m}:{row:ActionRow;m:ActionsView}){
 const {locale}=m;const tr=(k:TKey)=>translate(locale,k);const t=ACTIVITY_TEXT[locale];
 const [copied,setCopied]=useState('');
 const copy=async(text:string,key:string)=>{try{await navigator.clipboard.writeText(text);setCopied(key)}catch{setCopied('')}};
 const tone=ACTION_TONE[row.recommended_action]??'wait';
 const what=row.primary_kind==='conversation'?tr('nba.publicConversation'):typeLabel(row.primary_signal_type,locale)??tr('nba.noSignal');
 const age=row.signal_age_days===null?null:row.signal_age_days<=0?tr('nba.today'):tr('nba.daysAgo').replace('{n}',String(row.signal_age_days));
 const why=row.explanation.why_now[0];const p=row.prepared_content;
 return <li className={`pos-aitem pos-aitem--${tone}`}>
  <div className="pos-aitem__top">
   <span className={`pos-achip pos-achip--${tone}`}>{tr(`nba.action.${row.recommended_action}` as TKey)}</span>
   <span className="pos-aitem__when">{what}{age?` · ${age}`:''}</span>
   {row.primary_evidence_status==='INFERRED'&&<span className="pos-achip pos-achip--verify">{tr('nba.toVerify')}</span>}
  </div>
  <button type="button" className="pos-aitem__who" onClick={()=>m.onOpenProspect(row.prospect_id)} aria-label={`${t.open} : ${row.prospects?.name??'—'}`}>
   <span>{row.prospects?.name??'—'}</span><Icon name="chevron-right" size={16}/></button>
  {why&&<p className="pos-aitem__why">{why.kind!=='fact'&&<span className={`pos-akind pos-akind--${why.kind}`}>{tr(`nba.kind.${why.kind}` as TKey)}</span>}{why.text}</p>}
  <div className="pos-aitem__actions">
   <Button variant="primary" size="sm" disabled={m.busy} onClick={()=>m.decide(row.id,{decision:'APPROVED',human_action:row.recommended_action})}>{tr('nba.approve')}</Button>
   <Button variant="secondary" size="sm" disabled={m.busy} onClick={()=>m.decide(row.id,{decision:'DONE',human_action:row.recommended_action})}>{tr('nba.done')}</Button>
   <Button variant="quiet" size="sm" disabled={m.busy} onClick={()=>m.decide(row.id,{decision:'SNOOZED',snooze_days:7})}>{tr('nba.snooze7')}</Button>
   <Button variant="quiet" size="sm" disabled={m.busy} onClick={()=>m.decide(row.id,{decision:'REJECTED'})}>{tr('nba.reject')}</Button>
  </div>
  <details className="pos-adetails">
   <summary><span>{t.details}</span><Icon name="chevron-down" size={16}/></summary>
   <p className="pos-adetails__line"><b>{tr('nba.who')} :</b> {row.target.role??tr('nba.roleUnknown')} · {row.target.person?.name??tr('nba.personUnknown')}</p>
   {row.primary_detail?.suggested_angle&&<p className="pos-adetails__line"><b>{tr('nba.angle')} :</b> {row.primary_detail.suggested_angle}</p>}
   <h4>{tr('nba.whyNow')}</h4><Statements items={row.explanation.why_now} locale={locale}/>
   <h4>{tr('nba.whyAction')}</h4><Statements items={row.explanation.why_this_action} locale={locale}/>
   <h4>{tr('nba.whyAccount')}</h4><Statements items={row.explanation.why_this_account} locale={locale}/>
   {row.explanation.inferred.length>0&&<><h4>{tr('nba.inferred')}</h4><Statements items={row.explanation.inferred} locale={locale}/></>}
   {row.explanation.unknown.length>0&&<><h4>{tr('nba.unknown')}</h4><Statements items={row.explanation.unknown} locale={locale}/></>}
   {p.kind==='contact_draft'&&p.text&&<><h4>{tr('nba.draft')}</h4><p className="pos-adraft">{p.text}</p>
    <Button variant="quiet" size="sm" onClick={()=>copy(p.text!,'draft')}>{copied==='draft'?tr('nba.copied'):tr('nba.copy')}</Button></>}
   {p.kind==='engage'&&<><h4>{tr('nba.engageContent')}</h4>
    {p.suggested_comment&&<><p className="pos-adetails__muted">{tr('nba.suggestedComment')}</p><p className="pos-adraft">{p.suggested_comment}</p>
     <Button variant="quiet" size="sm" onClick={()=>copy(p.suggested_comment!,'comment')}>{copied==='comment'?tr('nba.copied'):tr('nba.copy')}</Button></>}
    {p.suggested_dm_after_engagement&&<><p className="pos-adetails__muted">{tr('nba.suggestedDm')}</p><p className="pos-adraft">{p.suggested_dm_after_engagement}</p>
     <Button variant="quiet" size="sm" onClick={()=>copy(p.suggested_dm_after_engagement!,'dm')}>{copied==='dm'?tr('nba.copied'):tr('nba.copy')}</Button></>}</>}
   <h4>{t.indicators}</h4>
   <p className="pos-adetails__muted">{tr('nba.opportunityHint')}</p>
   <ul className="pos-aind">{([[t.opportunity,`${row.opportunity_score}/100`],['FIT',row.fit_score===null?'—':`${row.fit_score}${row.fit_basis==='estimated'?' ~':''}`],['INTENT',row.intent_score],['TIMING',row.timing_score],
    [tr('nba.freshness'),row.freshness_score],[tr('nba.evidenceQuality'),row.evidence_quality_score]] as [string,string|number][]).map(([k,v])=><li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
  </details>
 </li>;
}

export function ActionsNative({m}:{m:ActionsView}){
 const {locale}=m;const tr=(k:TKey)=>translate(locale,k);const t=ACTIVITY_TEXT[locale];
 const set=(k:'signal_type'|'min_score'|'min_freshness',v:string)=>m.setFilter({...m.filter,[k]:v});
 return <div className="pos-act">
  <div className="pos-act__bar">
   <h3 className="pos-act__h">{tr('nba.title')}</h3>
   <Button variant="secondary" size="sm" disabled={m.busy} onClick={m.compute}>{tr('nba.compute')}</Button>
  </div>
  <p className="pos-act__muted">{tr('nba.humanOnly')}</p>
  {m.note&&<p role="status" className="pos-anote">{m.note}</p>}
  {m.error&&<p role="alert" className="pos-anote pos-anote--error">{m.error}</p>}
  <details className="pos-adetails pos-afilters">
   <summary><span>{t.filters}</span><Icon name="filter" size={16}/></summary>
   <div className="pos-afilters__grid">
    <label className="pos-afield"><span>{tr('nba.filter.signalType')}</span><select value={m.filter.signal_type} onChange={e=>set('signal_type',e.target.value)}>
     <option value="">{tr('common.all')}</option>{COMMERCIAL_SIGNAL_TYPES.map(x=><option key={x} value={x}>{typeLabel(x,locale)}</option>)}</select></label>
    <label className="pos-afield"><span>{tr('nba.filter.minScore')}</span><input type="number" inputMode="numeric" min="0" max="100" value={m.filter.min_score} onChange={e=>set('min_score',e.target.value)}/></label>
    <label className="pos-afield"><span>{tr('nba.filter.minFreshness')}</span><input type="number" inputMode="numeric" min="0" max="100" value={m.filter.min_freshness} onChange={e=>set('min_freshness',e.target.value)}/></label>
   </div>
  </details>
  <section className="pos-agroup" aria-label={tr('nba.section.today')}>
   <h3 className="pos-agroup__h">{tr('nba.section.today')} <span className="pos-act__muted">({m.today.length}/10)</span></h3>
   {m.today.length?<ul className="pos-alist">{m.today.map(r=><ActionItem key={r.id} row={r} m={m}/>)}</ul>:<p className="pos-act__muted">{tr('nba.emptyToday')}</p>}
  </section>
  {SECTIONS.map(s=>{const rows=m.queue.filter(r=>s.actions.includes(r.recommended_action)&&!m.today.some(x=>x.id===r.id));
   return <details key={s.key} className="pos-agroup pos-adetails" open={s.key!=='wait'&&rows.length>0}>
    <summary><span>{tr(s.title)} <span className="pos-act__muted">({rows.length})</span></span><Icon name="chevron-down" size={16}/></summary>
    {rows.length?<ul className="pos-alist">{rows.map(r=><ActionItem key={r.id} row={r} m={m}/>)}</ul>:<p className="pos-act__muted">{t.empty}</p>}
   </details>})}
 </div>;
}

// ── Vue d'ensemble (pipeline) ─────────────────────────────────────────────────────────────────────────────────────────
export type OverviewProps={locale:Locale;metrics:{label:string;value:string;sub:string}[];pipeline:{status:string;label:string;count:number}[];total:number;note:string;onStatus:(s:string)=>void};
export function ActivityOverview(p:OverviewProps){
 const t=ACTIVITY_TEXT[p.locale];
 return <div className="pos-aover">
  <section aria-label={t.figures}><ul className="pos-ametrics">{p.metrics.map(x=><li key={x.label}><span>{x.label}</span><b>{x.value}</b><small>{x.sub}</small></li>)}</ul></section>
  <section className="pos-apipe" aria-labelledby="pos-apipe-h">
   <h3 id="pos-apipe-h" className="pos-agroup__h">{t.pipeline}</h3>
   <ul className="pos-apipe__list">{p.pipeline.map(s=><li key={s.status}>
    <button type="button" className="pos-apipe__row" onClick={()=>p.onStatus(s.status)}>
     <span className="pos-apipe__label">{s.label}</span><b className="pos-apipe__count">{s.count}</b>
     <span className="pos-apipe__bar" aria-hidden="true"><span style={{width:`${p.total?s.count/p.total*100:0}%`}}/></span>
     <Icon name="chevron-right" size={16}/></button></li>)}</ul>
   <p className="pos-act__muted">{p.note}</p>
  </section>
 </div>;
}
