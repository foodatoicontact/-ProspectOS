// The company record, once per SIREN (API Recherche d'entreprises, DINUM — public, no key): activity (NAF), legal form,
// employee band, active or closed, sole trader or not, objection to commercial prospecting. Nothing about any person.
export type CompanyRow={siren:string;name:string|null;naf:string|null;legal_form:string|null;employee_band:string|null;active:boolean;individual:boolean;
 opposition:boolean;department:string|null;commune:string|null};
export const RECHERCHE='https://recherche-entreprises.api.gouv.fr/search';
type Raw=Record<string,any>;
export function parseCompany(siren:string,body:Raw):CompanyRow|null{
 const r=(Array.isArray(body?.results)?body.results:[]).find((x:Raw)=>x?.siren===siren);
 if(!r)return null;
 const legal=typeof r.nature_juridique==='string'&&/^\d{4}$/.test(r.nature_juridique)?r.nature_juridique:null;
 // Sole traders: legal form 1xxx, or flagged by the register.
 const individual=r.complements?.est_entrepreneur_individuel===true||(legal?.startsWith('1')??false);
 const naf=typeof r.activite_principale==='string'&&/^\d{2}\.\d{2}[A-Z]$/.test(r.activite_principale)?r.activite_principale:null;
 const band=typeof r.tranche_effectif_salarie==='string'&&/^(NN|\d{2})$/.test(r.tranche_effectif_salarie)?r.tranche_effectif_salarie:null;
 const dep=typeof r.siege?.departement==='string'&&/^(\d{2,3}|2[AB])$/.test(r.siege.departement)?r.siege.departement:null;
 return {siren,name:individual?null:(String(r.nom_raison_sociale||r.nom_complet||'').slice(0,200)||null),naf,legal_form:legal,employee_band:band,
  active:r.etat_administratif==='A',individual,opposition:r.opposition_diffusion_commerciale===true||r.statut_diffusion==='P',
  department:dep,commune:typeof r.siege?.libelle_commune==='string'?r.siege.libelle_commune.slice(0,120):null};
}
