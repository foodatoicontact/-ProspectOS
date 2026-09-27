import {summarizeRuns,HISTORY_MAX} from './run-history.ts';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {DiscoveryService,CompanyAnalysisService} from './services.ts';
import {SupabaseDiscoveryRepository,checked} from './repository.ts';
import {FixtureProvider,isFixtureUrl,createCompositePageFetcher} from './providers/fixture.ts';
import {BraveProvider} from './providers/brave.ts';
import {safeFetch} from './safe-fetch.ts';
import {DiscoveryInputSchema} from './types.ts';
import {requireActiveEntitlement} from '../server/entitlement.ts';
import {recordApiUsage} from '../server/usage.ts';
import {computeRunCostMetrics} from './cost-metrics.ts';
import {alreadyAddedProspect,currentProjectStatuses} from './novelty-engine.ts';
import {isAcceptableSourceClass} from './source-classification.ts';
import {createAdminClient} from '../server/admin-client.ts';
import {analyzeProspectWebsite,createPolicyFetcher} from './website-analysis.ts';
import {createSupabaseAnalysisAudit} from './analysis-audit.ts';
import {dynamicAnalysisEnabled} from './analysis-authorization.ts';
import {trackAnalysisReservation,releaseOnFailure,releaseCommercialUse} from '../server/commercial-usage.ts';
// The project's prospects with the identity the novelty engine compares (own website, phone, dedupe key).
async function projectProspects(db:SupabaseClient,projectId:string){const rows=await checked(db.from('prospects').select('id,name,website,city,discovery_dedupe_key,channels(kind,value)').eq('project_id',projectId));
 return rows.map((p:{id:string;name:string;website:string|null;city:string|null;discovery_dedupe_key:string|null;channels?:Array<{kind:string;value:string}>})=>({id:p.id,name:p.name,website:p.website,city:p.city,discovery_dedupe_key:p.discovery_dedupe_key,phone:p.channels?.find(c=>c.kind==='phone')?.value??null}))}
const uuid=z.string().uuid();
// Refusals of "Analyser le site" decided by the server-side authorization or by robots.txt.
const ANALYSIS_REFUSALS:Record<string,[string,number]>={
 SOURCE_POLICY_REQUIRED:['Analyse bloquée : ce site n’a pas été découvert et accepté via ProspectOS, et l’opérateur ne l’a pas autorisé (DISCOVERY_ALLOWED_HOSTS).',503],
 DYNAMIC_ANALYSIS_DISABLED:['Analyse des sites découverts désactivée par l’opérateur pour le moment.',503],
 DISCOVERY_CAPABILITY_INVALID:['Analyse bloquée : ce prospect ne provient pas d’un site officiel découvert et accepté.',403],
 WEBSITE_MISMATCH:['Analyse bloquée : le site du prospect ne correspond plus au site découvert et accepté.',403],
 ROBOTS_DENIED:['Analyse refusée : le robots.txt du site ne l’autorise pas. Aucune preuve validée.',422],
};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const log=(event:Record<string,string|number|null>)=>console.info(JSON.stringify({component:'discovery',...event}));
export async function handleDiscovery(request:Request,path:string[],body:unknown,db:SupabaseClient,user:{id:string}):Promise<Response|null>{
 const [resource,id,action,observationId,decision]=path;const method=request.method;
 const applies=resource==='discovery-config'||resource==='discovery-runs'||resource==='discovery-results'||resource==='projects'&&action==='discovery'||resource==='prospects'&&['analyze','observations','website'].includes(action);
 if(!applies)return null;
 try{
 // Only the two actions that actually search for or analyze a company are gated — reading existing
 // discovery runs/results, reviewing/confirming an observation, or setting a prospect's official
 // website never are: an expired trial must never hide data the user already has.
 if((resource==='projects'&&action==='discovery'&&method==='POST')||(resource==='prospects'&&action==='analyze'&&method==='POST'))await requireActiveEntitlement(db,user.id);
 const repo=new SupabaseDiscoveryRepository(db);
 if(resource==='discovery-config'&&method==='GET')return json({providers:[{id:'fixture',available:true,mode:'test',label:'TEST — entreprises synthétiques'},{id:'brave',available:!!process.env.BRAVE_SEARCH_API_KEY,mode:'live',label:'Brave Search API'}],website_policy:'Domaines autorisés par l’opérateur et robots.txt vérifié',max_results_transport:100});
 // History of the project's searches: reads only, through the caller's RLS-scoped client (runs and results
 // of the member's own organization). Never a provider call, never a write: nothing is consumed.
 if(resource==='projects'&&action==='discovery'&&method==='GET'){
 uuid.parse(id);
 // Paged on demand (?limit=&offset=): the screen shows a few recent runs first. Without parameters the
 // former answer is kept (the 50 most recent). Bounded either way.
 const params=new URL(request.url).searchParams;
 const intParam=(name:string,fallback:number,max:number)=>{const raw=params.get(name);return raw===null?fallback:z.number().int().min(name==='limit'?1:0).max(max).parse(Number(raw))};
 const page={limit:intParam('limit',HISTORY_MAX,HISTORY_MAX),offset:intParam('offset',0,10000)};
 const runs=await checked(db.from('discovery_runs').select('id,query,location,categories,provider,filters_json,status,started_at,completed_at,result_count,metrics').eq('project_id',id).order('started_at',{ascending:false}).range(page.offset,page.offset+page.limit-1));
 const ids=runs.map((r:{id:string})=>r.id);
 const decided=ids.length?await checked(db.from('discovery_results').select('discovery_run_id,status').in('discovery_run_id',ids).in('status',['accepted','ignored'])):[];
 return json(summarizeRuns(runs,decided));
 }
 if(resource==='projects'&&action==='discovery'&&method==='POST'){
 uuid.parse(id);const input=DiscoveryInputSchema.parse({...z.record(z.string(),z.unknown()).parse(body),project_id:id});const name=input.optional_filters.provider??'fixture';const provider=name==='brave'?new BraveProvider(process.env.BRAVE_SEARCH_API_KEY??''):new FixtureProvider();
 // Results are persisted only through the server's privileged client (migration 014). Obtained before
 // the run starts, so a server missing its configuration fails fast without spending a search.
 let writer;try{writer=createAdminClient()}catch{return json({error:'Discovery indisponible : configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 // Real Brave requests that were actually sent (1 to 3 per Discovery, see query-plan.ts), recorded with
 // their exact count once the search step is over — also when some or all of them failed. Never written
 // for the fixture/TEST provider: a synthetic run must never leave a real-looking cost trace.
 const meter=name==='brave'?async(run:{id:string},requestCount:number)=>{const r=run as unknown as {id:string;organization_id:string};await recordApiUsage({organizationId:r.organization_id,projectId:id,discoveryRunId:r.id,userId:user.id,provider:'brave',operation:'search',requestCount})}:undefined;
 const result=await new DiscoveryService(new SupabaseDiscoveryRepository(db,{db:writer,userId:user.id}),provider,log,meter).find_prospects(input);
 return json(result,201);
 }
 if(resource==='discovery-runs'&&method==='GET'){
 uuid.parse(id);const run=await checked(db.from('discovery_runs').select('*').eq('id',id).single());if(action==='results'){const rows=await checked(db.from('discovery_results').select('*').eq('discovery_run_id',run.id).order('created_at'));
 // Enriched with where each actor stands in the project NOW (display only — the run's snapshot and metrics
 // stay as they were): one read of the project's prospects, matched in memory, RLS-scoped.
 const current=rows.length?currentProjectStatuses(rows,await projectProspects(db,run.project_id)):new Map();
 return json(rows.map((r:{id:string;status:string})=>r.status==='accepted'?r:{...r,current_project_status:current.get(r.id)??null}))}if(action==='cost')return json(await computeRunCostMetrics(db,run.id));if(!action)return json(run);
 }
 if(resource==='discovery-results'&&method==='POST'){
 uuid.parse(id);if(action==='accept'){const b=z.object({force_separate:z.boolean().default(false)}).strict().parse(body);
 // Only a COMPANY_CANDIDATE becomes a prospect. Checked here on the dedicated source_class column (read
 // through the caller's RLS-scoped client) and enforced again by accept_discovery_result itself, which is
 // the final authority. An already-accepted result is left to the RPC's idempotent return.
 const notAcceptable=()=>json({error:'Ce résultat n’est pas une entreprise résolue (job board, marketplace, article, profil individuel ou page ambiguë) : il ne peut pas être ajouté comme prospect.',code:'CANDIDATE_NOT_ACCEPTABLE'},400);
 const row=await checked(db.from('discovery_results').select('status,source_class').eq('id',id).single());if(row?.status==='pending'&&!isAcceptableSourceClass(row?.source_class))return notAcceptable();
 // Never a second prospect for an actor already in the project (novelty B14): same own domain or same
 // phone as an existing prospect, and the RPC would create a new one (not the dedup link to that prospect,
 // not the same dedupe key it would reuse) → refused, with the prospect to open instead. One read, RLS-scoped.
 const identity=row?.status==='pending'?await checked(db.from('discovery_results').select('project_id,dedupe_status,dedupe_key,company_name,website,phone,city,source_url').eq('id',id).single()):null;
 if(identity&&identity.dedupe_status!=='duplicate_candidate'){const prospects=await projectProspects(db,identity.project_id);
  // The stored website is the organization's own (null unless resolution admitted it) — no jsonb read.
  const same=alreadyAddedProspect(identity,row.source_class,prospects,b.force_separate);
  if(same)return json({error:'Cet acteur est déjà un prospect de ce projet : ouvrez sa fiche plutôt que d’en créer un second.',code:'ALREADY_ADDED',prospect_id:same},409)}
 const accepted=await db.rpc('accept_discovery_result',{p_result_id:id,p_force_separate:b.force_separate});if(accepted.error?.message?.includes('CANDIDATE_NOT_ACCEPTABLE'))return notAcceptable();
 return json(await checked(Promise.resolve(accepted)));}
 if(action==='ignore'){return json(await checked(db.rpc('ignore_discovery_result',{p_result_id:id})))}
 }
 if(resource==='prospects'){
 uuid.parse(id);
 if(action==='website'&&method==='POST'){
 const b=z.object({website:z.string().url().max(2048),official_confirmed:z.literal(true)}).strict().parse(body);const u=new URL(b.website);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('INVALID_WEBSITE');
 return json(await checked(db.from('prospects').update({website:b.website}).eq('id',id).select().single()));
 }
 if(action==='analyze'&&method==='POST'){
 // The request body is never read here: the destination is decided from server data only.
 const p=await repo.prospect(id);
 // Commercial plan: an analysis that produced no result (fetch failed, site unreachable, refused, timeout)
 // gives its plan unit back through the privileged client. The hourly anti-abuse log is left untouched.
 const tracked=trackAnalysisReservation(repo);
 const refund=async()=>releaseCommercialUse(createAdminClient(),user.id,'analysis');
 // Accepted discovery results of this prospect, read under RLS (same organization only). Members can no
 // longer write discovery_results (migration 014), so these rows are server-written facts.
 const accepted=await checked(db.from('discovery_results').select('status,provider,source_class,website,source_url,raw_payload').eq('prospect_id',id).eq('status','accepted'));
 // A fixture-accepted prospect never touches the network: its known .fixture.example pages resolve
 // deterministically (unchanged path, no audit — nothing real is fetched).
 const fixture=accepted.length>0&&accepted.every((r:{provider:string})=>r.provider==='fixture');
 if(fixture){if(!p.website||!isFixtureUrl(p.website))throw Error('FIXTURE_WEBSITE_MISMATCH');return json(await releaseOnFailure(()=>new CompanyAnalysisService(tracked.repo,createCompositePageFetcher(()=>Promise.reject(Error('FIXTURE_ONLY'))),log).analyze_company(id,'test_fixture'),tracked.reserved,refund))}
 // Real website: server-derived authorization (dynamic Discovery capability behind its kill switch, or the
 // operator allowlist), audited through the privileged client — obtained first, so a server that cannot
 // audit never fetches.
 let auditWriter;try{auditWriter=createAdminClient()}catch{return json({error:'Analyse indisponible : configuration serveur incomplète.',code:'CONFIGURATION_REQUIRED'},503)}
 const audit=createSupabaseAnalysisAudit(auditWriter,user.id);
 const staticAllowlist=(process.env.DISCOVERY_ALLOWED_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 const fetchPage=createPolicyFetcher(safeFetch);
 try{return json(await releaseOnFailure(()=>analyzeProspectWebsite({repo:tracked.repo,prospectId:id,userId:user.id,acceptedResults:accepted,staticAllowlist,dynamicEnabled:dynamicAnalysisEnabled(process.env.DISCOVERY_DYNAMIC_ANALYSIS_ENABLED),audit,fetchPage,log}),tracked.reserved,refund))}
 // Authorization and robots refusals: their own codes, a generic sentence, no address or host detail.
 // Every other error goes to the shared handler below, unchanged.
 catch(e){const code=e instanceof Error?e.message:'';const refusal=ANALYSIS_REFUSALS[code];if(refusal)return json({error:refusal[0],code},refusal[1]);throw e}
 }
 if(action==='observations'&&method==='GET'&&!observationId)return json(await checked(db.from('prospect_observations').select('*').eq('prospect_id',id).order('created_at')));
 if(action==='observations'&&method==='POST'&&observationId&&['confirm','contradict','unverify'].includes(decision)){
 uuid.parse(observationId);await checked(db.from('prospect_observations').select('id').eq('id',observationId).eq('prospect_id',id).single());return json(await checked(db.rpc('review_discovery_observation',{p_observation_id:observationId,p_decision:decision})));
 }
 }
 return json({error:'Route Discovery inconnue'},404);
 }catch(e){const code=e instanceof Error?e.message:'DISCOVERY_FAILED';const messages:Record<string,string>={BRAVE_NOT_CONFIGURED:'Brave est implémenté mais sa clé API n’est pas configurée.',SOURCE_POLICY_REQUIRED:'Analyse bloquée : l’opérateur doit autoriser ce domaine dans DISCOVERY_ALLOWED_HOSTS après revue de ses conditions.',OFFICIAL_WEBSITE_REQUIRED:'Renseignez et confirmez le site officiel avant analyse.',QUOTA_EXCEEDED:'Quota horaire de votre organisation atteint.',PLAN_LIMIT_REACHED:'Limite de votre offre atteinte pour la période en cours. Consultez votre utilisation dans Compte.',BETA_ACCESS_EXPIRED:'Votre accès bêta est terminé.',ENTITLEMENT_REQUIRED:'Cette fonctionnalité nécessite une activation bêta. Contactez-nous pour y accéder.',MAX_RESULTS_EXCEEDED:'Le nombre demandé dépasse la limite configurée par l’opérateur.',ANALYSIS_FAILED:'Analyse impossible : source, robots, réseau ou politique de sécurité. Aucune preuve validée.',DISCOVERY_FAILED:'La recherche a échoué. Consultez son état ; aucune preuve n’a été validée.',DATABASE_REQUEST_FAILED:'Opération refusée : vérifiez les droits, l’état du résultat et la migration Discovery.'};return json({error:messages[code]??'Requête Discovery invalide',code:code in messages?code:'INVALID_REQUEST'},code==='QUOTA_EXCEEDED'||code==='PLAN_LIMIT_REACHED'?429:code==='BETA_ACCESS_EXPIRED'?402:code==='ENTITLEMENT_REQUIRED'?403:code==='BRAVE_NOT_CONFIGURED'||code==='SOURCE_POLICY_REQUIRED'?503:400)}
}
