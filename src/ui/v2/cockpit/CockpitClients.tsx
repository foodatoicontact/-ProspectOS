'use client';
// Cockpit administrateur — écran Clients (migration 059). One sheet per organization: its offer and dates, its usage, its
// Stripe billing (dashboard links, invoices read now), its veille dédiée, its partner of origin, the administrator's notes
// (timestamped, append-only) and its latest events. Mobile first (390 px): the list, then the sheet in place of it.
import {useCallback,useEffect,useState} from 'react';
import {KIND_LABEL,KIND_TONE,eventSummary,when,offerLine,clientDay as day,CLIENT_PLAN_LABEL as PLAN_LABEL,STATUS_LABEL,SUB_LABEL,INVOICE_LABEL,DED_LABEL,type FeedEvent} from '../../../cockpit/model.ts';
import type {InvoiceLine} from '../../../cockpit/clients.ts';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
export type ClientRow={id:string;name:string;created_at:string;owner_email:string|null;plan:string|null;status:string|null;expires_at:string|null;seats:number|null;
 subscription_status:string|null;cancel_at_period_end:boolean;members:number;last_activity:string|null;partner:string|null;dedicated:string|null;notes:number};
export type ClientSheet={organization:{id:string;name:string;created_at:string;owner_email:string|null;members:number};
 entitlement:{plan:string;status:string;starts_at:string;expires_at:string;seats:number|null}|null;
 billing:{customer_id:string;subscription_id:string|null;plan:string|null;status:string|null;current_period_start:string|null;current_period_end:string|null;cancel_at_period_end:boolean;seats:number|null}|null;
 usage:{projects:number;prospects:number;searches_30d:number;searches:number;ai_calls_30d:number;last_activity:string|null};
 dedicated:{id:string;label:string;status:string;accepted_at:string|null;terminated_at:string|null;deliveries:number;last_delivery:string|null}[];
 partner:{company:string;code:string;referred_at:string|null}|null;
 notes:{id:number;body:string;created_at:string;author:string|null}[];
 events:{id:number;kind:FeedEvent['kind'];occurred_at:string;detail:Record<string,unknown>;source_table:string;source_id:string}[];
 stripe:{mode:'test'|'live'|null;customer_url:string|null;invoices:InvoiceLine[]|null;unavailable?:boolean}};

const money=(cents:number,currency:string)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:currency.toUpperCase()}).format(cents/100);

export function ClientList(p:{rows:ClientRow[];total:number;query:string;busy:boolean;onQuery:(q:string)=>void;onOpen:(id:string)=>void;onMore:()=>void}){
 const [q,setQ]=useState(p.query);
 return <div className="pos-ded pos-cockpit">
  <h2>Clients</h2>
  <form className="pos-ded__form" role="search" onSubmit={e=>{e.preventDefault();p.onQuery(q)}}>
   <label>Rechercher une organisation ou un e-mail<input type="search" value={q} maxLength={80} onChange={e=>setQ(e.target.value)} placeholder="Nom, e-mail du propriétaire"/></label>
  </form>
  <p className="pos-ded__muted">{p.total} organisation{p.total>1?'s':''}</p>
  <ul className="pos-ded__list" aria-label="Organisations">
   {p.rows.map(c=><li key={c.id}><button type="button" className="pos-cockpit__event pos-cockpit__row" onClick={()=>p.onOpen(c.id)}>
    <span className="pos-ded__itemtop"><span className="pos-ded__name">{c.name}</span><span className="pos-cockpit__time">{day(c.created_at)}</span></span>
    <span className="pos-cockpit__summary">{offerLine(c.plan,c.status,c.expires_at)}{c.cancel_at_period_end?' · résiliation demandée':''}{c.subscription_status==='past_due'?' · paiement en retard':''}</span>
    <span className="pos-ded__meta">{c.members} membre{c.members>1?'s':''} · activité {c.last_activity?day(c.last_activity):'aucune'}{c.partner?` · partenaire ${c.partner}`:''}{c.dedicated?` · veille ${DED_LABEL[c.dedicated]??c.dedicated}`:''}{c.notes?` · ${c.notes} note${c.notes>1?'s':''}`:''}</span>
   </button></li>)}
  </ul>
  {p.rows.length<p.total&&<div className="pos-ded__actions"><button type="button" className="pos-ded__btn" disabled={p.busy} onClick={p.onMore}>{p.busy?'Chargement…':'Plus d’organisations'}</button></div>}
 </div>;
}

export function ClientSheetView({s,busy,onBack,onNote}:{s:ClientSheet;busy:boolean;onBack:()=>void;onNote:(body:string)=>Promise<boolean>}){
 const [note,setNote]=useState('');
 const e=s.entitlement,b=s.billing,u=s.usage;
 return <div className="pos-ded pos-cockpit">
  <div className="pos-ded__actions"><button type="button" className="pos-ded__btn" onClick={onBack}>← Clients</button></div>
  <h2>{s.organization.name}</h2>
  <p className="pos-ded__muted">Créée le {day(s.organization.created_at)} · {s.organization.members} membre{s.organization.members>1?'s':''}{s.organization.owner_email?` · ${s.organization.owner_email}`:''}</p>

  <section className="pos-ded__card" aria-label="Offre"><h3>Offre</h3>
   <p>{offerLine(e?.plan??null,e?.status??null,e?.expires_at??null)}</p>
   {e&&<p className="pos-ded__meta">Depuis le {day(e.starts_at)}{e.seats?` · ${e.seats} siège${e.seats>1?'s':''}`:''}</p>}
  </section>

  <section className="pos-ded__card" aria-label="Usage"><h3>Usage</h3>
   <div className="pos-ded__grid">
    <div className="pos-ded__stat"><b>{u.projects}</b><span>projets</span></div>
    <div className="pos-ded__stat"><b>{u.prospects}</b><span>prospects</span></div>
    <div className="pos-ded__stat"><b>{u.searches_30d}</b><span>recherches (30 j)</span></div>
    <div className="pos-ded__stat"><b>{u.ai_calls_30d}</b><span>analyses IA (30 j)</span></div>
   </div>
   <p className="pos-ded__meta">{u.searches} recherches en tout · dernière activité {u.last_activity?when(u.last_activity):'aucune'}</p>
  </section>

  <section className="pos-ded__card" aria-label="Facturation"><h3>Facturation Stripe</h3>
   {!b?<p className="pos-ded__muted">Aucun client Stripe : jamais passé par le paiement.</p>:<>
    <p>Abonnement {SUB_LABEL[b.status??'']??'—'}{b.plan?` · ${PLAN_LABEL[b.plan]??b.plan}`:''}{b.current_period_end?` · période jusqu’au ${day(b.current_period_end)}`:''}</p>
    {b.cancel_at_period_end&&<p className="pos-ded__note pos-ded__note--error">Résiliation demandée : fin à l’échéance.</p>}
    {s.stripe.customer_url&&<a href={s.stripe.customer_url} target="_blank" rel="noreferrer">Ouvrir le client dans Stripe</a>}
    {s.stripe.invoices===null?<p className="pos-ded__muted">{s.stripe.unavailable?'Factures momentanément illisibles depuis Stripe.':'—'}</p>
     :!s.stripe.invoices.length?<p className="pos-ded__muted">Aucune facture.</p>
     :<table className="pos-ded__table"><tbody>{s.stripe.invoices.map(i=><tr key={i.id}>
      <td><a href={i.url} target="_blank" rel="noreferrer">{i.number??i.id}</a><br/><span className="pos-ded__meta">{day(i.created)} · {INVOICE_LABEL[i.status??'']??i.status??'—'}</span></td>
      <td>{money(i.total_cents,i.currency)}</td></tr>)}</tbody></table>}
   </>}
  </section>

  <section className="pos-ded__card" aria-label="Veille dédiée"><h3>Veille dédiée</h3>
   {!s.dedicated.length?<p className="pos-ded__muted">Aucune veille.</p>:s.dedicated.map(d=><div key={d.id}>
    <p><b>{d.label}</b> · {DED_LABEL[d.status]??d.status}</p>
    <p className="pos-ded__meta">{d.accepted_at?`Acceptée le ${day(d.accepted_at)} · `:''}{d.deliveries} livraison{d.deliveries>1?'s':''}{d.last_delivery?` · dernière le ${day(d.last_delivery)}`:''}{d.terminated_at?` · résiliée le ${day(d.terminated_at)}`:''}</p>
   </div>)}
  </section>

  <section className="pos-ded__card" aria-label="Partenaire d’origine"><h3>Partenaire d’origine</h3>
   <p>{s.partner?`${s.partner.company} (code ${s.partner.code})${s.partner.referred_at?` · depuis le ${day(s.partner.referred_at)}`:''}`:'Aucun : inscription directe.'}</p>
  </section>

  <section className="pos-ded__card" aria-label="Notes"><h3>Notes</h3>
   <form className="pos-ded__form" onSubmit={async ev=>{ev.preventDefault();if(note.trim()&&await onNote(note.trim()))setNote('')}}>
    <label>Nouvelle note<textarea className="pos-cockpit__note" value={note} maxLength={2000} onChange={x=>setNote(x.target.value)} placeholder="Échange, besoin, prochaine étape…"/></label>
    <div className="pos-ded__actions"><button type="submit" className="pos-ded__btn pos-ded__btn--primary" disabled={busy||!note.trim()}>Ajouter la note</button></div>
   </form>
   {!s.notes.length?<p className="pos-ded__muted">Aucune note.</p>:<ul className="pos-ded__list">{s.notes.map(n=><li key={n.id} className="pos-cockpit__event">
    <span className="pos-cockpit__time">{when(n.created_at)}{n.author?` · ${n.author}`:''}</span><p className="pos-cockpit__summary pos-cockpit__notebody">{n.body}</p></li>)}</ul>}
   <p className="pos-ded__meta">Les notes ne se modifient ni ne se suppriment : ajoutez une nouvelle note pour corriger.</p>
  </section>

  <section className="pos-ded__card" aria-label="Événements"><h3>Derniers événements</h3>
   {!s.events.length?<p className="pos-ded__muted">Aucun événement.</p>:<ul className="pos-ded__list">{s.events.map(ev=><li key={ev.id} className="pos-cockpit__event">
    <span className="pos-ded__itemtop"><span className={`pos-cockpit__kind pos-cockpit__kind--${KIND_TONE[ev.kind]}`}>{KIND_LABEL[ev.kind]}</span><time className="pos-cockpit__time" dateTime={ev.occurred_at}>{when(ev.occurred_at)}</time></span>
    <span className="pos-cockpit__summary">{eventSummary({...ev,organization_id:s.organization.id,organization:s.organization.name,source:null})}</span></li>)}</ul>}
  </section>
 </div>;
}

export function CockpitClients({api}:{api:Api}){
 const [rows,setRows]=useState<ClientRow[]>([]);const [total,setTotal]=useState(0);const [query,setQuery]=useState('');
 const [sheet,setSheet]=useState<ClientSheet|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const load=useCallback(async(q:string,offset:number)=>{setBusy(true);setError('');
  try{const d=await api(`cockpit/clients?${new URLSearchParams({q,offset:String(offset)})}`);setRows(r=>offset?[...r,...d.clients]:d.clients);setTotal(d.total)}
  catch(e){setError(e instanceof Error?e.message:'Action impossible pour le moment.')}finally{setBusy(false)}},[api]);
 useEffect(()=>{load(query,0)},[query,load]);
 const open=async(id:string)=>{setBusy(true);setError('');try{setSheet(await api(`cockpit/clients/${id}`));window.scrollTo(0,0)}catch(e){setError(e instanceof Error?e.message:'Action impossible pour le moment.')}finally{setBusy(false)}};
 const addNote=async(body:string)=>{if(!sheet)return false;setBusy(true);setError('');
  try{await api(`cockpit/clients/${sheet.organization.id}/notes`,'POST',{body});setSheet(await api(`cockpit/clients/${sheet.organization.id}`));return true}
  catch(e){setError(e instanceof Error?e.message:'Action impossible pour le moment.');return false}finally{setBusy(false)}};
 return <>
  {error&&<div className="pos-ded" style={{paddingBottom:0}}><p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p></div>}
  {sheet?<ClientSheetView s={sheet} busy={busy} onBack={()=>{setSheet(null);load(query,0)}} onNote={addNote}/>
   :<ClientList rows={rows} total={total} query={query} busy={busy} onQuery={setQuery} onOpen={open} onMore={()=>load(query,rows.length)}/>}
 </>;
}
