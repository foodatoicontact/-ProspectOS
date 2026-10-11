// UX A/B — wiring of the prospect detail page. A is today's page, unchanged. B ("Workflow-first", Figma B — REIMAGINED)
// is presentation only: a decision cockpit — hero (why now), decision stack (existing FIT, existing verified INTENT),
// the SAME message block as the Next best action card, an evidence timeline — and the SAME proof panels (evidence review,
// signals, public content) grouped as collapsed secondary justifications. One instance of every panel and of the
// message block exists in the page source: B reorders and groups them, it never duplicates a fetch, a mutation, a score,
// the angle selector, the composer or the lifecycle. Copy stays distinct from "Marquer contacté".
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {markViewOnce} from '../src/ux/events-client.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const page=read('../app/page.tsx'),b=read('../src/components/ProspectDetailB.tsx'),layout=read('../app/layout.tsx'),css=read('../app/globals.css'),signals=read('../src/components/SignalsPanel.tsx');
const count=(s:string,needle:string)=>s.split(needle).length-1;

test('the Preview flag is decided by the server per request, never in the static layout (tests/ux-runtime-flag.test.ts)',()=>{
 assert.match(layout,/return <html lang="fr"><body>/);
});
test('page — the variant is resolved once on the client from the flag, the user id and the tab override',()=>{
 assert.match(page,/resolveUxVariant\(\{enabled:uxEnabled,userId:mode==='live'\?identity\.current:null,forced:readForced\(window\.location\.search,tabStore\(\)\)\}\)/);
 assert.doesNotMatch(page,/localStorage\.setItem\([^)]*ux/i,'the assignment is never written to localStorage');
});
test('page — the api helper sends the label header only when there is one',()=>{
 assert.match(page,/const uxHeader=uxHeaderValue\(uxAssignment\);/);
 assert.match(page,/\.\.\.\(uxHeader\?\{\[UX_HEADER\]:uxHeader\}:\{\}\)/);
});
test('page — the view is tracked in live mode only, once per prospect and variant per page session',()=>{
 // only when the detail page is really shown: the prospects view, no quick start, a loaded prospect
 assert.match(page,/if\(mode!=='live'\|\|view!=='prospects'\|\|showQuickStart\|\|!current\|\|!uxHeader\|\|!markViewOnce\(viewedRef\.current,`\$\{current\.id\}:\$\{uxAssignment\.variant\}`\)\)return;/);
 assert.match(page,/api\('ux-events','POST',\{kind:'prospect_detail_viewed',prospect_id:current\.id\}\)\.catch\(\(\)=>\{\}\)/);
 const seen=new Set<string>();
 assert.equal(markViewOnce(seen,'p1:B'),true);assert.equal(markViewOnce(seen,'p1:B'),false,'a re-render does not track again');
 assert.equal(markViewOnce(seen,'p1:A'),true,'another variant is another view');assert.equal(markViewOnce(seen,'p2:B'),true);
});
test('page — one instance of each panel and of the message block (no duplicated logic)',()=>{
 for(const n of ['<ObservationsReview key=','<SignalsPanel key=','<PublicContentPanel key=','<StyleProfilePanel ','className="message-box"','onClick={generate}','onClick={saveDraft}','onClick={approveDraft}','onClick={copyApproved}',"onClick={()=>status('Contacté')}"])
  assert.equal(count(page,n),1,n);
});
test('page — B only adds the cockpit and groups the justifications; A renders exactly as before',()=>{
 assert.match(page,/<div className=\{uxAssignment\.variant==='B'\?'detail-layout ux-b':'detail-layout'\} data-ux-variant=\{uxAssignment\.variant\}>/);
 assert.match(page,/\{uxAssignment\.variant==='B'&&<><DecisionHero intent=\{detailIntent\} locale=\{locale\}\/><DecisionStack fit=\{fit!\} coverage=\{scored\.coverage\} intent=\{detailIntent\} locale=\{locale\}\/>/);
 assert.match(page,/timelineView\(\{now:new Date\(\),intent:detailIntent,criteria,evidence:current\.evidence,content:detailContent\}\)/);
 // the Next best action is the head of the ONE message block, B only
 assert.match(page,/<div className="message-box">\{uxAssignment\.variant==='B'&&<NextBestActionHead angle=\{draftAngle\} whyNowSentence=\{draftWhy\} hasDraft=\{!!draft\} draftStatus=\{draftStatus\} locale=\{locale\}\/>\}/);
 assert.match(page,/<UxJustifications variant=\{uxAssignment\.variant\} locale=\{locale\}>/);
 // the wrapped blocks keep their order and their own code
 const start=page.indexOf('<UxJustifications'),end=page.indexOf('</UxJustifications>');
 assert.ok(start>0&&end>start);
 const inside=page.slice(start,end);
 for(const n of ['className="prospect-synthesis"','<div className="icp-block">','<ObservationsReview key=','<SignalsPanel key=','<PublicContentPanel key='])assert.ok(inside.includes(n),n);
 assert.ok(!inside.includes('className="message-box"'),'the message block is not a justification');
 assert.ok(page.indexOf('className="message-box"')>end);
});
test('B component — presentation only: no fetch, mutation, score, angle selection, composer or lifecycle call',()=>{
 assert.doesNotMatch(b,/\bapi\(|fetch\(|scoreIntent\(|scoreProspect\(|selectAngle\(|compose|approveDraft|copyApproved|saveDraft|generate\(|status\(|Contacté|PATCH|POST/);
 assert.match(b,/import \{angleView,nextStep\} from '\.\.\/ux\/decision-view'/);
 assert.match(b,/import \{heroView,reasonView,type TimelineItem\} from '\.\.\/ux\/cockpit-view'/);
 assert.doesNotMatch(b,/opportunit|priority|priorit/i,'no invented score');
 assert.match(b,/if\(variant!=='B'\)return <>\{children\}<\/>;/,'in A the justifications wrapper renders its children as they are');
 assert.match(b,/<details className="ux-justifications"/);
});
test('B component — statuses are shown as they are (verified / to confirm / unknown) and the angle only after generation',()=>{
 for(const k of ['ux.status.verified','ux.status.to_confirm','ux.status.unknown','ux.hero.none','ux.angle.pending'])assert.ok(b.includes(`'${k}'`),k);
 assert.match(b,/tr\(`ux\.status\.\$\{i\.status\}` as TKey\)/,'timeline statuses come from the data');
 assert.match(b,/tr\(`outreach\.angle\.\$\{a\.type\}` as TKey\)/,'the existing labels of the server angle types');
});
test('i18n — every B key exists in French and English',async()=>{
 const keys=[...new Set([...b.matchAll(/'(ux\.[a-zA-Z.]+)'/g)].map(m=>m[1]))];
 assert.ok(keys.length>=10,String(keys.length));
 for(const lang of ['fr','en']){const dict=(await import(`../src/i18n/${lang}.ts`))[lang];for(const k of keys)assert.ok(dict[k],`${lang} ${k}`)}
});
test('Signals panel — only an optional callback is added: it reports the INTENT it already computes',()=>{
 assert.match(signals,/onIntentChange\?:\(intent:IntentScore\|null\)=>void/);
 assert.match(signals,/useEffect\(\(\)=>\{onIntentChange\?\.\(intent\)\},\[intent\]\);/);
 assert.match(page,/onBusyChange=\{setBusy\} onIntentChange=\{setDetailIntent\}\/>/);
});
test('CSS — B phone order: identity, why now, FIT/reason, next best action, timeline, then status, justifications; A untouched',()=>{
 for(const r of ['.detail-layout .message-box{order:8}','.detail-layout .observations-review{order:7}'])assert.ok(css.includes(r),r);
 const order=(sel:string)=>Number(new RegExp(`\\.detail-layout\\.ux-b \\${sel}\\{order:(\\d+)\\}`).exec(css)?.[1]);
 const seq=['.detail-head','.ux-hero','.ux-stack','.message-box','.ux-timeline','.decision','.ux-justifications'].map(order);
 assert.ok(seq.every(Number.isFinite),String(seq));
 assert.deepEqual([...seq].sort((a,b)=>a-b),seq,'the cockpit precedes the timeline, which precedes the justifications');
});
test('CSS — B wide: hero across, timeline left, decision column right (FIT/reason, then next best action, then status)',()=>{
 assert.match(css,/\.detail-layout\.ux-b\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(260px,330px\);grid-template-areas:"head head" "hero hero" "timeline stack" "timeline nba" "timeline side" "just just";/);
 assert.match(css,/\.detail-layout\.ux-b \.message-box\{grid-area:nba\}/);
});
test('CSS + page — on a phone, B puts the selected prospect cockpit before the list and its analytics ("Ce qui produit des réponses")',()=>{
 assert.match(css,/@media\(max-width:1023px\)\{\n \.prospect-grid\.ux-b>\.detail\{order:-1\}/);
 assert.match(page,/className=\{uxAssignment\.variant==='B'&&current\?'prospect-grid ux-b':'prospect-grid'\}/);
 assert.match(page,/<FeedbackPanel key=\{project\.id\}/,'the analytics stay where they are, after the cockpit on a phone');
 assert.match(page,/\{uxAssignment\.variant==='B'&&current&&origin!=='prospects'&&<button className="text-button ux-list-jump" onClick=\{backToList\}>/);
});
