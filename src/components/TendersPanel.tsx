'use client';
// « Appels d'offres ouverts » (docs/TENDERS.md) — shown at the top of « Recherche » in the v2 shell. It asks the server
// first, with an empty probe that never calls the BOAMP: switched off (404 TENDERS_DISABLED) or unreachable, it renders
// nothing. Read-only: each line links to its official BOAMP notice; nothing is saved, sent or answered for the person.
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import type {Locale} from '../i18n/locale';
import {tendersClient,panelEnabled,deadlineText,urgent,loadLastSearch,saveLastSearch,tendersText,type TendersAnswer,type TendersTextKey} from '../tenders/view';

const CSS=`
.pos-tenders{display:grid;gap:12px;min-width:0;margin-bottom:22px}
.pos-tenders .card{min-width:0}
.pos-tenders__lead{margin:0 0 12px;color:var(--pos-text-2,#4a5260);font-size:13px}
.pos-tenders form{display:grid;gap:10px;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;align-items:end}
@media (max-width:640px){.pos-tenders form{grid-template-columns:1fr}}
.pos-tenders label{display:grid;gap:4px;font-size:13px;font-weight:600;min-width:0}
.pos-tenders input{font-size:16px;min-height:44px;min-width:0}
.pos-tenders button{min-height:44px}
.pos-tenders__hint{margin:6px 0 0;font-size:12px;color:var(--pos-text-2,#4a5260)}
.pos-tenders__error{background:#f6e3de;color:#8a3b2b;border-radius:8px;padding:10px 12px;font-size:13px;overflow-wrap:anywhere}
.pos-tenders__list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.pos-tenders__item{border:1px solid var(--pos-border,#dfe3ea);border-radius:12px;padding:12px 14px;display:grid;gap:4px;min-width:0}
.pos-tenders__item h3{margin:0;font-size:15px;line-height:1.35;overflow-wrap:anywhere}
.pos-tenders__meta{font-size:13px;color:var(--pos-text-2,#4a5260);overflow-wrap:anywhere}
.pos-tenders__deadline{font-size:13px;font-weight:600}
.pos-tenders__deadline.is-urgent{color:#b4530a}
.pos-tenders__tags{display:flex;flex-wrap:wrap;gap:6px}
.pos-tenders__tags span{font-size:11px;border-radius:12px;padding:2px 8px;background:var(--pos-accent-soft,#e8f0fb)}
.pos-tenders__item a{font-size:13px;font-weight:600;width:fit-content}
.pos-tenders__source{font-size:12px;color:var(--pos-text-2,#4a5260);margin:0}
`;

export function TendersPanel({locale,projectId,token,onUnauthorized}:{locale:Locale;projectId:string;token:string;onUnauthorized:()=>void}){
 const t=(k:TendersTextKey,v?:Record<string,string|number>)=>tendersText(locale,k,v);
 const client=useMemo(()=>tendersClient(token),[token]);
 const [enabled,setEnabled]=useState(false);
 const [keywords,setKeywords]=useState('');
 const [departments,setDepartments]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [answer,setAnswer]=useState<TendersAnswer|null>(null);
 // The page passes a new callback on every render: kept in a ref so the probe runs once per project, not in a loop.
 const unauthorized=useRef(onUnauthorized);unauthorized.current=onUnauthorized;
 useEffect(()=>{let live=true;
  client.probe().then(r=>{if(!live)return;if(!r.ok&&r.status===401){unauthorized.current();return}setEnabled(panelEnabled(r))});
  const last=loadLastSearch(projectId);setKeywords(last?.keywords??'');setDepartments(last?.departments??'');setAnswer(null);setError('');
  return()=>{live=false}},[client,projectId]);
 if(!enabled)return null;

 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  const r=await client.search(keywords,departments);setBusy(false);
  if(r.ok){setAnswer(r.data);saveLastSearch(projectId,keywords,departments);return}
  if(r.status===401){unauthorized.current();return}
  setAnswer(null);setError(r.code==='NETWORK'?t('network'):r.error??t('network'));
 }
 const now=Date.now();
 return <section className="pos-tenders" aria-labelledby="pos-tenders-title" data-tenders>
  <style href="pos-tenders" precedence="default">{CSS}</style>
  <div className="card">
   <h2 id="pos-tenders-title">{t('title')}</h2>
   <p className="pos-tenders__lead">{t('lead')}</p>
   <form onSubmit={submit}>
    <label htmlFor="pos-tenders-keywords">{t('keywords')}<input id="pos-tenders-keywords" value={keywords} maxLength={300} placeholder={t('keywordsPlaceholder')} onChange={e=>setKeywords(e.target.value)} required/></label>
    <label htmlFor="pos-tenders-departments">{t('departments')}<input id="pos-tenders-departments" value={departments} maxLength={60} placeholder={t('departmentsPlaceholder')} onChange={e=>setDepartments(e.target.value)} required/></label>
    <button type="submit" className="primary" disabled={busy}>{busy?t('searching'):t('search')}</button>
   </form>
   <p className="pos-tenders__hint">{t('keywordsHint')}</p>
  </div>
  {error&&<p className="pos-tenders__error" role="alert">{error}</p>}
  {answer&&<div className="card" aria-live="polite">
   <p className="pos-tenders__lead">{answer.tenders.length?t('count',{n:answer.tenders.length}):t('none')}{answer.total>answer.tenders.length?` ${t('more',{total:answer.total})}`:''}</p>
   <ul className="pos-tenders__list">{answer.tenders.map(x=><li key={x.id} className="pos-tenders__item" data-tender={x.id}>
    <span className={`pos-tenders__deadline${urgent(x.deadline,now)?' is-urgent':''}`}>{t('deadline')} {deadlineText(locale,x.deadline,now)}</span>
    <h3>{x.subject}</h3>
    <span className="pos-tenders__meta">{t('buyer')} : {x.buyer}{x.departments.length?` · ${x.departments.join(', ')}`:''}</span>
    {(x.contractTypes.length>0||x.descriptors.length>0)&&<span className="pos-tenders__tags">{[...x.contractTypes,...x.descriptors].slice(0,6).map(s=><span key={s}>{s}</span>)}</span>}
    <a href={x.url} target="_blank" rel="noopener noreferrer">{t('open')} ↗</a>
   </li>)}</ul>
   <p className="pos-tenders__source">{t('source')}</p>
  </div>}
 </section>;
}
