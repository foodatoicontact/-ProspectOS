// The sales history (migration 058, owner decision 26 nov. 2026): the BODACC « Ventes et cessions » of the last 180 days,
// read again a few weekdays per night (newest first), with the same rules as the nightly collection (src/collect/bodacc.ts):
// the sales missing from the base are stored, and every sale already stored gets its seller (a company's SIREN, or only
// « natural person ») — nothing else of a stored row ever changes. A day is marked read once its notices are stored.
import {exportUrl,parseBodacc} from './bodacc.ts';
import {parisDate,addDays} from '../dedicated/model.ts';
import type {Fetcher} from './run.ts';
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export const SALES_HISTORY_DAYS=180;
export type BackfillReport={days:{day:string;fetched:number;inserted:number;error?:string}[]};
export function backfillWindow(at:Date):{since:string;until:string}{
 const today=parisDate(at);
 // The two last days belong to the nightly collection.
 return {since:addDays(today,-SALES_HISTORY_DAYS),until:addDays(today,-3)};
}
export async function runSalesBackfill(rpc:Rpc,fetchJson:Fetcher,c:{at:Date;limit:number;deadline:number;now:()=>number}):Promise<BackfillReport>{
 const report:BackfillReport={days:[]};
 const w=backfillWindow(c.at);
 const days=await rpc('sale_days_to_backfill',{p_since:w.since,p_until:w.until,p_limit:c.limit}) as string[]|null;
 for(const day of Array.isArray(days)?days:[]){
  if(c.now()>c.deadline-8000)break;
  try{
   const rows=await fetchJson(exportUrl(day,'vente'),20000);
   if(!Array.isArray(rows))throw Error('UNEXPECTED_BODY');
   const {events,supersessions,skippedPersons,saleRules}=parseBodacc(rows as Record<string,unknown>[],'vente');
   const r=await rpc('ingest_public_events',{p_source:'bodacc',p_day:day,p_events:events,p_fetched:rows.length,p_skipped_persons:skippedPersons,
    p_sale_rules:saleRules,...(supersessions.length?{p_supersessions:supersessions}:{})}) as {inserted:number};
   await rpc('mark_sale_backfill_day',{p_day:day,p_fetched:rows.length});
   report.days.push({day,fetched:rows.length,inserted:r.inserted});
  }catch(e){report.days.push({day,fetched:0,inserted:0,error:e instanceof Error?e.message.slice(0,120):'ERROR'})}
 }
 return report;
}
