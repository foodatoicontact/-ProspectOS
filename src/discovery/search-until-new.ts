// V2 — Search-Until-New (V1): when a search mostly returns actors the project already knows, spend the SAME
// provider budget a normal run may spend (at most 3 Brave requests) one request at a time, on deterministic
// query variants, and stop as soon as it is no longer useful. One pass = one provider request.
//
// It promises "explore more of the market to try to surface new actors, within the configured limits" —
// never "find N new prospects". Every run says why it stopped.
//
// Bounded by construction: a finite list of variants, a hard cap of MAX_PROVIDER_CALLS requests, and a time
// budget checked before every additional pass. No LLM, no network here (the pass runner is injected).
import {planSearchQueries,signalQueriesOf,type PlanInput} from './query-plan.ts';

export const SEARCH_MODES = ['all', 'new_first', 'search_new'] as const;
export type SearchMode = typeof SEARCH_MODES[number];
// Hard cap — never configurable above it in V1 (the existing per-run ceiling of the multi-query plan).
export const MAX_PROVIDER_CALLS = 3;
// A Brave request times out after 12 s (providers/brave.ts): a new pass starts only if it can end before
// the budget, which leaves the rest of the 60 s function (memory, save, novelty) untouched.
export const PASS_TIMEOUT_MS = 12_000;
export const TIME_BUDGET_MS = 40_000;

export type StopReason = 'TARGET_REACHED' | 'MAX_PROVIDER_CALLS' | 'NO_MORE_VARIANTS' | 'NO_NEW_RESULTS' | 'PROVIDER_ERROR' | 'TIME_BUDGET';
export const STOP_REASONS: readonly StopReason[] = ['TARGET_REACHED', 'MAX_PROVIDER_CALLS', 'NO_MORE_VARIANTS', 'NO_NEW_RESULTS', 'PROVIDER_ERROR', 'TIME_BUDGET'];

export type SearchVariant = {query: string; kind: 'plan' | 'signal' | 'category'};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Deterministic, finite variants: every query of the existing plan on its own (A), then one variant per
// user category with the zone (C). Built only from the user's own words — never a sector, place or client
// name hard-coded here. (B — provider pagination — is not used: see docs/DISCOVERY_SEARCH_UNTIL_NEW.md.)
export function buildSearchVariants(input: PlanInput): SearchVariant[] {
 const plan = planSearchQueries(input);
 // The need-signal queries of the plan (query-plan.ts) keep their place right after the main query.
 const signals = new Set(signalQueriesOf(input));
 const out: SearchVariant[] = [];
 const seen = new Set<string>();
 const push = (query: string, kind: SearchVariant['kind']) => { const key = fold(query); if (!key || seen.has(key)) return; seen.add(key); out.push({query, kind}); };
 for (const q of plan.queries) push(q, signals.has(q) ? 'signal' : 'plan');
 for (const c of input.categories) push([c.trim(), plan.zone].filter(Boolean).join(' ').toLowerCase(), 'category');
 return out.slice(0, 6);
}

export function desiredNewResults(requested: number | undefined, maxResults: number): number {
 const n = Number.isFinite(requested) ? Math.trunc(requested as number) : maxResults;
 return Math.min(maxResults, Math.max(1, n));
}

export type PassReport = {query_kind: SearchVariant['kind']; duration_ms: number; results: number; new_after: number; failed: boolean};
export type SearchUntilNewResult<C> = {candidates: C[]; passes: PassReport[]; providerCalls: number; stopReason: StopReason; newFound: number; lastCallReserved?: boolean};

// The loop. `runPass` performs ONE provider request and returns its normalized candidates; `countNew` gives
// the number of NEW actors among everything gathered so far (after inter-pass dedup and the project memory),
// so an actor met twice is never counted twice. The first pass failing throws (the existing failed run);
// a later pass failing keeps everything already found (PROVIDER_ERROR).
export async function searchUntilNewTarget<C>(opts: {
 variants: SearchVariant[]; desiredNewResults: number; maxProviderCalls?: number;
 runPass: (variant: SearchVariant) => Promise<C[]>; countNew: (all: C[]) => number;
 now?: () => number; startedAt?: number; timeBudgetMs?: number; passTimeoutMs?: number;
 // After two primary passes, when the run's LAST request is better spent resolving the companies the set-aside
 // sources cite (secondary-sources.ts), the loop stops there and leaves that request unspent (same cap, same cost).
 reserveLastCall?: (all: C[]) => boolean;
}): Promise<SearchUntilNewResult<C>> {
 const now = opts.now ?? Date.now;
 const start = opts.startedAt ?? now();
 const cap = Math.min(MAX_PROVIDER_CALLS, Math.max(1, opts.maxProviderCalls ?? MAX_PROVIDER_CALLS));
 const budget = opts.timeBudgetMs ?? TIME_BUDGET_MS, passTimeout = opts.passTimeoutMs ?? PASS_TIMEOUT_MS;
 const all: C[] = [];
 const passes: PassReport[] = [];
 let calls = 0, newFound = 0, stop: StopReason | null = null, reserved = false;
 for (const [index, variant] of opts.variants.entries()) {
  // Budget priority: main query, then need-signal queries, then a secondary-resolution request with what is left.
  const signalAhead = opts.variants.slice(index).some(v => v.kind === 'signal');
  if (calls >= cap) { stop = 'MAX_PROVIDER_CALLS'; break; }
  if (calls > 0 && now() - start + passTimeout > budget) { stop = 'TIME_BUDGET'; break; }
  if (calls >= 2 && calls === cap - 1 && !signalAhead && opts.reserveLastCall?.(all)) { stop = 'MAX_PROVIDER_CALLS'; reserved = true; break; }
  calls++;
  const t0 = now();
  let found: C[];
  try { found = await opts.runPass(variant); }
  catch (error) {
   if (calls === 1) throw error;
   passes.push({query_kind: variant.kind, duration_ms: now() - t0, results: 0, new_after: newFound, failed: true});
   stop = 'PROVIDER_ERROR'; break;
  }
  all.push(...found);
  const before = newFound;
  newFound = opts.countNew(all);
  passes.push({query_kind: variant.kind, duration_ms: now() - t0, results: found.length, new_after: newFound, failed: false});
  if (newFound >= opts.desiredNewResults) { stop = 'TARGET_REACHED'; break; }
  // A complementary pass that brought no new actor (after dedup and memory): the next variants of the same
  // market are unlikely to do better — stop instead of spending the remaining requests.
  if (calls > 1 && newFound <= before && !opts.variants.slice(index + 1).some(v => v.kind === 'signal')) { stop = 'NO_NEW_RESULTS'; break; }
 }
 if (!stop) stop = calls >= cap ? 'MAX_PROVIDER_CALLS' : 'NO_MORE_VARIANTS';
 return {candidates: all, passes, providerCalls: calls, stopReason: stop, newFound, lastCallReserved: reserved};
}
