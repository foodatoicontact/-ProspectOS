// Cockpit administrateur — the feed's vocabulary (migration 056). Pure: labels, filters, one line per event. Shared by the
// API (validation of the filters) and the screen.
export const FEED_KINDS=['SIGNUP','TRIAL_ENDED','INVOICE_PAID','PLAN_CHANGED','CANCELLATION','PAYMENT_FAILED','WATCH_REQUEST',
 'PROSPECT_REQUEST','PARTNER_APPLIED','PARTNER_CREATED','COMMISSION_DUE','COLLECT_FAILED'] as const;
export type FeedKind=typeof FEED_KINDS[number];
export const KIND_LABEL:Record<FeedKind,string>={
 SIGNUP:'Inscription',TRIAL_ENDED:'Fin d’essai',INVOICE_PAID:'Facture payée',PLAN_CHANGED:'Changement d’offre',CANCELLATION:'Résiliation',
 PAYMENT_FAILED:'Paiement échoué',WATCH_REQUEST:'Demande de veille',PROSPECT_REQUEST:'Demande « 3 prospects »',PARTNER_APPLIED:'Candidature partenaire',
 PARTNER_CREATED:'Partenaire inscrit',COMMISSION_DUE:'Commission due',COLLECT_FAILED:'Échec de collecte',
};
// Tone of the badge: what needs action now (danger), money in (success), the rest (neutral).
export const KIND_TONE:Record<FeedKind,'danger'|'success'|'accent'|'neutral'>={
 SIGNUP:'accent',TRIAL_ENDED:'neutral',INVOICE_PAID:'success',PLAN_CHANGED:'accent',CANCELLATION:'danger',PAYMENT_FAILED:'danger',
 WATCH_REQUEST:'accent',PROSPECT_REQUEST:'accent',PARTNER_APPLIED:'neutral',PARTNER_CREATED:'neutral',COMMISSION_DUE:'danger',COLLECT_FAILED:'danger',
};
// The filter chips: a few groups rather than twelve chips on a phone.
export const FEED_GROUPS:readonly {key:string;label:string;kinds:readonly FeedKind[]}[]=[
 {key:'requests',label:'Demandes',kinds:['WATCH_REQUEST','PROSPECT_REQUEST']},
 {key:'accounts',label:'Comptes',kinds:['SIGNUP','TRIAL_ENDED']},
 {key:'billing',label:'Facturation',kinds:['INVOICE_PAID','PLAN_CHANGED','CANCELLATION','PAYMENT_FAILED']},
 {key:'partners',label:'Partenaires',kinds:['PARTNER_APPLIED','PARTNER_CREATED','COMMISSION_DUE']},
 {key:'ops',label:'Collecte',kinds:['COLLECT_FAILED']},
];
export type FeedEvent={id:number;kind:FeedKind;occurred_at:string;organization_id:string|null;organization:string|null;source_table:string;source_id:string;
 detail:Record<string,unknown>;source:Record<string,unknown>|null};
export type Feed={events:FeedEvent[];has_more:boolean};

const PLAN_LABEL:Record<string,string>={PAID:'Solo',PRO:'Pro',TEAM:'Équipe'};
const STRIPE_STATUS:Record<string,string>={active:'actif',past_due:'paiement en retard',unpaid:'impayé',canceled:'terminé',incomplete:'incomplet',incomplete_expired:'expiré',trialing:'essai',paused:'en pause'};
const plan=(v:unknown)=>typeof v==='string'?PLAN_LABEL[v]??v:'—';
const euros=(c:unknown)=>typeof c==='number'?new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(c/100):'—';
const s=(v:unknown)=>typeof v==='string'&&v.trim()?v:null;
// One readable line, from the event and its source as read now. A source that no longer exists says so.
export function eventSummary(e:FeedEvent):string{
 const org=e.organization??'Organisation inconnue';const src=e.source;
 switch(e.kind){
  case 'SIGNUP':return org;
  case 'TRIAL_ENDED':return `${org} — essai terminé`;
  case 'INVOICE_PAID':return `${org} — offre ${plan(e.detail.plan)}`;
  case 'PAYMENT_FAILED':return `${org} — offre ${plan(e.detail.plan)}, ${STRIPE_STATUS[String(e.detail.status)]??s(e.detail.status)??'statut inconnu'}`;
  case 'PLAN_CHANGED':return e.detail.from?`${org} — ${plan(e.detail.from)} → ${plan(e.detail.to)}`:`${org} — souscription ${plan(e.detail.to)}`;
  case 'CANCELLATION':return `${org} — ${plan(e.detail.plan)}, ${e.detail.at_period_end?'fin à l’échéance':'terminé'}`;
  case 'WATCH_REQUEST':case 'PROSPECT_REQUEST':
   if(!src)return 'Demande supprimée (conservation de 12 mois écoulée)';
   return `${s(src.company)?`${src.company} — `:''}${s(src.activity)??'—'} · département ${s(src.department)??'—'}`;
  case 'PARTNER_APPLIED':return src?`${s(src.company)??'—'}`:'Candidature supprimée (non retenue, 6 mois écoulés)';
  case 'PARTNER_CREATED':return src?`${s(src.company)??'—'} (code ${s(src.code)??'—'})`:'—';
  case 'COMMISSION_DUE':return src?`${s(src.company)??'—'} — solde ${euros(src.balance_cents)}${src.paid?' · payé':''}`:'—';
  case 'COLLECT_FAILED':return `Tâche ${s(e.detail.job)??'—'} — ${s(e.detail.code)??'erreur'}`;
 }
}
// Paris date and time, short.
export const when=(iso:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(iso));
export const stripeLink=(e:FeedEvent)=>e.source_table==='stripe_webhook_events'&&/^evt_[A-Za-z0-9]+$/.test(e.source_id)?`https://dashboard.stripe.com/events/${e.source_id}`:null;
