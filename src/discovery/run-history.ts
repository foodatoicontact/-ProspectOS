import {SEARCH_MODES,STOP_REASONS,type SearchMode,type StopReason} from './search-until-new.ts';
// Discovery run history: what the project's past searches were and what became of their results.
// Pure functions over rows already read under RLS — never a provider call, never a write. Shared by the
// API (GET projects/:id/discovery) and the panel (demo mode keeps the same shape in localStorage).
export type RunStatus = 'running' | 'completed' | 'failed';
export type RunState = RunStatus | 'interrupted';
export type RunSummary = {
 id: string; query: string; location: string; categories: string[]; provider: 'fixture' | 'brave';
 status: RunStatus; started_at: string; completed_at: string | null; result_count: number; max_results: number | null;
 accepted_count: number; ignored_count: number;
 // Novelty counters of the run (metrics jsonb, novelty.ts) — null for runs made before the novelty engine.
 novelty: RunNovelty | null;
 // The search mode the user chose (filters_json) — replayed as is; 'all' for runs made before the modes.
 search_mode: SearchMode; desired_new_results: number | null;
 // Search-Until-New outcome (metrics jsonb) — null for any other run.
 search: RunSearch | null;
};
export type RunSearch = {passes: number; provider_calls: number; stop_reason: StopReason; desired_new_results: number | null; new_results_found: number;
 pass_results: number[]; pass_new_results: number[]; pass_durations_ms: number[]};
export type RunNovelty = {results_total: number; new_results: number; seen_results: number; already_added: number; ignored_results: number; duplicate_results: number};
type RunRow = {id: string; query: string; location: string; categories: unknown; provider: string; filters_json?: unknown; status: string; started_at: string; completed_at: string | null; result_count: number;
 // Present when the row is already a summary (the panel re-reads the API's answer) or a raw run row.
 max_results?: number | null; accepted_count?: number; ignored_count?: number; novelty?: RunNovelty | null; metrics?: unknown;
 search_mode?: SearchMode; desired_new_results?: number | null; search?: RunSearch | null};
const NOVELTY_KEYS = ['results_total', 'new_results', 'seen_results', 'already_added', 'ignored_results', 'duplicate_results'] as const;
const nums = (v: unknown): number[] => Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
function runSearch(r: RunRow): RunSearch | null {
 if (r.search !== undefined) return r.search;
 const m = r.metrics as Record<string, unknown> | null | undefined;
 if (!m || m.search_mode !== 'search_new' || !STOP_REASONS.includes(m.stop_reason as StopReason) || typeof m.search_passes !== 'number') return null;
 return {passes: m.search_passes, provider_calls: typeof m.provider_calls === 'number' ? m.provider_calls : m.search_passes, stop_reason: m.stop_reason as StopReason,
  desired_new_results: typeof m.desired_new_results === 'number' ? m.desired_new_results : null, new_results_found: typeof m.new_results_found === 'number' ? m.new_results_found : 0,
  pass_results: nums(m.pass_results), pass_new_results: nums(m.pass_new_results), pass_durations_ms: nums(m.pass_durations_ms)};
}
function runNovelty(r: RunRow): RunNovelty | null {
 if (r.novelty !== undefined) return r.novelty;
 const m = r.metrics as Record<string, unknown> | null | undefined;
 if (!m || !NOVELTY_KEYS.every(k => typeof m[k] === 'number')) return null;
 return Object.fromEntries(NOVELTY_KEYS.map(k => [k, m[k] as number])) as RunNovelty;
}
type DecidedRow = {discovery_run_id: string; status: string};

// A run still "running" long after it started never finished (the request died): shown as interrupted,
// never as a search still in progress. Display only — the stored row is left as it is.
export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;
export function runState(run: Pick<RunSummary, 'status' | 'started_at'>, now = new Date()): RunState {
 if (run.status !== 'running') return run.status;
 return now.getTime() - new Date(run.started_at).getTime() > RUN_STALE_AFTER_MS ? 'interrupted' : 'running';
}

// Newest first; a new run never replaces an older one (each search is its own row).
// Without `decided` (the panel re-reading the API's answer), the counts already in the row are kept.
export function summarizeRuns(runs: RunRow[], decided?: DecidedRow[]): RunSummary[] {
 return runs.map((r): RunSummary => {
  const filters = r.filters_json as {max_results?: unknown; search_mode?: unknown; desired_new_results?: unknown} | null | undefined;
  const max = filters?.max_results ?? r.max_results;
  const chosen = filters?.search_mode ?? r.search_mode;
  const desired = filters?.desired_new_results ?? r.desired_new_results;
  return {
   id: r.id, query: r.query, location: r.location,
   categories: Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === 'string') : [],
   provider: r.provider === 'brave' ? 'brave' : 'fixture',
   status: r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'running',
   started_at: r.started_at, completed_at: r.completed_at, result_count: r.result_count,
   max_results: typeof max === 'number' ? max : null,
   accepted_count: decided ? decided.filter(d => d.discovery_run_id === r.id && d.status === 'accepted').length : r.accepted_count ?? 0,
   ignored_count: decided ? decided.filter(d => d.discovery_run_id === r.id && d.status === 'ignored').length : r.ignored_count ?? 0,
   novelty: runNovelty(r),
   search_mode: (SEARCH_MODES as readonly unknown[]).includes(chosen) ? chosen as SearchMode : 'all',
   desired_new_results: typeof desired === 'number' ? desired : null,
   search: runSearch(r),
  };
 }).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

// "Rejouer la recherche": the form's values only. Nothing is launched — the user still clicks the button.
export type ReplayFields = {query: string; location: string; categories: string; max: number; provider: 'fixture' | 'brave'; searchMode: SearchMode; desiredNew: number | null};
export function replayFields(run: RunSummary, braveAvailable: boolean): ReplayFields {
 return {
  query: run.query, location: run.location, categories: run.categories.join(', '),
  max: Math.min(20, Math.max(1, run.max_results ?? 20)),
  provider: run.provider === 'brave' && braveAvailable ? 'brave' : 'fixture',
  // The search mode and new-actors target are prefilled too — nothing is launched.
  searchMode: run.search_mode, desiredNew: run.search_mode === 'search_new' ? run.desired_new_results : null,
 };
}

// Compact history: a few recent runs first, then more on demand — never 50 cards at once.
export const HISTORY_FIRST_PAGE=5;
export const HISTORY_MORE_PAGE=10;
export const HISTORY_MAX=50;
