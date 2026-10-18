// Recherche 2.0 bench data (/ui-v2/search, Preview only). Frozen DiscoveryView states — the shape DiscoveryPanel hands
// to its v2 view — so every state can be reviewed without an account, a provider or a quota: results (relevant, to
// document, signal source, no signal, new, seen, added and verified, not identified), empty, loading, error, quota.
// Fictitious companies, .example domains. Every action only records its name for the bench.
import {createRef} from 'react';
import type {DiscoveryView,ResultFacts} from '../../../components/DiscoveryPanel.tsx';
import type {DiscoveryResult} from '../../../discovery/types.ts';
import type {RunSummary} from '../../../discovery/run-history.ts';
import type {ReviewPriority} from '../../../discovery/review-priority.ts';
import {noveltyCounts,type Novelty,type NoveltyStatus} from '../../../discovery/novelty.ts';
import {translate,type TKey} from '../../../i18n/index.ts';
import type {Criterion} from '../../../domain/core.ts';

export type BenchState='results'|'empty'|'loading'|'error'|'quota'|'start';
export const BENCH_STATES:readonly BenchState[]=['results','empty','loading','error','quota','start'];

const CRITERIA:Criterion[]=[{key:'target_fit',label:'Restauration indépendante en Occitanie',weight:40},{key:'need_fit',label:'Besoin d’un canal de commande direct',weight:35},
 {key:'contactability',label:'Canal de contact professionnel documenté',weight:25}];
const NOW='2026-10-18T09:30:00.000Z';
const nov=(status:NoveltyStatus,run_id:string|null=null,prospect_id:string|null=null):Novelty=>({status,basis:status==='NEW'?null:'domain',prospect_id,run_id,result_id:null});

type Row={r:DiscoveryResult;f:ResultFacts;p:ReviewPriority|null};
function row(id:string,o:{name:string;city:string|null;host:string;title:string;status?:DiscoveryResult['status'];prospect?:string|null;cls:ResultFacts['cls'];
 sourceType?:string;named?:boolean;domain?:boolean;novelty?:Novelty|null;priority?:ReviewPriority|null;score?:ResultFacts['score'];dedupe?:DiscoveryResult['dedupe_status']}):Row{
 const status=o.status??'pending';const canAdd=o.cls==='COMPANY_CANDIDATE';
 const meta={company_name_status:o.named===false?'UNRESOLVED':'RESOLVED',company_domain_status:o.domain?'RESOLVED':'UNRESOLVED',source_class:o.cls??undefined,source_type:o.sourceType} as ResultFacts['meta'];
 const r:DiscoveryResult={id,status,prospect_id:o.prospect??null,dedupe_status:o.dedupe??'unique',duplicate_of:null,source_class:o.cls,
  normalized_payload:{name:o.name,canonical_url:null,website:o.domain?`https://${o.host}`:null,city:o.city,address:null,phone:null,discovered_source:'fixture',
   source_url:`https://${o.host}/page`,source_title:o.title,discovery_timestamp:NOW,confidence:0.6,raw_metadata:{},deduplication_key:id}};
 const nameResolved=canAdd&&o.named!==false;const viaThirdParty=o.cls==='SIGNAL_SOURCE'||(canAdd&&!!o.sourceType&&o.sourceType!=='official_site');
 const state:ResultFacts['state']=status==='accepted'?'added':status==='ignored'?'ignored':canAdd?'candidate':'unresolved';
 const n=o.novelty??null;
 return {r,p:o.priority??null,f:{meta,cls:o.cls,canAdd,legacy:o.cls===null,nameResolved,viaThirdParty,domainResolved:!!o.domain,
  typeKey:o.sourceType?(`discovery.sourceType.${o.sourceType}` as TKey):undefined,sourceHost:o.host,state,hist:n,nov:n,
  alreadyProspect:status==='pending'&&n?.status==='ADDED'&&!!n.prospect_id,score:o.score??null}};
}
const ROWS:Row[]=[
 row('r1',{name:'Kantina Toulouse',city:'Toulouse',host:'kantina.example',title:'Kantina — restaurant, commande en ligne',cls:'COMPANY_CANDIDATE',sourceType:'official_site',domain:true,
  novelty:nov('NEW'),priority:{level:'HIGH',reasons:['official_site','website_identified','query_terms_observed','location_mentioned']}}),
 row('r2',{name:'Le Comptoir des Halles',city:'Montpellier',host:'presse-occitanie.example',title:'Ouverture du Comptoir des Halles',cls:'COMPANY_CANDIDATE',sourceType:'directory',
  novelty:nov('NEW'),priority:{level:'MEDIUM',reasons:['named_by_third_party','location_mentioned']}}),
 row('r3',{name:'Bistro Nîmois',city:'Nîmes',host:'bistronimois.example',title:'Bistro Nîmois',cls:'COMPANY_CANDIDATE',sourceType:'official_site',domain:true,
  novelty:nov('SEEN','run-old'),priority:{level:'LOW',reasons:['single_query_term']}}),
 row('r4',{name:'La Pausa',city:'Nîmes',host:'lapausa.example',title:'La Pausa — pizzeria',status:'accepted',prospect:'p-pausa',cls:'COMPANY_CANDIDATE',sourceType:'official_site',domain:true,
  novelty:nov('ADDED',null,'p-pausa'),priority:{level:'HIGH',reasons:['official_site']},score:{kind:'verified',main:75,verified:75,toVerify:0,toVerifyPoints:0}}),
 row('r5',{name:'Offre d’emploi : cuisinier (H/F)',city:null,host:'emplois.example',title:'Cuisinier H/F — Toulouse',cls:'SIGNAL_SOURCE',sourceType:'job_board',named:false}),
];
const SUMMARY:RunSummary={id:'run-bench',query:'restaurant indépendant',location:'Occitanie',categories:['restauration'],provider:'fixture',status:'completed',started_at:NOW,completed_at:NOW,
 result_count:ROWS.length,max_results:20,accepted_count:1,ignored_count:0,search_mode:'all',desired_new_results:null,search:null,partial:null,reused:null,
 novelty:noveltyCounts(ROWS.map(x=>x.f.nov))};
const OLD:RunSummary={...SUMMARY,id:'run-old',query:'brasserie',location:'Nîmes',started_at:'2026-10-11T08:00:00.000Z',completed_at:'2026-10-11T08:00:00.000Z',result_count:6,accepted_count:2,ignored_count:1};

export function benchView(state:BenchState,act:(name:string)=>void,tab:'ALL'|NoveltyStatus,setTab:(k:'ALL'|NoveltyStatus)=>void):DiscoveryView{
 const tr=(k:TKey)=>translate('fr',k);const withRun=state==='results'||state==='empty';
 const rows=state==='results'?ROWS:[];
 const candidates=rows.map(x=>x.r);const shown=candidates.filter(r=>tab==='ALL'||rows.find(x=>x.r.id===r.id)!.f.nov?.status===tab);
 const facts=new Map(rows.map(x=>[x.r.id,x]));
 return {tr,locale:'fr',mode:'demo',projectName:'Banc Recherche 2.0',offer:'Commande directe et fidélité pour la restauration indépendante.',criteria:CRITERIA,
  busy:state==='loading',error:state==='error'?'La recherche n’a pas pu aboutir. Réessayez dans un instant.':state==='quota'?'Quota de recherches atteint pour cette période. Il se renouvelle à la prochaine échéance.':'',
  info:'',replayed:false,deepPending:false,
  form:{fields:{query:withRun||state==='loading'?'restaurant indépendant':'',location:withRun||state==='loading'?'Occitanie':'',categories:'',max:20,provider:'fixture',searchMode:'all',desiredNew:null},
   setFields:()=>act('fields'),provider:'fixture',setProvider:()=>act('provider'),available:false,registryAvailable:false,headcount:{min:'',max:''},typeHeadcount:()=>act('headcount'),
   formRef:createRef<HTMLFormElement>(),formOpen:!withRun,setFormOpen:o=>act(o?'form-open':'form-close'),submit:()=>act('search'),registryPlan:null},
  run:withRun?SUMMARY.id:'',current:withRun?{...SUMMARY,result_count:rows.length}:null,runs:state==='start'?[]:[...(withRun?[SUMMARY]:[]),OLD],hasMoreRuns:false,historyError:false,cost:null,
  results:candidates,candidates,discarded:[],shown,resultsShown:6,showMore:()=>act('more'),morePage:0,
  counts:{added:rows.filter(x=>x.r.status==='accepted').length,ignored:0,unresolved:rows.filter(x=>x.f.cls!=='COMPANY_CANDIDATE').length},
  hasNovelty:rows.some(x=>x.f.nov),noveltyTotals:noveltyCounts(rows.map(x=>x.f.nov)),
  tabCount:k=>k==='ALL'?candidates.length:rows.filter(x=>x.f.nov?.status===k).length,noveltyTab:tab,selectTab:setTab,
  factsOf:r=>facts.get(r.id)!.f,priorityOf:r=>facts.get(r.id)!.p??{level:'LOW',reasons:[]},canOpenProspect:true,discardedLabel:()=>null,
  accept:async r=>act(`add:${r.id}`),ignore:async r=>act(`ignore:${r.id}`),openProspect:id=>act(`open:${id}`),openRun:async id=>act(`run:${id}`),
  viewRun:async s=>act(`view:${s.id}`),replay:s=>act(`replay:${s.id}`),moreRuns:async()=>act('more-runs')};
}
