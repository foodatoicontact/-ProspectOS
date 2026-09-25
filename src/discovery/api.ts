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
import {isAcceptableSourceClass} from './source-classification.ts';
import {createAdminClient} from '../server/admin-client.ts';
const uuid=z.string().uuid();
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
 uuid.parse(id);const run=await checked(db.from('discovery_runs').select('*').eq('id',id).single());if(action==='results')return json(await checked(db.from('discovery_results').select('*').eq('discovery_run_id',run.id).order('created_at')));if(action==='cost')return json(await computeRunCostMetrics(db,run.id));if(!action)return json(run);
 }
 if(resource==='discovery-results'&&method==='POST'){
 uuid.parse(id);if(action==='accept'){const b=z.object({force_separate:z.boolean().default(false)}).strict().parse(body);
 // Only a COMPANY_CANDIDATE becomes a prospect. Checked here on the dedicated source_class column (read
 // through the caller's RLS-scoped client) and enforced again by accept_discovery_result itself, which is
 // the final authority. An already-accepted result is left to the RPC's idempotent return.
 const notAcceptable=()=>json({error:'Ce résultat n’est pas une entreprise résolue (job board, marketplace, article, profil individuel ou page ambiguë) : il ne peut pas être ajouté comme prospect.',code:'CANDIDATE_NOT_ACCEPTABLE'},400);
 const row=await checked(db.from('discovery_results').select('status,source_class').eq('id',id).single());if(row?.status==='pending'&&!isAcceptableSourceClass(row?.source_class))return notAcceptable();
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
 const p=await repo.prospect(id);const origin=await checked(db.from('discovery_results').select('provider').eq('prospect_id',id).eq('status','accepted').limit(1));
 const fixture=origin[0]?.provider==='fixture';if(fixture&&(!p.website||!isFixtureUrl(p.website)))throw Error('FIXTURE_WEBSITE_MISMATCH');
 const allowedHosts=(process.env.DISCOVERY_ALLOWED_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(!fixture&&!allowedHosts.length)throw Error('SOURCE_POLICY_REQUIRED');
 // A fixture-accepted prospect never touches the network: its known .fixture.example pages resolve
 // deterministically. Every other prospect goes through the same policy-checked safeFetch as before —
 // no branch here decides that, the composite fetcher does, based solely on the URL's own shape.
 const realFetcher=(url:string)=>safeFetch(url,{allowedHosts,respectRobots:true,maxBytes:500000,timeoutMs:12000,maxRedirects:3});
 const fetcher=createCompositePageFetcher(realFetcher);
 return json(await new CompanyAnalysisService(repo,fetcher,log).analyze_company(id,fixture?'test_fixture':'official_website'));
 }
 if(action==='observations'&&method==='GET'&&!observationId)return json(await checked(db.from('prospect_observations').select('*').eq('prospect_id',id).order('created_at')));
 if(action==='observations'&&method==='POST'&&observationId&&['confirm','contradict','unverify'].includes(decision)){
 uuid.parse(observationId);await checked(db.from('prospect_observations').select('id').eq('id',observationId).eq('prospect_id',id).single());return json(await checked(db.rpc('review_discovery_observation',{p_observation_id:observationId,p_decision:decision})));
 }
 }
 return json({error:'Route Discovery inconnue'},404);
 }catch(e){const code=e instanceof Error?e.message:'DISCOVERY_FAILED';const messages:Record<string,string>={BRAVE_NOT_CONFIGURED:'Brave est implémenté mais sa clé API n’est pas configurée.',SOURCE_POLICY_REQUIRED:'Analyse bloquée : l’opérateur doit autoriser ce domaine dans DISCOVERY_ALLOWED_HOSTS après revue de ses conditions.',OFFICIAL_WEBSITE_REQUIRED:'Renseignez et confirmez le site officiel avant analyse.',QUOTA_EXCEEDED:'Quota horaire de votre organisation atteint.',BETA_ACCESS_EXPIRED:'Votre accès bêta est terminé.',ENTITLEMENT_REQUIRED:'Cette fonctionnalité nécessite une activation bêta. Contactez-nous pour y accéder.',MAX_RESULTS_EXCEEDED:'Le nombre demandé dépasse la limite configurée par l’opérateur.',ANALYSIS_FAILED:'Analyse impossible : source, robots, réseau ou politique de sécurité. Aucune preuve validée.',DISCOVERY_FAILED:'La recherche a échoué. Consultez son état ; aucune preuve n’a été validée.',DATABASE_REQUEST_FAILED:'Opération refusée : vérifiez les droits, l’état du résultat et la migration Discovery.'};return json({error:messages[code]??'Requête Discovery invalide',code:code in messages?code:'INVALID_REQUEST'},code==='QUOTA_EXCEEDED'?429:code==='BETA_ACCESS_EXPIRED'?402:code==='ENTITLEMENT_REQUIRED'?403:code==='BRAVE_NOT_CONFIGURED'||code==='SOURCE_POLICY_REQUIRED'?503:400)}
}
