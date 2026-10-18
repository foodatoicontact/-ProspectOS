// UI-5B Recherche 2.0 (docs/UI_V2.md): the search composed natively in v2 on top of DiscoveryPanel's own state and
// actions (its optional `view` prop). Pins: one place for the logic (factsOf, the handlers) shared by the legacy card and
// the v2 card; the legacy markup unchanged when `view` is absent (flag OFF); the v2 actions = the legacy actions, same
// conditions, same handlers; verification said in words, numbers only in "Détails avancés"; an unknown source never
// becomes a signal or a proof; scope. Browser (320 / 390 / 1440, light / dark, keyboard, reduced motion, every bench
// state, the real panel in demo mode) is checked with Playwright on the /ui-v2/search bench (Preview).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {verificationOf,scoreText} from '../src/ui/v2/search/model.ts';

const ROOT=new URL('..',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const git=(c:string)=>execSync(c,{cwd:ROOT,encoding:'utf8'});
const page=read('../app/page.tsx'),panel=read('../src/components/DiscoveryPanel.tsx'),nat=read('../src/ui/v2/search/SearchNative.tsx'),css=read('../src/ui/v2/search/search.css');
const MAIN='836d8e9';
const legacy=page.slice(0,page.indexOf(' if(v2){')),v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));
const el=(src:string)=>{const i=src.indexOf('<DiscoveryPanel ');return src.slice(i,src.indexOf("}}",src.indexOf('onAdded=',i))+2)};

test('one logic — the v2 view gets DiscoveryPanel’s own state and handlers; factsOf feeds both cards',()=>{
 assert.match(panel,/ const factsOf=\(r:DiscoveryResult\):ResultFacts=>\{const meta=metaOf\(r\);const cls=classOf\(r\);const canAdd=cls==='COMPANY_CANDIDATE';/);
 assert.match(panel,/ const resultCard=\(r:DiscoveryResult\)=>\{const \{meta,cls,canAdd,legacy,nameResolved,viaThirdParty,domainResolved,typeKey,sourceHost,state,hist,nov,alreadyProspect,score\}=factsOf\(r\);/);
 assert.match(panel,/ if\(view\)return <>\{view\(\{tr,locale,mode,projectName,offer,criteria,busy,error,info,replayed,deepPending,/);
 assert.match(panel,/accept,ignore,openProspect,openRun,viewRun,replay,moreRuns\}\)\}<\/>;\n return <section className="card discovery">/,'without view: the legacy markup');
 assert.match(panel,/submit:\(f:FormData\)=>search\(f\)/,'the form submits to the same search()');
 assert.doesNotMatch(nat,/\bapi\(|fetch\(|FixtureProvider|DeduplicationService|searchCompanies|DiscoveryInputSchema|novelty-engine|reviewPriority\(/,'no engine, provider, API or rule in the view');
});
test('legacy untouched — DiscoveryPanel only gains factsOf (expressions moved verbatim) and the optional view',()=>{
 const before=git(`git show ${MAIN}:src/components/DiscoveryPanel.tsx`);
 const markup=(s:string)=>s.slice(s.indexOf(' return <section className="card discovery">'));
 assert.equal(markup(panel),markup(before),'the legacy markup, byte for byte');
 const card=(s:string)=>s.slice(s.indexOf("  return <article className={`discovery-result compact state-${state}`} key={r.id}>"),s.indexOf(' return <section className="card discovery">'));
 const cardNow=card(panel);assert.ok(cardNow.length>2000);
 assert.equal(cardNow.replace(/ \/\/ Recherche 2\.0 \(UI-5B\)[^]*?<\/>;\n/,''),card(before),'the legacy result card, byte for byte');
 const logic=(s:string)=>s.slice(s.indexOf(' const tr=(key:TKey)=>'),s.indexOf(' const resultCard=')).replace(/ \/\/ Everything a result card says[^]*$/,'');
 assert.equal(logic(panel),logic(before),'state, effects, search, accept, ignore, history, novelty: unchanged');
 const factsBody=panel.slice(panel.indexOf(' const factsOf='),panel.indexOf('  return {meta,cls,canAdd'));
 for(const expr of factsBody.split(/;\n?|\n/).map(x=>x.trim()).filter(x=>x.startsWith('const ')&&!x.startsWith('const factsOf')))
  assert.ok(before.includes(expr),`moved verbatim: ${expr}`);
});
test('flag OFF — app/page.tsx before the v2 branch and the legacy return are byte-identical to main',()=>{
 const before=git(`git show ${MAIN}:app/page.tsx`);
 assert.equal(legacy,before.slice(0,before.indexOf(' if(v2){')));
 const shell=(s:string)=>s.slice(s.indexOf(' return <div className="shell">'));
 assert.equal(shell(page),shell(before));
});
test('flag ON — the same DiscoveryPanel element, plus view={SearchNative}',()=>{
 assert.equal((v2.match(/<DiscoveryPanel /g)??[]).length,1);
 assert.equal(el(v2),el(legacy),'same props');
 assert.match(v2,/onAdded=\{p=>\{[^}]*\}\} view=\{m=><v2\.SearchNative m=\{m\}\/>\}\/>\}\/>:undefined\}>/);
 assert.match(read('../src/ui/v2/shell/AppShell.tsx'),/export \{SearchNative\} from '\.\.\/search\/SearchNative\.tsx';/);
});
test('actions parity — the v2 card offers exactly the legacy actions, same conditions, same handlers',()=>{
 for(const [legacyRe,v2Re] of [
  [/\{alreadyProspect\?<>\{onOpenProspect&&<button className="text-button" onClick=\{\(\)=>openProspect\(nov!\.prospect_id!\)\}>/,/\{f\.alreadyProspect\?<>\{m\.canOpenProspect&&<Button[^>]*onClick=\{\(\)=>m\.openProspect\(f\.nov!\.prospect_id!\)\}>/],
  [/r\.status==='pending'&&!canAdd\?<button disabled=\{busy\} onClick=\{\(\)=>ignore\(r\)\}>/,/r\.status==='pending'&&!f\.canAdd\?<Button[^>]*disabled=\{m\.busy\} onClick=\{\(\)=>m\.ignore\(r\)\}>/],
  [/onClick=\{\(\)=>accept\(r,r\.dedupe_status==='merge_review_required'\)\}>\{r\.dedupe_status==='merge_review_required'\?tr\('discovery\.addSeparately'\):r\.dedupe_status==='duplicate_candidate'\?tr\('discovery\.openExisting'\):tr\('discovery\.addThenAnalyze'\)\}/,
   /onClick=\{\(\)=>m\.accept\(r,r\.dedupe_status==='merge_review_required'\)\}>\n\s*\{r\.dedupe_status==='merge_review_required'\?tr\('discovery\.addSeparately'\):r\.dedupe_status==='duplicate_candidate'\?tr\('discovery\.openExisting'\):tr\('discovery\.addThenAnalyze'\)\}/],
  [/r\.status==='accepted'&&r\.prospect_id&&onOpenProspect&&<button className="text-button" onClick=\{\(\)=>openProspect\(r\.prospect_id!\)\}>/,/r\.status==='accepted'&&r\.prospect_id&&m\.canOpenProspect&&<Button[^>]*onClick=\{\(\)=>m\.openProspect\(r\.prospect_id!\)\}>/],
  [/\(nov\?\.status==='SEEN'\|\|nov\?\.status==='IGNORED'\)&&nov\.run_id&&nov\.run_id!==run&&<button[^>]*onClick=\{\(\)=>openRun\(nov\.run_id!\)\}>/,/\(f\.nov\?\.status==='SEEN'\|\|f\.nov\?\.status==='IGNORED'\)&&f\.nov\.run_id&&f\.nov\.run_id!==m\.run&&<Button[^>]*onClick=\{\(\)=>m\.openRun\(f\.nov!\.run_id!\)\}>/],
  [/onClick=\{\(\)=>viewRun\(h\)\}>\{tr\('discovery\.viewResults'\)\}/,/onClick=\{\(\)=>m\.viewRun\(h\)\}>\{tr\('discovery\.viewResults'\)\}/],
  [/onClick=\{\(\)=>replay\(h\)\}>\{tr\('discovery\.replay'\)\}/,/onClick=\{\(\)=>m\.replay\(h\)\}>\{tr\('discovery\.replay'\)\}/],
  [/onClick=\{\(\)=>viewRun\(runs\[0\]\)\}>\{tr\('discovery\.resumeResults'\)\}/,/onClick=\{\(\)=>m\.viewRun\(runs\[0\]!\)\}>\{tr\('discovery\.resumeResults'\)\}/],
  [/\{hasMoreRuns&&<button className="more-button" disabled=\{busy\} onClick=\{moreRuns\}>/,/\{m\.hasMoreRuns&&<Button[^>]*onClick=\{\(\)=>void m\.moreRuns\(\)\}>/],
  [/\{shown\.length>resultsShown&&<button className="more-button" onClick=\{\(\)=>setResultsShown\(n=>n\+resultsPage\(\)\)\}>/,/\{m\.shown\.length>m\.resultsShown&&<Button[^>]*onClick=\{m\.showMore\}>/],
 ] as const){assert.match(panel,legacyRe,String(legacyRe));assert.match(nat,v2Re,String(v2Re))}
 assert.match(panel,/selectTab:k=>\{setNoveltyTab\(k\);setResultsShown\(resultsPage\(\)\)\}/,'novelty tab: same effect as the legacy tab button');
 assert.match(nat,/aria-pressed=\{m\.noveltyTab===k\}/);
 assert.doesNotMatch(nat,/useEffect|setTimeout|setInterval|requestAnimationFrame/,'no automatic action: every action is a click');
});
test('form — what and where first; every legacy setting kept, folded in "Plus de réglages"',()=>{
 const main=nat.slice(nat.indexOf('<div className="pos-sform__main">'),nat.indexOf('<details className="pos-sform__more"'));
 for(const n of ['name="query"','name="location"','type="submit"'])assert.ok(main.includes(n),n);
 const more=nat.slice(nat.indexOf('<details className="pos-sform__more"'),nat.indexOf('</details>',nat.indexOf('<details className="pos-sform__more"')));
 for(const n of ['name="categories"','name="max"','name="search_mode"','name="desired"','onChange={e=>f.setProvider(e.target.value)}','name="employee_min"','name="employee_max"','registryPlan'])assert.ok(more.includes(n),n);
 for(const n of ['name="query"','name="location"','name="categories"','name="max"','name="search_mode"','name="desired"','name="employee_min"','name="employee_max"'])assert.ok(panel.includes(n),`legacy has ${n}`);
 assert.match(nat,/<option value="search_new" disabled=\{mode==='demo'\}>/);
 assert.match(nat,/disabled=\{mode==='demo'\|\|!f\.available\}/);
 assert.match(nat,/disabled=\{mode==='demo'\|\|!f\.registryAvailable\}/);
});
test('verification in words; numbers only in "Détails avancés"; unknown stays unknown',()=>{
 assert.deepEqual(verificationOf({state:'candidate',score:null},'fr'),{kind:'document',label:'À documenter',hint:'Aucune preuve vérifiée pour l’instant.'});
 assert.equal(verificationOf({state:'added',score:{kind:'verified',main:75,verified:75,toVerify:0,toVerifyPoints:0}},'fr').label,'Vérifié');
 assert.deepEqual(verificationOf({state:'added',score:{kind:'estimated',main:52,verified:null,toVerify:2,toVerifyPoints:30}},'fr'),{kind:'estimated',label:'Estimé',hint:'2 sources à vérifier'});
 assert.equal(verificationOf({state:'added',score:{kind:'none',main:null,verified:null,toVerify:0,toVerifyPoints:0}},'en').label,'To document');
 assert.equal(verificationOf({state:'unresolved',score:null},'fr').kind,'unknown','a source that names no company is never a signal nor a proof');
 assert.equal(scoreText(null,'fr'),null);assert.equal(scoreText({kind:'estimated',main:52,verified:null,toVerify:2,toVerifyPoints:30},'fr'),'52/100 (estimé)');
 const face=nat.slice(nat.indexOf('function ResultCard('),nat.indexOf('<details className="pos-sdetails">',nat.indexOf('function ResultCard(')));
 assert.doesNotMatch(face,/scoreText|\/100|score\.main/,'no number on the card face');
 assert.match(nat,/<dt>\{tr\('discovery\.currentScore'\)\}<\/dt><dd><b>\{scoreText\(f\.score,locale\)\?\?tr\('score\.notScored'\)\}<\/b>/,'the number, in Détails avancés');
 const order=['className="pos-sres__name"','className="pos-sres__place"','className="pos-sres__tags"','className="pos-sres__why"','className="pos-sres__verify"','className="pos-sres__actions"','<details className="pos-sdetails">'].map(n=>face.indexOf(n)>=0?face.indexOf(n):nat.indexOf(n));
 assert.deepEqual(order,[...order].sort((a,b)=>a-b),'company + place, novelty + priority, why, verification, action, details');
});
test('look — scoped, tokens only, 44 px targets, reduced motion, forced colours; CONTACT green unused',()=>{
 for(const rule of css.match(/^\.pos-ui[^{]*\{/gm)??[])assert.ok(rule.startsWith('.pos-ui .pos-search'),rule);
 assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g,''),/#[0-9a-f]{3,8}\b|rgb\(/i,'no raw colour');
 assert.doesNotMatch(css,/action-contact/);
 assert.match(css,/\.pos-stab\{[^}]*min-height:var\(--pos-size-target\)/);
 assert.match(css,/\.pos-sfield :where\(input,select\)\{width:100%;min-height:var\(--pos-size-target\)/);
 assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{\n \.pos-ui \.pos-search \.pos-sspinner\{animation:none\}/);
 assert.match(css,/@media \(forced-colors:active\)/);
 assert.match(css,/\.pos-stabs\{display:flex;[^}]*overflow-x:auto/,'the filter scrolls inside itself at 320 px');
});
test('scope — no engine, provider, scoring, quota, NBA / ZF, Today, Prospects, Stripe, pricing, DB or public-site change',()=>{
 const changed=git(`git diff --name-only ${MAIN}`).split('\n').filter(Boolean);
 assert.deepEqual(changed.filter(f=>!/^(app\/page\.tsx|app\/ui-v2\/search\/page\.tsx|docs\/UI_V2\.md|src\/ui\/v2\/search\/|src\/ui\/v2\/shell\/AppShell\.tsx|src\/components\/DiscoveryPanel\.tsx|tests\/(ui-v2-search|onboarding-quickstart)\.test\.ts)/.test(f)),[],'only UI-5B files');
});
test('bench — frozen states and the real panel in demo mode; no network',()=>{
 const bench=read('../src/ui/v2/search/SearchBench.tsx'),fx=read('../src/ui/v2/search/fixture.ts');
 assert.match(fx,/export const BENCH_STATES:readonly BenchState\[\]=\['results','empty','loading','error','quota','start'\];/);
 assert.doesNotMatch(fx,/fetch\(|api\(/);
 assert.match(bench,/mode="demo" api=\{api\}/);assert.match(bench,/const api=async\(\)=>\(\{\}\);/);
 assert.match(read('../app/ui-v2/layout.tsx'),/if\(!uiV2Enabled\(process\.env\)\)notFound\(\);/);
});
test('final polish — compact face: no CANDIDAT badge, short reasons, source one tap away, technical metadata in the details',()=>{
 const face=nat.slice(nat.indexOf('function ResultCard('),nat.indexOf('<details className="pos-sdetails">',nat.indexOf('function ResultCard(')));
 assert.match(face,/const stateTag=f\.state!=='candidate'&&!\(f\.state==='added'&&f\.nov\?\.status==='ADDED'\);/,'the candidate state stays implicit on the face');
 assert.match(face,/const why=pr\?shortReasons\(pr\.reasons,locale\):/,'the same reasons, said short');
 assert.match(face,/<a className="pos-sres__source" href=\{r\.normalized_payload\.source_url\}/,'the source stays one tap away');
 for(const n of ['resolutionBothLabel','resolutionNameOnlyLabel','discoveryFoundNote','identifiedCompanyLabel','companyWebsiteLabel','signalFoundVia','scoreText','f.viaThirdParty&&<span'])
  assert.ok(!face.includes(n),`not on the face: ${n}`);
 const adv=nat.slice(nat.indexOf('<details className="pos-sdetails">',nat.indexOf('function ResultCard(')),nat.indexOf('function RunDetails('));
 for(const n of ["tr('discovery.identifiedCompanyLabel')","tr('discovery.companyWebsiteLabel')","tr('discovery.signalFoundVia')","tr('discovery.resolutionLabel')",'discoveryFoundNote(','<dt>{t.sources}</dt>',"tr('discovery.currentScore')","tr('discovery.reviewPriority')","tr('discovery.signalSourceNote')","tr('discovery.priorityExplain')","tr('discovery.notAddable')",'additional_sources'])
  assert.ok(adv.includes(n),`kept in Détails avancés: ${n}`);
 assert.match(face,/<Button variant="primary" size="sm" iconStart="plus" disabled=\{m\.busy\} onClick=\{\(\)=>m\.accept\(/,'add stays the primary CTA');
 assert.match(face,/<Button variant="quiet" size="sm" disabled=\{m\.busy\} onClick=\{\(\)=>m\.ignore\(r\)\}>\{tr\('discovery\.ignore'\)\}<\/Button><\/>/,'ignore stays secondary');
});
test('short reasons — the same review-priority reasons, every one worded, none added',async()=>{
 const {SHORT_REASON,shortReasons,priorityChip}=await import('../src/ui/v2/search/model.ts');
 const src=read('../src/discovery/review-priority.ts');
 const reasons=[...src.slice(src.indexOf('export type ReviewPriorityReason'),src.indexOf(';',src.indexOf('export type ReviewPriorityReason'))).matchAll(/'([a-z_]+)'/g)].map(x=>x[1]).sort();
 for(const l of ['fr','en'] as const)assert.deepEqual(Object.keys(SHORT_REASON[l]).sort(),reasons,l);
 assert.equal(shortReasons(['official_site','website_identified','query_terms_observed','location_mentioned'],'fr'),'Site officiel identifié · site identifié · activité cohérente');
 assert.equal(shortReasons([],'fr'),'');
 assert.equal(priorityChip('HIGH','fr'),'Priorité élevée');
});
