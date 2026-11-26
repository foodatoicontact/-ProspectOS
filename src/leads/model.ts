// Base entreprises de la veille — pure helpers shared by the API (src/leads/api.ts) and the administrator's panel.
export const LEAD_KINDS=['VENTE_FONDS','TRANSFERT_SIEGE','ETABLISSEMENT','CREATION'] as const;
// FUSION, APPORT, VENTE_JUDICIAIRE and INDETERMINE (migration 055) are never a lead: labelled only for the company sheet.
export const KIND_LABEL:Record<string,string>={VENTE_FONDS:'Reprise de fonds',TRANSFERT_SIEGE:'Transfert de siège',ETABLISSEMENT:'Nouvel établissement',CREATION:'Création',
 FUSION:'Fusion ou restructuration',APPORT:'Apport',VENTE_JUDICIAIRE:'Vente judiciaire',INDETERMINE:'À relire'};
// The trade's key: the label, lower case, without accents — « Sécurité incendie » → « securite-incendie ».
export const tradeKey=(label:string)=>label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
export type Lead={siren:string;name:string|null;naf:string|null;employee_band:string|null;department:string|null;commune:string|null;kind:string;event_on:string;
 source_url:string;activity:string|null;events:number;reserved:boolean;other_trades:number;lists:number};
export type LeadProfile={contract_id:string;trade_key:string;trade_label:string;departments:string[];kinds:string[];naf_prefixes:string[];updated_at:string};
export type LeadPool={profile:LeadProfile;leads:Lead[];waiting_enrichment:number};
// A reserved lead as one line of the simple delivery form (SIREN;Entreprise;Ville;Source;Lien https).
export const KIND_SOURCE:Record<string,string>={VENTE_FONDS:'BODACC — vente de fonds',TRANSFERT_SIEGE:'BODACC — transfert de siège',ETABLISSEMENT:'BODACC — nouvel établissement',CREATION:'BODACC — création'};
const clean=(s:string|null|undefined)=>(s??'').replace(/[;\r\n]+/g,' ').replace(/\s+/g,' ').trim();
export function deliveryLines(leads:Pick<Lead,'siren'|'name'|'commune'|'kind'|'source_url'|'reserved'>[]):string{
 return leads.filter(l=>l.reserved&&l.name&&/^https:\/\//.test(l.source_url))
  .map(l=>[l.siren,clean(l.name),clean(l.commune),KIND_SOURCE[l.kind]??'BODACC',l.source_url].join(';')).join('\n');
}

// ---- The delivery made from the reserved leads (owner request, 18 nov. 2026: the weekly list prepared from the base
// instead of by hand). Every card says only what the official announcement says (fact), why that moment matters for any
// supplier (a general statement about that kind of event, never a claim about the company) and an opening line built on
// the same fact. Same document as the PDF lists (header, sections by signal, numbered cards) — the client sees it in the
// veille space; nothing is sent by e-mail without the administrator's click.
export type DeliveryCard={siren:string;name:string;city:string;department:string;event_date:string;event_label:string;badge:string;chips:string[];
 fact:string;why_now:string;hook:string;source_url:string;source_label:string;section_key:string};
export type DeliverySectionDoc={key:string;title:string;subtitle:string;source:string;color:string;badge:string};
export type LeadDelivery={scope:string;header:{prepared_for:string;eyebrow:string;lead:string;title_count:number};sections:DeliverySectionDoc[];items:DeliveryCard[]};
const SECTION:Record<string,DeliverySectionDoc&{fact:(activity:string)=>string;why:string;action:string}>={
 VENTE_FONDS:{key:'reprises',title:'Entreprises qui viennent de reprendre un fonds',subtitle:'achat de fonds de commerce publié au BODACC',source:'BODACC — annonces commerciales',color:'#f0a33a',badge:'BODACC',
  fact:a=>`Achat d’un fonds de commerce publié au BODACC${a?` : ${a}`:''}.`,why:'Un nouveau propriétaire revoit souvent ses contrats et ses prestataires dans les premiers mois.',action:'a repris un fonds'},
 TRANSFERT_SIEGE:{key:'demenagements',title:'Entreprises qui déménagent',subtitle:'transfert de siège publié au BODACC',source:'BODACC — annonces commerciales',color:'#5b8def',badge:'BODACC',
  fact:()=>'Transfert du siège social publié au BODACC.',why:'De nouveaux locaux à équiper, à mettre en conformité et à faire entretenir.',action:'a transféré son siège'},
 ETABLISSEMENT:{key:'etablissements',title:'Nouveaux établissements',subtitle:'ouverture d’établissement publiée au BODACC',source:'BODACC — annonces commerciales',color:'#3fb27f',badge:'BODACC',
  fact:a=>`Ouverture d’un établissement publiée au BODACC${a?` : ${a}`:''}.`,why:'Un nouveau site à équiper et à faire fonctionner dès son ouverture.',action:'a ouvert un établissement'},
 CREATION:{key:'creations',title:'Sociétés nouvellement créées',subtitle:'création publiée au BODACC',source:'BODACC — annonces commerciales',color:'#a371f7',badge:'BODACC',
  fact:a=>`Création de la société publiée au BODACC${a?` : ${a}`:''}.`,why:'Une jeune société choisit ses premiers prestataires.',action:'a été créée'},
};
const BANDS:Record<string,string>={'00':'0 salarié','01':'1 à 2 salariés','02':'3 à 5 salariés','03':'6 à 9 salariés','11':'10 à 19 salariés','12':'20 à 49 salariés','21':'50 à 99 salariés',
 '22':'100 à 199 salariés','31':'200 à 249 salariés','32':'250 à 499 salariés','41':'500 à 999 salariés','42':'1 000 à 1 999 salariés','51':'2 000 à 4 999 salariés','52':'5 000 à 9 999 salariés','53':'10 000 salariés et plus'};
const longDate=(iso:string)=>new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const oneLine=(s:string|null|undefined,max:number)=>(s??'').replace(/\s+/g,' ').trim().slice(0,max);
// The reserved leads of a client, as the delivery its veille space shows. Leads without a name, an https source or a
// known kind are left out (and counted), never filled in.
export function buildLeadDelivery(input:{clientName:string;profile:Pick<LeadProfile,'trade_label'|'departments'>;leads:Lead[];today:string}):LeadDelivery&{skipped:number}{
 const usable=input.leads.filter(l=>l.reserved&&l.name&&/^https:\/\//.test(l.source_url)&&SECTION[l.kind]);
 const order=Object.keys(SECTION);
 const sorted=[...usable].sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)||b.event_on.localeCompare(a.event_on)||a.siren.localeCompare(b.siren));
 const items=sorted.map((l):DeliveryCard=>{const s=SECTION[l.kind]!;const activity=oneLine(l.activity,300);const city=oneLine(l.commune,120);
  return {siren:l.siren,name:oneLine(l.name,200),city,department:l.department??'',event_date:l.event_on.slice(0,10),event_label:longDate(l.event_on).slice(0,40),badge:s.badge,
   chips:[l.naf?`NAF ${l.naf}`:null,l.employee_band&&BANDS[l.employee_band]?BANDS[l.employee_band]!:null].filter((x):x is string=>!!x),
   fact:s.fact(activity).slice(0,1000),why_now:s.why,hook:`J’ai vu dans le BODACC du ${longDate(l.event_on)} que ${oneLine(l.name,200)} ${s.action}${city?` à ${city}`:''}.`.slice(0,1000),
   source_url:l.source_url,source_label:s.source,section_key:s.key}});
 const sections=order.filter(k=>sorted.some(l=>l.kind===k)).map(k=>{const {fact:_f,why:_w,action:_a,...doc}=SECTION[k]!;return doc});
 const date=longDate(input.today);
 return {scope:`${input.profile.trade_label} — ${items.length} entreprise${items.length>1?'s':''}, ${date}`.slice(0,500),
  header:{prepared_for:oneLine(input.clientName,160),eyebrow:`${input.profile.trade_label} · départements ${input.profile.departments.join(', ')} · ${date}`.slice(0,300),
   lead:'Entreprises repérées dans les annonces officielles du BODACC et vérifiées au registre des entreprises : actives, sans opposition à la prospection, jamais une entreprise individuelle.',
   title_count:items.length},sections,items,skipped:input.leads.filter(l=>l.reserved).length-items.length};
}
