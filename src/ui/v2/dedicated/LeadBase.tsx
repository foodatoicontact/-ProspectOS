'use client';
// Base entreprises de la veille (migration 049, src/leads) — the administrator's panel inside a client's card: its profile
// (trade, departments, events, NAF), its pool sorted by the database (business sales and head-office moves first), the
// reservation (exclusive per trade) and « Préparer la livraison », which fills the simple delivery form with the reserved
// leads. Every refusal is the server's sentence; after each change the pool is read again.
import {useCallback,useEffect,useState} from 'react';
import {LEAD_KINDS,KIND_LABEL,deliveryLines,type LeadPool} from '../../../leads/model.ts';
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
const message=(e:unknown)=>e instanceof Error&&e.message?e.message:'Action impossible pour le moment.';
const dateFr=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'short',timeZone:'UTC'});
const list=(s:string)=>s.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);

export function LeadBase({api,contractId,onPrepare}:{api:Api;contractId:string;onPrepare:(lines:string,scope:string)=>void}){
 const [pool,setPool]=useState<LeadPool|null>(null);const [missing,setMissing]=useState(false);const [editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [picked,setPicked]=useState<Set<string>>(new Set());
 const [form,setForm]=useState({trade_label:'',departments:'',kinds:[...LEAD_KINDS] as string[],naf_prefixes:''});
 const load=useCallback(async()=>{
  try{const p=await api(`leads/contracts/${contractId}/pool?days=60&limit=150`) as LeadPool;setPool(p);setMissing(false);setError('');
   setForm({trade_label:p.profile.trade_label,departments:p.profile.departments.join(', '),kinds:p.profile.kinds,naf_prefixes:p.profile.naf_prefixes.join(', ')})}
  catch(e){const m=message(e);if(/pas encore de profil/.test(m)){setMissing(true);setPool(null)}else setError(m)}
 },[api,contractId]);
 useEffect(()=>{load()},[load]);
 const run=async(fn:()=>Promise<string>)=>{setBusy(true);setError('');setNotice('');try{setNotice(await fn());await load()}catch(e){setError(message(e))}finally{setBusy(false)}};
 const saveProfile=()=>run(async()=>{
  const r=await api(`leads/contracts/${contractId}/profile`,'POST',{trade_label:form.trade_label.trim(),departments:list(form.departments),kinds:form.kinds,naf_prefixes:list(form.naf_prefixes)});
  setEditing(false);
  const held=(r.held_by_another_client??[]) as string[];
  return `Profil enregistré.${r.reserved_from_deliveries?` ${r.reserved_from_deliveries} entreprise(s) déjà livrée(s) réservée(s) pour ce métier.`:''}${held.length?` Déjà tenues par un autre client du métier : ${held.join(', ')}.`:''}`;
 });
 const reserve=()=>run(async()=>{
  const r=await api(`leads/contracts/${contractId}/reserve`,'POST',{sirens:[...picked]});setPicked(new Set());
  const held=(r.held_by_another_client??[]) as string[];
  return `${r.reserved} lead(s) réservé(s) pour ce client.${held.length?` Non réservés, tenus par un autre client du même métier : ${held.join(', ')}.`:''}`;
 });
 const showForm=missing||editing;
 const reserved=pool?.leads.filter(l=>l.reserved)??[];
 return <div className="pos-ded__form" style={{marginTop:8}}>
  {error&&<p className="pos-ded__note pos-ded__note--error" role="alert">{error}</p>}
  {notice&&<p className="pos-ded__note" role="status">{notice}</p>}
  {showForm?<>
   <p className="pos-ded__muted">Le profil dit ce que ce client reçoit. Un lead réservé pour lui ne peut plus aller chez un autre client du même métier ; un client d’un autre métier peut le recevoir.</p>
   <label>Métier<input value={form.trade_label} maxLength={80} placeholder="Sécurité incendie" onChange={e=>setForm({...form,trade_label:e.target.value})}/></label>
   <label>Départements (séparés par des virgules)<input value={form.departments} placeholder="75, 77, 78, 91, 92, 93, 94, 95" onChange={e=>setForm({...form,departments:e.target.value})}/></label>
   <fieldset className="pos-ded__formrow" style={{border:0,padding:0}}><legend className="pos-ded__muted">Événements</legend>
    {LEAD_KINDS.map(k=><label key={k} style={{flexDirection:'row',alignItems:'center',gap:6}}><input type="checkbox" checked={form.kinds.includes(k)}
     onChange={e=>setForm({...form,kinds:e.target.checked?[...form.kinds,k]:form.kinds.filter(x=>x!==k)})}/>{KIND_LABEL[k]}</label>)}
   </fieldset>
   <label>Codes NAF (facultatif : début du code, ex. 55 pour l’hôtellerie, 56.10 pour la restauration)<input value={form.naf_prefixes} placeholder="55, 56.10" onChange={e=>setForm({...form,naf_prefixes:e.target.value})}/></label>
   <div className="pos-ded__actions">
    {editing&&<button type="button" className="pos-ded__btn" disabled={busy} onClick={()=>setEditing(false)}>Annuler</button>}
    <button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={busy||form.trade_label.trim().length<2||!list(form.departments).length||!form.kinds.length} onClick={saveProfile}>Enregistrer le profil</button>
   </div>
  </>:pool&&<>
   <p className="pos-ded__meta"><b>{pool.profile.trade_label}</b> · départements {pool.profile.departments.join(', ')} · {pool.profile.kinds.map(k=>KIND_LABEL[k]??k).join(', ')}
    {pool.profile.naf_prefixes.length?` · NAF ${pool.profile.naf_prefixes.join(', ')}`:''}</p>
   <div className="pos-ded__actions"><button type="button" className="pos-ded__btn" onClick={()=>setEditing(true)}>Modifier le profil</button></div>
   <p className="pos-ded__muted">{pool.leads.length} lead(s) disponibles sur 60 jours, reprises et transferts d’abord. Entreprises actives, sans opposition à la prospection, jamais une entreprise individuelle.
    {pool.waiting_enrichment>0?` ${pool.waiting_enrichment} autre(s) attendent leur fiche (enrichissement de nuit).`:''}</p>
   {pool.leads.length>0&&<ul className="pos-ded__list" style={{gap:0}}>{pool.leads.map(l=><li key={l.siren}
    style={{display:'grid',gridTemplateColumns:'22px minmax(0,1fr) auto',gap:10,alignItems:'start',padding:'10px 0',borderTop:'1px solid var(--pos-border)'}}>
    <input type="checkbox" disabled={l.reserved} checked={l.reserved||picked.has(l.siren)} aria-label={`Choisir ${l.name??l.siren}`} style={{width:18,height:18,margin:'2px 0 0'}}
     onChange={e=>{const n=new Set(picked);if(e.target.checked)n.add(l.siren);else n.delete(l.siren);setPicked(n)}}/>
    <span style={{minWidth:0}}><b>{l.name??l.siren}</b>{l.reserved&&<span className="pos-ded__pill" style={{marginLeft:6}}>Réservé</span>}<br/>
     <span className="pos-ded__meta">{KIND_LABEL[l.kind]??l.kind} · {dateFr(l.event_on)} · {l.commune??''}{l.department?` (${l.department})`:''}{l.naf?` · NAF ${l.naf}`:''}
      {l.other_trades>0?` · aussi chez ${l.other_trades} autre(s) métier(s)`:''}{l.lists>0?` · déjà dans ${l.lists} liste(s)`:''}</span></span>
    <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="pos-ded__btn">Source ↗</a></li>)}</ul>}
   <div className="pos-ded__actions">
    <button type="button" className="pos-ded__btn" disabled={busy||!picked.size} onClick={reserve}>Réserver ({picked.size})</button>
    <button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={busy||!reserved.length}
     onClick={()=>onPrepare(deliveryLines(reserved),`${pool.profile.trade_label} — ${reserved.length} entreprise(s), semaine du ${dateFr(new Date().toISOString())}`)}>Préparer la livraison ({reserved.length})</button>
   </div>
  </>}
  {!showForm&&!pool&&!error&&<p className="pos-ded__muted">Chargement…</p>}
 </div>;
}
