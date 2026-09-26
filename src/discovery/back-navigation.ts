// Discovery → prospect → back (browser button, iOS swipe, "← Retour à la recherche").
//
// Browsers do not honour every history entry a page creates by script. Chrome and Safari skip, on "back",
// entries created by script without a user interaction (history manipulation intervention), and the entry the
// app was reached on can itself be one of them (e.g. arrival through a script redirect such as a preview
// sign-in). A single entry pushed when a prospect is opened is then walked over: the first "back" leaves the
// app for the previous site. So the Discovery screen gets its own entry, pushed during a click and carrying
// the project and the run, and the prospect is pushed above it. The first "back" always lands on that
// Discovery entry, which alone is enough to restore the project, the run and (in the panel) the scroll.
//
// Pure: states in, history operations out. The page applies them to window.history (Next.js keeps its own
// fields on each entry) and restores its view from the state on popstate. No network, no search, no run.
export const APP_VIEWS = ['prospects', 'dashboard', 'icp', 'discovery', 'beta-analytics'] as const;
export type AppView = typeof APP_VIEWS[number];
export type AppHistoryState = {
 prospectosView: AppView; projectId: string; runId: string | null; prospectId: string | null; fromDiscovery: boolean;
};
export type HistoryOp = {op: 'push' | 'replace'; state: AppHistoryState};

const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null;

// Anything read back from history is untrusted: another script, an older build or the browser may have put it.
export function readAppHistoryState(raw: unknown): AppHistoryState | null {
 if (!raw || typeof raw !== 'object') return null;
 const s = raw as Record<string, unknown>;
 const view = APP_VIEWS.find(v => v === s.prospectosView);
 const projectId = text(s.projectId);
 if (!view || !projectId) return null;
 return {prospectosView: view, projectId, runId: text(s.runId), prospectId: text(s.prospectId), fromDiscovery: s.fromDiscovery === true && view === 'prospects' && !!text(s.prospectId)};
}

export const discoveryEntry = (projectId: string, runId: string | null): AppHistoryState =>
 ({prospectosView: 'discovery', projectId, runId, prospectId: null, fromDiscovery: false});
export const prospectEntry = (projectId: string, runId: string | null, prospectId: string): AppHistoryState =>
 ({prospectosView: 'prospects', projectId, runId, prospectId, fromDiscovery: true});

const isDiscoveryEntryFor = (s: AppHistoryState | null, projectId: string): s is AppHistoryState =>
 !!s && s.prospectosView === 'discovery' && s.projectId === projectId;

// "Trouver des prospects" (a click): the screen being left is tagged so "back" can return to it, then the
// Discovery entry is pushed. Already on this project's Discovery entry: nothing new is pushed.
export function planEnterDiscovery(current: unknown, from: {view: AppView; projectId: string; prospectId: string | null}, runId: string | null): HistoryOp[] {
 const s = readAppHistoryState(current);
 if (isDiscoveryEntryFor(s, from.projectId)) return [{op: 'replace', state: discoveryEntry(from.projectId, runId ?? s.runId)}];
 const ops: HistoryOp[] = [];
 if (!s) ops.push({op: 'replace', state: {prospectosView: from.view, projectId: from.projectId, runId: null, prospectId: from.prospectId, fromDiscovery: false}});
 ops.push({op: 'push', state: discoveryEntry(from.projectId, runId)});
 return ops;
}

// "Voir le prospect" / a result just added: the Discovery entry below is (re)written with the run on screen —
// pushed first if the app is not on one — then the prospect is pushed above it. Both in the same click.
export function planOpenProspect(current: unknown, projectId: string, runId: string | null, prospectId: string): HistoryOp[] {
 const s = readAppHistoryState(current);
 const run = runId ?? (isDiscoveryEntryFor(s, projectId) ? s.runId : null);
 return [
  {op: isDiscoveryEntryFor(s, projectId) ? 'replace' : 'push', state: discoveryEntry(projectId, run)},
  {op: 'push', state: prospectEntry(projectId, run, prospectId)},
 ];
}

// A run is opened or a search finished while Discovery is on screen: its entry remembers that run.
export function planRunChange(current: unknown, projectId: string, runId: string | null): HistoryOp[] {
 const s = readAppHistoryState(current);
 return isDiscoveryEntryFor(s, projectId) && s.runId !== runId ? [{op: 'replace', state: discoveryEntry(projectId, runId)}] : [];
}

// "← Retour à la recherche" may call history.back() only when the current entry is the prospect entry pushed
// above a Discovery entry. Otherwise there is no reliable internal entry below and the screen is switched
// directly — never a history.back() that could leave the app.
export function canStepBackToDiscovery(current: unknown): boolean {
 const s = readAppHistoryState(current);
 return !!s && s.prospectosView === 'prospects' && s.fromDiscovery;
}
