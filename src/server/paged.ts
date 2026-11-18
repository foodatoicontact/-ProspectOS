// Reads every row of a list query page by page (audit 2026-11-11, Q1). PostgREST answers at most 1 000 rows per request
// (Supabase's default max-rows): a project with more prospects was cut silently. Pages of 500 in a stable order, up to a
// hard ceiling; reaching it is reported (truncated), never hidden.
export const PAGE_ROWS=500;
export const MAX_ROWS=10_000;
export async function readAllPages<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>,max=MAX_ROWS):Promise<{rows:T[];truncated:boolean}>{
 const rows:T[]=[];
 for(let from=0;from<max;from+=PAGE_ROWS){
  const {data,error}=await page(from,Math.min(from+PAGE_ROWS,max)-1);
  if(error)throw Error('DATABASE_REQUEST_FAILED');
  const got=data??[];rows.push(...got);
  if(got.length<Math.min(PAGE_ROWS,max-from))return {rows,truncated:false};
 }
 return {rows,truncated:true};
}
