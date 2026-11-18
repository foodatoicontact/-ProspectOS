// Base entreprises de la veille — pure helpers shared by the API (src/leads/api.ts) and the administrator's panel.
export const LEAD_KINDS=['VENTE_FONDS','TRANSFERT_SIEGE','ETABLISSEMENT','CREATION'] as const;
export const KIND_LABEL:Record<string,string>={VENTE_FONDS:'Reprise de fonds',TRANSFERT_SIEGE:'Transfert de siège',ETABLISSEMENT:'Nouvel établissement',CREATION:'Création'};
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
