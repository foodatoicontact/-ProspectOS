// Pre-Kevin polish — explicit way back from a prospect, by provenance (the browser "back" keeps working:
// tests/discovery-back-navigation.test.ts). Pure decision checked here; page and panel wiring checked statically;
// the real browser path (390 and 1440) is exercised by the Playwright run described in docs/KEVIN_BENCHMARK_V2.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prospectOrigin} from '../src/discovery/back-navigation.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');

test('NAV-1 — provenance: Discovery wins, then the list, else the overview; nothing without a prospect', () => {
 assert.equal(prospectOrigin({fromDiscovery: true, fromList: false, hasProspect: true}), 'discovery');
 assert.equal(prospectOrigin({fromDiscovery: true, fromList: true, hasProspect: true}), 'discovery');
 assert.equal(prospectOrigin({fromDiscovery: true, fromList: false, hasProspect: false}), 'discovery', 'a prospect not loaded yet still offers the way back to Discovery');
 assert.equal(prospectOrigin({fromDiscovery: false, fromList: true, hasProspect: true}), 'prospects');
 assert.equal(prospectOrigin({fromDiscovery: false, fromList: false, hasProspect: true}), 'dashboard');
 assert.equal(prospectOrigin({fromDiscovery: false, fromList: true, hasProspect: false}), null);
 assert.equal(prospectOrigin({fromDiscovery: false, fromList: false, hasProspect: false}), null);
});

test('NAV-2 — labels (fr/en): Discovery, prospects, overview', () => {
 assert.equal(fr['discovery.backToSearch'], '← Retour à Discovery');
 assert.equal(fr['detail.backToProspects'], '← Retour aux prospects');
 assert.equal(fr['detail.backToDashboard'], '← Retour à la vue d’ensemble');
 assert.equal(fr['nav.dashboard'], 'Vue d’ensemble', 'the fallback names the screen as the menu does');
 assert.equal(en['discovery.backToSearch'], '← Back to Discovery');
 assert.equal(en['detail.backToProspects'], '← Back to prospects');
 assert.equal(en['detail.backToDashboard'], '← Back to overview');
});

test('NAV-3 — page: one button per provenance; Discovery keeps the history-aware return', () => {
 assert.match(page, /const origin=prospectOrigin\(\{fromDiscovery,fromList,hasProspect:!!current\}\);/);
 assert.match(page, /origin==='discovery'\?<button className="text-button back-to-discovery" onClick=\{backToDiscovery\}>\{tr\('discovery\.backToSearch'\)\}/);
 assert.match(page, /origin==='prospects'\?<button className="text-button back-to-discovery" onClick=\{backToList\}>\{tr\('detail\.backToProspects'\)\}/);
 assert.match(page, /origin==='dashboard'\?<button className="text-button back-to-discovery" onClick=\{\(\)=>\{setFromList\(false\);setView\('dashboard'\)\}\}>\{tr\('detail\.backToDashboard'\)\}/);
 // The browser button is untouched: popstate still restores from the entry's state.
 assert.match(page, /const onPop=\(e:PopStateEvent\)=>restoreRef\.current\(e\.state\)/);
 // "Retour aux prospects" never writes history.
 const backToList = page.match(/function backToList\(\)\{[^\n]*\}/)?.[0] ?? '';
 assert.ok(backToList.includes("scrollIntoView") && !/history\./.test(backToList));
});

test('NAV-4 — page: provenance is set where the prospect is opened and reset where it is not', () => {
 assert.match(page, /onClick=\{\(\)=>\{revision\.current\+\+;setSelected\(p\.id\);setFromDiscovery\(false\);setFromList\(true\)\}\}/, 'a row of the list');
 assert.match(page, /setProspects\(ps=>\[p,\.\.\.ps\]\);setSelected\(p\.id\);setFromDiscovery\(false\);setFromList\(true\)/, 'a prospect added by hand');
 assert.match(page, /setView\('prospects'\);setFromDiscovery\(true\);setFromList\(false\)\}/, 'opened from Discovery');
 assert.match(page, /onClick=\{\(\)=>\{setView\(key\);setFromList\(false\);/, 'the menu');
 assert.match(page, /onClick=\{\(\)=>\{setFilter\(s\);setFromList\(false\);setView\('prospects'\)\}\}/, 'the overview pipeline');
 assert.match(page, /function selectProject\(id:string\)\{revision\.current\+\+;setFromList\(false\);/, 'another project');
 assert.match(page, /selectProject\(s\.projectId\);setFromList\(false\);/, 'a history entry');
});

test('NAV-5 — Discovery panel: run, Novelty filter, results shown and scroll are remembered and restored for that run only', () => {
 assert.match(panel, /function rememberView\(\)\{try\{sessionStorage\.setItem\(scrollKey\(projectId\),JSON\.stringify\(\{y:window\.scrollY,shown:resultsShown,tab:noveltyTab,run\}\)\)\}catch\{\}\}/);
 assert.match(panel, /function openProspect\(prospectId:string\)\{rememberView\(\);onOpenProspect\?\.\(prospectId\)\}/);
 assert.match(panel, /rememberView\(\);onAdded\(p\)/, 'a candidate just added opens its prospect with the view remembered');
 assert.match(panel, /else if\(saved&&\(!saved\.run\|\|saved\.run===summary\.id\)\)\{y=Number\(saved\.y\)\|\|0;shown=Math\.max\(RESULTS_PAGE,Number\(saved\.shown\)\|\|RESULTS_PAGE\);if\(saved\.tab==='ALL'\|\|NOVELTY_STATUSES\.includes\(saved\.tab\)\)setNoveltyTab\(saved\.tab\)\}/);
 // Restoring reads only: no provider call, no run.
 assert.match(panel, /if\(summary&&!cancelled\)void viewRun\(summary,true\)/);
});

test('FRICTION-1 — "Afficher plus de résultats (N)": the label never announces a fixed 6 (desktop pages by 20)', async () => {
 const {fr: f} = await import('../src/i18n/fr.ts'); const {en: e} = await import('../src/i18n/en.ts');
 assert.equal(f['discovery.showMoreResults'], 'Afficher plus de résultats');
 assert.equal(e['discovery.showMoreResults'], 'Show more results');
 assert.match(panel, /\{tr\('discovery\.showMoreResults'\)\} \(\{Math\.min\(resultsPage\(\),shown\.length-resultsShown\)\}\)/, 'the real number comes next to it');
});

test('FRICTION-2 — tabs and counters follow a decision taken in this run; the snapshot is untouched', async () => {
 const {decidedNovelty} = await import('../src/discovery/novelty.ts');
 const NEW = {status: 'NEW' as const, basis: null, prospect_id: null, run_id: null, result_id: null};
 const SEEN = {status: 'SEEN' as const, basis: 'domain' as const, prospect_id: null, run_id: 'r0', result_id: 'x'};
 assert.deepEqual(decidedNovelty(NEW, {status: 'accepted', prospect_id: 'p1'}, undefined), {status: 'ADDED', basis: 'prospect_id', prospect_id: 'p1', run_id: null, result_id: null});
 assert.equal(decidedNovelty(SEEN, {status: 'accepted', prospect_id: 'p1'}, undefined)?.status, 'ADDED');
 assert.deepEqual(decidedNovelty(SEEN, {status: 'ignored', prospect_id: null}, null), {...SEEN, status: 'IGNORED'});
 assert.equal(decidedNovelty(NEW, {status: 'pending', prospect_id: null}, undefined), NEW, 'undecided: the snapshot');
 assert.equal(decidedNovelty(SEEN, {status: 'pending', prospect_id: null}, {status: 'ADDED', prospect_id: 'p2'})?.status, 'ADDED', 'undecided: the current project status');
 assert.equal(decidedNovelty(null, {status: 'accepted', prospect_id: 'p1'}, undefined), null, 'older run without snapshot: nothing counted');
 assert.equal(NEW.status, 'NEW', 'the snapshot object is never mutated');
 assert.equal(SEEN.status, 'SEEN');
 // Tabs/counters use it; the card keeps the run's label for a decided result (next to "Ajouté au projet" / "Ignoré").
 assert.match(panel, /const tabCount=\(k:'ALL'\|NoveltyStatus\)=>k==='ALL'\?candidates\.length:candidates\.filter\(r=>novOf\(r\)\?\.status===k\)\.length;/);
 assert.match(panel, /const noveltyTotals=noveltyCounts\(candidates\.map\(novOf\)\);/);
});

test('FRICTION-3 — the "score 0" hint names both confirm buttons (manual evidence and analysed proofs)', async () => {
 const {fr: f} = await import('../src/i18n/fr.ts'); const {en: e} = await import('../src/i18n/en.ts');
 assert.match(f['detail.coverageZero'], /« J’ai vérifié la source : valider » ou « Confirmer »/);
 assert.equal(f['evidence.confirm'], 'Confirmer');
 assert.match(e['detail.coverageZero'], /“I checked the source: verify” or “Confirm”/);
 assert.equal(e['evidence.confirm'], 'Confirm');
});
