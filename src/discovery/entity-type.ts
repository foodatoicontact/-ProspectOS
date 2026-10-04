import {nonCommercialKind,PUBLIC_BODY_NAME,type AdmissibilityReason,type PageType} from './admissibility.ts';
import type {SourceType} from './source-classification.ts';
// WHAT KIND of organization a result names — stored in raw_metadata.entity_type (no schema change), shown to the
// reviewer and read by review priority. Deterministic, from what the page itself says; never an evidence status.
// A cooperative of 270 professionals or a network of independent members is identified correctly and stays
// visible (a possible partner), but it is not the single company an ICP of "10 to 100 employees" targets.
// The type describes the ENTITY a page names when one was resolved (a company named by a news article is a COMPANY,
// not the article); the PAGE kind (DIRECTORY, MARKETPLACE, CONTENT) only when no organization could be named.
// An event (trade show, forum…) is an EVENT, never a company to prospect.
export type EntityType='COMPANY'|'COOPERATIVE'|'FEDERATION'|'NETWORK'|'ASSOCIATION'|'PUBLIC_BODY'|'MEDIA'|'TRAINING'|'FOUNDATION'|'EVENT'|'DIRECTORY'|'MARKETPLACE'|'CONTENT';
export const ENTITY_TYPES:readonly EntityType[]=['COMPANY','COOPERATIVE','FEDERATION','NETWORK','ASSOCIATION','PUBLIC_BODY','MEDIA','TRAINING','FOUNDATION','EVENT','DIRECTORY','MARKETPLACE','CONTENT'];
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’`]/g,"'");
const COOPERATIVE=/(^|[^a-z])(cooperative|cooperatives|scop|scic|cuma|groupement d'(artisans|entreprises|professionnels))([^a-z]|$)/;
const NETWORK=/(^|[^a-z])(reseau (de|d'|national|regional|d'entreprises|d'artisans)|franchise|franchises|franchiseur|collectif de \d+|\d+ (professionnels|artisans|entreprises|membres|adherents) (independants|adherents|associes|partenaires|membres))([^a-z]|$)/;
export function entityTypeOf(i:{pageType:PageType;reasonCode:AdmissibilityReason;sourceType:SourceType;name:string|null;title:string;description:string;url?:string}):EntityType|null{
 if(i.reasonCode==='EVENT_PAGE')return 'EVENT';
 if(i.reasonCode==='SECTOR_BODY_PAGE')return 'FEDERATION';
 if(!i.name){
  if(i.sourceType==='marketplace')return 'MARKETPLACE';
  if(i.pageType==='DIRECTORY'||i.pageType==='GOVERNMENT_OR_PUBLIC_DIRECTORY'||i.pageType==='THIRD_PARTY_JOB_BOARD')return 'DIRECTORY';
  if(i.pageType==='NEWS_ARTICLE'||i.pageType==='BLOG_OR_CONTENT')return 'CONTENT';
  return null;
 }
 // Federation, association, public body, media: the same detection as the entity-type × intent guard (admissibility.ts).
 const kind=nonCommercialKind(i.name,i.title,i.url??'',i.description);
 if(kind)return kind;
 if(PUBLIC_BODY_NAME.test(fold(i.name)))return 'PUBLIC_BODY';
 const text=fold(`${i.name} ${i.title} ${i.description}`);
 if(COOPERATIVE.test(text))return 'COOPERATIVE';
 if(NETWORK.test(text))return 'NETWORK';
 return 'COMPANY';
}
