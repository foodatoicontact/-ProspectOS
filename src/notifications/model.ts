// Notification centre (migration 044) — pure mapping from journal events to what the bell shows. Today one source: the
// veille dédiée journal (migration 043). For the client: a proposal sent, a delivery, a statement to validate, a
// termination. For the administrator (INTERNAL): an acceptance, a validation, a statement still not validated on the 5th.
import {eur,monthLabel,dateFr} from '../dedicated/model.ts';
export type JournalEvent={id:number;kind:string;detail:Record<string,unknown>;created_at:string;contract_id:string;statement_id:string|null};
export type Notification={id:string;title:string;body:string;at:string;unread:boolean;pending:boolean;target:'dedicated'|'dedicated-admin'};
export const CLIENT_KINDS=['PROPOSAL_SENT','DELIVERY_CREATED','STATEMENT_GENERATED','CONTRACT_TERMINATED'] as const;
export const ADMIN_KINDS=['PROPOSAL_ACCEPTED','STATEMENT_VALIDATED','STATEMENT_REMINDER'] as const;
const n=(v:unknown)=>typeof v==='number'?v:Number(v)||0;
const s=(v:unknown)=>typeof v==='string'?v:'';
// One notification per event; « pending » marks what still waits for an action (a proposal not accepted yet, a statement
// not validated yet), so the bell can say « à faire ». Unknown kinds are left out.
export function toNotification(e:JournalEvent,o:{audience:'client'|'admin';label:string;seenAt:string|null;proposalPending:boolean;statementPending:boolean}):Notification|null{
 const unread=!o.seenAt||e.created_at>o.seenAt;const base={id:String(e.id),at:e.created_at,unread};
 const label=o.label?`« ${o.label} »`:'votre veille';
 if(o.audience==='client'){
  switch(e.kind){
   case 'PROPOSAL_SENT':return {...base,title:'Nouvelle proposition de veille',body:`${label} : lisez-la et acceptez-la pour ouvrir votre espace de suivi.`,pending:o.proposalPending,target:'dedicated'};
   case 'DELIVERY_CREATED':{const k=n(e.detail.items);return {...base,title:`Livraison n° ${n(e.detail.number)} disponible`,body:`${k} entreprise${k>1?'s':''} à appeler · ${label}.`,pending:false,target:'dedicated'}}
   case 'STATEMENT_GENERATED':return {...base,title:`Relevé de ${monthLabel(s(e.detail.month))} à valider`,body:`${eur(n(e.detail.amount_ht_cents))} HT · à valider avant le 5.`,pending:o.statementPending,target:'dedicated'};
   case 'CONTRACT_TERMINATED':return {...base,title:'Veille résiliée',body:`Plus de nouvelle livraison. Consultation et mise à jour des statuts jusqu’au ${dateFr(s(e.detail.access_until))}.`,pending:false,target:'dedicated'};
  }
  return null;
 }
 switch(e.kind){
  case 'PROPOSAL_ACCEPTED':return {...base,title:'Proposition acceptée',body:`${label} · version ${n(e.detail.version)} · essai à partir du ${dateFr(s(e.detail.trial_starts_on))}.`,pending:false,target:'dedicated-admin'};
  case 'STATEMENT_VALIDATED':return {...base,title:`Relevé de ${monthLabel(s(e.detail.month))} validé`,body:`${label} · ${n(e.detail.signed_count)} signature${n(e.detail.signed_count)>1?'s':''} · ${eur(n(e.detail.amount_ht_cents))} HT${e.detail.late?' (en retard)':''}.`,pending:false,target:'dedicated-admin'};
  case 'STATEMENT_REMINDER':return {...base,title:`Relevé de ${monthLabel(s(e.detail.month))} non validé`,body:`${label} : le client n’a pas validé au 5.`,pending:false,target:'dedicated-admin'};
 }
 return null;
}
