'use client';
// Programme partenaires (052) — the administrator's dashboard: the statements to pay (each with the transfer date and
// reference, no automatic transfer), every partner with their balance, the creation of a partner (prefilled from an
// application), and the applications received from /partenaires. Every refusal is the server's sentence.
import {useState} from 'react';
import {euros,monthLabel,dayLabel,normalizePartnerCode,siretValid,PAYOUT_THRESHOLD_CENTS} from '../../../partners/model.ts';
import type {AdminData,Application} from './model.ts';
export type AdminActions={
 markPaid:(statementId:string,paidOn:string,reference:string)=>Promise<void>;
 setStatus:(partnerId:string,status:'ACTIVE'|'SUSPENDED')=>Promise<void>;
 create:(p:{name:string;company:string;siret:string;email:string;code:string;rate_percent:number})=>Promise<void>;
};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date());
export function PartnerAdminView({data,actions,busy=false}:{data:AdminData;actions:AdminActions;busy?:boolean}){
 const [pay,setPay]=useState<Record<string,{date:string;ref:string}>>({});
 const empty={name:'',company:'',siret:'',email:'',code:'',rate:'30'};
 const [form,setForm]=useState(empty);const [open,setOpen]=useState(false);
 const prefill=(a:Application)=>{setForm({name:a.name,company:a.company,siret:a.siret,email:a.email,code:'',rate:'30'});setOpen(true)};
 const valid=form.name.trim().length>1&&form.company.trim().length>1&&siretValid(form.siret)&&/@/.test(form.email)&&!!normalizePartnerCode(form.code)&&Number(form.rate)>0&&Number(form.rate)<=50;
 const toPayTotal=data.to_pay.reduce((s,x)=>s+x.balance_cents,0);
 return <div className="pos-ded" aria-labelledby="pos-partners-admin-title">
  <div><h2 id="pos-partners-admin-title">Partenaires</h2><p className="pos-ded__muted">{data.partners.length} partenaire{data.partners.length>1?'s':''} · {data.to_pay.length} relevé{data.to_pay.length>1?'s':''} à payer ({euros(toPayTotal)})</p></div>
  <section className="pos-ded__card pos-ded__card--accent" aria-label="Relevés à payer">
   <h3>Relevés à payer</h3>
   {data.to_pay.length?<ul className="pos-ded__list">{data.to_pay.map(t=>{const v=pay[t.id]??{date:today(),ref:''};return <li key={t.id} className="pos-ded__form" style={{paddingTop:8,borderTop:'1px solid var(--pos-border)'}}>
    <div className="pos-ded__row"><span><b>{t.partner}</b> · {t.code}<br/><span className="pos-ded__muted">{monthLabel(t.month)} · {euros(t.month_commissions_cents)} ce mois-là</span></span><span className="pos-ded__amount">{euros(t.balance_cents)}</span></div>
    <div className="pos-ded__formrow">
     <label>Date du virement<input type="date" value={v.date} max={today()} onChange={e=>setPay({...pay,[t.id]:{...v,date:e.target.value}})}/></label>
     <label>Référence du virement<input value={v.ref} maxLength={80} placeholder="VIR-2026-12-01" onChange={e=>setPay({...pay,[t.id]:{...v,ref:e.target.value}})}/></label>
    </div>
    <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={busy||v.ref.trim().length<3||!v.date}
     onClick={()=>{if(window.confirm(`Marquer payé : ${euros(t.balance_cents)} à ${t.partner} (virement ${v.ref.trim()} du ${v.date}) ?`))actions.markPaid(t.id,v.date,v.ref.trim())}}>Marquer payé</button></div>
   </li>})}</ul>:<p className="pos-ded__muted">Aucun relevé à payer. Les relevés sont établis le 1er du mois ; un solde inférieur à {euros(PAYOUT_THRESHOLD_CENTS)} est reporté.</p>}
  </section>
  <section className="pos-ded__card" aria-label="Partenaires">
   <div className="pos-ded__row"><h3>Partenaires</h3><button type="button" className="pos-ded__btn" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Fermer':'Nouveau partenaire'}</button></div>
   {open&&<div className="pos-ded__form" aria-label="Nouveau partenaire">
    <div className="pos-ded__formrow">
     <label>Nom<input value={form.name} maxLength={120} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     <label>Entreprise<input value={form.company} maxLength={160} onChange={e=>setForm({...form,company:e.target.value})}/></label>
     <label>SIRET<input value={form.siret} inputMode="numeric" maxLength={17} onChange={e=>setForm({...form,siret:e.target.value})}/></label>
    </div>
    <div className="pos-ded__formrow">
     <label>E-mail<input type="email" value={form.email} maxLength={254} onChange={e=>setForm({...form,email:e.target.value})}/></label>
     <label>Code (3 à 20 lettres ou chiffres)<input value={form.code} maxLength={24} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/></label>
     <label>Taux (%)<input type="number" min={1} max={50} step={0.5} value={form.rate} onChange={e=>setForm({...form,rate:e.target.value})}/></label>
    </div>
    {form.siret&&!siretValid(form.siret)&&<p className="pos-ded__note pos-ded__note--error">SIRET invalide (clé de contrôle).</p>}
    <div className="pos-ded__actions"><button type="button" className="pos-ded__btn pos-ded__btn--primary" disabled={busy||!valid}
     onClick={async()=>{await actions.create({name:form.name.trim(),company:form.company.trim(),siret:form.siret.replace(/\s/g,''),email:form.email.trim(),code:normalizePartnerCode(form.code)!,rate_percent:Number(form.rate)});setForm(empty);setOpen(false)}}>Créer le partenaire</button></div>
   </div>}
   {data.partners.length?<ul className="pos-ded__list">{data.partners.map(p=><li key={p.id} style={{display:'grid',gap:6,paddingTop:8,borderTop:'1px solid var(--pos-border)'}}>
    <div className="pos-ded__row"><span><b>{p.company}</b> · {p.code}{p.status==='SUSPENDED'&&<span className="pos-ded__pill" style={{marginLeft:6}}>Suspendu</span>}<br/>
     <span className="pos-ded__muted">{p.name} · {p.email} · {p.rate_percent.toLocaleString('fr-FR')} %{p.has_account?' · compte relié':''}</span></span>
     <span className="pos-ded__amount">{euros(p.balance_cents)}</span></div>
    <div className="pos-ded__grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>
     <div className="pos-ded__stat"><b>{p.signups}</b><span>inscrits</span></div>
     <div className="pos-ded__stat"><b>{p.paying_clients}</b><span>payants</span></div>
     <div className="pos-ded__stat"><b>{euros(p.earned_cents)}</b><span>gagné</span></div>
     <div className="pos-ded__stat"><b>{euros(p.paid_cents)}</b><span>versé</span></div>
    </div>
    <div className="pos-ded__actions"><button type="button" className="pos-ded__btn" disabled={busy}
     onClick={()=>{const next=p.status==='ACTIVE'?'SUSPENDED':'ACTIVE';if(window.confirm(next==='SUSPENDED'?`Suspendre ${p.company} ? Les nouvelles inscriptions ne lui seront plus attribuées ; ses commissions acquises restent dues.`:`Réactiver ${p.company} ?`))actions.setStatus(p.id,next)}}>
     {p.status==='ACTIVE'?'Suspendre':'Réactiver'}</button></div>
   </li>)}</ul>:<p className="pos-ded__muted">Aucun partenaire. Créez-en un, ou depuis une candidature ci-dessous.</p>}
  </section>
  <section className="pos-ded__card" aria-label="Candidatures">
   <h3>Candidatures</h3>
   {data.applications.length?<ul className="pos-ded__list">{data.applications.map(a=><li key={a.id} style={{display:'grid',gap:4,paddingTop:8,borderTop:'1px solid var(--pos-border)'}}>
    <span><b>{a.company}</b> · {a.name} · <span className="pos-ded__muted">{dayLabel(a.created_at)}</span></span>
    <span className="pos-ded__muted">{a.email} · SIRET {a.siret}</span>
    <span className="pos-ded__calc">{a.pitch}</span>
    <div className="pos-ded__actions">{a.is_partner?<span className="pos-ded__pill">Déjà partenaire</span>
     :<button type="button" className="pos-ded__btn" onClick={()=>prefill(a)}>Créer ce partenaire</button>}</div>
   </li>)}</ul>:<p className="pos-ded__muted">Aucune candidature reçue.</p>}
  </section>
 </div>;
}
