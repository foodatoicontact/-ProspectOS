// Signaux SIRENE — the ONE row format save_registry_signal_candidates accepts (migration 038, strict field list), and
// the repository contract the service uses. No dependency: the service and its tests never load the database client.
import type {RegistrySignal} from './signal.ts';

export const CANDIDATE_ROW_FIELDS=['siren','siret','denomination','enseignes','activite_principale','date_creation','date_creation_entreprise','adresse','code_postal',
 'commune','metier_probable','google_place_id','google_match_status','google_match_reason','sources','confidence','detected_at'] as const;
export type CandidateRow=Record<typeof CANDIDATE_ROW_FIELDS[number],unknown>;
export type StartedRun={id:string;organization_id:string;project_id:string};

// The ONE mapping from a stored signal (signal.ts, toStoredSignal) to the row save_registry_signal_candidates accepts.
export function toCandidateRow(s:RegistrySignal):CandidateRow{
 return {siren:s.siren,siret:s.siret,denomination:s.denomination,enseignes:s.enseignes.slice(0,10),activite_principale:s.activite_principale,date_creation:s.date_creation,
  date_creation_entreprise:s.date_creation_entreprise,adresse:s.adresse,code_postal:s.code_postal,commune:s.commune,metier_probable:s.metier_probable,
  google_place_id:s.google.statut_match==='confirme'?s.google.place_id:null,google_match_status:s.google.statut_match,google_match_reason:s.google.raison_match,
  sources:s.sources,confidence:s.confiance,detected_at:s.detecte_le};
}

export interface RegistrySignalsRepository{
 start(projectId:string,preset:string,postalCode:string,maxResults:number):Promise<StartedRun>;
 saveCandidates(runId:string,rows:CandidateRow[]):Promise<{inserted:number;duplicates:number}>;
 complete(runId:string,status:'completed'|'failed',metrics:Record<string,unknown>,errorCode:string|null):Promise<boolean>;
 release(runId:string):Promise<boolean>;
}
