'use client';
// Veille dédiée — suivi (migration 043, docs/DEDICATED_TRACKING.md). Presentational screens, data and actions passed in:
//   DedicatedClientView — the client's space: the statement to validate, the deliveries, each company and its status.
//   DedicatedAdminView  — the administrator's dashboard: per client, counters, alerts, statements, new delivery/contract.
// The rules are the database's; this screen only shows them (the « déjà client » option is greyed out after the window,
// « signé » asks for the first invoice date, the statement needs the attestation box) and reports the server's refusal.
import {useState} from 'react';
import {STATUS_LABEL,DEDICATED_STATUSES,PROOF_KINDS,PROOF_LABEL,ATTESTATION,eur,dateFr,monthLabel,knownClientOpen,knownClientDeadline,statementDeadline,
 type DedicatedStatus,type Counters,type Alert} from '../../../dedicated/model.ts';
import './dedicated.css';

export type Contract={id:string;label:string;minimum_ht_cents:number;commission_ht_cents:number;known_client_days:number;first_statement_month:string};
export type Delivery={id:string;contract_id:string;number:number;delivered_on:string;scope:string};
export type Item={id:string;delivery_id:string;contract_id:string;reference:string;siren:string;name:string;city:string|null;source_label:string;source_url:string;
 delivered_on:string;status:DedicatedStatus;status_changed_at:string|null;first_invoice_on:string|null;known_proof:{kind:string;dated_on:string;reference:string}|null;statement_id:string|null};
export type Statement={id:string;contract_id:string;month:string;signed_count:number;minimum_ht_cents:number;commission_ht_cents:number;amount_ht_cents:number;
 items:{reference:string;name:string;siren:string;first_invoice_on:string}[];validated_at:string|null};
export type ClientData={contracts:Contract[];deliveries:Delivery[];items:Item[];statements:Statement[]};
export type HistoryEntry={kind:string;detail:Record<string,unknown>;created_at:string};
export type StatusChange={status:DedicatedStatus;first_invoice_on?:string;proof?:{kind:typeof PROOF_KINDS[number];dated_on:string;reference:string}};

const KIND_LABEL:Record<string,string>={ITEM_OPENED:'Fiche ouverte',EXPORT:'Export',STATUS_CHANGED:'Statut modifié',DELIVERY_CREATED:'Livrée'};
const at=(iso:string)=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(iso));
const plural=(n:number,one:string,many:string)=>`${n} ${n>1?many:one}`;

function StatusBadge({s}:{s:DedicatedStatus}){return <span className={`pos-ded__status pos-ded__status--${s}`}>{STATUS_LABEL[s]}</span>}

function StatementCard({s,busy,onValidate}:{s:Statement;busy:boolean;onValidate:(id:string)=>void}){
 const [checked,setChecked]=useState(false);
 const due=statementDeadline(s.month);
 return <section className={`pos-ded__card${s.validated_at?'':' pos-ded__card--accent'}`} aria-label={`Relevé de ${monthLabel(s.month)}`}>
  <div className="pos-ded__row"><h3>Relevé de {monthLabel(s.month)}</h3>{s.validated_at?<span className="pos-ded__pill">Validé le {dateFr(s.validated_at)}</span>:<span className="pos-ded__pill">À valider avant le 5</span>}</div>
  <p className="pos-ded__amount">{eur(s.amount_ht_cents)} HT</p>
  <p className="pos-ded__calc">{plural(s.signed_count,'signature','signatures')} × {eur(s.commission_ht_cents)} = {eur(s.signed_count*s.commission_ht_cents)} · minimum garanti {eur(s.minimum_ht_cents)} → le plus élevé des deux.</p>
  {s.items.length>0&&<table className="pos-ded__table"><tbody>{s.items.map(i=><tr key={i.reference}><td><b>{i.name}</b><br/><span className="pos-ded__meta">{i.reference} · SIREN {i.siren}</span></td><td>1re facture<br/>{dateFr(i.first_invoice_on)}</td></tr>)}</tbody></table>}
  {!s.validated_at&&<>
   <label className="pos-ded__attest"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>{ATTESTATION}</label>
   <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={!checked||busy} onClick={()=>onValidate(s.id)}>Valider le relevé</button></div>
   <p className="pos-ded__muted">Date limite : {dateFr(due)}. Votre validation est horodatée et inscrite au journal.</p>
  </>}
 </section>;
}

function ItemCard({it,contract,today,busy,onOpen,onStatus}:{it:Item;contract:Contract;today:string;busy:boolean;onOpen:(id:string)=>Promise<HistoryEntry[]>;onStatus:(id:string,c:StatusChange)=>Promise<void>}){
 const [open,setOpen]=useState(false);const [history,setHistory]=useState<HistoryEntry[]|null>(null);
 const [status,setStatus]=useState<DedicatedStatus>(it.status);const [invoice,setInvoice]=useState('');
 const [proofKind,setProofKind]=useState<typeof PROOF_KINDS[number]>('facture');const [proofDate,setProofDate]=useState('');const [proofRef,setProofRef]=useState('');
 const knownOpen=knownClientOpen(it.delivered_on,today,contract.known_client_days);
 const locked=!!it.statement_id;
 const ready=status!==it.status&&(status!=='SIGNE'||!!invoice)&&(status!=='DEJA_CLIENT'||(!!proofDate&&proofRef.trim().length>=3));
 return <li className="pos-ded__item">
  <div className="pos-ded__itemtop"><span className="pos-ded__name">{it.name}</span><span className="pos-ded__ref">{it.reference}</span></div>
  <p className="pos-ded__meta">SIREN {it.siren}{it.city?` · ${it.city}`:''} · <a href={it.source_url} target="_blank" rel="noopener noreferrer">{it.source_label}</a></p>
  <div className="pos-ded__row"><StatusBadge s={it.status}/>{it.status==='SIGNE'&&<span className="pos-ded__meta">1re facture le {dateFr(it.first_invoice_on)}</span>}
   <button type="button" className="pos-ded__btn" aria-expanded={open} onClick={async()=>{const next=!open;setOpen(next);if(next&&!history){try{setHistory(await onOpen(it.id))}catch{setHistory([])}}}}>{open?'Fermer':'Ouvrir la fiche'}</button></div>
  {open&&<div className="pos-ded__form">
   {locked?<p className="pos-ded__note">Fiche comptée dans un relevé : son statut ne change plus.</p>:<>
    <label>Statut<select value={status} disabled={busy} onChange={e=>setStatus(e.target.value as DedicatedStatus)}>
     {DEDICATED_STATUSES.map(s=><option key={s} value={s} disabled={s==='DEJA_CLIENT'&&!knownOpen&&it.status!=='DEJA_CLIENT'}>{STATUS_LABEL[s]}{s==='DEJA_CLIENT'&&!knownOpen?' (délai dépassé)':''}</option>)}
    </select></label>
    {it.status!=='DEJA_CLIENT'&&<p className="pos-ded__muted">{knownOpen?`« Déjà client » possible jusqu’au ${dateFr(knownClientDeadline(it.delivered_on,contract.known_client_days))}, avec une pièce datée.`:`« Déjà client » n’est plus possible : le délai de ${contract.known_client_days} jours après la livraison est passé.`}</p>}
    {status==='SIGNE'&&status!==it.status&&<label>Date de la première facture<input type="date" value={invoice} min={it.delivered_on} max={today} onChange={e=>setInvoice(e.target.value)} required/></label>}
    {status==='DEJA_CLIENT'&&status!==it.status&&<div className="pos-ded__formrow">
     <label>Pièce<select value={proofKind} onChange={e=>setProofKind(e.target.value as typeof PROOF_KINDS[number])}>{PROOF_KINDS.map(k=><option key={k} value={k}>{PROOF_LABEL[k]}</option>)}</select></label>
     <label>Date de la pièce<input type="date" value={proofDate} max={it.delivered_on} onChange={e=>setProofDate(e.target.value)}/></label>
     <label>Référence<input value={proofRef} maxLength={200} placeholder="N° de facture, de devis…" onChange={e=>setProofRef(e.target.value)}/></label>
    </div>}
    <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={!ready||busy}
     onClick={()=>onStatus(it.id,{status,...(status==='SIGNE'?{first_invoice_on:invoice}:{}),...(status==='DEJA_CLIENT'?{proof:{kind:proofKind,dated_on:proofDate,reference:proofRef.trim()}}:{})})}>Enregistrer</button></div>
   </>}
   {history&&history.length>0&&<><p className="pos-ded__muted">Journal de la fiche</p><ol className="pos-ded__history">{history.map((h,n)=><li key={n}>{at(h.created_at)} — {KIND_LABEL[h.kind]??h.kind}{h.kind==='STATUS_CHANGED'?` : ${STATUS_LABEL[h.detail.from as DedicatedStatus]??''} → ${STATUS_LABEL[h.detail.to as DedicatedStatus]??''}`:''}</li>)}</ol></>}
  </div>}
 </li>;
}

export function DedicatedClientView(p:{data:ClientData;today:string;busy:boolean;error:string;notice:string;
 onValidate:(id:string)=>void;onOpen:(id:string)=>Promise<HistoryEntry[]>;onStatus:(id:string,c:StatusChange)=>Promise<void>;onExport:(contractId:string,deliveryId:string|null,format:'csv'|'pdf')=>void}){
 const {contracts,deliveries,items,statements}=p.data;
 if(!contracts.length)return <div className="pos-ded"><h2>Veille dédiée</h2><p className="pos-ded__muted">Aucune veille dédiée n’est active sur ce compte.</p></div>;
 return <div className="pos-ded">
  <header><h2>Veille dédiée — suivi</h2><p className="pos-ded__muted">Vos livraisons, le statut de chaque entreprise et le relevé du mois. Chaque action est horodatée dans un journal que personne ne peut modifier.</p></header>
  {p.error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{p.error}</p>}
  {p.notice&&<p className="pos-ded__note" role="status">{p.notice}</p>}
  {contracts.map(c=>{
   const st=statements.filter(s=>s.contract_id===c.id);const pending=st.filter(s=>!s.validated_at);const done=st.filter(s=>s.validated_at).slice(0,3);
   const dels=deliveries.filter(d=>d.contract_id===c.id).sort((a,b)=>b.number-a.number);
   const counts=DEDICATED_STATUSES.map(s=>[s,items.filter(i=>i.contract_id===c.id&&i.status===s).length] as const);
   return <section key={c.id} className="pos-ded" style={{padding:0}}>
    <div className="pos-ded__card">
     <h3>{c.label}</h3>
     <div className="pos-ded__terms"><span className="pos-ded__pill">Minimum {eur(c.minimum_ht_cents)} HT / mois</span><span className="pos-ded__pill">{eur(c.commission_ht_cents)} HT par client signé</span><span className="pos-ded__pill">« Déjà client » : {c.known_client_days} jours</span></div>
     <div className="pos-ded__grid">{counts.map(([s,n])=><div key={s} className="pos-ded__stat"><b>{n}</b><span>{STATUS_LABEL[s]}</span></div>)}</div>
    </div>
    {pending.map(s=><StatementCard key={s.id} s={s} busy={p.busy} onValidate={p.onValidate}/>)}
    {dels.map((d,n)=>{const its=items.filter(i=>i.delivery_id===d.id);return <details key={d.id} className="pos-ded__card pos-ded__delivery" open={n===0}>
     <summary><span className="pos-ded__row"><h3>Livraison n° {d.number}</h3><span className="pos-ded__pill">{plural(its.length,'fiche','fiches')}</span></span>
      <span className="pos-ded__muted">{dateFr(d.delivered_on)} · {d.scope}</span></summary>
     <div className="pos-ded__actions"><button type="button" className="pos-ded__btn" disabled={p.busy} onClick={()=>p.onExport(c.id,d.id,'csv')}>Exporter CSV</button>
      <button type="button" className="pos-ded__btn" disabled={p.busy} onClick={()=>p.onExport(c.id,d.id,'pdf')}>Exporter PDF</button></div>
     <ul className="pos-ded__list">{its.map(i=><ItemCard key={`${i.id}:${i.status}`} it={i} contract={c} today={p.today} busy={p.busy} onOpen={p.onOpen} onStatus={p.onStatus}/>)}</ul>
    </details>})}
    {done.length>0&&<div className="pos-ded__card"><h3>Relevés validés</h3><table className="pos-ded__table"><tbody>{done.map(s=><tr key={s.id}><td>{monthLabel(s.month)}<br/><span className="pos-ded__meta">{plural(s.signed_count,'signature','signatures')} · validé le {dateFr(s.validated_at)}</span></td><td>{eur(s.amount_ht_cents)} HT</td></tr>)}</tbody></table></div>}
   </section>;
  })}
 </div>;
}

// ---------------------------------------------------------------- administrator
export type AdminView={contract:Contract&{organization:string};deliveries:number;counters:Counters;alerts:Alert[];
 statements:{id:string;month:string;signed_count:number;amount_ht_cents:number;validated_at:string|null}[]};
const COUNTER_LABEL:[keyof Counters,string][]=[['delivered','Livrées'],['opened','Ouvertes'],['exported','Exportées'],['contacted','Contactées'],['quoted','Devis'],['signed','Signées'],['lost','Perdues'],['known','Déjà clients']];

export function DedicatedAdminView(p:{rows:AdminView[];busy:boolean;error:string;notice:string;
 onDelivery:(contractId:string,scope:string,lines:string)=>void;onContract:(c:{client_email:string;label:string;minimum_eur:number;commission_eur:number;first_statement_month:string})=>void}){
 const [scope,setScope]=useState<Record<string,string>>({});const [lines,setLines]=useState<Record<string,string>>({});
 const [nc,setNc]=useState({client_email:'',label:'',minimum_eur:'99',commission_eur:'179',first_statement_month:''});
 const alertsCount=p.rows.reduce((n,r)=>n+r.alerts.length,0);
 return <div className="pos-ded">
  <header><h2>Veille dédiée — clients</h2><p className="pos-ded__muted">{plural(p.rows.length,'client','clients')} · {plural(alertsCount,'alerte','alertes')}. Visible par l’administrateur seulement.</p></header>
  {p.error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{p.error}</p>}
  {p.notice&&<p className="pos-ded__note" role="status">{p.notice}</p>}
  {p.rows.map(r=><section key={r.contract.id} className={`pos-ded__card${r.alerts.length?' pos-ded__card--warn':''}`} aria-label={r.contract.organization}>
   <div className="pos-ded__row"><h3>{r.contract.organization}</h3><span className="pos-ded__pill">{plural(r.deliveries,'livraison','livraisons')}</span></div>
   <p className="pos-ded__muted">{r.contract.label} · {eur(r.contract.minimum_ht_cents)} min. · {eur(r.contract.commission_ht_cents)} / signé</p>
   <div className="pos-ded__grid">{COUNTER_LABEL.map(([k,l])=><div key={k} className="pos-ded__stat"><b>{r.counters[k]}</b><span>{l}</span></div>)}</div>
   {r.alerts.length>0&&<ul className="pos-ded__list">{r.alerts.map((a,n)=><li key={n} className="pos-ded__alert"><span>{a.text}</span>{a.items&&<small>{a.items.slice(0,12).join(', ')}{a.items.length>12?'…':''}</small>}</li>)}</ul>}
   {r.statements.length>0&&<table className="pos-ded__table"><tbody>{r.statements.slice(0,4).map(s=><tr key={s.id}><td>{monthLabel(s.month)}<br/><span className="pos-ded__meta">{plural(s.signed_count,'signature','signatures')} · {s.validated_at?`validé le ${dateFr(s.validated_at)}`:'non validé'}</span></td><td>{eur(s.amount_ht_cents)} HT</td></tr>)}</tbody></table>}
   <details><summary className="pos-ded__btn">Nouvelle livraison</summary>
    <div className="pos-ded__form" style={{marginTop:8}}>
     <label>Périmètre<input value={scope[r.contract.id]??''} maxLength={500} placeholder="Île-de-France — créations, semaine 47" onChange={e=>setScope({...scope,[r.contract.id]:e.target.value})}/></label>
     <label>Entreprises (une par ligne : SIREN;Entreprise;Ville;Source;Lien https)<textarea value={lines[r.contract.id]??''} onChange={e=>setLines({...lines,[r.contract.id]:e.target.value})}/></label>
     <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={p.busy||!(scope[r.contract.id]??'').trim()||!(lines[r.contract.id]??'').trim()}
      onClick={()=>p.onDelivery(r.contract.id,scope[r.contract.id]!,lines[r.contract.id]!)}>Livrer</button></div>
    </div></details>
  </section>)}
  <details className="pos-ded__card"><summary className="pos-ded__btn">Nouveau contrat</summary>
   <div className="pos-ded__form" style={{marginTop:8}}>
    <label>E-mail du compte client (propriétaire de son espace)<input type="email" value={nc.client_email} onChange={e=>setNc({...nc,client_email:e.target.value})}/></label>
    <label>Libellé<input value={nc.label} maxLength={160} placeholder="Veille Île-de-France" onChange={e=>setNc({...nc,label:e.target.value})}/></label>
    <div className="pos-ded__formrow">
     <label>Minimum HT / mois (€)<input inputMode="decimal" value={nc.minimum_eur} onChange={e=>setNc({...nc,minimum_eur:e.target.value})}/></label>
     <label>Commission HT / signé (€)<input inputMode="decimal" value={nc.commission_eur} onChange={e=>setNc({...nc,commission_eur:e.target.value})}/></label>
     <label>Premier mois de relevé<input type="month" value={nc.first_statement_month.slice(0,7)} onChange={e=>setNc({...nc,first_statement_month:e.target.value?`${e.target.value}-01`:''})}/></label>
    </div>
    <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={p.busy||!nc.client_email||!nc.label||!nc.first_statement_month}
     onClick={()=>p.onContract({client_email:nc.client_email,label:nc.label,minimum_eur:Number(nc.minimum_eur.replace(',','.')),commission_eur:Number(nc.commission_eur.replace(',','.')),first_statement_month:nc.first_statement_month})}>Créer le contrat</button></div>
   </div></details>
 </div>;
}
