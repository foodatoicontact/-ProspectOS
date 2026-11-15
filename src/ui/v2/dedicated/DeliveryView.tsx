'use client';
// One delivery in the follow-up space, drawn like the PDF the client received (commercial/livraison.ts): the same header
// (logo, « Préparé pour », the eyebrow with the date, the title), one dark band per section, and each card with the same
// fields in the same order and with the same labels — name, department · city and details, source badge and date, « Le
// fait », « Pourquoi maintenant », « Votre accroche », « Voir la source officielle ». The same style sheet is applied
// (scopedLivraisonCss). What the follow-up adds comes AFTER, at the bottom of the card: the card's number in the document,
// the status menu (with the date or the proof it needs, inline), the card's journal. Fiche n = the n-th card of the PDF.
import {useState} from 'react';
import {scopedLivraisonCss} from '../../../dedicated/livraison-style.ts';
import {STATUS_LABEL,DEDICATED_STATUSES,PROOF_KINDS,PROOF_LABEL,dateFr,knownClientOpen,knownClientDeadline,ficheNumber,type DedicatedStatus} from '../../../dedicated/model.ts';
import type {Contract,Delivery,Item,HistoryEntry,StatusChange} from './DedicatedViews.tsx';

// Tool-only rules: one column under 700 px (each card keeps its order), a smaller title on a phone, the follow-up block.
const EXTRA=`
/* The application's global rules that would leak into the document (.logo, .eyebrow, h1/h2, p) are reset to the PDF's. */
.pos-livraison .logo{display:block;width:auto;height:auto;background:none;color:inherit;border-radius:0;font-style:normal;align-items:normal;justify-content:normal}
.pos-livraison .logo span{font-style:normal}
.pos-livraison .eyebrow{font-weight:400}
.pos-livraison h1,.pos-livraison h2,.pos-livraison p{font-family:inherit;margin:0}
.pos-livraison p{line-height:inherit}
.pos-livraison h1{color:#eef0ff}
.pos-livraison .sh h2{color:#fff;font-weight:700;line-height:1.2}
.pos-livraison{border-radius:16px;overflow:hidden;min-width:0}
.pos-livraison .dl-head{background:#0b0f24;color:#eef0ff;padding:16px 16px 18px;position:relative;overflow:hidden;border-radius:16px}
.pos-livraison .dl-head .glow{width:90mm;height:90mm;inset:-40% -12% auto auto}
.pos-livraison .dl-head .cv-mid{margin-top:18px}
.pos-livraison .dl-head h1{font-size:30pt}
.pos-livraison .dl-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;position:relative;z-index:1}
.pos-livraison .dl-tools button{font:inherit;font-size:8.6pt;font-weight:700;border-radius:999px;padding:6px 12px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;min-height:36px}
.pos-livraison .dl-sec{margin-top:12px}
.pos-livraison .sh{margin-top:4px}
.pos-livraison .grid{align-items:start}
.pos-livraison .fu{border-top:1px dashed #e4e7f0;margin-top:4px;padding-top:7px;display:grid;gap:6px;font-size:8.6pt;color:#4a5068}
.pos-livraison .fu-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:space-between}
.pos-livraison .fu-num{font-size:7.6pt;color:#7a8096;font-weight:600}
.pos-livraison .fu select,.pos-livraison .fu input{font:inherit;font-size:16px;border:1px solid #c9cde0;border-radius:9px;padding:6px 8px;background:#fff;color:#141826;min-height:40px;max-width:100%}
.pos-livraison .fu select{font-weight:700}
.pos-livraison .fu label{display:grid;gap:3px;font-size:7.6pt;font-weight:700;color:#8a90a6;text-transform:uppercase;letter-spacing:.6px;margin:0}
.pos-livraison .fu-form{display:grid;gap:6px;background:#f6f7fb;border-radius:9px;padding:8px}
.pos-livraison .fu-save{font:inherit;font-size:8.6pt;font-weight:700;color:#fff;background:#5b5bd6;border:0;border-radius:999px;padding:7px 14px;min-height:36px;cursor:pointer;justify-self:start}
.pos-livraison .fu-save:disabled{opacity:.45;cursor:not-allowed}
.pos-livraison .fu-note{font-size:8pt;color:#7a8096}
.pos-livraison .fu details summary{cursor:pointer;font-size:8pt;font-weight:700;color:#5b5bd6}
.pos-livraison .fu ol{margin:4px 0 0;padding-left:16px;font-size:8pt;color:#525870}
.pos-livraison .fu .st-SIGNE{color:#1f7a4d}.pos-livraison .fu .st-PERDU,.pos-livraison .fu .st-DEJA_CLIENT{color:#7a8096}
@media (min-width:701px){.pos-livraison .fu select,.pos-livraison .fu input{font-size:9.6pt;min-height:32px;padding:4px 8px}}
@media (max-width:700px){.pos-livraison .cv-top{flex-wrap:wrap;gap:6px 12px}.pos-livraison .grid{grid-template-columns:1fr}.pos-livraison .dl-head h1{font-size:24pt}.pos-livraison .sh h2{font-size:15pt}}
`;
const KIND_LABEL:Record<string,string>={ITEM_OPENED:'Fiche ouverte',EXPORT:'Export',STATUS_CHANGED:'Statut modifié',DELIVERY_CREATED:'Livrée'};
const at=(iso:string)=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(iso));

export function LivraisonStyle(){
 return <>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" precedence="default"/>
  <style href="pos-livraison" precedence="default">{scopedLivraisonCss('.pos-ui .pos-livraison')+EXTRA.replace(/\.pos-livraison/g,'.pos-ui .pos-livraison')}</style>
 </>;
}

function FicheCard({it,contract,today,busy,onOpen,onStatus}:{it:Item;contract:Contract;today:string;busy:boolean;onOpen:(id:string)=>Promise<HistoryEntry[]>;onStatus:(id:string,c:StatusChange)=>Promise<void>}){
 const [status,setStatus]=useState<DedicatedStatus>(it.status);const [invoice,setInvoice]=useState('');
 const [proofKind,setProofKind]=useState<typeof PROOF_KINDS[number]>('facture');const [proofDate,setProofDate]=useState('');const [proofRef,setProofRef]=useState('');
 const [history,setHistory]=useState<HistoryEntry[]|null>(null);const [opened,setOpened]=useState(false);
 const knownOpen=knownClientOpen(it.delivered_on,today,contract.known_client_days);const locked=!!it.statement_id;
 const needs=status!==it.status&&(status==='SIGNE'||status==='DEJA_CLIENT');
 const ready=status!==it.status&&(status!=='SIGNE'||!!invoice)&&(status!=='DEJA_CLIENT'||(!!proofDate&&proofRef.trim().length>=3));
 // « Ouverture de fiche » (journal): the first time the official source or the card's journal is opened in this view.
 const open=async()=>{if(opened)return;setOpened(true);try{setHistory(await onOpen(it.id))}catch{setHistory([])}};
 const save=(s:DedicatedStatus)=>onStatus(it.id,{status:s,...(s==='SIGNE'?{first_invoice_on:invoice}:{}),...(s==='DEJA_CLIENT'?{proof:{kind:proofKind,dated_on:proofDate,reference:proofRef.trim()}}:{})});
 return <div className="card" id={`fiche-${it.id}`}>
  <div className="ch"><div><div className="nm">{it.name}</div><div className="meta">
   <span className="chip">{it.department?`${it.department} · `:''}{it.city??''}</span>{(it.chips??[]).map((c,n)=><span key={n} className="chip ghost">{c}</span>)}</div></div>
   <div className="dt"><span>{it.badge??it.source_label}</span><b>{it.event_label??dateFr(it.event_date??it.delivered_on)}</b></div></div>
  {it.fact&&<div className="fact"><span className="k">Le fait</span>{it.fact}</div>}
  {it.why_now&&<div className="why"><span className="k">Pourquoi maintenant</span>{it.why_now}</div>}
  {it.hook&&<div className="hook"><span className="k">Votre accroche</span>« {it.hook} »</div>}
  <a className="src" href={it.source_url} target="_blank" rel="noopener noreferrer" onClick={()=>{void open()}}>Voir la source officielle ↗</a>
  <div className="fu">
   <div className="fu-row"><span className="fu-num">Fiche n° {ficheNumber(it.reference)} · {it.reference} · SIREN {it.siren}</span>
    {locked?<b className={`st-${it.status}`}>{STATUS_LABEL[it.status]} · compté dans un relevé</b>
     :<select aria-label={`Statut de ${it.name}`} value={status} disabled={busy} className={`st-${status}`}
       onChange={e=>{const s=e.target.value as DedicatedStatus;setStatus(s);if(s!==it.status&&s!=='SIGNE'&&s!=='DEJA_CLIENT')void save(s)}}>
      {DEDICATED_STATUSES.map(s=><option key={s} value={s} disabled={s==='DEJA_CLIENT'&&!knownOpen&&it.status!=='DEJA_CLIENT'}>{STATUS_LABEL[s]}{s==='DEJA_CLIENT'&&!knownOpen&&it.status!=='DEJA_CLIENT'?' (délai dépassé)':''}</option>)}
     </select>}</div>
   {it.status==='SIGNE'&&<span className="fu-note">1re facture le {dateFr(it.first_invoice_on)}</span>}
   {needs&&!locked&&<div className="fu-form">
    {status==='SIGNE'&&<label>Date de la première facture<input type="date" value={invoice} min={it.delivered_on} max={today} onChange={e=>setInvoice(e.target.value)}/></label>}
    {status==='DEJA_CLIENT'&&<><label>Pièce<select value={proofKind} onChange={e=>setProofKind(e.target.value as typeof PROOF_KINDS[number])}>{PROOF_KINDS.map(k=><option key={k} value={k}>{PROOF_LABEL[k]}</option>)}</select></label>
     <label>Date de la pièce<input type="date" value={proofDate} max={it.delivered_on} onChange={e=>setProofDate(e.target.value)}/></label>
     <label>Référence<input value={proofRef} maxLength={200} placeholder="N° de facture, de devis…" onChange={e=>setProofRef(e.target.value)}/></label></>}
    <button type="button" className="fu-save" disabled={!ready||busy} onClick={()=>void save(status)}>Enregistrer</button>
   </div>}
   {!locked&&it.status!=='DEJA_CLIENT'&&<span className="fu-note">{knownOpen?`« Déjà client » possible jusqu’au ${dateFr(knownClientDeadline(it.delivered_on,contract.known_client_days))}, avec une pièce datée.`:`« Déjà client » n’est plus possible (délai de ${contract.known_client_days} jours dépassé).`}</span>}
   <details onToggle={e=>{if((e.target as HTMLDetailsElement).open)void open()}}><summary>Journal de la fiche</summary>
    {history===null?<p className="fu-note">Chargement…</p>:history.length===0?<p className="fu-note">Aucune entrée.</p>
     :<ol>{history.map((h,n)=><li key={n}>{at(h.created_at)} — {KIND_LABEL[h.kind]??h.kind}{h.kind==='STATUS_CHANGED'?` : ${STATUS_LABEL[h.detail.from as DedicatedStatus]??''} → ${STATUS_LABEL[h.detail.to as DedicatedStatus]??''}`:''}</li>)}</ol>}
   </details>
  </div>
 </div>;
}

export function DeliveryDocument({d,items,contract,today,busy,open,onToggle,onOpen,onStatus,onExport}:{d:Delivery;items:Item[];contract:Contract;today:string;busy:boolean;open:boolean;
 onToggle:()=>void;onOpen:(id:string)=>Promise<HistoryEntry[]>;onStatus:(id:string,c:StatusChange)=>Promise<void>;onExport:(format:'csv'|'pdf')=>void}){
 const h=d.header??{};const count=items.length;
 // Sections in the document's order; a list pasted by hand has none: one band with its source.
 const sections=d.sections?.length?d.sections:[{key:'',title:'Entreprises livrées',subtitle:d.scope,source:items[0]?.source_label??'sources officielles',color:'#5b5bd6',badge:''}];
 const sorted=[...items].sort((a,b)=>ficheNumber(a.reference)-ficheNumber(b.reference));
 return <div className="pos-livraison">
  <div className="dl-head"><div className="glow"/>
   <div className="cv-top"><div className="logo"><span>P.</span>ProspectOS</div>{h.prepared_for&&<div className="for">Préparé pour <b>{h.prepared_for}</b></div>}</div>
   <div className="cv-mid"><div className="eyebrow">Livraison n° {d.number} · {h.eyebrow??`${d.scope} · ${dateFr(d.delivered_on)}`}</div>
    <h1>{count} entreprises<br/>à appeler <em>maintenant</em>.</h1></div>
   <div className="dl-tools">
    <button type="button" aria-expanded={open} onClick={onToggle}>{open?'Replier la livraison':'Voir les fiches'}</button>
    <button type="button" disabled={busy} onClick={()=>onExport('pdf')}>{d.pdf_sha256?'PDF de la livraison':'Exporter PDF'}</button>
    <button type="button" disabled={busy} onClick={()=>onExport('csv')}>Exporter CSV</button>
   </div>
  </div>
  {open&&sections.map(s=>{const its=sorted.filter(i=>(i.section_key??'')===s.key);if(!its.length)return null;
   return <section key={s.key||'all'} className="dl-sec"><div className="sh" style={{['--c' as string]:s.color}}><div className="sn">{its.length} entreprises</div><h2>{s.title}</h2><p>{s.subtitle} · source : {s.source}</p></div>
    <div className="grid">{its.map(i=><FicheCard key={`${i.id}:${i.status}`} it={i} contract={contract} today={today} busy={busy} onOpen={onOpen} onStatus={onStatus}/>)}</div></section>})}
 </div>;
}
