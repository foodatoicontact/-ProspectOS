import {z} from 'zod';
import {handleDiscovery} from '../../../../src/discovery/api';
import {projectCriteria} from '../../../../src/domain/relations';
import {authenticatedDb} from '../../../../src/server/db';
import {analyzeOffer,AnalyzeOfferError} from '../../../../src/server/ai';
import {analyzeCompanyGuarded} from '../../../../src/server/ai-guard';
import {checked as checkedRpc} from '../../../../src/discovery/repository';
import {CriterionContextSchema} from '../../../../src/discovery/types';
import {requireActiveEntitlement,effectiveEntitlement} from '../../../../src/server/entitlement';
import {attachEvidenceSources} from '../../../../src/server/evidence-sources';
import {buildAccountExportZip,anonymizeAuthUser} from '../../../../src/server/account';
import {recordApiUsage} from '../../../../src/server/usage';
import {releaseCommercialUse} from '../../../../src/server/commercial-usage';
import {newInviteToken,inviteTokenHash,isInviteToken,inviteLink,teamError,TEAM_ERRORS} from '../../../../src/server/team';
import {createAdminClient} from '../../../../src/server/admin-client';
import {createHash} from 'node:crypto';
import {handleSignals} from '../../../../src/signals/api';
import {BodaccSignalProvider,bodaccEnabled} from '../../../../src/signals/providers/bodacc';
import {intentProfileOf,verifiedSignalsOf,recordContactSnapshot} from '../../../../src/signals/context';
import {createSupabaseAnalysisAudit} from '../../../../src/discovery/analysis-audit';
import {createPolicyFetcher} from '../../../../src/discovery/website-analysis';
import {dynamicAnalysisEnabled} from '../../../../src/discovery/analysis-authorization';
import {safeFetch} from '../../../../src/discovery/safe-fetch';
import {startCheckout,openPortal} from '../../../../src/server/billing/checkout';
import {billingDeps,appOrigin} from '../../../../src/server/billing';
import {billingConfig,checkoutAvailability} from '../../../../src/server/billing/config';
import {saveProviderCredential,listProviderCredentials,deleteProviderCredential,resolveProviderCredential} from '../../../../src/server/byok';
import {DEFAULT_CRITERIA,OUTREACH_STATUSES,validateCriteria,generateOutreach,scoreProspect,csv,safeLink} from '../../../../src/domain/core';
import {STATUSES} from '../../../../src/domain/statuses';
import {handleOutreachIntelligence,PUBLIC_CONTENT_COLUMNS} from '../../../../src/outreach/api';
import {composeRuleBased} from '../../../../src/outreach/compose';
import {styleOf} from '../../../../src/outreach/style';
import {OUTREACH_TRANSITIONS,isOutreachAction,allowedFrom,carriesContent} from '../../../../src/outreach/workflow';
export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
// Commercial plan refusals (migration 016): their own code, status and sentence (localized by the client).
const COMMERCIAL_REFUSALS:Record<string,[string,number]>={
 PLAN_LIMIT_REACHED:['Limite de votre offre atteinte pour la période en cours. Consultez votre utilisation dans Compte.',429],
 OFFER_LIMIT_REACHED:['Quota d’analyses d’offre atteint pour cette période.',429],
 OFFER_ANALYSIS_IN_PROGRESS:['Cette analyse d’offre est déjà en cours. Patientez quelques secondes.',409],
};
// 4A.5: runs the real provider call and, if it fails with a business-logic error that still carries real
// usage (AnalyzeOfferError — see src/server/ai.ts), meters that usage BEFORE propagating the exact same
// public error code the client has always received. A plain Error (network failure, non-2xx, a
// pre-provider guard like BYOK_CREDENTIAL_INVALID) carries no usage and is rethrown untouched, exactly
// as before — this never changes the UI message, the HTTP status, or the success path, and can never
// meter twice (analyzeOffer runs exactly once per call here, no retry is ever introduced).
async function callProviderMeteringFailure(call:()=>ReturnType<typeof analyzeOffer>,meter:{organizationId:string;projectId:string;userId:string}){
 try{
  return await call();
 }catch(err){
  if(err instanceof AnalyzeOfferError&&err.usage){
   await recordApiUsage({organizationId:meter.organizationId,projectId:meter.projectId,userId:meter.userId,provider:err.usage.provider as 'anthropic'|'openai',operation:'offer_analysis',model:err.usage.model,inputTokens:err.usage.input_tokens,outputTokens:err.usage.output_tokens,billingSource:err.usage.credential_source});
  }
  throw err instanceof AnalyzeOfferError?Error(err.message):err;
 }
}
async function handler(request:Request,context:{params:Promise<{path:string[]}>}){
 try {
 const {db,user}=await authenticatedDb(request);const {path}=await context.params;const [resource,id]=path;
 let body:Record<string,any>={};
 if(!['GET','HEAD'].includes(request.method)){const raw=await request.text();if(raw.length>20000)return json({error:'Corps trop volumineux'},413);try{body=JSON.parse(raw||'{}')}catch{return json({error:'JSON invalide'},400)}if(!body||Array.isArray(body))return json({error:'Objet requis'},400)}
 const discoveryResponse=await handleDiscovery(request,path,body,db,user);if(discoveryResponse)return discoveryResponse;
 // Signal Engine (src/signals/api.ts): signals, review, site scan and intent profile. The site scan shares the
 // authorization, audit and plan unit of "Analyser le site"; its audit writer is the server's privileged client.
 const signalsResponse=await handleSignals(request,path,body,db,json,{
  userId:user.id,now:()=>new Date(),
  audit:()=>{try{return createSupabaseAnalysisAudit(createAdminClient(),user.id)}catch{return null}},
  sitePageFetcher:policy=>{const fetchPage=createPolicyFetcher(safeFetch);return url=>fetchPage(url,policy)},
  staticAllowlist:(process.env.DISCOVERY_ALLOWED_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
  dynamicEnabled:dynamicAnalysisEnabled(process.env.DISCOVERY_DYNAMIC_ANALYSIS_ENABLED),
  requireEntitlement:()=>requireActiveEntitlement(db,user.id),
  bodaccEnabled:bodaccEnabled(process.env),bodaccProvider:()=>new BodaccSignalProvider(),
  refundAnalysis:()=>releaseCommercialUse(createAdminClient(),user.id,'analysis'),
 });if(signalsResponse)return signalsResponse;
 // O1/O2 (src/outreach/api.ts): the caller's own style profile, and public content (pasted by a person, reviewed by a person).
 const outreachResponse=await handleOutreachIntelligence(request,path,body,db,json,{requireEntitlement:()=>requireActiveEntitlement(db,user.id)});if(outreachResponse)return outreachResponse;
 const checked=async(query:PromiseLike<any>)=>{const {data,error}=await query;if(error)throw Error('DATABASE_REQUEST_FAILED');return data};
 if(resource==='organizations'){
 if(request.method==='GET')return json(await checked(db.from('organizations').select('*')));
 if(request.method==='POST'){if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)return json({error:'Nom requis'},400);return json(await checked(db.rpc('create_organization',{name:body.name.trim()})),201)}
 }
 if(resource==='projects'){
 if(request.method==='GET')return json(await checked(db.from('projects').select('*,icps(*)').order('created_at')));
 if(request.method==='POST'){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||typeof body.organization_id!=='string')return json({error:'Projet invalide'},400);
 return json(await checked(db.from('projects').insert({name:body.name.trim(),organization_id:body.organization_id,offer:String(body.offer??'').slice(0,4000)}).select().single()),201);
 }
 if(request.method==='PATCH'&&id){if(typeof body.offer!=='string')return json({error:'Offre requise'},400);return json(await checked(db.from('projects').update({offer:body.offer.slice(0,4000)}).eq('id',id).select().single()))}
 }
 if(resource==='icps'&&request.method==='POST'){
 // The same schema Discovery search uses for its own criteria context — a single source of truth for
 // "what is a valid Criterion", including a user-authored `rules` (bounds, dedup, discriminant all
 // enforced here). A malformed direct API payload is rejected here, not silently accepted.
 let criteria;try{criteria=z.array(CriterionContextSchema).max(30).parse(body.criteria??DEFAULT_CRITERIA)}catch{return json({error:'Critères invalides : structure incorrecte'},400)}
 try{validateCriteria(criteria)}catch{return json({error:'Critères invalides : poids total 100 requis'},400)}
 const project=await checked(db.from('projects').select('*').eq('id',body.project_id).single());
 return json(await checked(db.from('icps').upsert({project_id:project.id,organization_id:project.organization_id,criteria},{onConflict:'project_id'}).select().single()));
 }
 if(resource==='prospects'){
 if(request.method==='GET'){const pid=new URL(request.url).searchParams.get('project_id');if(!pid)return json({error:'Projet requis'},400);return json(await attachEvidenceSources(db,await checked(db.from('prospects').select('*,evidence(*),channels(*)').eq('project_id',pid).order('created_at',{ascending:false}))))}
 if(request.method==='POST'){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>160||!safeLink(String(body.website??'')))return json({error:'Nom et URL HTTP(S) requis'},400);
 const project=await checked(db.from('projects').select('*').eq('id',body.project_id).single());
 return json(await checked(db.from('prospects').insert({project_id:project.id,organization_id:project.organization_id,name:body.name.trim(),website:body.website,city:String(body.city??'').slice(0,120),status:'À analyser'}).select().single()),201);
 }
 if(request.method==='PATCH'&&id){if(!STATUSES.includes(body.status))return json({error:'Statut invalide'},400);const updated=await checked(db.from('prospects').update({status:body.status}).eq('id',id).select().single());
 // Signal Engine S8: moving a prospect to "Contacté" freezes why it was contacted (best-effort, never blocks the change).
 if(body.status==='Contacté')await recordContactSnapshot(db,id,null,'status_contacted');
 return json(updated)}
 }
 if(resource==='evidence'&&request.method==='POST'){
 if(typeof body.criterion!=='string'||typeof body.value!=='boolean'||!safeLink(String(body.source_url??''))||typeof body.excerpt!=='string'||!body.excerpt.trim()||body.excerpt.length>1500||!['VERIFIED','NOT_VERIFIED','CONTRADICTED','INFERRED_UNCONFIRMED'].includes(body.status))return json({error:'Preuve invalide'},400);
 const observed=new Date(body.observed_at);if(!Number.isFinite(+observed)||+observed>Date.now())return json({error:'Date invalide'},400);
 const p=await checked(db.from('prospects').select('*').eq('id',body.prospect_id).single());
 const icp=await checked(db.from('icps').select('criteria').eq('project_id',p.project_id).single());if(!icp.criteria.some((c:{key:string})=>c.key===body.criterion))return json({error:'Critère hors ICP'},400);
 return json(await checked(db.from('evidence').insert({prospect_id:p.id,organization_id:p.organization_id,criterion:body.criterion,value:body.value,status:body.status,source_url:body.source_url,excerpt:body.excerpt,observed_at:body.observed_at,verified_by:body.status==='VERIFIED'||body.status==='CONTRADICTED'?user.id:null}).select().single()),201);
 }
 if(resource==='channels'&&request.method==='POST'){
 if(!['email','phone','form','linkedin','whatsapp','instagram'].includes(body.kind)||typeof body.value!=='string'||!body.value.trim()||body.value.length>500||!safeLink(String(body.source_url??'')))return json({error:'Canal invalide'},400);
 if(['form','linkedin','whatsapp','instagram'].includes(body.kind)&&!safeLink(body.value))return json({error:'URL de canal invalide'},400);
 const p=await checked(db.from('prospects').select('*').eq('id',body.prospect_id).single());return json(await checked(db.from('channels').insert({prospect_id:p.id,organization_id:p.organization_id,kind:body.kind,value:body.value,source_url:body.source_url,verified:body.verified===true}).select().single()),201);
 }
 if(resource==='outreach'&&request.method==='POST'){
 await requireActiveEntitlement(db,user.id);
 const p=await checked(db.from('prospects').select('*,evidence(*)').eq('id',body.prospect_id).single());
 const project=await checked(db.from('projects').select('*,icps(*)').eq('id',p.project_id).single());
 // Locale only ever picks the fixed human-language template inside generateOutreach — never a new
 // input to scoring or evidence eligibility (both computed identically inside it regardless of locale).
 // Case-insensitive by design ("EN"/"En" from a non-standard caller must not silently fall back to
 // French) and safe against non-string input (String() never throws, even on an object/array/null).
 const draftLocale=String(body.locale).toLowerCase()==='en'?'en':'fr';
 // O2: the angle — pinned verified public content > strongest verified signal (the S7 "why now") > recent verified public
 // content > the verified evidence the factual template quotes > generic — chosen deterministically (src/outreach/angle.ts),
 // quoted verbatim right after the greeting. Signals, public content and the user's own style profile are best-effort:
 // unreadable means "none", and the factual template stays exactly as it was.
 let signals:Awaited<ReturnType<typeof verifiedSignalsOf>>=[];let intentProfile=null;
 try{signals=await verifiedSignalsOf(db,p.id);intentProfile=await intentProfileOf(db,p.project_id)}catch{signals=[]}
 const publicContent=await db.from('prospect_public_content').select(PUBLIC_CONTENT_COLUMNS).eq('prospect_id',p.id).eq('status','VERIFIED').limit(50).then(r=>r.error?[]:r.data??[],()=>[]);
 const styleRow=await db.from('outreach_style_profiles').select('*').eq('organization_id',p.organization_id).limit(1).then(r=>r.error?null:(r.data??[])[0]??null,()=>null);
 const styleProfileId:string|null=styleRow?.id??null;
 const composed=composeRuleBased({name:p.name,offer:project.offer,criteria:projectCriteria(project.icps),evidence:p.evidence,signals,profile:intentProfile,publicContent,now:new Date(),locale:draftLocale,style:styleOf(styleRow)});
 // At most one live DRAFT per prospect: a regeneration supersedes the previous one instead of
 // leaving an ambiguous pile of undecided drafts. Already-decided rows (APPROVED/USED/DISCARDED)
 // are historical record and are never touched here. The invariant itself is enforced by a partial
 // unique index (migration 007), not by this discard-then-insert sequence alone: two concurrent
 // generations can still both reach the insert below, but only one can ever succeed.
 await checked(db.from('outreach').update({status:'DISCARDED'}).eq('prospect_id',p.id).eq('organization_id',p.organization_id).eq('status','DRAFT'));
 // generated_content keeps the generated text for good (database: immutable); content is the copy a person edits.
 const {data:row,error:insertError}=await db.from('outreach').insert({organization_id:p.organization_id,prospect_id:p.id,generated_content:composed.text,content:composed.text,angle:composed.angle,public_content_ids:composed.public_content_ids,signal_ids:composed.signal_ids,evidence_ids:composed.evidence_ids,style_profile_id:styleProfileId,provider:composed.provider}).select('id,status,created_at').single();
 if(insertError){
 // 23505 = unique_violation: a concurrent generation for the same prospect won the race and its
 // DRAFT is now the live one. This is expected under concurrency, never a raw DB exception — the
 // loser is told plainly to retry, and retrying immediately succeeds (it discards the winner's
 // DRAFT first, exactly like any other regeneration).
 if(insertError.code==='23505')return json({error:'Une autre génération est en cours pour ce prospect. Réessayez.'},409);
 throw Error('DATABASE_REQUEST_FAILED');
 }
 return json({...composed,mode:draftLocale==='en'?'Factual template':'Modèle factuel',generated_at:new Date().toISOString(),id:row.id,status:row.status,created_at:row.created_at},201);
 }
 if(resource==='outreach'&&request.method==='GET'&&!id){
 // The prospect's live message (DRAFT or APPROVED), with both texts and the frozen angle — so it survives a reload.
 const pid=new URL(request.url).searchParams.get('prospect_id');if(!z.string().uuid().safeParse(pid).success)return json({error:'Identifiant invalide'},400);
 const rows=await checked(db.from('outreach').select('id,status,content,generated_content,angle,evidence_ids,signal_ids,public_content_ids,style_profile_id,provider,created_at,last_edited_at').eq('prospect_id',pid).in('status',['DRAFT','APPROVED']).order('created_at',{ascending:false}).limit(1));
 return json((rows??[])[0]??null);
 }
 if(resource==='outreach'&&request.method==='PATCH'&&id){
 // O1 workflow (src/outreach/workflow.ts, OUTREACH_TRANSITIONS): SAVE (no status) and APPROVED apply to a DRAFT only;
 // USED (Copy) to an APPROVED message only; DISCARDED to a DRAFT or APPROVED one. Only SAVE and APPROVED carry a text.
 // The generated original is never sent: the database keeps it immutable (migration 027). Never re-enters
 // DRAFT, and never touches the prospect's own business status: copying a message is not proof it was sent.
 const action=body.status===undefined?'SAVE':body.status;
 if(!isOutreachAction(action))return json({error:'Statut de brouillon invalide'},400);
 const patch:Record<string,unknown>=action==='SAVE'?{}:{status:action};
 if(body.content!==undefined){
 if(!carriesContent(action))return json({error:'Ce statut ne modifie pas le texte'},400);
 if(typeof body.content!=='string'||!body.content.trim()||body.content.length>4000)return json({error:'Contenu de brouillon invalide'},400);
 patch.content=body.content;
 }
 if(action==='SAVE'&&patch.content===undefined)return json({error:'Contenu de brouillon invalide'},400);
 // A message not in an allowed status matches nothing (0 rows -> the same generic error as any not-found/wrong-tenant
 // case); USED/DISCARDED terminality and the APPROVED text lock are enforced again by the database (migrations 007, 027).
 const changed=await checked(db.from('outreach').update(patch).eq('id',id).in('status',allowedFrom(action)).select().single());
 // Signal Engine S8: a message marked used freezes why the prospect was contacted (best-effort).
 if(action==='USED'&&changed?.prospect_id)await recordContactSnapshot(db,changed.prospect_id,changed.id,'outreach_used');
 return json(changed);
 }
 if(resource==='events'&&request.method==='GET'){const pid=new URL(request.url).searchParams.get('prospect_id');return json(await checked(db.from('events').select('*').eq('prospect_id',pid??'').order('created_at',{ascending:false}).limit(100)))}
 if(resource==='analyze-company'&&request.method==='POST'){
 await requireActiveEntitlement(db,user.id);
 if(typeof body.text!=='string'||body.text.length<30||body.text.length>10000||!safeLink(String(body.source_url??'')))return json({error:'URL source et texte public de 30 à 10 000 caractères requis'},400);
 // analyzeCompanyGuarded rejects a malformed project_id before either the quota RPC or the paid
 // provider ever run, then consumes the quota BEFORE calling the provider, never after — fail-closed
 // by construction at every step (invalid id, quota exceeded, not a member, or the check itself
 // failing all stop here, before any cost is incurred). organizationId is resolved INSIDE the
 // callProvider closure (so it only ever runs after the id is validated and the quota consumed) and
 // captured here only to address the cost-ledger write below — never used to decide access.
 let organizationId:string|undefined;
 // Commercial plan (migration 016): the reservation also counts one AI offer analysis against the plan,
 // still BEFORE the provider. The same text for the same project, already analysed by this user in the last
 // 24 hours, comes back from the stored result — no unit, no AI call; a duplicate still running (double
 // click, retry) is refused instead of paying twice. A unit is given back only when the AI was never called.
 const textHash=createHash('sha256').update(body.text).digest('hex');
 let cached:Record<string,unknown>|null=null;let providerCalled=false;
 const {usage,credential_source,...analysis}=await analyzeCompanyGuarded(
  body.project_id,
  async(projectId)=>{const reservation=await checkedRpc(db.rpc('reserve_offer_analysis',{p_project_id:projectId,p_text_hash:textHash}));cached=reservation?.cached??null},
  async()=>{
   if(cached)return {...cached,usage:{provider:'',model:'',input_tokens:0,output_tokens:0},credential_source:null} as unknown as Awaited<ReturnType<typeof analyzeOffer>>;
   try{
   const project=await checked(db.from('projects').select('organization_id').eq('id',body.project_id).single());
   organizationId=project.organization_id;
   // BYOK never changes which provider/model is called — only which key pays — and only ever
   // activates when the platform is already configured for Anthropic (see src/server/ai.ts). NONE
   // (no BYOK credential saved) legitimately falls back to the platform key. INVALID (a credential
   // exists but cannot be decrypted/used — corrupted ciphertext, wrong BYOK_MASTER_KEY, etc.) is NEVER
   // treated the same as NONE: falling back to the platform key there would silently bill the
   // platform's own key for an organization whose BYOK setup is broken. Fail closed instead — no
   // provider call, no quota refund (same as any other provider-side failure).
   const meter={organizationId:project.organization_id,projectId:body.project_id,userId:user.id};
   if(process.env.AI_PROVIDER==='anthropic'){
    const credential=await resolveProviderCredential(project.organization_id,'anthropic');
    if(credential.status==='INVALID')throw Error('BYOK_CREDENTIAL_INVALID');
    providerCalled=true;
    return await callProviderMeteringFailure(()=>analyzeOffer(body.text,{apiKeyOverride:credential.status==='VALID'?credential.apiKey:null}),meter);
   }
   providerCalled=true;
   return await callProviderMeteringFailure(()=>analyzeOffer(body.text),meter);
   }catch(error){
    // The reservation is closed so an identical retry can run. Its plan unit goes back only when no AI call
    // happened (project read, invalid BYOK key, provider not configured); a provider call keeps it spent.
    await Promise.resolve(db.rpc('abandon_offer_analysis',{p_project_id:body.project_id,p_text_hash:textHash})).catch(()=>{});
    if(!providerCalled||(error instanceof Error&&error.message==='AI_NOT_CONFIGURED')){try{await releaseCommercialUse(createAdminClient(),user.id,'ai_offer')}catch{/* best-effort */}}
    throw error;
   }
  },
 );
 // Best-effort cost-ledger write for the real LLM call that just happened — never allowed to turn an
 // already-successful (and already billed) analysis into a failed response for the user.
 if(usage.input_tokens||usage.output_tokens){try{
 await recordApiUsage({organizationId:organizationId!,projectId:body.project_id,userId:user.id,provider:usage.provider as 'anthropic'|'openai',operation:'offer_analysis',model:usage.model,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,billingSource:credential_source});
 }catch{/* Cost-ledger visibility is best-effort; the analysis itself already succeeded. */}}
 // Kept so an identical request (double click, retry, reload) reads it back instead of paying again.
 if(!cached)await Promise.resolve(db.rpc('complete_offer_analysis',{p_project_id:body.project_id,p_text_hash:textHash,p_result:analysis})).catch(()=>{});
 return json(analysis);
 }
 if(resource==='provider-credentials'){
 // BYOK storage/management surface, shared by all providers. Anthropic credentials saved here are
 // actually routed through analyzeOffer (see the analyze-company block above and docs/COST_METERING.md)
 // — Brave/OpenAI credentials remain stored but not yet wired into a provider call. Every mutation goes
 // through a SECURITY DEFINER RPC that itself requires the caller to be an OWNER of the target
 // organization — never trusted from the request beyond that check. The plaintext API key is encrypted
 // here, in this request's memory, before save_provider_credential ever sees it; it is never read back
 // (list/GET only ever returns provider/key_last4/created_at/updated_at).
 const organizationId=z.string().uuid().parse(id);
 if(request.method==='GET')return json(await listProviderCredentials(db,organizationId));
 if(request.method==='POST'){
 const b=z.object({provider:z.enum(['brave','anthropic','openai']),api_key:z.string().min(8).max(500)}).strict().parse(body);
 return json(await saveProviderCredential(db,organizationId,b.provider,b.api_key),201);
 }
 if(request.method==='DELETE'){
 const b=z.object({provider:z.enum(['brave','anthropic','openai'])}).strict().parse(body);
 await deleteProviderCredential(db,organizationId,b.provider);return json({deleted:true});
 }
 }
 if(resource==='billing'&&request.method==='POST'&&(id==='checkout'||id==='portal')){
 // Stripe Checkout / Customer Portal (src/server/billing/checkout.ts). The user is the authenticated session
 // user; the browser only names an offer (BETA or PRO) — price, amount, currency and customer are server-side.
 const deps=billingDeps();
 const result=id==='checkout'
  ?await startCheckout({userId:user.id,email:user.email??null,body,origin:appOrigin(request)},deps)
  :await openPortal({userId:user.id,body,origin:appOrigin(request)},deps);
 return json(result.body,result.status);
 }
 if(resource==='account'){
 if(request.method==='GET'&&!id){
 // V0's own single-org-per-user assumption (same one createProject already makes): role/organization
 // are read from this user's own membership row(s), never from anything the client asserts.
 const memberships=await checked(db.from('memberships').select('organization_id,role'));
 // A team membership (role 'member', migration 022) is the account's workspace; otherwise its own organization.
 const membership=memberships.find((m:any)=>m.role==='member')??memberships[0]??null;
 const organization=membership?await checked(db.from('organizations').select('name').eq('id',membership.organization_id).single()):null;
 // The effective access (023): a team member sees and uses its owner's team plan.
 const entitlement=await effectiveEntitlement(db,user.id).then(r=>{if(r.error)throw Error('DATABASE_REQUEST_FAILED');return r.data});
 // Commercial counters (migration 016). Best-effort and read-only: until that migration is applied the
 // function does not exist and the account answer simply carries usage:null, exactly as before.
 const usageAnswer=await db.rpc('get_commercial_usage');
 // Subscription summary (migration 017, own row only, no Stripe identifier) and which offers can be bought
 // on this deployment (booleans: no configuration value ever reaches the browser). Best-effort like usage.
 const billingAnswer=await db.rpc('get_billing_status');
 return json({
  email:user.email??null,
  organization:organization?{name:organization.name}:null,
  organization_id:membership?.organization_id??null,
  role:membership?.role??null,
  entitlement:entitlement?{plan:entitlement.plan,status:entitlement.status,expires_at:entitlement.expires_at,active:entitlement.status==='ACTIVE'&&new Date(entitlement.expires_at).getTime()>Date.now()}:null,
  usage:usageAnswer.error?null:usageAnswer.data??null,
  billing:billingAnswer.error?null:billingAnswer.data??null,
  billing_offers:checkoutAvailability(billingConfig()),
 });
 }
 if(id==='export'&&request.method==='POST'){
 const zip=await buildAccountExportZip(db,user);
 try{await db.rpc('log_account_export')}catch{/* best-effort audit only — never blocks the export itself */}
 return new Response(zip as BodyInit,{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="prospectos-export-${new Date().toISOString().slice(0,10)}.zip"`,'Cache-Control':'no-store'}});
 }
 // ProspectOS Pro team (migration 022). Every rule is the database's (owner, active team plan, 5 seats, confirmed
 // matching e-mail, single use, 7 days); these routes run as the user and only map refusals to stable codes.
 if(id==='team'){
 const op=path[2]??'';
 const refused=(rpcError:unknown)=>{const t=teamError(rpcError);if(t)return json({error:t.error,code:t.code},t.status);if(/Invalid email/.test(String((rpcError as {message?:unknown})?.message)))return json({error:'Adresse e-mail invalide'},400);throw Error('DATABASE_REQUEST_FAILED')};
 if(request.method==='GET'&&!op){const {data,error:rpcError}=await db.rpc('list_team');if(rpcError)return refused(rpcError);let invitations=null;if(data?.is_owner){const r=await db.rpc('list_team_invitations');if(!r.error)invitations=r.data}return json({team:data??null,invitations})}
 if(request.method==='POST'&&op==='invite'){const token=newInviteToken();const {data,error:rpcError}=await db.rpc('create_team_invitation',{p_email:String(body.email??'').slice(0,254),p_token_hash:inviteTokenHash(token)});if(rpcError)return refused(rpcError);return json({invitation:data,link:inviteLink(request,token)},201)}
 if(request.method==='POST'&&op==='accept'){if(!isInviteToken(body.token))return json({error:TEAM_ERRORS.invitation_invalid[1],code:TEAM_ERRORS.invitation_invalid[0]},400);const {data,error:rpcError}=await db.rpc('accept_team_invitation',{p_token_hash:inviteTokenHash(body.token)});if(rpcError)return refused(rpcError);return json(data)}
 if(request.method==='POST'&&op==='revoke'){if(!z.string().uuid().safeParse(body.id).success)return json({error:'Invitation requise'},400);const {data,error:rpcError}=await db.rpc('revoke_team_invitation',{p_id:body.id});if(rpcError)return refused(rpcError);return json({revoked:data===true})}
 if(request.method==='POST'&&op==='remove'){if(!z.string().uuid().safeParse(body.user_id).success)return json({error:'Membre requis'},400);const {error:rpcError}=await db.rpc('remove_team_member',{p_user_id:body.user_id});if(rpcError)return refused(rpcError);return json({removed:true})}
 if(request.method==='POST'&&op==='leave'){const {error:rpcError}=await db.rpc('leave_team');if(rpcError)return refused(rpcError);return json({left:true})}
 }
 if(id==='activate-trial'&&request.method==='POST'){
 // Never takes a target from the client: activate_trial() derives auth.uid() itself. Idempotent by
 // construction (see migration 012) — safe to call on every login, never re-extends an existing row.
 const {data,error:rpcError}=await db.rpc('activate_trial');
 if(rpcError){
  if(rpcError.message?.includes('BETA_CAPACITY_REACHED'))return json({error:'La bêta est actuellement complète. Contactez-nous pour être informé de la prochaine ouverture.',code:'BETA_CAPACITY_REACHED'},409);
  throw Error('DATABASE_REQUEST_FAILED');
 }
 return json(data,201);
 }
 if(id==='delete'&&request.method==='POST'){
 // A typed confirmation is required at the API layer too — this is never enforced by the UI alone.
 if(body.confirm!=='SUPPRIMER')return json({error:'Confirmation requise'},400);
 const {error:rpcError}=await db.rpc('delete_own_account');
 if(rpcError){
  if(rpcError.message?.includes('active_subscription_blocked'))return json({error:'Votre abonnement est toujours actif. Résiliez-le depuis « Gérer mon abonnement » avant de supprimer votre compte.',code:'ACTIVE_SUBSCRIPTION_BLOCKED'},409);
  if(rpcError.message?.includes('last_owner_blocked'))return json({error:'Vous êtes le dernier propriétaire d’une organisation encore active (membres ou données). Transférez la propriété ou supprimez l’organisation avant de supprimer votre compte.',code:'LAST_OWNER_BLOCKED'},409);
  throw Error('DATABASE_REQUEST_FAILED');
 }
 // Memberships are already gone at this point — the account is already unusable inside the app.
 // A failure here is reported plainly rather than silently claimed as a full success.
 try{await anonymizeAuthUser(user.id)}catch{return json({error:'Vos accès ont été retirés, mais la fermeture définitive du compte a échoué. Contactez le support.'},500)}
 return json({deleted:true});
 }
 }
 if(resource==='admin'&&id==='beta-analytics'&&request.method==='GET'){
 // Never a new admin role/table: beta_analytics() itself checks the caller's OWN
 // account_entitlements.plan='INTERNAL'/status='ACTIVE' before reading anything cross-user (migration
 // 013) and raises 'Admin access required' otherwise — mapped here to a clean 403, never a raw 500.
 const {data,error:rpcError}=await db.rpc('beta_analytics');
 if(rpcError){
  if(rpcError.message?.includes('Admin access required'))return json({error:'Accès administrateur requis.',code:'ADMIN_ACCESS_REQUIRED'},403);
  throw Error('DATABASE_REQUEST_FAILED');
 }
 return json(data);
 }
 if(resource==='export'&&request.method==='GET'){
 const pid=new URL(request.url).searchParams.get('project_id');const project=await checked(db.from('projects').select('*,icps(*)').eq('id',pid??'').single());const rows=await checked(db.from('prospects').select('*,evidence(*)').eq('project_id',project.id));
 return new Response(csv([['Nom','Ville','Statut','Score','Couverture','URL'],...rows.map((p:any)=>{const s=scoreProspect(projectCriteria(project.icps),p.evidence);return [p.name,p.city,p.status,s.score,s.coverage,p.website]})]),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="prospectos.csv"','Cache-Control':'no-store'}});
 }
 return json({error:'Route ou action non disponible'},404);
 }catch(error){const refusal=error instanceof Error?COMMERCIAL_REFUSALS[error.message]:undefined;if(refusal)return json({error:refusal[0],code:(error as Error).message},refusal[1]);if(error instanceof Error&&(error.message==='STRIPE_REQUEST_FAILED'||error.message==='INVALID_STRIPE_ID'))return json({error:'Le service de paiement est momentanément indisponible. Réessayez.',code:'BILLING_PROVIDER_ERROR'},502);const code=error instanceof Error?error.message:'';const status=code==='UNAUTHORIZED'?401:code==='CONFIGURATION_REQUIRED'||code==='AI_NOT_CONFIGURED'||code==='BYOK_CREDENTIAL_INVALID'?503:code==='QUOTA_EXCEEDED'?429:code==='BETA_ACCESS_EXPIRED'?402:code==='ENTITLEMENT_REQUIRED'?403:400;return json({error:code==='UNAUTHORIZED'?'Connexion requise':code==='CONFIGURATION_REQUIRED'?'Supabase reste à connecter':code==='AI_NOT_CONFIGURED'?'Fournisseur IA et modèle non configurés':code==='BYOK_CREDENTIAL_INVALID'?'Clé Anthropic personnalisée invalide ou illisible. Remplacez-la dans Compte.':code==='AI_UNAVAILABLE'?"Le fournisseur IA n'a pas pu traiter la demande.":code==='AI_TRUNCATED_RESULT'?"La réponse IA a été interrompue avant d'être complète.":code==='AI_INVALID_RESULT'?"La réponse du fournisseur IA n'a pas pu être exploitée.":code==='QUOTA_EXCEEDED'?'Quota horaire de votre organisation atteint.':code==='BETA_ACCESS_EXPIRED'?'Votre accès bêta est terminé.':code==='ENTITLEMENT_REQUIRED'?'Cette fonctionnalité nécessite une activation bêta. Contactez-nous pour y accéder.':code==='INVALID_PROJECT_ID'?'Identifiant de projet invalide':'Opération impossible. Vérifiez les données et vos droits.',code:code==='BETA_ACCESS_EXPIRED'?'BETA_ACCESS_EXPIRED':code==='BYOK_CREDENTIAL_INVALID'?'BYOK_CREDENTIAL_INVALID':code==='ENTITLEMENT_REQUIRED'?'ENTITLEMENT_REQUIRED':undefined},status)}
}
export {handler as GET,handler as POST,handler as PATCH};
