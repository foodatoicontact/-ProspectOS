import type {AdmissibilityReason,PageType} from './admissibility.ts';
import type {SourceType} from './source-classification.ts';
// WHAT KIND of organization a result names — stored in raw_metadata.entity_type (no schema change), shown to the
// reviewer and read by review priority. Deterministic, from what the page itself says; never an evidence status.
// A cooperative of 270 professionals or a network of independent members is identified correctly and stays
// visible (a possible partner), but it is not the single company an ICP of "10 to 100 employees" targets.
export type EntityType='COMPANY'|'COOPERATIVE'|'FEDERATION'|'NETWORK'|'DIRECTORY'|'MARKETPLACE'|'PUBLIC_BODY';
export const ENTITY_TYPES:readonly EntityType[]=['COMPANY','COOPERATIVE','FEDERATION','NETWORK','DIRECTORY','MARKETPLACE','PUBLIC_BODY'];
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’`]/g,"'");
const PUBLIC_BODY_NAME=/^(ville|commune|mairie) (de|d')|conseil (departemental|regional|general)|(^|\s)metropole(\s|$)|communaute (de communes|d'agglomeration|urbaine)|^region\s|^departement\s|office public de l'habitat|^prefecture/;
const COOPERATIVE=/(^|[^a-z])(cooperative|cooperatives|scop|scic|cuma|groupement d'(artisans|entreprises|professionnels))([^a-z]|$)/;
const NETWORK=/(^|[^a-z])(reseau (de|d'|national|regional|d'entreprises|d'artisans)|franchise|franchises|franchiseur|collectif de \d+|\d+ (professionnels|artisans|entreprises|membres|adherents) (independants|adherents|associes|partenaires|membres))([^a-z]|$)/;
export function entityTypeOf(i:{pageType:PageType;reasonCode:AdmissibilityReason;sourceType:SourceType;name:string|null;title:string;description:string}):EntityType|null{
 if(i.sourceType==='marketplace')return 'MARKETPLACE';
 if(i.pageType==='DIRECTORY'||i.pageType==='GOVERNMENT_OR_PUBLIC_DIRECTORY'||i.pageType==='THIRD_PARTY_JOB_BOARD')return 'DIRECTORY';
 if(i.reasonCode==='SECTOR_BODY_PAGE')return 'FEDERATION';
 if(!i.name)return null;
 if(PUBLIC_BODY_NAME.test(fold(i.name)))return 'PUBLIC_BODY';
 const text=fold(`${i.name} ${i.title} ${i.description}`);
 if(COOPERATIVE.test(text))return 'COOPERATIVE';
 if(NETWORK.test(text))return 'NETWORK';
 return 'COMPANY';
}
