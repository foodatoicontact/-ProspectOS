import {createAdminClient} from '../../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../../src/signals/monitor';
import {enrichCompanies} from '../../../../../src/collect/run';
import {enrichConfigFrom,publicEventsEnabled} from '../../../../../src/collect/config';
// Enrichment of the collected companies (migration 045, src/collect), separate from the nightly collection: three runs a
// night (vercel.json: /api/cron/enrich/1, /2, /3 — one schedule each, the plan allows one run a day per job), each with
// a full minute. A big BODACC day brings 500+ companies in Île-de-France alone (17 nov. 2026), more than the minute left
// after the collection. Same authorization as the other jobs; nothing runs without PUBLIC_EVENTS_COLLECT_ENABLED.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const SLOTS=new Set(['1','2','3']);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request,context:{params:Promise<{slot:string}>}){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Enrichissement non configuré.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 const {slot}=await context.params;
 if(!SLOTS.has(slot))return json({error:'Introuvable.'},404);
 if(!publicEventsEnabled(process.env))return json({skipped:'PUBLIC_EVENTS_COLLECT_DISABLED'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 const fetchJson=async(url:string,timeoutMs:number)=>{const res=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json'},redirect:'error'});
  if(!res.ok)throw Error(`HTTP_${res.status}`);return res.json()};
 const started=Date.now();
 const config=enrichConfigFrom(process.env,new Date(),{deadline:started+55000,now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))});
 if(!config)return json({skipped:'NO_ENRICH_DEPARTMENTS'});
 try{
  const report={enriched:0,enrichFailed:0};
  await enrichCompanies(rpc,fetchJson,config,report);
  console.info(JSON.stringify({event:'public_events_enrich',slot,...report}));
  return json({slot,...report});
 }catch{return json({error:'Enrichissement momentanément indisponible.',code:'ENRICH_FAILED'},500)}
}
