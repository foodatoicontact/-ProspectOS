// Which register companies become Discovery candidates — structured rules only, read from the register's own
// fields. Never a name, a brand or a domain: renaming every company changes no verdict.
//  A) the company is active and its head office is in the zone; or
//  Only PUBLICLY DIFFUSIBLE data is ever used: a company or a site whose register diffusion status is not 'O'
//  (partial diffusion, opposition) is never a candidate and never shown.
//  B) it has in the zone an active PRODUCTION site: NAF rév. 2 section C (divisions 10–33), never retail (47),
//     restaurants (56), wholesale (46) or engineering (71), with an INSEE headcount band of 20 employees or more.
import {inZone,type RegistryZone} from './zone.ts';
export type RegistrySite={siret?:string|null;statut_diffusion_etablissement?:string|null;activite_principale?:string|null;etat_administratif?:string|null;region?:string|null;commune?:string|null;libelle_commune?:string|null;tranche_effectif_salarie?:string|null;est_siege?:boolean|null};
export type RegistryCompany={siren:string;statut_diffusion?:string|null;nom_complet?:string|null;nom_raison_sociale?:string|null;etat_administratif?:string|null;activite_principale?:string|null;section_activite_principale?:string|null;tranche_effectif_salarie?:string|null;
 siege?:RegistrySite&{code_postal?:string|null;adresse?:string|null}|null;matching_etablissements?:RegistrySite[]|null};
export type AdmissionRule='SIEGE_IN_ZONE'|'PRODUCTION_SITE_IN_ZONE';
export type RejectionReason='NOT_PUBLICLY_DIFFUSIBLE'|'COMPANY_NOT_ACTIVE'|'NO_ACTIVE_SITE_IN_ZONE'|'NO_PRODUCTION_SITE_IN_ZONE'|'PRODUCTION_SITE_TOO_SMALL';
export type Admission={admitted:true;rule:AdmissionRule;sites:RegistrySite[]}|{admitted:false;reason:RejectionReason};

// INSEE headcount bands (tranche d'effectif salarié): code → [min, max] employees.
export const EMPLOYEE_BANDS:Record<string,[number,number]>={'00':[0,0],'01':[1,2],'02':[3,5],'03':[6,9],'11':[10,19],'12':[20,49],'21':[50,99],'22':[100,199],'31':[200,249],'32':[250,499],
 '41':[500,999],'42':[1000,1999],'51':[2000,4999],'52':[5000,9999],'53':[10000,Infinity]};
const MIN_PRODUCTION_BAND=EMPLOYEE_BANDS['12']![0];
const NAF_REV2=/^(\d{2})\.\d{2}[A-Z]$/;
const EXCLUDED_DIVISIONS=new Set([46,47,56,71]);

// The bands lying entirely inside the user's range (never a band that would exceed it).
export function employeeTranchesFor(range:{min:number;max:number}):string[]{return Object.entries(EMPLOYEE_BANDS).filter(([,[lo,hi]])=>lo>=range.min&&hi<=range.max&&lo>0).map(([code])=>code)}

const active=(s:{etat_administratif?:string|null})=>s.etat_administratif==='A';
const publicSite=(s:RegistrySite)=>s.statut_diffusion_etablissement==='O';
export function isProductionActivity(naf:string|null|undefined):boolean{const d=NAF_REV2.exec(naf??'');if(!d)return false;const division=Number(d[1]);return division>=10&&division<=33&&!EXCLUDED_DIVISIONS.has(division)}
export function isProductionSite(site:RegistrySite):boolean{
 const band=EMPLOYEE_BANDS[site.tranche_effectif_salarie??''];
 return active(site)&&isProductionActivity(site.activite_principale)&&!!band&&band[0]>=MIN_PRODUCTION_BAND;
}

export function admitRegistryCompany(company:RegistryCompany,zone:RegistryZone):Admission{
 if(company.statut_diffusion!=='O')return {admitted:false,reason:'NOT_PUBLICLY_DIFFUSIBLE'};
 if(!active(company))return {admitted:false,reason:'COMPANY_NOT_ACTIVE'};
 const sites=(company.matching_etablissements??[]).filter(s=>publicSite(s)&&inZone(zone,s));
 const activeSites=sites.filter(active);
 if(company.siege&&active(company.siege)&&publicSite(company.siege)&&inZone(zone,company.siege))return {admitted:true,rule:'SIEGE_IN_ZONE',sites:activeSites};
 if(!activeSites.length)return {admitted:false,reason:'NO_ACTIVE_SITE_IN_ZONE'};
 const production=activeSites.filter(isProductionSite);
 if(production.length)return {admitted:true,rule:'PRODUCTION_SITE_IN_ZONE',sites:production};
 return {admitted:false,reason:activeSites.some(s=>isProductionActivity(s.activite_principale))?'PRODUCTION_SITE_TOO_SMALL':'NO_PRODUCTION_SITE_IN_ZONE'};
}
