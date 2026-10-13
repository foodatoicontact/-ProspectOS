// Signal-first Discovery V1 — HTTP routes. Thin: feature flag → validation → entitlement (runs only) → service or the
// migration-030 functions. Every rule lives in the database (membership, quota, transitions, PENDING_REVIEW) and in
// the P1 modules; nothing here decides an event, an entity, a status or a score.
//
//  POST /projects/:id/signal-discovery              run a search (1 Discovery unit; refunded only if the source answered nothing)
//  GET  /projects/:id/signal-discovery              the project's runs, newest first
//  GET  /signal-discovery-runs/:id                  one run
//  GET  /signal-discovery-runs/:id/candidates       its candidates, in review order (OUT of ICP last)
//  POST /signal-discovery-candidates/:id/ignore     NEW → IGNORED
//  POST /signal-discovery-candidates/:id/add        {name?, website?} or {prospect_id}: prospect + one PENDING_REVIEW signal
//
// SIGNAL_DISCOVERY_ENABLED absent or anything but "true"/"1": every route answers 404 — no run, no unit, no read.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {runSignalDiscovery,type SignalDiscoveryResult} from './service.ts';
import {SupabaseSignalDiscoveryRepository} from './repository.ts';
import type {SignalSearchProvider} from './provider.ts';
import {SIGNAL_DISCOVERY_TYPES,MAX_RESULTS_CEILING} from './plan.ts';

export function signalDiscoveryEnabled(env:Record<string,string|undefined>):boolean{
 const v=(env.SIGNAL_DISCOVERY_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
export function isSignalDiscoveryPath(path:readonly string[]):boolean{
 const [resource,,action]=path;
 return resource==='signal-discovery-runs'||resource==='signal-discovery-candidates'||(resource==='projects'&&action==='signal-discovery');
}
export const NOT_AVAILABLE={error:'Route ou action non disponible'};

type Json=(value:unknown,status?:number)=>Response;
export type SignalDiscoveryDeps={
 enabled:boolean;userId:string;now:()=>Date;
 requireEntitlement:()=>Promise<void>;
 // The server's privileged client (service role); throws when the server is not configured.
 writer:()=>SupabaseClient;
 // The search source: 'brave' throws BRAVE_NOT_CONFIGURED without a key.
 provider:(id:'brave'|'fixture')=>SignalSearchProvider;
 meter:(run:{id:string;organization_id:string;project_id:string},requestCount:number)=>Promise<void>;
 log?:(line:Record<string,unknown>)=>void;
};
const uuid=z.string().uuid();
const term=z.string().trim().min(2).max(60);
const RunSchema=z.object({
 query:z.string().trim().min(2).max(250),
 location:z.string().trim().min(2).max(120),
 categories:z.array(term).max(8).default([]),
 signal_types:z.array(z.enum(SIGNAL_DISCOVERY_TYPES)).min(1).max(2).default([...SIGNAL_DISCOVERY_TYPES]),
 max_results:z.number().int().min(1).max(MAX_RESULTS_CEILING).default(20),
 provider:z.enum(['brave','fixture']).default('brave'),
}).strict();
const AddSchema=z.object({
 name:z.string().trim().min(1).max(200).optional(),
 website:z.string().trim().max(2048).regex(/^https?:\/\/[^\s/@]+(\/\S*)?$/).optional(),
 prospect_id:uuid.optional(),
}).strict().refine(b=>!b.prospect_id||(!b.name&&!b.website),{message:'prospect_id excludes name and website'});
const CANDIDATE_COLUMNS='id,run_id,project_id,status,entity_name,entity_name_status,entity_method,entity_confidence,entity_domain,entity_domain_status,signal_type,trigger_text,headline,excerpt,excerpt_truncated,excerpt_origin,source_url,source_domain,source_type,source_page_kind,hosting_platform,observed_on_page,published_at,event_date_text,event_year,event_month,event_day,event_month_from,event_month_to,event_granularity,event_tense,location_text,location_departments,location_basis,icp_match,icp_reasons,other_sources,review_tier,prospect_id,signal_id,decided_at,created_at';

// Refusals of the 030 functions and of the run itself: a stable code, a sentence, a status.
const REFUSALS:Record<string,[string,number]>={
 FEATURE_DISABLED:['Route ou action non disponible',404],
 INVALID_REQUEST:['Requête invalide.',400],
 PLAN_LIMIT_REACHED:['Limite de votre offre atteinte pour la période en cours. Consultez votre utilisation dans Compte.',429],
 QUOTA_EXCEEDED:['Quota horaire de votre organisation atteint.',429],
 MAX_RESULTS_EXCEEDED:['Le nombre demandé dépasse la limite configurée par l’opérateur.',400],
 ENTITLEMENT_REQUIRED:['Un accès actif est nécessaire : choisissez une offre pour continuer.',403],
 BETA_ACCESS_EXPIRED:['Votre accès a expiré : vos données restent consultables. Choisissez une offre pour continuer.',402],
 BRAVE_NOT_CONFIGURED:['Recherche indisponible : la source de recherche n’est pas configurée.',503],
 CONFIGURATION_REQUIRED:['Recherche indisponible : configuration serveur incomplète.',503],
 PROVIDER_UNAVAILABLE:['La source de recherche n’a répondu à aucune requête. Rien n’est décompté.',502],
 PERSISTENCE_FAILED:['La recherche a abouti mais ses résultats n’ont pas pu être enregistrés.',500],
 RUN_CLOSE_FAILED:['La recherche n’a pas pu être clôturée correctement.',500],
 ENTITY_NAME_REQUIRED:['Entreprise à confirmer : saisissez son nom avant de l’ajouter.',400],
 CANDIDATE_IGNORED:['Ce signal candidat a été ignoré : il ne peut plus être ajouté.',409],
 CANDIDATE_ALREADY_ADDED:['Ce signal candidat est déjà ajouté au projet.',409],
 PROSPECT_NOT_FOUND:['Prospect introuvable dans ce projet.',404],
 CANDIDATE_NOT_FOUND:['Signal candidat introuvable.',404],
 INVALID_WEBSITE:['Site invalide : une adresse http(s) est requise.',400],
 DATABASE_REQUEST_FAILED:['Opération refusée : vérifiez vos droits et l’état du signal candidat.',400],
};
const refuse=(json:Json,code:string)=>{const [error,status]=REFUSALS[code]??REFUSALS.INVALID_REQUEST!;return json({error,code:code in REFUSALS?code:'INVALID_REQUEST'},status)};
// The 030 functions' own refusal words, mapped before the shared Discovery mapping (plan, hourly limit, max results).
async function rpc(query:PromiseLike<any>){
 const {data,error}=await query;
 if(error){
  const msg=String(error.message??'');
  for(const code of ['ENTITY_NAME_REQUIRED','CANDIDATE_IGNORED','CANDIDATE_ALREADY_ADDED'])if(msg.includes(code))throw Error(code);
  if(msg.includes('Prospect not found'))throw Error('PROSPECT_NOT_FOUND');
  if(msg.includes('candidate not found'))throw Error('CANDIDATE_NOT_FOUND');
  if(msg.includes('Invalid website'))throw Error('INVALID_WEBSITE');
  return checked(Promise.resolve({data,error}));
 }
 return data;
}
const statusOf=(r:SignalDiscoveryResult)=>r.status==='completed'?201:(REFUSALS[r.error_code??'']?.[1]??500);

export async function handleSignalDiscovery(request:Request,path:string[],body:unknown,db:SupabaseClient,json:Json,deps:SignalDiscoveryDeps):Promise<Response|null>{
 if(!isSignalDiscoveryPath(path))return null;
 if(!deps.enabled)return json(NOT_AVAILABLE,404);
 const [resource,id,action]=path;const method=request.method;
 try{
  if(resource==='projects'&&action==='signal-discovery'&&method==='POST'){
   const project_id=uuid.parse(id);const input=RunSchema.parse(body);
   await deps.requireEntitlement();
   // Configuration first: a server without its key or its privileged client refuses before any unit is consumed.
   let writer:SupabaseClient;try{writer=deps.writer()}catch{return refuse(json,'CONFIGURATION_REQUIRED')}
   const provider=deps.provider(input.provider);
   const result=await runSignalDiscovery({project_id,query:input.query,location:input.location,categories:input.categories,signal_types:input.signal_types,max_results:input.max_results},{
    repo:new SupabaseSignalDiscoveryRepository(db,writer,deps.userId),provider,now:deps.now,log:deps.log,
    meter:provider.metered?deps.meter:undefined,
   });
   const out={...result,...(result.status==='failed'?{error:REFUSALS[result.error_code??'']?.[0]??'La recherche a échoué.',code:result.error_code}:{})};
   return json(out,statusOf(result));
  }
  if(resource==='projects'&&action==='signal-discovery'&&method==='GET'){
   const project_id=uuid.parse(id);
   return json(await checked(db.from('signal_discovery_runs').select('id,project_id,query,location,signal_types,provider,max_results,status,metrics,error_code,created_at,completed_at').eq('project_id',project_id).order('created_at',{ascending:false}).limit(50)));
  }
  if(resource==='signal-discovery-runs'&&method==='GET'){
   const run_id=uuid.parse(id);
   if(!action)return json(await checked(db.from('signal_discovery_runs').select('*').eq('id',run_id).single()));
   if(action==='candidates'){
    const rows=await checked(db.from('signal_discovery_candidates').select(CANDIDATE_COLUMNS).eq('run_id',run_id).order('review_tier').order('created_at').limit(200));
    const order=(m:string)=>m==='OUT'?2:m==='UNKNOWN'?1:0;
    return json([...rows].sort((a:any,b:any)=>order(a.icp_match)-order(b.icp_match)));
   }
  }
  if(resource==='signal-discovery-candidates'&&method==='POST'){
   const candidate_id=uuid.parse(id);
   if(action==='ignore'){z.object({}).strict().parse(body??{});return json(await rpc(db.rpc('ignore_signal_candidate',{p_candidate_id:candidate_id})))}
   if(action==='add'){
    const b=AddSchema.parse(body??{});
    return json(await rpc(db.rpc('add_signal_candidate_to_project',{p_candidate_id:candidate_id,p_name:b.name??null,p_website:b.website??null,p_existing_prospect_id:b.prospect_id??null})),201);
   }
  }
  return json(NOT_AVAILABLE,404);
 }catch(e){
  if(e instanceof z.ZodError)return refuse(json,'INVALID_REQUEST');
  const code=e instanceof Error?e.message:'';
  return refuse(json,code in REFUSALS?code:'DATABASE_REQUEST_FAILED');
 }
}
