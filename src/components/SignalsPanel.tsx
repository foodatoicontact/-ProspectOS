'use client';
import {useEffect,useRef,useState} from 'react';
import type {Prospect} from '../domain/core';
import {scoreIntent,DEFAULT_INTENT_WEIGHTS,type IntentScore,type IntentSignal,type IntentLine} from '../domain/intent';
import {SIGNAL_TYPES,signalConfidence,type SignalType,type SignalStatus} from '../signals/types';
import {FixtureSignalProvider} from '../signals/providers/fixture';
import {translate,type Locale,type TKey} from '../i18n';
// Signal Engine S6 — "INTENT — pourquoi maintenant ?" on the prospect card. Dated, sourced public facts that may make
// the company relevant to contact NOW. A signal is never evidence: it never changes the FIT score. It counts for the
// verified INTENT only once a person verified it; until then it only feeds the estimate. Nothing here decides a
// status or a score on its own: the server (or, in the demo, the same pure functions) does.
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Row=IntentSignal&{source_type?:string;provider?:string;rejection_reason?:string|null};
type Profile={types:Partial<Record<SignalType,number>>;terms:string[]};
const DAY=86400000;
const demoKey=(id:string)=>`prospectos-signals:${id}`;
const domainOf=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return null}};

export function SignalsPanel({prospect,mode,api,locale,disabled,onBusyChange}:{prospect:Prospect;mode:'demo'|'live';api:Api;locale:Locale;disabled:boolean;onBusyChange:(active:boolean)=>void}){
 const tr=(key:TKey)=>translate(locale,key);
 const [rows,setRows]=useState<Row[]>([]),[profile,setProfile]=useState<Profile|null>(null),[sources,setSources]=useState<{official_site:boolean;bodacc:boolean}|null>(null),[monitor,setMonitor]=useState<{frequency_days:number;next_run_at:string;paused_reason:string|null}|null>(null),[intent,setIntent]=useState<IntentScore|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[adding,setAdding]=useState(false);
 const [form,setForm]=useState({signal_type:'hiring_role' as SignalType,excerpt:'',source_url:'',event_date:''});
 const generation=useRef(0);
 const now=()=>new Date();
 const recompute=(list:Row[],p:Profile|null)=>{setRows(list);setIntent(scoreIntent(list,p,now()))};
 async function load(){
  const g=++generation.current;
  if(mode==='demo'){let list:Row[]=[];try{list=JSON.parse(localStorage.getItem(demoKey(prospect.id))??'[]')}catch{/* empty */}recompute(list,null);return}
  const r=await api(`prospects/${prospect.id}/signals`);if(g!==generation.current)return;
  setProfile(r.profile??null);setRows(r.signals);setIntent(r.intent);setSources(r.sources??null);setMonitor(r.monitor??null);
 }
 useEffect(()=>{setRows([]);setIntent(null);setError('');setNote('');setAdding(false);load().catch(()=>setError(tr('signals.unavailable')));return()=>{generation.current++}},[prospect.id,mode]);
 const persistDemo=(list:Row[])=>{try{localStorage.setItem(demoKey(prospect.id),JSON.stringify(list))}catch{/* private mode */}recompute(list,null)};
 async function execute(fn:()=>Promise<void>){if(disabled||busy)return;onBusyChange(true);setBusy(true);setError('');setNote('');try{await fn()}catch(e){setError(e instanceof Error?e.message:tr('error.generic'))}finally{setBusy(false);onBusyChange(false)}}

 const scan=()=>execute(async()=>{
  if(mode==='demo'){
   // Demo: deterministic TEST signals, clearly marked, never presented as real facts.
   const found=await new FixtureSignalProvider().searchSignals({target:{prospect_id:prospect.id,name:prospect.name,website:prospect.website||null,siren:null,city:prospect.city||null},types:[...SIGNAL_TYPES],now:now()});
   const known=new Set(rows.map(r=>r.source_url));
   const fresh:Row[]=found.filter(s=>!known.has(s.source_url)).map(s=>({id:crypto.randomUUID(),signal_type:s.signal_type,status:'PENDING_REVIEW',title:s.title,excerpt:s.excerpt,source_url:s.source_url,
    source_domain:domainOf(s.source_url),confidence:signalConfidence('test_fixture',s.event_date,s.published_at),event_date:s.event_date,published_at:s.published_at,observed_at:now().toISOString(),matched_terms:[],source_type:'test_fixture'}));
   persistDemo([...fresh,...rows]);setNote(tr('signals.scanFound').replace('{n}',String(fresh.length)).replace('{p}','1'));return;
  }
  const r=await api(`prospects/${prospect.id}/signal-scan`,'POST',{});
  const parts=[r.report.inserted?tr('signals.scanFoundAny').replace('{n}',String(r.report.inserted)):tr('signals.scanNoneAny')];
  if(r.sources?.official_site)parts.push(tr('signals.readSite').replace('{p}',String(r.pages||1)));
  if(r.sources?.bodacc)parts.push(tr('signals.readBodacc'));
  if(r.site_refusal&&r.sources?.bodacc)parts.push(tr('signals.siteSkipped'));
  if(r.warnings?.includes('COLLECTIVE_PROCEDURE'))parts.push(tr('signals.collectiveWarning'));
  setNote(parts.join(' '));
  await load();
 });
 const review=(row:Row,decision:'verify'|'reject'|'reset')=>execute(async()=>{
  if(mode==='demo'){const status:SignalStatus=decision==='verify'?'VERIFIED':decision==='reject'?'REJECTED':'PENDING_REVIEW';persistDemo(rows.map(r=>r.id===row.id?{...r,status}:r));return}
  await api(`signals/${row.id}/review`,'POST',{decision});await load();
 });
 const toggleMonitor=()=>execute(async()=>{await api(`prospects/${prospect.id}/monitor`,'POST',{enabled:!monitor});await load()});
 const add=()=>execute(async()=>{
  const body={signal_type:form.signal_type,excerpt:form.excerpt.trim(),source_url:form.source_url.trim(),...(form.event_date?{event_date:form.event_date}:{})};
  if(mode==='demo'){
   const row:Row={id:crypto.randomUUID(),signal_type:body.signal_type,status:'PENDING_REVIEW',title:body.excerpt.slice(0,120),excerpt:body.excerpt,source_url:body.source_url,source_domain:domainOf(body.source_url),
    confidence:signalConfidence('user_provided',form.event_date||null,null),event_date:form.event_date||null,published_at:null,observed_at:now().toISOString(),matched_terms:[],source_type:'user_provided'};
   persistDemo([row,...rows]);
  }else{const r=await api(`prospects/${prospect.id}/signals`,'POST',body);if(r.duplicate)setNote(tr('signals.duplicate'));await load()}
  setForm({signal_type:form.signal_type,excerpt:'',source_url:'',event_date:''});setAdding(false);
 });

 const typeLabel=(t:SignalType)=>tr(`signals.type.${t}` as TKey);
 const ago=(iso:string)=>{const d=Math.max(0,Math.floor((now().getTime()-new Date(iso).getTime())/DAY));return d===0?tr('signals.today'):tr('signals.daysAgo').replace('{n}',String(d))};
 const dateText=(r:Row)=>r.event_date?`${tr('signals.basis.event')} ${ago(`${r.event_date}T00:00:00Z`)}`:r.published_at?`${tr('signals.basis.published')} ${ago(r.published_at)}`:`${tr('signals.basis.observed')} ${ago(r.observed_at)}`;
 const lineOf=(id:string):IntentLine|undefined=>intent?.estimated.lines.find(l=>l.signal_id===id);
 const pending=rows.filter(r=>r.status==='PENDING_REVIEW'),verified=rows.filter(r=>r.status==='VERIFIED'),rejected=rows.filter(r=>r.status==='REJECTED');
 const isTest=(r:Row)=>r.source_type==='test_fixture';
 const card=(r:Row)=>{const l=lineOf(r.id);return <article key={r.id} className={`evidence-card signal-card tone-${r.status==='VERIFIED'?'verified':r.status==='REJECTED'?'contradicted':'pending'}`}>
  <header><div><h4>{r.title}</h4><small>{typeLabel(r.signal_type)} · {dateText(r)}</small></div>
   <span className={`pill status-pill tone-${r.status==='VERIFIED'?'verified':r.status==='REJECTED'?'contradicted':'pending'}`}>{isTest(r)?'TEST · ':''}{tr(`signals.status.${r.status}` as TKey)}</span></header>
  <blockquote>{r.excerpt}</blockquote>
  <p className="evidence-source">{tr('evidence.sourceLabel')} {r.source_domain??r.source_url} · <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">{tr('evidence.openSource')} ↗</a> · {tr('signals.confidence')} {Math.round(Number(r.confidence)*100)} %</p>
  {l&&l.points>0&&<p className="muted signal-points">{r.status==='VERIFIED'?'+':'≈ +'}{l.points} {tr('signals.points')} = {l.weight} × {l.confidence} × {l.recency.toFixed(2)} × {l.relevance}{l.multiplier<1?` × ${l.multiplier}`:''}</p>}
  {l&&l.points===0&&r.status!=='REJECTED'&&<p className="muted signal-points">{tr('signals.noPoints')}</p>}
  <div className="actions evidence-actions">
   {r.status!=='VERIFIED'&&<button className="primary" disabled={busy||disabled} onClick={()=>review(r,'verify')}>{tr('signals.verify')}</button>}
   {r.status!=='REJECTED'&&<button disabled={busy||disabled} onClick={()=>review(r,'reject')}>{tr('signals.reject')}</button>}
   {r.status!=='PENDING_REVIEW'&&<button className="text-button" disabled={busy||disabled} onClick={()=>review(r,'reset')}>{tr('signals.reset')}</button>}
  </div>
 </article>};
 // No source the scan can read (no official website, no SIREN from the register): said up front instead of after a
 // click. Adding a signal by hand stays available.
 const noSite=mode==='live'&&(sources?!sources.official_site&&!sources.bodacc:!prospect.website);
 const verifiedScore=intent?.score??0,estimatedScore=intent?.estimated.score??0;
 return <section className="signals-panel observations">
  <div className="section-title"><h3>{tr('signals.title')}</h3>
   <span className={`pill intent-pill${estimatedScore>verifiedScore?' estimated':''}`} title={tr('signals.scoreHint')}>INTENT {verifiedScore}/100{estimatedScore>verifiedScore&&<> · ≈ {estimatedScore} {tr('score.estimated')}</>}</span></div>
  <p className="muted">{tr('signals.intro')}</p>
  <div className="actions signal-actions">
   <button disabled={busy||disabled||noSite} onClick={scan}>{tr('signals.scan')}</button>
   <button className="text-button" disabled={busy||disabled} aria-expanded={adding} onClick={()=>setAdding(a=>!a)}>{tr('signals.add')}</button>
   {mode==='live'&&!noSite&&<button className="text-button" disabled={busy||disabled} aria-pressed={!!monitor} onClick={toggleMonitor}>{monitor?tr('signals.monitorStop'):tr('signals.monitorStart')}</button>}
  </div>
  {noSite&&<p className="muted">{tr('signals.noSite')}</p>}
  {mode==='live'&&sources&&(sources.official_site||sources.bodacc)&&<p className="muted signal-sources">{tr('signals.sourcesLabel')} {[sources.official_site&&tr('signals.sourceSite'),sources.bodacc&&tr('signals.sourceBodacc')].filter(Boolean).join(' · ')}</p>}
  {mode==='live'&&monitor&&<p className="muted signal-monitor">{monitor.paused_reason?tr(`signals.monitorPaused.${monitor.paused_reason}` as TKey):tr(monitor.frequency_days===1?'signals.monitorDaily':'signals.monitorWeekly').replace('{d}',new Date(monitor.next_run_at).toLocaleDateString(locale==='fr'?'fr-FR':'en-GB'))}</p>}
  {mode==='demo'&&<p className="muted">{tr('signals.demoNote')}</p>}
  {adding&&<form className="signal-form" onSubmit={e=>{e.preventDefault();add()}}>
   <label>{tr('signals.form.type')}<select value={form.signal_type} onChange={e=>setForm({...form,signal_type:e.target.value as SignalType})}>{SIGNAL_TYPES.map(t=><option key={t} value={t}>{typeLabel(t)}</option>)}</select></label>
   <label>{tr('signals.form.excerpt')}<textarea required maxLength={500} rows={3} value={form.excerpt} onChange={e=>setForm({...form,excerpt:e.target.value})}/></label>
   <label>{tr('signals.form.url')}<input type="url" required maxLength={2048} value={form.source_url} onChange={e=>setForm({...form,source_url:e.target.value})}/></label>
   <label>{tr('signals.form.date')}<input type="date" value={form.event_date} max={now().toISOString().slice(0,10)} onChange={e=>setForm({...form,event_date:e.target.value})}/></label>
   <p className="muted">{tr('signals.form.note')}</p>
   <div className="actions"><button className="primary" disabled={busy||disabled}>{tr('signals.form.save')}</button><button type="button" className="text-button" onClick={()=>setAdding(false)}>{tr('signals.form.cancel')}</button></div>
  </form>}
  {error&&<p role="alert" className="note">{error}</p>}
  {note&&<p role="status" className="muted">{note}</p>}
  {intent&&intent.lines.length>0&&<div className="intent-lines"><h4 className="evidence-group-title">{tr('signals.whyNow')}</h4><ul>{intent.lines.filter(l=>l.points>0).map(l=><li key={l.signal_id}><b>+{l.points}</b> {typeLabel(l.signal_type)} — {l.title} <small>· {l.source_domain??''} · {tr(`signals.strength.${l.strength}` as TKey)}</small></li>)}</ul></div>}
  {pending.length>0&&<div><h4 className="evidence-group-title">{tr('signals.toReview')} ({pending.length}){intent&&intent.pending.potential>0?` · ${tr('signals.upTo').replace('{n}',String(Math.round(intent.pending.potential)))}`:''}</h4>{pending.map(card)}</div>}
  {verified.length>0&&<details className="evidence-others" open={pending.length===0}><summary>{tr('signals.verifiedList')} ({verified.length})</summary>{verified.map(card)}</details>}
  {rejected.length>0&&<details className="evidence-others"><summary>{tr('signals.rejectedList')} ({rejected.length})</summary>{rejected.map(card)}</details>}
  {rows.length===0&&!error&&!note&&<p className="muted">{tr('signals.empty')}</p>}
  {mode==='live'&&<IntentProfileEditor projectId={prospect.project_id} profile={profile} api={api} locale={locale} disabled={busy||disabled} onSaved={async()=>{await load()}}/>}
 </section>;
}

// The project's INTENT settings: which signal types count and how much, and the words that make a signal relevant.
function IntentProfileEditor({projectId,profile,api,locale,disabled,onSaved}:{projectId:string;profile:Profile|null;api:Api;locale:Locale;disabled:boolean;onSaved:()=>Promise<void>}){
 const tr=(key:TKey)=>translate(locale,key);
 const initial=()=>({types:{...(profile?.types??DEFAULT_INTENT_WEIGHTS)} as Record<string,number>,terms:(profile?.terms??[]).join(', ')});
 const [state,setState]=useState(initial),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>setState(initial()),[JSON.stringify(profile)]);
 async function save(){
  setSaving(true);setMessage('');
  try{
   const types=Object.fromEntries(Object.entries(state.types).map(([k,v])=>[k,Math.max(0,Math.min(50,Math.round(Number(v)||0)))]));
   const terms=state.terms.split(',').map(t=>t.trim()).filter(t=>t.length>=2).slice(0,30);
   await api(`projects/${projectId}/intent-profile`,'POST',{types,terms});setMessage(tr('signals.profile.saved'));await onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:tr('error.generic'))}finally{setSaving(false)}
 }
 return <details className="evidence-others intent-profile"><summary>{tr('signals.profile.title')}{profile?'':` · ${tr('signals.profile.defaults')}`}</summary>
  <p className="muted">{tr('signals.profile.help')}</p>
  <div className="intent-weights">{SIGNAL_TYPES.map(t=><label key={t}><span>{tr(`signals.type.${t}` as TKey)}</span><input type="number" min={0} max={50} step={5} value={state.types[t]??0} onChange={e=>setState({...state,types:{...state.types,[t]:Number(e.target.value)}})}/></label>)}</div>
  <label>{tr('signals.profile.terms')}<input value={state.terms} maxLength={2000} placeholder={tr('signals.profile.termsPlaceholder')} onChange={e=>setState({...state,terms:e.target.value})}/></label>
  <div className="actions"><button className="primary" disabled={disabled||saving} onClick={save}>{tr('signals.profile.save')}</button></div>
  {message&&<p role="status" className="muted">{message}</p>}
 </details>;
}
