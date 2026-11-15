// Veille dédiée, suivi au résultat (migration 043, docs/DEDICATED_TRACKING.md) — pure logic shared by the API, the cron
// job and the screens: statuses and their labels, the 15-day window, the monthly amount, the administrator's counters and
// alerts, the CSV export and the parsing of a delivery pasted by the administrator. The database holds every rule that
// matters (who, when, how much); this module only mirrors them for display and never decides alone.
export const DEDICATED_STATUSES=['A_CONTACTER','CONTACTE','DEVIS_ENVOYE','SIGNE','PERDU','DEJA_CLIENT'] as const;
export type DedicatedStatus=typeof DEDICATED_STATUSES[number];
export const STATUS_LABEL:Record<DedicatedStatus,string>={A_CONTACTER:'À contacter',CONTACTE:'Contacté',DEVIS_ENVOYE:'Devis envoyé',SIGNE:'Signé',PERDU:'Perdu',DEJA_CLIENT:'Déjà client'};
export const PROOF_KINDS=['devis','facture','commande','contrat','echange'] as const;
export const PROOF_LABEL:Record<typeof PROOF_KINDS[number],string>={devis:'Devis',facture:'Facture',commande:'Bon de commande',contrat:'Contrat',echange:'Échange écrit (e-mail, courrier)'};
// The exact sentence the database requires to validate a statement (validate_dedicated_statement).
export const ATTESTATION='J\'atteste l\'exactitude de ce relevé';
export const isDedicatedStatus=(v:unknown):v is DedicatedStatus=>typeof v==='string'&&(DEDICATED_STATUSES as readonly string[]).includes(v);

// Monthly amount (HT, cents): the higher of the guaranteed minimum and the commission × signatures.
export function statementAmount(signed:number,minimumCents:number,commissionCents:number):number{
 if(!Number.isInteger(signed)||signed<0)throw Error('signed must be a non-negative integer');
 return Math.max(minimumCents,commissionCents*signed);
}
export const eur=(cents:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(cents/100);

// Paris calendar date (YYYY-MM-DD) of an instant.
export function parisDate(at:Date):string{
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const g=(t:string)=>p.find(x=>x.type===t)!.value;return `${g('year')}-${g('month')}-${g('day')}`;
}
const dayNumber=(iso:string)=>Math.round(Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10))/86400000);
export const daysBetween=(fromIso:string,toIso:string)=>dayNumber(toIso)-dayNumber(fromIso);
export function addDays(iso:string,days:number):string{return new Date((dayNumber(iso)+days)*86400000).toISOString().slice(0,10)}
// « Déjà client » stays open up to and including delivered_on + window (the database's rule).
export const knownClientOpen=(deliveredOn:string,todayIso:string,windowDays:number)=>daysBetween(deliveredOn,todayIso)<=windowDays;
export const knownClientDeadline=(deliveredOn:string,windowDays:number)=>addDays(deliveredOn,windowDays);
// The statement of month M (YYYY-MM-01) is to be validated before the 5th of M+1: validation is late from the 5th on.
export function statementDeadline(month:string):string{
 const y=+month.slice(0,4),m=+month.slice(5,7);const n=m===12?[y+1,1]:[y,m+1];
 return `${n[0]}-${String(n[1]).padStart(2,'0')}-04`;
}
// First day of the month before the Paris date of `at` — the month a statement is generated for on the 1st.
export function previousMonth(at:Date):string{
 const t=parisDate(at);const y=+t.slice(0,4),m=+t.slice(5,7);const p=m===1?[y-1,12]:[y,m-1];
 return `${p[0]}-${String(p[1]).padStart(2,'0')}-01`;
}
export function monthLabel(month:string):string{
 return new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month.slice(0,7)}-01T12:00:00Z`));
}
export function dateFr(iso:string|null|undefined):string{
 if(!iso)return '—';return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${iso.slice(0,10)}T12:00:00Z`));
}

// ---------------------------------------------------------------- administrator: counters and alerts
export type AdminItem={id:string;reference:string;name:string;status:DedicatedStatus;delivered_on:string;status_changed_at:string|null;signed_at:string|null;
 opened:boolean;first_export_at:string|null;reached:Partial<Record<DedicatedStatus,string>>};
export type AdminStatement={id:string;month:string;signed_count:number;amount_ht_cents:number;validated_at:string|null;reminder_sent_at:string|null};
export type AdminContract={contract:{id:string;label:string;organization:string;minimum_ht_cents:number;commission_ht_cents:number;known_client_days:number;first_statement_month:string};
 deliveries:number;items:AdminItem[];statements:AdminStatement[]};
export type Counters={delivered:number;opened:number;exported:number;contacted:number;quoted:number;signed:number;lost:number;known:number};
const AFTER_CONTACT:DedicatedStatus[]=['CONTACTE','DEVIS_ENVOYE','SIGNE','PERDU'];
export function counters(items:AdminItem[]):Counters{
 const ever=(i:AdminItem,s:DedicatedStatus[])=>s.some(x=>i.status===x||i.reached[x]);
 return {delivered:items.length,opened:items.filter(i=>i.opened).length,exported:items.filter(i=>i.first_export_at).length,
  contacted:items.filter(i=>ever(i,AFTER_CONTACT)).length,quoted:items.filter(i=>ever(i,['DEVIS_ENVOYE','SIGNE'])).length,
  signed:items.filter(i=>i.status==='SIGNE').length,lost:items.filter(i=>i.status==='PERDU').length,known:items.filter(i=>i.status==='DEJA_CLIENT').length};
}
export type Alert={kind:'QUOTE_STALE'|'EXPORT_IDLE'|'LOW_CONVERSION'|'STATEMENT_UNVALIDATED';text:string;items?:string[]};
const DAY=86400000;
const TERMINAL:DedicatedStatus[]=['SIGNE','PERDU','DEJA_CLIENT'];
export function alerts(c:AdminContract,now:Date):Alert[]{
 const out:Alert[]=[];const t=now.getTime();
 // A quote sent more than 60 days ago, with no change since.
 const stale=c.items.filter(i=>i.status==='DEVIS_ENVOYE'&&i.status_changed_at&&t-Date.parse(i.status_changed_at)>60*DAY);
 if(stale.length)out.push({kind:'QUOTE_STALE',text:`${stale.length} devis envoyé${stale.length>1?'s':''} depuis plus de 60 jours sans suite`,items:stale.map(i=>i.reference)});
 // Exported, still open, and no status change for 30 days since the export (or since the last change).
 const idle=c.items.filter(i=>{
  if(!i.first_export_at||TERMINAL.includes(i.status))return false;
  const last=Math.max(Date.parse(i.first_export_at),i.status_changed_at?Date.parse(i.status_changed_at):0);
  return t-last>30*DAY;
 });
 if(idle.length)out.push({kind:'EXPORT_IDLE',text:`${idle.length} fiche${idle.length>1?'s':''} exportée${idle.length>1?'s':''} sans changement de statut depuis 30 jours`,items:idle.map(i=>i.reference)});
 // Signatures / quotes over the last 3 months (by the date each status was reached).
 const since=t-91*DAY;const inWindow=(at?:string)=>!!at&&Date.parse(at)>=since;
 const quoted=c.items.filter(i=>inWindow(i.reached.DEVIS_ENVOYE)).length;
 const signed=c.items.filter(i=>inWindow(i.reached.SIGNE)).length;
 if(quoted>0&&signed/quoted<0.1)out.push({kind:'LOW_CONVERSION',text:`Ratio signatures/devis de ${Math.round(signed/quoted*100)} % sur 3 mois (${signed} / ${quoted})`});
 const today=parisDate(now);
 for(const s of c.statements)if(!s.validated_at&&today>statementDeadline(s.month))
  out.push({kind:'STATEMENT_UNVALIDATED',text:`Relevé de ${monthLabel(s.month)} non validé (${eur(s.amount_ht_cents)} HT)`});
 return out;
}

// ---------------------------------------------------------------- exports
export type ExportRow={id:string;delivery_number:number;reference:string;siren:string;name:string;city:string|null;source_label:string;source_url:string;delivered_on:string;status:DedicatedStatus;
 department?:string|null;event_label?:string|null;badge?:string|null;chips?:string[]|null;fact?:string|null;why_now?:string|null;hook?:string|null};
// « Fiche 7 » = the 7th card of the delivered document (reference L<n>-F007).
export const ficheNumber=(reference:string)=>Number(/-F(\d+)$/.exec(reference)?.[1]??0);
const cell=(v:string)=>{const s=/^[=+\-@\t\r]/.test(v)?`'${v}`:v;return /[";\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
// The columns follow the card of the delivered document (name, department · city, details, source and date, the fact,
// why now, the hook, the link), then what the follow-up adds: SIREN, delivery date, status.
export function exportCsv(rows:ExportRow[]):string{
 const head=['N° livraison','N° fiche','Identifiant fiche','Entreprise','Département','Ville','Précisions','Source','Date','Le fait','Pourquoi maintenant','Votre accroche','Lien de la source','SIREN','Date de livraison','Statut'];
 return '\ufeff'+[head,...rows.map(r=>[String(r.delivery_number),String(ficheNumber(r.reference)),r.reference,r.name,r.department??'',r.city??'',(r.chips??[]).join(' · '),r.badge??r.source_label,
  r.event_label??'',r.fact??'',r.why_now??'',r.hook??'',r.source_url,r.siren,r.delivered_on,STATUS_LABEL[r.status]])]
  .map(l=>l.map(cell).join(';')).join('\r\n')+'\r\n';
}

// ---------------------------------------------------------------- administrator: a delivery pasted as CSV
// One company per line: SIREN;Entreprise;Ville;Source;Lien (separator ; or tab; a header line is skipped).
export type DeliveryLine={siren:string;name:string;city:string|null;source_label:string;source_url:string};
export function parseDelivery(text:string):{items:DeliveryLine[];errors:string[]}{
 const items:DeliveryLine[]=[];const errors:string[]=[];
 text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach((line,n)=>{
  const f=line.split(/;|\t/).map(x=>x.trim());
  const siren=(f[0]??'').replace(/\s/g,'');
  if(n===0&&!/^\d{9}$/.test(siren)&&/siren/i.test(line))return;
  if(!/^\d{9}$/.test(siren)){errors.push(`Ligne ${n+1} : SIREN invalide`);return}
  if(!f[1]){errors.push(`Ligne ${n+1} : nom manquant`);return}
  if(!f[3]){errors.push(`Ligne ${n+1} : source manquante`);return}
  let url:URL|null=null;try{url=new URL(f[4]??'')}catch{}
  if(!url||url.protocol!=='https:'){errors.push(`Ligne ${n+1} : lien de source https requis`);return}
  items.push({siren,name:f[1].slice(0,200),city:f[2]?f[2].slice(0,120):null,source_label:f[3].slice(0,160),source_url:url.toString()});
 });
 if(items.length>1000)errors.push('1000 fiches au plus par livraison');
 return {items,errors};
}
