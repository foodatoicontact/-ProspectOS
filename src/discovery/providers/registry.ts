// Discovery from the official company register — API Recherche d'entreprises (annuaire-entreprises.data.gouv.fr,
// Licence Ouverte 2.0). The brief's business words become NAF groups (registry/naf.ts), its place a region or
// department code (registry/zone.ts); each group is queried on its own, page by page, and only the companies the
// structured rules admit (registry/admission.ts) are kept — deduplicated by SIREN. A register entry proves the
// company's IDENTITY, activity and places: never a need, never a signal, never evidence (no observation is made).
import {CandidateSchema,type Candidate,type DiscoveryInput,type DiscoveryProvider,type ProviderSearchReport} from '../types.ts';
import {proposeNafGroups,type NafGroup} from '../registry/naf.ts';
import {resolveRegistryZone,type RegistryZone} from '../registry/zone.ts';
import {admitRegistryCompany,employeeTranchesFor,type Admission,type RegistryCompany,type RejectionReason} from '../registry/admission.ts';

export const REGISTRY_ENDPOINT='https://recherche-entreprises.api.gouv.fr/search';
export const REGISTRY_PROVENANCE={source:'API Recherche d’entreprises (annuaire-entreprises.data.gouv.fr)',licence:'Licence Ouverte 2.0 (Etalab)'};
const PER_PAGE=25;// the API maximum
const MAX_PAGES_PER_GROUP=4;
// Each NAF group is queried and fails on its own: a group the API refuses (e.g. the agri-food code list) is
// counted (failure code, failed_groups) and the other groups' companies are kept — never retried another way.
// One exception: a 429 (rate limit — seen on the first request from a shared server egress IP) is re-sent ONCE,
// same URL, after the API's Retry-After (bounded by registryRetryDelay) and only within the run time budget.
// The API allows 7 requests per second: requests of one search are sent one after another, spaced accordingly.
// 500 ms, not the 143 ms the limit would allow: the server's egress IP is shared with other API users (429s seen
// on the Preview canary), and a search sends about ten requests at most, so this costs a few seconds only.
export const MIN_REQUEST_INTERVAL_MS=500;
// Bounds of one search, well inside the route's 60 s limit (app/api/v1/[...path]/route.ts): each request is aborted
// after REGISTRY_REQUEST_TIMEOUT_MS, no request starts once REGISTRY_TIME_BUDGET_MS is spent (what was found is
// kept), a response over MAX_RESPONSE_BYTES is refused unparsed, redirects are refused. No retry, except the single one after a 429.
export const REGISTRY_REQUEST_TIMEOUT_MS=10000;
export const REGISTRY_TIME_BUDGET_MS=30000;
const MAX_RESPONSE_BYTES=2_000_000;
export const REGISTRY_RETRY_DEFAULT_MS=1000;
export const REGISTRY_RETRY_MAX_MS=2000;
// Retry-After in seconds or as an HTTP date; missing or unreadable → 1 s; never above 2 s, never below the API's pace.
export function registryRetryDelay(header:string|null,now:number):number{
 const v=header?.trim()??'';let ms=REGISTRY_RETRY_DEFAULT_MS;
 if(/^\d+$/.test(v))ms=Number(v)*1000;else if(v&&Number.isFinite(Date.parse(v)))ms=Math.floor((Date.parse(v)-now)/1000)*1000;
 return Math.min(REGISTRY_RETRY_MAX_MS,Math.max(MIN_REQUEST_INTERVAL_MS,ms));
}
class RegistryRequestError extends Error{}
async function readBounded(res:Response):Promise<unknown>{
 const reader=res.body?.getReader();if(!reader)throw new RegistryRequestError('INVALID_RESPONSE');
 let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_RESPONSE_BYTES)throw new RegistryRequestError('RESPONSE_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new RegistryRequestError('INVALID_RESPONSE')}
}

type Admitted=Extract<Admission,{admitted:true}>;
export type RegistryHit=RegistryCompany&{registry_admission:Admitted;registry_zone:RegistryZone;registry_groups:Array<Pick<NafGroup,'key'|'label'>>};
export type RegistryAdmissionReport={examined:number;admitted:number;rejected:Partial<Record<RejectionReason,number>>;duplicates:number;unmapped_terms:string[];failed_groups:Array<NafGroup['key']>};
type Options={fetch?:typeof fetch;wait?:(ms:number)=>Promise<void>;maxPagesPerGroup?:number;timeoutMs?:number;timeBudgetMs?:number;now?:()=>number};

export function registryUrl(group:NafGroup,zone:RegistryZone,tranches:string[],page:number):URL{
 const url=new URL(REGISTRY_ENDPOINT);
 if(group.section)url.searchParams.set('section_activite_principale',group.section);else url.searchParams.set('activite_principale',group.codes.join(','));
 url.searchParams.set(zone.kind==='region'?'region':'departement',zone.code);
 if(tranches.length)url.searchParams.set('tranche_effectif_salarie',tranches.join(','));
 url.searchParams.set('etat_administratif','A');url.searchParams.set('per_page',String(PER_PAGE));url.searchParams.set('page',String(page));
 return url;
}

export class RegistryProvider implements DiscoveryProvider {
 id='registry';mode='live' as const;lastSearch?:ProviderSearchReport;lastAdmission?:RegistryAdmissionReport;
 private request:typeof fetch;private wait:(ms:number)=>Promise<void>;private maxPages:number;private timeoutMs:number;private budgetMs:number;private now:()=>number;
 constructor(options:Options={}){this.request=options.fetch??fetch;this.wait=options.wait??(ms=>new Promise(r=>setTimeout(r,ms)));this.maxPages=options.maxPagesPerGroup??MAX_PAGES_PER_GROUP;this.timeoutMs=options.timeoutMs??REGISTRY_REQUEST_TIMEOUT_MS;this.budgetMs=options.timeBudgetMs??REGISTRY_TIME_BUDGET_MS;this.now=options.now??Date.now}

 async searchCompanies(input:DiscoveryInput):Promise<RegistryHit[]>{
  const report:ProviderSearchReport={queries_planned:0,requests_sent:0,requests_failed:0,failure_codes:[],country:'FR',country_reason:'registry_fr'};this.lastSearch=report;
  const {groups,requested,narrowed,unmapped}=proposeNafGroups([...input.categories,input.query]);
  const admission:RegistryAdmissionReport={examined:0,admitted:0,rejected:{},duplicates:0,unmapped_terms:unmapped,failed_groups:[]};this.lastAdmission=admission;report.failed_groups=admission.failed_groups;
  // Same objects as the admission report: the run metrics read the final counts once the search is over.
  report.registry={groups_requested:requested,groups_kept:groups.map(g=>g.key),narrowed,naf_scope:groups.map(g=>g.section?`${g.key}:section:${g.section}`:`${g.key}:codes:${g.codes.length}`),
   naf_code_count:groups.reduce((n,g)=>n+(g.section?0:g.codes.length),0),get examined(){return admission.examined},get admitted(){return admission.admitted},get rejected(){return admission.rejected},get duplicates(){return admission.duplicates}};
  const zone=resolveRegistryZone(input.location);
  if(!zone){report.failure_codes.push('REGISTRY_ZONE_UNMAPPED');return []}
  if(!groups.length){report.failure_codes.push('REGISTRY_SECTOR_UNMAPPED');return []}
  report.queries_planned=groups.length;
  const range=input.optional_filters.employee_range;const tranches=range?employeeTranchesFor(range):[];
  const perGroup:RegistryHit[][]=[];const started=this.now();let outOfTime=false;let answered=0;
  for(const group of groups){
   const hits:RegistryHit[]=[];
   for(let page=1;page<=this.maxPages&&!outOfTime;page++){
    if(this.now()-started>=this.budgetMs){outOfTime=true;report.failure_codes.push('TIME_BUDGET_REACHED');break}
    if(report.requests_sent)await this.wait(MIN_REQUEST_INTERVAL_MS);
    let body:{results?:RegistryCompany[];total_pages?:number};
    try{let res:Response;
     for(let attempt=0;;attempt++){report.requests_sent++;
      res=await this.request(registryUrl(group,zone,tranches,page),{headers:{accept:'application/json'},signal:AbortSignal.timeout(this.timeoutMs),redirect:'error'});
      if(res.status!==429||attempt>0)break;
      const delay=registryRetryDelay(res.headers.get('retry-after'),this.now());
      if(this.now()-started+delay>=this.budgetMs)break;
      await res.body?.cancel().catch(()=>{});report.requests_retried=(report.requests_retried??0)+1;await this.wait(delay)}
     if(!res.ok){await res.body?.cancel().catch(()=>{});report.requests_failed++;report.failure_codes.push(`HTTP_${res.status}`);admission.failed_groups.push(group.key);break}
     body=await readBounded(res) as typeof body;answered++}
    catch(error){const name=(error as {name?:unknown})?.name;
     report.requests_failed++;report.failure_codes.push(error instanceof RegistryRequestError?error.message:name==='TimeoutError'||name==='AbortError'?'TIMEOUT':'NETWORK_ERROR');admission.failed_groups.push(group.key);break}
    const results=Array.isArray(body?.results)?body.results:[];
    for(const company of results){
     if(!company||typeof company.siren!=='string')continue;
     admission.examined++;const verdict=admitRegistryCompany(company,zone);
     if(verdict.admitted)hits.push({...company,registry_admission:verdict,registry_zone:zone,registry_groups:[{key:group.key,label:group.label}]});
     else admission.rejected[verdict.reason]=(admission.rejected[verdict.reason]??0)+1;
    }
    if(hits.length>=input.max_results||!results.length||page>=(typeof body?.total_pages==='number'?body.total_pages:0))break;
   }
   perGroup.push(hits);
  }
  report.requests_answered=answered;
  // No request answered at all (a 429 and its retry count as one failure): explicit failure, never an empty success.
  if(report.requests_sent&&!answered)throw Error('REGISTRY_UNAVAILABLE');
  // Groups left after reduceNafGroups are independent (none inside another): interleaved, so a smaller one is never pushed
  // out by a larger one; one SIREN, one company.
  const out:RegistryHit[]=[];const bySiren=new Map<string,RegistryHit>();
  for(let i=0;perGroup.some(g=>i<g.length);i++)for(const g of perGroup){const hit=g[i];if(!hit)continue;const known=bySiren.get(hit.siren);
   if(known){admission.duplicates++;known.registry_groups.push(...hit.registry_groups.filter(x=>!known.registry_groups.some(k=>k.key===x.key)));continue}
   bySiren.set(hit.siren,hit);out.push(hit)}
  admission.admitted=out.length;
  return out.slice(0,input.max_results);
 }
 async fetchCompanyDetails(candidate:Candidate){return candidate}
 normalizeResult(raw:unknown):Candidate{
  const r=raw as RegistryHit;
  if(!r||!/^\d{9}$/.test(r.siren??'')||!r.registry_admission?.admitted)throw Error('REGISTRY_RESULT_INVALID');
  const name=(r.nom_raison_sociale||r.nom_complet||'').trim();if(!name)throw Error('REGISTRY_RESULT_INVALID');
  const siege=r.siege??{};
  const sites=r.registry_admission.sites.map(s=>({siret:s.siret??null,commune:s.commune??null,libelle_commune:s.libelle_commune??null,activite_principale:s.activite_principale??null,tranche_effectif_salarie:s.tranche_effectif_salarie??null,est_siege:!!s.est_siege}));
  const now=new Date().toISOString();
  return CandidateSchema.parse({name:name.slice(0,200),canonical_url:null,website:null,city:siege.libelle_commune??null,address:siege.adresse??null,phone:null,discovered_source:this.id,
   source_url:`https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,source_title:`${name} — Annuaire des Entreprises (SIREN ${r.siren})`.slice(0,300),discovery_timestamp:now,confidence:1,
   raw_metadata:{source_class:'COMPANY_CANDIDATE',source_type:'public_registry',entity_type:'COMPANY',company_name:name,company_name_status:'RESOLVED',company_domain_status:'UNKNOWN',siren:r.siren,
    admissibility:{admissible:true,reason_code:'ADMISSIBLE',rule:r.registry_admission.rule},
    registry:{siren:r.siren,naf:r.activite_principale??null,section:r.section_activite_principale??null,tranche_effectif_salarie:r.tranche_effectif_salarie??null,
     categorie_entreprise:(r as Record<string,unknown>).categorie_entreprise??null,nature_juridique:(r as Record<string,unknown>).nature_juridique??null,
     siege:{commune:siege.commune??null,libelle_commune:siege.libelle_commune??null,code_postal:siege.code_postal??null,region:siege.region??null},
     sites_in_zone:sites,admission:{rule:r.registry_admission.rule,zone:r.registry_zone},naf_groups:r.registry_groups},
    provenance:{...REGISTRY_PROVENANCE,endpoint:REGISTRY_ENDPOINT,retrieved_at:now}},
   deduplication_key:`siren:${r.siren}`});
 }
}
