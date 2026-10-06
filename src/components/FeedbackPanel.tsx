'use client';
import {useState} from 'react';
import {translate,type Locale,type TKey} from '../i18n';
import type {FeedbackReport,Bucket} from '../domain/feedback';
// Signal Engine S8 — "what produced answers" for the project. Read on demand (collapsed by default), from contact
// snapshots and current statuses only. Under 10 contacts a rate is never shown: the sample is said to be too small.
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export function FeedbackPanel({projectId,api,locale}:{projectId:string;api:Api;locale:Locale}){
 const tr=(key:TKey)=>translate(locale,key);
 const [report,setReport]=useState<FeedbackReport|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function load(){setLoading(true);setError('');try{setReport(await api(`projects/${projectId}/feedback`))}catch{setError(tr('feedback.unavailable'))}finally{setLoading(false)}}
 const label=(group:string,key:string)=>key==='none'?tr('feedback.noSignal'):group==='type'?tr(`signals.type.${key}` as TKey)??key:group==='source'?tr(`feedback.source.${key}` as TKey)??key:group==='age'?`${key} ${tr('feedback.daysSuffix')}`:key==='unscored'?tr('feedback.unscored'):key;
 const pct=(b:Bucket,which:'answer_rate'|'meeting_rate')=>b.insufficient||b[which]===null?'—':`${b[which]} %`;
 const table=(title:string,rows:Bucket[],group:string)=>rows.length>0&&<div className="feedback-table"><h4>{title}</h4><table><thead><tr><th>{tr('feedback.segment')}</th><th>{tr('feedback.contacted')}</th><th>{tr('feedback.answerRate')}</th><th>{tr('feedback.meetingRate')}</th></tr></thead>
  <tbody>{rows.map(b=><tr key={b.key}><td>{label(group,b.key)}</td><td>{b.contacted}</td><td>{pct(b,'answer_rate')}</td><td>{pct(b,'meeting_rate')}</td></tr>)}</tbody></table></div>;
 return <details className="feedback-panel" onToggle={e=>{if((e.target as HTMLDetailsElement).open&&!report&&!loading)load()}}>
  <summary>{tr('feedback.title')}</summary>
  <p className="muted">{tr('feedback.intro')}</p>
  {loading&&<p className="muted">{tr('feedback.loading')}</p>}
  {error&&<p role="alert" className="note">{error}</p>}
  {report&&<>
   <p><b>{report.contacted}</b> {tr('feedback.contactedTotal')} · <b>{report.answered}</b> {tr('feedback.answeredTotal')} · <b>{report.meetings}</b> {tr('feedback.meetingsTotal')}</p>
   {report.insufficient&&<p className="note">{tr('feedback.insufficient')}</p>}
   {table(tr('feedback.byFit'),report.by_fit,'band')}
   {table(tr('feedback.byIntent'),report.by_intent,'band')}
   {table(tr('feedback.bySignalType'),report.by_signal_type,'type')}
   {table(tr('feedback.bySource'),report.by_source,'source')}
   {table(tr('feedback.bySignalAge'),report.by_signal_age,'age')}
  </>}
 </details>;
}
