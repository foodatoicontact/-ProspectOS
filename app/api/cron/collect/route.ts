import {createAdminClient} from '../../../../src/server/admin-client';
import {cronAuthorized} from '../../../../src/signals/monitor';
import {runCollection} from '../../../../src/collect/run';
import {collectConfigFrom,publicEventsEnabled} from '../../../../src/collect/config';
// Collecte nationale (migration 045, src/collect) — nightly (vercel.json crons): the BODACC announcements of the last two
// days for all of France, stored once (replay-safe), then the company records the clients may need. Same authorization
// as the other jobs: "Authorization: Bearer <CRON_SECRET>". Without PUBLIC_EVENTS_COLLECT_ENABLED nothing runs.
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Collecte non configurée.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 if(!publicEventsEnabled(process.env))return json({skipped:'PUBLIC_EVENTS_COLLECT_DISABLED'});
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 const fetchJson=async(url:string,timeoutMs:number)=>{const res=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json'},redirect:'error'});
  if(!res.ok)throw Error(`HTTP_${res.status}`);return res.json()};
 const started=Date.now();
 try{
  const report=await runCollection(rpc,fetchJson,collectConfigFrom(process.env,new Date(),{deadline:started+55000,now:Date.now,sleep:ms=>new Promise(r=>setTimeout(r,ms))}));
  console.info(JSON.stringify({event:'public_events_collect',...report}));
  return json(report);
 }catch{
  // The cockpit's feed (migration 056): one COLLECT_FAILED row per job and day, best effort.
  try{await admin.rpc('record_collect_failure',{p_job:'collect',p_code:'COLLECT_FAILED'})}catch{}
  return json({error:'Collecte momentanément indisponible.',code:'COLLECT_FAILED'},500)}
}
