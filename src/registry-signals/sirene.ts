// Signaux SIRENE — establishments created recently in one postal code, read from the API Recherche d'entreprises
// (annuaire-entreprises.data.gouv.fr, Licence Ouverte 2.0). The API filters by postal code, NAF codes and active
// state, but not by creation date: every page is read (paced by the limiter, cached) and the creation date is
// filtered here, on the ESTABLISHMENT's own date (a new shop of an older company counts; its company date is kept).
// Only publicly diffusible data is read. `minimal=true` with `include=siege,matching_etablissements` asks the API not
// to send the company's officers at all: no executive's personal data ever reaches this module.
import type {Preset} from './presets.ts';
import type {RateLimiter} from './limiter.ts';
import {cacheKey,type ResponseCache} from './cache.ts';
import {fold} from './normalize.ts';

export const SIRENE_ENDPOINT='https://recherche-entreprises.api.gouv.fr/search';
export const ANNUAIRE_PAGE=(siren:string)=>`https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;
export const ANNUAIRE_ETABLISSEMENT=(siret:string)=>`https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`;
export const SIRENE_PROVENANCE='API Recherche d’entreprises (annuaire-entreprises.data.gouv.fr), Licence Ouverte 2.0';
const PER_PAGE=25;// the API maximum
const MAX_RESPONSE_BYTES=2_000_000;
const DAY_MS=86_400_000;

export type SireneEstablishment={siret?:string|null;activite_principale?:string|null;etat_administratif?:string|null;statut_diffusion_etablissement?:string|null;
 date_creation?:string|null;date_fermeture?:string|null;adresse?:string|null;code_postal?:string|null;libelle_commune?:string|null;complement_adresse?:string|null;
 liste_enseignes?:string[]|null;nom_commercial?:string|null;est_siege?:boolean|null};
export type SireneCompany={siren:string;nom_complet?:string|null;nom_raison_sociale?:string|null;statut_diffusion?:string|null;etat_administratif?:string|null;
 activite_principale?:string|null;date_creation?:string|null;nature_juridique?:string|null;siege?:SireneEstablishment|null;matching_etablissements?:SireneEstablishment[]|null};
export type SirenePage={results?:SireneCompany[];total_results?:number;total_pages?:number;page?:number};

export type RecentEstablishment={siren:string;siret:string;denomination:string;names:string[];signs:string[];activite_principale:string;date_creation:string;
 date_creation_entreprise:string|null;adresse:string;code_postal:string;commune:string|null;est_siege:boolean;source_url:string;registry_url:string};
export type Exclusion='NOT_PUBLICLY_DIFFUSIBLE'|'COMPANY_NOT_ACTIVE'|'ESTABLISHMENT_CLOSED'|'OTHER_POSTAL_CODE'|'OTHER_ACTIVITY'|'TOO_OLD'|'NO_CREATION_DATE'
 |'DOMICILIATION_SUSPECTED'|'INCOMPLETE_RECORD';
export type SireneReport={pages:number;total_results:number|null;companies:number;examined:number;kept:number;excluded:Partial<Record<Exclusion,number>>;
 requests:number;retried:number;cache_hits:number;failure:string|null};

export function sireneUrl(preset:Pick<Preset,'naf_codes'>,postalCode:string,page:number):URL{
 const url=new URL(SIRENE_ENDPOINT);
 url.searchParams.set('code_postal',postalCode);url.searchParams.set('activite_principale',preset.naf_codes.join(','));
 url.searchParams.set('etat_administratif','A');url.searchParams.set('minimal','true');url.searchParams.set('include','siege,matching_etablissements');
 url.searchParams.set('per_page',String(PER_PAGE));url.searchParams.set('page',String(page));
 return url;
}

// A calendar date (YYYY-MM-DD) created within the last `maxAgeDays` days, today included; never a future date.
export function isRecent(date:string|null|undefined,maxAgeDays:number,now:Date):boolean{
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const day=Date.parse(`${date}T00:00:00Z`);if(!Number.isFinite(day))return false;
 const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 const age=(today-day)/DAY_MS;
 return age>=0&&age<=maxAgeDays;
}

// A domiciliation company's address, when the register itself writes it so: the domiciliation activity (82.11Z on the
// company), or "c/o", "chez", "domiciliation" in the address. Estimated, never certain: an excluded establishment is
// counted under DOMICILIATION_SUSPECTED, never silently dropped.
const DOMICILIATION_WORDS=/\b(?:domicili\w*|c o|aupres de|chez)\b/;
export function looksDomiciled(company:SireneCompany,site:SireneEstablishment):boolean{
 if(company.activite_principale==='82.11Z'||site.activite_principale==='82.11Z')return true;
 return DOMICILIATION_WORDS.test(fold(`${site.complement_adresse??''} ${site.adresse??''}`.replace(/c\/o/gi,' c o ')));
}

export function recentEstablishments(company:SireneCompany,preset:Pick<Preset,'naf_codes'|'max_age_days'>,postalCode:string,now:Date,
 count:(e:Exclusion)=>void):RecentEstablishment[]{
 if(company.statut_diffusion!=='O'){count('NOT_PUBLICLY_DIFFUSIBLE');return []}
 if(company.etat_administratif!=='A'){count('COMPANY_NOT_ACTIVE');return []}
 const codes=new Set(preset.naf_codes);
 const sites=[...(company.matching_etablissements??[])];
 // The head office is a candidate too when it is in the postal code and the API did not list it among the matching ones.
 const siege=company.siege;
 if(siege?.siret&&siege.code_postal===postalCode&&!sites.some(s=>s.siret===siege.siret))sites.push(siege);
 const out:RecentEstablishment[]=[];
 for(const s of sites){
  if(s.statut_diffusion_etablissement!=='O'){count('NOT_PUBLICLY_DIFFUSIBLE');continue}
  if(s.etat_administratif!=='A'||s.date_fermeture){count('ESTABLISHMENT_CLOSED');continue}
  if(s.code_postal!==postalCode){count('OTHER_POSTAL_CODE');continue}
  if(!s.activite_principale||!codes.has(s.activite_principale)){count('OTHER_ACTIVITY');continue}
  if(!s.date_creation){count('NO_CREATION_DATE');continue}
  if(!isRecent(s.date_creation,preset.max_age_days,now)){count('TOO_OLD');continue}
  if(looksDomiciled(company,s)){count('DOMICILIATION_SUSPECTED');continue}
  const denomination=(company.nom_raison_sociale||company.nom_complet||'').trim();
  if(!/^\d{14}$/.test(s.siret??'')||!denomination||!s.adresse){count('INCOMPLETE_RECORD');continue}
  const unique=(list:Array<string|null|undefined>)=>list.map(n=>(n??'').trim()).filter((n,i,a)=>n&&a.indexOf(n)===i);
  // The shop's sign(s) and trade name: what the street (and Google) shows; the legal name may differ entirely.
  const signs=unique([...(s.liste_enseignes??[]),s.nom_commercial]).filter(n=>n!==denomination);
  const names=unique([denomination,company.nom_complet,...signs]);
  out.push({siren:company.siren,siret:s.siret!,denomination,names,signs,activite_principale:s.activite_principale,date_creation:s.date_creation,
   date_creation_entreprise:company.date_creation??null,adresse:s.adresse,code_postal:s.code_postal,commune:s.libelle_commune??null,est_siege:!!s.est_siege,
   source_url:ANNUAIRE_ETABLISSEMENT(s.siret!),registry_url:ANNUAIRE_PAGE(company.siren)});
 }
 return out;
}

// The body is read chunk by chunk and refused past MAX_RESPONSE_BYTES, before any parsing.
export async function readBounded(res:Response,code:string,maxBytes=MAX_RESPONSE_BYTES):Promise<unknown>{
 const reader=res.body?.getReader();if(!reader)throw Error(`${code}_INVALID_RESPONSE`);
 const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maxBytes)throw Error(`${code}_RESPONSE_TOO_LARGE`);chunks.push(value)}}
 finally{await reader.cancel().catch(()=>{})}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw Error(`${code}_INVALID_RESPONSE`)}
}

export type SireneDeps={limiter:RateLimiter;cache:ResponseCache;ttlSeconds:number;fetch?:typeof fetch;timeoutMs?:number;maxPages?:number;
 log?:(line:Record<string,unknown>)=>void};
// Every page of one search, then the recent establishments. A page that fails ends the reading with an explicit
// failure code (what was read before stays); no page at all read is an error, never an empty success.
export async function searchRecentEstablishments(preset:Preset,postalCode:string,now:Date,deps:SireneDeps):Promise<{establishments:RecentEstablishment[];report:SireneReport}>{
 if(!/^\d{5}$/.test(postalCode))throw Error('INVALID_POSTAL_CODE');
 const request=deps.fetch??fetch;const maxPages=deps.maxPages??40;
 const report:SireneReport={pages:0,total_results:null,companies:0,examined:0,kept:0,excluded:{},requests:0,retried:0,cache_hits:0,failure:null};
 const count=(e:Exclusion)=>{report.excluded[e]=(report.excluded[e]??0)+1};
 const bySiret=new Map<string,RecentEstablishment>();
 const sentBefore=deps.limiter.stats.sent,retriedBefore=deps.limiter.stats.retried;
 for(let page=1;page<=maxPages;page++){
  const url=sireneUrl(preset,postalCode,page);const key=cacheKey('sirene',url.toString());
  let body=await deps.cache.get(key) as SirenePage|undefined;
  if(body)report.cache_hits++;
  else{
   let res:Response;
   try{res=await deps.limiter.send(()=>request(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(deps.timeoutMs??10000),redirect:'error'}))}
   catch(e){const name=(e as {name?:string})?.name;report.failure=name==='TimeoutError'||name==='AbortError'?'SIRENE_TIMEOUT':'SIRENE_NETWORK_ERROR';break}
   if(!res.ok){await res.body?.cancel().catch(()=>{});report.failure=`SIRENE_HTTP_${res.status}`;break}
   try{body=await readBounded(res,'SIRENE') as SirenePage}catch(e){report.failure=(e as Error).message;break}
   await deps.cache.set(key,body,deps.ttlSeconds);
  }
  report.pages++;
  if(typeof body?.total_results==='number')report.total_results=body.total_results;
  const results=Array.isArray(body?.results)?body.results:[];
  for(const company of results){
   if(!company||typeof company.siren!=='string'||!/^\d{9}$/.test(company.siren))continue;
   report.companies++;
   for(const e of recentEstablishments(company,preset,postalCode,now,count)){report.examined++;if(!bySiret.has(e.siret))bySiret.set(e.siret,e)}
  }
  const totalPages=typeof body?.total_pages==='number'?body.total_pages:0;
  if(!results.length||page>=totalPages)break;
  if(page===maxPages)report.failure='SIRENE_PAGE_LIMIT_REACHED';
 }
 report.requests=deps.limiter.stats.sent-sentBefore;report.retried=deps.limiter.stats.retried-retriedBefore;
 if(!report.pages)throw Error(report.failure??'SIRENE_UNAVAILABLE');
 const establishments=[...bySiret.values()].sort((a,b)=>b.date_creation.localeCompare(a.date_creation)||a.siret.localeCompare(b.siret));
 report.kept=establishments.length;
 // Every establishment looked at: the ones kept before de-duplication, and every exclusion.
 report.examined+=Object.values(report.excluded).reduce((n,v)=>n+(v??0),0);
 deps.log?.({component:'registry_signals',source:'sirene',postal_code:postalCode,preset:preset.key,...report,excluded:report.excluded});
 return {establishments,report};
}
