import {createAdminClient} from '../../../../src/server/admin-client';
import {runMonitorBatch,cronAuthorized} from '../../../../src/signals/monitor';
import {createSupabaseAnalysisAudit} from '../../../../src/discovery/analysis-audit';
import {createPolicyFetcher} from '../../../../src/discovery/website-analysis';
import {dynamicAnalysisEnabled} from '../../../../src/discovery/analysis-authorization';
import {safeFetch} from '../../../../src/discovery/safe-fetch';
import {BodaccSignalProvider,bodaccEnabled} from '../../../../src/signals/providers/bodacc';
// Signal Engine S9 — daily monitoring (vercel.json crons). Vercel Cron calls this route with
// "Authorization: Bearer <CRON_SECRET>"; nothing else is read from the request. Without CRON_SECRET configured the
// route does nothing (503); a wrong or missing secret is 401. The work itself is runMonitorBatch (src/signals/monitor.ts).
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const auth=cronAuthorized(request.headers.get('authorization'),process.env.CRON_SECRET);
 if(auth==='not_configured')return json({error:'Surveillance non configurée.',code:'CRON_NOT_CONFIGURED'},503);
 if(auth!=='ok')return json({error:'Non autorisé.'},401);
 let admin;try{admin=createAdminClient()}catch{return json({error:'Configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const fetchPage=createPolicyFetcher(safeFetch);
 try{
  const summary=await runMonitorBatch({admin,now:()=>new Date(),budgetMs:45000,batch:5,
   staticAllowlist:(process.env.DISCOVERY_ALLOWED_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
   dynamicEnabled:dynamicAnalysisEnabled(process.env.DISCOVERY_DYNAMIC_ANALYSIS_ENABLED),bodaccEnabled:bodaccEnabled(process.env),
   sitePageFetcher:policy=>url=>fetchPage(url,policy),bodaccProvider:()=>new BodaccSignalProvider(),
   audit:userId=>createSupabaseAnalysisAudit(admin,userId),
   log:event=>console.info(JSON.stringify(event))});
  return json(summary);
 }catch{return json({error:'Surveillance momentanément indisponible.',code:'MONITOR_FAILED'},500)}
}
