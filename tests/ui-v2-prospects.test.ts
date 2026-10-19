// UI-5A Prospects 2.0 (docs/UI_V2.md): v2 presentation of the Prospects entry on top of the legacy data and handlers.
// Pins the list (same visible prospects, FIT said in words, never a leading /100), the record hierarchy, the honest
// rendering of evidence (VERIFIED = proof, USER_DECLARED = "Déclaré par vous", never green, INFERRED / NOT_VERIFIED = to
// check), the reuse of the legacy handlers and dialogs, and the flag gating (flag OFF = the legacy screen, unchanged).
// Browser behaviour (320 px, desktop, light / dark, keyboard, reduced motion, actions) is checked with Playwright on
// the /ui-v2/prospects bench (Preview).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {prospectRows,fitBadge,criteriaView,situationOf,advancedOf,criterionStateLabel} from '../src/ui/v2/prospects/model.ts';
import {BENCH_CRITERIA,benchProspects} from '../src/ui/v2/prospects/fixture.ts';
import {scoreProspect,type Prospect} from '../src/domain/core.ts';
import {estimateFit} from '../src/domain/fit-estimate.ts';
import {fitDisplay} from '../src/domain/score-display.ts';
import type {ReviewSummary} from '../src/components/evidence-presentation.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const NOW=new Date('2026-10-18T12:00:00Z');
const ALL=benchProspects(NOW);
const by=(id:string)=>ALL.find(p=>p.id===id)!;
// The legacy list filter, verbatim (app/page.tsx `visible`): Prospects 2.0 receives this very array.
const legacyVisible=(ps:Prospect[],query:string,filter:string)=>ps.filter(p=>p.project_id==='bench'&&p.name.toLowerCase().includes(query.toLowerCase())&&(filter==='Tous'||p.status===filter));
const READY=(id:string):ReviewSummary=>({criteria:{},linkedEvidenceIds:[],contextEvidenceIds:[],ready:true,prospectId:id});
const record=(id:string,summary:ReviewSummary=READY(id))=>{const p=by(id);return criteriaView(scoreProspect(BENCH_CRITERIA,p.evidence,NOW).breakdown,estimateFit(BENCH_CRITERIA,p.evidence,NOW),summary,p,'fr')};

test('list — empty: no row',()=>{
 assert.deepEqual(prospectRows([],BENCH_CRITERIA,'fr',NOW),[]);
});
test('list — one row per visible prospect, same order; name, place, human status, FIT in words',()=>{
 const rows=prospectRows(ALL,BENCH_CRITERIA,'fr',NOW);
 assert.deepEqual(rows.map(r=>r.id),ALL.map(p=>p.id));
 const k=rows[0]!;
 assert.deepEqual([k.name,k.initial,k.place,k.statusLabel],['Kantina','K','Toulouse','À contacter']);
 assert.equal(rows.find(r=>r.id==='crousti')!.place,null,'no city: shown as "Localisation à confirmer", never invented');
 const fit=Object.fromEntries(rows.map(r=>[r.id,[r.fit.kind,r.fit.label,r.fit.hint]]));
 assert.deepEqual(fit,{
  kantina:['estimated','Estimé','1 source à vérifier · déclaré par vous'],
  mojo:['estimated','Estimé','déclaré par vous'],
  crousti:['document','À documenter','Aucune information documentée'],
  pausa:['verified','Vérifié',null],
  brasserie:['estimated','Estimé','1 source à vérifier'],
 });
 for(const r of rows)assert.doesNotMatch(JSON.stringify(r),/\/100|\bscore\b/i,'no /100 in the list');
});
test('list — search and status filter: the legacy filter, untouched (the component only renders `visible`)',()=>{
 assert.deepEqual(legacyVisible(ALL,'PAU','Tous').map(p=>p.id),['pausa']);
 assert.deepEqual(legacyVisible(ALL,'','Contacté').map(p=>p.id),['crousti']);
 assert.deepEqual(legacyVisible(ALL,'zzz','Tous'),[]);
 const page=read('../app/page.tsx');
 assert.match(page,/const visible=prospects\.filter\(p=>p\.project_id===projectId&&p\.name\.toLowerCase\(\)\.includes\(query\.toLowerCase\(\)\)&&\(filter==='Tous'\|\|p\.status===filter\)\);/);
 assert.match(page,/<v2\.ProspectsV2 locale=\{locale\} busy=\{busy\} visible=\{visible\} total=\{all\.length\}/);
 assert.match(page,/query=\{query\} onQuery=\{setQuery\} filter=\{filter\} onFilter=\{setFilter\}/);
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 assert.match(ui,/<option value="Tous">\{t\.all\}<\/option>\{p\.statuses\.map\(s=><option key=\{s\} value=\{s\}>\{statusLabel\(s,p\.locale\)\}<\/option>\)\}/,'same values as the legacy select');
 assert.match(ui,/onClick=\{\(\)=>\{p\.onQuery\(''\);p\.onFilter\('Tous'\)\}\}/,'no match: one action clears both');
});
test('FIT badge — fitDisplay wording; a declaration makes it "Estimé", never "Vérifié"',()=>{
 const e=(id:string)=>estimateFit(BENCH_CRITERIA,by(id).evidence,NOW);
 assert.equal(fitDisplay(e('mojo')).kind,'none','the legacy badge rule does not count declarations');
 assert.equal(fitBadge(fitDisplay(e('mojo')),e('mojo'),'fr').kind,'estimated');
 assert.equal(fitBadge(fitDisplay(e('pausa')),e('pausa'),'en').label,'Verified');
 assert.equal(fitBadge(fitDisplay(e('crousti')),e('crousti'),'en').label,'To document');
});
test('record — USER_DECLARED is "Déclaré par vous" (its own basis), VERIFIED is a proof, NOT_VERIFIED / INFERRED are to check',()=>{
 const v=record('kantina');
 assert.deepEqual(v.map(c=>[c.key,c.state,c.stateLabel]),[
  ['target_fit','verified','Vérifié'],['local_decision','declared','Déclaré par vous'],['need_fit','to_verify','À vérifier'],['contactability','unknown','Non documenté']]);
 const declared=v[1]!.items[0]!;
 assert.deepEqual([declared.basis,declared.text,declared.note,declared.href,declared.verifiable],['declared','Critère rempli selon vous','Le gérant décide seul, vu au salon.',null,false],
  'a declaration: the person’s words, no source link, nothing to "verify"');
 assert.match(declared.statusLabel,/Déclaré par vous/);assert.doesNotMatch(declared.statusLabel,/^Vérifi/);
 const verified=v[0]!.items[0]!;
 assert.deepEqual([verified.basis,verified.href,verified.verifiable],['verified','https://presse.example/kantina',false]);
 const toCheck=v[2]!.items[0]!;
 assert.deepEqual([toCheck.basis,toCheck.verifiable,toCheck.statusLabel],['to_verify',true,'À confirmer']);
 const b=record('brasserie');assert.deepEqual([b[2]!.state,b[2]!.items[0]!.statusLabel],['to_verify','Supposée']);
 const m=record('mojo');assert.deepEqual(m.slice(0,2).map(c=>c.state),['declared','declared_false']);
 assert.equal(criterionStateLabel('declared_false','fr'),'Déclaré non rempli par vous');
});
test('record — evidence the observations block already shows is not listed twice (legacy rule)',()=>{
 assert.deepEqual(record('kantina',{criteria:{},linkedEvidenceIds:[],contextEvidenceIds:[]}).flatMap(c=>c.items),[],'not loaded yet: nothing listed');
 const linked=record('kantina',{...READY('kantina'),linkedEvidenceIds:['k-n']});
 assert.deepEqual(linked.flatMap(c=>c.items.map(i=>i.id)),['k-v','k-d']);
 const pending=record('kantina',{...READY('kantina'),criteria:{contactability:{anchorId:'criterion-review-contactability',pending:2,total:2,tone:'pending' as never,statusLabel:'',excerpts:[]}}});
 assert.deepEqual([pending[3]!.state,pending[3]!.reviewAnchor],['to_verify','criterion-review-contactability']);
});
test('record — situation in one sentence; scores only in the advanced details',()=>{
 assert.equal(situationOf(record('kantina'),'fr'),'1 critère sur 4 vérifié · 1 déclaré par vous · 1 à vérifier · 1 à documenter.');
 assert.equal(situationOf(record('pausa'),'en'),'2 of 4 criteria verified · 2 to document.');
 const p=by('pausa');const s=scoreProspect(BENCH_CRITERIA,p.evidence,NOW);
 assert.deepEqual(advancedOf(s,fitDisplay(estimateFit(BENCH_CRITERIA,p.evidence,NOW)),'fr').map(f=>f.value),['50/100','—','0','50%','50/100']);
 assert.deepEqual(advancedOf(s,fitDisplay(estimateFit(BENCH_CRITERIA,p.evidence,NOW)),'fr',{score:20,estimated:{score:45}}).slice(0,2).map(f=>f.value),['20/100','45/100'],'INTENT in the details');
 assert.match(read('../src/ui/v2/prospects/prospects.css'),/\.pos-ui \.pos-island \.intent-pill\{display:none\}/,'no INTENT pill in the context section');
 assert.match(read('../app/page.tsx'),/summary:reviewSummary,intent:detailIntent,/);
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 const hero=ui.slice(ui.indexOf('<header className="pos-prec__hero">'),ui.indexOf('</header>',ui.indexOf('<header className="pos-prec__hero">')));
 assert.doesNotMatch(hero,/score|\/100|coverage|fit\.main/i,'no score in the hero');
 assert.ok(ui.indexOf('advancedOf(')>ui.indexOf('data-testid="record-advanced"'),'the numbers live in "Détails avancés"');
});
test('record — hierarchy: company, situation, signals & context, evidence, human action, details on demand',()=>{
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 const at=(n:string)=>{const i=ui.indexOf(n,ui.indexOf('function Record('));assert.ok(i>0,n);return i};
 const order=[at('className="pos-prec__hero"'),at('id="pos-prec-situation"'),at('id="pos-prec-context"'),at('id="pos-prec-evidence"'),at('<Outreach '),at('id="pos-prec-decision"'),at('data-testid="record-history"'),at('data-testid="record-advanced"')];
 assert.deepEqual(order,[...order].sort((a,b)=>a-b));
});
test('colours — declared never borrows the verified green; the commercial status is neutral',()=>{
 const css=read('../src/ui/v2/prospects/prospects.css');
 assert.match(css,/\.pos-pev--declared\{border-left-color:var\(--pos-status-declared-dot\)/);
 assert.match(css,/\.pos-pcrit__icon--declared\{color:var\(--pos-status-declared-fg\)\}/);
 for(const [,sel,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/declared/.test(sel!))assert.doesNotMatch(body!,/verified/,`no verified colour on ${sel!.trim()}`);
 assert.match(css,/\.pos-pstatus\{[^}]*background:var\(--pos-surface-muted\)/);
 assert.doesNotMatch(css,/action-contact/,'the CONTACT green is not used on this screen');
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 assert.match(ui,/const BASIS_STATUS=\{verified:'verified',declared:'declared',to_verify:'verify'\} as const;/);
});
test('actions — the record calls the legacy handlers and dialogs; nothing is sent from here',()=>{
 const page=read('../app/page.tsx');
 const v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));
 assert.match(v2,/onStatus:status,onAddEvidence:\(\)=>setModal\('evidence'\),onAnalyze:\(\)=>setModal\('analyze'\),onAddChannel:\(\)=>setModal\('channel'\),onVerify:verifyEvidence,onReview:reviewCriterion,/);
 assert.match(v2,/onChange:setDraft,onGenerate:generate,onSave:saveDraft,onApprove:approveDraft,onCopy:copyApproved\}/);
 assert.match(v2,/onAdd=\{\(\)=>\{setQuickResume\(null\);setModal\(project\?'prospect':mode==='live'\?'quickstart':'project'\)\}\} onExport=\{download\}/);
 assert.match(v2,/\{v2\.ProspectsV2|<v2\.ProspectsV2 /);
 assert.match(page,/<\/Shell>\{overlays\}<\/>\}/,'the legacy dialogs (prospect, evidence, analyze, channel) stay the same, outside the shell');
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 assert.doesNotMatch(ui,/fetch\(|api\(|mailto:|\.send\(|navigator\.clipboard/,'no network call, no sending, no copying from the component');
 assert.match(ui,/\{drafted&&o\.status==='APPROVED'&&<Button variant="secondary" size="md" disabled=\{busy\} onClick=\{o\.onCopy\}>/,'copy only once approved');
 assert.match(ui,/readOnly=\{o\.status!=='DRAFT'\}/);
 assert.match(ui,/target="_blank" rel="noopener noreferrer">\{t\.source\}/,'a source opens in a new tab');
 assert.match(v2,/linkedin:\(\(\)=>\{const c=current\.channels\?\.find\(c=>c\.kind==='linkedin'&&c\.verified&&safeLink\(c\.value\)\);return c\?safeLink\(c\.value\):null\}\)\(\)/,'LinkedIn only when verified and a safe link');
});
test('navigation — list until a record is opened; back returns to the list and focuses the row',()=>{
 const page=read('../app/page.tsx');
 assert.match(page,/record=\{current&&scored&&fit&&v2Record===current\.id\?/);
 assert.match(page,/onOpen=\{id=>\{revision\.current\+\+;setSelected\(id\);setFromDiscovery\(false\);setFromList\(true\);setV2Record\(id\)\}\}/,'the legacy row click, plus "open"');
 assert.match(page,/back:origin==='discovery'\?\{label:tr\('discovery\.backToSearch'\)\.replace\(\/\^←\\s\*\/,''\),onBack:backToDiscovery\}:\{label:tr\('detail\.backToProspects'\)\.replace\(\/\^←\\s\*\/,''\),onBack:\(\)=>\{setV2Focus\(current\.id\);setV2Record\(''\)\}\}/);
 assert.match(page,/if\(target==='prospects'\)\{setV2Record\(''\);setV2Focus\(null\);setFromDiscovery\(false\)\}/,'the nav entry always shows the list');
 for(const open of ["setSelected(p.id);setFromDiscovery(false);setFromList(true);setV2Record(p.id);","clearDraft();setSelected(prospectId);setV2Record(prospectId);","onOpenProspect={id=>{setSelected(id);setV2Record(id);"])
  assert.ok(page.includes(open),open);
 assert.match(page,/if\(v2DraftFor\.current&&v2DraftFor\.current!==v2Record\)clearDraft\(\)/,'a draft never follows another record');
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 assert.match(ui,/useEffect\(\(\)=>\{if\(p\.focusId\)refs\.current\.get\(p\.focusId\)\?\.focus/);
 assert.match(ui,/<h2 id="pos-prec-name" ref=\{heading\} tabIndex=\{-1\}/);
});
test('accessibility — labelled controls, keyboard rows, 44 px targets, reduced motion, forced colours',()=>{
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx');
 assert.match(ui,/aria-label=\{t\.open\(row\.name\)\}/);
 assert.match(ui,/<span className="pos-visually-hidden">\{t\.search\}<\/span>/);
 assert.match(ui,/<span className="pos-visually-hidden">\{t\.filter\}<\/span>/);
 assert.match(ui,/e\.key!=='ArrowDown'&&e\.key!=='ArrowUp'/);
 assert.match(ui,/aria-live="polite"/);
 const css=read('../src/ui/v2/prospects/prospects.css');
 assert.match(css,/\.pos-prow\{[^}]*min-height:var\(--pos-size-target\)/);
 assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{\n \.pos-ui \.pos-prow,\.pos-ui \.pos-pdetails>summary \.pos-icon\{transition:none\}/);
 assert.match(css,/@media \(forced-colors:active\)/);
 for(const rule of css.match(/^\.pos-ui[^{]*\{/gm)??[])assert.ok(rule.startsWith('.pos-ui '),rule);
});
test('flag OFF — the legacy Prospects screen is unchanged (its markup is byte-identical to main)',()=>{
 const before=execSync('git show 8a927c4:app/page.tsx',{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 const page=read('../app/page.tsx');
 const region=(src:string)=>src.slice(src.indexOf(" {view==='prospects'&&!showQuickStart&&<div className="),src.indexOf(' const overlays=<>'));
 assert.ok(region(before).length>1000);
 assert.equal(region(page),region(before),'legacy list + record');
 const shell=(src:string)=>src.slice(src.indexOf(' return <div className="shell">'));
 assert.equal(shell(page),shell(before),'legacy shell');
 assert.equal(page.slice(page.indexOf(' const overlays=<>'),page.indexOf(' const contentClass=')),before.slice(before.indexOf(' const overlays=<>'),before.indexOf(' const contentClass=')),'same dialogs');
});
test('scope — no migration, NBA, ZF, Discovery, Stripe, pricing or public site file changed',()=>{
 const changed=execSync('git diff --name-only 8a927c4 836d8e9',{cwd:new URL('..',import.meta.url),encoding:'utf8'}).split('\n').filter(Boolean);
 for(const f of changed)assert.doesNotMatch(f,/^db\/|^src\/(nba|ux|discovery|signal-discovery|server|domain|outreach)\/|stripe|pricing|^src\/ui\/v2\/(public|home)\/|^app\/(api|tarifs)/,f);
});
test('mobile polish — export quieter than add, unknown place quieter, compact cards (320–390 px)',()=>{
 const ui=read('../src/ui/v2/prospects/ProspectsV2.tsx'),css=read('../src/ui/v2/prospects/prospects.css');
 assert.match(ui,/<Button variant="secondary" size="sm" className="pos-plist__export" onClick=\{p\.onExport\}>/);
 assert.match(ui,/<Button variant="primary" size="sm" iconStart="plus" disabled=\{p\.busy\} onClick=\{p\.onAdd\}>/,'add stays the primary action');
 assert.match(css,/@media \(max-width:640px\)\{[^]*\.pos-ui \.pos-btn\.pos-plist__export\{order:1;background:transparent;border-color:transparent;/);
 assert.match(ui,/className=\{`pos-prow__meta\$\{row\.place\?'':' pos-prow__meta--unknown'\}`\}/);
 assert.match(css,/\.pos-ui \.pos-prow__meta--unknown\{color:var\(--pos-text-3\);font-size:var\(--pos-text-xs\)\}/);
 assert.match(css,/\.pos-ui \.pos-prow \.pos-fit__hint\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
 assert.match(css,/@media \(max-width:359px\)\{\.pos-ui \.pos-prow \.pos-fit__hint\{display:none\}\}/);
 assert.match(ui,/<small className="pos-fit__hint" title=\{hint\}>/,'the full hint stays available');
});
test('evidence excerpt — the quoted source takes its background AND its text from the theme (readable in dark mode)',()=>{
 const css=read('../src/ui/v2/prospects/prospects.css');
 assert.match(css,/\.pos-ui \.pos-island \.observations blockquote\{background:var\(--pos-surface-card\);border-left-color:var\(--pos-border-strong\);color:var\(--pos-text-1\)\}/);
 // The legacy light rule stays as is for the legacy screen (flag OFF); only the v2 island overrides it.
 assert.match(read('../app/globals.css'),/\.observations blockquote\{margin:10px 0;padding:8px 12px;border-left:3px solid #bad498;background:#f7f9f3;/);
});
