'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {translate,type Locale,type TKey} from '../i18n';
import {REGISTRY,COMMERCIAL_SIGNAL_TYPES,type CommercialSignalType} from '../nba/registry';
import type {NbaAction,Statement} from '../nba/engine';
// Next Best Action V1 — "À faire maintenant". One card = WHO, WHAT, WHY NOW, PROOF, ACTION, readable in seconds. Every
// fact links to its source; inferences and unknowns are labelled as such. Buttons only record a HUMAN decision: nothing
// here sends, posts, comments or messages anyone. Drafts can be copied, never sent.
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export type ActionRow=Row;
type Row={id:string;prospect_id:string;recommended_action:NbaAction;rule:string;state:string;opportunity_score:number;fit_score:number|null;fit_basis:string;intent_score:number;
 timing_score:number;freshness_score:number;evidence_quality_score:number;primary_kind:string|null;primary_signal_type:CommercialSignalType|null;primary_evidence_status:string|null;
 signal_age_days:number|null;primary_detail:{relevance_reason?:string;suggested_angle?:string}|null;
 target:{role:string|null;role_alternatives:string[];person:{name:string}|null};
 explanation:{why_this_account:Statement[];why_now:Statement[];why_this_action:Statement[];inferred:Statement[];unknown:Statement[]};
 prepared_content:{kind:string;text?:string;suggested_comment?:string|null;suggested_dm_after_engagement?:string|null;angle?:string;reason?:string};
 expires_at:string;prospects?:{name:string;city:string|null;website:string|null}|null};

export const SECTIONS:{key:string;actions:NbaAction[];title:TKey}[]=[
 {key:'contact',actions:['CONTACT'],title:'nba.section.contact'},
 {key:'engage',actions:['ENGAGE'],title:'nba.section.engage'},
 {key:'watch',actions:['WATCH'],title:'nba.section.watch'},
 {key:'wait',actions:['WAIT'],title:'nba.section.wait'},
];
export const typeLabel=(t:CommercialSignalType|null,locale:Locale)=>t?REGISTRY.find(e=>e.type===t)?.label[locale]??t:null;
const safeHref=(u:string|null)=>{if(!u)return null;try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'?x.href:null}catch{return null}};

function Statements({items,locale}:{items:Statement[];locale:Locale}){
 const tr=(k:TKey)=>translate(locale,k);
 return <ul className="nba-statements">{items.map((s,i)=><li key={i} className={`nba-${s.kind}`}><span className="pill">{tr(`nba.kind.${s.kind}` as TKey)}</span> {s.text}
  {s.refs.map(r=>{const href=safeHref(r.source_url);return href?<a key={r.id} href={href} target="_blank" rel="noreferrer"> {tr('nba.openSource')} ↗</a>:null})}</li>)}</ul>;
}

function Card({row,locale,busy,onDecide,onOpenProspect}:{row:Row;locale:Locale;busy:boolean;onDecide:(id:string,body:Record<string,unknown>)=>void;onOpenProspect:(id:string)=>void}){
 const tr=(k:TKey)=>translate(locale,k);
 const [copied,setCopied]=useState('');
 const copy=async(text:string,key:string)=>{try{await navigator.clipboard.writeText(text);setCopied(key)}catch{setCopied('')}};
 const who=row.prospects?.name??'—';
 const person=row.target.person?.name??tr('nba.personUnknown');
 const what=row.primary_kind==='conversation'?tr('nba.publicConversation'):typeLabel(row.primary_signal_type,locale)??tr('nba.noSignal');
 const age=row.signal_age_days===null?null:row.signal_age_days<=0?tr('nba.today'):tr('nba.daysAgo').replace('{n}',String(row.signal_age_days));
 const p=row.prepared_content;
 return <article className={`nba-card nba-${row.recommended_action.toLowerCase()}`}>
  <header className="nba-card-head">
   <div><p className="eyebrow">{tr(`nba.action.${row.recommended_action}` as TKey)}</p><h3><button className="text-button" onClick={()=>onOpenProspect(row.prospect_id)}>{who}</button></h3>
    <p className="muted">{tr('nba.who')} : {row.target.role??tr('nba.roleUnknown')} · {person}</p></div>
   <div className="nba-score" title={tr('nba.opportunityHint')}><b>{row.opportunity_score}</b><small>/100</small></div>
  </header>
  <p><b>{tr('nba.what')} :</b> {what}{age?` · ${age}`:''}{row.primary_evidence_status==='INFERRED'?<span className="pill"> {tr('nba.toVerify')}</span>:null}</p>
  <div><b>{tr('nba.whyNow')}</b><Statements items={row.explanation.why_now} locale={locale}/></div>
  {row.primary_detail?.suggested_angle&&<p><b>{tr('nba.angle')} :</b> {row.primary_detail.suggested_angle}</p>}
  <div><b>{tr('nba.whyAction')}</b><Statements items={row.explanation.why_this_action} locale={locale}/></div>
  <p className="nba-chips">{([['FIT',row.fit_score===null?'—':`${row.fit_score}${row.fit_basis==='estimated'?' ~':''}`],['INTENT',row.intent_score],['TIMING',row.timing_score],
   [tr('nba.freshness'),row.freshness_score],[tr('nba.evidenceQuality'),row.evidence_quality_score]] as [string,string|number][]).map(([k,v])=><span key={k} className="pill">{k} {v}</span>)}</p>
  <details><summary>{tr('nba.explain')}</summary>
   <p><b>{tr('nba.whyAccount')}</b></p><Statements items={row.explanation.why_this_account} locale={locale}/>
   {row.explanation.inferred.length>0&&<><p><b>{tr('nba.inferred')}</b></p><Statements items={row.explanation.inferred} locale={locale}/></>}
   {row.explanation.unknown.length>0&&<><p><b>{tr('nba.unknown')}</b></p><Statements items={row.explanation.unknown} locale={locale}/></>}
  </details>
  {p.kind==='contact_draft'&&p.text&&<details><summary>{tr('nba.draft')}</summary><p className="nba-draft">{p.text}</p><button className="text-button" onClick={()=>copy(p.text!,'draft')}>{copied==='draft'?tr('nba.copied'):tr('nba.copy')}</button></details>}
  {p.kind==='engage'&&<details><summary>{tr('nba.engageContent')}</summary>
   {p.suggested_comment&&<><p className="muted">{tr('nba.suggestedComment')}</p><p className="nba-draft">{p.suggested_comment}</p><button className="text-button" onClick={()=>copy(p.suggested_comment!,'comment')}>{copied==='comment'?tr('nba.copied'):tr('nba.copy')}</button></>}
   {p.suggested_dm_after_engagement&&<><p className="muted">{tr('nba.suggestedDm')}</p><p className="nba-draft">{p.suggested_dm_after_engagement}</p><button className="text-button" onClick={()=>copy(p.suggested_dm_after_engagement!,'dm')}>{copied==='dm'?tr('nba.copied'):tr('nba.copy')}</button></>}
  </details>}
  <p className="muted nba-human">{tr('nba.humanOnly')}</p>
  <div className="actions">
   <button disabled={busy} className="primary" onClick={()=>onDecide(row.id,{decision:'APPROVED',human_action:row.recommended_action})}>{tr('nba.approve')}</button>
   <button disabled={busy} onClick={()=>onDecide(row.id,{decision:'DONE',human_action:row.recommended_action})}>{tr('nba.done')}</button>
   <button disabled={busy} onClick={()=>onDecide(row.id,{decision:'SNOOZED',snooze_days:7})}>{tr('nba.snooze7')}</button>
   <button disabled={busy} className="text-button" onClick={()=>onDecide(row.id,{decision:'REJECTED'})}>{tr('nba.reject')}</button>
  </div>
 </article>;
}

// UI-5C: what the panel knows and can do, handed as-is to a v2 view (Activité 2.0). Same state, same calls, same decisions.
export type ActionsView={locale:Locale;today:Row[];queue:Row[];busy:boolean;error:string;note:string;
 filter:{signal_type:string;min_score:string;min_freshness:string};setFilter:(f:{signal_type:string;min_score:string;min_freshness:string})=>void;
 compute:()=>void;decide:(id:string,body:Record<string,unknown>)=>void;onOpenProspect:(id:string)=>void};
export function ActionsPanel({projectId,api,locale,disabled,onOpenProspect,view}:{projectId:string;api:Api;locale:Locale;disabled:boolean;onOpenProspect:(id:string)=>void;view?:(v:ActionsView)=>ReactNode}){
 const tr=(k:TKey)=>translate(locale,k);
 const [today,setToday]=useState<Row[]>([]),[queue,setQueue]=useState<Row[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const [filter,setFilter]=useState<{signal_type:string;min_score:string;min_freshness:string}>({signal_type:'',min_score:'',min_freshness:''});
 const generation=useRef(0);
 async function load(){
  const g=++generation.current;
  const q=new URLSearchParams();if(filter.signal_type)q.set('signal_type',filter.signal_type);if(filter.min_score)q.set('min_score',filter.min_score);if(filter.min_freshness)q.set('min_freshness',filter.min_freshness);
  const [t,list]=await Promise.all([api(`projects/${projectId}/next-best-actions/today?limit=10`),api(`projects/${projectId}/next-best-actions${q.size?`?${q}`:''}`)]);
  if(g!==generation.current)return;setToday(t.items??[]);setQueue(list??[]);
 }
 const run=async(f:()=>Promise<void>)=>{setBusy(true);setError('');try{await f()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 useEffect(()=>{void run(load)},[projectId,filter.signal_type,filter.min_score,filter.min_freshness]);
 const compute=()=>run(async()=>{const r=await api(`projects/${projectId}/next-best-actions/compute`,'POST',{});setNote(tr('nba.computed').replace('{n}',String(r.prospects)).replace('{c}',String(r.by_action?.CONTACT??0)).replace('{e}',String(r.by_action?.ENGAGE??0)));await load()});
 const decide=(id:string,body:Record<string,unknown>)=>run(async()=>{await api(`next-best-actions/${id}/decision`,'POST',body);await load()});
 const off=disabled||busy;
 // UI-5C: the v2 view renders the same state and calls the same handlers; without it, the legacy markup below is unchanged.
 if(view)return <>{view({locale,today,queue,busy:off,error,note,filter,setFilter,compute,decide,onOpenProspect})}</>;
 return <section className="card nba-panel">
  <div className="section-title"><h2>{tr('nba.title')}</h2><button className="primary" disabled={off} onClick={compute}>{tr('nba.compute')}</button></div>
  <p className="muted">{tr('nba.intro')}</p>
  {note&&<p role="status" className="notice">{note}</p>}{error&&<p role="alert" className="error">{error}</p>}
  <div className="nba-filters">
   <label>{tr('nba.filter.signalType')}<select value={filter.signal_type} onChange={e=>setFilter(f=>({...f,signal_type:e.target.value}))}><option value="">{tr('common.all')}</option>{COMMERCIAL_SIGNAL_TYPES.map(t=><option key={t} value={t}>{typeLabel(t,locale)}</option>)}</select></label>
   <label>{tr('nba.filter.minScore')}<input type="number" min="0" max="100" value={filter.min_score} onChange={e=>setFilter(f=>({...f,min_score:e.target.value}))}/></label>
   <label>{tr('nba.filter.minFreshness')}<input type="number" min="0" max="100" value={filter.min_freshness} onChange={e=>setFilter(f=>({...f,min_freshness:e.target.value}))}/></label>
  </div>
  <h3>{tr('nba.section.today')} <span className="muted">({today.length}/10)</span></h3>
  {today.length?today.map(r=><Card key={r.id} row={r} locale={locale} busy={off} onDecide={decide} onOpenProspect={onOpenProspect}/>):<p className="muted">{tr('nba.emptyToday')}</p>}
  {SECTIONS.map(s=>{const rows=queue.filter(r=>s.actions.includes(r.recommended_action)&&!today.some(t=>t.id===r.id));
   return <details key={s.key} open={s.key!=='wait'&&rows.length>0}><summary>{tr(s.title)} ({rows.length})</summary>
    {rows.map(r=><Card key={r.id} row={r} locale={locale} busy={off} onDecide={decide} onOpenProspect={onOpenProspect}/>)}</details>})}
 </section>;
}
