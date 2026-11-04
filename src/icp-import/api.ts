// ICP import, step 2A — the API (docs/ICP_IMPORT.md). Mounted in app/api/v1/[...path]/route.ts BEFORE the generic JSON
// body read (capped at 20 000 characters): a file arrives as the raw request body (never base64 in JSON), pasted text as
// a small JSON object, each read here with its own byte limit.
//
//   POST /api/v1/icp-imports/file?project_id=…   raw bytes (PDF or DOCX, ≤ 4 MiB), file name in X-File-Name (label only)
//   POST /api/v1/icp-imports/text                {project_id, text ≤ 50 000 characters}
//   GET  /api/v1/icp-imports?project_id=…        the project's last imports (RLS: members only)
//   GET  /api/v1/icp-imports/:id                 one import, its draft re-validated on every read (stale PENDING = FAILED)
//   POST /api/v1/icp-imports/:id/validate        {profile, keep_offer, keep_criteria} — a person's click (step 2B)
//   POST /api/v1/icp-imports/:id/discard         reject the draft
//   POST /api/v1/icp-imports/:id/retry           the source again (raw file or {text}) → a new import of the project;
//                                                 the previous draft is rejected only once the new one is EXTRACTED
//   DELETE /api/v1/icp-imports/:id               erase it, whatever its status but a running one
// Every route runs under the signed-in user's identity (RLS and the SECURITY DEFINER functions check membership).
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
import {parseIcpProfile,type IcpProfile} from '../domain/icp/schema.ts';
import {projectCriteria,projectOffer} from '../domain/icp/projection.ts';
import {fixWarnings,type Fix} from '../domain/icp/normalize.ts';
import {isStale} from './lock.ts';
import type {Criterion} from '../domain/core.ts';

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
 IMPORT_STALE:['Cet import ne s’est pas terminé. Relancez-le : votre fichier ou votre texte n’a pas été conservé, il faudra le fournir à nouveau.',409],
 IMPORT_NOT_REVIEWABLE:['Cet import n’est plus un brouillon à valider.',409],
 INVALID_PROFILE:['Le profil envoyé n’est pas valide. Rechargez l’import et réessayez.',400],
 INVALID_CRITERIA:['Les critères projetés ne sont pas valides (poids total 100 requis).',400],
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
export function importWarnings(ingested:Ingested,profile:IcpProfile|null,dropped:readonly string[],attempts:number,unverified:readonly string[]=[],fixes:readonly Fix[]=[]):string[]{
 const w:string[]=[...ingested.warnings];
 if(dropped.length>unverified.length)w.push('UNSOURCED_VALUES_DROPPED');
 if(unverified.length)w.push('UNVERIFIED_SOURCES_DROPPED');
 if(attempts>1)w.push('RETRIED_AFTER_VALIDATION');
 if(profile?.signals.some(s=>(UNMONITORED_SIGNALS as readonly string[]).includes(s.type.value??'')))w.push('SIGNAL_NOT_MONITORED');
 // Then the normalisation's corrections, one entry per code with its paths (never a value).
 const base=[...new Set(w)].slice(0,10);
 return [...base,...fixWarnings(fixes,10-base.length)];
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
  const {profile,dropped,unverified=[],fixes=[],usage}=await deps.structure(ingested.text,{apiKeyOverride,deadline:started+ROUTE_BUDGET_MS,now:deps.now});
  const missing=missingQuestions(profile,dropped);
  const warnings=importWarnings(ingested,profile,dropped,usage.attempts.length,unverified,fixes);
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
  deps.log({component:'icp_import',event:'failed',import_id:importId,code,provider_called:true,attempts:usage?.attempts.length??0,tokens:usage?.total_tokens??0,input_tokens:usage?.input_tokens??0,output_tokens:usage?.output_tokens??0});
  return refuse(json,code);
 }
}

// A PENDING row older than the lock is a dead run (the route stops at 60 s): every read reports it FAILED, with a message
// that offers to start again — the next start records it so in the database.
function readRow<T extends Record<string,unknown>>(row:T,now:number):T{
 if(isStale(row,now))return {...row,status:'FAILED',error:'IMPORT_STALE',stale:true};
 return row;
}
async function readJson(request:Request,max:number):Promise<Record<string,unknown>|null>{
 try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(request,max)));return v&&typeof v==='object'&&!Array.isArray(v)?v:null}
 catch(e){if(e instanceof IngestError&&e.code==='FILE_TOO_LARGE')throw e;return null}
}
// The source of a creation or a retry: raw bytes (a file) or a small JSON object (pasted text).
async function readSource(request:Request,kind:'file'|'text',projectFromUrl:string|null):Promise<{projectId:string;ingested:Ingested;label:string}|string>{
 if(kind==='file'){
  const bytes=await readBoundedBody(request,MAX_UPLOAD_BYTES);
  const ingested=await ingestFile(bytes);
  return {projectId:projectFromUrl??'',ingested,label:sourceLabel(request.headers.get('x-file-name'),ingested.sourceType)};
 }
 let body:Record<string,unknown>|null;
 try{body=await readJson(request,TEXT_BODY_MAX_BYTES)}catch{return 'TEXT_TOO_LONG'}
 if(!body)return 'INVALID_BODY';
 const projectId=projectFromUrl??(typeof body.project_id==='string'?body.project_id:'');
 return {projectId,ingested:ingestText(body.text),label:sourceLabel(null,'TEXT')};
}
function rpcRefusal(message:string|undefined):string{
 const m=message??'';
 if(m.includes('icp_import_in_progress'))return 'ICP_IMPORT_IN_PROGRESS';
 if(m.includes('icp_import_not_reviewable'))return 'IMPORT_NOT_REVIEWABLE';
 if(m.includes('Import not found')||m.includes('member'))return 'IMPORT_NOT_FOUND';
 if(m.includes('Invalid profile'))return 'INVALID_PROFILE';
 if(m.includes('weights sum to 100')||m.includes('Invalid criteria'))return 'INVALID_CRITERIA';
 if(m.includes('Authentication'))return 'UNAUTHORIZED';
 return 'DATABASE_REQUEST_FAILED';
}
export const VALIDATE_BODY_MAX_BYTES=150_000; // a profile is at most 100 KB (migration 041)

export async function handleIcpImport(request:Request,path:string[],db:SupabaseClient,json:Json,deps:IcpImportDeps):Promise<Response|null>{
 const [resource,sub,action]=path;
 if(resource!=='icp-imports')return null;
 const started=deps.now();
 const url=new URL(request.url);
 const notFound=()=>json({error:'Route ou action non disponible'},404);
 if(path.length>3)return notFound();
 const loadRow=async(id:string,columns=LIST_COLUMNS)=>{
  const {data,error}=await db.from('icp_imports').select(columns).eq('id',id).maybeSingle();
  if(error)throw Error('DATABASE_REQUEST_FAILED');
  return data as Record<string,unknown>|null;
 };
 const guarded=async(run:()=>Promise<Response>)=>{
  try{return await run()}
  catch(e){
   if(e instanceof IngestError){deps.log({component:'icp_import',event:'ingest_refused',code:e.code});return refuse(json,e.code)}
   const code=e instanceof Error?e.message:'';
   if(code in IMPORT_ERRORS)return refuse(json,code);
   throw e; // OFFER_LIMIT_REACHED, QUOTA_EXCEEDED, UNAUTHORIZED… : the route's common refusals
  }
 };
 if(request.method==='GET'){
  if(!sub){
   const projectId=url.searchParams.get('project_id')??'';
   if(!UUID.test(projectId))return refuse(json,'INVALID_PROJECT_ID');
   const {data,error}=await db.from('icp_imports').select(LIST_COLUMNS).eq('project_id',projectId).order('created_at',{ascending:false}).limit(20);
   if(error)throw Error('DATABASE_REQUEST_FAILED');
   return json(((data??[]) as Record<string,unknown>[]).map(r=>readRow(r,deps.now())));
  }
  if(!UUID.test(sub)||action)return refuse(json,'IMPORT_NOT_FOUND');
  const data=await loadRow(sub,`${LIST_COLUMNS},extracted`);
  if(!data)return refuse(json,'IMPORT_NOT_FOUND');
  const {extracted,...rest}=data;const row=readRow(rest,deps.now());
  // Every read re-validates the draft: the database only checks its outline.
  const stored=readStoredProfile(extracted);
  return json({import:row,profile:stored.state==='valid'?stored.profile:null,profile_state:stored.state,
   ...(stored.state==='unreadable'?{profile_message:UNREADABLE_PROFILE_MESSAGE.fr}:{}),
   ...(row.stale?{message:IMPORT_ERRORS.IMPORT_STALE![0]}:{}),unmonitored_signals:UNMONITORED_SIGNALS});
 }
 // ----- creation: POST /icp-imports/file | /icp-imports/text
 if(request.method==='POST'&&(sub==='file'||sub==='text')&&!action){
  await deps.requireEntitlement();
  return guarded(async()=>{
   const src=await readSource(request,sub,sub==='file'?url.searchParams.get('project_id')??'':null);
   if(typeof src==='string')return refuse(json,src);
   if(!UUID.test(src.projectId))return refuse(json,'INVALID_PROJECT_ID');
   return createImport(db,json,deps,src.projectId,src.ingested,src.label,started);
  });
 }
 if(!sub||!UUID.test(sub))return notFound();
 const id=sub;
 // ----- erasure: DELETE /icp-imports/:id (any status but a running import; the validated ICP stays)
 if(request.method==='DELETE'&&!action){
  const {error}=await db.rpc('delete_icp_import',{p_import_id:id});
  if(error)return refuse(json,rpcRefusal(error.message));
  deps.log({component:'icp_import',event:'erased',import_id:id});
  return json({deleted:true});
 }
 if(request.method!=='POST'||!action)return notFound();
 // ----- reject: POST /icp-imports/:id/discard
 if(action==='discard'){
  const {data,error}=await db.rpc('discard_icp_import',{p_import_id:id});
  if(error)return refuse(json,rpcRefusal(error.message));
  return json({discarded:data===true});
 }
 // ----- validate: POST /icp-imports/:id/validate {profile, keep_offer, keep_criteria} — a person's click, nothing else
 if(action==='validate'){
  return guarded(async()=>{
   let body:Record<string,unknown>|null;
   try{body=await readJson(request,VALIDATE_BODY_MAX_BYTES)}catch{return refuse(json,'INVALID_PROFILE')}
   if(!body||typeof body.keep_offer!=='boolean'||typeof body.keep_criteria!=='boolean')return refuse(json,'INVALID_BODY');
   const parsed=parseIcpProfile(body.profile);
   if(!parsed.ok)return json({error:IMPORT_ERRORS.INVALID_PROFILE![0],code:'INVALID_PROFILE',issues:parsed.issues},400);
   const row=await loadRow(id);
   if(!row)return refuse(json,'IMPORT_NOT_FOUND');
   if(readRow(row,deps.now()).status!=='EXTRACTED')return refuse(json,'IMPORT_NOT_REVIEWABLE');
   const {data:icp,error:icpError}=await db.from('icps').select('criteria,projected_criteria').eq('project_id',row.project_id as string).maybeSingle();
   if(icpError)throw Error('DATABASE_REQUEST_FAILED');
   const current=icp as {criteria?:Criterion[]|null;projected_criteria?:Criterion[]|null}|null;
   const offer=body.keep_offer?null:projectOffer(parsed.profile)||null;
   const projection=body.keep_criteria?null:projectCriteria(parsed.profile,current?.criteria,current?.projected_criteria);
   const {data,error}=await db.rpc('validate_icp_import',{p_import_id:id,p_profile:parsed.profile,p_offer:offer,p_criteria:projection?.criteria??null});
   if(error)return refuse(json,rpcRefusal(error.message));
   deps.log({component:'icp_import',event:'validated',import_id:id,offer_written:offer!==null,criteria_changed:projection?.changed??[],criteria_kept:projection?.kept??[]});
   return json({...(data as object),offer,criteria:projection?.criteria??null,criteria_changed:projection?.changed??[],criteria_kept:projection?.kept??[]});
  });
 }
 // ----- retry: POST /icp-imports/:id/retry with the source again (files and texts are never kept) — a new import of the
 // same project; the previous one, if it can still be rejected, is rejected once the new import is EXTRACTED.
 if(action==='retry'){
  await deps.requireEntitlement();
  return guarded(async()=>{
   const row=await loadRow(id);
   if(!row)return refuse(json,'IMPORT_NOT_FOUND');
   const prev=readRow(row,deps.now());
   if(prev.status==='PENDING')return refuse(json,'ICP_IMPORT_IN_PROGRESS');
   const kind=(request.headers.get('content-type')??'').includes('application/json')?'text':'file';
   const src=await readSource(request,kind,row.project_id as string);
   if(typeof src==='string')return refuse(json,src);
   // The previous import is rejected only once the new one is EXTRACTED (201): a retry that is refused, fails or cannot
   // be recorded leaves the previous draft as it was — still readable, still reviewable.
   const res=await createImport(db,json,deps,src.projectId,src.ingested,src.label,started);
   if(res.status===201&&(prev.status==='EXTRACTED'||(prev.status==='FAILED'&&!prev.stale)))await Promise.resolve(db.rpc('discard_icp_import',{p_import_id:id})).catch(()=>{});
   return res;
  });
 }
 return notFound();
}
