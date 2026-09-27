// V2 P0-C — Novelty engine: "has this project already seen this actor?"
// Pure functions over rows already read under RLS (the project's prospects and its earlier Discovery
// results): one batch read per run, matching in memory — never one query per result, never a provider
// call, never another project's or organization's rows (the caller only ever passes the current project's).
//
// NEW                   never seen in this project
// SEEN                  surfaced by an earlier run of this project, never added
// ADDED                 already a prospect of this project
// IGNORED               explicitly ignored in an earlier run of this project
// CURRENT_RUN_DUPLICATE the same actor already appears earlier in this very run
//
// Identity, strongest first (B2, novelty-engine.ts): the prospect link, the organization's own domain, a strong resolved
// identifier (phone), then the canonical name WITH a compatible location. Never a weak name similarity alone,
// never a name when both sides have a website and the websites differ, never a directory's domain.

export type NoveltyStatus='NEW'|'SEEN'|'ADDED'|'IGNORED'|'CURRENT_RUN_DUPLICATE';
export type NoveltyBasis='prospect_id'|'domain'|'phone'|'name_location'|'source_url';
// Stored with the result (normalized_payload.raw_metadata.novelty): what the project knew when the run
// was made. The earlier run stays unchanged; a later run gets its own snapshot.
export type Novelty={status:NoveltyStatus;basis:NoveltyBasis|null;prospect_id:string|null;run_id:string|null;result_id:string|null};
export const NOVELTY_STATUSES:readonly NoveltyStatus[]=['NEW','SEEN','ADDED','IGNORED','CURRENT_RUN_DUPLICATE'];

export type NoveltySubject={name:string;website?:string|null;phone?:string|null;city?:string|null;source_url:string;raw_metadata?:Record<string,unknown>};
export type ProspectMemory={id:string;name:string;website?:string|null;phone?:string|null;city?:string|null};
export type ResultMemory={id:string;discovery_run_id:string;status:string;prospect_id:string|null;company_name:string;website:string|null;phone?:string|null;city:string|null;source_url:string;source_class?:string|null;name_status?:string|null;domain_status?:string|null};
export type RunLocation={id:string;location:string};
export type ProjectMemory={prospects:ProspectMemory[];results:ResultMemory[];runs:RunLocation[];truncated?:boolean};
// The matching itself (identity, ProjectNovelty) lives in novelty-engine.ts: it needs the entity
// resolution helpers, which the browser only loads on demand.

// Run counters (metrics jsonb, B11) and the two market-saturation ratios (B12). Ratios, not a score: they
// describe a market over time and never rank or rate a prospect.
export type NoveltyCounts={results_total:number;new_results:number;seen_results:number;already_added:number;ignored_results:number;duplicate_results:number};
export function noveltyCounts(list:Array<Pick<Novelty,'status'>|null|undefined>,mergedInRun=0):NoveltyCounts{
 const n=(s:NoveltyStatus)=>list.filter(x=>x?.status===s).length;
 return {results_total:list.length,new_results:n('NEW'),seen_results:n('SEEN'),already_added:n('ADDED'),ignored_results:n('IGNORED'),duplicate_results:n('CURRENT_RUN_DUPLICATE')+mergedInRun};
}
// A "new prospect" is only ever an exploitable organization: a COMPANY_CANDIDATE (the admissibility gate's own
// class). Pages set aside (IRRELEVANT) and unresolved sources (UNCERTAIN, SIGNAL_SOURCE) are counted apart, as
// rejected — never as new, seen, added, ignored or duplicate. Identity and admissibility are not changed here.
export const isEligibleCandidate=(sourceClass:unknown):boolean=>sourceClass==='COMPANY_CANDIDATE';
export type EligibleNoveltyCounts=NoveltyCounts&{eligible_candidates_total:number;rejected_results:number};
// Run counters on one coherent universe: novelty counters over the exploitable candidates only;
// results_total stays every result of the run, rejected_results the rest.
export function eligibleNoveltyCounts<T>(rows:T[],sourceClass:(row:T)=>unknown,novelty:(row:T)=>Pick<Novelty,'status'>|null|undefined,mergedInRun=0):EligibleNoveltyCounts{
 const eligible=rows.filter(r=>isEligibleCandidate(sourceClass(r)));
 return {...noveltyCounts(eligible.map(novelty),mergedInRun),results_total:rows.length,eligible_candidates_total:eligible.length,rejected_results:rows.length-eligible.length};
}
export function noveltyRates(c:NoveltyCounts):{new_discovery_rate:number|null;repeat_rate:number|null}{
 // Relevant results: the distinct actors of the run (a duplicate within the run is not a second actor).
 const base=c.new_results+c.seen_results+c.already_added+c.ignored_results;
 if(!base)return {new_discovery_rate:null,repeat_rate:null};
 const r=(x:number)=>Math.round(x/base*1000)/1000;
 return {new_discovery_rate:r(c.new_results),repeat_rate:r(c.seen_results+c.already_added+c.ignored_results)};
}
// What the screen shows for a result: its historical novelty (the snapshot of the run, never rewritten)
// enriched with its CURRENT project status. An actor added since the run is shown as ADDED ("Voir le
// prospect", no "Ajouter"); an actor the snapshot says ADDED whose prospect no longer exists is shown as
// seen before (never a dead "Voir le prospect"). `current` undefined = not enriched: the snapshot as is.
export function displayNovelty(historical:Novelty|null,current:{status:'ADDED';prospect_id:string}|null|undefined):Novelty|null{
 if(current)return {status:'ADDED',basis:historical?.basis??'prospect_id',prospect_id:current.prospect_id,run_id:historical?.run_id??null,result_id:historical?.result_id??null};
 if(current===null&&historical?.status==='ADDED')return {...historical,status:'SEEN',prospect_id:null};
 return historical;
}
// What the run's tabs and counters count: a result already decided in this very run follows that decision (added →
// ADDED with its prospect, ignored → IGNORED); an undecided one follows displayNovelty. Display only: the snapshot
// and the run's metrics are never rewritten. No snapshot (older runs, unresolved sources): nothing to count.
export function decidedNovelty(historical:Novelty|null,row:{status:string;prospect_id:string|null},current:{status:'ADDED';prospect_id:string}|null|undefined):Novelty|null{
 if(!historical)return current?displayNovelty(null,current):null;
 if(row.status==='accepted'&&row.prospect_id)return displayNovelty(historical,{status:'ADDED',prospect_id:row.prospect_id});
 if(row.status==='ignored')return {...historical,status:'IGNORED',prospect_id:null};
 return displayNovelty(historical,current);
}
export function noveltyOf(raw:unknown):Novelty|null{
 const n=(raw as {novelty?:unknown}|null|undefined)?.novelty as Novelty|undefined;
 return n&&NOVELTY_STATUSES.includes(n.status)?n:null;
}

// Display order (B4): new actors first, then already seen, ignored, already added, this run's duplicates;
// the run's own order inside each group. Results without novelty (older runs) keep their order.
const RANK:Record<NoveltyStatus,number>={NEW:0,SEEN:1,IGNORED:2,ADDED:3,CURRENT_RUN_DUPLICATE:4};
export function newFirst<T>(rows:T[],novelty:(row:T)=>Novelty|null):T[]{
 return rows.map((row,i)=>({row,i,rank:(()=>{const n=novelty(row);return n?RANK[n.status]:0})()})).sort((a,b)=>a.rank-b.rank||a.i-b.i).map(x=>x.row);
}

// ---------------------------------------------------------------------------------------------------
// B8 — prepared, NOT implemented. A later version may keep searching with query variants until enough new
// actors are found, within a provider-call budget. It would reuse ProjectNovelty + entityKey:
//   searchUntilNewTarget({desiredNewResults, maxProviderCalls, seenEntityIds})
//   query 1 → drop known → variant 2 → keep new → … until the target, the budget or the search space ends.
// Version 1 makes no additional provider call.
export type SearchUntilNewTarget={desiredNewResults:number;maxProviderCalls:number;seenEntityIds:ReadonlySet<string>};
export type SearchUntilNewTargetResult={newResults:number;providerCalls:number;stop:'target_reached'|'budget_exhausted'|'search_space_exhausted'};
