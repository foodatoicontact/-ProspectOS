// Cockpit administrateur — the feed's vocabulary (migration 056). Pure: labels, filters, one line per event. Shared by the
// API (validation of the filters) and the screen.
export const FEED_KINDS=['SIGNUP','TRIAL_ENDED','INVOICE_PAID','PLAN_CHANGED','CANCELLATION','PAYMENT_FAILED','WATCH_REQUEST',
 'PROSPECT_REQUEST','PARTNER_APPLIED','PARTNER_CREATED','COMMISSION_DUE','COLLECT_FAILED',
 // ProspectOS installable (migration 057).
 'INSTALL_PROMPT_SHOWN','INSTALL_PROMPT_REFUSED','APP_INSTALLED','PUSH_ENABLED'] as const;
export type FeedKind=typeof FEED_KINDS[number];
export const KIND_LABEL:Record<FeedKind,string>={
 SIGNUP:'Inscription',TRIAL_ENDED:'Fin d’essai',INVOICE_PAID:'Facture payée',PLAN_CHANGED:'Changement d’offre',CANCELLATION:'Résiliation',
 PAYMENT_FAILED:'Paiement échoué',WATCH_REQUEST:'Demande de veille',PROSPECT_REQUEST:'Demande « 3 prospects »',PARTNER_APPLIED:'Candidature partenaire',
 PARTNER_CREATED:'Partenaire inscrit',COMMISSION_DUE:'Commission due',COLLECT_FAILED:'Échec de collecte',
 INSTALL_PROMPT_SHOWN:'Invitation affichée',INSTALL_PROMPT_REFUSED:'Invitation refusée',APP_INSTALLED:'App installée',PUSH_ENABLED:'Notifications activées',
};
// Tone of the badge: what needs action now (danger), money in (success), the rest (neutral).
export const KIND_TONE:Record<FeedKind,'danger'|'success'|'accent'|'neutral'>={
 SIGNUP:'accent',TRIAL_ENDED:'neutral',INVOICE_PAID:'success',PLAN_CHANGED:'accent',CANCELLATION:'danger',PAYMENT_FAILED:'danger',
 WATCH_REQUEST:'accent',PROSPECT_REQUEST:'accent',PARTNER_APPLIED:'neutral',PARTNER_CREATED:'neutral',COMMISSION_DUE:'danger',COLLECT_FAILED:'danger',
 INSTALL_PROMPT_SHOWN:'neutral',INSTALL_PROMPT_REFUSED:'neutral',APP_INSTALLED:'success',PUSH_ENABLED:'success',
};
// The filter chips: a few groups rather than twelve chips on a phone.
export const FEED_GROUPS:readonly {key:string;label:string;kinds:readonly FeedKind[]}[]=[
 {key:'requests',label:'Demandes',kinds:['WATCH_REQUEST','PROSPECT_REQUEST']},
 {key:'accounts',label:'Comptes',kinds:['SIGNUP','TRIAL_ENDED']},
 {key:'billing',label:'Facturation',kinds:['INVOICE_PAID','PLAN_CHANGED','CANCELLATION','PAYMENT_FAILED']},
 {key:'partners',label:'Partenaires',kinds:['PARTNER_APPLIED','PARTNER_CREATED','COMMISSION_DUE']},
 {key:'ops',label:'Collecte',kinds:['COLLECT_FAILED']},
 {key:'app',label:'Application',kinds:['INSTALL_PROMPT_SHOWN','INSTALL_PROMPT_REFUSED','APP_INSTALLED','PUSH_ENABLED']},
];
export type FeedEvent={id:number;kind:FeedKind;occurred_at:string;organization_id:string|null;organization:string|null;source_table:string;source_id:string;
 detail:Record<string,unknown>;source:Record<string,unknown>|null};
export type Feed={events:FeedEvent[];has_more:boolean};

const PLATFORM_LABEL:Record<string,string>={ios:'iPhone',android:'Android',desktop:'ordinateur',other:'autre appareil'};
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
  case 'INSTALL_PROMPT_SHOWN':case 'INSTALL_PROMPT_REFUSED':case 'APP_INSTALLED':case 'PUSH_ENABLED':
   return `${org} — ${PLATFORM_LABEL[String(e.detail.platform)]??'appareil inconnu'}`;
 }
}
// Paris date and time, short.
export const when=(iso:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(iso));
export const stripeLink=(e:FeedEvent)=>e.source_table==='stripe_webhook_events'&&/^evt_[A-Za-z0-9]+$/.test(e.source_id)?`https://dashboard.stripe.com/events/${e.source_id}`:null;

// Écran Clients (migration 059): labels of a client sheet.
export const CLIENT_PLAN_LABEL:Record<string,string>={BETA:'Essai',PAID:'Solo',PRO:'Pro',TEAM:'Équipe',ENTERPRISE:'Entreprise',INTERNAL:'Interne'};
export const STATUS_LABEL:Record<string,string>={ACTIVE:'actif',EXPIRED:'terminé',REVOKED:'retiré'};
export const SUB_LABEL:Record<string,string>={active:'active',past_due:'paiement en retard',unpaid:'impayée',canceled:'résiliée',incomplete:'incomplète',incomplete_expired:'expirée',trialing:'essai',paused:'en pause'};
export const INVOICE_LABEL:Record<string,string>={paid:'payée',open:'à payer',draft:'brouillon',void:'annulée',uncollectible:'irrécouvrable'};
export const DED_LABEL:Record<string,string>={PROPOSED:'proposée',ACTIVE:'active',TERMINATED:'résiliée'};
export const clientDay=(iso:string|null|undefined)=>iso?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeZone:'Europe/Paris'}).format(new Date(iso)):'—';
export function offerLine(plan:string|null,status:string|null,expires:string|null){
 if(!plan)return 'Aucune offre';
 return `${CLIENT_PLAN_LABEL[plan]??plan} · ${STATUS_LABEL[status??'']??status??'—'}${expires&&plan!=='INTERNAL'?` · jusqu’au ${clientDay(expires)}`:''}`;
}


// Écran Pipeline (migration 060): the requests of the two public forms, in six columns. Pure, shared by the screen and tests.
export const PIPELINE_STAGES=['NEW','CONTACTED','DEMO','QUOTE','SIGNED','LOST'] as const;
export type PipelineStage=typeof PIPELINE_STAGES[number];
export const STAGE_LABEL:Record<PipelineStage,string>={NEW:'Nouveau',CONTACTED:'Contacté',DEMO:'Démo',QUOTE:'Devis',SIGNED:'Signé',LOST:'Perdu'};
export const REQUEST_KIND_LABEL:Record<'PROSPECTS'|'WATCH',string>={PROSPECTS:'Prospects',WATCH:'Veille dédiée'};
export type PipelineItem={id:string;kind:'PROSPECTS'|'WATCH';activity:string;target:string;department:string;email:string;company:string;message:string;
 created_at:string;stage:PipelineStage;version:number;moved_at:string|null;moved_by:string|null};
export type PipelineBoard={items:PipelineItem[];total:number};
export function byStage(items:readonly PipelineItem[]):Record<PipelineStage,PipelineItem[]>{
 const out=Object.fromEntries(PIPELINE_STAGES.map(s=>[s,[] as PipelineItem[]])) as Record<PipelineStage,PipelineItem[]>;
 for(const i of items)(out[i.stage]??out.NEW).push(i);
 return out;
}
// The optimistic move shown at once; the answer of the server then sets the version (or the board is reloaded).
export const withStage=(items:readonly PipelineItem[],id:string,patch:Partial<Pick<PipelineItem,'stage'|'version'|'moved_at'>>)=>
 items.map(i=>i.id===id?{...i,...patch}:i);
