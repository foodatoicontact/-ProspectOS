// Discovery from the BODACC: companies that have just BOUGHT a business (reprise de fonds de commerce, d'établissement),
// family « Ventes et cessions » of the official announcements published by the DILA (open data, Licence Ouverte 2.0),
// read through its Opendatasoft API. A buyer has to review its contracts, suppliers and tools: the notice is a dated,
// public reason to be contacted — still a CANDIDATE that a person reviews, never evidence, never scored.
//
// What is kept, and only this:
//  - initial notices (typeavis "annonce") whose sale category is the purchase of a business (« Achat d'un fonds… »,
//    « Achat d'un établissement… ») — contributions, mergers, attributions and the second notice « mise en activité
//    suite à achat » are not purchases, or not new ones;
//  - the BUYER only, and only a legal entity (typePersonne "pm") whose RCS number is one of the notice's registered
//    numbers: a sole trader's notice names a person and is never kept. The seller is never read: the trader field
//    (commercant) and the act's free text can name a private person, they are not even requested (commercant) or read
//    (descriptif);
//  - the place, activity and trade name of the business bought, the publication date and the official notice URL.
// Fixed host, bounded size and time, redirects refused, the zone and the period are built here from validated codes.
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider,type ProviderSearchReport} from '../types.ts';
import {resolveRegistryZone,type RegistryZone} from '../registry/zone.ts';
import {PURCHASE_CATEGORY} from '../../domain/company-creations.ts';

export const BODACC_RECORDS='https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';
export const BODACC_SALES_PROVENANCE={source:'BODACC — annonces commerciales, Ventes et cessions (DILA)',licence:'Licence Ouverte 2.0 (Etalab)'};
export const BODACC_SALES_LABEL='Reprises de commerces — annonces BODACC';
// Purchases published over the last 90 days, newest first; at most 5 pages of 100 notices per search.
export const SALES_WINDOW_DAYS=90;
const PAGE_SIZE=100,MAX_PAGES=5;
export const SALES_REQUEST_TIMEOUT_MS=15000;
export const SALES_TIME_BUDGET_MS=30000;
const MAX_RESPONSE_BYTES=3_000_000;
const NOTICE_URL=/^https:\/\/www\.bodacc\.fr\/pages\/annonces-commerciales-detail\/\?q\.id=id:[A-Za-z0-9]{1,40}$/;
const DEPT=/^(?:\d{2}|2[AB]|97\d)$/;
const REGION=/^\d{2}$/;

class SalesRequestError extends Error{}
async function readBounded(res:Response):Promise<unknown>{
 const reader=res.body?.getReader();if(!reader)throw new SalesRequestError('INVALID_RESPONSE');
 let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RESPONSE_BYTES)throw new SalesRequestError('RESPONSE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new SalesRequestError('INVALID_RESPONSE')}
}

const day=(d:Date)=>d.toISOString().slice(0,10);
// The zone as the BODACC codes it: the department number, or the INSEE region code (an integer field there).
export function salesZoneClause(zone:RegistryZone):string{
 if(zone.kind==='department'){if(!DEPT.test(zone.code))throw new SalesRequestError('ZONE_INVALID');return `numerodepartement="${zone.code}"`}
 if(!REGION.test(zone.code))throw new SalesRequestError('ZONE_INVALID');
 return `region_code=${Number(zone.code)}`;
}
export function salesUrl(zone:RegistryZone,now:Date,page:number):URL{
 const u=new URL(BODACC_RECORDS);
 const from=new Date(now.getTime()-SALES_WINDOW_DAYS*86_400_000);
 // Only the fields needed: no trader name (commercant), whose seller part can be a private person.
 u.searchParams.set('select','id,dateparution,url_complete,registre,acte,listeetablissements,listepersonnes');
 u.searchParams.set('where',`familleavis="vente" and typeavis="annonce" and ${salesZoneClause(zone)} and dateparution>=date'${day(from)}'`);
 u.searchParams.set('order_by','dateparution desc');
 u.searchParams.set('limit',String(PAGE_SIZE));u.searchParams.set('offset',String((page-1)*PAGE_SIZE));
 return u;
}

const parse=(v:unknown):unknown=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return null}};
const str=(v:unknown,max:number)=>typeof v==='string'&&v.trim()?v.replace(/\s+/g,' ').trim().slice(0,max):null;
const digits=(v:unknown)=>typeof v==='string'?v.replace(/\D/g,''):'';
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:v==null?[]:[v];

export type SalesNotice={id:string;published:string;url:string;category:string;siren:string;buyer:string;activity:string|null;tradeName:string|null;
 establishment:string|null;city:string|null;postalCode:string|null};
export type SalesRejection='NOT_A_PURCHASE'|'NOT_A_LEGAL_ENTITY'|'NO_BUYER_IDENTITY'|'INVALID_NOTICE';
// One notice → the purchase it announces, or why it is not kept. Pure.
export function readSalesNotice(rec:unknown):{notice:SalesNotice}|{reject:SalesRejection}{
 const r=rec as Record<string,unknown>|null;
 if(!r||typeof r!=='object')return {reject:'INVALID_NOTICE'};
 const acte=parse(r.acte) as {vente?:{categorieVente?:unknown}}|null;
 const category=str(acte?.vente?.categorieVente,200);
 if(!category||!PURCHASE_CATEGORY.test(category))return {reject:'NOT_A_PURCHASE'};
 const people=list((parse(r.listepersonnes) as {personne?:unknown}|null)?.personne) as Array<Record<string,unknown>>;
 if(!people.length)return {reject:'NO_BUYER_IDENTITY'};
 const buyer=people[0]!;
 if(buyer?.typePersonne!=='pm')return {reject:'NOT_A_LEGAL_ENTITY'};
 const siren=digits((buyer.numeroImmatriculation as {numeroIdentification?:unknown}|undefined)?.numeroIdentification);
 const registered=list(r.registre).map(digits);
 const name=str(buyer.denomination,200);
 if(!/^\d{9}$/.test(siren)||!registered.includes(siren)||!name)return {reject:'NO_BUYER_IDENTITY'};
 const url=str(r.url_complete,300),id=str(r.id,40),published=str(r.dateparution,10);
 if(!url||!NOTICE_URL.test(url)||!id||!published||!/^\d{4}-\d{2}-\d{2}$/.test(published))return {reject:'INVALID_NOTICE'};
 const site=list((parse(r.listeetablissements) as {etablissement?:unknown}|null)?.etablissement)[0] as Record<string,unknown>|undefined;
 const address=site?.adresse as Record<string,unknown>|undefined;
 return {notice:{id,published,url,category,siren,buyer:name,activity:str(site?.activite,300),tradeName:str(site?.enseigne,120),establishment:str(site?.qualiteEtablissement,80),
  city:str(address?.ville,120),postalCode:/^\d{5}$/.test(String(address?.codePostal??''))?String(address!.codePostal):null}};
}

// The brief's activity words, against the activity and trade name of the business bought. Words that only say
// "a business was bought" filter nothing: with no other word, every purchase of the zone is kept.
const GENERIC=new Set(['reprise','reprises','repreneur','repreneurs','rachat','rachats','achat','achats','cession','cessions','vente','ventes','fonds','commerce','commerces',
 'entreprise','entreprises','societe','societes','tous','toutes','tout','activite','activites','secteur','secteurs','recent','recente','recents','recentes','nouveau','nouveaux','les','des','pour','dans']);
const fold=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export function activityStems(words:readonly string[]):string[]{
 const out=new Set<string>();
 for(const w of words)for(const t of fold(w).split(/[^a-z0-9]+/))if(t.length>=4&&!GENERIC.has(t))out.add(t.slice(0,6));
 return [...out];
}
export function matchesActivity(n:Pick<SalesNotice,'activity'|'tradeName'>,stems:readonly string[]):boolean{
 if(!stems.length)return true;
 const tokens=fold(`${n.activity??''} ${n.tradeName??''}`).split(/[^a-z0-9]+/).filter(Boolean);
 return stems.some(s=>tokens.some(t=>t.startsWith(s)));
}

export type SalesReport={examined:number;kept:number;rejected:Partial<Record<SalesRejection|'OTHER_ACTIVITY',number>>;duplicates:number;stems:string[]};
type Options={fetch?:typeof fetch;now?:()=>Date;timeoutMs?:number;timeBudgetMs?:number;maxPages?:number};

export class BodaccSalesProvider implements DiscoveryProvider {
 id='bodacc_sales';mode='live' as const;lastSearch?:ProviderSearchReport;lastSales?:SalesReport;
 private request:typeof fetch;private now:()=>Date;private timeoutMs:number;private budgetMs:number;private maxPages:number;
 constructor(o:Options={}){this.request=o.fetch??fetch;this.now=o.now??(()=>new Date());this.timeoutMs=o.timeoutMs??SALES_REQUEST_TIMEOUT_MS;this.budgetMs=o.timeBudgetMs??SALES_TIME_BUDGET_MS;this.maxPages=o.maxPages??MAX_PAGES}

 async searchCompanies(input:DiscoveryInput):Promise<SalesNotice[]>{
  const report:ProviderSearchReport={queries_planned:0,requests_sent:0,requests_failed:0,failure_codes:[],country:'FR',country_reason:'bodacc_fr'};this.lastSearch=report;
  const stems=activityStems([...input.categories,input.query]);
  const sales:SalesReport={examined:0,kept:0,rejected:{},duplicates:0,stems};this.lastSales=sales;
  const zone=resolveRegistryZone(input.location);
  if(!zone){report.failure_codes.push('BODACC_ZONE_UNMAPPED');return []}
  report.queries_planned=1;
  const started=Date.now(),now=this.now();let answered=0;
  const out:SalesNotice[]=[];const seen=new Set<string>();
  for(let page=1;page<=this.maxPages&&out.length<input.max_results;page++){
   if(Date.now()-started>=this.budgetMs){report.failure_codes.push('TIME_BUDGET_REACHED');break}
   let body:{results?:unknown[]};
   try{
    report.requests_sent++;
    const res=await this.request(salesUrl(zone,now,page),{headers:{accept:'application/json'},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});
    if(!res.ok){await res.body?.cancel().catch(()=>{});report.requests_failed++;report.failure_codes.push(`HTTP_${res.status}`);break}
    body=await readBounded(res) as typeof body;
    if(!Array.isArray(body?.results))throw new SalesRequestError('INVALID_RESPONSE');
    answered++;
   }catch(error){const name=(error as {name?:unknown})?.name;
    report.requests_failed++;report.failure_codes.push(error instanceof SalesRequestError?error.message:name==='TimeoutError'||name==='AbortError'?'TIMEOUT':'NETWORK_ERROR');break}
   const results=body.results!;
   for(const rec of results){
    sales.examined++;
    const read=readSalesNotice(rec);
    if('reject' in read){sales.rejected[read.reject]=(sales.rejected[read.reject]??0)+1;continue}
    if(!matchesActivity(read.notice,stems)){sales.rejected.OTHER_ACTIVITY=(sales.rejected.OTHER_ACTIVITY??0)+1;continue}
    // One company, one candidate: its most recent purchase (notices come newest first).
    if(seen.has(read.notice.siren)){sales.duplicates++;continue}
    seen.add(read.notice.siren);out.push(read.notice);
    if(out.length>=input.max_results)break;
   }
   if(results.length<PAGE_SIZE)break;
  }
  report.requests_answered=answered;
  // No request answered: an explicit failure (its Discovery unit is given back), never an empty success.
  if(report.requests_sent&&!answered)throw Error('BODACC_UNAVAILABLE');
  sales.kept=out.length;
  return out;
 }
 async fetchCompanyDetails(candidate:Candidate){return candidate}
 normalizeResult(raw:unknown):Candidate{
  const n=raw as SalesNotice;
  if(!n||!/^\d{9}$/.test(n.siren??'')||!n.buyer||!NOTICE_URL.test(n.url??''))throw Error('BODACC_SALES_RESULT_INVALID');
  const date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(`${n.published}T12:00:00Z`));
  const what=[n.activity,n.tradeName?`enseigne ${n.tradeName}`:null].filter(Boolean).join(', ');
  const now=new Date().toISOString();
  return CandidateSchema.parse({name:n.buyer.slice(0,200),canonical_url:null,website:null,city:n.city,address:null,phone:null,discovered_source:this.id,
   source_url:n.url,source_title:`Reprise publiée au BODACC le ${date}${what?` : ${what}`:''}`.slice(0,300),discovery_timestamp:now,confidence:1,
   raw_metadata:{source_class:'COMPANY_CANDIDATE',source_type:'legal_announcement',entity_type:'COMPANY',company_name:n.buyer,company_name_status:'RESOLVED',company_domain_status:'UNKNOWN',siren:n.siren,
    admissibility:{admissible:true,reason_code:'ADMISSIBLE',rule:'bodacc_purchase_by_legal_entity'},
    bodacc_sale:{notice_id:n.id,published:n.published,category:n.category,activity:n.activity,trade_name:n.tradeName,establishment:n.establishment,city:n.city,postal_code:n.postalCode},
    provenance:{...BODACC_SALES_PROVENANCE,endpoint:BODACC_RECORDS,retrieved_at:now}},
   deduplication_key:`siren:${n.siren}`});
 }
}
