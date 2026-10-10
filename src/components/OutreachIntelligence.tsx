'use client';
import {useEffect,useRef,useState} from 'react';
import type {Prospect} from '../domain/core';
import type {Angle} from '../outreach/angle';
import {DEFAULT_STYLE_PROFILE,type StyleProfile} from '../outreach/style';
import {translate,type Locale,type TKey} from '../i18n';
// O1/O2 on the prospect card, progressive disclosure only: the angle a message was written from (and its source),
// the user's own writing style, and public content pasted and reviewed by a person. Public content is never evidence
// nor a signal and never changes a score; nothing here fetches a page (ProspectOS never reads LinkedIn).
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
type PublicContentRow={id:string;source_url:string;source_domain:string|null;author:string|null;content:string;published_at:string|null;observed_at:string;status:'PENDING_REVIEW'|'VERIFIED'|'REJECTED';pinned:boolean};
const safeHref=(u:string|null)=>{if(!u)return null;try{const x=new URL(u);return ['http:','https:'].includes(x.protocol)?x.href:null}catch{return null}};

export function AngleSummary({angle,whyNow,locale}:{angle:Angle|null;whyNow:string|null;locale:Locale}){
 const tr=(key:TKey)=>translate(locale,key);
 if(!angle)return null;
 const href=safeHref(angle.source_url);
 return <details className="outreach-angle"><summary>{tr('outreach.angleTitle')} : <b>{tr(`outreach.angle.${angle.type}` as TKey)}</b></summary>
  {whyNow&&<p><b>{tr('outreach.whyNow')}</b> {whyNow}</p>}
  {angle.label&&<p className="muted">{angle.label}</p>}
  {href&&<p className="muted">{tr('outreach.angleSource')} : <a href={href} target="_blank" rel="noopener noreferrer nofollow">{new URL(href).hostname}</a></p>}
 </details>;
}

const lines=(s:string)=>s.split('\n').map(x=>x.trim()).filter(Boolean);
export function StyleProfilePanel({organizationId,mode,api,locale,disabled}:{organizationId:string;mode:'demo'|'live';api:Api;locale:Locale;disabled:boolean}){
 const tr=(key:TKey)=>translate(locale,key);
 const [style,setStyle]=useState<StyleProfile>(DEFAULT_STYLE_PROFILE),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 useEffect(()=>{if(!open||mode!=='live')return;let cancelled=false;api(`outreach-style?organization_id=${organizationId}`).then(r=>{if(!cancelled&&r?.profile)setStyle(r.profile)}).catch(()=>{});return()=>{cancelled=true}},[open,mode,organizationId]);
 async function save(){if(busy||disabled)return;setBusy(true);setNote('');try{await api('outreach-style','PUT',{organization_id:organizationId,profile:style});setNote(tr('outreach.style.saved'))}catch(e){setNote(e instanceof Error?e.message:tr('error.generic'))}finally{setBusy(false)}}
 return <details className="outreach-style" onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>{tr('outreach.styleTitle')}</summary>
  <p className="muted">{tr('outreach.styleDesc')}</p>
  {mode!=='live'?<p className="muted">{tr('outreach.style.demo')}</p>:<div className="style-form">
   <label>{tr('outreach.style.tone')}<select value={style.tone} onChange={e=>setStyle({...style,tone:e.target.value as StyleProfile['tone']})}>{(['professional_conversational','formal','warm','direct'] as const).map(t=><option key={t} value={t}>{tr(`outreach.style.tone.${t}` as TKey)}</option>)}</select></label>
   <label>{tr('outreach.style.address')}<select value={style.address_mode} onChange={e=>setStyle({...style,address_mode:e.target.value as StyleProfile['address_mode']})}>{(['auto','vous','tu'] as const).map(t=><option key={t} value={t}>{tr(`outreach.style.address.${t}` as TKey)}</option>)}</select></label>
   <label>{tr('outreach.style.length')}<select value={style.length} onChange={e=>setStyle({...style,length:e.target.value as StyleProfile['length']})}>{(['short','medium'] as const).map(t=><option key={t} value={t}>{tr(`outreach.style.length.${t}` as TKey)}</option>)}</select></label>
   <label>{tr('outreach.style.maxChars')}<input type="number" min={200} max={2000} value={style.max_chars} onChange={e=>setStyle({...style,max_chars:Number(e.target.value)})}/></label>
   <label>{tr('outreach.style.banned')}<textarea rows={4} value={style.banned_phrases.join('\n')} onChange={e=>setStyle({...style,banned_phrases:lines(e.target.value).slice(0,30)})}/></label>
   <label>{tr('outreach.style.ctas')}<textarea rows={2} value={style.preferred_ctas.join('\n')} onChange={e=>setStyle({...style,preferred_ctas:lines(e.target.value).slice(0,10)})}/></label>
   <label>{tr('outreach.style.instructions')}<textarea rows={5} maxLength={1500} value={style.instructions} onChange={e=>setStyle({...style,instructions:e.target.value})}/></label>
   <button disabled={busy||disabled} onClick={save}>{tr('outreach.style.save')}</button>{note&&<p role="status" className="muted">{note}</p>}
  </div>}
 </details>;
}

export function PublicContentPanel({prospect,mode,api,locale,disabled,onBusyChange}:{prospect:Prospect;mode:'demo'|'live';api:Api;locale:Locale;disabled:boolean;onBusyChange:(active:boolean)=>void}){
 const tr=(key:TKey)=>translate(locale,key);
 const [rows,setRows]=useState<PublicContentRow[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[adding,setAdding]=useState(false);
 const [form,setForm]=useState({source_url:'',content:'',author:'',published_at:''});
 const generation=useRef(0);
 async function load(){const g=++generation.current;const r=await api(`prospects/${prospect.id}/public-content`);if(g===generation.current)setRows(r??[])}
 useEffect(()=>{setRows([]);setError('');setAdding(false);if(mode==='live')load().catch(()=>setError(tr('publicContent.unavailable')));return()=>{generation.current++}},[prospect.id,mode]);
 async function execute(fn:()=>Promise<void>){if(disabled||busy)return;onBusyChange(true);setBusy(true);setError('');try{await fn();await load()}catch(e){setError(e instanceof Error?e.message:tr('error.generic'))}finally{setBusy(false);onBusyChange(false)}}
 const add=()=>execute(async()=>{await api(`prospects/${prospect.id}/public-content`,'POST',{source_url:form.source_url.trim(),content:form.content.trim(),author:form.author.trim()||null,published_at:form.published_at?new Date(`${form.published_at}T12:00:00Z`).toISOString():null});setForm({source_url:'',content:'',author:'',published_at:''});setAdding(false)});
 const review=(id:string,decision:'verify'|'reject'|'reset')=>execute(async()=>{await api(`public-content/${id}/review`,'POST',{decision})});
 const pin=(id:string,pinned:boolean)=>execute(async()=>{await api(`public-content/${id}/pin`,'POST',{pinned})});
 const remove=(id:string)=>execute(async()=>{await api(`public-content/${id}`,'DELETE')});
 return <details className="public-content-panel"><summary>{tr('publicContent.title')} {rows.length?`(${rows.length})`:''}</summary>
  <p className="muted">{tr('publicContent.desc')}</p>
  {mode!=='live'?<p className="muted">{tr('publicContent.demo')}</p>:<>
   {rows.length?rows.map(r=>{const href=safeHref(r.source_url);return <div className="public-content-item" key={r.id}>
    <p><span className={`pill status-${r.status.toLowerCase()}`}>{tr(`publicContent.status.${r.status}` as TKey)}</span>{r.pinned&&<span className="pill">{tr('publicContent.pinned')}</span>} {href&&<a href={href} target="_blank" rel="noopener noreferrer nofollow">{r.source_domain??new URL(href).hostname}</a>}{r.author?` · ${r.author}`:''}{r.published_at?` · ${new Date(r.published_at).toLocaleDateString(locale==='en'?'en-GB':'fr-FR')}`:''}</p>
    <blockquote>{r.content}</blockquote>
    <div className="actions">
     {r.status!=='VERIFIED'&&<button disabled={busy||disabled} onClick={()=>review(r.id,'verify')}>{tr('publicContent.verify')}</button>}
     {r.status!=='REJECTED'&&<button disabled={busy||disabled} onClick={()=>review(r.id,'reject')}>{tr('publicContent.reject')}</button>}
     {r.status!=='PENDING_REVIEW'&&<button disabled={busy||disabled} onClick={()=>review(r.id,'reset')}>{tr('publicContent.reset')}</button>}
     {r.status==='VERIFIED'&&<button disabled={busy||disabled} onClick={()=>pin(r.id,!r.pinned)}>{r.pinned?tr('publicContent.unpin'):tr('publicContent.pin')}</button>}
     <button className="text-button" disabled={busy||disabled} onClick={()=>remove(r.id)}>{tr('publicContent.delete')}</button>
    </div>
   </div>}):<p className="muted">{tr('publicContent.empty')}</p>}
   <button className="text-button" aria-expanded={adding} onClick={()=>setAdding(a=>!a)}>{tr('publicContent.add')}</button>
   {adding&&<div className="public-content-form">
    <p className="muted">{tr('publicContent.linkedinNote')}</p>
    <label>{tr('publicContent.url')}<input type="url" required maxLength={2048} value={form.source_url} onChange={e=>setForm({...form,source_url:e.target.value})}/></label>
    <label>{tr('publicContent.content')}<textarea required rows={4} maxLength={4000} value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/></label>
    <label>{tr('publicContent.author')}<input maxLength={200} value={form.author} onChange={e=>setForm({...form,author:e.target.value})}/></label>
    <label>{tr('publicContent.publishedAt')}<input type="date" value={form.published_at} onChange={e=>setForm({...form,published_at:e.target.value})}/></label>
    <button className="primary" disabled={busy||disabled||!form.source_url.trim()||!form.content.trim()} onClick={add}>{tr('publicContent.submit')}</button>
   </div>}
  </>}
  {error&&<p role="alert" className="note">{error}</p>}
 </details>;
}
