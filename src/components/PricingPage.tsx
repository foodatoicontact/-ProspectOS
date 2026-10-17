import Link from 'next/link';
import {CHECKOUT_PRICES,PLAN_QUOTAS,TEAM_PRICING,type Quotas} from '../domain/plans';
import {CONTACT_MAILTO} from '../domain/contact';
import {VAT_PRICE_NOTE} from '../domain/legal';

// The offers block of /tarifs (server component, static HTML). Every amount and quota is read from plans.ts — the
// values the server checks before any checkout and the database enforces.
// Every call to action leads to the FREE TRIAL (account creation, no card): a visitor never reaches a payment page
// from here. A plan is chosen later, from the account, once the trial has shown what ProspectOS does.
export const TRIAL_SIGNUP_HREF='/#inscription';
const fmt=(n:number)=>new Intl.NumberFormat('fr-FR').format(n);
const eur=(cents:number)=>`${cents/100} €`;

function QuotaList({q,period}:{q:Quotas;period:string}){
 return <ul className="plan-quotas">
  <li>{fmt(q.discovery)} recherches de prospects {period}</li>
  <li>{fmt(q.analysis)} analyses de prospects {period}</li>
  <li>{fmt(q.aiOffer)} analyses d’offre par IA {period}</li>
 </ul>;
}

export function PricingPage(){
 const t=PLAN_QUOTAS.TRIAL;
 return <section className="pricing-page" aria-labelledby="pricing-page-title">
  <h2 id="pricing-page-title" className="sr-only">Offres et prix</h2>
  <div className="pricing-trial">
   <div>
    <p className="pricing-trial-title"><b>Créer votre compte</b></p>
    <p className="muted">Le compte se crée sans carte bancaire, avec {fmt(t.discovery)} recherches de prospects, {fmt(t.analysis)} analyses de prospects et {fmt(t.aiOffer)} analyses d’offre par IA pour démarrer. Aucun abonnement n’est souscrit automatiquement : vous choisissez votre offre depuis votre compte.</p>
   </div>
   <Link href={TRIAL_SIGNUP_HREF} className="primary large">Créer mon compte</Link>
  </div>
  <div className="pricing-cards pricing-cards-2">
   <article className="plan-card" aria-labelledby="tarif-solo">
    <header className="plan-head"><h3 id="tarif-solo">ProspectOS Solo</h3></header>
    <p className="plan-price"><b>{eur(CHECKOUT_PRICES.BETA.unitAmount)}</b> <span>/ mois</span></p>
    <p className="plan-for">Pour une personne qui prospecte régulièrement : dirigeant, indépendant ou premier commercial.</p>
    <QuotaList q={PLAN_QUOTAS.BETA} period="par mois"/>
    <ul className="plan-points"><li>1 compte</li><li>Sans engagement, résiliable à tout moment</li></ul>
    <div className="plan-cta"><Link href={TRIAL_SIGNUP_HREF} className="button">Créer mon compte</Link></div>
   </article>
   <article className="plan-card plan-emphasis" aria-labelledby="tarif-pro">
    <header className="plan-head"><h3 id="tarif-pro">ProspectOS Pro</h3></header>
    <p className="plan-price"><b>{eur(CHECKOUT_PRICES.PRO.unitAmount)}</b> <span>/ mois</span></p>
    <p className="plan-for">Pour une personne dont la prospection est une activité centrale : trois fois les volumes de Solo.</p>
    <QuotaList q={PLAN_QUOTAS.PRO} period="par mois"/>
    <ul className="plan-points"><li>1 compte</li><li>Sans engagement, résiliable à tout moment</li></ul>
    <div className="plan-cta"><Link href={TRIAL_SIGNUP_HREF} className="button primary">Créer mon compte</Link></div>
   </article>
  </div>
  <p className="pricing-team"><b>Vous prospectez à plusieurs ?</b> ProspectOS Équipe : {eur(TEAM_PRICING.baseAmount)} par mois pour {TEAM_PRICING.includedSeats} comptes, puis {eur(TEAM_PRICING.extraSeatAmount)} par compte supplémentaire, jusqu’à {TEAM_PRICING.maxSeats} comptes — les volumes de Pro par compte, en commun.</p>
  <p className="pricing-note muted">Prix par mois — {VAT_PRICE_NOTE}. Vous choisissez votre offre depuis votre compte, quand vous le souhaitez ; l’accès payant n’est ouvert qu’après confirmation du paiement. Une question ? <a href={CONTACT_MAILTO}>Écrivez-nous</a>.</p>
 </section>;
}
