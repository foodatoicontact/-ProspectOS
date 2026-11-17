// Shared rate limits (migration 047, audit 2026-11-11 S2/S3): a fixed window counted in Postgres, so every Vercel
// instance sees the same count. Signed-in requests are counted per account (the database takes the account from the
// token: a caller cannot spend another account's counter); anonymous ones per hashed client address, by the server.
// Fail-open by design: if the counter cannot be read (database hiccup, migration not yet applied), the request goes on
// and one line is logged — a limit must never take the product down.
import {createHash} from 'node:crypto';
export type RateRule={bucket:string;limit:number;windowSeconds:number};
export type RateResult={allowed:boolean;retryAfter:number};
type Rpc=(fn:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;

// The signed-in API: 120 requests a minute per account is far above what the interface sends (a screen loads a handful),
// and well below what would get the server's address blocked by a public register. Open tenders query the BOAMP at each
// call and consume no plan quota: 10 a minute.
export const API_RULE:RateRule={bucket:'api',limit:120,windowSeconds:60};
export const TENDERS_RULE:RateRule={bucket:'tenders',limit:10,windowSeconds:60};
export const ruleForPath=(path:string[]):RateRule=>path[0]==='tenders'?TENDERS_RULE:API_RULE;

function read(data:unknown):RateResult|null{
 const d=data as {allowed?:unknown;retry_after?:unknown}|null;
 if(!d||typeof d.allowed!=='boolean')return null;
 return {allowed:d.allowed,retryAfter:typeof d.retry_after==='number'&&d.retry_after>0?Math.min(86400,Math.ceil(d.retry_after)):0};
}
async function hit(rpc:Rpc,fn:string,args:Record<string,unknown>,log:(e:Record<string,unknown>)=>void):Promise<RateResult>{
 try{
  const {data,error}=await rpc(fn,args);
  const r=error?null:read(data);
  if(r)return r;
  log({component:'rate_limit',event:'unavailable',fn});
 }catch{log({component:'rate_limit',event:'unavailable',fn})}
 return {allowed:true,retryAfter:0};
}
export const hitForAccount=(rpc:Rpc,rule:RateRule,log:(e:Record<string,unknown>)=>void)=>
 hit(rpc,'rate_limit_hit',{p_bucket:rule.bucket,p_limit:rule.limit,p_window_seconds:rule.windowSeconds},log);
// The client address is never stored: only a truncated hash of it, under the bucket name.
export const addressKey=(bucket:string,address:string)=>`${bucket}:${createHash('sha256').update(`prospectos-rate:${address}`).digest('base64url').slice(0,32)}`;
export const hitForAddress=(rpc:Rpc,rule:RateRule,address:string,log:(e:Record<string,unknown>)=>void)=>
 hit(rpc,'rate_limit_hit_key',{p_key:addressKey(rule.bucket,address),p_limit:rule.limit,p_window_seconds:rule.windowSeconds},log);
export const tooManyRequests=(retryAfter:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status:429,
 headers:{'content-type':'application/json','cache-control':'no-store','retry-after':String(Math.max(1,retryAfter))}});
