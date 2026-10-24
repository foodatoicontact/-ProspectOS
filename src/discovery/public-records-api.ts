// POST /prospects/:id/registry — "Registres publics" (public-records.ts). Gated and metered like "Analyser le site":
// an active entitlement is required, one analysis unit is reserved once the company is identified, and released if
// the reading fails after that. The SIREN comes from the body (a person's choice among candidates), from an earlier
// identification, or from an exact unique name match; otherwise the candidates are the answer (identity_required)
// and nothing is consumed or saved. Plan and entitlement refusals are mapped by the router (COMMERCIAL_REFUSALS).
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SupabaseDiscoveryRepository,checked} from './repository.ts';
import {enrichFromPublicRecords,PublicRecordsError,SIREN,type PublicRecordsRepository} from './public-records.ts';
import {trackAnalysisReservation,releaseOnFailure} from '../server/commercial-usage.ts';

type Json=(data:unknown,status?:number)=>Response;
export type PublicRecordsDeps={requireEntitlement:()=>Promise<unknown>;release:()=>Promise<unknown>;fetch?:typeof fetch;log?:(e:Record<string,string|number|null>)=>void};
const REFUSALS:Record<string,[string,number]>={
 INVALID_SIREN:['Le SIREN doit comporter 9 chiffres.',400],
 COMPANY_NOT_FOUND:['Aucune entreprise ne porte ce SIREN dans le registre.',404],
 NOT_FOUND:['Registre public momentanément indisponible. Réessayez dans un instant.',503],
 PUBLIC_RECORDS_UNAVAILABLE:['Registre public momentanément indisponible. Réessayez dans un instant.',503],
};
const uuid=z.string().uuid();
const Body=z.object({siren:z.string().regex(SIREN).optional()}).strict();

export async function handlePublicRecords(request:Request,path:string[],body:unknown,db:SupabaseClient,json:Json,deps:PublicRecordsDeps):Promise<Response|null>{
 const [resource,id,action]=path;
 if(resource!=='prospects'||action!=='registry'||request.method!=='POST')return null;
 if(!uuid.safeParse(id).success)return json({error:'Identifiant invalide'},400);
 const parsed=Body.safeParse(body??{});if(!parsed.success)return json({error:'Le SIREN doit comporter 9 chiffres.',code:'INVALID_SIREN'},400);
 await deps.requireEntitlement();
 const repo=new SupabaseDiscoveryRepository(db);const tracked=trackAnalysisReservation(repo);
 const records:PublicRecordsRepository={
  prospectIdentity:async pid=>checked(db.from('prospects').select('id,project_id,name,city').eq('id',pid).single()),
  storedObservations:async pid=>checked(db.from('prospect_observations').select('observation_type,source_url').eq('prospect_id',pid).eq('observation_type','REGISTRY_IDENTITY')),
  projectCriteria:pid=>repo.projectCriteria(pid),consumeAnalysis:pid=>tracked.repo.consumeAnalysis(pid),saveObservations:(pid,o)=>repo.saveObservations(pid,o)};
 try{return json(await releaseOnFailure(()=>enrichFromPublicRecords({repo:records,prospectId:id,siren:parsed.data.siren??null,fetch:deps.fetch,log:deps.log}),tracked.reserved,deps.release))}
 catch(e){
  if(!(e instanceof PublicRecordsError))throw e;
  // Not a failure: the person chooses the company (nothing was consumed nor saved).
  if(e.message==='REGISTRY_IDENTITY_REQUIRED')return json({identity_required:true,candidates:e.candidates});
  const r=REFUSALS[e.message];if(r)return json({error:r[0],code:e.message},r[1]);throw e;
 }
}
