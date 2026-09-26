// Discovery → prospect → back: the history entries the app writes, and how the page uses them.
// Real-browser behaviour (Chromium, iPhone 390 px) is exercised by the Playwright run described in
// docs/DISCOVERY_RUN_HISTORY.md; here the planner is checked exhaustively and the page wiring statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readAppHistoryState, planEnterDiscovery, planOpenProspect, planRunChange, canStepBackToDiscovery, discoveryEntry, prospectEntry, type HistoryOp} from '../src/discovery/back-navigation.ts';

const P = 'project-1', Q = 'project-2';
// A minimal history stack applying the planned operations the way the page does (replace merges, push adds).
function stack(initial: unknown = null) {
 const entries: unknown[] = ['external-site', initial];
 let index = 1;
 return {
  get state() { return entries[index]; },
  apply(ops: HistoryOp[]) { for (const {op, state} of ops) { if (op === 'push') { entries.splice(index + 1); entries.push({...state}); index++; } else entries[index] = {...(entries[index] as object ?? {}), ...state}; } },
  back() { index--; return entries[index]; },
  get length() { return entries.length; }, get index() { return index; },
 };
}

test('BN1 — untrusted states are rejected or normalised', () => {
 for (const bad of [null, undefined, 'x', 1, {}, {prospectosView: 'admin', projectId: P}, {prospectosView: 'discovery'}, {prospectosView: 'discovery', projectId: ''}, {prospectosView: 'discovery', projectId: 'x'.repeat(201)}])
  assert.equal(readAppHistoryState(bad), null);
 assert.deepEqual(readAppHistoryState({prospectosView: 'discovery', projectId: P, runId: 7, __NA: true}), discoveryEntry(P, null));
 assert.equal(readAppHistoryState({prospectosView: 'discovery', projectId: P, prospectId: 'x', fromDiscovery: true})!.fromDiscovery, false, 'only a prospect entry can come from Discovery');
 assert.equal(readAppHistoryState({prospectosView: 'prospects', projectId: P, fromDiscovery: true})!.fromDiscovery, false, 'no prospect id → not a return point');
});

test('BN2 — direct arrival, open Discovery, open a run, open a prospect: the first back lands on Discovery with the same project and run', () => {
 const h = stack(null); // arrival entry: Next.js state only, nothing of ours
 h.apply(planEnterDiscovery(h.state, {view: 'prospects', projectId: P, prospectId: 'p0'}, null));
 assert.equal(h.length, 3, 'Discovery has its own entry');
 assert.deepEqual(readAppHistoryState(h.back()), {prospectosView: 'prospects', projectId: P, runId: null, prospectId: 'p0', fromDiscovery: false}, 'the screen left is tagged');
});

test('BN3 — full scenario: arrival → Discovery → old run → prospect → back', () => {
 const h = stack(null);
 h.apply(planEnterDiscovery(h.state, {view: 'prospects', projectId: P, prospectId: null}, null));
 h.apply(planRunChange(h.state, P, 'run-old'));
 assert.equal(readAppHistoryState(h.state)!.runId, 'run-old', 'viewing a run rewrites the Discovery entry, no new entry');
 assert.equal(h.length, 3);
 h.apply(planOpenProspect(h.state, P, 'run-old', 'prospect-9'));
 assert.equal(h.length, 4);
 assert.ok(canStepBackToDiscovery(h.state));
 const popped = readAppHistoryState(h.back());
 assert.deepEqual(popped, discoveryEntry(P, 'run-old'));
 assert.ok(h.index >= 2, 'two internal entries sit between the prospect and the external page');
});

test('BN4 — opening a prospect when the app is not on a Discovery entry pushes one first (same click)', () => {
 const h = stack(null);
 const ops = planOpenProspect(h.state, P, 'run-1', 'x');
 assert.deepEqual(ops.map(o => [o.op, o.state.prospectosView]), [['push', 'discovery'], ['push', 'prospects']]);
 h.apply(ops);
 assert.deepEqual(readAppHistoryState(h.back()), discoveryEntry(P, 'run-1'));
 assert.equal(h.index, 2, 'the arrival entry is still below: even if the browser skips it, back stays in the app');
});

test('BN5 — several internal navigations never stack Discovery entries and keep the latest run', () => {
 const h = stack(null);
 h.apply(planEnterDiscovery(h.state, {view: 'prospects', projectId: P, prospectId: null}, null));
 for (const [run, prospect] of [['r1', 'a'], ['r2', 'b'], ['r2', 'c']]) {
  h.apply(planRunChange(h.state, P, run));
  h.apply(planOpenProspect(h.state, P, run, prospect));
  assert.deepEqual(readAppHistoryState(h.back()), discoveryEntry(P, run));
 }
 assert.equal(h.length, 4, 'arrival + Discovery + the last prospect');
 // Entering Discovery again while already on it: rewrite, never a second entry.
 assert.deepEqual(planEnterDiscovery(h.state, {view: 'discovery', projectId: P, prospectId: null}, 'r3').map(o => o.op), ['replace']);
 // Another project's Discovery entry is not reused.
 assert.deepEqual(planOpenProspect(h.state, Q, 'rq', 'z').map(o => o.op), ['push', 'push']);
 assert.deepEqual(planRunChange(h.state, Q, 'rq'), [], 'a run of another project never rewrites this entry');
});

test('BN6 — the in-app back button only steps back over the prospect entry it pushed', () => {
 assert.equal(canStepBackToDiscovery(null), false);
 assert.equal(canStepBackToDiscovery({__NA: true}), false, 'arrival entry: switch screens, no history.back()');
 assert.equal(canStepBackToDiscovery(discoveryEntry(P, 'r')), false);
 assert.equal(canStepBackToDiscovery({prospectosView: 'prospects', projectId: P, prospectId: 'x'}), false);
 assert.equal(canStepBackToDiscovery(prospectEntry(P, 'r', 'x')), true);
});

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
test('BN7 — page wiring: entries written during the click, restored on popstate, no search and no history.back() fallback', () => {
 assert.match(page, /onClick=\{openDiscovery\}>\{tr\('actions\.findProspects'\)\}/);
 assert.match(page, /function openDiscovery\(\)\{if\(view!=='discovery'&&projectId\)applyHistory\(planEnterDiscovery\(/);
 assert.match(page, /onActiveRunChange=\{id=>\{applyHistory\(planRunChange\(history\.state,projectId,id\)\)/);
 assert.match(page, /function backToDiscovery\(\)\{if\(canStepBackToDiscovery\(history\.state\)\)\{history\.back\(\);return\}setFromDiscovery\(false\);setView\('discovery'\)\}/);
 assert.equal((page.match(/history\.back\(\)/g) ?? []).length, 1, 'history.back() only behind canStepBackToDiscovery');
 const restore = page.slice(page.indexOf('function restoreFromHistory('), page.indexOf('const restoreRef='));
 assert.match(restore, /if\(!s\|\|mode==='welcome'\|\|!projects\.some\(p=>p\.id===s\.projectId\)\)return;/, 'unknown project or signed out: ignored');
 assert.match(restore, /setDiscoveryRuns\(m=>\(\{\.\.\.m,\[s\.projectId\]:runId\}\)\)/);
 assert.doesNotMatch(restore, /api\(|search\(|'POST'|pushState|history\.back/, 'restoring never searches, never writes history');
 assert.doesNotMatch(page, /discoveryHistoryEntry/);
});
