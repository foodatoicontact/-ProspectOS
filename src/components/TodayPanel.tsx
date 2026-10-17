'use client';
import {useEffect,useRef,useState} from 'react';
import {translate,type Locale,type TKey} from '../i18n';
import {buildTodayModel,SECTION_ORDER,type TodayCard,type TodayModel,type TodayRow,type TodaySection} from '../nba/today';
import type {ZfKind} from '../server/ux-events';
// Zero-Friction ZF1 — "Aujourd'hui". Answers "what deserves my attention today?" without asking the user to know
// Discovery, Evidence, Signals or NBA. Level 1: action + reason; "Voir pourquoi": favourable / missing / timing /
// place; "Détails avancés": scores, rule, statements with their sources. The engine is recomputed automatically and
// only when needed (ensure-fresh); nothing here sends, posts or contacts anyone.
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
const href=(u:string|null|undefined)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};
const SECTION_TITLE:Record<TodaySection,TKey>={contact:'today.section.contact',verify:'today.section.verify',engage:'today.section.engage',watch:'today.section.watch'};
const ACTION_LABEL:Record<string,TKey>={PREPARE_MESSAGE:'today.action.prepare',OPEN_CONVERSATION:'today.action.conversation',VERIFY_SIGNAL:'today.action.verifySignal',VERIFY_INFORMATION:'today.action.verify'};

function Card({card,locale,busy,onPrimary,onVerifySignal,track}:{card:TodayCard;locale:Locale;busy:boolean;onPrimary:(c:TodayCard)=>void;
 onVerifySignal:(c:TodayCard,decision:'verify'|'reject')=>void;track:(k:ZfKind)=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const [verifying,setVerifying]=useState(false);
 const proofHref=href(card.proof?.url);
 return <article className={`nba-card today-card today-${card.section}`} data-testid="today-card" aria-labelledby={`today-${card.id}`}>
  <div className="nba-card-head"><h3 id={`today-${card.id}`}>{card.name}</h3><span className="pill">{tr(SECTION_TITLE[card.section])}</span></div>
  {card.whyNow&&<p className="today-why-now">{card.whyNow}</p>}
  <p>{card.whyCompany}</p>
  {card.toVerify.length>0&&<div className="today-to-verify"><b>{tr('today.moreInfo')}</b><ul>{card.toVerify.map(v=><li key={v}>{v}</li>)}</ul></div>}
  {card.primary.kind!=='NONE'&&!verifying&&<div className="actions"><button className="primary" disabled={busy}
   onClick={()=>{if(card.primary.kind==='VERIFY_SIGNAL'&&card.primary.signalId)setVerifying(true);else onPrimary(card)}}>{tr(ACTION_LABEL[card.primary.kind]!)}</button></div>}
  {card.primary.kind==='NONE'&&<p className="muted">{tr('today.noActionNeeded')}</p>}
  {verifying&&<div className="today-verify" role="group" aria-label={tr('today.action.verifySignal')}>
   <p>{card.proof?.text??'—'} {proofHref&&<a href={proofHref} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>}</p>
   <p className="muted">{tr('today.verifyHint')}</p>
   <div className="actions"><button className="primary" disabled={busy} onClick={()=>onVerifySignal(card,'verify')}>{tr('today.verifyConfirm')}</button>
    <button disabled={busy} onClick={()=>onVerifySignal(card,'reject')}>{tr('today.verifyReject')}</button>
    <button disabled={busy} onClick={()=>setVerifying(false)}>{tr('today.cancel')}</button></div></div>}
  <details className="today-why"><summary>{tr('today.why')}</summary>
   {card.details.favourable.length>0&&<p><b>{tr('today.favourable')}</b> {card.details.favourable.join(' ; ')}</p>}
   {card.details.missing.length>0&&<p><b>{tr('today.missing')}</b> {card.details.missing.join(' ; ')}</p>}
   {card.details.timing&&<p><b>{tr('today.timing')}</b> {card.details.timing}</p>}
   {card.details.place&&<p><b>{tr('today.place')}</b> {card.details.place}</p>}
   {card.proof&&<p><b>{tr('today.proof')}</b> {card.proof.text} {proofHref&&<a href={proofHref} target="_blank" rel="noreferrer">{tr('nba.openSource')} ↗</a>}</p>}
   <details className="today-advanced" onToggle={e=>{if((e.target as HTMLDetailsElement).open)track('ZF_ADVANCED_DETAILS_OPENED')}}><summary>{tr('today.advanced')}</summary>
    <p className="nba-chips">{card.advanced.scores.map(s=><span key={s.label} className="pill">{s.label} {s.value}</span>)}<span className="pill">{tr('today.rule')} {card.advanced.rule}</span></p>
    <ul className="nba-statements">{card.advanced.statements.map((s,i)=><li key={i} className={`nba-${s.kind}`}><span className="pill">{tr(`nba.kind.${s.kind}` as TKey)}</span> {s.text}
     {s.refs.map(r=>{const h=href(r.source_url);return h?<a key={r.id} href={h} target="_blank" rel="noreferrer"> {tr('nba.openSource')} ↗</a>:null})}</li>)}</ul>
   </details>
  </details>
 </article>;
}

export function TodayPanel({projectId,api,locale,dirty,onCleaned,onOpenProspect,onAdvanced,track}:{projectId:string;api:Api;locale:Locale;dirty:boolean;onCleaned:()=>void;
 onOpenProspect:(id:string)=>void;onAdvanced:()=>void;track:(k:ZfKind)=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const [model,setModel]=useState<TodayModel|null>(null);const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [busy,setBusy]=useState(false);const [note,setNote]=useState('');
 const mounted=useRef(false);
 const load=async(reason:'open'|'data_changed')=>{
  setStatus(s=>s==='ready'?'ready':'loading');
  try{
   // Recompute first when needed (server decides: TTL / data change), then read. A failed recomputation never hides
   // the last recommendations.
   try{await api(`projects/${projectId}/next-best-actions/ensure-fresh`,'POST',{reason});if(reason==='data_changed')onCleaned()}catch{/* keep last state */}
   const r=await api(`projects/${projectId}/next-best-actions/home`);
   setModel(buildTodayModel((r?.items??[]) as TodayRow[]));setStatus('ready');
  }catch{setStatus('error')}
 };
 // Loads once when shown ("open": the server recomputes only if stale), and once more after each data change the user
 // made (dirty → "data_changed"); never on a timer, never on a plain re-render.
 useEffect(()=>{if(mounted.current&&!dirty)return;if(!mounted.current)track('ZF_TODAY_VIEWED');mounted.current=true;void load(dirty?'data_changed':'open')},[projectId,dirty]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(model&&model.total>0)track('ZF_FIRST_RECOMMENDATION_VISIBLE')},[model]);// eslint-disable-line react-hooks/exhaustive-deps
 const onPrimary=(c:TodayCard)=>{track('ZF_FIRST_MEANINGFUL_ACTION');onOpenProspect(c.prospectId)};
 const onVerifySignal=async(c:TodayCard,decision:'verify'|'reject')=>{
  if(!c.primary.signalId)return;setBusy(true);setNote('');
  // The review marks the data as changed (page api wrapper): the dirty effect recomputes once.
  try{await api(`signals/${c.primary.signalId}/review`,'POST',{decision});track('ZF_FIRST_MEANINGFUL_ACTION');setNote(tr(decision==='verify'?'today.verified':'today.rejected'))}
  catch(e){setNote(String((e as Error).message))}finally{setBusy(false)}
 };
 const counts=model?{contact:model.sections.contact.length,verify:model.sections.verify.length,engage:model.sections.engage.length}:null;
 return <section className="panel today-panel" data-testid="today" aria-busy={status==='loading'}>
  <div className="section-title"><h2>{tr('today.title')}</h2><button className="link" onClick={onAdvanced}>{tr('today.advancedView')}</button></div>
  {note&&<p className="notice" role="status">{note}</p>}
  {status==='loading'&&!model&&<p role="status">{tr('today.loading')}</p>}
  {status==='error'&&<p className="error" role="alert">{tr('today.error')} <button onClick={()=>void load('open')}>{tr('today.retry')}</button></p>}
  {model&&<>
   <p className="today-summary" role="status">{counts!.contact===0?tr('today.noContact'):tr('today.contactCount').replace('{n}',String(counts!.contact))}
    {counts!.verify>0?` ${tr('today.verifyCount').replace('{n}',String(counts!.verify))}`:''}
    {model.watched>0?` ${tr('today.watchedCount').replace('{n}',String(model.watched))}`:''}</p>
   {model.total===0&&<p className="muted">{tr('today.nothingRecent')}</p>}
   {SECTION_ORDER.filter(s=>model.sections[s].length>0).map(s=><div key={s} className="today-section">
    <h3>{tr(SECTION_TITLE[s])} ({model.sections[s].length})</h3>
    {model.sections[s].map(c=><Card key={c.id} card={c} locale={locale} busy={busy} onPrimary={onPrimary} onVerifySignal={onVerifySignal} track={track}/>)}
   </div>)}
  </>}
 </section>;
}
