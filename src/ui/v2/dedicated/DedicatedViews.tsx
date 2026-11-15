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
import {DeliveryDocument,LivraisonStyle} from './DeliveryView.tsx';

export type ContractStatus='PROPOSED'|'ACTIVE'|'TERMINATED';
export type Contract={id:string;label:string;minimum_ht_cents:number;commission_ht_cents:number;known_client_days:number;first_statement_month:string;
 status:ContractStatus;trial_starts_on:string;accepted_at:string|null;terminated_at:string|null};
export type Proposal={contract_id:string;version:number;file_name:string;sha256:string;created_at:string};
export type DeliverySection={key:string;title:string;subtitle:string;source:string;color:string;badge:string};
export type Delivery={id:string;contract_id:string;number:number;delivered_on:string;scope:string;
 header?:{prepared_for?:string;eyebrow?:string;lead?:string;title_count?:number}|null;sections?:DeliverySection[]|null;pdf_sha256?:string|null;pdf_file_name?:string|null};
export type Item={id:string;delivery_id:string;contract_id:string;reference:string;siren:string;name:string;city:string|null;source_label:string;source_url:string;
 delivered_on:string;status:DedicatedStatus;status_changed_at:string|null;first_invoice_on:string|null;known_proof:{kind:string;dated_on:string;reference:string}|null;statement_id:string|null;
 position?:number;section_key?:string|null;badge?:string|null;event_date?:string|null;event_label?:string|null;department?:string|null;chips?:string[]|null;
 fact?:string|null;why_now?:string|null;hook?:string|null};

export type Statement={id:string;contract_id:string;month:string;signed_count:number;minimum_ht_cents:number;commission_ht_cents:number;amount_ht_cents:number;
 items:{reference:string;name:string;siren:string;first_invoice_on:string}[];validated_at:string|null};
export type ClientData={contracts:Contract[];deliveries:Delivery[];items:Item[];statements:Statement[];proposals:Proposal[]};
export type HistoryEntry={kind:string;detail:Record<string,unknown>;created_at:string};
export type StatusChange={status:DedicatedStatus;first_invoice_on?:string;proof?:{kind:typeof PROOF_KINDS[number];dated_on:string;reference:string}};

const KIND_LABEL:Record<string,string>={ITEM_OPENED:'Fiche ouverte',EXPORT:'Export',STATUS_CHANGED:'Statut modifié',DELIVERY_CREATED:'Livrée'};
const at=(iso:string)=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}).format(new Date(iso));
const plural=(n:number,one:string,many:string)=>`${n} ${n>1?many:one}`;

const accessUntil=(terminatedAt:string)=>{const d=new Date(terminatedAt);d.setUTCMonth(d.getUTCMonth()+6);return d.toISOString()};

// The proposal waiting for the client's acceptance: the space stays closed until « J'accepte la proposition ».
function ProposalCard({c,prop,busy,onRead,onAccept}:{c:Contract;prop:Proposal|undefined;busy:boolean;onRead:(contractId:string)=>void;onAccept:(contractId:string,sha256:string)=>void}){
 return <section className="pos-ded__card pos-ded__card--accent" aria-label="Proposition à accepter">
  <div className="pos-ded__row"><h3>{c.label}</h3><span className="pos-ded__pill">Proposition</span></div>
  <p className="pos-ded__muted">Votre espace de suivi s’ouvrira dès votre acceptation. Période d’essai à partir du {dateFr(c.trial_starts_on)}.</p>
  <div className="pos-ded__terms"><span className="pos-ded__pill">Minimum {eur(c.minimum_ht_cents)} HT / mois</span><span className="pos-ded__pill">{eur(c.commission_ht_cents)} HT par client signé</span></div>
  {prop?<>
   <div className="pos-ded__actions"><button type="button" className="pos-ded__btn" disabled={busy} onClick={()=>onRead(c.id)}>Lire la proposition (PDF)</button></div>
   <p className="pos-ded__meta">{prop.file_name} · version {prop.version} · empreinte {prop.sha256.slice(0,12)}…</p>
   <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={busy} onClick={()=>onAccept(c.id,prop.sha256)}>J’accepte la proposition</button></div>
   <p className="pos-ded__muted">Votre acceptation est horodatée et inscrite au journal, avec l’empreinte de cette version du document. Elle ne dépend d’aucun abonnement.</p>
  </>:<p className="pos-ded__note">La proposition n’est pas encore jointe.</p>}
 </section>;
}

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


export function DedicatedClientView(p:{data:ClientData;today:string;busy:boolean;error:string;notice:string;
 onReadProposal:(contractId:string)=>void;onAccept:(contractId:string,sha256:string)=>void;
 onValidate:(id:string)=>void;onOpen:(id:string)=>Promise<HistoryEntry[]>;onStatus:(id:string,c:StatusChange)=>Promise<void>;onExport:(contractId:string,deliveryId:string|null,format:'csv'|'pdf')=>void}){
 const {contracts,deliveries,items,statements}=p.data;
 const [openDel,setOpenDel]=useState<Record<string,boolean>>({});
 if(!contracts.length)return <div className="pos-ded"><h2>Veille dédiée</h2><p className="pos-ded__muted">Aucune veille dédiée n’est active sur ce compte.</p></div>;
 return <div className="pos-ded">
  <LivraisonStyle/>
  <header><h2>Veille dédiée — suivi</h2><p className="pos-ded__muted">Vos livraisons, le statut de chaque entreprise et le relevé du mois. Chaque action est horodatée dans un journal que personne ne peut modifier.</p></header>
  {p.error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{p.error}</p>}
  {p.notice&&<p className="pos-ded__note" role="status">{p.notice}</p>}
  {contracts.map(c=>{
   if(c.status==='PROPOSED')return <ProposalCard key={c.id} c={c} prop={p.data.proposals.find(x=>x.contract_id===c.id)} busy={p.busy} onRead={p.onReadProposal} onAccept={p.onAccept}/>;
   const st=statements.filter(s=>s.contract_id===c.id);const pending=st.filter(s=>!s.validated_at);const done=st.filter(s=>s.validated_at).slice(0,3);
   const dels=deliveries.filter(d=>d.contract_id===c.id).sort((a,b)=>b.number-a.number);
   const counts=DEDICATED_STATUSES.map(s=>[s,items.filter(i=>i.contract_id===c.id&&i.status===s).length] as const);
   return <section key={c.id} className="pos-ded" style={{padding:0}}>
    <div className="pos-ded__card">
     <h3>{c.label}</h3>
     {c.status==='TERMINATED'&&c.terminated_at&&<p className="pos-ded__note">Contrat résilié le {dateFr(c.terminated_at)} : plus de nouvelle livraison. Vous gardez la consultation et la mise à jour des statuts jusqu’au {dateFr(accessUntil(c.terminated_at))}, pour les commissions qui restent dues.</p>}
     {c.status==='ACTIVE'&&<p className="pos-ded__meta">Proposition acceptée le {dateFr(c.accepted_at)} · essai à partir du {dateFr(c.trial_starts_on)}</p>}
     <div className="pos-ded__terms"><span className="pos-ded__pill">Minimum {eur(c.minimum_ht_cents)} HT / mois</span><span className="pos-ded__pill">{eur(c.commission_ht_cents)} HT par client signé</span><span className="pos-ded__pill">« Déjà client » : {c.known_client_days} jours</span></div>
     <div className="pos-ded__grid">{counts.map(([s,n])=><div key={s} className="pos-ded__stat"><b>{n}</b><span>{STATUS_LABEL[s]}</span></div>)}</div>
    </div>
    {pending.map(s=><StatementCard key={s.id} s={s} busy={p.busy} onValidate={p.onValidate}/>)}
    {dels.map((d,n)=><DeliveryDocument key={d.id} d={d} items={items.filter(i=>i.delivery_id===d.id)} contract={c} today={p.today} busy={p.busy}
      open={(openDel[d.id]??n===0)} onToggle={()=>setOpenDel({...openDel,[d.id]:!(openDel[d.id]??n===0)})}
      onOpen={p.onOpen} onStatus={p.onStatus} onExport={f=>p.onExport(c.id,d.id,f)}/>)}
    {done.length>0&&<div className="pos-ded__card"><h3>Relevés validés</h3><table className="pos-ded__table"><tbody>{done.map(s=><tr key={s.id}><td>{monthLabel(s.month)}<br/><span className="pos-ded__meta">{plural(s.signed_count,'signature','signatures')} · validé le {dateFr(s.validated_at)}</span></td><td>{eur(s.amount_ht_cents)} HT</td></tr>)}</tbody></table></div>}
   </section>;
  })}
 </div>;
}

// ---------------------------------------------------------------- administrator
export type AdminView={contract:Contract&{organization:string;proposal:{version:number;sha256:string;file_name:string}|null};deliveries:number;counters:Counters;alerts:Alert[];
 statements:{id:string;month:string;signed_count:number;amount_ht_cents:number;validated_at:string|null}[]};
const COUNTER_LABEL:[keyof Counters,string][]=[['delivered','Livrées'],['opened','Ouvertes'],['exported','Exportées'],['contacted','Contactées'],['quoted','Devis'],['signed','Signées'],['lost','Perdues'],['known','Déjà clients']];

export type OrgHit={id:string;name:string;members:{email:string;role:string}[]|null};
export type NewProposal={organization_id:string;label:string;minimum_eur:number;commission_eur:number;trial_starts_on:string;first_statement_month:string;file:File};
const STATUS_TEXT:Record<ContractStatus,string>={PROPOSED:'Proposée — en attente d’acceptation',ACTIVE:'Active',TERMINATED:'Résiliée'};

export function DedicatedAdminView(p:{rows:AdminView[];busy:boolean;error:string;notice:string;
 onDelivery:(contractId:string,scope:string,lines:string)=>void;onDocDelivery:(contractId:string,scope:string,importFile:File,pdf:File)=>void;onSearch:(q:string)=>Promise<OrgHit[]>;onPropose:(n:NewProposal)=>void;
 onReplace:(contractId:string,file:File)=>void;onTerminate:(contractId:string)=>void}){
 const [scope,setScope]=useState<Record<string,string>>({});const [lines,setLines]=useState<Record<string,string>>({});
 const [docs,setDocs]=useState<Record<string,{imp?:File;pdf?:File}>>({});
 const [q,setQ]=useState('');const [hits,setHits]=useState<OrgHit[]>([]);const [org,setOrg]=useState<OrgHit|null>(null);const [file,setFile]=useState<File|null>(null);
 const [nc,setNc]=useState({label:'',minimum_eur:'99',commission_eur:'179',trial_starts_on:'',first_statement_month:''});
 const ready=!!org&&!!file&&!!nc.label.trim()&&!!nc.trial_starts_on&&!!nc.first_statement_month;
 const alertsCount=p.rows.reduce((n,r)=>n+r.alerts.length,0);
 return <div className="pos-ded">
  <header><h2>Veille dédiée — clients</h2><p className="pos-ded__muted">{plural(p.rows.length,'client','clients')} · {plural(alertsCount,'alerte','alertes')}. Visible par l’administrateur seulement.</p></header>
  {p.error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{p.error}</p>}
  {p.notice&&<p className="pos-ded__note" role="status">{p.notice}</p>}
  {p.rows.map(r=><section key={r.contract.id} className={`pos-ded__card${r.alerts.length?' pos-ded__card--warn':''}`} aria-label={r.contract.organization}>
   <div className="pos-ded__row"><h3>{r.contract.organization}</h3><span className="pos-ded__pill">{plural(r.deliveries,'livraison','livraisons')}</span></div>
   <p className="pos-ded__muted">{r.contract.label} · {eur(r.contract.minimum_ht_cents)} min. · {eur(r.contract.commission_ht_cents)} / signé</p>
   <p className="pos-ded__meta"><b>{STATUS_TEXT[r.contract.status]}</b>{r.contract.accepted_at?` · acceptée le ${dateFr(r.contract.accepted_at)}`:''}{r.contract.terminated_at?` · résiliée le ${dateFr(r.contract.terminated_at)} (accès client jusqu’au ${dateFr(accessUntil(r.contract.terminated_at))})`:''}{r.contract.proposal?` · proposition v${r.contract.proposal.version} (${r.contract.proposal.sha256.slice(0,12)}…)`:''}</p>
   <div className="pos-ded__grid">{COUNTER_LABEL.map(([k,l])=><div key={k} className="pos-ded__stat"><b>{r.counters[k]}</b><span>{l}</span></div>)}</div>
   {r.alerts.length>0&&<ul className="pos-ded__list">{r.alerts.map((a,n)=><li key={n} className="pos-ded__alert"><span>{a.text}</span>{a.items&&<small>{a.items.slice(0,12).join(', ')}{a.items.length>12?'…':''}</small>}</li>)}</ul>}
   {r.statements.length>0&&<table className="pos-ded__table"><tbody>{r.statements.slice(0,4).map(s=><tr key={s.id}><td>{monthLabel(s.month)}<br/><span className="pos-ded__meta">{plural(s.signed_count,'signature','signatures')} · {s.validated_at?`validé le ${dateFr(s.validated_at)}`:'non validé'}</span></td><td>{eur(s.amount_ht_cents)} HT</td></tr>)}</tbody></table>}
   {r.contract.status==='PROPOSED'&&<label className="pos-ded__btn">Joindre une nouvelle version (PDF)<input type="file" accept="application/pdf" hidden onChange={e=>{const f=e.target.files?.[0];if(f)p.onReplace(r.contract.id,f);e.target.value=''}}/></label>}
   {r.contract.status==='ACTIVE'&&<div className="pos-ded__actions"><button type="button" className="pos-ded__btn" disabled={p.busy} onClick={()=>{if(window.confirm(`Résilier la veille de ${r.contract.organization} ? Plus aucune livraison ; le client garde la consultation et la mise à jour des statuts pendant 6 mois.`))p.onTerminate(r.contract.id)}}>Résilier</button></div>}
   {r.contract.status==='ACTIVE'&&<details><summary className="pos-ded__btn">Nouvelle livraison</summary>
    <div className="pos-ded__form" style={{marginTop:8}}>
     <label>Périmètre<input value={scope[r.contract.id]??''} maxLength={500} placeholder="Île-de-France — créations, semaine 47" onChange={e=>setScope({...scope,[r.contract.id]:e.target.value})}/></label>
     <label>Fichier d’import (commercial/sortie/&lt;nom&gt;.import.json, npm run livraison)<input type="file" accept="application/json,.json" onChange={e=>setDocs({...docs,[r.contract.id]:{...docs[r.contract.id],imp:e.target.files?.[0]}})}/></label>
     <label>PDF de la livraison, tel qu’envoyé au client<input type="file" accept="application/pdf" onChange={e=>setDocs({...docs,[r.contract.id]:{...docs[r.contract.id],pdf:e.target.files?.[0]}})}/></label>
     <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={p.busy||!(scope[r.contract.id]??'').trim()||!docs[r.contract.id]?.imp||!docs[r.contract.id]?.pdf}
      onClick={()=>p.onDocDelivery(r.contract.id,scope[r.contract.id]!,docs[r.contract.id]!.imp!,docs[r.contract.id]!.pdf!)}>Livrer le document</button></div>
     <p className="pos-ded__muted">Ou, sans document : une liste simple.</p>
     <label>Entreprises (une par ligne : SIREN;Entreprise;Ville;Source;Lien https)<textarea value={lines[r.contract.id]??''} onChange={e=>setLines({...lines,[r.contract.id]:e.target.value})}/></label>
     <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={p.busy||!(scope[r.contract.id]??'').trim()||!(lines[r.contract.id]??'').trim()}
      onClick={()=>p.onDelivery(r.contract.id,scope[r.contract.id]!,lines[r.contract.id]!)}>Livrer</button></div>
    </div></details>}
  </section>)}
  <details className="pos-ded__card"><summary className="pos-ded__btn">Proposer une veille</summary>
   <div className="pos-ded__form" style={{marginTop:8}}>
    <label>Organisation existante (nom ou adresse d’un membre)<input value={q} placeholder="3 caractères au moins" onChange={async e=>{setQ(e.target.value);setOrg(null);setHits(e.target.value.trim().length>=3?await p.onSearch(e.target.value.trim()):[])}}/></label>
    {!org&&hits.length>0&&<ul className="pos-ded__list">{hits.map(h=><li key={h.id}><button type="button" className="pos-ded__btn" style={{width:'100%',justifyContent:'flex-start'}} onClick={()=>setOrg(h)}>{h.name} — {(h.members??[]).map(m=>m.email).join(', ')}</button></li>)}</ul>}
    {org&&<p className="pos-ded__note">Rattachée à <b>{org.name}</b> ({(org.members??[]).map(m=>m.email).join(', ')}) — identifiant {org.id.slice(0,8)}…. Aucun compte n’est créé.</p>}
    <label>Libellé<input value={nc.label} maxLength={160} placeholder="Veille Île-de-France" onChange={e=>setNc({...nc,label:e.target.value})}/></label>
    <div className="pos-ded__formrow">
     <label>Minimum HT / mois (€)<input inputMode="decimal" value={nc.minimum_eur} onChange={e=>setNc({...nc,minimum_eur:e.target.value})}/></label>
     <label>Commission HT / signé (€)<input inputMode="decimal" value={nc.commission_eur} onChange={e=>setNc({...nc,commission_eur:e.target.value})}/></label>
     <label>Début de l’essai<input type="date" value={nc.trial_starts_on} onChange={e=>setNc({...nc,trial_starts_on:e.target.value})}/></label>
    </div>
    <label>Premier mois de relevé<input type="month" value={nc.first_statement_month.slice(0,7)} onChange={e=>setNc({...nc,first_statement_month:e.target.value?`${e.target.value}-01`:''})}/></label>
    <label>Proposition (PDF généré par npm run devis)<input type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
    <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={p.busy||!ready}
     onClick={()=>p.onPropose({organization_id:org!.id,label:nc.label.trim(),minimum_eur:Number(nc.minimum_eur.replace(',','.')),commission_eur:Number(nc.commission_eur.replace(',','.')),trial_starts_on:nc.trial_starts_on,first_statement_month:nc.first_statement_month,file:file!})}>Proposer la veille</button></div>
   </div></details>
 </div>;
}
