// Collecte nationale (migration 045) — the BODACC of one day, for all of France, read through the public open-data API of
// the DILA (Opendatasoft, dataset "annonces-commerciales", Licence Ouverte / Etalab), one export per family:
//   creation      → CREATION (new company) or ETABLISSEMENT (new secondary establishment — rare: the BODACC publishes about
//                   two a month for companies across France, 18 Oct.–17 Nov. 2026; most openings are never announced there)
//   modification  → TRANSFERT_SIEGE (only the announcements that state a head-office move, in any of its three wordings)
//   vente         → by the shared sort (src/domain/bodacc-purchase.ts, owner decisions of 25 nov. 2026): VENTE_FONDS (a
//                   purchase: the buyer of a business), FUSION, APPORT, VENTE_JUDICIAIRE or INDETERMINE (migration 055) — each
//                   with the id of the rule that decided; only VENTE_FONDS is ever proposed to a client
// Only legal persons are kept: an announcement about a natural person is dropped and only counted (no name is stored).
// Cancellations and corrections (migration 055): a notice of cancellation (typeavis « annulation ») is never stored; it
// marks the notice it cancels ANNULEE. A correction (« rectificatif ») marks the notice it corrects RECTIFIEE and is itself
// stored as the event to use. The notice targeted is read from « parutionavisprecedent » (publication, issue, number).
import {classifySale,type SaleRule,type SaleKind} from '../domain/bodacc-purchase.ts';
import {countRules} from './sale-quality.ts';
import {previousNoticeId} from '../domain/bodacc-notice.ts';
export type EventKind='CREATION'|'ETABLISSEMENT'|'TRANSFERT_SIEGE'|'VENTE_FONDS'|'FUSION'|'APPORT'|'VENTE_JUDICIAIRE'|'INDETERMINE';
export const SALE_KIND_EVENT:Record<SaleKind,EventKind>={PURCHASE:'VENTE_FONDS',MERGER:'FUSION',CONTRIBUTION:'APPORT',FORCED_SALE:'VENTE_JUDICIAIRE',UNDETERMINED:'INDETERMINE'};
export type PublicEvent={source_id:string;kind:EventKind;siren:string;name:string|null;published_on:string;department:string|null;commune:string|null;
 postal_code:string|null;activity:string|null;source_url:string;sale_rule?:SaleRule};
export type Supersession={target_source_id:string;status:'ANNULEE'|'RECTIFIEE';by_source_id:string;by_url:string};
export const BODACC_EXPORT='https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/exports/json';
export const FAMILIES=['creation','modification','vente'] as const;
export type Family=typeof FAMILIES[number];
const SELECT='id,dateparution,typeavis,parutionavisprecedent,familleavis,registre,commercant,ville,cp,numerodepartement,url_complete,listeetablissements,acte,modificationsgenerales,listepersonnes';
// A head-office move is written three ways by the registries: « transfert du siège social », « Nouveau siège. » (Lyon, among
// others) and « modification survenue sur l'adresse du siège ». Only the first was read until 19 nov. 2026: the Rhône showed 3
// moves in 90 days instead of 854 (BODACC, 20 Aug.–17 Nov. 2026).
export const HEAD_OFFICE_SEARCH='(search("transfert du siège") or search("nouveau siège") or search("adresse du siège"))';
export const HEAD_OFFICE_MOVE=/transfert (du|de) siege|nouveau siege|adresse du siege|siege social transfere/;
export function exportUrl(day:string,family:Family):string{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid day');
 // The modifications are filtered on the head-office move at the source — and, since 26 nov. 2026 (owner decision), the
 // cancellations and corrections of that family are read too: a cancellation of a move need not repeat its words.
 const where=`familleavis="${family}" and dateparution=date'${day}'`+(family==='modification'?` and (${HEAD_OFFICE_SEARCH} or typeavis="annulation" or typeavis="rectificatif")`:'');
 return `${BODACC_EXPORT}?${new URLSearchParams({where,select:SELECT})}`;
}
type Raw=Record<string,unknown>;
const obj=(v:unknown):Raw=>{if(v&&typeof v==='object')return v as Raw;if(typeof v==='string'&&v.trim().startsWith('{'))try{return JSON.parse(v) as Raw}catch{return {}}return {}};
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
// The person the announcement is about: "pm" = legal person, "pp" = natural person. Unknown → not kept.
function person(r:Raw):Raw{const p=obj(r.listepersonnes).personne;return Array.isArray(p)?obj(p[0]):obj(p)}
export {previousNoticeId} from '../domain/bodacc-notice.ts';
// saleRules: for the « vente » family, how many notices of legal persons each rule of the shared sort decided (migration 054,
// the weekly check) — rule ids and counts only. notPurchase: the sale notices stored under another kind than VENTE_FONDS.
export function parseBodacc(rows:Raw[],family:Family):{events:PublicEvent[];supersessions:Supersession[];skippedPersons:number;skippedNotPurchase:number;saleRules:Record<string,number>}{
 const events:PublicEvent[]=[];const supersessions:Supersession[]=[];let skippedPersons=0,skippedNotPurchase=0;const rules:SaleRule[]=[];
 for(const r of rows){
  const type=fold(str(r.typeavis));
  if(type==='annulation'||type==='rectificatif'){
   const target=previousNoticeId(r.parutionavisprecedent),id=str(r.id),url=str(r.url_complete);
   if(target&&id&&/^https:\/\//.test(url))supersessions.push({target_source_id:target,status:type==='annulation'?'ANNULEE':'RECTIFIEE',by_source_id:id,by_url:url.slice(0,500)});
   if(type==='annulation')continue;
  }
  const p=person(r);
  if(str(p.typePersonne)!=='pm'){skippedPersons++;continue}
  // The register number, "900000001" or "900 000 001" (the export gives both forms, as a list or as its text).
  const parts=Array.isArray(r.registre)?r.registre.map(String):str(r.registre).replace(/[\[\]']/g,'').split(',');
  const siren=parts.map(x=>/^\s*(\d{3}) ?(\d{3}) ?(\d{3})\s*$/.exec(x)).find(Boolean)?.slice(1,4).join('');
  const id=str(r.id),url=str(r.url_complete),day=str(r.dateparution);
  if(!siren||!id||!/^https:\/\//.test(url)||!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
  const etab=obj(obj(r.listeetablissements).etablissement);
  let kind:EventKind;let saleRule:SaleRule|undefined;
  if(family==='creation')kind=/secondaire/.test(fold(str(etab.qualiteEtablissement)+' '+JSON.stringify(obj(r.acte))))?'ETABLISSEMENT':'CREATION';
  else if(family==='vente'){const v=classifySale(r.acte,r.listeetablissements);rules.push(v.rule);saleRule=v.rule;kind=SALE_KIND_EVENT[v.kind];if(v.kind!=='PURCHASE')skippedNotPurchase++}
  else{if(!HEAD_OFFICE_MOVE.test(fold(str(obj(r.modificationsgenerales).descriptif))))continue;kind='TRANSFERT_SIEGE'}
  const dep=str(r.numerodepartement).toUpperCase(),cp=str(r.cp);
  events.push({source_id:id,kind,siren,name:(str(p.denomination)||str(r.commercant)).slice(0,200)||null,published_on:day,
   department:/^(\d{2,3}|2[AB])$/.test(dep)?dep:null,commune:str(r.ville).slice(0,120)||null,postal_code:/^\d{5}$/.test(cp)?cp:null,
   activity:(str(etab.activite)||str(p.activite)).replace(/\s+/g,' ').slice(0,500)||null,source_url:url.slice(0,500),...(saleRule?{sale_rule:saleRule}:{})});
 }
 return {events,supersessions,skippedPersons,skippedNotPurchase,saleRules:countRules(rules)};
}
