// Signaux SIRENE — HTTP routes. Thin: feature flag → validation → entitlement (runs and live Google reads) → service or
// the migration-038 functions. Every rule lives in the database (membership, quota, transitions) and in the modules.
//
//  GET  /registry-signal-presets                       the configured presets (with their NAF ambiguities)
//  POST /projects/:id/registry-signals                 {preset, postal_code, max_results?} run a search (1 Discovery unit)
//  GET  /projects/:id/registry-signals                 the project's runs, newest first
//  GET  /registry-signal-runs/:id/candidates           its candidates (stored form: register data, place ID, match)
//  GET  /registry-signal-candidates/:id/google         the confirmed place's details, read live from Google (never stored)
//  POST /registry-signal-candidates/:id/ignore         NEW → IGNORED
//  POST /registry-signal-candidates/:id/add            {name?} or {prospect_id}: NEW → ADDED (a person's decision)
//
// REGISTRY_SIGNALS_ENABLED absent or anything but "true"/"1": every route answers 404 — no run, no unit, no read.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {loadPresets} from './presets.ts';
import {MAX_RESULTS_CEILING,runAndStoreRegistrySignals} from './service.ts';
import {SupabaseRegistrySignalsRepository,SupabaseResponseCache} from './repository.ts';
import {MemoryCache,NO_CACHE} from './cache.ts';
import {RateLimiter} from './limiter.ts';
import {placeDetails,PLACE_ID} from './places.ts';
import type {RegistrySignalsConfig} from './config.ts';

export const NOT_AVAILABLE={error:'Route ou action non disponible'};
export function isRegistrySignalsPath(path:readonly string[]):boolean{
 const [resource,,action]=path;
 return resource==='registry-signal-presets'||resource==='registry-signal-runs'||resource==='registry-signal-candidates'||(resource==='projects'&&action==='registry-signals');
}
// Google content stays in this process's memory only (cache.ts); one cache for every request the instance serves.
const PLACES_MEMORY=new MemoryCache();

type Json=(value:unknown,status?:number)=>Response;
export type RegistrySignalsDeps={config:RegistrySignalsConfig;userId:string;now:()=>Date;requireEntitlement:()=>Promise<void>;
 // The server's privileged client (service role); throws when the server is not configured.
 writer:()=>SupabaseClient;fetch?:typeof fetch;env?:Record<string,string|undefined>;log?:(line:Record<string,unknown>)=>void};
const uuid=z.string().uuid();
const RunSchema=z.object({preset:z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),postal_code:z.string().regex(/^\d{5}$/),
 max_results:z.number().int().min(1).max(MAX_RESULTS_CEILING).default(20)}).strict();
const AddSchema=z.object({name:z.string().trim().min(1).max(200).optional(),prospect_id:uuid.optional()}).strict()
 .refine(b=>!(b.name&&b.prospect_id),{message:'prospect_id excludes name'});
const CANDIDATE_COLUMNS='id,run_id,project_id,status,siren,siret,denomination,enseignes,activite_principale,date_creation,date_creation_entreprise,adresse,code_postal,commune,'+
 'metier_probable,google_place_id,google_match_status,google_match_reason,sources,confidence,detected_at,prospect_id,decided_at,created_at';

const REFUSALS:Record<string,[string,number]>={
 FEATURE_DISABLED:['Route ou action non disponible',404],
 INVALID_REQUEST:['Requête invalide.',400],
 UNKNOWN_PRESET:['Preset inconnu : consultez la liste des presets disponibles.',400],
 REGISTRY_PRESETS_INVALID:['Configuration des presets invalide côté serveur.',503],
 PLAN_LIMIT_REACHED:['Limite de votre offre atteinte pour la période en cours. Consultez votre utilisation dans Compte.',429],
 QUOTA_EXCEEDED:['Quota horaire de votre organisation atteint.',429],
 ENTITLEMENT_REQUIRED:['Un accès actif est nécessaire : choisissez une offre pour continuer.',403],
 BETA_ACCESS_EXPIRED:['Votre accès a expiré : vos données restent consultables. Choisissez une offre pour continuer.',402],
 PLACES_NOT_CONFIGURED:['Recherche indisponible : la clé Google Places n’est pas configurée.',503],
 CONFIGURATION_REQUIRED:['Recherche indisponible : configuration serveur incomplète.',503],
 SIRENE_UNAVAILABLE:['Le registre des entreprises n’a répondu à aucune requête. Rien n’est décompté.',502],
 PERSISTENCE_FAILED:['La recherche a abouti mais ses résultats n’ont pas pu être enregistrés.',500],
 RUN_CLOSE_FAILED:['La recherche n’a pas pu être clôturée correctement.',500],
 CANDIDATE_IGNORED:['Ce signal a été ignoré : il ne peut plus être ajouté.',409],
 CANDIDATE_ALREADY_ADDED:['Ce signal est déjà ajouté au projet.',409],
 CANDIDATE_NOT_FOUND:['Signal introuvable.',404],
 PROSPECT_NOT_FOUND:['Prospect introuvable dans ce projet.',404],
 NO_CONFIRMED_PLACE:['Aucune fiche Google confirmée pour ce signal.',404],
 PLACES_UNAVAILABLE:['Google Places est momentanément indisponible. Réessayez dans un instant.',502],
 DATABASE_REQUEST_FAILED:['Opération refusée : vérifiez vos droits et l’état du signal.',400],
};
const refuse=(json:Json,code:string)=>{const [error,status]=REFUSALS[code]??REFUSALS.INVALID_REQUEST!;return json({error,code:code in REFUSALS?code:'INVALID_REQUEST'},status)};
async function rpc(query:PromiseLike<any>){
 const {data,error}=await query;
 if(error){
  const msg=String(error.message??'');
  for(const code of ['CANDIDATE_IGNORED','CANDIDATE_ALREADY_ADDED'])if(msg.includes(code))throw Error(code);
  if(msg.includes('Prospect not found'))throw Error('PROSPECT_NOT_FOUND');
  if(msg.includes('candidate not found'))throw Error('CANDIDATE_NOT_FOUND');
  return checked(Promise.resolve({data,error}));
 }
 return data;
}
const limiter=(c:RegistrySignalsConfig,minIntervalMs:number)=>new RateLimiter({minIntervalMs,maxRetries:c.maxRetries,backoffBaseMs:c.backoffBaseMs,backoffMaxMs:c.backoffMaxMs});

export async function handleRegistrySignals(request:Request,path:string[],body:unknown,db:SupabaseClient,json:Json,deps:RegistrySignalsDeps):Promise<Response|null>{
 if(!isRegistrySignalsPath(path))return null;
 const c=deps.config;if(!c.enabled)return json(NOT_AVAILABLE,404);
 const [resource,id,action]=path;const method=request.method;
 try{
  if(resource==='registry-signal-presets'&&method==='GET'&&!id){
   const presets=loadPresets(deps.env);
   return json(Object.values(presets).map(p=>({key:p.key,label:p.label,max_age_days:p.max_age_days,naf_codes:p.naf_codes,ambiguities:p.ambiguities})));
  }
  if(resource==='projects'&&action==='registry-signals'&&method==='POST'){
   const projectId=uuid.parse(id);const input=RunSchema.parse(body);
   const preset=loadPresets(deps.env)[input.preset];if(!preset)return refuse(json,'UNKNOWN_PRESET');
   await deps.requireEntitlement();
   // Configuration first: a server without its Google key or its privileged client refuses before any unit is consumed.
   if(!c.placesApiKey)return refuse(json,'PLACES_NOT_CONFIGURED');
   let writer:SupabaseClient;try{writer=deps.writer()}catch{return refuse(json,'CONFIGURATION_REQUIRED')}
   const result=await runAndStoreRegistrySignals({preset,postalCode:input.postal_code,maxResults:input.max_results,now:deps.now(),projectId},{
    repo:new SupabaseRegistrySignalsRepository(db,writer,deps.userId),log:deps.log,
    sirene:{limiter:limiter(c,c.sireneMinIntervalMs),cache:c.sireneCacheTtlS>0?new SupabaseResponseCache(writer,deps.now,deps.log):NO_CACHE,ttlSeconds:c.sireneCacheTtlS,fetch:deps.fetch},
    places:{apiKey:c.placesApiKey,limiter:limiter(c,c.placesMinIntervalMs),cache:c.placesCacheTtlS>0?PLACES_MEMORY:NO_CACHE,ttlSeconds:c.placesCacheTtlS,fetch:deps.fetch},
   });
   if(result.status==='failed'){
    const known=REFUSALS[result.error_code??''];
    return json({...result,error:known?.[0]??'La recherche a échoué.',code:result.error_code},known?.[1]??502);
   }
   return json(result,201);
  }
  if(resource==='projects'&&action==='registry-signals'&&method==='GET'){
   const projectId=uuid.parse(id);
   return json(await checked(db.from('registry_signal_runs').select('id,project_id,preset,postal_code,max_results,status,metrics,error_code,created_at,completed_at')
    .eq('project_id',projectId).order('created_at',{ascending:false}).limit(50)));
  }
  if(resource==='registry-signal-runs'&&action==='candidates'&&method==='GET'){
   const runId=uuid.parse(id);
   return json(await checked(db.from('registry_signal_candidates').select(CANDIDATE_COLUMNS).eq('run_id',runId).order('date_creation',{ascending:false}).limit(100)));
  }
  if(resource==='registry-signal-candidates'&&action==='google'&&method==='GET'){
   const candidateId=uuid.parse(id);
   const row=await checked(db.from('registry_signal_candidates').select('id,google_place_id,google_match_status').eq('id',candidateId).maybeSingle());
   if(!row)return refuse(json,'CANDIDATE_NOT_FOUND');
   if(row.google_match_status!=='confirme'||!PLACE_ID.test(row.google_place_id??''))return refuse(json,'NO_CONFIRMED_PLACE');
   await deps.requireEntitlement();
   if(!c.placesApiKey)return refuse(json,'PLACES_NOT_CONFIGURED');
   try{
    const p=await placeDetails(row.google_place_id,{apiKey:c.placesApiKey,limiter:limiter(c,c.placesMinIntervalMs),cache:c.placesCacheTtlS>0?PLACES_MEMORY:NO_CACHE,ttlSeconds:c.placesCacheTtlS,fetch:deps.fetch});
    return json({place_id:p.id,note:p.rating,nb_avis:p.ratingCount,site:p.website,horaires:p.openingHours,fiche:p.mapsUrl,source:p.mapsUrl,confiance:'verifie',lu_le:deps.now().toISOString()});
   }catch(e){deps.log?.({component:'registry_signals',event:'place_details_failed',code:e instanceof Error?e.message:'UNKNOWN'});return refuse(json,'PLACES_UNAVAILABLE')}
  }
  if(resource==='registry-signal-candidates'&&method==='POST'){
   const candidateId=uuid.parse(id);
   if(action==='ignore'){z.object({}).strict().parse(body??{});return json(await rpc(db.rpc('ignore_registry_signal_candidate',{p_candidate_id:candidateId})))}
   if(action==='add'){
    const b=AddSchema.parse(body??{});
    return json(await rpc(db.rpc('add_registry_signal_candidate_to_project',{p_candidate_id:candidateId,p_name:b.name??null,p_existing_prospect_id:b.prospect_id??null})),201);
   }
  }
  return json(NOT_AVAILABLE,404);
 }catch(e){
  if(e instanceof z.ZodError)return refuse(json,'INVALID_REQUEST');
  const code=e instanceof Error?e.message:'';
  return refuse(json,code in REFUSALS?code:'DATABASE_REQUEST_FAILED');
 }
}
