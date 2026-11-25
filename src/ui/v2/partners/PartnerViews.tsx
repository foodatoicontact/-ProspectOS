'use client';
// Programme partenaires (052) — the partner's space: their link and code, the sign-ups, the paying clients, the
// commissions of the month and the balance, then each line and each monthly statement. A client is only ever an
// anonymous reference (C-XXXXXX) and an amount: never a name, an e-mail or a company — the database sends nothing else.
import {useState} from 'react';
import {euros,monthLabel,dayLabel} from '../../../partners/model.ts';
import {statementState,STATE_LABEL,type SpaceData} from './model.ts';
export function PartnerSpaceView({data,onCopy}:{data:SpaceData;onCopy?:(text:string)=>Promise<void>|void}){
 const [copied,setCopied]=useState('');
 const copy=async(what:string,text:string)=>{try{await onCopy?.(text);setCopied(what);setTimeout(()=>setCopied(''),2000)}catch{}};
 const p=data.partner;
 return <div className="pos-ded" aria-labelledby="pos-partner-title">
  <div><h2 id="pos-partner-title">Espace partenaire</h2><p className="pos-ded__muted">{p.company} · {p.rate_percent.toLocaleString('fr-FR')} % du montant HT payé par chaque client apporté, pendant ses 12 premiers mois.</p></div>
  {p.status==='SUSPENDED'&&<p className="pos-ded__note pos-ded__note--error" role="status">Votre partenariat est suspendu : les nouvelles inscriptions ne vous sont plus attribuées. Vos commissions déjà acquises restent dues.</p>}
  <section className="pos-ded__card pos-ded__card--accent" aria-label="Votre lien">
   <h3>Votre lien de recommandation</h3>
   <p className="pos-ded__calc"><b>{data.link}</b></p>
   <p className="pos-ded__muted">Ou votre code, à saisir à l’inscription : <b>{p.code}</b></p>
   <div className="pos-ded__actions">
    <button type="button" className="pos-ded__btn pos-ded__btn--primary" onClick={()=>copy('link',data.link)}>{copied==='link'?'Lien copié':'Copier le lien'}</button>
    <button type="button" className="pos-ded__btn" onClick={()=>copy('code',p.code)}>{copied==='code'?'Code copié':'Copier le code'}</button>
   </div>
  </section>
  <section className="pos-ded__card" aria-label="Vos chiffres">
   <div className="pos-ded__grid">
    <div className="pos-ded__stat"><b>{data.signups}</b><span>inscrits</span></div>
    <div className="pos-ded__stat"><b>{data.paying_clients}</b><span>clients payants</span></div>
   </div>
   <div className="pos-ded__row"><span className="pos-ded__muted">Commissions de {monthLabel(data.month)}</span><b>{euros(data.month_commissions_cents)}</b></div>
   <div className="pos-ded__row"><span className="pos-ded__muted">Solde à verser</span><span className="pos-ded__amount">{euros(data.balance_cents)}</span></div>
   <p className="pos-ded__muted">Relevé le 1er de chaque mois. Versement par virement à partir de {euros(data.threshold_cents)} ; en dessous, le solde est reporté.</p>
  </section>
  <section className="pos-ded__card" aria-label="Commissions">
   <h3>Commissions</h3>
   {data.lines.length?<table className="pos-ded__table"><tbody>{data.lines.map((l,i)=><tr key={i}>
    <td><b>{l.client}</b><br/><span className="pos-ded__muted">{dayLabel(l.occurred_at)} · {l.kind==='REFUND'?'remboursement':`paiement de ${euros(l.base_ht_cents??0)} HT`}</span></td>
    <td>{euros(l.amount_cents)}</td></tr>)}</tbody></table>
   :<p className="pos-ded__muted">Aucune commission pour l’instant : elles apparaissent ici dès le premier paiement d’un client que vous avez apporté.</p>}
   <p className="pos-ded__muted">Chaque client est désigné par une référence anonyme : ProspectOS ne vous communique ni son nom ni ses coordonnées.</p>
  </section>
  <section className="pos-ded__card" aria-label="Relevés">
   <h3>Relevés mensuels</h3>
   {data.statements.length?<ul className="pos-ded__list">{data.statements.map((s,i)=>{const st=statementState(s,i===0);return <li key={s.id} className="pos-ded__row">
    <span><b>{monthLabel(s.month)}</b><br/><span className="pos-ded__muted">{s.payments_count} paiement{s.payments_count>1?'s':''} · {euros(s.month_commissions_cents)} · solde {euros(s.balance_cents)}</span></span>
    <span className="pos-ded__pill">{st==='PAID'&&s.paid?`Payé le ${dayLabel(s.paid.paid_on)}`:STATE_LABEL[st]}</span></li>})}</ul>
   :<p className="pos-ded__muted">Votre premier relevé sera établi le 1er du mois prochain.</p>}
  </section>
 </div>;
}
