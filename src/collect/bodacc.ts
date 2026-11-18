// Collecte nationale (migration 045) — the BODACC of one day, for all of France, read through the public open-data API of
// the DILA (Opendatasoft, dataset "annonces-commerciales", Licence Ouverte / Etalab), one export per family:
//   creation      → CREATION (new company) or ETABLISSEMENT (new secondary establishment — rare: the BODACC publishes about
//                   two a month for companies across France, 18 Oct.–17 Nov. 2026; most openings are never announced there)
//   modification  → TRANSFERT_SIEGE (only the announcements that state a head-office move, in any of its three wordings)
//   vente         → VENTE_FONDS (the buyer of a business)
// Only legal persons are kept: an announcement about a natural person is dropped and only counted (no name is stored).
export type EventKind='CREATION'|'ETABLISSEMENT'|'TRANSFERT_SIEGE'|'VENTE_FONDS';
export type PublicEvent={source_id:string;kind:EventKind;siren:string;name:string|null;published_on:string;department:string|null;commune:string|null;
 postal_code:string|null;activity:string|null;source_url:string};
export const BODACC_EXPORT='https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/exports/json';
export const FAMILIES=['creation','modification','vente'] as const;
export type Family=typeof FAMILIES[number];
const SELECT='id,dateparution,familleavis,registre,commercant,ville,cp,numerodepartement,url_complete,listeetablissements,acte,modificationsgenerales,listepersonnes';
// A head-office move is written three ways by the registries: « transfert du siège social », « Nouveau siège. » (Lyon, among
// others) and « modification survenue sur l'adresse du siège ». Only the first was read until 19 nov. 2026: the Rhône showed 3
// moves in 90 days instead of 854 (BODACC, 20 Aug.–17 Nov. 2026).
export const HEAD_OFFICE_SEARCH='(search("transfert du siège") or search("nouveau siège") or search("adresse du siège"))';
export const HEAD_OFFICE_MOVE=/transfert (du|de) siege|nouveau siege|adresse du siege|siege social transfere/;
export function exportUrl(day:string,family:Family):string{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid day');
 const where=`familleavis="${family}" and dateparution=date'${day}'`+(family==='modification'?` and ${HEAD_OFFICE_SEARCH}`:'');
 return `${BODACC_EXPORT}?${new URLSearchParams({where,select:SELECT})}`;
}
type Raw=Record<string,unknown>;
const obj=(v:unknown):Raw=>{if(v&&typeof v==='object')return v as Raw;if(typeof v==='string'&&v.trim().startsWith('{'))try{return JSON.parse(v) as Raw}catch{return {}}return {}};
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
// The person the announcement is about: "pm" = legal person, "pp" = natural person. Unknown → not kept.
function person(r:Raw):Raw{const p=obj(r.listepersonnes).personne;return Array.isArray(p)?obj(p[0]):obj(p)}
export function parseBodacc(rows:Raw[],family:Family):{events:PublicEvent[];skippedPersons:number}{
 const events:PublicEvent[]=[];let skippedPersons=0;
 for(const r of rows){
  const p=person(r);
  if(str(p.typePersonne)!=='pm'){skippedPersons++;continue}
  // The register number, "900000001" or "900 000 001" (the export gives both forms, as a list or as its text).
  const parts=Array.isArray(r.registre)?r.registre.map(String):str(r.registre).replace(/[\[\]']/g,'').split(',');
  const siren=parts.map(x=>/^\s*(\d{3}) ?(\d{3}) ?(\d{3})\s*$/.exec(x)).find(Boolean)?.slice(1,4).join('');
  const id=str(r.id),url=str(r.url_complete),day=str(r.dateparution);
  if(!siren||!id||!/^https:\/\//.test(url)||!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
  const etab=obj(obj(r.listeetablissements).etablissement);
  let kind:EventKind;
  if(family==='creation')kind=/secondaire/.test(fold(str(etab.qualiteEtablissement)+' '+JSON.stringify(obj(r.acte))))?'ETABLISSEMENT':'CREATION';
  else if(family==='vente')kind='VENTE_FONDS';
  else{if(!HEAD_OFFICE_MOVE.test(fold(str(obj(r.modificationsgenerales).descriptif))))continue;kind='TRANSFERT_SIEGE'}
  const dep=str(r.numerodepartement).toUpperCase(),cp=str(r.cp);
  events.push({source_id:id,kind,siren,name:(str(p.denomination)||str(r.commercant)).slice(0,200)||null,published_on:day,
   department:/^(\d{2,3}|2[AB])$/.test(dep)?dep:null,commune:str(r.ville).slice(0,120)||null,postal_code:/^\d{5}$/.test(cp)?cp:null,
   activity:(str(etab.activite)||str(p.activite)).replace(/\s+/g,' ').slice(0,500)||null,source_url:url.slice(0,500)});
 }
 return {events,skippedPersons};
}
