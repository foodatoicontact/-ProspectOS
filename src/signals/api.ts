import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {SIGNAL_TYPES,IntentProfileSchema,type SignalCandidate} from './types.ts';
import {runSignalScan,toCandidate,type ScanReport} from './service.ts';
import type {SignalProvider,SignalTarget} from './provider.ts';
import {FixtureSignalProvider} from './providers/fixture.ts';
import {OfficialSiteSignalProvider,type SiteFetcher} from './providers/site.ts';
import {scoreIntent,type IntentSignal} from '../domain/intent.ts';
import {resolveAnalysisAuthorization,type AcceptedDiscoveryResult,type AnalysisAuthorization} from '../discovery/analysis-authorization.ts';
import {analysisFailureCode} from '../discovery/services.ts';
import type {AnalysisAudit} from '../discovery/website-analysis.ts';
// Signal Engine API (docs/SIGNAL_ENGINE_V1_PLAN.md §14). Every route runs as the user (RLS, membership checked by the
// database in save_signals / review_signal / save_intent_profile). A signal is never evidence and never a status
// chosen by the browser: what a user types is saved PENDING_REVIEW like anything a provider found.
//
//  GET  /prospects/:id/signals          the prospect's signals and its INTENT (verified + estimated), recomputed now
//  POST /prospects/:id/signals          a signal the user found themself (URL + exact excerpt; nothing is fetched)
//  POST /prospects/:id/signal-scan      read the company's own website for signals (same authorization, audit and
//                                       plan unit as "Analyser le site"; the unit is given back when nothing was read)
//  POST /signals/:id/review             verify | reject | reset
//  GET|POST /projects/:id/intent-profile  the project's tracked types, weights and words
type Json=(value:unknown,status?:number)=>Response;
export type SignalDeps={
 userId:string;now:()=>Date;
 // The server's privileged audit writer, or null when the server cannot audit (then nothing real is fetched).
 audit:()=>AnalysisAudit|null;
 sitePageFetcher:(policy:Extract<AnalysisAuthorization,{ok:true}>['fetchPolicy'])=>SiteFetcher;
 staticAllowlist:string[];dynamicEnabled:boolean;
 requireEntitlement:()=>Promise<void>;
 refundAnalysis:()=>Promise<void>;
};
const uuid=z.string().uuid();
const ManualSchema=z.object({
 signal_type:z.enum(SIGNAL_TYPES),
 title:z.string().trim().min(1).max(300).optional(),
 excerpt:z.string().trim().min(1).max(500),
 source_url:z.string().max(2048),
 event_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
 published_at:z.string().datetime({offset:true}).nullable().optional(),
}).strict();
const ReviewSchema=z.object({decision:z.enum(['verify','reject','reset']),reason:z.string().max(300).optional()}).strict();
// Refusals of a site scan: the codes and sentences of "Analyser le site" (the same authorization decides both).
export const SCAN_REFUSALS:Record<string,[string,number]>={
 NO_OFFICIAL_WEBSITE:['Recherche non applicable : aucun site officiel n’est identifié pour cette entreprise.',422],
 SOURCE_POLICY_REQUIRED:['Lecture du site bloquée : ce site n’a pas été découvert et accepté via ProspectOS, et l’opérateur ne l’a pas autorisé.',503],
 DYNAMIC_ANALYSIS_DISABLED:['Lecture des sites découverts désactivée par l’opérateur pour le moment.',503],
 DISCOVERY_CAPABILITY_INVALID:['Lecture du site bloquée : ce prospect ne provient pas d’un site officiel découvert et accepté.',403],
 WEBSITE_MISMATCH:['Lecture du site bloquée : le site du prospect ne correspond plus au site découvert et accepté.',403],
 OFFICIAL_WEBSITE_REQUIRED:['Recherche non applicable : aucun site officiel n’est identifié pour cette entreprise.',422],
 CONFIGURATION_REQUIRED:['Recherche indisponible : configuration serveur incomplète.',503],
 ROBOTS_DENIED:['Lecture refusée : le robots.txt du site ne l’autorise pas.',422],
 ROBOTS_UNAVAILABLE:['Lecture impossible : le robots.txt du site est inaccessible. Par prudence, rien n’a été lu.',422],
 SITE_TIMEOUT:['Lecture impossible : le site n’a pas répondu à temps.',504],
 SITE_NOT_FOUND:['Lecture impossible : le nom de domaine du site ne répond pas.',422],
 SITE_BLOCKED:['Lecture impossible : le site refuse les visites automatisées.',422],
 SITE_HTTP_ERROR:['Lecture impossible : le site a renvoyé une erreur.',502],
 SITE_REDIRECT_REFUSED:['Lecture impossible : le site redirige vers un autre domaine que le site officiel accepté.',422],
 SITE_NOT_HTML:['Lecture impossible : la page du site n’est pas une page web lisible.',422],
 SITE_TOO_LARGE:['Lecture impossible : la page du site est trop volumineuse.',422],
 ANALYSIS_FAILED:['Lecture du site impossible.',502],
};
const refusal=(json:Json,code:string)=>{const r=SCAN_REFUSALS[code]??SCAN_REFUSALS.ANALYSIS_FAILED;return json({error:r[0],code},r[1])};
const SIGNAL_COLUMNS='id,prospect_id,signal_type,status,title,excerpt,source_url,source_domain,source_type,provider,confidence,event_date,published_at,observed_at,date_basis,matched_terms,reviewed_at,rejection_reason,created_at';
const toIntentSignal=(r:Record<string,any>):IntentSignal=>({id:r.id,signal_type:r.signal_type,status:r.status,title:r.title,excerpt:r.excerpt,source_url:r.source_url,source_domain:r.source_domain??null,
 confidence:Number(r.confidence),event_date:r.event_date??null,published_at:r.published_at??null,observed_at:r.observed_at,matched_terms:r.matched_terms??[]});

async function profileOf(db:SupabaseClient,projectId:string){
 const rows=await checked(db.from('intent_profiles').select('profile').eq('project_id',projectId));
 const parsed=IntentProfileSchema.safeParse(rows?.[0]?.profile);return parsed.success?parsed.data:null;
}
function repoOf(db:SupabaseClient){
 return {saveSignals:async(prospectId:string,runId:string|null,list:SignalCandidate[])=>{
  const r=await checked(db.rpc('save_signals',{p_prospect_id:prospectId,p_run_id:runId,p_signals:list}));
  return {inserted:Number(r?.inserted??0),duplicates:Number(r?.duplicates??0)};
 }};
}

export async function handleSignals(request:Request,path:string[],body:Record<string,unknown>,db:SupabaseClient,json:Json,deps:SignalDeps):Promise<Response|null>{
 const [resource,id,action]=path;const method=request.method;
 const applies=resource==='prospects'&&(action==='signals'||action==='signal-scan')||resource==='signals'&&action==='review'||resource==='projects'&&action==='intent-profile';
 if(!applies)return null;
 if(!uuid.safeParse(id).success)return json({error:'Identifiant invalide'},400);
 if(resource==='projects'){
  if(method==='GET')return json({profile:await profileOf(db,id)});
  if(method==='POST'){
   const parsed=IntentProfileSchema.safeParse(body);if(!parsed.success)return json({error:'Profil d’intention invalide'},400);
   return json(await checked(db.rpc('save_intent_profile',{p_project_id:id,p_profile:parsed.data})));
  }
  return null;
 }
 if(resource==='signals'){
  if(method!=='POST')return null;
  const parsed=ReviewSchema.safeParse(body);if(!parsed.success)return json({error:'Décision invalide'},400);
  return json(await checked(db.rpc('review_signal',{p_signal_id:id,p_decision:parsed.data.decision,p_reason:parsed.data.reason??null})));
 }
 const prospect=await checked(db.from('prospects').select('id,name,website,city,project_id,organization_id').eq('id',id).single());
 const now=deps.now();
 if(action==='signals'&&method==='GET'){
  const rows=await checked(db.from('signals').select(SIGNAL_COLUMNS).eq('prospect_id',id).order('observed_at',{ascending:false}).limit(200));
  const profile=await profileOf(db,prospect.project_id);
  return json({signals:rows,intent:scoreIntent(rows.map(toIntentSignal),profile,now),profile});
 }
 if(action==='signals'&&method==='POST'){
  const parsed=ManualSchema.safeParse(body);if(!parsed.success)return json({error:'Signal invalide : type, extrait et URL HTTP(S) requis.'},400);
  const b=parsed.data;const profile=await profileOf(db,prospect.project_id);
  // A link to any page the user read, a LinkedIn post included: it is stored as the user's source, never fetched.
  const checkedItem=toCandidate('user_provided',{signal_type:b.signal_type,title:b.title??b.excerpt.slice(0,120),excerpt:b.excerpt,source_url:b.source_url,source_type:'user_provided',
   event_date:b.event_date??null,published_at:b.published_at??null,metadata:{entered_by:'user'}},profile?.terms??[],now);
  if(!checkedItem.ok)return json({error:checkedItem.code==='FUTURE_DATE'?'Date future refusée.':'Signal invalide : type, extrait et URL HTTP(S) requis.',code:checkedItem.code},400);
  const r=await repoOf(db).saveSignals(id,null,[checkedItem.candidate]);
  return json({...r,duplicate:r.inserted===0},r.inserted?201:200);
 }
 if(action==='signal-scan'&&method==='POST'){
  await deps.requireEntitlement();
  if(!prospect.website)return refusal(json,'NO_OFFICIAL_WEBSITE');
  const profile=await profileOf(db,prospect.project_id);
  const target:SignalTarget={prospect_id:prospect.id,name:prospect.name,website:prospect.website,siren:null,city:prospect.city||null};
  const accepted:AcceptedDiscoveryResult[]=await checked(db.from('discovery_results').select('status,provider,source_class,website,source_url,raw_payload').eq('prospect_id',id).eq('status','accepted'));
  const fixture=accepted.length>0&&accepted.every(r=>r.provider==='fixture');
  const consume=async()=>{await checked(db.rpc('consume_analysis_quota',{p_prospect_id:id}))};
  const scan=(providers:SignalProvider[])=>runSignalScan({targets:[target],providers,profile,budget:{maxRequests:1,deadlineMs:45000},now,runId:null,repo:repoOf(db)});
  // A fixture prospect never touches the network: TEST signals, clearly marked.
  if(fixture){await consume();const {report}=await scan([new FixtureSignalProvider()]);return json({report,pages:0})}
  const auth=resolveAnalysisAuthorization({prospectWebsite:prospect.website,acceptedResults:accepted,staticAllowlist:deps.staticAllowlist,dynamicEnabled:deps.dynamicEnabled});
  const audit=deps.audit();
  if(!auth.ok){if(audit){try{await audit.record({userId:deps.userId,prospectId:id,host:null,mode:null,outcome:auth.code})}catch{/* best-effort */}}return refusal(json,auth.code)}
  // No audit writer, no fetch.
  if(!audit)return refusal(json,'CONFIGURATION_REQUIRED');
  // Same rule as the analysis audit: only a plain host name is ever written (never an address or an odd string).
  const auditId=await audit.record({userId:deps.userId,prospectId:id,host:/^[a-z0-9.-]{1,253}$/.test(auth.host)?auth.host:null,mode:auth.mode,outcome:'STARTED'});
  const close=async(outcome:'ANALYZED'|'ANALYSIS_FAILED'|'ROBOTS_DENIED'|'QUOTA_EXCEEDED',pages:number|null,failed:number|null)=>{try{await audit.complete(auditId,deps.userId,outcome,pages,failed)}catch{/* best-effort */}};
  try{await consume()}catch(error){await close('QUOTA_EXCEEDED',null,null);throw error}
  const site=new OfficialSiteSignalProvider(deps.sitePageFetcher(auth.fetchPolicy),auth.url);
  let report:ScanReport;
  try{({report}=await scan([site]))}catch(error){await close('ANALYSIS_FAILED',null,null);try{await deps.refundAnalysis()}catch{/* best-effort */}throw error}
  if(site.lastError){
   // The home page could not be read: nothing was learned, the plan unit is given back.
   const cause=site.lastError instanceof Error?site.lastError.message:String(site.lastError);
   const code=analysisFailureCode(cause);
   await close(code==='ROBOTS_DENIED'?'ROBOTS_DENIED':'ANALYSIS_FAILED',0,null);
   try{await deps.refundAnalysis()}catch{/* best-effort */}
   return refusal(json,code);
  }
  await close('ANALYZED',site.lastReport.pages,site.lastReport.failed_pages);
  return json({report,pages:site.lastReport.pages});
 }
 return null;
}
