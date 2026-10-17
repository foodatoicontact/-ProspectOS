// Next Best Action V1 — HTTP routes. Thin: feature flag → validation → the pure engine (src/nba/engine.ts) → the
// migration-031 functions. Every read is the member's (RLS); every write goes through a 031 function.
//
//  POST /projects/:id/next-best-actions/compute    recompute the project's recommendations (no external call, no cost)
//  GET  /projects/:id/next-best-actions            the queue — filters: action, state, signal_type, min_score, min_freshness, limit
//  GET  /projects/:id/next-best-actions/today      TODAY: the N actions that deserve attention (default 10, max 50)
//  GET  /projects/:id/next-best-actions/feedback   recommended vs human action, decisions and outcomes (counts only)
//  GET  /next-best-actions/:id                     one recommendation, its proof (signals, contents, evidence) and history
//  POST /next-best-actions/:id/decision            {decision, reason?, snooze_days?, human_action?}
//  POST /next-best-actions/:id/outcome             {outcome, note?}
//
// NEXT_BEST_ACTION_ENABLED absent or anything but "true"/"1": every route answers 404. Nothing here sends anything.
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {checked} from '../discovery/repository.ts';
import {projectCriteria} from '../domain/relations.ts';
import {attachEvidenceSources} from '../server/evidence-sources.ts';
import {intentProfileOf,signalRow} from '../signals/context.ts';
import {buildOpportunity,todayOf,byPriority,NBA_ACTIONS,NBA_DEFAULT_CONFIG,NBA_OUTCOMES,type NbaPublicContent,type NbaSignal,type Opportunity,type QueueItem} from './engine.ts';
import {prepareContent} from './content.ts';
import {COMMERCIAL_SIGNAL_TYPES} from './registry.ts';

export function nextBestActionEnabled(env:Record<string,string|undefined>):boolean{
 const v=(env.NEXT_BEST_ACTION_ENABLED??'').trim().toLowerCase();
 return v==='true'||v==='1';
}
export function isNbaPath(path:readonly string[]):boolean{
 const [resource,,action]=path;
 return resource==='next-best-actions'||(resource==='projects'&&action==='next-best-actions');
}
export const NOT_AVAILABLE={error:'Route ou action non disponible'};
type Json=(value:unknown,status?:number)=>Response;
export type NbaDeps={enabled:boolean;now:()=>Date;requireEntitlement:()=>Promise<void>};

const uuid=z.string().uuid();
const MAX_PROSPECTS=500;
const CHUNK=100;
const QueueQuery=z.object({
 action:z.enum(NBA_ACTIONS).optional(),
 state:z.enum(['PENDING','APPROVED','DONE','SNOOZED','REJECTED','EXPIRED']).default('PENDING'),
 signal_type:z.enum(COMMERCIAL_SIGNAL_TYPES).optional(),
 min_score:z.coerce.number().int().min(0).max(100).optional(),
 min_freshness:z.coerce.number().int().min(0).max(100).optional(),
 limit:z.coerce.number().int().min(1).max(200).default(100),
}).strict();
const DecisionSchema=z.object({
 decision:z.enum(['APPROVED','DONE','SNOOZED','REJECTED','PENDING']),
 reason:z.string().trim().max(500).optional(),
 snooze_days:z.number().int().min(1).max(90).optional(),
 human_action:z.enum([...NBA_ACTIONS,'OTHER']).optional(),
}).strict().refine(b=>b.decision!=='SNOOZED'||b.snooze_days!==undefined,{message:'snooze_days required'});
const OutcomeSchema=z.object({outcome:z.enum(NBA_OUTCOMES),note:z.string().trim().max(500).optional()}).strict();

const REFUSALS:Record<string,[string,number]>={
 INVALID_REQUEST:['Requête invalide.',400],
 ENTITLEMENT_REQUIRED:['Un accès actif est nécessaire : choisissez une offre pour continuer.',403],
 BETA_ACCESS_EXPIRED:['Votre accès a expiré : vos données restent consultables. Choisissez une offre pour continuer.',402],
 NOT_FOUND:['Recommandation introuvable.',404],
 INVALID_TRANSITION:['Cette décision n’est pas possible dans l’état actuel de la recommandation.',409],
 RECOMMENDATION_EXPIRED:['Cette recommandation a expiré : la raison d’agir ne compte plus.',409],
 OUTCOME_REQUIRES_DONE:['Un résultat ne s’enregistre que sur une action faite.',409],
 DATABASE_REQUEST_FAILED:['Opération refusée : vérifiez vos droits.',400],
};
const refuse=(json:Json,code:string)=>{const [error,status]=REFUSALS[code]??REFUSALS.DATABASE_REQUEST_FAILED!;return json({error,code:code in REFUSALS?code:'DATABASE_REQUEST_FAILED'},status)};
async function rpc(query:PromiseLike<any>){
 const {data,error}=await query;
 if(error){const msg=String(error.message??'');for(const code of ['INVALID_TRANSITION','RECOMMENDATION_EXPIRED','OUTCOME_REQUIRES_DONE'])if(msg.includes(code))throw Error(code);
  if(msg.includes('not found'))throw Error('NOT_FOUND');throw Error('DATABASE_REQUEST_FAILED')}
 return data;
}
const QUEUE_COLUMNS='id,project_id,prospect_id,recommended_action,rule,state,opportunity_score,fit_score,fit_basis,intent_score,timing_score,freshness_score,evidence_quality_score,primary_kind,primary_signal_type,primary_evidence_status,signal_age_days,primary_detail,target,explanation,prepared_content,computed_at,expires_at,snoozed_until,human_action,outcome,prospects(name,city,website,status)';

// Everything the engine needs for the project's prospects, read as the member (RLS).
async function loadProject(db:SupabaseClient,projectId:string){
 const project=await checked(db.from('projects').select('id,offer,icps(*)').eq('id',projectId).single());
 const raw=await checked(db.from('prospects').select('id,project_id,name,status,evidence(*)').eq('project_id',projectId).order('created_at',{ascending:false}).limit(MAX_PROSPECTS));
 const prospects=await attachEvidenceSources(db,raw??[]);
 const ids=prospects.map((p:any)=>p.id);
 const signals:NbaSignal[]=[];const content:(NbaPublicContent&{prospect_id:string})[]=[];
 for(let i=0;i<ids.length;i+=CHUNK){
  const slice=ids.slice(i,i+CHUNK);
  for(const r of await checked(db.from('signals').select('id,prospect_id,provider,signal_type,status,title,excerpt,source_url,source_domain,source_type,confidence,event_date,published_at,observed_at,matched_terms,event_key')
   .in('prospect_id',slice).in('status',['VERIFIED','PENDING_REVIEW']).limit(2000)))signals.push({...signalRow(r),provider:r.provider,event_key:r.event_key,prospect_id:r.prospect_id} as NbaSignal&{prospect_id:string});
  for(const r of await checked(db.from('prospect_public_content').select('id,prospect_id,status,source_url,source_domain,author,content,published_at,observed_at')
   .in('prospect_id',slice).eq('status','VERIFIED').limit(2000)))content.push(r);
 }
 return {project,prospects,signals:signals as (NbaSignal&{prospect_id:string})[],content,profile:await intentProfileOf(db,projectId)};
}

export function computeProject(data:Awaited<ReturnType<typeof loadProject>>,now:Date):{opportunities:Opportunity[];items:Record<string,unknown>[]}{
 const criteria=projectCriteria(data.project.icps);
 const opportunities:Opportunity[]=[];const items:Record<string,unknown>[]=[];
 for(const p of data.prospects as any[]){
  const signals=data.signals.filter(s=>s.prospect_id===p.id);const publicContent=data.content.filter(c=>c.prospect_id===p.id);
  const o=buildOpportunity({prospect:{id:p.id,project_id:p.project_id,name:p.name,status:p.status},criteria,evidence:p.evidence??[],signals,publicContent,profile:data.profile,now});
  const prepared=prepareContent({opportunity:o,name:p.name,offer:data.project.offer??'',criteria,evidence:p.evidence??[],signals,publicContent,profile:data.profile,now});
  opportunities.push(o);
  items.push({prospect_id:o.prospect_id,recommended_action:o.recommended_action,rule:o.rule,scores:o.scores,primary:o.primary,signal_ids:o.signal_ids,
   public_content_ids:o.public_content_ids,evidence_ids:o.evidence_ids,target:o.target,explanation:o.explanation,prepared_content:prepared,
   fingerprint:o.fingerprint,config_version:o.config_version,computed_at:o.computed_at,expires_at:o.expires_at});
 }
 return {opportunities,items};
}

export async function handleNextBestActions(request:Request,path:string[],body:unknown,db:SupabaseClient,json:Json,deps:NbaDeps):Promise<Response|null>{
 if(!isNbaPath(path))return null;
 if(!deps.enabled)return json(NOT_AVAILABLE,404);
 const [resource,id,action,sub]=path;const method=request.method;
 try{
  if(resource==='projects'){
   const project_id=uuid.parse(id);
   if(method==='POST'&&sub==='compute'){
    z.object({}).strict().parse(body??{});
    await deps.requireEntitlement();
    const now=deps.now();
    await rpc(db.rpc('refresh_nba_states',{p_project_id:project_id}));
    const data=await loadProject(db,project_id);
    const {opportunities,items}=computeProject(data,now);
    const totals={created:0,unchanged:0,superseded:0,kept_approved:0};
    for(let i=0;i<items.length;i+=CHUNK){const r=await rpc(db.rpc('save_nba_actions',{p_project_id:project_id,p_items:items.slice(i,i+CHUNK)}));for(const k of Object.keys(totals) as (keyof typeof totals)[])totals[k]+=Number(r?.[k]??0)}
    const byAction=Object.fromEntries(NBA_ACTIONS.map(a=>[a,opportunities.filter(o=>o.recommended_action===a).length]));
    return json({prospects:opportunities.length,by_action:byAction,...totals,config_version:NBA_DEFAULT_CONFIG.version},201);
   }
   if(method==='GET'&&!sub){
    const url=new URL(request.url);const q=QueueQuery.parse(Object.fromEntries(url.searchParams));
    await rpc(db.rpc('refresh_nba_states',{p_project_id:project_id}));
    let query=db.from('nba_actions').select(QUEUE_COLUMNS).eq('project_id',project_id).eq('state',q.state);
    if(q.action)query=query.eq('recommended_action',q.action);
    if(q.signal_type)query=query.eq('primary_signal_type',q.signal_type);
    if(q.min_score!==undefined)query=query.gte('opportunity_score',q.min_score);
    if(q.min_freshness!==undefined)query=query.gte('freshness_score',q.min_freshness);
    const rows=await checked(query.order('opportunity_score',{ascending:false}).limit(q.limit));
    return json([...(rows??[])].sort((a:any,b:any)=>byPriority(a as QueueItem,b as QueueItem)));
   }
   if(method==='GET'&&sub==='today'){
    const url=new URL(request.url);
    const limit=z.coerce.number().int().min(1).max(NBA_DEFAULT_CONFIG.today.maxLimit).default(NBA_DEFAULT_CONFIG.today.defaultLimit).parse(url.searchParams.get('limit')??undefined);
    await rpc(db.rpc('refresh_nba_states',{p_project_id:project_id}));
    const rows=await checked(db.from('nba_actions').select(QUEUE_COLUMNS).eq('project_id',project_id).eq('state','PENDING').in('recommended_action',['CONTACT','ENGAGE','WATCH'])
     .order('opportunity_score',{ascending:false}).limit(200));
    return json({limit,items:todayOf((rows??[]) as unknown as QueueItem[],limit)});
   }
   if(method==='GET'&&sub==='feedback'){
    const rows=await checked(db.from('nba_actions').select('recommended_action,human_action,state,outcome,primary_signal_type').eq('project_id',project_id).limit(5000));
    const count=(key:(r:any)=>string)=>{const m:Record<string,number>={};for(const r of rows??[]){const k=key(r);m[k]=(m[k]??0)+1}return m};
    return json({total:(rows??[]).length,
     by_recommended_and_state:count(r=>`${r.recommended_action}:${r.state}`),
     recommended_vs_human:count(r=>`${r.recommended_action}→${r.human_action??'—'}`),
     outcomes_by_action:count(r=>`${r.recommended_action}:${r.outcome??'—'}`),
     outcomes_by_signal_type:count(r=>`${r.primary_signal_type??'none'}:${r.outcome??'—'}`)});
   }
   return json(NOT_AVAILABLE,404);
  }
  // /next-best-actions/:id[/decision|/outcome]
  const action_id=uuid.parse(id);
  if(method==='GET'&&!action){
   const a=await checked(db.from('nba_actions').select('*,prospects(name,city,website,status)').eq('id',action_id).single());
   const ids=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];
   const [signals,content,evidence,events]=await Promise.all([
    ids(a.signal_ids).length?checked(db.from('signals').select('id,signal_type,status,title,excerpt,source_url,source_domain,event_date,published_at,observed_at').in('id',ids(a.signal_ids))):[],
    ids(a.public_content_ids).length?checked(db.from('prospect_public_content').select('id,status,source_url,source_domain,author,content,published_at').in('id',ids(a.public_content_ids))):[],
    ids(a.evidence_ids).length?checked(db.from('evidence').select('id,criterion,value,status,source_url,excerpt,observed_at').in('id',ids(a.evidence_ids))):[],
    checked(db.from('nba_action_events').select('from_state,to_state,kind,human_action,outcome,reason,created_at').eq('action_id',action_id).order('created_at')),
   ]);
   return json({...a,proof:{signals,public_content:content,evidence},history:events});
  }
  if(method==='POST'&&action==='decision'){
   const b=DecisionSchema.parse(body??{});
   const until=b.decision==='SNOOZED'?new Date(deps.now().getTime()+b.snooze_days!*86400000).toISOString():null;
   return json(await rpc(db.rpc('decide_nba_action',{p_action_id:action_id,p_decision:b.decision,p_reason:b.reason??null,p_snooze_until:until,p_human_action:b.human_action??null})));
  }
  if(method==='POST'&&action==='outcome'){
   const b=OutcomeSchema.parse(body??{});
   return json(await rpc(db.rpc('record_nba_outcome',{p_action_id:action_id,p_outcome:b.outcome,p_note:b.note??null})));
  }
  return json(NOT_AVAILABLE,404);
 }catch(e){
  if(e instanceof z.ZodError)return refuse(json,'INVALID_REQUEST');
  const code=e instanceof Error?e.message:'';
  return refuse(json,code in REFUSALS?code:'DATABASE_REQUEST_FAILED');
 }
}
