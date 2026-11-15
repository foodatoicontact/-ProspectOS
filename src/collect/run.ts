// The nightly collection: the BODACC of the last days (replayed safely: an announcement is stored once), then the company
// records the clients may need, within a time budget and at most 6 requests per second to the API Recherche d'entreprises.
import {exportUrl,parseBodacc,FAMILIES,type EventKind} from './bodacc.ts';
import {parseCompany,RECHERCHE,type CompanyRow} from './enrich.ts';
export type Fetcher=(url:string,timeoutMs:number)=>Promise<unknown>;
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type CollectConfig={days:string[];enrich:{departments:string[];kinds:EventKind[];since:string;limit:number}|null;deadline:number;now:()=>number;
 sleep:(ms:number)=>Promise<void>};
export type CollectReport={days:{day:string;family:string;fetched:number;inserted:number;skippedPersons:number;error?:string}[];enriched:number;enrichFailed:number};
export async function runCollection(rpc:Rpc,fetchJson:Fetcher,c:CollectConfig):Promise<CollectReport>{
 const report:CollectReport={days:[],enriched:0,enrichFailed:0};
 for(const day of c.days)for(const family of FAMILIES){
  if(c.now()>c.deadline-5000)break;
  try{
   const rows=await fetchJson(exportUrl(day,family),20000);
   if(!Array.isArray(rows))throw Error('UNEXPECTED_BODY');
   const {events,skippedPersons}=parseBodacc(rows as Record<string,unknown>[],family);
   const r=await rpc('ingest_public_events',{p_source:'bodacc',p_day:day,p_events:events,p_fetched:rows.length,p_skipped_persons:skippedPersons}) as {inserted:number};
   report.days.push({day,family,fetched:rows.length,inserted:r.inserted,skippedPersons});
  }catch(e){report.days.push({day,family,fetched:0,inserted:0,skippedPersons:0,error:e instanceof Error?e.message.slice(0,120):'ERROR'})}
 }
 if(c.enrich&&c.enrich.departments.length){
  const sirens=await rpc('sirens_to_enrich',{p_departments:c.enrich.departments,p_kinds:c.enrich.kinds,p_since:c.enrich.since,p_limit:c.enrich.limit}) as string[]|{sirens_to_enrich:string}[];
  const list=(sirens??[]).map(s=>typeof s==='string'?s:s.sirens_to_enrich);
  const rows:CompanyRow[]=[];
  for(const siren of list){
   if(c.now()>c.deadline-3000)break;
   try{const row=parseCompany(siren,await fetchJson(`${RECHERCHE}?${new URLSearchParams({q:siren,per_page:'1'})}`,8000) as Record<string,unknown>);if(row){rows.push(row);report.enriched++}else report.enrichFailed++}
   catch{report.enrichFailed++}
   await c.sleep(170);
   if(rows.length>=200){await rpc('upsert_company_cache',{p_rows:rows.splice(0)});}
  }
  if(rows.length)await rpc('upsert_company_cache',{p_rows:rows});
 }
 return report;
}
