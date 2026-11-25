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
   const {events,skippedPersons,saleRules}=parseBodacc(rows as Record<string,unknown>[],family);
   // Migration 054: the vente runs also carry their rule counts (the weekly check); other families send none.
   const r=await rpc('ingest_public_events',{p_source:'bodacc',p_day:day,p_events:events,p_fetched:rows.length,p_skipped_persons:skippedPersons,
    ...(family==='vente'?{p_sale_rules:saleRules}:{})}) as {inserted:number};
   report.days.push({day,family,fetched:rows.length,inserted:r.inserted,skippedPersons});
  }catch(e){report.days.push({day,family,fetched:0,inserted:0,skippedPersons:0,error:e instanceof Error?e.message.slice(0,120):'ERROR'})}
 }
 if(c.enrich&&c.enrich.departments.length)await enrichCompanies(rpc,fetchJson,{...c,enrich:c.enrich},report);
 return report;
}

// Highest yield first: a business sale or a head-office move is a company already trading, almost never opposed to
// prospecting; most new companies are (≈ 87 % in Île-de-France, nights of 16–18 nov. 2026). When a night is not enough,
// what is left for the next one is the least useful.
export const ENRICH_PRIORITY:EventKind[]=['VENTE_FONDS','TRANSFERT_SIEGE','ETABLISSEMENT','CREATION'];
export type EnrichConfig={enrich:{departments:string[];kinds:EventKind[];since:string;limit:number};deadline:number;now:()=>number;sleep:(ms:number)=>Promise<void>};
export async function enrichCompanies(rpc:Rpc,fetchJson:Fetcher,c:EnrichConfig,report:{enriched:number;enrichFailed:number}):Promise<void>{
 const list:string[]=[];const seen=new Set<string>();
 for(const kind of ENRICH_PRIORITY.filter(k=>c.enrich.kinds.includes(k))){
  const room=c.enrich.limit-list.length;if(room<=0)break;
  const sirens=await rpc('sirens_to_enrich',{p_departments:c.enrich.departments,p_kinds:[kind],p_since:c.enrich.since,p_limit:room}) as string[]|{sirens_to_enrich:string}[];
  for(const s of sirens??[]){const siren=typeof s==='string'?s:s.sirens_to_enrich;if(!seen.has(siren)){seen.add(siren);list.push(siren)}}
 }
 // Up to 6 requests run at once, but one gate spaces their starts by 170 ms at least (≈ 6 per second, under the API's 7):
 // the API answers in ~0.7 s, so one request at a time only enriched ~70 companies in the 55 s budget (first night,
 // 16 nov. 2026).
 const rows:CompanyRow[]=[];let next=0;let gate:Promise<void>=Promise.resolve();let last=-Infinity;
 const pace=()=>gate=gate.then(async()=>{const wait=last+170-c.now();if(wait>0)await c.sleep(wait);last=c.now()});
 const worker=async()=>{
  while(next<list.length){
   if(c.now()>c.deadline-3000)return;
   const siren=list[next++]!;
   await pace();
   if(c.now()>c.deadline-3000)return;
   try{const row=parseCompany(siren,await fetchJson(`${RECHERCHE}?${new URLSearchParams({q:siren,per_page:'1'})}`,8000) as Record<string,unknown>);if(row){rows.push(row);report.enriched++}else report.enrichFailed++}
   catch{report.enrichFailed++}
   if(rows.length>=200)await rpc('upsert_company_cache',{p_rows:rows.splice(0)});
  }
 };
 await Promise.all(Array.from({length:Math.min(6,list.length)},worker));
 if(rows.length)await rpc('upsert_company_cache',{p_rows:rows});
}
