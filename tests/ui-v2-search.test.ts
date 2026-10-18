// UI-5B Recherche 2.0 (docs/UI_V2.md): the v2 envelope of the "Recherche" entry around the existing DiscoveryPanel.
// Pins: the very same DiscoveryPanel element as the legacy screen (no second variant, no logic copied), the flag gating
// (flag OFF = the legacy Discovery screen, byte-identical), the scope (no Discovery engine, provider, scoring, quota, NBA,
// ZF, Stripe or pricing file changed) and the v2 look (scoped, tokens only, states never by colour alone). The search in
// a browser (320 / 390 / 1440 px, light / dark, run, add, ignore, history) is checked with Playwright on the
// /ui-v2/search bench (Preview).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';

const ROOT=new URL('..',import.meta.url);
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const page=read('../app/page.tsx'),ui=read('../src/ui/v2/search/SearchV2.tsx'),css=read('../src/ui/v2/search/search.css');
const BASE='836d8e9';
const legacy=page.slice(0,page.indexOf(' if(v2){')),v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));
const panelIn=(src:string)=>{const i=src.indexOf('<DiscoveryPanel ');assert.ok(i>=0);return src.slice(i,src.indexOf("}}/>",src.indexOf('onAdded=',i))+4)};

test('same DiscoveryPanel — the v2 screen mounts the legacy element byte for byte, once',()=>{
 assert.equal((legacy.match(/<DiscoveryPanel /g)??[]).length,1);
 assert.equal((v2.match(/<DiscoveryPanel /g)??[]).length,1);
 assert.equal(panelIn(v2),panelIn(legacy),'identical element and props');
 assert.match(v2,/:view==='discovery'&&project\?<v2\.SearchV2 locale=\{locale\} top=\{banners\} notice=\{notice\} onDismissNotice=\{\(\)=>setNotice\(''\)\} paywall=\{v2Paywall\}\n   panel=\{<DiscoveryPanel /);
 assert.match(read('../src/ui/v2/shell/AppShell.tsx'),/export \{SearchV2\} from '\.\.\/search\/SearchV2\.tsx';/,'loaded with the shell, behind the flag');
});
test('flag OFF — the legacy Discovery screen and the whole legacy return are byte-identical to main',()=>{
 const before=execSync(`git show ${BASE}:app/page.tsx`,{cwd:ROOT,encoding:'utf8'});
 const legacyBefore=before.slice(0,before.indexOf(' if(v2){'));
 assert.equal(legacy,legacyBefore,'everything before the v2 branch');
 const shell=(s:string)=>s.slice(s.indexOf(' return <div className="shell">'));
 assert.equal(shell(page),shell(before));
});
test('scope — DiscoveryPanel and the Discovery engine untouched; no DB, NBA, ZF, Stripe, pricing or public-site change',()=>{
 const changed=execSync(`git diff --name-only ${BASE}`,{cwd:ROOT,encoding:'utf8'}).split('\n').filter(Boolean);
 for(const f of changed)assert.doesNotMatch(f,/^db\/|^src\/(discovery|signal-discovery|nba|ux|server|domain|outreach|components)\/|stripe|pricing|^src\/ui\/v2\/(public|home|prospects|today)\/|^app\/(api|tarifs)/,f);
 assert.deepEqual(changed.filter(f=>!/^(app\/page\.tsx|app\/ui-v2\/search\/page\.tsx|docs\/UI_V2\.md|src\/ui\/v2\/search\/|src\/ui\/v2\/shell\/AppShell\.tsx|tests\/ui-v2-search\.test\.ts)/.test(f)),[],'only UI-5B files');
});
test('the screen — title, purpose, banners; no API call, no search started, no decision',()=>{
 assert.match(ui,/fr:\{title:'Recherche',intro:'Trouvez des entreprises qui correspondent à votre cible\. Chaque résultat reste à vérifier à la source avant de devenir un prospect\.'/);
 assert.match(ui,/<h2 className="pos-search__title">\{t\.title\}<\/h2>/);
 assert.match(ui,/<div className="pos-island pos-island--discovery">\{p\.panel\}<\/div>/);
 assert.doesNotMatch(ui,/fetch\(|api\(|discovery\/|onAdded|accept\(|ignore\(/,'the panel does the work, the envelope does none');
});
test('look — scoped, tokens only; the panel heading kept for assistive technology; states written, never colour alone',()=>{
 for(const rule of css.match(/^\.pos-ui[^{]*\{/gm)??[])assert.ok(rule.startsWith('.pos-ui .pos-search'),rule);
 assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g,''),/#[0-9a-f]{3,8}\b|rgb\(/i,'no raw colour');
 assert.match(css,/\.card\.discovery>\.eyebrow,\.pos-ui \.pos-search \.card\.discovery>h2\{position:absolute;width:1px;height:1px;[^}]*clip:rect\(0 0 0 0\)/,'visually hidden, not removed');
 assert.match(css,/\.pill\.result-state\.state-candidate\{background:var\(--pos-status-verify-bg\);color:var\(--pos-status-verify-fg\)\}/);
 assert.doesNotMatch(css,/action-contact/,'the CONTACT green is not used here');
 assert.match(css,/\.pos-ui \.pos-search \.pos-island button\{min-height:var\(--pos-size-target\)/,'44 px targets');
 assert.match(css,/@media \(forced-colors:active\)/);
});
test('bench — /ui-v2/search runs the real panel in demo mode only',()=>{
 const bench=read('../src/ui/v2/search/SearchBench.tsx');
 assert.match(bench,/<DiscoveryPanel projectId="bench"[^>]*mode="demo" api=\{api\}/);
 assert.match(bench,/const api=async\(\)=>\(\{\}\);/,'no network');
 assert.match(read('../app/ui-v2/layout.tsx'),/if\(!uiV2Enabled\(process\.env\)\)notFound\(\);/,'behind the same flag as /ui-v2');
});
