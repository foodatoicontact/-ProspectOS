// UI-2 App Shell (docs/UI_V2.md): navigation model, per-request flag, flag-OFF parity of app/page.tsx, shell
// accessibility contracts and styles. Browser behaviour (mobile/desktop navigation, menus, theme persistence, 320 px)
// is verified with Playwright against a local build; this file pins what can regress silently at source level.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {viewForNav,navForView,landingView,viewTitle,NAV_LABEL,NAV_ORDER,PRIMARY_NAV,SECONDARY_NAV,type NavCaps,type NavKey} from '../src/ui/v2/shell/nav.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const DEMO:NavCaps={live:false,today:false,actions:false};
const LIVE:NavCaps={live:true,today:false,actions:false};
const LIVE_NBA:NavCaps={live:true,today:false,actions:true};
const LIVE_ZF:NavCaps={live:true,today:true,actions:true};

// ── Navigation model ──────────────────────────────────────────────────────────────────────────────────
test('nav — 4 primary entries (mobile and desktop) + Sources / Paramètres (desktop secondary)',()=>{
 assert.deepEqual([...PRIMARY_NAV],['today','prospects','search','activity']);
 assert.deepEqual([...SECONDARY_NAV],['sources','settings']);
 assert.deepEqual(Object.values(NAV_LABEL.fr),['Aujourd’hui','Prospects','Recherche','Activité','Sources','Paramètres']);
 assert.deepEqual(Object.keys(NAV_LABEL.en).sort(),Object.keys(NAV_LABEL.fr).sort());
});
test('nav — every entry leads to an EXISTING screen, closest one when the exact screen does not exist',()=>{
 assert.equal(viewForNav('today',LIVE_ZF),'today','ZF1 Aujourd’hui');
 assert.equal(viewForNav('today',LIVE_NBA),'actions','without ZF1: À faire (NBA)');
 assert.equal(viewForNav('today',LIVE),'prospects');
 assert.equal(viewForNav('today',DEMO),'prospects','demo: no Today screen exists');
 for(const c of [DEMO,LIVE,LIVE_NBA,LIVE_ZF]){
  assert.equal(viewForNav('prospects',c),'prospects');
  assert.equal(viewForNav('search',c),'discovery');
  assert.equal(viewForNav('sources',c),'discovery');
  assert.equal(viewForNav('settings',c),'icp');
 }
 assert.equal(viewForNav('activity',LIVE_ZF),'actions','advanced mode once Today exists');
 assert.equal(viewForNav('activity',LIVE_NBA),'dashboard','À faire is already Today there');
 assert.equal(viewForNav('activity',DEMO),'dashboard');
 const existing=new Set(['today','prospects','discovery','actions','dashboard','icp','beta-analytics']);
 for(const c of [DEMO,LIVE,LIVE_NBA,LIVE_ZF])for(const k of NAV_ORDER)assert.ok(existing.has(viewForNav(k,c)));
});
test('nav — exactly one current entry; the chosen one wins between entries sharing a screen; none for Bêta Analytics',()=>{
 assert.equal(navForView('discovery',LIVE_ZF,null),'search');
 assert.equal(navForView('discovery',LIVE_ZF,'sources'),'sources');
 assert.equal(navForView('discovery',LIVE_ZF,'today'),'search','a stale choice never points elsewhere');
 assert.equal(navForView('prospects',DEMO,null),'today','demo lands on its closest Today screen');
 assert.equal(navForView('prospects',DEMO,'prospects'),'prospects');
 assert.equal(navForView('beta-analytics',LIVE_ZF,null),null);
 assert.equal(navForView('today',LIVE_ZF,'prospects'),'today');
});
test('nav — a v2 session opens on Aujourd’hui (or its closest screen); screens have a plain accessible title',()=>{
 assert.equal(landingView(LIVE_ZF),'today');
 assert.equal(landingView(LIVE_NBA),'actions');
 assert.equal(landingView(DEMO),'prospects');
 assert.equal(viewTitle('discovery','fr'),'Recherche');
 assert.equal(viewTitle('dashboard','en'),'Activity');
 for(const k of NAV_ORDER as readonly NavKey[])assert.ok(viewTitle(viewForNav(k,LIVE_ZF),'fr').length>0);
});

// ── Flag (per request, never in a static file) ────────────────────────────────────────────────────────
test('flag — /api/public/ui-v2 is dynamic, never cached, answers only a boolean',async()=>{
 const src=read('../app/api/public/ui-v2/route.ts');
 assert.match(src,/export const dynamic='force-dynamic';/);
 assert.match(src,/'cache-control':'no-store'/);
 assert.match(src,/uiV2Enabled\(process\.env\)/);
 const {GET}=await import('../app/api/public/ui-v2/route.ts');
 const saved={...process.env};
 try{
  delete process.env.UI_V2_ENABLED;assert.deepEqual(await (await GET()).json(),{enabled:false});
  process.env.UI_V2_ENABLED='1';assert.deepEqual(await (await GET()).json(),{enabled:true});
  process.env.VERCEL_ENV='production';assert.deepEqual(await (await GET()).json(),{enabled:false});
 }finally{process.env=saved}
});
test('flag — the root layout stays static and flag-free',()=>{
 const layout=read('../app/layout.tsx');
 assert.doesNotMatch(layout,/UI_V2|ui\/v2|pos-ui|uiV2/);
});

// ── app/page.tsx: flag OFF parity ─────────────────────────────────────────────────────────────────────
const page=read('../app/page.tsx');
test('flag OFF — the shell code and its CSS are loaded only after the server said yes',()=>{
 assert.match(page,/fetch\('\/api\/public\/ui-v2',\{cache:'no-store'\}\)\.then\(r=>r\.ok\?r\.json\(\):null\)\.then\(c=>c\?\.enabled===true\?import\('\.\.\/src\/ui\/v2\/shell\/AppShell\.tsx'\):null\)/);
 assert.doesNotMatch(page,/^import[^;]*AppShell/m,'never a static import');
 assert.doesNotMatch(page,/^import[^;]*\.css'/m);
 assert.match(page,/useState<V2Module\|null>\(null\)/,'OFF until the answer arrives');
});
test('flag OFF — the legacy return is the same markup: sidebar, topbar, page heading with its global buttons',()=>{
 const legacy=page.slice(page.indexOf(' return <div className="shell">'));
 assert.match(legacy,/^ return <div className="shell">\{uxDebug\}<aside className="sidebar"><div className="brand">/);
 assert.match(legacy,/<\/header><div className=\{contentClass\}>\{banners\}<div className="page-heading">/);
 assert.match(legacy,/<button onClick=\{download\}>\{tr\('actions\.exportCsv'\)\}<\/button>/);
 assert.match(legacy,/\{workspace\}<\/div><\/main>\{overlays\}<\/div>\n\}\n$/);
 assert.match(page,/const contentClass=uxAssignment\.variant==='B'&&view==='prospects'&&current\?'content ux-b-page':'content';/);
 assert.match(page,/const uxDebug=<>\{uxEnabled&&<p className="ux-debug"/);
});
test('flag ON — same screens, banners and dialogs; no sidebar, topbar, marketing title or global buttons',()=>{
 const v2=page.slice(page.indexOf(' if(v2){'),page.indexOf(' return <div className="shell">'));
 assert.ok(v2.length>0);
 assert.doesNotMatch(v2,/sidebar|topbar|page-heading|page\.eyebrow|page\.title|nav\.liveTopbar|nav\.demoTopbar|humanTitle/);
 assert.match(v2,/<div className=\{contentClass\}>\{banners\}\{workspace\}<\/div><\/Shell>\{overlays\}/);
 assert.match(v2,/internal:entitlementPlan==='INTERNAL'/);
 assert.match(v2,/onSignOut:\(\)=>work\(logout\)/);
 assert.match(v2,/onSelect:selectProject/);
 assert.match(v2,/actions=\{navNow==='prospects'&&!showQuickStart\?/,'export / add live in Prospects, not in the envelope');
});
test('flag ON — Recherche keeps the Discovery history behaviour; nothing in the business screens changes',()=>{
 assert.match(page,/if\(target==='discovery'\)\{if\(projectId\)openDiscovery\(\);/);
 for(const f of ['../src/components/TodayPanel.tsx','../src/components/ActionsPanel.tsx','../src/components/DiscoveryPanel.tsx','../src/components/ProspectDetailB.tsx'])
  assert.doesNotMatch(read(f),/ui\/v2|pos-/,f);
});

// ── Shell components ──────────────────────────────────────────────────────────────────────────────────
const shell=read('../src/ui/v2/shell/AppShell.tsx');
test('shell — current entry is aria-current="page"; navigations are labelled landmarks; skip link',()=>{
 assert.match(shell,/aria-current=\{on\?'page':undefined\}/);
 assert.match(shell,/<nav className="pos-bottomnav pos-glass" aria-label=\{SHELL_TEXT\[locale\]\.primary\}>/);
 assert.match(shell,/<nav className="pos-sidenav__nav" aria-label=\{t\.primary\}>/);
 assert.match(shell,/<nav className="pos-sidenav__nav" aria-label=\{t\.secondary\}>/);
 assert.match(shell,/<a className="pos-skip" href="#pos-main">/);
 assert.match(shell,/<h1 className="pos-visually-hidden">\{title\}<\/h1>/);
});
test('shell — menus: Sheet on mobile, Popover on desktop; triggers announce their dialog and state',()=>{
 assert.match(shell,/<Sheet open=\{projectOpen&&!desktop\}/);
 assert.match(shell,/<Sheet open=\{menuOpen&&!desktop\}/);
 assert.match(shell,/<Popover open=\{projectOpen\}/);
 assert.match(shell,/<Popover open=\{menuOpen\}/);
 assert.equal((shell.match(/aria-haspopup="dialog" aria-expanded=/g)??[]).length,3);
 assert.match(shell,/<ThemeProvider className="pos-app">/,'UI-1 theme, not a second system');
 assert.match(shell,/import \{ThemeProvider\} from '\.\.\/ThemeProvider\.tsx';/);
 const pop=read('../src/ui/v2/shell/Popover.tsx');
 assert.match(pop,/e\.key==='Escape'/);
 assert.match(pop,/addEventListener\('pointerdown',outside\)/);
 assert.match(pop,/trigger\.focus\(\{preventScroll:true\}\)/);
});
test('user menu — every required entry; Bêta Analytics only for INTERNAL; theme switcher reused',()=>{
 const m=read('../src/ui/v2/shell/UserMenu.tsx');
 for(const k of ['account','team','offer','sources','privacy','language','theme','signOut'])assert.match(m,new RegExp(`t\\.${k}`),k);
 assert.match(m,/\{live&&p\.internal&&<Item icon="activity" label=\{t\.beta\}/);
 assert.match(m,/<ThemeSwitcher locale=\{p\.locale\}\/>/);
 assert.match(m,/const act=\(fn:\(\)=>void\)=>\(\)=>\{p\.onDone\(\);fn\(\)\}/,'the menu closes before acting');
});
test('project switcher — same projects and "new project" as the legacy select; current marked',()=>{
 const s=read('../src/ui/v2/shell/ProjectSwitcher.tsx');
 assert.match(s,/aria-current=\{p\.id===currentId\?'true':undefined\}/);
 assert.match(s,/disabled=\{busy\}/);
 assert.match(s,/onClick=\{\(\)=>\{onDone\(\);onNew\(\)\}\}/);
});

// ── Styles ────────────────────────────────────────────────────────────────────────────────────────────
const css=read('../src/ui/v2/shell/shell.css');
test('styles — tokens only, scoped to .pos-ui, safe areas, 3 layouts, 44 px targets',()=>{
 const body=css.replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(body,/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
 const selectors=[...body.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)].map(m=>m[1]!.trim()).filter(s=>s&&!/^(from|to|\d+%)$/.test(s));
 for(const sel of selectors)for(const part of sel.split(/,(?![^(]*\))/))assert.match(part.trim(),/^\.pos-ui/,part);
 assert.match(body,/env\(safe-area-inset-top,0px\)/);
 assert.match(body,/env\(safe-area-inset-bottom,0px\)/);
 assert.match(body,/@media \(min-width:1024px\)/);
 assert.match(body,/@media \(min-width:641px\) and \(max-width:1023px\)/);
 assert.match(body,/min-height:var\(--pos-size-target\)/);
 assert.match(body,/z-index:var\(--pos-z-shell\)/);
 assert.match(body,/@media \(forced-colors:active\)/);
 assert.doesNotMatch(body,/!important/);
});
test('styles — existing screens keep their own look inside the v2 shell (no v2 base rule reaches them)',()=>{
 assert.match(css,/\.pos-ui \.pos-legacy\{color:var\(--ink\);background:var\(--paper\);/);
 const f=read('../src/ui/v2/foundations.css');
 assert.match(f,/\.pos-ui :where\(h1,h2,h3,h4\):not\(\.pos-legacy \*\)\{/);
 assert.match(f,/\.pos-ui :where\(p\):not\(\.pos-legacy \*\)\{/);
 assert.match(f,/\.pos-ui :focus-visible:not\(\.pos-legacy \*\)\{/);
 for(const n of readdirSync(new URL('../src/ui/v2/shell/',import.meta.url)).filter(n=>n.endsWith('.tsx')))
  assert.doesNotMatch(read(`../src/ui/v2/shell/${n}`),/#[0-9a-f]{3,8}\b|rgba?\(/i,n);
});
