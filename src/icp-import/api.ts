// ICP import, step 2A — the API (docs/ICP_IMPORT.md). Mounted in app/api/v1/[...path]/route.ts BEFORE the generic JSON
// body read (capped at 20 000 characters): a file arrives as the raw request body (never base64 in JSON), pasted text as
// a small JSON object, each read here with its own byte limit.
//
//   POST /api/v1/icp-imports/file?project_id=…   raw bytes (PDF or DOCX, ≤ 4 MiB), file name in X-File-Name (label only)
//   POST /api/v1/icp-imports/text                {project_id, text ≤ 50 000 characters}
//   GET  /api/v1/icp-imports?project_id=…        the project's last imports (RLS: members only)
//   GET  /api/v1/icp-imports/:id                 one import, its draft re-validated on every read
//
// Order of a creation, cheapest refusal first: entitlement → body and ingestion (no database, no quota: an unreadable
// file costs nothing) → start_icp_import (one unit of the AI offer quota, one import in progress per project) → BYOK →
// structureIcp (one retry at most, inside the same unit) → complete_icp_import (EXTRACTED or FAILED, the real token usage
// of every attempt) → metering of each billed attempt. The result is a DRAFT: nothing reads it until a person validates.
import type {SupabaseClient} from '@supabase/supabase-js';
import {IngestError,INGEST_MESSAGES,MAX_UPLOAD_BYTES,ingestFile,ingestText,readBoundedBody,sourceLabel,type Ingested} from './ingest.ts';
import {StructureIcpError,type IcpUsage,type structureIcp} from '../server/ai.ts';
import {missingQuestions,type MissingQuestion} from '../domain/icp/missing.ts';
import {readStoredProfile,UNREADABLE_PROFILE_MESSAGE} from '../domain/icp/stored.ts';
import type {IcpProfile} from '../domain/icp/schema.ts';

export const TEXT_BODY_MAX_BYTES=400_000; // 50 000 characters, UTF-8 and JSON escaping included, with margin
export const ROUTE_BUDGET_MS=55_000; // the route's maxDuration is 60 s
// Signals the profile may name but the product does not watch yet: kept in the draft, shown as such, never scored.
export const UNMONITORED_SIGNALS=['WORKS','CONTRACT_RENEWAL'] as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_COLUMNS='id,project_id,source_type,source_ref,status,missing_questions,warnings,error,token_usage,created_at,updated_at,validated_at';

type Json=(value:unknown,status?:number)=>Response;
type Credential={status:'NONE'}|{status:'INVALID'}|{status:'VALID';apiKey:string};
export interface IcpImportDeps{
 userId:string;
 now:()=>number;
 requireEntitlement:()=>Promise<unknown>;
 admin:()=>SupabaseClient; // complete_icp_import is granted to service_role only
 aiProvider:string|undefined;
 resolveCredential:(organizationId:string)=>Promise<Credential>;
 structure:typeof structureIcp;
 meter:(row:{organizationId:string;projectId:string;usage:IcpUsage;attempt:{input_tokens:number;output_tokens:number}})=>Promise<void>;
 release:()=>Promise<void>; // gives the quota unit back — only when no provider was ever called
 log:(line:Record<string,unknown>)=>void;
}

export const IMPORT_ERRORS:Record<string,[string,number]>={
 INVALID_PROJECT_ID:['Identifiant de projet invalide.',400],
 INVALID_BODY:['Requête invalide : envoyez un objet JSON { project_id, text }.',400],
 ICP_IMPORT_IN_PROGRESS:['Un import est déjà en cours pour ce projet. Patientez quelques secondes.',409],
 ICP_URL_DAILY_LIMIT:['Limite quotidienne d’imports de site atteinte pour votre organisation.',429],
 BYOK_CREDENTIAL_INVALID:['Clé Anthropic personnalisée invalide ou illisible. Remplacez-la dans Compte.',503],
 AI_NOT_CONFIGURED:['Fournisseur IA et modèle non configurés.',503],
 INVALID_PROVIDER_CREDENTIAL:['La clé du fournisseur IA est inutilisable.',503],
 AI_UNAVAILABLE:['Le fournisseur IA n’a pas pu traiter la demande. Réessayez dans un instant.',502],
 AI_TRUNCATED_RESULT:['La réponse IA a été interrompue avant d’être complète. Essayez avec un texte plus court.',502],
 AI_INVALID_RESULT:['La réponse IA n’a pas pu être validée. Rien n’a été enregistré dans votre profil ; réessayez ou collez un texte plus ciblé.',502],
 IMPORT_RECORD_FAILED:['L’extraction a abouti mais n’a pas pu être enregistrée. Réessayez.',500],
 IMPORT_NOT_FOUND:['Import introuvable.',404],
};
const INGEST_STATUS:Partial<Record<string,number>>={FILE_TOO_LARGE:413,UNSUPPORTED_FILE:415};

function refuse(json:Json,code:string):Response{
 const known=IMPORT_ERRORS[code];
 if(known)return json({error:known[0],code},known[1]);
 const ingest=INGEST_MESSAGES[code as keyof typeof INGEST_MESSAGES];
 if(ingest)return json({error:ingest,code},INGEST_STATUS[code]??422);
 return json({error:'Opération impossible. Vérifiez les données et vos droits.',code},400);
}

// Warning codes stored with the draft (≤ 10, short, enumerable — never document text).
export function importWarnings(ingested:Ingested,profile:IcpProfile|null,dropped:readonly string[],attempts:number):string[]{
 const w:string[]=[...ingested.warnings];
 if(dropped.length)w.push('UNSOURCED_VALUES_DROPPED');
 if(attempts>1)w.push('RETRIED_AFTER_VALIDATION');
 if(profile?.signals.some(s=>(UNMONITORED_SIGNALS as readonly string[]).includes(s.type.value??'')))w.push('SIGNAL_NOT_MONITORED');
 return [...new Set(w)].slice(0,10);
}

async function startImport(db:SupabaseClient,projectId:string,ingested:Ingested,label:string):Promise<string>{
 const {data,error}=await db.rpc('start_icp_import',{p_project_id:projectId,p_source_type:ingested.sourceType,p_source_ref:label});
 if(error){
  const m=error.message??'';
  if(m.includes('icp_import_in_progress'))throw Error('ICP_IMPORT_IN_PROGRESS');
  if(m.includes('icp_url_daily_limit'))throw Error('ICP_URL_DAILY_LIMIT');
  if(m.includes('offer_limit_reached'))throw Error('OFFER_LIMIT_REACHED');
  if(m.includes('plan_limit_reached'))throw Error('PLAN_LIMIT_REACHED');
  if(m.includes('quota_exceeded'))throw Error('QUOTA_EXCEEDED');
  throw Error('DATABASE_REQUEST_FAILED');
 }
 if(typeof data!=='string')throw Error('DATABASE_REQUEST_FAILED');
 return data;
}

async function createImport(db:SupabaseClient,json:Json,deps:IcpImportDeps,projectId:string,ingested:Ingested,label:string,started:number):Promise<Response>{
 const importId=await startImport(db,projectId,ingested,label);
 const {data:project,error:projectError}=await db.from('projects').select('organization_id').eq('id',projectId).single();
 let organizationId:string|null=projectError?null:(project as {organization_id:string}).organization_id;
 const complete=async(status:'EXTRACTED'|'FAILED',fields:{extracted?:IcpProfile|null;missing?:MissingQuestion[];warnings?:string[];usage?:IcpUsage|null;error?:string})=>{
  const {data,error}=await deps.admin().rpc('complete_icp_import',{p_import_id:importId,p_status:status,p_extracted:fields.extracted??null,
   p_missing:fields.missing??[],p_warnings:fields.warnings??[],p_token_usage:fields.usage?.total_tokens??0,p_usage:fields.usage??{},p_error:fields.error??null});
  if(error||data!==true){deps.log({component:'icp_import',event:'complete_failed',import_id:importId,status});return false}
  return true;
 };
 const meter=async(usage:IcpUsage|null)=>{
  if(!usage||!organizationId)return;
  for(const a of usage.attempts)if(a.input_tokens!==null&&a.output_tokens!==null){
   try{await deps.meter({organizationId,projectId,usage,attempt:{input_tokens:a.input_tokens,output_tokens:a.output_tokens}})}catch{/* the cost ledger is best-effort */}
  }
 };
 const failWithoutProvider=async(code:string)=>{
  await complete('FAILED',{error:code});
  try{await deps.release()}catch{/* best-effort: the unit stays spent */}
  deps.log({component:'icp_import',event:'failed',import_id:importId,code,provider_called:false});
  return refuse(json,code);
 };
 if(!organizationId)return failWithoutProvider('DATABASE_REQUEST_FAILED');
 let apiKeyOverride:string|null=null;
 if(deps.aiProvider==='anthropic'){
  const credential=await deps.resolveCredential(organizationId);
  if(credential.status==='INVALID')return failWithoutProvider('BYOK_CREDENTIAL_INVALID'); // fail closed, never the platform key
  if(credential.status==='VALID')apiKeyOverride=credential.apiKey;
 }
 try{
  const {profile,dropped,usage}=await deps.structure(ingested.text,{apiKeyOverride,deadline:started+ROUTE_BUDGET_MS,now:deps.now});
  const missing=missingQuestions(profile,dropped);
  const warnings=importWarnings(ingested,profile,dropped,usage.attempts.length);
  const recorded=await complete('EXTRACTED',{extracted:profile,missing,warnings,usage});
  await meter(usage);
  deps.log({component:'icp_import',event:'extracted',import_id:importId,source_type:ingested.sourceType,attempts:usage.attempts.length,tokens:usage.total_tokens,dropped:dropped.length,recorded});
  if(!recorded)return refuse(json,'IMPORT_RECORD_FAILED');
  return json({import:{id:importId,project_id:projectId,status:'EXTRACTED',source_type:ingested.sourceType,source_ref:label,missing_questions:missing,warnings,token_usage:usage.total_tokens},
   profile,unmonitored_signals:UNMONITORED_SIGNALS},201);
 }catch(error){
  const code=error instanceof StructureIcpError?error.code:'AI_UNAVAILABLE';
  const usage=error instanceof StructureIcpError?error.usage:null;
  if(error instanceof StructureIcpError&&!error.providerCalled)return failWithoutProvider(code);
  await complete('FAILED',{error:code,usage,warnings:[...ingested.warnings]});
  await meter(usage);
  deps.log({component:'icp_import',event:'failed',import_id:importId,code,provider_called:true,attempts:usage?.attempts.length??0,tokens:usage?.total_tokens??0});
  return refuse(json,code);
 }
}

export async function handleIcpImport(request:Request,path:string[],db:SupabaseClient,json:Json,deps:IcpImportDeps):Promise<Response|null>{
 const [resource,sub]=path;
 if(resource!=='icp-imports')return null;
 const started=deps.now();
 const url=new URL(request.url);
 if(request.method==='GET'){
  if(!sub){
   const projectId=url.searchParams.get('project_id')??'';
   if(!UUID.test(projectId))return refuse(json,'INVALID_PROJECT_ID');
   const {data,error}=await db.from('icp_imports').select(LIST_COLUMNS).eq('project_id',projectId).order('created_at',{ascending:false}).limit(20);
   if(error)throw Error('DATABASE_REQUEST_FAILED');
   return json(data??[]);
  }
  if(!UUID.test(sub)||path.length>2)return refuse(json,'IMPORT_NOT_FOUND');
  const {data,error}=await db.from('icp_imports').select(`${LIST_COLUMNS},extracted`).eq('id',sub).maybeSingle();
  if(error)throw Error('DATABASE_REQUEST_FAILED');
  if(!data)return refuse(json,'IMPORT_NOT_FOUND');
  const {extracted,...row}=data as Record<string,unknown>;
  // Every read re-validates the draft: the database only checks its outline.
  const stored=readStoredProfile(extracted);
  return json({import:row,profile:stored.state==='valid'?stored.profile:null,profile_state:stored.state,
   ...(stored.state==='unreadable'?{profile_message:UNREADABLE_PROFILE_MESSAGE.fr}:{}),unmonitored_signals:UNMONITORED_SIGNALS});
 }
 if(request.method!=='POST'||path.length!==2||(sub!=='file'&&sub!=='text'))return json({error:'Route ou action non disponible'},404);
 await deps.requireEntitlement();
 let projectId:string;let ingested:Ingested;let label:string;
 try{
  if(sub==='file'){
   projectId=url.searchParams.get('project_id')??'';
   if(!UUID.test(projectId))return refuse(json,'INVALID_PROJECT_ID');
   const bytes=await readBoundedBody(request,MAX_UPLOAD_BYTES);
   ingested=await ingestFile(bytes);
   label=sourceLabel(request.headers.get('x-file-name'),ingested.sourceType);
  }else{
   let body:unknown;
   try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(request,TEXT_BODY_MAX_BYTES)))}
   catch(e){if(e instanceof IngestError&&e.code==='FILE_TOO_LARGE')return refuse(json,'TEXT_TOO_LONG');return refuse(json,'INVALID_BODY')}
   if(!body||typeof body!=='object'||Array.isArray(body))return refuse(json,'INVALID_BODY');
   const b=body as {project_id?:unknown;text?:unknown};
   projectId=typeof b.project_id==='string'?b.project_id:'';
   if(!UUID.test(projectId))return refuse(json,'INVALID_PROJECT_ID');
   ingested=ingestText(b.text);
   label=sourceLabel(null,'TEXT');
  }
 }catch(e){
  if(e instanceof IngestError){deps.log({component:'icp_import',event:'ingest_refused',code:e.code});return refuse(json,e.code)}
  throw e;
 }
 try{return await createImport(db,json,deps,projectId,ingested,label,started)}
 catch(e){
  const code=e instanceof Error?e.message:'';
  if(code in IMPORT_ERRORS)return refuse(json,code);
  throw e; // OFFER_LIMIT_REACHED, QUOTA_EXCEEDED, … : the route's common refusals
 }
}
