'use client';
import {useState,useEffect,useRef} from 'react';
import {FixtureProvider,FIXTURE_LABEL} from '../discovery/providers/fixture';
import {DiscoveryInputSchema,type DiscoveryResult} from '../discovery/types';
import {DeduplicationService} from '../discovery/deduplication';
import {scoreProspect,type Criterion,type Prospect} from '../domain/core';
import {translate,searchDoneNote,discoveryFoundNote,runDateLabel,runCountsLabel,resultsSummaryLabel,noveltySummaryLabel,runNoveltyLabel,deepStopLabel,passesLabel,deepPassLine,newActorsFoundLabel,type Locale,type TKey} from '../i18n';
import {noveltyOf,displayNovelty,decidedNovelty,noveltyCounts,newFirst,isEligibleCandidate,NOVELTY_STATUSES,type NoveltyStatus} from '../discovery/novelty';
import {reviewPriority,byReviewPriority,type ReviewPriority} from '../discovery/review-priority';
import {MAX_PROVIDER_CALLS,type SearchMode} from '../discovery/search-until-new';
import {createInFlight} from './evidence-verification';
import {summarizeRuns,runState,replayFields,HISTORY_FIRST_PAGE,HISTORY_MORE_PAGE,HISTORY_MAX,type RunSummary,type ReplayFields} from '../discovery/run-history';
type CompanyNameStatus='RESOLVED'|'UNRESOLVED';
type CompanyDomainStatus='RESOLVED'|'UNRESOLVED';
type SourceClass='COMPANY_CANDIDATE'|'SIGNAL_SOURCE'|'IRRELEVANT'|'UNCERTAIN';
type ResolutionMeta={company_name_status?:CompanyNameStatus;company_domain_status?:CompanyDomainStatus;source_class?:SourceClass;source_type?:string;admissibility?:{reason_code?:string};additional_sources?:Array<{source_url:string;source_title:string}>};
const REASON_KEYS:Record<string,TKey>={TRAINING_COURSE_PAGE:'discovery.reason.TRAINING_COURSE_PAGE',DIRECTORY_PAGE:'discovery.reason.DIRECTORY_PAGE',PUBLIC_DIRECTORY_PAGE:'discovery.reason.PUBLIC_DIRECTORY_PAGE',SOCIAL_PROFILE_PAGE:'discovery.reason.SOCIAL_PROFILE_PAGE',EXCLUDED_BY_QUERY:'discovery.reason.EXCLUDED_BY_QUERY',ENTITY_UNRESOLVED:'discovery.reason.ENTITY_UNRESOLVED',NO_OBSERVABLE_RELEVANCE:'discovery.reason.NO_OBSERVABLE_RELEVANCE',LOCATION_MISMATCH:'discovery.reason.LOCATION_MISMATCH',SECTOR_BODY_PAGE:'discovery.reason.SECTOR_BODY_PAGE'};
const SOURCE_TYPE_KEYS:Record<string,TKey>={official_site:'discovery.sourceType.official_site',job_board:'discovery.sourceType.job_board',marketplace:'discovery.sourceType.marketplace',directory:'discovery.sourceType.directory',search_page:'discovery.sourceType.search_page',editorial:'discovery.sourceType.editorial',individual_profile:'discovery.sourceType.individual_profile',unknown:'discovery.sourceType.unknown'};
const metaOf=(r:DiscoveryResult)=>r.normalized_payload.raw_metadata as ResolutionMeta;
// Persisted rows carry the database's source_class column (the authority, NULL for rows written before
// classification existed); demo rows are built in the browser and only carry the metadata copy.
const classOf=(r:DiscoveryResult):SourceClass|null=>r.source_class!==undefined?r.source_class:metaOf(r).source_class??null;
type Api=(path:string,method?:string,body?:unknown)=>Promise<any>;
// Demo mode keeps its runs in this browser only (same shape as the live history), never on a server.
type DemoRun={summary:RunSummary;results:DiscoveryResult[]};
const demoKey=(projectId:string)=>`prospectos-discovery-runs:${projectId}`;
function readDemoRuns(projectId:string):DemoRun[]{try{return JSON.parse(localStorage.getItem(demoKey(projectId))??'[]')}catch{return []}}
function writeDemoRuns(projectId:string,runs:DemoRun[]){try{localStorage.setItem(demoKey(projectId),JSON.stringify(runs.slice(0,20)))}catch{/* best effort */}}
const scrollKey=(projectId:string)=>`prospectos-discovery-scroll:${projectId}`;
// Results shown at once; more on demand (never 20 full cards in a row).
const RESULTS_PAGE=6;
// Desktop compares: a full run (20) fits in the dense table; phones keep the short progressive page.
const RESULTS_PAGE_DESKTOP=20;
const resultsPage=()=>{try{return window.matchMedia('(min-width:1024px)').matches?RESULTS_PAGE_DESKTOP:RESULTS_PAGE}catch{return RESULTS_PAGE}};
const STATE_LABEL:Record<'candidate'|'added'|'ignored'|'unresolved',TKey>={candidate:'discovery.state.candidate',added:'discovery.addedToProject',ignored:'discovery.ignoredBadge',unresolved:'discovery.state.unresolved'};
const EMPTY_FIELDS:ReplayFields={query:'',location:'',categories:'',max:20,provider:'fixture',searchMode:'all',desiredNew:null};
export function DiscoveryPanel({projectId,projectName,offer,criteria,mode,api,onAdded,existing,locale,activeRunId=null,onActiveRunChange,onOpenProspect,onProjectChanged}:{projectId:string;projectName:string;offer:string;criteria:Criterion[];mode:'demo'|'live';api:Api;onAdded:(p:Prospect)=>void;existing:Prospect[];locale:Locale;activeRunId?:string|null;onActiveRunChange?:(runId:string|null)=>void;onOpenProspect?:(prospectId:string)=>void;onProjectChanged?:()=>void}){
 const tr=(key:TKey)=>translate(locale,key);
 const launching=useRef(createInFlight());
 const [provider,setProvider]=useState('fixture');const [available,setAvailable]=useState(false);const [results,setResults]=useState<DiscoveryResult[]>([]);const [run,setRun]=useState('');const [runs,setRuns]=useState<RunSummary[]|null>(null);const [current,setCurrent]=useState<RunSummary|null>(null);const [fields,setFields]=useState<ReplayFields>(EMPTY_FIELDS);const [replayed,setReplayed]=useState(false);const [historyError,setHistoryError]=useState(false);const [hasMoreRuns,setHasMoreRuns]=useState(false);const [resultsShown,setResultsShown]=useState(RESULTS_PAGE);const [formOpen,setFormOpen]=useState(true);const [noveltyTab,setNoveltyTab]=useState<'ALL'|NoveltyStatus>('ALL');const formRef=useRef<HTMLFormElement>(null);const [cost,setCost]=useState<any>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [info,setInfo]=useState('');const [deepPending,setDeepPending]=useState(false);const version=useRef(0);
 useEffect(()=>{version.current++;setResults([]);setRun('');setCost(null);setCurrent(null);setRuns(null);setHistoryError(false);let cancelled=false;if(mode==='live')api('discovery-config').then(c=>{if(!cancelled)setAvailable(c.providers.some((p:any)=>p.id==='brave'&&p.available))}).catch(()=>{if(!cancelled)setError(tr('discovery.configUnavailable'))});
 // History and the run that was open before leaving this screen: reads only, never a search.
 // The remembered run may be older than the first page of the history: it is then read on its own.
 loadHistory(HISTORY_FIRST_PAGE).then(async list=>{if(cancelled||!activeRunId)return;let summary=list?.find(r=>r.id===activeRunId)??(mode==='demo'?readDemoRuns(projectId).find(r=>r.summary.id===activeRunId)?.summary:undefined)??null;
  if(!summary&&mode==='live'){try{summary=summarizeRuns([await api(`discovery-runs/${activeRunId}`)])[0]??null}catch{summary=null}}
  if(summary&&!cancelled)void viewRun(summary,true)});
 return()=>{cancelled=true;version.current++}},[projectId,mode]);
 // The first HISTORY_FIRST_PAGE runs (one more is asked for, to know whether "more" exists); a refresh keeps
 // the number of runs already shown. Reads only.
 async function loadHistory(count=Math.max(HISTORY_FIRST_PAGE,runs?.length??0)):Promise<RunSummary[]|null>{
  const want=Math.min(count,HISTORY_MAX);
  if(mode==='demo'){const all=readDemoRuns(projectId).map(r=>r.summary);const list=all.slice(0,want);setRuns(list);setHasMoreRuns(all.length>want);return list}
  try{const all=summarizeRuns(await api(`projects/${projectId}/discovery?limit=${Math.min(want+1,HISTORY_MAX)}&offset=0`));const list=all.slice(0,want);setRuns(list);setHasMoreRuns(all.length>want&&want<HISTORY_MAX);setHistoryError(false);return list}catch{setRuns([]);setHasMoreRuns(false);setHistoryError(true);return null}
 }
 // "Afficher 10 de plus": the next page only (offset = runs already shown).
 async function moreRuns(){await execute(async()=>{const shown=runs?.length??0;if(mode==='demo'){await loadHistory(shown+HISTORY_MORE_PAGE);return}
  const page=summarizeRuns(await api(`projects/${projectId}/discovery?limit=${HISTORY_MORE_PAGE+1}&offset=${shown}`));
  const next=[...(runs??[]),...page.slice(0,HISTORY_MORE_PAGE).filter(r=>!runs?.some(x=>x.id===r.id))].slice(0,HISTORY_MAX);setRuns(next);setHasMoreRuns(page.length>HISTORY_MORE_PAGE&&next.length<HISTORY_MAX)})}
 // "Voir les résultats": the stored results of that run, exactly as they are now (accepted, ignored…).
 // GET only — no provider call, no quota, no new run.
 // Demo: the same current-status enrichment as the server's run read (display only), against the project's prospects.
 async function withCurrentStatus(rows:DiscoveryResult[]):Promise<DiscoveryResult[]>{
  const {currentProjectStatuses}=await import('../discovery/novelty-engine');
  const now=currentProjectStatuses(rows.map(r=>({id:r.id,status:r.status,company_name:r.normalized_payload.name,website:r.normalized_payload.website,phone:r.normalized_payload.phone,city:r.normalized_payload.city,source_url:r.normalized_payload.source_url,source_class:classOf(r),normalized_payload:r.normalized_payload})),existing.map(x=>({id:x.id,name:x.name,website:x.website,city:x.city})));
  return rows.map(r=>r.status==='accepted'?r:{...r,current_project_status:now.get(r.id)??null});
 }
 async function viewRun(summary:RunSummary,restoreScroll=false){await execute(async()=>{const revision=version.current;let rows:DiscoveryResult[];
  if(mode==='demo')rows=await withCurrentStatus(readDemoRuns(projectId).find(r=>r.summary.id===summary.id)?.results??[]);
  else rows=await api(`discovery-runs/${summary.id}/results`);
  if(revision!==version.current)return;setResults(rows);setNoveltyTab(summary.search_mode==='new_first'?'NEW':'ALL');setRun(summary.id);setFormOpen(false);setCurrent({...summary,accepted_count:rows.filter(r=>r.status==='accepted').length,ignored_count:rows.filter(r=>r.status==='ignored').length});setCost(null);setReplayed(false);onActiveRunChange?.(summary.id);
  // Back from a prospect: the same Novelty filter and number of results are shown again, then the same scroll
  // position — only for the run the prospect was opened from.
  let y=0,shown=resultsPage();if(restoreScroll){try{const saved=JSON.parse(sessionStorage.getItem(scrollKey(projectId))??'null');if(typeof saved==='number')y=saved;else if(saved&&(!saved.run||saved.run===summary.id)){y=Number(saved.y)||0;shown=Math.max(RESULTS_PAGE,Number(saved.shown)||RESULTS_PAGE);if(saved.tab==='ALL'||NOVELTY_STATUSES.includes(saved.tab))setNoveltyTab(saved.tab)}}catch{}}
  setResultsShown(shown);if(y>0)requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,y)))
 })}
 // "Rejouer la recherche": fills the form only. Nothing is sent until the user clicks "Lancer la recherche".
 // "Voir l'ancien run" of a result already seen: opens that earlier run (read only, never a provider call).
 async function openRun(runId:string){let summary=runs?.find(r=>r.id===runId)??null;
  if(!summary&&mode==='demo')summary=readDemoRuns(projectId).find(x=>x.summary.id===runId)?.summary??null;
  if(!summary&&mode==='live'){try{summary=summarizeRuns([await api(`discovery-runs/${runId}`)])[0]??null}catch{summary=null}}
  if(summary?.id)await viewRun(summary)}
 function replay(summary:RunSummary){const f=replayFields(summary,mode==='live'&&available);setFields(f);setProvider(f.provider);setReplayed(true);setFormOpen(true);requestAnimationFrame(()=>{formRef.current?.scrollIntoView({behavior:'smooth',block:'start'});(formRef.current?.elements.namedItem('query') as HTMLInputElement|null)?.focus({preventScroll:true})})}
 // An added candidate shows its prospect's current score — the existing engine, on human-verified
 // evidence only (never a discovery signal).
 function addedScore(r:DiscoveryResult):number|null{if(r.status!=='accepted'||!r.prospect_id)return null;const p=existing.find(x=>x.id===r.prospect_id);if(!p)return null;try{return scoreProspect(criteria,p.evidence).score}catch{return null}}
 // Leaving for a prospect ("Voir le prospect", or a candidate just added): what is on screen is remembered.
 function rememberView(){try{sessionStorage.setItem(scrollKey(projectId),JSON.stringify({y:window.scrollY,shown:resultsShown,tab:noveltyTab,run}))}catch{}}
 function openProspect(prospectId:string){rememberView();onOpenProspect?.(prospectId)}
 async function execute(fn:()=>Promise<void>){setBusy(true);setError('');setInfo('');try{await fn()}catch(e){setError(e instanceof Error?e.message:tr('error.generic'))}finally{setBusy(false);setDeepPending(false)}}
 // One launch at a time: a double click or a double submit never starts (nor bills) a second run.
 async function search(form:FormData){await launching.current.run('search',async()=>{await execute(async()=>{const revision=version.current;setCost(null);const input=DiscoveryInputSchema.parse({project_id:projectId,query:String(form.get('query')),location:String(form.get('location')),categories:String(form.get('categories')||'').split(',').map(s=>s.trim()).filter(Boolean),max_results:Number(form.get('max')),optional_filters:{provider,offer,criteria,
  // The search mode is the user's explicit choice; a deep search carries its new-actors target and the hard cap.
  ...(fields.searchMode!=='all'?{search_mode:fields.searchMode}:{}),...(fields.searchMode==='search_new'?{desired_new_results:Math.min(Number(form.get('max')),Math.max(1,fields.desiredNew??Number(form.get('max')))),max_provider_calls:MAX_PROVIDER_CALLS}:{})}});
  setDeepPending(input.optional_filters.search_mode==='search_new');const startedAt=new Date().toISOString();let rows:DiscoveryResult[];let id:string;
 if(mode==='demo'){const p=new FixtureProvider(),d=new DeduplicationService();id=crypto.randomUUID();
  // Same project memory as the server, from this browser's earlier demo runs and the project's prospects.
  const past=readDemoRuns(projectId);const {ProjectNovelty}=await import('../discovery/novelty-engine');const novelty=new ProjectNovelty({prospects:existing.map(x=>({id:x.id,name:x.name,website:x.website,city:x.city})),runs:past.map(x=>({id:x.summary.id,location:x.summary.location})),results:past.flatMap(x=>x.results.map(r=>({id:r.id,discovery_run_id:x.summary.id,status:r.status,prospect_id:r.prospect_id,company_name:r.normalized_payload.name,website:r.normalized_payload.website,phone:r.normalized_payload.phone,city:r.normalized_payload.city,source_url:r.normalized_payload.source_url,source_class:classOf(r)})))},input.location);
  rows=(await p.searchCompanies(input)).map(raw=>{const n=p.normalizeResult(raw),match=d.match(n,existing);const c={...n,raw_metadata:{...n.raw_metadata,novelty:novelty.classify(n,{duplicateOf:match.status==='duplicate_candidate'?match.duplicate_of:null})}};return {id:crypto.randomUUID(),normalized_payload:c,dedupe_status:match.status,duplicate_of:match.duplicate_of,status:'pending',prospect_id:null,reason:match.reason}})}else {const response=await api(`projects/${projectId}/discovery`,'POST',input);id=response.id;rows=response.results}
 if(revision!==version.current)return;setResults(rows);setNoveltyTab(input.optional_filters.search_mode==='new_first'?'NEW':'ALL');setRun(id);setReplayed(false);setResultsShown(resultsPage());
 // A new search is a new run: the older ones stay in the history untouched.
 const summary:RunSummary={id,query:input.query,location:input.location,categories:input.categories,provider:provider==='brave'?'brave':'fixture',status:'completed',started_at:startedAt,completed_at:new Date().toISOString(),result_count:rows.length,max_results:input.max_results,accepted_count:0,ignored_count:0,search_mode:input.optional_filters.search_mode??'all',desired_new_results:input.optional_filters.desired_new_results??null,search:null,novelty:rows.some(r=>noveltyOf(r.normalized_payload.raw_metadata))?noveltyCounts(rows.filter(r=>isEligibleCandidate(classOf(r))).map(r=>noveltyOf(r.normalized_payload.raw_metadata))):null};
 if(mode==='demo')writeDemoRuns(projectId,[{summary,results:rows},...readDemoRuns(projectId)]);
 const list=await loadHistory();if(revision!==version.current)return;setFormOpen(false);setCurrent(list?.find(r=>r.id===id)??summary);onActiveRunChange?.(id);
 // Cost observability is discreet and best-effort: never lets a metrics fetch failure hide an
 // otherwise-successful search from the user. Demo mode has no server-side run at all — nothing to
 // fetch, cost stays null (never a fabricated demo figure).
 if(mode==='live'){try{const c=await api(`discovery-runs/${id}/cost`);if(revision===version.current)setCost(c)}catch{/* Cost visibility is best-effort. */}}
 });
 // A search that failed server-side still left its run: the history shows it with its status.
 if(mode==='live')void loadHistory()})}
 async function accept(row:DiscoveryResult,force=false){await execute(async()=>{const revision=version.current;let p:Prospect;if(mode==='demo'){if(row.dedupe_status==='merge_review_required'&&!force)throw Error(tr('discovery.mergeReviewRequired'));const duplicate=row.duplicate_of&&existing.find(p=>p.id===row.duplicate_of);p=duplicate||{id:crypto.randomUUID(),project_id:projectId,organization_id:'demo-organization',name:row.normalized_payload.name,website:row.normalized_payload.website??'',city:row.normalized_payload.city??'',status:'À analyser',evidence:[],channels:[]};localStorage.setItem(`prospectos-discovery-origin:${p.id}`,'fixture')}else{try{p={...await api(`discovery-results/${row.id}/accept`,'POST',{force_separate:force}),evidence:[],channels:[]}}catch(e){
   // Stale screen (the actor was added meanwhile, from another run, tab or user): the server refused a second
   // prospect. Not an error for the user — the row is reconciled to "Déjà ajouté" with its prospect.
   if((e as {code?:string}).code==='ALREADY_ADDED'){await reconcileAlreadyAdded(row,(e as {prospect_id?:string}).prospect_id??null,revision);return}throw e}}if(revision!==version.current)return;setResults(rs=>rs.map(r=>r.id===row.id?{...r,status:'accepted',prospect_id:p.id}:r));recordDecision(row.id,{status:'accepted',prospect_id:p.id});rememberView();onAdded(p)})}
 async function ignore(r:DiscoveryResult){await execute(async()=>{if(mode==='live')await api(`discovery-results/${r.id}/ignore`,'POST',{});setResults(rs=>rs.map(x=>x.id===r.id?{...x,status:'ignored'}:x));recordDecision(r.id,{status:'ignored'})})}
 // The run's stored results reflect the decision (demo: this browser; live: the server already has it).
 async function reconcileAlreadyAdded(row:DiscoveryResult,prospectId:string|null,revision:number){
  if(prospectId)setResults(rs=>rs.map(r=>r.id===row.id?{...r,current_project_status:{status:'ADDED',prospect_id:prospectId}}:r));
  setInfo(tr('novelty.alreadyAddedNotice'));onProjectChanged?.();
  // Then the run as the server sees it now (every row's current status), without leaving the current filter.
  if(mode==='live'&&run){try{const fresh:DiscoveryResult[]=await api(`discovery-runs/${run}/results`);if(revision===version.current)setResults(fresh)}catch{/* the local reconciliation above stands */}}
 }
 function recordDecision(resultId:string,patch:Partial<DiscoveryResult>){
  if(mode==='demo'&&run){const all=readDemoRuns(projectId).map(d=>{if(d.summary.id!==run)return d;const results=d.results.map(r=>r.id===resultId?{...r,...patch}:r);return {results,summary:{...d.summary,accepted_count:results.filter(r=>r.status==='accepted').length,ignored_count:results.filter(r=>r.status==='ignored').length}}});writeDemoRuns(projectId,all)}
  void loadHistory();
 }
 // A page with no resolved organization is never presented as a prospect: IRRELEVANT results are kept
 // out of the candidate list (visible below, collapsed, for transparency) and UNCERTAIN ones can only
 // be ignored. The server enforces the same rule on accept.
 const discarded=results.filter(r=>classOf(r)==='IRRELEVANT');
 const candidates=results.filter(r=>classOf(r)!=='IRRELEVANT');
 // Novelty (novelty.ts): what the project already knew when this run was made. Default order puts the new
 // actors first (B4); narrowing to one status is only ever the user's choice (B5). Older runs carry no
 // label and keep their order.
 // Only an exploitable candidate (COMPANY_CANDIDATE) is new / seen / added / ignored: unresolved sources carry no
 // novelty label, count in no novelty tab and come after the exploitable candidates.
 const eligible=(r:DiscoveryResult)=>isEligibleCandidate(classOf(r));
 const histOf=(r:DiscoveryResult)=>eligible(r)?noveltyOf(r.normalized_payload.raw_metadata):null;
 // Shown: the run's snapshot enriched with the actor's CURRENT project status (added since?) — display only.
 // Tabs and counters: a result decided in this very run follows that decision — added → "Ajoutés", ignored →
 // "Ignorés" (its card keeps the run's label next to its decision). The snapshot and the run's metrics are untouched.
 const novOf=(r:DiscoveryResult)=>eligible(r)?decidedNovelty(histOf(r),r,r.current_project_status):null;
 const hasNovelty=candidates.some(r=>novOf(r)!==null);
 const noveltyTotals=noveltyCounts(candidates.map(novOf));
 const tabCount=(k:'ALL'|NoveltyStatus)=>k==='ALL'?candidates.length:candidates.filter(r=>novOf(r)?.status===k).length;
 // Order from the run's snapshot (stable: a row reconciled to "Déjà ajouté" stays where the user tapped it);
 // tabs and counters from what is shown now.
 // Review priority (review-priority.ts): within each novelty level, the candidates most worth a look come first.
 // The stored value is used when present; older rows get it computed from the same observations.
 const priorityOf=(r:DiscoveryResult):ReviewPriority=>{const stored=(r.normalized_payload.raw_metadata as {review_priority?:ReviewPriority}|undefined)?.review_priority;return stored&&['HIGH','MEDIUM','LOW'].includes(stored.level)?stored:reviewPriority(r.normalized_payload.raw_metadata,r.normalized_payload.website)};
 const prioritized=byReviewPriority(candidates.filter(eligible),r=>priorityOf(r));
 const shown=(hasNovelty?[...newFirst(prioritized,histOf),...candidates.filter(r=>!eligible(r))]:[...prioritized,...candidates.filter(r=>!eligible(r))]).filter(r=>noveltyTab==='ALL'||novOf(r)?.status===noveltyTab);
 const counts={added:results.filter(r=>r.status==='accepted').length,ignored:results.filter(r=>r.status==='ignored').length,unresolved:results.filter(r=>classOf(r)!=='COMPANY_CANDIDATE').length};
 // One compact line per result: who, how well it is resolved, where, from which source, its state and the
 // actions that make sense for it. Everything else stays one tap away in "Voir le détail".
 const resultCard=(r:DiscoveryResult)=>{const meta=metaOf(r);const cls=classOf(r);const canAdd=cls==='COMPANY_CANDIDATE';const legacy=cls===null;const nameResolved=canAdd&&meta.company_name_status==='RESOLVED';const viaThirdParty=cls==='SIGNAL_SOURCE'||(canAdd&&!!meta.source_type&&meta.source_type!=='official_site');const domainResolved=meta.company_domain_status==='RESOLVED';const typeKey=meta.source_type?SOURCE_TYPE_KEYS[meta.source_type]:undefined;let sourceHost='';try{sourceHost=new URL(r.normalized_payload.source_url).hostname.replace(/^www\./,'')}catch{}
  const state=r.status==='accepted'?'added':r.status==='ignored'?'ignored':canAdd?'candidate':'unresolved';
  // Already a prospect of this project (novelty.ts): never offered as a second prospect — "Voir le prospect".
  const hist=histOf(r);const nov=r.status==='pending'?novOf(r):eligible(r)?displayNovelty(hist,r.current_project_status):null;const alreadyProspect=r.status==='pending'&&nov?.status==='ADDED'&&!!nov.prospect_id;const score=addedScore(r);
  return <article className={`discovery-result compact state-${state}`} key={r.id}>
   <div className="result-title">{nameResolved?<h3>{r.normalized_payload.name}</h3>:<h3>{legacy?tr('discovery.legacyUnclassified'):tr('discovery.unresolvedCompany')}</h3>}<p className="muted result-sub">{nameResolved?(domainResolved?tr('discovery.resolutionBothLabel'):tr('discovery.resolutionNameOnlyLabel')):typeKey?tr(typeKey):tr('discovery.class.uncertain')}</p>{canAdd&&(()=>{const pr=priorityOf(r);return <p className={`review-priority priority-${pr.level.toLowerCase()}`}><span className="pill">{tr('discovery.reviewPriority')} : {tr(`discovery.priority.${pr.level}` as TKey)}</span> <span className="muted">{pr.reasons.slice(0,4).map(x=>tr(`discovery.priorityReason.${x}` as TKey)).join(' · ')}</span></p>})()}</div>
   <p className="result-zone">{r.normalized_payload.city??(typeof (meta as {observed_location?:unknown}).observed_location==='string'?`${(meta as {observed_location:string}).observed_location} · ${tr('discovery.locationMentioned')}`:tr('discovery.cityToConfirm'))}</p>
   <div className="result-state-cell"><span className={`pill result-state state-${state}`}>{tr(STATE_LABEL[state])}</span>{nov&&<span className={`pill novelty novelty-${nov.status.toLowerCase()}`} title={hist&&hist.status!==nov.status?`${tr('novelty.atRunTime')} ${tr(`novelty.${hist.status}` as TKey)}`:undefined}>{tr(`novelty.${nov.status}` as TKey)}</span>}{(nov?.status==='SEEN'||nov?.status==='IGNORED')&&nov.run_id&&nov.run_id!==run&&<button type="button" className="text-button novelty-link" disabled={busy} onClick={()=>openRun(nov.run_id!)}>{tr('novelty.viewOldRun')}</button>}</div>
   <p className="muted result-source"><a href={r.normalized_payload.source_url} title={r.normalized_payload.source_url} rel="noreferrer" target="_blank">{tr('discovery.source')} {sourceHost||r.normalized_payload.source_title} ↗</a>{score!==null&&<> · {tr('discovery.prospectScore')} <b>{score}/100</b></>}</p>
   {r.status==='pending'&&r.dedupe_status!=='unique'&&<p className="note result-dedupe">{r.reason??tr('discovery.possibleDuplicate')} · {r.dedupe_status==='duplicate_candidate'?tr('discovery.existingProspect'):tr('discovery.noAutoMerge')}</p>}
   <div className="actions">{alreadyProspect?<>{onOpenProspect&&<button className="text-button" onClick={()=>openProspect(nov!.prospect_id!)}>{tr('discovery.viewProspect')}</button>}</>:r.status==='pending'&&!canAdd?<button disabled={busy} onClick={()=>ignore(r)}>{tr('discovery.ignore')}</button>:r.status==='pending'?<><button disabled={busy} className="primary" onClick={()=>accept(r,r.dedupe_status==='merge_review_required')}>{r.dedupe_status==='merge_review_required'?tr('discovery.addSeparately'):r.dedupe_status==='duplicate_candidate'?tr('discovery.openExisting'):tr('discovery.addThenAnalyze')}</button><button disabled={busy} onClick={()=>ignore(r)}>{tr('discovery.ignore')}</button></>:<>{r.status==='accepted'&&r.prospect_id&&onOpenProspect&&<button className="text-button" onClick={()=>openProspect(r.prospect_id!)}>{tr('discovery.viewProspect')}</button>}</>}</div>
   <details className="result-detail"><summary>{tr('discovery.viewDetail')}</summary>
    {cls&&<p className="eyebrow">{cls==='COMPANY_CANDIDATE'?tr('discovery.class.companyCandidate'):cls==='SIGNAL_SOURCE'?tr('discovery.class.signalSource'):tr('discovery.class.uncertain')}</p>}
    {nameResolved&&<p className="muted">{tr('discovery.resolutionLabel')} : {domainResolved?tr('discovery.resolutionBothLabel'):tr('discovery.resolutionNameOnlyLabel')}</p>}{nameResolved&&<p><b>{tr('discovery.identifiedCompanyLabel')}</b> {r.normalized_payload.name} · <b>{tr('discovery.companyWebsiteLabel')}</b> {r.normalized_payload.website??tr('discovery.websitePendingReview')} · <b>{tr('discovery.signalFoundVia')}</b> {sourceHost}</p>}
    {viaThirdParty&&<p className="muted">{typeKey?`${tr(typeKey)} · `:''}{tr('discovery.signalSourceNote')}</p>}
    {!!meta.additional_sources?.length&&<p className="muted">{tr('discovery.otherSources')} : {meta.additional_sources.map((s,i)=><a key={i} href={s.source_url} rel="noreferrer" target="_blank">{i?' · ':''}{s.source_title} ↗</a>)}</p>}
    <p><a href={r.normalized_payload.source_url} rel="noreferrer" target="_blank">{r.normalized_payload.source_title} ↗</a></p>
    <p className="muted">{discoveryFoundNote(locale,Math.round(r.normalized_payload.confidence*100),r.normalized_payload.discovered_source)}</p>
    {score===null&&<p>{tr('discovery.currentScore')} <b>0/100</b> — {tr('discovery.noEvidenceAtDiscovery')}</p>}
    {canAdd&&<p className="muted">{tr('discovery.priorityExplain')}</p>}
    {r.status==='pending'&&!canAdd&&<p className="muted">{tr('discovery.notAddable')}</p>}
   </details>
  </article>};
 return <section className="card discovery"><p className="eyebrow">{tr('discovery.eyebrow')}</p><h2>{tr('discovery.title')}</h2>{mode==='demo'&&<div className="note">{tr('discovery.demoNote')}</div>}
  <details className="note discovery-context"><summary><b>{tr('discovery.activeProject')}</b> {projectName}</summary><p><b>{tr('discovery.offerUsed')}</b> {offer.trim()||tr('discovery.noOffer')}</p><p><b>{tr('discovery.icpUsed')}</b> {criteria.map(c=>c.label).join(' · ')||tr('discovery.noCriteria')}</p></details>
  <div className={`discovery-layout${current?' has-run':''}`}><div className="discovery-main"><details className={`search-form${current?' collapsible':''}`} open={formOpen||!current} onToggle={e=>setFormOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>{tr('discovery.newSearch')}</summary><div className="note">{provider==='fixture'?FIXTURE_LABEL:tr('discovery.braveNote')}</div><form ref={formRef} onSubmit={e=>{e.preventDefault();search(new FormData(e.currentTarget))}}><div className="discovery-fields"><label>{tr('discovery.queryLabel')}<input name="query" placeholder={tr('discovery.queryPlaceholder')} required maxLength={250} value={fields.query} onChange={e=>setFields(f=>({...f,query:e.target.value}))}/></label><label>{tr('discovery.locationLabel')}<input name="location" placeholder={tr('discovery.locationPlaceholder')} required maxLength={120} value={fields.location} onChange={e=>setFields(f=>({...f,location:e.target.value}))}/></label><label>{tr('discovery.categoriesLabel')}<input name="categories" placeholder={tr('discovery.categoriesPlaceholder')} value={fields.categories} onChange={e=>setFields(f=>({...f,categories:e.target.value}))}/></label><label>{tr('discovery.maxResultsLabel')}<input name="max" type="number" min={1} max={20} value={fields.max} onChange={e=>setFields(f=>({...f,max:Number(e.target.value)}))}/></label><label>{tr('deep.modeLabel')}<select name="search_mode" value={fields.searchMode} onChange={e=>setFields(f=>({...f,searchMode:e.target.value as SearchMode}))}><option value="all">{tr('deep.mode.all')}</option><option value="new_first">{tr('deep.mode.new_first')}</option><option value="search_new" disabled={mode==='demo'}>{tr('deep.mode.search_new')}</option></select></label>{fields.searchMode==='search_new'&&<label>{tr('deep.targetLabel')}<input name="desired" type="number" min={1} max={fields.max} value={fields.desiredNew??fields.max} onChange={e=>setFields(f=>({...f,desiredNew:Number(e.target.value)}))}/><small className="muted deep-hint">{tr('deep.hint')}</small></label>}<label>{tr('discovery.sourceLabel')}<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="fixture">{tr('discovery.fixtureOption')}</option><option value="brave" disabled={mode==='demo'||!available}>Brave Search {available&&mode==='live'?tr('discovery.braveConfigured'):tr('discovery.braveNotConfigured')}</option></select></label></div><button className="primary" disabled={busy||!projectId}>{tr('discovery.runSearch')}</button></form></details>{replayed&&<p className="note" role="status">{tr('discovery.replayNote')}</p>}{busy&&deepPending&&<p className="note deep-status" role="status">{tr('deep.running')}</p>}{info&&<p role="status" className="note novelty-info">{info}</p>}{error&&<p role="alert" className="note">{error}</p>}
  {current&&<div className="run-current" id="discovery-current-run"><p className="eyebrow">{tr('discovery.viewingRun')} {runDateLabel(locale,current.started_at)}</p><p className="clamp-2"><b>{current.query}</b> · {current.location}{current.categories.length?` · ${current.categories.join(', ')}`:''}</p><p className="muted">{tr(`discovery.runStatus.${runState(current)}` as TKey)} · {current.provider==='brave'?tr('discovery.providerBrave'):tr('discovery.providerFixture')}</p></div>}
  {run&&<p className="results-summary"><b>{resultsSummaryLabel(locale,results.length,counts.added,counts.ignored,counts.unresolved)}</b><span className="muted"> — {searchDoneNote(locale,results.length,provider==='fixture'?tr('discovery.fixtureIndependent'):tr('discovery.candidatePages'))}</span></p>}
  {cost&&<div className="note discovery-cost"><p><b>{tr('discovery.estimatedCost')}</b> {cost.total_estimated_cost_micros!=null?`${(cost.total_estimated_cost_micros/1000000).toFixed(4)} $`:tr('discovery.costUnavailable')}</p><p><b>{tr('discovery.searches')}</b> {cost.search_requests} · <b>{tr('discovery.prospectsCreated')}</b> {cost.prospects_created} · <b>{tr('discovery.evidenceVerified')}</b> {cost.evidence_verified}</p><p className="muted">{cost.cost_unavailable_reason??tr('discovery.defaultCostReason')}</p></div>}{current?.search&&<div className="deep-summary"><p><b>{passesLabel(locale,current.search.passes)}</b> · {current.search.stop_reason==='TARGET_REACHED'?deepStopLabel(locale,'TARGET_REACHED',current.search.new_results_found):<>{newActorsFoundLabel(locale,current.search.new_results_found)} · {deepStopLabel(locale,current.search.stop_reason,current.search.new_results_found)}</>}</p><details className="deep-detail"><summary>{tr('deep.detailTitle')}</summary><ul>{current.search.pass_results.map((n,i)=><li key={i}>{deepPassLine(locale,i+1,n,current.search!.pass_new_results[i]??0,current.search!.pass_durations_ms[i]??0)}</li>)}</ul><p className="muted">{tr('deep.limitsNote')}</p></details></div>}{hasNovelty&&<div className="novelty-bar"><p className="novelty-summary"><b>{noveltySummaryLabel(locale,noveltyTotals)}</b></p><div className="novelty-tabs" role="group" aria-label={tr('novelty.filterAria')}>{(['ALL','NEW','SEEN','ADDED','IGNORED','CURRENT_RUN_DUPLICATE'] as const).filter(k=>k!=='CURRENT_RUN_DUPLICATE'||tabCount(k)>0).map(k=><button key={k} type="button" className={`novelty-tab${noveltyTab===k?' active':''}`} aria-pressed={noveltyTab===k} onClick={()=>{setNoveltyTab(k);setResultsShown(resultsPage())}}>{tr(`novelty.tab.${k}` as TKey)} <b>{tabCount(k)}</b></button>)}</div><p className="muted novelty-note">{tr('novelty.newFirstNote')}</p></div>}<div className="discovery-results">{candidates.length>0&&<div className="results-head" aria-hidden="true"><span>{tr('discovery.col.actor')}</span><span>{tr('discovery.col.zone')}</span><span>{tr('discovery.col.status')}</span><span className="col-resolution">{tr('discovery.col.resolution')}</span><span>{tr('discovery.col.source')}</span><span>{tr('discovery.col.action')}</span></div>}{shown.slice(0,resultsShown).map(resultCard)}{hasNovelty&&!shown.length&&<p className="muted novelty-empty">{tr('novelty.emptyTab')}</p>}</div>
  {shown.length>resultsShown&&<button className="more-button" onClick={()=>setResultsShown(n=>n+resultsPage())}>{tr('discovery.showMoreResults')} ({Math.min(resultsPage(),shown.length-resultsShown)})</button>}
  {discarded.length>0&&<details className="note discovery-discarded"><summary>{tr('discovery.discardedTitle')} ({discarded.length})</summary><p className="muted">{tr('discovery.discardedNote')}</p>{discarded.map(r=>{const typeKey=metaOf(r).source_type?SOURCE_TYPE_KEYS[metaOf(r).source_type!]:undefined;const reasonKey=metaOf(r).admissibility?.reason_code?REASON_KEYS[metaOf(r).admissibility!.reason_code!]:undefined;return <p key={r.id}>{reasonKey?`${tr(reasonKey)} · `:typeKey?`${tr(typeKey)} · `:''}<a href={r.normalized_payload.source_url} rel="noreferrer" target="_blank">{r.normalized_payload.source_title} ↗</a></p>})}</details>}
  </div><aside className="discovery-side" aria-label={tr('discovery.historyTitle')}>{runs&&runs.length>0&&!current&&<div className="run-last"><p className="eyebrow">{tr('discovery.lastSearch')} · {runDateLabel(locale,runs[0].started_at)}</p><p className="clamp-2"><b>{runs[0].query}</b></p><p className="muted clamp-2">{runs[0].location} · {runCountsLabel(locale,runs[0].result_count,runs[0].accepted_count,runs[0].ignored_count)}</p><button disabled={busy} onClick={()=>viewRun(runs[0])}>{tr('discovery.resumeResults')}</button></div>}
  <section className="run-history" aria-labelledby="run-history-title"><h3 id="run-history-title">{tr('discovery.historyTitle')}</h3>{!!runs?.length&&<div className="history-head" aria-hidden="true"><span>{tr('discovery.col.date')}</span><span>{tr('discovery.col.query')}</span><span>{tr('discovery.col.zone')}</span><span>{tr('discovery.col.status')}</span><span>{tr('discovery.col.results')}</span><span>{tr('discovery.col.action')}</span></div>}{historyError&&<p className="muted">{tr('discovery.historyUnavailable')}</p>}{runs&&!runs.length&&!historyError&&<p className="muted">{tr('discovery.historyEmpty')}</p>}
   {runs?.map(h=>{const state=runState(h);return <article key={h.id} className={`run-card compact state-${state}${current?.id===h.id?' selected':''}`}><p className="muted run-date">{runDateLabel(locale,h.started_at)}</p><span className={`pill run-status run-state-${state}`}>{tr(`discovery.runStatus.${state}` as TKey)}</span><h4 className="run-query clamp-2" title={h.query}>{h.query}</h4><p className="muted run-zone"><span className="clamp-1">{h.location}</span></p><p className="muted run-counts">{runCountsLabel(locale,h.result_count,h.accepted_count,h.ignored_count)}{h.novelty&&<span className="run-novelty">{runNoveltyLabel(locale,h.novelty)}{h.search&&` · ${passesLabel(locale,h.search.passes)}`}</span>}</p><div className="actions"><button disabled={busy} onClick={()=>viewRun(h)}>{tr('discovery.viewResults')}</button><button disabled={busy} onClick={()=>replay(h)}>{tr('discovery.replay')}</button></div></article>})}
   {hasMoreRuns&&<button className="more-button" disabled={busy} onClick={moreRuns}>{tr('discovery.showMoreRuns')}</button>}
  </section></aside></div></section>
}
