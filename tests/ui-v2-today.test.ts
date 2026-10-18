// UI-3 Today 2.0 (docs/UI_V2.md): V2 presentation of "Aujourd'hui" on top of the ZF1 model. Pins the card hierarchy,
// the colour rules (green = CONTACT only), level 2 without scores, level 3 with them, the ZF1.1 actions, the honest
// completion (no USER_DECLARED persistence), the new ZF_WHY_OPENED event and the flag gating. Browser behaviour
// (mobile first card, 320 px, desktop action proximity, Sheet / ContextDrawer) is checked with Playwright on /ui-v2/today.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {todayV2,ageText,sourceLabel} from '../src/ui/v2/today/model.ts';
import {CANARY_ROWS,ALL_STATES_ROWS} from '../src/ui/v2/today/fixture.ts';
import {buildTodayModel,SECTION_ORDER} from '../src/nba/today.ts';
import {light,dark} from '../src/ui/v2/tokens.ts';
import {contrastRatio} from '../src/ui/v2/color.ts';
import {ZF_KINDS,zfPayload} from '../src/server/ux-events.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const SCORE_WORDS=/\bFIT\b|INTENT|TIMING|Opportunit|Couverture|Qualité de preuve|INCOMPLETE_FIT|\bscore/i;

test('model — 6XPOS canary: engine order, signal signature, status, short explanation, one action',()=>{
 const m=todayV2(CANARY_ROWS,'fr');
 assert.deepEqual(m.cards.map(c=>c.name),['Quick','Mojo','O’Crousti Poulet']);
 assert.deepEqual(m.counts,{contact:0,verify:3,engage:0,watched:0,document:0});
 const q=m.cards[0]!;
 assert.deepEqual(q.signal,{kind:'signal',type:'Expansion',place:'Hérault',age:'il y a 25 jours'});
 assert.equal(q.status,'verify');
 assert.equal(q.explanation,'Correspond à votre cible sur les critères déjà vérifiés.');
 assert.equal(q.note,'3 informations à documenter.');
 assert.deepEqual({kind:q.action.kind,label:q.action.label,tone:q.action.tone},{kind:'VERIFY_INFORMATION',label:'Compléter les informations',tone:'primary'});
 assert.equal(m.cards[1]!.signal?.type,'Nouvelle implantation');
 assert.equal(m.cards[1]!.signal?.place,'Toulouse');
});
test('model — the engine order is exactly ZF1’s (sections, then the engine ranking)',()=>{
 for(const rows of [CANARY_ROWS,ALL_STATES_ROWS]){
  const zf=buildTodayModel(rows);
  assert.deepEqual(todayV2(rows,'fr').cards.map(c=>c.id),SECTION_ORDER.flatMap(s=>zf.sections[s].map(c=>c.id)));
 }
});
test('model — ZF1.1 actions: CONTACT, ENGAGE, signal to check, missing information, nothing to do; WAIT never shown',()=>{
 const by=Object.fromEntries(todayV2(ALL_STATES_ROWS,'fr').cards.map(c=>[c.id,c]));
 assert.equal(by.contact!.action.label,'Préparer le message');
 assert.equal(by.engage!.action.label,'Voir la conversation');
 assert.equal(by.inferred!.action.label,'Vérifier le signal');
 assert.equal(by.inferred!.action.signalId,'s-inferred');
 assert.equal(by.mojo!.action.label,'Compléter les informations');
 assert.equal(by.watch!.action.kind,'NONE');assert.equal(by.watch!.action.label,null);
 assert.equal(by.wait,undefined);
 assert.equal(by.engage!.signal?.type,'Conversation publique');
});
test('colours — green is CONTACT only; every other primary action is indigo',()=>{
 const cards=todayV2(ALL_STATES_ROWS,'fr').cards;
 for(const c of cards){
  if(c.action.kind==='PREPARE_MESSAGE')assert.equal(c.action.tone,'contact');
  else if(c.action.kind!=='NONE')assert.equal(c.action.tone,'primary',c.id);
 }
 const src=read('../src/ui/v2/today/TodayV2.tsx');
 assert.match(src,/variant=\{card\.action\.tone==='contact'\?'contact':'primary'\}/);
 const css=read('../src/ui/v2/foundations.css');
 assert.match(css,/\.pos-ui \.pos-btn--contact\{background:var\(--pos-action-contact\);color:var\(--pos-on-action-contact\)\}/);
 assert.match(css,/\.pos-ui \.pos-btn--primary\{background:var\(--pos-accent\)/);
 for(const t of [light,dark]){
  assert.ok(contrastRatio(t.colors['on-action-contact'],t.colors['action-contact'])>=4.5,`${t.name} contact action label`);
  assert.notEqual(t.colors['action-contact'],t.colors.accent);
 }
 // Status colours: contact green, verify amber, watch blue-grey, signal cyan.
 const today=read('../src/ui/v2/today/today.css');
 assert.match(today,/\.pos-signal__type\{[^}]*color:var\(--pos-signal\)/);
 assert.match(today,/\.pos-checks__todo\{color:var\(--pos-status-verify-dot\)/);
});
test('card hierarchy — company, signal, status, explanation, action, "Voir pourquoi"',()=>{
 const src=read('../src/ui/v2/today/TodayV2.tsx');
 const card=src.slice(src.indexOf('function Card('),src.indexOf('// Level 2'));
 const order=['pos-tcard__name','<SignalLine','<StatusBadge','pos-tcard__why','<ActionButton','{t.why}'].map(k=>card.indexOf(k));
 assert.ok(order.every(i=>i>0),String(order));
 assert.deepEqual([...order].sort((a,b)=>a-b),order,'rendered in this order');
 assert.match(read('../src/ui/v2/today/model.ts'),/Level 2 {2}signal, source, freshness \(age\), place, favourable elements, missing information — never a score/);
});
test('level 2 — signal, source, freshness, place, favourable, missing — and never a score',()=>{
 for(const c of todayV2(ALL_STATES_ROWS,'fr').cards){
  const l2=JSON.stringify(c.level2)+JSON.stringify({s:c.signal,e:c.explanation,n:c.note});
  assert.doesNotMatch(l2,SCORE_WORDS,c.id);
  for(const s of c.level3.scores)if(/^\d+/.test(s.value))assert.ok(!l2.includes(`"${s.value}"`),`${c.id}: score value ${s.value} in level 2`);
 }
 const q=todayV2(CANARY_ROWS,'fr').cards[0]!;
 assert.deepEqual(q.level2.source,{label:'infoccitanie.fr',url:'https://www.infoccitanie.fr/'});
 assert.equal(q.level2.freshness,'Signal il y a 25 jours');
 assert.equal(q.level2.place,'Hérault — dans votre zone');
 assert.equal(q.level2.favourable.length,1);assert.equal(q.level2.missing.length,3);
 const src=read('../src/ui/v2/today/TodayV2.tsx');
 const l2=src.slice(src.indexOf('function Level2('),src.indexOf('// Level 3'));
 assert.doesNotMatch(l2,/level3|scores|rule/);
});
test('level 3 — FIT, TIMING, INTENT, opportunity, coverage, rule, evidence states, provenance, raw place',()=>{
 const q=todayV2(CANARY_ROWS,'fr').cards[0]!;
 const labels=q.level3.scores.map(s=>s.label);
 for(const l of ['Opportunité','FIT','Couverture ICP','INTENT','TIMING','Fraîcheur','Qualité de preuve','Lieu (données)'])assert.ok(labels.includes(l),l);
 assert.equal(q.level3.scores.find(s=>s.label==='FIT')!.value,'35 (mixed)');
 assert.equal(q.level3.scores.find(s=>s.label==='Lieu (données)')!.value,'Hérault (34)');
 assert.equal(q.level3.rule,'INCOMPLETE_FIT_FRESH_SIGNAL');
 assert.deepEqual(q.level3.evidence,[{label:'Signal',value:'VERIFIED'},{label:'FIT',value:'INCOMPLETE'},{label:'Base FIT',value:'mixed'}]);
 assert.ok(q.level3.statements.length>0&&q.level3.statements.some(s=>s.refs.some(r=>r.source_url)));
});
test('completion — the evidence workflow, plus (UI-4) a declaration without a source in the same panel; no other new call',()=>{
 const src=read('../src/ui/v2/today/TodayV2.tsx');
 // UI-4: the button is live and opens the declaration form in the same ContextPanel (no new page).
 assert.match(src,/<Button variant="secondary" size="md" fullWidth iconStart="declared" disabled=\{busy\|\|!criteria\.length\} onClick=\{\(\)=>openPanel\(current,'declare'\)\}>\{t\.declare\}<\/Button>/);
 assert.doesNotMatch(src,/declareSoon|disponible prochainement/);
 assert.match(src,/onOpenProspect\(current\.prospectId\)\}\}>\{t\.openRecord\}/);
 // The only write Today adds: POST evidence USER_DECLARED, with no source and no author (tests/user-declared.test.ts).
 assert.match(src,/api\('evidence','POST',\{prospect_id:c\.prospectId,criterion:v\.criterion,value:v\.value,status:'USER_DECLARED',\.\.\.\(v\.note\?\{note:v\.note\}:\{\}\)\}\)/);
 const write=src.slice(src.indexOf('const declare=async'),src.indexOf('const toggle='));
 assert.doesNotMatch(write,/VERIFIED'|source_url|excerpt|verified_by|declared_by|organization_id/,'never a verified status, a source or an author from Today');
 assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm,''),/'VERIFIED'|verified_by|declared_by/);
 const calls=[...src.matchAll(/api\(`([^`]+)`/g)].map(m=>m[1]);
 assert.deepEqual(calls,['projects/${projectId}/next-best-actions/ensure-fresh','projects/${projectId}/next-best-actions/home','signals/${c.action.signalId}/review']);
 const legacy=read('../src/components/TodayPanel.tsx');
 for(const c of calls)assert.ok(legacy.includes(c.replace('c.action.signalId','c.primary.signalId')),`same call as TodayPanel: ${c}`);
});
test('observability — ZF_WHY_OPENED for level 2, ZF_ADVANCED_DETAILS_OPENED for level 3 only; project_id in the payload',()=>{
 assert.ok((ZF_KINDS as readonly string[]).includes('ZF_WHY_OPENED'));
 const src=read('../src/ui/v2/today/TodayV2.tsx');
 assert.match(src,/if\(mode==='why'\)track\('ZF_WHY_OPENED'\)/);
 assert.equal((src.match(/ZF_ADVANCED_DETAILS_OPENED/g)??[]).length,1);
 assert.match(src,/aria-expanded=\{advanced\}[\s\S]{0,200}if\(next\)track\('ZF_ADVANCED_DETAILS_OPENED'\)/);
 const base={kind:'ZF_WHY_OPENED',sessionId:'00000000-0000-4000-8000-0000000000aa',elapsedMs:10,interactions:1,userId:'00000000-0000-4000-8000-000000000001'};
 assert.equal(zfPayload({...base,projectId:'00000000-0000-4000-8000-0000000000b1'})!.project_id,'00000000-0000-4000-8000-0000000000b1');
 assert.equal(zfPayload({...base,projectId:'not-a-uuid'}),null);
 assert.match(read('../src/server/ux-events.ts'),/projectId:b\.project_id,kind:b\.kind/);
});
test('flag — Today 2.0 only with UI_V2_ENABLED (shell loaded) AND ZERO_FRICTION_TODAY_ENABLED (zfOn); otherwise unchanged',()=>{
 const page=read('../app/page.tsx');
 const v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));
 assert.match(v2,/screen=\{view==='today'&&mode==='live'&&zfOn&&project\?<v2\.TodayV2 key=\{`today-v2-\$\{projectId\}`\}/);
 const legacy=page.slice(page.indexOf(' return <div className="shell">'));
 assert.doesNotMatch(legacy,/TodayV2/);
 assert.match(page,/\{view==='today'&&mode==='live'&&zfOn&&project&&<TodayPanel key=\{`today-\$\{projectId\}`\}/,'legacy Today untouched');
 assert.doesNotMatch(read('../src/components/TodayPanel.tsx'),/ui\/v2|TodayV2|ZF_WHY_OPENED/);
 const shell=read('../src/ui/v2/shell/AppShell.tsx');
 assert.match(shell,/\{screen\?\?<div className="pos-legacy">\{children\}<\/div>\}/);
 assert.match(shell,/export \{TodayV2\} from '\.\.\/today\/TodayV2\.tsx';/,'loaded with the shell, never statically by the page');
 // The bench lives under /ui-v2 (404 unless UI_V2_ENABLED).
 assert.match(read('../app/ui-v2/today/page.tsx'),/TodayBench/);
});
test('styles — Today 2.0 CSS: tokens only, scoped, reading width, compact mobile action',()=>{
 const css=read('../src/ui/v2/today/today.css').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
 const sel=[...css.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)].map(m=>m[1]!.trim()).filter(s=>s&&!/^(from|to|\d+%)$/.test(s));
 for(const s of sel)for(const part of s.split(/,(?![^(]*\))/))assert.match(part.trim(),/^\.pos-ui/,part);
 assert.match(css,/max-width:calc\(720px \+ 2 \* var\(--pos-space-8\)\)/);
 assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
 for(const n of readdirSync(new URL('../src/ui/v2/today/',import.meta.url)).filter(n=>n.endsWith('.tsx')))
  assert.doesNotMatch(read(`../src/ui/v2/today/${n}`),/#[0-9a-f]{3,8}\b|rgba?\(/i,n);
});
test('helpers — ages and source labels (FR / EN)',()=>{
 assert.equal(ageText(0,'fr'),'aujourd’hui');assert.equal(ageText(1,'fr'),'il y a 1 jour');assert.equal(ageText(6,'en'),'6 days ago');assert.equal(ageText(null,'fr'),null);
 assert.equal(sourceLabel('https://www.ladepeche.fr/x'),'ladepeche.fr');assert.equal(sourceLabel('javascript:alert(1)'),null);
 assert.equal(todayV2(CANARY_ROWS,'en').cards[0]!.signal?.age,'25 days ago');
});
test('filter "en veille" — shows every company its chip counts, WAIT included; WAIT never in the default view',()=>{
 const m=todayV2(ALL_STATES_ROWS,'fr');
 assert.equal(m.counts.watched,m.watched.length,'chip count = cards shown by the filter');
 assert.deepEqual(m.watched.map(c=>c.id),['watch','wait']);
 const wait=m.watched.find(c=>c.id==='wait')!;
 assert.equal(wait.section,'watch');assert.equal(wait.status,'watch');assert.equal(wait.action.kind,'NONE');
 assert.ok(!m.cards.some(c=>c.id==='wait'),'default view: WAIT never takes a card (ZF1)');
 assert.ok(!m.watched.some(c=>c.id==='dismiss'));
 assert.match(read('../src/ui/v2/today/TodayV2.tsx'),/filter==='watch'\?model\.watched:/);
});
