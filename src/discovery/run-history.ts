// Discovery run history: what the project's past searches were and what became of their results.
// Pure functions over rows already read under RLS — never a provider call, never a write. Shared by the
// API (GET projects/:id/discovery) and the panel (demo mode keeps the same shape in localStorage).
export type RunStatus = 'running' | 'completed' | 'failed';
export type RunState = RunStatus | 'interrupted';
export type RunSummary = {
 id: string; query: string; location: string; categories: string[]; provider: 'fixture' | 'brave';
 status: RunStatus; started_at: string; completed_at: string | null; result_count: number; max_results: number | null;
 accepted_count: number; ignored_count: number;
};
type RunRow = {id: string; query: string; location: string; categories: unknown; provider: string; filters_json?: unknown; status: string; started_at: string; completed_at: string | null; result_count: number};
type DecidedRow = {discovery_run_id: string; status: string};

// A run still "running" long after it started never finished (the request died): shown as interrupted,
// never as a search still in progress. Display only — the stored row is left as it is.
export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;
export function runState(run: Pick<RunSummary, 'status' | 'started_at'>, now = new Date()): RunState {
 if (run.status !== 'running') return run.status;
 return now.getTime() - new Date(run.started_at).getTime() > RUN_STALE_AFTER_MS ? 'interrupted' : 'running';
}

// Newest first; a new run never replaces an older one (each search is its own row).
export function summarizeRuns(runs: RunRow[], decided: DecidedRow[] = []): RunSummary[] {
 return runs.map((r): RunSummary => {
  const max = (r.filters_json as {max_results?: unknown} | null)?.max_results;
  return {
   id: r.id, query: r.query, location: r.location,
   categories: Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === 'string') : [],
   provider: r.provider === 'brave' ? 'brave' : 'fixture',
   status: r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'running',
   started_at: r.started_at, completed_at: r.completed_at, result_count: r.result_count,
   max_results: typeof max === 'number' ? max : null,
   accepted_count: decided.filter(d => d.discovery_run_id === r.id && d.status === 'accepted').length,
   ignored_count: decided.filter(d => d.discovery_run_id === r.id && d.status === 'ignored').length,
  };
 }).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

// "Rejouer la recherche": the form's values only. Nothing is launched — the user still clicks the button.
export type ReplayFields = {query: string; location: string; categories: string; max: number; provider: 'fixture' | 'brave'};
export function replayFields(run: RunSummary, braveAvailable: boolean): ReplayFields {
 return {
  query: run.query, location: run.location, categories: run.categories.join(', '),
  max: Math.min(20, Math.max(1, run.max_results ?? 20)),
  provider: run.provider === 'brave' && braveAvailable ? 'brave' : 'fixture',
 };
}
