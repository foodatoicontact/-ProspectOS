'use client';
// Today 2.0 (UI-3, docs/UI_V2.md) — the V2 presentation of "Aujourd'hui", rendered by the v2 shell only when
// UI_V2_ENABLED and ZERO_FRICTION_TODAY_ENABLED are both on. Same data and same calls as TodayPanel (ensure-fresh then
// home, recomputation only when stale or after a data change), same engine order, same ZF1.1 actions. Nothing here
// sends, posts or contacts anyone, and no information is ever recorded without its source (USER_DECLARED is UI-4).
import {useEffect,useRef,useState} from 'react';
import './today.css';
import {translate,todaySummary,type TKey} from '../../../i18n/index.ts';
import type {TodayRow} from '../../../nba/today.ts';
import type {ZfKind} from '../../../server/ux-events.ts';
import type {Locale} from '../../../i18n/locale.ts';
import {Button,Chip,ChipGroup,Icon,StatusBadge} from '../primitives.tsx';
import {ContextPanel} from '../panels.tsx';
import {todayV2,type V2Card,type V2Signal} from './model.ts';

type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Filter='contact'|'verify'|'watch';
type PanelMode='why'|'complete'|'verify'|'declare';
// criteria: the project's ICP (key + label), for a declaration without a source (UI-4).
export type TodayV2Props={projectId:string;api:Api;locale:Locale;dirty:boolean;onCleaned:()=>void;onOpenProspect:(id:string)=>void;criteria:{key:string;label:string}[];
 track:(k:ZfKind)=>void;onSearch:()=>void;notice:string;onDismissNotice:()=>void;
 paywall:{text:string;action:string;onAction:()=>void;onDismiss:()=>void}|null};

export const TODAY_TEXT:Record<Locale,{
 filters:string;contact:string;verify:string;watch:string;why:string;whyTitle:string;completeTitle:string;verifyTitle:string;
 source:string;freshness:string;place:string;sourceSays:string;favourable:string;missing:string;verified:string;undocumented:string;
 nothingVerified:string;nothingMissing:string;advanced:string;advancedNote:string;scores:string;rule:string;evidence:string;provenance:string;
 completeIntro:string;openRecord:string;declare:string;emptyTitle:string;emptyBody:string;search:string;
 declareTitle:string;declareCriterion:string;declareValue:string;declareMet:string;declareNotMet:string;declareNote:string;declareNoteHint:string;
 declareWarning:string;declareSave:string;declareSaved:string;declareError:string;declaredByYou:string;declaredNotMet:string;estimatedToCheck:string;
 filteredEmpty:Record<Filter,string>;showAll:string;signalPrefix:string;close:string;dismiss:string;toDocument:string}>={
 fr:{filters:'Filtrer les recommandations',contact:'à contacter',verify:'à vérifier',watch:'en veille',why:'Voir pourquoi',
  whyTitle:'Pourquoi cette recommandation ?',completeTitle:'Que manque-t-il pour décider ?',verifyTitle:'Vérifier le signal',
  source:'Source',freshness:'Fraîcheur',place:'Localisation',sourceSays:'Ce que dit la source',favourable:'Ce qui correspond déjà',
  missing:'Ce qui manque pour décider',verified:'Vérifié',undocumented:'Non documenté',nothingVerified:'Aucun critère vérifié pour l’instant.',
  nothingMissing:'Aucune information manquante.',advanced:'Détails avancés',advancedNote:'Données du moteur — pour auditer, jamais nécessaires pour décider.',
  scores:'Scores',rule:'Règle',evidence:'États des preuves',provenance:'Provenance',
  completeIntro:'Une information compte quand elle est documentée par une source (lien et extrait). Ajoutez-la depuis la fiche de l’entreprise ; la recommandation se met à jour ensuite.',
  openRecord:'Ouvrir la fiche pour ajouter une preuve',declare:'Déclarer une information sans source',
  declareTitle:'Déclarer une information',declareCriterion:'Critère de votre cible',declareValue:'Ce que vous savez',declareMet:'Ce critère est rempli',
  declareNotMet:'Ce critère n’est pas rempli',declareNote:'Note (facultative)',declareNoteHint:'280 caractères au plus.',
  declareWarning:'Cette information vient de vous. Elle n’est pas considérée comme une preuve vérifiée.',declareSave:'Enregistrer',
  declareSaved:'Information enregistrée. Elle vient de vous : elle n’est pas une preuve vérifiée.',declareError:'L’information n’a pas pu être enregistrée.',
  declaredByYou:'Déclaré par vous',declaredNotMet:'Déclaré non rempli par vous',estimatedToCheck:'Estimé, à vérifier',
  emptyTitle:'Aucune entreprise à contacter aujourd’hui.',emptyBody:'Une journée normale : rien n’est forcé. Une nouvelle recherche peut faire apparaître de nouveaux signaux.',
  search:'Lancer une recherche',filteredEmpty:{contact:'Aucune entreprise à contacter aujourd’hui.',verify:'Aucune entreprise à vérifier.',watch:'Aucune entreprise en veille à afficher.'},
  showAll:'Tout afficher',signalPrefix:'Signal : ',close:'Fermer',dismiss:'Fermer le message',toDocument:'À documenter'},
 en:{filters:'Filter recommendations',contact:'to contact',verify:'to verify',watch:'watching',why:'See why',
  whyTitle:'Why this recommendation?',completeTitle:'What is missing to decide?',verifyTitle:'Check the signal',
  source:'Source',freshness:'Freshness',place:'Location',sourceSays:'What the source says',favourable:'Already matching',
  missing:'Missing to decide',verified:'Verified',undocumented:'Not documented',nothingVerified:'No verified criterion yet.',
  nothingMissing:'Nothing missing.',advanced:'Advanced details',advancedNote:'Engine data — for auditing, never needed to decide.',
  scores:'Scores',rule:'Rule',evidence:'Evidence states',provenance:'Provenance',
  completeIntro:'A piece of information counts once a source documents it (link and excerpt). Add it from the company record; the recommendation is then updated.',
  openRecord:'Open the record to add evidence',declare:'Declare information without a source',
  declareTitle:'Declare information',declareCriterion:'Criterion of your target',declareValue:'What you know',declareMet:'This criterion is met',
  declareNotMet:'This criterion is not met',declareNote:'Note (optional)',declareNoteHint:'280 characters at most.',
  declareWarning:'This information comes from you. It is not considered verified evidence.',declareSave:'Save',
  declareSaved:'Information saved. It comes from you: it is not verified evidence.',declareError:'The information could not be saved.',
  declaredByYou:'Declared by you',declaredNotMet:'Declared not met by you',estimatedToCheck:'Estimated, to check',
  emptyTitle:'No company to contact today.',emptyBody:'A normal day: nothing is forced. A new search can bring new signals.',
  search:'Run a search',filteredEmpty:{contact:'No company to contact today.',verify:'No company to verify.',watch:'No watched company to show.'},
  showAll:'Show all',signalPrefix:'Signal: ',close:'Close',dismiss:'Dismiss message',toDocument:'To document'},
};

function SignalLine({s,prefix,id}:{s:V2Signal;prefix:string;id?:string}){
 const meta=[s.place,s.age].filter(Boolean).join(' · ');
 return <div className="pos-signal" id={id}>
  <p className="pos-signal__type"><span className="pos-sigdot" aria-hidden="true"/><span><span className="pos-visually-hidden">{prefix}</span>{s.type}</span></p>
  {meta&&<p className="pos-signal__meta">{meta}</p>}
 </div>;
}

function ActionButton({card,busy,onAct,full}:{card:V2Card;busy:boolean;onAct:(c:V2Card)=>void;full?:boolean}){
 if(!card.action.label)return null;
 return <Button variant={card.action.tone==='contact'?'contact':'primary'} size="sm" fullWidth={full} disabled={busy} onClick={()=>onAct(card)}
  data-action={card.action.kind}>{card.action.label}</Button>;
}

function Card({card,locale,busy,onAct,onWhy,whyOpen}:{card:V2Card;locale:Locale;busy:boolean;onAct:(c:V2Card)=>void;onWhy:(c:V2Card)=>void;whyOpen:boolean}){
 const t=TODAY_TEXT[locale];
 const titleId=`pos-tcard-${card.id}`;
 return <li><article className={`pos-tcard pos-tcard--${card.section}`} aria-labelledby={titleId} data-testid="today-v2-card">
  <div className="pos-tcard__head"><span className="pos-tcard__initial" aria-hidden="true">{card.initial}</span><h3 id={titleId} className="pos-tcard__name">{card.name}</h3></div>
  {card.signal&&<SignalLine s={card.signal} prefix={t.signalPrefix}/>}
  <StatusBadge status={card.status} locale={locale} className="pos-tcard__status"/>
  <p className="pos-tcard__why">{card.explanation}{card.note&&<span className="pos-tcard__note"> {card.note}</span>}</p>
  <div className="pos-tcard__actions">
   {card.action.label?<ActionButton card={card} busy={busy} onAct={onAct}/>:<p className="pos-tcard__none">{translate(locale,'today.noActionNeeded')}</p>}
   <Button variant="quiet" size="sm" iconEnd="chevron-right" aria-expanded={whyOpen} aria-haspopup="dialog" onClick={()=>onWhy(card)}>{t.why}</Button>
  </div>
 </article></li>;
}

// How each criterion is known (UI-4): verified (green, with a source), declared by the person (neutral person icon,
// never green), estimated from a source not yet checked, or not documented. Rows stored before UI-4 keep their display.
function Favourable({card,locale}:{card:V2Card;locale:Locale}){
 const t=TODAY_TEXT[locale];const items=card.level2.favourableItems;
 if(!items.length)return <p className="pos-l2__empty">{t.nothingVerified}</p>;
 return <ul className="pos-checks">{items.map((f,i)=>f.basis==='declared'
  ?<li key={i} data-basis="declared"><Icon name="declared" size={18} className="pos-checks__declared"/><span>{f.label}<small>{t.declaredByYou}</small></span></li>
  :f.basis==='estimated'?<li key={i} data-basis="estimated"><Icon name="info" size={18} className="pos-checks__todo"/><span>{f.label}<small>{t.estimatedToCheck}</small></span></li>
  :<li key={i} data-basis={f.basis}><Icon name="verified" size={18} className="pos-checks__ok"/><span>{f.label}<small>{t.verified}</small></span></li>)}</ul>;
}
function Missing({card,locale}:{card:V2Card;locale:Locale}){
 const t=TODAY_TEXT[locale];const items=card.level2.missingItems;
 if(!items.length)return <p className="pos-l2__empty">{t.nothingMissing}</p>;
 return <ul className="pos-checks">{items.map((m,i)=>m.basis==='declared_false'
  ?<li key={i} data-basis="declared_false"><Icon name="declared" size={18} className="pos-checks__declared"/><span>{m.label}<small>{t.declaredNotMet}</small></span></li>
  :<li key={i} data-basis="undocumented"><Icon name="verify" size={18} className="pos-checks__todo"/><span>{m.label}<small>{t.undocumented}</small></span></li>)}</ul>;
}

// UI-4 — a declaration without a source, in the same panel. The person picks the criterion and what they know; the
// warning is always visible; one request at a time (in-flight ref + loading button); an error keeps the form open.
function DeclareForm({card,criteria,locale,busy,error,onSubmit}:{card:V2Card;criteria:{key:string;label:string}[];locale:Locale;busy:boolean;error:string;
 onSubmit:(v:{criterion:string;value:boolean;note:string})=>void}){
 const t=TODAY_TEXT[locale];const id=`pos-declare-${card.id}`;
 const answered=new Set([...card.level2.favourableItems.filter(f=>f.basis!=='estimated').map(f=>f.label)]);
 const first=criteria.find(c=>card.level2.missing.includes(c.label))??criteria.find(c=>!answered.has(c.label))??criteria[0];
 const [criterion,setCriterion]=useState(first?.key??'');const [value,setValue]=useState<boolean|null>(null);const [note,setNote]=useState('');
 const ready=!!criterion&&value!==null&&!busy;
 return <form className="pos-declare" data-testid="today-declare" aria-describedby={`${id}-warning`}
  onSubmit={e=>{e.preventDefault();if(ready)onSubmit({criterion,value:value!,note:note.trim()})}}>
  <p className="pos-panel__name">{card.name}</p>
  <p id={`${id}-warning`} className="pos-declare__warning"><Icon name="declared" size={18}/><span>{t.declareWarning}</span></p>
  <label className="pos-field" htmlFor={`${id}-criterion`}><span className="pos-field__label">{t.declareCriterion}</span>
   <select id={`${id}-criterion`} value={criterion} disabled={busy} onChange={e=>setCriterion(e.target.value)}>
    {criteria.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
  <fieldset className="pos-field" disabled={busy}><legend className="pos-field__label">{t.declareValue}</legend>
   <label className="pos-radio"><input type="radio" name={`${id}-value`} checked={value===true} onChange={()=>setValue(true)}/><span>{t.declareMet}</span></label>
   <label className="pos-radio"><input type="radio" name={`${id}-value`} checked={value===false} onChange={()=>setValue(false)}/><span>{t.declareNotMet}</span></label>
  </fieldset>
  <label className="pos-field" htmlFor={`${id}-note`}><span className="pos-field__label">{t.declareNote}</span>
   <textarea id={`${id}-note`} rows={3} maxLength={280} value={note} disabled={busy} aria-describedby={`${id}-note-hint`} onChange={e=>setNote(e.target.value)}/>
   <small id={`${id}-note-hint`} className="pos-field__hint">{t.declareNoteHint}</small></label>
  {error&&<p className="pos-declare__error" role="alert">{error}</p>}
  <div className="pos-panel__actions"><Button type="submit" variant="primary" size="md" fullWidth loading={busy} disabled={!ready}>{t.declareSave}</Button></div>
 </form>;
}

// Level 2 — never a score.
function Level2({card,locale}:{card:V2Card;locale:Locale}){
 const t=TODAY_TEXT[locale];const l=card.level2;
 return <div className="pos-l2" data-testid="today-level2">
  <p className="pos-panel__name">{card.name}</p>
  {card.signal&&<SignalLine s={card.signal} prefix={t.signalPrefix}/>}
  <dl className="pos-facts">
   {l.source&&<><dt>{t.source}</dt><dd>{l.source.url?<a href={l.source.url} target="_blank" rel="noreferrer">{l.source.label} <Icon name="external" size={14}/></a>:l.source.label}</dd></>}
   {l.freshness&&<><dt>{t.freshness}</dt><dd>{l.freshness}</dd></>}
   {l.place&&<><dt>{t.place}</dt><dd>{l.place}</dd></>}
  </dl>
  {l.proof&&<><h3 className="pos-l2__h">{t.sourceSays}</h3><p className="pos-l2__quote">{l.proof}</p></>}
  <h3 className="pos-l2__h">{t.favourable}</h3>
  <Favourable card={card} locale={locale}/>
  <h3 className="pos-l2__h">{t.missing}</h3>
  <Missing card={card} locale={locale}/>
 </div>;
}

// Level 3 — the only place where engine scores, rule, evidence states and provenance appear.
function Level3({card,locale}:{card:V2Card;locale:Locale}){
 const t=TODAY_TEXT[locale];const l=card.level3;
 const safe=(u:string|null)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};
 return <div className="pos-l3" data-testid="today-level3">
  <p className="pos-l3__note">{t.advancedNote}</p>
  <h3 className="pos-l2__h">{t.scores}</h3>
  <dl className="pos-facts pos-facts--mono">{l.scores.map(s=><div key={s.label} className="pos-facts__row"><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
   <div className="pos-facts__row"><dt>{t.rule}</dt><dd>{l.rule}</dd></div></dl>
  <h3 className="pos-l2__h">{t.evidence}</h3>
  <dl className="pos-facts pos-facts--mono">{l.evidence.map(e=><div key={e.label} className="pos-facts__row"><dt>{e.label}</dt><dd>{e.value}</dd></div>)}</dl>
  {l.statements.length>0&&<><h3 className="pos-l2__h">{t.provenance}</h3>
   <ul className="pos-statements">{l.statements.map((s,i)=><li key={i}><span className="pos-statements__kind">{translate(locale,`nba.kind.${s.kind}` as TKey)}</span> {s.text}
    {s.refs.map(r=>{const h=safe(r.source_url);return h?<a key={r.id} href={h} target="_blank" rel="noreferrer"> {translate(locale,'nba.openSource')} <Icon name="external" size={13}/></a>:null})}</li>)}</ul></>}
 </div>;
}

export function TodayV2({projectId,api,locale,dirty,onCleaned,onOpenProspect,criteria,track,onSearch,notice,onDismissNotice,paywall}:TodayV2Props){
 const t=TODAY_TEXT[locale];const tr=(k:TKey)=>translate(locale,k);
 const [rows,setRows]=useState<TodayRow[]|null>(null);const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [filter,setFilter]=useState<Filter|null>(null);
 const [panel,setPanel]=useState<{id:string;mode:PanelMode}|null>(null);const [advanced,setAdvanced]=useState(false);
 const [busy,setBusy]=useState(false);const [note,setNote]=useState('');const [declareError,setDeclareError]=useState('');
 const mounted=useRef(false);const declaring=useRef(false);
 // Same sequence as TodayPanel: recompute when the server says it is needed (TTL / data change), then read. A failed
 // recomputation never hides the last recommendations.
 const load=async(reason:'open'|'data_changed')=>{
  setStatus(s=>s==='ready'?'ready':'loading');
  try{
   try{await api(`projects/${projectId}/next-best-actions/ensure-fresh`,'POST',{reason});if(reason==='data_changed')onCleaned()}catch{/* keep last state */}
   const r=await api(`projects/${projectId}/next-best-actions/home`);
   setRows((r?.items??[]) as TodayRow[]);setStatus('ready');
  }catch{setStatus('error')}
 };
 useEffect(()=>{if(mounted.current&&!dirty)return;if(!mounted.current)track('ZF_TODAY_VIEWED');mounted.current=true;void load(dirty?'data_changed':'open')},[projectId,dirty]);// eslint-disable-line react-hooks/exhaustive-deps
 const model=rows?todayV2(rows,locale):null;
 useEffect(()=>{if(model&&model.total>0)track('ZF_FIRST_RECOMMENDATION_VISIBLE')},[rows]);// eslint-disable-line react-hooks/exhaustive-deps
 const current=panel&&model?[...model.cards,...model.watched].find(c=>c.id===panel.id)??null:null;
 useEffect(()=>{if(panel&&model&&!current)setPanel(null)},[panel,model,current]);

 const openPanel=(c:V2Card,mode:PanelMode)=>{setAdvanced(false);setDeclareError('');setPanel({id:c.id,mode});if(mode==='why')track('ZF_WHY_OPENED')};
 // ZF1.1 actions: CONTACT / ENGAGE open the record; a signal to check and missing information open the panel.
 const act=(c:V2Card)=>{
  if(c.action.kind==='VERIFY_SIGNAL'&&c.action.signalId){openPanel(c,'verify');return}
  if(c.action.kind==='VERIFY_INFORMATION'){openPanel(c,'complete');return}
  track('ZF_FIRST_MEANINGFUL_ACTION');onOpenProspect(c.prospectId);
 };
 const review=async(c:V2Card,decision:'verify'|'reject')=>{
  if(!c.action.signalId)return;setBusy(true);setNote('');
  // The review marks the data as changed (page api wrapper): the dirty effect recomputes once.
  try{await api(`signals/${c.action.signalId}/review`,'POST',{decision});track('ZF_FIRST_MEANINGFUL_ACTION');setPanel(null);setNote(tr(decision==='verify'?'today.verified':'today.rejected'))}
  catch(e){setNote(String((e as Error).message))}finally{setBusy(false)}
 };
 // UI-4: POST /evidence USER_DECLARED. The page api wrapper marks the data as changed: the dirty effect recomputes once
 // (ensure-fresh, data_changed) — no other recomputation here. The author is the session, never sent from here.
 const declare=async(c:V2Card,v:{criterion:string;value:boolean;note:string})=>{
  if(declaring.current)return;declaring.current=true;setBusy(true);setDeclareError('');
  try{await api('evidence','POST',{prospect_id:c.prospectId,criterion:v.criterion,value:v.value,status:'USER_DECLARED',...(v.note?{note:v.note}:{})});
   track('ZF_FIRST_MEANINGFUL_ACTION');setPanel(null);setNote(t.declareSaved)}
  catch(e){setDeclareError(`${t.declareError} ${String((e as Error)?.message??'')}`.trim())}
  finally{declaring.current=false;setBusy(false)}
 };
 const toggle=(f:Filter)=>(on:boolean)=>setFilter(on?f:null);
 const visible=!model?[]:filter==='watch'?model.watched:model.cards.filter(c=>!filter||c.section===filter);
 const panelTitle=panel?.mode==='complete'?t.completeTitle:panel?.mode==='verify'?t.verifyTitle:panel?.mode==='declare'?t.declareTitle:t.whyTitle;

 return <div className="pos-today">
  <div className="pos-today__main">
   <header className="pos-today__head">
    <h2 className="pos-today__title">{tr('today.title')}</h2>
    {model&&<ChipGroup label={t.filters} variant="segmented">
     <Chip tone="contact" count={model.counts.contact} pressed={filter==='contact'} onPressedChange={toggle('contact')}>{t.contact}</Chip>
     <Chip tone="verify" count={model.counts.verify} pressed={filter==='verify'} onPressedChange={toggle('verify')}>{t.verify}</Chip>
     <Chip tone="watch" count={model.counts.watched} pressed={filter==='watch'} onPressedChange={toggle('watch')}>{t.watch}</Chip>
    </ChipGroup>}
    {/* v1.3.x: accounts whose FIT is not documented yet — counted apart from the ones set aside; no card, so no filter. */}
    {model&&model.counts.document>0&&<p className="pos-today__document" data-testid="today-document">{t.toDocument} · {model.counts.document}</p>}
   </header>
   {model&&<p className="pos-visually-hidden" role="status">{todaySummary(locale,{contact:model.counts.contact,verify:model.counts.verify,watched:model.counts.watched}).join(' ')}</p>}
   {paywall&&<div className="pos-banner pos-banner--verify" role="status"><p>{paywall.text}</p><Button size="sm" variant="primary" onClick={paywall.onAction}>{paywall.action}</Button>
    <button type="button" className="pos-iconbtn" aria-label={t.dismiss} onClick={paywall.onDismiss}><Icon name="close" size={18}/></button></div>}
   {(note||notice)&&<div className="pos-banner" role="status"><p>{note||notice}</p><button type="button" className="pos-iconbtn" aria-label={t.dismiss} onClick={()=>{setNote('');onDismissNotice()}}><Icon name="close" size={18}/></button></div>}
   {status==='loading'&&!model&&<div className="pos-today__skeleton" role="status" aria-label={tr('today.loading')}><span/><span/></div>}
   {status==='error'&&<div className="pos-banner pos-banner--error" role="alert"><p>{tr('today.error')}</p><Button size="sm" variant="secondary" onClick={()=>void load('open')}>{tr('today.retry')}</Button></div>}
   {model&&model.total===0&&<div className="pos-empty pos-card"><p className="pos-empty__title">{t.emptyTitle}</p><p className="pos-empty__body">{t.emptyBody}</p>
    <Button size="sm" variant="secondary" iconStart="search" onClick={onSearch}>{t.search}</Button></div>}
   {model&&model.total>0&&visible.length===0&&filter&&<div className="pos-empty pos-card"><p className="pos-empty__title">{t.filteredEmpty[filter]}</p>
    <Button size="sm" variant="secondary" onClick={()=>setFilter(null)}>{t.showAll}</Button></div>}
   {visible.length>0&&<ol className="pos-today__list">
    {visible.map(c=><Card key={c.id} card={c} locale={locale} busy={busy} onAct={act} onWhy={x=>openPanel(x,'why')} whyOpen={panel?.id===c.id&&panel.mode==='why'}/>)}
   </ol>}
  </div>
  <ContextPanel open={!!current} onClose={()=>setPanel(null)} title={panelTitle} locale={locale}>
   {current&&panel?.mode==='why'&&<>
    <Level2 card={current} locale={locale}/>
    <div className="pos-panel__actions"><ActionButton card={current} busy={busy} onAct={act} full/></div>
    <button type="button" className="pos-disclosure" aria-expanded={advanced} aria-controls={`pos-l3-${current.id}`}
     onClick={()=>{const next=!advanced;setAdvanced(next);if(next)track('ZF_ADVANCED_DETAILS_OPENED')}}>
     <span>{t.advanced}</span><Icon name="chevron-down" size={18} className={advanced?'pos-disclosure__open':undefined}/></button>
    <div id={`pos-l3-${current.id}`} hidden={!advanced}>{advanced&&<Level3 card={current} locale={locale}/>}</div>
   </>}
   {current&&panel?.mode==='complete'&&<div className="pos-complete" data-testid="today-complete">
    <p className="pos-panel__name">{current.name}</p>
    {current.signal&&<SignalLine s={current.signal} prefix={t.signalPrefix}/>}
    <p className="pos-complete__intro">{t.completeIntro}</p>
    <h3 className="pos-l2__h">{t.favourable}</h3>
    <Favourable card={current} locale={locale}/>
    <h3 className="pos-l2__h">{t.missing}</h3>
    <Missing card={current} locale={locale}/>
    <div className="pos-panel__actions">
     <Button variant="primary" size="md" fullWidth disabled={busy} onClick={()=>{track('ZF_FIRST_MEANINGFUL_ACTION');setPanel(null);onOpenProspect(current.prospectId)}}>{t.openRecord}</Button>
     <Button variant="secondary" size="md" fullWidth iconStart="declared" disabled={busy||!criteria.length} onClick={()=>openPanel(current,'declare')}>{t.declare}</Button>
    </div>
   </div>}
   {current&&panel?.mode==='declare'&&<DeclareForm key={current.id} card={current} criteria={criteria} locale={locale} busy={busy} error={declareError}
    onSubmit={v=>void declare(current,v)}/>}
   {current&&panel?.mode==='verify'&&<div className="pos-verify" data-testid="today-verify">
    <p className="pos-panel__name">{current.name}</p>
    {current.signal&&<SignalLine s={current.signal} prefix={t.signalPrefix}/>}
    {current.level2.proof&&<p className="pos-l2__quote">{current.level2.proof}</p>}
    {current.level2.source?.url&&<p><a href={current.level2.source.url} target="_blank" rel="noreferrer">{tr('nba.openSource')} — {current.level2.source.label} <Icon name="external" size={14}/></a></p>}
    <p className="pos-complete__intro">{tr('today.verifyHint')}</p>
    <div className="pos-panel__actions">
     <Button variant="primary" size="md" fullWidth disabled={busy} loading={busy} onClick={()=>void review(current,'verify')}>{tr('today.verifyConfirm')}</Button>
     <Button variant="secondary" size="md" fullWidth disabled={busy} onClick={()=>void review(current,'reject')}>{tr('today.verifyReject')}</Button>
    </div>
   </div>}
  </ContextPanel>
 </div>;
}
