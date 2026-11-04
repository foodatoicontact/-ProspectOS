'use client';
// « Importer mon entreprise » — step 2B, the review screen (docs/ICP_IMPORT.md). Mobile first, usable with one hand: the
// decisive buttons sit in a bar at the bottom of the screen, every target is at least 44 px.
// The state comes from the database (the project's latest import, re-validated on every read) and is refreshed by
// polling while an import runs: a reload or a lost network shows the same import again, never a crash. Every value is
// editable, carries its confidence and shows its source on tap; empty values stand out. Nothing is applied without a
// person's click on « Valider » (validate_icp_import, under their own identity). Texts: src/icp-import/messages.ts.
import {Component,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {Locale} from '../i18n/locale';
import type {IcpProfile} from '../domain/icp/schema';
import {icpClient,loadLatest,saveDraft,loadDraft,clearDraft,clearAllDrafts,type ImportDetail,type Source,type ValidateResult} from '../icp-import/client';
import {viewOf,nextPollDelay,confidenceOf,setValue,removeAt,addValue,addZones,answerQuestion,isUnmonitored,MANUAL_SOURCE,type ImportRow,type Path,type EditResult} from '../icp-import/review';
import {parseIcpProfile} from '../domain/icp/schema';
import {DEPARTMENTS} from '../discovery/geo-fr';
import {icpText,errorText,SIGNAL_LABELS,type IcpMessageKey} from '../icp-import/messages';

const MAX_FILE=4*1024*1024;
const CSS=`
.icp-import{display:grid;gap:16px;min-width:0;margin-bottom:22px}
.icp-import .card{min-width:0}
.icp-import h2{margin-bottom:6px}
.icp-import .icp-lead{margin:0 0 12px;color:#56655a;font-size:13px}
.icp-tabs{display:flex;gap:6px;margin:8px 0 4px}
.icp-tabs button{flex:1;min-height:44px;font-size:13px}
.icp-tabs button[aria-pressed="true"]{background:var(--ink,#19342c);color:#fff;border-color:var(--ink,#19342c)}
.icp-import input,.icp-import textarea{font-size:16px}
.icp-count{text-align:right;margin:4px 0 0}
.icp-error{background:#f6e3de;color:#8a3b2b;border-radius:8px;padding:10px 12px;font-size:13px;margin:10px 0;overflow-wrap:anywhere}
.icp-info{background:#f3f7ec;color:#3d5a40;border-radius:8px;padding:10px 12px;font-size:13px;margin:10px 0}
.icp-pending{display:grid;gap:10px}
.icp-steps{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.icp-steps li{display:flex;gap:10px;align-items:center;font-size:14px;color:#7c8881}
.icp-steps li.done{color:var(--green,#236c53)}.icp-steps li.now{color:var(--ink,#19342c);font-weight:600}
.icp-steps i{width:10px;height:10px;border-radius:50%;background:#dce3dc;flex-shrink:0}
.icp-steps li.done i{background:var(--green,#236c53)}
.icp-steps li.now i{background:#d8b44a;animation:icp-pulse 1.2s ease-in-out infinite}
@keyframes icp-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.icp-steps li.now i{animation:none}}
.icp-section{border-top:1px solid var(--line,#e5e9e4);padding-top:12px;margin-top:12px}
.icp-section>h3{margin:0 0 8px;font-size:15px}
.icp-field{margin:0 0 12px;min-width:0}
.icp-field>label{margin:0 0 4px;font-size:13px}
.icp-field.is-empty input,.icp-field.is-empty textarea{border-color:#d8b44a;background:#fffbea}
.icp-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}
.icp-badge{font-size:11px;font-weight:700;border-radius:5px;padding:3px 7px;white-space:nowrap}
.icp-badge.high{background:#e4f0da;color:#2f6a3a}.icp-badge.medium{background:#faf1d8;color:#7a5d12}.icp-badge.low{background:#f6e3de;color:#8a3b2b}.icp-badge.empty{background:#fff3c4;color:#7a5d12}
.icp-badge.unmonitored{background:#f1f3ee;color:#66725f}
.icp-import .text-button{font-size:13px;min-height:44px;padding:8px 6px}
.icp-quote{margin:6px 0 0;padding:8px 10px;border-left:3px solid #bad498;background:#f7f9f3;font-size:13px;overflow-wrap:anywhere}
.icp-item{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:start;border:1px solid var(--line,#e5e9e4);border-radius:10px;padding:10px;margin-bottom:8px;min-width:0}
.icp-item>div{min-width:0}
.icp-item p{margin:0;font-size:14px;overflow-wrap:anywhere}
.icp-add{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:4px}
.icp-add button{min-height:44px}
.icp-question{border:1px solid #d6e4c9;background:#f3f7ec;border-radius:12px;padding:14px}
.icp-question p{margin:4px 0 10px;font-size:15px;font-weight:600}
.icp-question .row{display:flex;gap:8px;margin-top:8px}
.icp-question .row button{flex:1;min-height:44px}
.icp-bar{position:sticky;bottom:0;z-index:3;background:#fff;border-top:1px solid var(--line,#e5e9e4);padding:10px 0 calc(10px + env(safe-area-inset-bottom));margin-top:8px}
.icp-choices{border-top:1px solid var(--line,#e5e9e4);margin-top:12px;padding-top:6px}
.icp-choices .checkbox{margin:8px 0;font-size:14px;min-height:44px;align-items:center}
.icp-bar .row{display:grid;grid-template-columns:1fr 2fr;gap:8px}
.icp-bar button{min-height:48px;font-size:15px}
.icp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.icp-actions button{min-height:44px;flex:1 1 140px}
/* Inside the v2 shell on a phone, the bar sits just above the bottom navigation. */
.pos-ui .icp-bar{bottom:calc(var(--pos-bottomnav-h,64px) + env(safe-area-inset-bottom,0px));padding-bottom:10px}
@media(min-width:1024px){.icp-bar,.pos-ui .icp-bar{position:static;border-top:0;padding:0}.icp-bar .row{grid-template-columns:auto auto;justify-content:end}}
`;

// A broken render (should never happen: the profile is re-validated) falls back to the "to re-import" state.
class Guard extends Component<{fallback:ReactNode;children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?this.props.fallback:this.props.children}
}

type Leaf={value:unknown;source:string|null;confidence:number};

export function IcpImport({locale,projectId,token,onValidated,onUnauthorized}:{locale:Locale;projectId:string;token:string;onValidated:()=>void;onUnauthorized:()=>void}){
 const t=useCallback((k:IcpMessageKey,v?:Record<string,string|number>)=>icpText(locale,k,v),[locale]);
 const client=useMemo(()=>icpClient(token),[token]);
 const [row,setRow]=useState<ImportRow|null>(null);
 const [detail,setDetail]=useState<ImportDetail|null>(null);
 const [profile,setProfile]=useState<IcpProfile|null>(null);
 const [restored,setRestored]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [picker,setPicker]=useState<null|'new'|'retry'>(null);
 const [submittedAt,setSubmittedAt]=useState<number|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [failures,setFailures]=useState(0);
 const [now,setNow]=useState(()=>Date.now());
 const [qIndex,setQIndex]=useState(0);
 const [keepOffer,setKeepOffer]=useState(false);const [keepCriteria,setKeepCriteria]=useState(false);
 const [result,setResult]=useState<ValidateResult|null>(null);
 const [notice,setNotice]=useState('');
 const lastSource=useRef<Source|null>(null);
 const rowKey=useRef('');
 const pinned=useRef<string|null>(null);
 const [previousDraft,setPreviousDraft]=useState<string|null>(null);
 // An expired session is a sign-out: the drafts kept in this tab go with it.
 const signedOut=useCallback(()=>{clearAllDrafts();onUnauthorized()},[onUnauthorized]);
 const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);

 const adopt=useCallback((r:ImportRow|null,d:ImportDetail|null)=>{
  setRow(r);setDetail(d);
  if(r&&d&&r.status==='EXTRACTED'&&d.profile){
   const draft=parseIcpProfile(loadDraft(r.id));
   setProfile(draft.ok?draft.profile:d.profile);setRestored(draft.ok);
  }else{setProfile(null);setRestored(false)}
 },[]);
 const refresh=useCallback(async()=>{
  const r=await loadLatest(client,projectId,pinned.current);
  if(!live.current)return;
  setNow(Date.now());setLoaded(true);
  if(r.ok){setFailures(0);setPreviousDraft(r.data.previousDraft);if(pinned.current&&r.data.row?.id!==pinned.current)pinned.current=null;const key=`${r.data.row?.id}:${r.data.row?.status}`;if(key!==rowKey.current){rowKey.current=key;setQIndex(0)}adopt(r.data.row,r.data.detail);return}
  if(r.status===401){signedOut();return}
  if(r.network)setFailures(f=>f+1);else setError(errorText(locale,r.code,r.error));
 },[client,projectId,adopt,signedOut,locale]);
 useEffect(()=>{setRow(null);setDetail(null);setProfile(null);setLoaded(false);setPicker(null);setResult(null);setError('');refresh()},[projectId,refresh]);

 const view=viewOf(row,profile??detail?.profile,now);
 const running=view.kind==='pending'||submittedAt!==null;
 // Polling while an import runs (ours, or one started before a reload); backing off while the network is down.
 useEffect(()=>{
  if(!running&&failures===0)return;
  const id=setTimeout(refresh,nextPollDelay(failures));
  return()=>clearTimeout(id);
 },[running,failures,refresh,row?.status,now]);
 useEffect(()=>{if(!running)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[running]);

 async function submit(source:Source){
  lastSource.current=source;pinned.current=null;setError('');setNotice('');setResult(null);setSubmittedAt(Date.now());
  const res=picker==='retry'&&row?await client.retry(row.id,source):await client.create(projectId,source);
  if(!live.current)return;
  setSubmittedAt(null);
  if(res.ok){setPicker(null);setQIndex(0);adopt(res.data.import,res.data);return}
  if(res.status===401){signedOut();return}
  setError(errorText(locale,res.code,res.error));
  if(res.network)setFailures(f=>f+1);
  refresh();
 }
 function edit(r:EditResult){
  if(!r.ok){setError(errorText(locale,'INVALID_PROFILE',undefined));return}
  setError('');setProfile(r.profile);if(row)saveDraft(row.id,r.profile);
 }
 async function validate(){
  if(!row||!profile)return;
  setBusy(true);setError('');
  const r=await client.validate(row.id,profile,keepOffer,keepCriteria);
  setBusy(false);
  if(!r.ok){if(r.status===401)return signedOut();setError(errorText(locale,r.code,r.error));return}
  clearDraft(row.id);pinned.current=null;setResult(r.data);await refresh();onValidated();
 }
 async function discard(){
  if(!row)return;setBusy(true);const r=await client.discard(row.id);setBusy(false);
  if(!r.ok){setError(errorText(locale,r.code,r.error));return}
  clearDraft(row.id);pinned.current=null;refresh();
 }
 async function erase(){
  if(!row||!window.confirm(t('eraseConfirm')))return;
  setBusy(true);const r=await client.erase(row.id);setBusy(false);
  if(!r.ok){setError(errorText(locale,r.code,r.error));return}
  clearDraft(row.id);pinned.current=null;setNotice(t('erased'));setResult(null);refresh();
 }
 function retry(){
  if(lastSource.current){setPicker('retry');submit(lastSource.current);return}
  setPicker('retry');setNotice(t('retryNeedsSource'));
 }

 const offline=failures>0?<p className="icp-info" role="status">{t('offline',{s:Math.round(nextPollDelay(failures)/1000)})}</p>:null;
 const errorBox=error?<p className="icp-error" role="alert">{error}</p>:null;
 const noticeBox=notice?<p className="icp-info" role="status">{notice}</p>:null;
 const eraseButton=row&&view.kind!=='pending'?<button type="button" className="text-button" disabled={busy} onClick={erase}>{t('erase')}</button>:null;

 let body:ReactNode;
 if(!loaded){body=<p className="muted" role="status">{t('pendingStep1')}…</p>}
 else if(running){
  const elapsed=submittedAt!==null&&view.kind!=='pending'?Math.floor((now-submittedAt)/1000):view.kind==='pending'?view.elapsedS:0;
  const step=elapsed<5?0:elapsed<25?1:2;
  body=<div className="icp-pending" role="status" aria-live="polite">
   <h3>{t('pendingTitle')}</h3>
   <ol className="icp-steps">{(['pendingStep1','pendingStep2','pendingStep3'] as const).map((k,i)=><li key={k} className={i<step?'done':i===step?'now':''}><i aria-hidden="true"/>{t(k)}</li>)}</ol>
   <p className="muted">{t('pendingElapsed',{s:elapsed})}</p>
   <p className="muted">{t('pendingLeave')}</p>
  </div>;
 }
 else if(picker||view.kind==='empty')body=<SourcePicker t={t} onSubmit={submit} onCancel={view.kind==='empty'?null:()=>{setPicker(null);setNotice('')}}/>;
 else if(view.kind==='review'&&profile)body=<Guard fallback={<Unreadable t={t} onRetry={retry} erase={eraseButton}/>}>
  <Review t={t} locale={locale} profile={profile} restored={restored} questions={row?.missing_questions??[]} qIndex={qIndex}
   onAnswer={(key,text)=>{edit(answerQuestion(profile,key,text));setQIndex(i=>i+1)}} onSkip={()=>setQIndex(i=>i+1)}
   onSet={(path,v)=>edit(setValue(profile,path,v))} onRemove={path=>edit(removeAt(profile,path))}
   onAdd={(path,v)=>edit(path.join('.')==='company.interventionZones'?addZones(profile,String(v)):addValue(profile,path,v))}/>
  <div className="icp-choices">
   <label className="checkbox"><input type="checkbox" checked={keepOffer} onChange={e=>setKeepOffer(e.target.checked)}/>{t('keepOffer')}</label>
   <label className="checkbox"><input type="checkbox" checked={keepCriteria} onChange={e=>setKeepCriteria(e.target.checked)}/>{t('keepCriteria')}</label>
   {eraseButton}
  </div>
  {/* The two decisions, always within reach of the thumb. */}
  <div className="icp-bar">
   <div className="row"><button type="button" disabled={busy} onClick={discard}>{t('reject')}</button><button type="button" className="primary" disabled={busy} onClick={validate}>{busy?t('validating'):t('validate')}</button></div>
  </div>
 </Guard>;
 else if(view.kind==='unreadable')body=<Unreadable t={t} onRetry={retry} erase={eraseButton}/>;
 else if(view.kind==='failed')body=<div><h3>{t('failedTitle')}</h3><p className="icp-error" role="alert">{errorText(locale,view.error,view.row.stale?undefined:detail?.message)}</p>
  {previousDraft&&<p className="icp-info">{t('previousDraftNote')}</p>}
  <div className="icp-actions"><button type="button" className="primary" onClick={retry}>{t('retry')}</button>
   {previousDraft&&<button type="button" onClick={()=>{pinned.current=previousDraft;setError('');refresh()}}>{t('previousDraft')}</button>}{eraseButton}</div></div>;
 else if(view.kind==='validated')body=<div><h3>{t('validatedTitle')}</h3><p>{t('validatedBody')}</p>
  {result?.criteria_kept.length?<p className="muted">{t('validatedKept',{k:result.criteria_kept.join(', ')})}</p>:null}
  <div className="icp-actions"><button type="button" onClick={()=>setPicker('new')}>{t('newImport')}</button>{eraseButton}</div></div>;
 else body=<div><h3>{t('discardedTitle')}</h3><p>{t('discardedBody')}</p><div className="icp-actions"><button type="button" className="primary" onClick={()=>setPicker('new')}>{t('newImport')}</button>{eraseButton}</div></div>;

 return <section className="icp-import" aria-labelledby="icp-import-title" data-state={running?'pending':view.kind}>
  <style href="icp-import" precedence="default">{CSS}</style>
  <div className="card">
   <p className="eyebrow">{t('title').toUpperCase()}</p>
   <h2 id="icp-import-title">{view.kind==='review'?t('reviewTitle'):t('title')}</h2>
   <p className="icp-lead">{view.kind==='review'?t('reviewIntro'):t('intro')}</p>
   {offline}{errorBox}{noticeBox}{body}
  </div>
 </section>;
}

function Unreadable({t,onRetry,erase}:{t:(k:IcpMessageKey)=>string;onRetry:()=>void;erase:ReactNode}){
 return <div data-state="unreadable"><h3>{t('unreadableTitle')}</h3><p>{t('unreadableBody')}</p>
  <div className="icp-actions"><button type="button" className="primary" onClick={onRetry}>{t('retry')}</button>{erase}</div></div>;
}

function SourcePicker({t,onSubmit,onCancel}:{t:(k:IcpMessageKey,v?:Record<string,string|number>)=>string;onSubmit:(s:Source)=>void;onCancel:(()=>void)|null}){
 const [tab,setTab]=useState<'file'|'text'>('file');
 const [file,setFile]=useState<File|null>(null);
 const [text,setText]=useState('');
 const tooLarge=!!file&&file.size>MAX_FILE;
 const ready=tab==='file'?!!file&&!tooLarge:text.trim().length>=30&&text.length<=50000;
 return <form onSubmit={e=>{e.preventDefault();if(!ready)return;onSubmit(tab==='file'?{kind:'file',file:file!,name:file!.name}:{kind:'text',text})}}>
  <div className="icp-tabs" role="group">
   <button type="button" aria-pressed={tab==='file'} onClick={()=>setTab('file')}>{t('tabFile')}</button>
   <button type="button" aria-pressed={tab==='text'} onClick={()=>setTab('text')}>{t('tabText')}</button>
  </div>
  {tab==='file'?<label>{t('fileLabel')}<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
   :<label>{t('textLabel')}<textarea rows={8} value={text} maxLength={50000} onChange={e=>setText(e.target.value)}/><small className="icp-count">{t('textCount',{n:text.length})}</small></label>}
  {tooLarge&&<p className="icp-error" role="alert">{t('fileTooLarge')}</p>}
  <p className="muted">{t('privacy')}</p>
  <div className="icp-actions">{onCancel&&<button type="button" onClick={onCancel}>{t('cancel')}</button>}<button className="primary" disabled={!ready}>{t('start')}</button></div>
 </form>;
}

type ReviewProps={t:(k:IcpMessageKey,v?:Record<string,string|number>)=>string;locale:Locale;profile:IcpProfile;restored:boolean;questions:{key:string;question:string}[];qIndex:number;
 onAnswer:(key:string,text:string)=>void;onSkip:()=>void;onSet:(p:Path,v:unknown)=>void;onRemove:(p:Path)=>void;onAdd:(p:Path,v:unknown)=>void};

function Review(props:ReviewProps){
 const {t,locale,profile:p,restored,questions,qIndex}=props;
 return <div>
  {restored&&<p className="icp-info" role="status">{t('restored')}</p>}
  <Questions {...props} questions={questions} qIndex={qIndex}/>
  <Section title={t('sectionCompany')}>
   <Field {...props} label={t('fName')} leaf={p.company.name} path={['company','name']} max={200}/>
   <Field {...props} label={t('fActivity')} leaf={p.company.activity} path={['company','activity']} max={500} multiline/>
   <h4 className="muted">{t('fSites')}</h4>
   {p.company.sites.length?p.company.sites.map((s,i)=><Item key={i} {...props} leaf={s} path={['company','sites',i]}>
    <p>{s.value?.city}{s.value?.department?` (${s.value.department})`:''} · {t(`role${s.value?.role??'HQ'}` as IcpMessageKey)}</p></Item>):<p className="muted">{t('empty')}</p>}
   <ListOf {...props} label={t('fZones')} items={p.company.interventionZones} path={['company','interventionZones']} placeholder={t('zonesPlaceholder')} readOnly/>
   {p.company.coverage?.value&&<><h4 className="muted">{t('fCoverage')}</h4><Item {...props} leaf={p.company.coverage} path={['company','coverage']}><p>{t(`coverage${p.company.coverage.value}` as IcpMessageKey)}</p></Item></>}
  </Section>
  <Section title={t('sectionOffer')}>
   <ListOf {...props} label={t('fServices')} items={p.offer.services} path={['offer','services']} max={200}/>
   <h4 className="muted">{t('fPromises')}</h4>
   {p.offer.promises.map((pr,i)=><Item key={i} {...props} leaf={pr} path={['offer','promises',i]}><p>{pr.value?.text}</p></Item>)}
   <ListOf {...props} label={t('fDifferentiators')} items={p.offer.differentiators} path={['offer','differentiators']} max={300}/>
   <ListOf {...props} label={t('fProofs')} items={p.offer.proofs} path={['offer','proofs']} max={300}/>
  </Section>
  <Section title={t('sectionTarget')}>
   {p.segments.length?p.segments.map((s,i)=><div key={s.key} className="icp-item"><div>
    <Field {...props} label={t('fSegments')} leaf={s.label} path={['segments',i,'label']} max={120}/>
    <p className="muted">{[s.sizeRange.value?`${t('fSize')} : ${s.sizeRange.value.join(', ')}`:'',s.priority.value?`${t('fPriority')} : ${s.priority.value}`:'',s.estimatedValue.value?`${t('fValue')} : ${s.estimatedValue.value}`:'',s.salesCycle.value?`${t('fCycle')} : ${s.salesCycle.value}`:''].filter(Boolean).join(' · ')}</p>
   </div><button type="button" className="text-button" onClick={()=>props.onRemove(['segments',i])}>{t('remove')}</button></div>):<p className="muted">{t('empty')}</p>}
  </Section>
  <Section title={t('sectionPersonas')}>
   {p.personas.length?p.personas.map((pe,i)=><div key={i} className="icp-item"><div>
    <Field {...props} label={t('fRole')} leaf={pe.role} path={['personas',i,'role']} max={120}/>
    {pe.painPoints.length>0&&<p className="muted">{t('fPains')} : {pe.painPoints.map(x=>x.value).filter(Boolean).join(' ; ')}</p>}
   </div><button type="button" className="text-button" onClick={()=>props.onRemove(['personas',i])}>{t('remove')}</button></div>):<p className="muted">{t('empty')}</p>}
  </Section>
  <Section title={t('sectionSignals')}>
   {p.signals.length?p.signals.map((s,i)=><Item key={i} {...props} leaf={s.type} path={['signals',i]} noBadge>
    <p>{SIGNAL_LABELS[locale][s.type.value??'']??s.type.value} {isUnmonitored(s.type.value)&&<span className="icp-badge unmonitored" data-unmonitored="true">{t('unmonitored')}</span>}</p></Item>):<p className="muted">{t('empty')}</p>}
  </Section>
  <Section title={t('sectionExclusions')}>
   {p.exclusions.length?p.exclusions.map((x,i)=><div key={i} className="icp-item"><div><Field {...props} label={t('fReason')} leaf={x.label} path={['exclusions',i,'label']} max={120}/></div>
    <button type="button" className="text-button" onClick={()=>props.onRemove(['exclusions',i])}>{t('remove')}</button></div>):<p className="muted">{t('empty')}</p>}
  </Section>
 </div>;
}

function Questions({t,questions,qIndex,onAnswer,onSkip}:ReviewProps){
 const [answer,setAnswer]=useState('');
 if(!questions.length)return null;
 const q=questions[qIndex];
 if(!q)return <p className="icp-info" role="status">{t('questionsDone')}</p>;
 return <div className="icp-question" aria-live="polite">
  <small>{t('questionsTitle',{n:questions.length})} · {t('questionOf',{i:qIndex+1,n:questions.length})}</small>
  <p id="icp-q">{q.question}</p>
  <input aria-labelledby="icp-q" value={answer} maxLength={500} onChange={e=>setAnswer(e.target.value)}/>
  <div className="row"><button type="button" onClick={()=>{setAnswer('');onSkip()}}>{t('skip')}</button><button type="button" className="primary" disabled={!answer.trim()} onClick={()=>{onAnswer(q.key,answer);setAnswer('')}}>{t('answer')}</button></div>
 </div>;
}

function Section({title,children}:{title:string;children:ReactNode}){return <section className="icp-section"><h3>{title}</h3>{children}</section>}

function Meta({t,leaf,noBadge}:{t:ReviewProps['t'];leaf:Leaf;noBadge?:boolean}){
 const [open,setOpen]=useState(false);
 const c=confidenceOf(leaf);
 const label:Record<typeof c,IcpMessageKey>={high:'cHigh',medium:'cMedium',low:'cLow',empty:'cEmpty'};
 return <><div className="icp-meta">
  {!noBadge&&<span className={`icp-badge ${c}`}>{t(label[c])}</span>}
  {leaf.value!==null&&<button type="button" className="text-button" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>{t('source')}</button>}
 </div>{open&&<blockquote className="icp-quote">{leaf.source===MANUAL_SOURCE?t('sourceManual'):leaf.source??t('noSource')}</blockquote>}</>;
}

function Field(props:ReviewProps&{label:string;leaf:Leaf;path:Path;max:number;multiline?:boolean}){
 const {t,label,leaf,path,max,multiline,onSet}=props;
 const id=`icp-${path.join('-')}`;const value=typeof leaf.value==='string'?leaf.value:'';
 return <div className={`icp-field${leaf.value===null?' is-empty':''}`}>
  <label htmlFor={id}>{label}</label>
  {multiline?<textarea id={id} rows={3} value={value} maxLength={max} onChange={e=>onSet(path,e.target.value)}/>:<input id={id} value={value} maxLength={max} onChange={e=>onSet(path,e.target.value)}/>}
  <Meta t={t} leaf={leaf}/>
 </div>;
}

function Item(props:ReviewProps&{leaf:Leaf;path:Path;children:ReactNode;noBadge?:boolean}){
 return <div className="icp-item"><div>{props.children}<Meta t={props.t} leaf={props.leaf} noBadge={props.noBadge}/></div>
  <button type="button" className="text-button" onClick={()=>props.onRemove(props.path)}>{props.t('remove')}</button></div>;
}

function ListOf(props:ReviewProps&{label:string;items:Leaf[];path:Path;max?:number;placeholder?:string;readOnly?:boolean}){
 const {t,label,items,path,max=200,placeholder,readOnly,onAdd,onSet}=props;
 const [draft,setDraft]=useState('');
 return <div className="icp-field">
  <h4 className="muted">{label}</h4>
  {items.length===0&&<p className="muted">{t('empty')}</p>}
  {items.map((it,i)=><Item key={i} {...props} leaf={it} path={[...path,i]}>
   {readOnly?<p>{String(it.value)}{DEPARTMENTS.find(d=>d.code===it.value)?` · ${DEPARTMENTS.find(d=>d.code===it.value)!.name}`:''}</p>:<input aria-label={`${label} ${i+1}`} value={typeof it.value==='string'?it.value:''} maxLength={max} onChange={e=>onSet([...path,i],e.target.value)}/>}
  </Item>)}
  <div className="icp-add"><input aria-label={`${t('add')} — ${label}`} placeholder={placeholder??t('addPlaceholder')} value={draft} maxLength={max} onChange={e=>setDraft(e.target.value)}/>
   <button type="button" disabled={!draft.trim()} onClick={()=>{onAdd(path,draft);setDraft('')}}>{t('add')}</button></div>
 </div>;
}
