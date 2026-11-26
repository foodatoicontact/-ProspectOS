import {createAdminClient} from '../../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../../src/signals/monitor';
import {runSalesBackfill} from '../../../../../src/collect/sales-backfill';
import {publicEventsEnabled} from '../../../../../src/collect/config';
// The sales history (migration 058, src/collect/sales-backfill.ts) — two runs a night (vercel.json: /api/cron/sales-backfill/1
// and /2, one schedule each), each reading again a few BODACC « vente » days of the last 180 days, until all are read. Same
// authorization as the other jobs; nothing runs without PUBLIC_EVENTS_COLLECT_ENABLED.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const SLOTS=new Set(['1','2']);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request,context:{params:Promise<{slot:string}>}){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Rattrapage non configuré.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 const {slot}=await context.params;
 if(!SLOTS.has(slot))return json({error:'Introuvable.'},404);
 if(!publicEventsEnabled(process.env))return json({skipped:'PUBLIC_EVENTS_COLLECT_DISABLED'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 const fetchJson=async(url:string,timeoutMs:number)=>{const res=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json'},redirect:'error'});
  if(!res.ok)throw Error(`HTTP_${res.status}`);return res.json()};
 const started=Date.now();
 try{
  const report=await runSalesBackfill(rpc,fetchJson,{at:new Date(),limit:12,deadline:started+55000,now:Date.now});
  console.info(JSON.stringify({event:'sales_backfill',slot,...report}));
  return json({slot,...report});
 }catch{
  try{await admin.rpc('record_collect_failure',{p_job:`sales-backfill-${slot}`,p_code:'SALES_BACKFILL_FAILED'})}catch{}
  return json({error:'Rattrapage momentanément indisponible.',code:'SALES_BACKFILL_FAILED'},500)}
}
