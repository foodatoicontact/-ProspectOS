'use client';
// « Appels d'offres ouverts » (docs/TENDERS.md) — shown at the top of « Recherche » in the v2 shell. It asks the server
// first, with an empty probe that never calls the BOAMP: switched off (404 TENDERS_DISABLED) or unreachable, it renders
// nothing. Read-only: each line links to its official BOAMP notice; nothing is saved, sent or answered for the person.
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import type {Locale} from '../i18n/locale';
import {Button} from '../ui/v2/primitives';
import {tendersClient,panelEnabled,deadlineText,urgent,loadLastSearch,saveLastSearch,tendersText,type TendersAnswer,type TendersTextKey} from '../tenders/view';

// Tokens of the v2 theme only (light and dark): this panel lives inside « Recherche » (SearchV2), whose text colour
// follows the theme. The legacy `.card` (white, hard-coded) made it unreadable in the dark theme (audit B1, 11 nov. 2026).
const CSS=`
.pos-ui .pos-tenders{display:grid;gap:var(--pos-space-3);min-width:0;margin-bottom:var(--pos-space-5);color:var(--pos-text-1)}
.pos-ui .pos-tenders__card{min-width:0;padding:var(--pos-space-4);background:var(--pos-surface-card);border:1px solid var(--pos-border);border-radius:var(--pos-radius-xl);box-shadow:var(--pos-shadow-card)}
.pos-ui .pos-tenders__card h2{margin:0 0 var(--pos-space-1);font-size:var(--pos-text-xl);font-weight:var(--pos-weight-heavy);letter-spacing:-.02em;color:var(--pos-text-1)}
.pos-ui .pos-tenders__lead{margin:0 0 var(--pos-space-3);color:var(--pos-text-2);font-size:var(--pos-text-sm)}
.pos-ui .pos-tenders form{display:grid;gap:var(--pos-space-3);grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;align-items:end}
@media (max-width:640px){.pos-ui .pos-tenders form{grid-template-columns:1fr}}
.pos-ui .pos-tenders__hint{margin:var(--pos-space-2) 0 0;font-size:var(--pos-text-xs);color:var(--pos-text-3)}
.pos-ui .pos-tenders__error{margin:0;border:1px solid var(--pos-status-excluded-fg);color:var(--pos-status-excluded-fg);background:var(--pos-surface-inset);border-radius:var(--pos-radius-md);padding:var(--pos-space-2) var(--pos-space-3);font-size:var(--pos-text-sm);overflow-wrap:anywhere}
.pos-ui .pos-tenders__list{list-style:none;margin:0;padding:0;display:grid;gap:var(--pos-space-2)}
.pos-ui .pos-tenders__item{border:1px solid var(--pos-border);background:var(--pos-surface-inset);border-radius:var(--pos-radius-lg);padding:var(--pos-space-3);display:grid;gap:4px;min-width:0}
.pos-ui .pos-tenders__item h3{margin:0;font-size:var(--pos-text-md);line-height:1.35;overflow-wrap:anywhere;color:var(--pos-text-1)}
.pos-ui .pos-tenders__meta{font-size:var(--pos-text-sm);color:var(--pos-text-2);overflow-wrap:anywhere}
.pos-ui .pos-tenders__deadline{font-size:var(--pos-text-sm);font-weight:var(--pos-weight-semibold);color:var(--pos-text-1)}
.pos-ui .pos-tenders__deadline.is-urgent{color:var(--pos-status-verify-fg)}
.pos-ui .pos-tenders__tags{display:flex;flex-wrap:wrap;gap:6px}
.pos-ui .pos-tenders__tags span{font-size:var(--pos-text-xs);border-radius:var(--pos-radius-pill);padding:2px 8px;background:var(--pos-accent-soft);color:var(--pos-text-1)}
.pos-ui .pos-tenders__item a{font-size:var(--pos-text-sm);width:fit-content}
.pos-ui .pos-tenders__source{font-size:var(--pos-text-xs);color:var(--pos-text-3);margin:var(--pos-space-3) 0 0}
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
  <div className="pos-tenders__card">
   <h2 id="pos-tenders-title">{t('title')}</h2>
   <p className="pos-tenders__lead">{t('lead')}</p>
   <form onSubmit={submit}>
    <label className="pos-sfield" htmlFor="pos-tenders-keywords"><span>{t('keywords')}</span><input id="pos-tenders-keywords" value={keywords} maxLength={300} placeholder={t('keywordsPlaceholder')} onChange={e=>setKeywords(e.target.value)} required/></label>
    <label className="pos-sfield" htmlFor="pos-tenders-departments"><span>{t('departments')}</span><input id="pos-tenders-departments" value={departments} maxLength={60} placeholder={t('departmentsPlaceholder')} onChange={e=>setDepartments(e.target.value)} required/></label>
    <Button type="submit" variant="primary" size="md" iconStart="search" loading={busy} disabled={busy}>{busy?t('searching'):t('search')}</Button>
   </form>
   <p className="pos-tenders__hint">{t('keywordsHint')}</p>
  </div>
  {error&&<p className="pos-tenders__error" role="alert">{error}</p>}
  {answer&&<div className="pos-tenders__card" aria-live="polite">
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
