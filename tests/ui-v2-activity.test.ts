// UI-5C Activité 2.0 (docs/UI_V2.md): "Activité" composed natively in v2 — "À faire" (ActionsPanel through its optional
// `view` prop: the panel's own state, calls and human decisions) and the overview (the legacy dashboard's figures and
// pipeline). Pins: the legacy markup unchanged when `view` is absent (flag OFF); every legacy action kept, same handlers;
// no technical figure on the face (scores, engine names stay in "Détails"); the benches never served in Production; the
// "Lecture du résultat" line of Recherche said in words. Browser (320 / 390 / 1280, light / dark, every bench state,
// contrast, overflow, touch targets, reduced motion) is checked with Playwright on the /ui-v2/activity bench.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';

const ROOT=new URL('..',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const git=(c:string)=>execSync(c,{cwd:ROOT,encoding:'utf8'});
const page=read('../app/page.tsx'),panel=read('../src/components/ActionsPanel.tsx'),ui=read('../src/ui/v2/activity/ActivityV2.tsx'),css=read('../src/ui/v2/activity/activity.css');
const BASE='eb0d7de';
const legacy=page.slice(0,page.indexOf(' if(v2){')),v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));

test('flag OFF parity — the legacy ActionsPanel markup and the legacy screens are byte-identical',()=>{
 const before=git(`git show ${BASE}:src/components/ActionsPanel.tsx`);
 const legacyReturn=(src:string)=>src.slice(src.indexOf(' return <section className="card nba-panel">'));
 assert.ok(legacyReturn(before).length>500);
 assert.equal(legacyReturn(panel),legacyReturn(before),'the legacy panel renders exactly as before');
 assert.match(panel,/if\(view\)return <>\{view\(\{locale,today,queue,busy:off,error,note,filter,setFilter,compute,decide,onOpenProspect\}\)\}<\/>;/);
 const pageBefore=git(`git show ${BASE}:app/page.tsx`);
 assert.equal(legacy,pageBefore.slice(0,pageBefore.indexOf(' if(v2){')),'everything before the v2 shell is unchanged');
 const shell=(src:string)=>src.slice(src.indexOf(' return <div className="shell">'));
 assert.equal(shell(page),shell(pageBefore),'legacy shell unchanged');
});

test('wiring — Activité 2.0 only inside the v2 shell, same panel element, same handlers as the legacy screen',()=>{
 assert.match(v2,/:view==='actions'&&mode==='live'&&\(nbaOn\|\|zfOn\)&&project\?<v2\.ActivityV2 locale=\{locale\} intro="actions"/);
 assert.match(v2,/<ActionsPanel key=\{projectId\} projectId=\{projectId\} api=\{api\} locale=\{locale\} disabled=\{busy\} onOpenProspect=\{id=>\{setSelected\(id\);setV2Record\(id\);setFromDiscovery\(false\);setFromList\(false\);setView\('prospects'\)\}\} view=\{m=><v2\.ActionsNative m=\{m\}\/>\}\/>/);
 assert.match(legacy,/\{view==='actions'&&mode==='live'&&\(nbaOn\|\|zfOn\)&&project&&<ActionsPanel key=\{projectId\} projectId=\{projectId\} api=\{api\} locale=\{locale\} disabled=\{busy\} onOpenProspect=\{id=>\{setSelected\(id\);setV2Record\(id\);setFromDiscovery\(false\);setFromList\(false\);setView\('prospects'\)\}\}\/>\}/,'legacy element unchanged');
 // The overview: the same figures and pipeline as the legacy dashboard; a status opens the filtered list.
 assert.match(v2,/:view==='dashboard'&&!showQuickStart\?<v2\.ActivityV2 locale=\{locale\} intro="overview"/);
 assert.match(v2,/onStatus=\{s=>\{setFilter\(s\);setFromList\(false\);setV2Record\(''\);setV2Focus\(null\);setView\('prospects'\)\}\}/);
 for(const k of ['metrics.prospectsInProject','metrics.toContact','metrics.avgScore','metrics.conversations','dashboard.pipelineNote'])assert.ok(v2.includes(`tr('${k}')`),k);
 assert.match(v2,/pipeline=\{STATUSES\.map\(s=>\(\{status:s,label:statusLabel\(s,locale\),count:all\.filter\(p=>p\.status===s\)\.length\}\)\)\}/);
 assert.match(read('../src/ui/v2/shell/AppShell.tsx'),/export \{ActivityV2,ActionsNative,ActivityOverview\} from '\.\.\/activity\/ActivityV2\.tsx';/);
});

test('functional parity — every legacy action of "À faire" is offered, with the same request',()=>{
 for(const d of ["{decision:'APPROVED',human_action:row.recommended_action}","{decision:'DONE',human_action:row.recommended_action}","{decision:'SNOOZED',snooze_days:7}","{decision:'REJECTED'}"]){
  assert.ok(panel.includes(d),`legacy: ${d}`);assert.ok(ui.includes(`m.decide(row.id,${d})`),`v2: ${d}`);
 }
 assert.match(ui,/onClick=\{m\.compute\}>\{tr\('nba\.compute'\)\}/,'recompute');
 for(const k of ['signal_type','min_score','min_freshness'])assert.ok(ui.includes(`set('${k}'`),`filter ${k}`);
 assert.match(ui,/onClick=\{\(\)=>m\.onOpenProspect\(row\.prospect_id\)\}/,'open the record');
 for(const k of ["copy(p.text!,'draft')","copy(p.suggested_comment!,'comment')","copy(p.suggested_dm_after_engagement!,'dm')"])assert.ok(ui.includes(k),k);
 for(const k of ['nba.section.today','nba.emptyToday','nba.humanOnly','nba.whyNow','nba.whyAction','nba.whyAccount','nba.inferred','nba.unknown','nba.angle','nba.openSource','nba.toVerify'])assert.ok(ui.includes(`'${k}'`),k);
 assert.match(ui,/SECTIONS\.map\(s=>\{const rows=m\.queue\.filter\(r=>s\.actions\.includes\(r\.recommended_action\)&&!m\.today\.some\(x=>x\.id===r\.id\)\);/,'same sections, same dedup');
 assert.match(ui,/open=\{s\.key!=='wait'&&rows\.length>0\}/,'same default opening');
});

test('surface — what, which company, why now, when on the face; scores and engine detail only in "Détails"',()=>{
 const item=ui.slice(ui.indexOf('function ActionItem('),ui.indexOf('export function ActionsNative('));
 const face=item.slice(0,item.indexOf('<details className="pos-adetails">'));
 for(const k of ['opportunity_score','fit_score','intent_score','timing_score','freshness_score','evidence_quality_score','row.rule','row.id}</','primary_signal_type}'])assert.ok(!face.includes(k),`not on the face: ${k}`);
 for(const k of ["nba.action.${row.recommended_action}",'row.prospects?.name','why.text','{what}{age?'])assert.ok(face.includes(k),`on the face: ${k}`);
 const details=item.slice(item.indexOf('<details className="pos-adetails">'));
 for(const k of ['opportunity_score','fit_score','intent_score','timing_score','freshness_score','evidence_quality_score'])assert.ok(details.includes(k),`kept in Détails: ${k}`);
 assert.doesNotMatch(ui,/fetch\(|api\(/,'the view calls nothing');
});

test('look — tokens only, scoped, 44 px targets, reduced motion, forced colours',()=>{
 for(const rule of css.match(/^\.pos-ui[^{]*\{/gm)??[])assert.ok(rule.startsWith('.pos-ui .pos-'),rule);
 assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g,''),/#[0-9a-f]{3,8}\b|rgb\(/i,'no raw colour');
 assert.match(css,/\.pos-aitem__who\{[^}]*min-height:var\(--pos-size-target\)/);
 assert.match(css,/\.pos-apipe__row\{[^}]*min-height:var\(--pos-size-target\)/);
 assert.match(css,/\.pos-astatements a::after\{content:"";position:absolute;inset:-12px -4px\}/);
 assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);assert.match(css,/@media \(forced-colors:active\)/);
});

test('benches — never served in Production; the activity bench uses frozen data and the real view',()=>{
 assert.match(read('../app/ui-v2/layout.tsx'),/if\(!uiV2BenchEnabled\(process\.env\)\)notFound\(\);/);
 const bench=read('../src/ui/v2/activity/ActivityBench.tsx');
 assert.match(bench,/<ActionsNative m=\{m\}\/>/);assert.doesNotMatch(bench,/fetch\(|api\(/);
 assert.match(read('../app/ui-v2/activity/page.tsx'),/const STATES:readonly ActivityBenchState\[\]=\['actions','empty','error','overview'\];/);
});

test('Recherche — the advanced "Lecture du résultat" line says it in words, never a provider id',async()=>{
 const src=read('../src/ui/v2/search/SearchNative.tsx');
 assert.match(src,/confidence:'Lecture du résultat'/);
 assert.ok(src.includes("SOURCE_NAME:Record<Locale,Record<string,string>>={fr:{brave:'recherche web',registry:'registre des entreprises',fixture:'données de test'}"));
 assert.ok(!src.includes('discoveryFoundNote('),'the legacy line is no longer used by the v2 view');
 assert.match(read('../src/components/DiscoveryPanel.tsx'),/discoveryFoundNote\(/,'the legacy screen keeps its line');
});

test('scope — no engine, API, DB, scoring, NBA rule, Stripe or public-site change',()=>{
 const changed=git(`git diff --name-only ${BASE} fc556ef`).split('\n').filter(Boolean);
 for(const f of changed)assert.match(f,/^(app\/page\.tsx|app\/ui-v2\/(layout\.tsx|activity\/page\.tsx)|src\/components\/ActionsPanel\.tsx|src\/ui\/v2\/(activity\/|flag\.ts|shell\/AppShell\.tsx|search\/SearchNative\.tsx)|docs\/UI_V2\.md|tests\/ui-v2-[a-z]+\.test\.ts)/,f);
});
