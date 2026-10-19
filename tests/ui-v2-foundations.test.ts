// UI-1 Fondations (docs/UI_V2.md): flag, theme without flash, tokens (completeness + WCAG AA, measured on the worst
// background), primitives' accessibility contracts, and flag-OFF parity (nothing outside /ui-v2 can see the v2 layer).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {uiV2Enabled} from '../src/ui/v2/flag.ts';
import {THEME_STORAGE_KEY,parseThemePreference,resolveTheme,themeAttributes,themeInitScript} from '../src/ui/v2/theme.ts';
import {THEMES,STATUS_TONES,palette,tokensCss,light,dark,type Theme} from '../src/ui/v2/tokens.ts';
import {alpha,composite,contrastRatio,parseColor} from '../src/ui/v2/color.ts';
import {ICONS,ICON_NAMES} from '../src/ui/v2/icons.ts';
import {STATUS_META,statusForSection,statusLabelV2} from '../src/ui/v2/status.ts';

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');

// ── Flag ──────────────────────────────────────────────────────────────────────────────────────────────────
test('flag — OFF by default, only "true"/"1", hard OFF whenever the platform says production',()=>{
 assert.equal(uiV2Enabled({}),false);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:''}),false);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:'yes'}),false);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:'0'}),false);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:'true'}),true);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:' TRUE '}),true);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:'1',VERCEL_ENV:'preview'}),true);
 assert.equal(uiV2Enabled({UI_V2_ENABLED:'1',VERCEL_ENV:'production'}),false,'never in Production, whatever the switch');
});

// ── Theme ─────────────────────────────────────────────────────────────────────────────────────────────────
test('theme — preference parsing and resolution (System is the default)',()=>{
 assert.equal(parseThemePreference('dark'),'dark');
 assert.equal(parseThemePreference('light'),'light');
 assert.equal(parseThemePreference('system'),'system');
 for(const v of [null,undefined,'','Dark','auto',1])assert.equal(parseThemePreference(v),'system');
 assert.equal(resolveTheme('system',true),'dark');
 assert.equal(resolveTheme('system',false),'light');
 assert.equal(resolveTheme('light',true),'light');
 assert.equal(resolveTheme('dark',false),'dark');
 assert.deepEqual(themeAttributes('system',true),{'data-theme':'dark','data-theme-pref':'system'});
});

// Runs the real inline script the way a browser does during parsing, against a fake parent element.
function runInitScript(opts:{stored?:string|null;storageThrows?:boolean;systemDark?:boolean;noMatchMedia?:boolean;noCurrentScript?:boolean}){
 const attrs:Record<string,string>={};
 const el={setAttribute:(k:string,v:string)=>{attrs[k]=v}};
 const window:Record<string,unknown>={
  localStorage:{getItem:(k:string)=>{if(opts.storageThrows)throw new Error('SecurityError');return k===THEME_STORAGE_KEY?opts.stored??null:null}},
 };
 if(!opts.noMatchMedia)window.matchMedia=(q:string)=>({matches:q==='(prefers-color-scheme: dark)'&&!!opts.systemDark});
 const document={currentScript:opts.noCurrentScript?null:{parentElement:el}};
 vm.runInNewContext(themeInitScript(),{window,document});
 return attrs;
}
test('no flash — the inline script resolves the theme before paint, and never throws',()=>{
 assert.deepEqual(runInitScript({stored:'dark'}),{'data-theme':'dark','data-theme-pref':'dark'});
 assert.deepEqual(runInitScript({stored:'light',systemDark:true}),{'data-theme':'light','data-theme-pref':'light'});
 assert.deepEqual(runInitScript({stored:'system',systemDark:true}),{'data-theme':'dark','data-theme-pref':'system'});
 assert.deepEqual(runInitScript({stored:null,systemDark:true}),{'data-theme':'dark','data-theme-pref':'system'},'new account → System');
 assert.deepEqual(runInitScript({stored:'garbage',systemDark:false}),{'data-theme':'light','data-theme-pref':'system'});
 assert.deepEqual(runInitScript({storageThrows:true,systemDark:true}),{'data-theme':'dark','data-theme-pref':'system'},'storage blocked');
 assert.deepEqual(runInitScript({stored:'system',noMatchMedia:true}),{'data-theme':'light','data-theme-pref':'system'});
 assert.deepEqual(runInitScript({stored:'dark',noCurrentScript:true}),{},'no parent → CSS default (follows the device)');
});
test('no flash — the script is ES5 and self-contained (runs before any bundle)',()=>{
 const s=themeInitScript();
 assert.doesNotMatch(s,/=>|\blet\b|\bconst\b|`|\?\?|\?\./);
 assert.doesNotMatch(s,/<\/script/i);
 assert.match(s,/document\.currentScript/);
});
test('no flash — provider renders the script first inside the .pos-ui root and never renders data-theme itself',()=>{
 const src=read('../src/ui/v2/ThemeProvider.tsx');
 assert.match(src,/className=\{className\?`pos-ui \$\{className\}`:'pos-ui'\} suppressHydrationWarning>\s*<script/);
 assert.match(src,/themeInitScript\(\)/);
 assert.match(src,/useLayoutEffect/,'re-applied before paint after soft navigations / dev remount');
 assert.doesNotMatch(src,/data-theme=\{/,'React never owns the attribute (no hydration mismatch)');
 assert.match(src,/useState<ThemePreference\|null>\(null\)/,'first client render = server render');
 assert.match(src,/addEventListener\('change'/,'System follows the device live');
 assert.match(src,/addEventListener\('storage'/,'other tabs stay in sync');
});

// ── Tokens ────────────────────────────────────────────────────────────────────────────────────────────────
test('tokens — light and dark define exactly the same roles; every status has fg/bg/dot',()=>{
 assert.deepEqual(Object.keys(dark.colors).sort(),Object.keys(light.colors).sort());
 assert.deepEqual(Object.keys(dark.effects).sort(),Object.keys(light.effects).sort());
 for(const t of [light,dark])for(const s of STATUS_TONES)for(const part of ['fg','bg','dot'])
  assert.ok((t.colors as Record<string,string>)[`status-${s}-${part}`],`${t.name}: status-${s}-${part}`);
});
test('tokens — every solid colour comes from the palette (no stray literal); alpha variants are derived',()=>{
 const hexes=new Set<string>();
 const walk=(o:unknown)=>{if(typeof o==='string')hexes.add(o.toUpperCase());else if(o&&typeof o==='object')Object.values(o).forEach(walk)};
 walk(palette);
 for(const t of [light,dark])for(const [k,v] of Object.entries(t.colors)){
  if(v==='transparent')continue;
  if(v.startsWith('#'))assert.ok(hexes.has(v.toUpperCase()),`${t.name}.${k}=${v} is not a palette colour`);
  else{const c=parseColor(v);assert.ok(c.a<1,`${t.name}.${k}: rgba only for translucent roles`)}
 }
 assert.equal(alpha('#4338CA',0.09),'rgba(67,56,202,0.09)');
});
test('tokens — CSS is scoped to .pos-ui; dark via attribute, System fallback via media query',()=>{
 const css=tokensCss();
 assert.match(css,/^\.pos-ui\{--pos-space-1:4px;/);
 assert.match(css,/\.pos-ui\[data-theme="dark"\]\{--pos-bg:#050914;/);
 assert.match(css,/@media \(prefers-color-scheme: dark\)\{\.pos-ui:not\(\[data-theme\]\)\{--pos-bg:#050914;/);
 assert.doesNotMatch(css,/:root|(^|\})\s*(html|body)\s*\{/,'never on :root/html/body directly');
 for(const line of css.split('\n'))assert.match(line,/^(\.pos-ui|@media \(prefers-color-scheme: dark\)\{\.pos-ui|html:has\(\.pos-ui)/);
 assert.match(css,/color-scheme:dark/);
 // UI-1 adjustment 1: light base lighter and cooler than the prototype (#E4E8F4), colour carried by the halos.
 const bg=parseColor(light.colors.bg);
 assert.ok(bg.r+bg.g+bg.b>0xE4+0xE8+0xF4,'lighter than the V2 prototype base');
 assert.ok(bg.b>=bg.r&&bg.b>=bg.g&&bg.r<bg.g,'cool (blue-leaning, not lavender)');
 assert.ok(light.haloTints.length>=3);
});

// WCAG AA (4.5:1 text, 3:1 UI), measured on the worst background: translucent surfaces are composited over the base
// colour AND over the strongest halo tint, as the browser would paint them.
function backgrounds(t:Theme){
 const base=parseColor(t.colors.bg);
 const under=[base,...t.haloTints.map(h=>composite(h,base))];
 const solids=[t.colors['surface-card'],t.colors['surface-inset'],t.colors['glass-solid']].map(c=>parseColor(c));
 const glassy=(['glass','surface-shell','surface-drawer','surface-sheet'] as const).flatMap(k=>under.map(u=>composite(t.colors[k],u)));
 return {page:under,all:[...under,...solids,...glassy],card:parseColor(t.colors['surface-card'])};
}
for(const t of Object.values(THEMES)){
 test(`contrast ${t.name} — body text ≥ 4.5:1 on every surface, glass included`,()=>{
  const {all}=backgrounds(t);
  for(const k of ['text-1','text-2','text-3'] as const)for(const bg of all){
   const r=contrastRatio(t.colors[k],bg);
   assert.ok(r>=4.5,`${t.name} ${k} on ${JSON.stringify(bg)} = ${r.toFixed(2)}`);
  }
 });
 test(`contrast ${t.name} — accent, signal and status labels ≥ 4.5:1; focus ring ≥ 3:1`,()=>{
  const {all,card}=backgrounds(t);
  assert.ok(contrastRatio(t.colors['on-accent'],t.colors.accent)>=4.5,'label on primary button');
  for(const bg of all){
   assert.ok(contrastRatio(t.colors.signal,bg)>=4.5,`${t.name} signal`);
   assert.ok(contrastRatio(t.colors.accent,bg)>=3,`${t.name} focus ring / accent as UI`);
  }
  assert.ok(contrastRatio(t.colors.accent,card)>=4.5,'accent as text on a card');
  assert.ok(contrastRatio(t.colors.ai,card)>=4.5,'AI accent as text on a card');
  for(const s of STATUS_TONES){
   const c=t.colors as Record<string,string>;
   const fill=composite(c[`status-${s}-bg`]==='transparent'?'rgba(0,0,0,0)':c[`status-${s}-bg`]!,card);
   const r=contrastRatio(c[`status-${s}-fg`]!,fill);
   assert.ok(r>=4.5,`${t.name} badge ${s}: ${r.toFixed(2)}`);
  }
  assert.ok(contrastRatio(t.colors['toast-fg'],t.colors['toast-bg'])>=4.5);
 });
}

// ── Primitive styles ──────────────────────────────────────────────────────────────────────────────────────
const CSS_FILES=['../src/ui/v2/foundations.css','../app/ui-v2/gallery.css'];
test('styles — no literal colour anywhere in v2 CSS or components (tokens only)',()=>{
 const colour=/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
 for(const f of CSS_FILES)assert.doesNotMatch(read(f),colour,f);
 for(const f of readdirSync(new URL('../src/ui/v2/',import.meta.url)).filter(n=>n.endsWith('.tsx')))
  assert.doesNotMatch(read(`../src/ui/v2/${f}`),colour,f);
});
test('styles — every rule is scoped to .pos-ui (the legacy UI cannot be affected)',()=>{
 for(const f of CSS_FILES){
  const css=read(f).replace(/\/\*[\s\S]*?\*\//g,'');
  const selectors=[...css.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)].map(m=>m[1]!.trim()).filter(s=>s&&!/^(from|to|\d+%)$/.test(s));
  // split on top-level commas only (`:where(h1,h2)` is one selector)
  for(const sel of selectors)for(const part of sel.split(/,(?![^(]*\))/))
   assert.match(part.trim(),/^(\.pos-ui|html:has\(\.pos-ui)/,`${f}: "${part.trim()}"`);
 }
});
test('styles — reduced motion, reduced transparency, no-backdrop-filter, more contrast and forced colours are handled',()=>{
 const css=read('../src/ui/v2/foundations.css').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{[^]*--pos-enter-y:0px/);
 assert.match(css,/@media \(prefers-reduced-transparency:reduce\)\{[^]*\.pos-glass\{background:var\(--pos-glass-solid\);-webkit-backdrop-filter:none;backdrop-filter:none\}/);
 assert.match(css,/@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{[^]*var\(--pos-glass-solid\)/);
 assert.match(css,/@media \(prefers-contrast:more\)/);
 assert.match(css,/@media \(forced-colors:active\)/);
 assert.match(css,/\.pos-ui :focus-visible:not\(\.pos-legacy \*\)\{outline:2px solid var\(--pos-accent\);outline-offset:2px\}/);
 assert.match(css,/min-height:var\(--pos-size-target\)/,'44 px targets');
 assert.doesNotMatch(css,/!important/);
 assert.doesNotMatch(css,/animation:[^;]*infinite[^;]*;[^}]*\}\s*\.pos-ui \.pos-canvas/,'halos are static');
});

// ── Icons and statuses ────────────────────────────────────────────────────────────────────────────────────
test('icons — one consistent set: non-empty path data on the 24 grid, every status icon exists',()=>{
 assert.ok(ICON_NAMES.length>=30);
 for(const n of ICON_NAMES){
  assert.ok(ICONS[n].length>0,n);
  for(const d of ICONS[n])assert.match(d,/^M[-\d.\s,MmLlHhVvCcSsQqTtAaZz]+$/,`${n}: ${d}`);
 }
 for(const s of Object.values(STATUS_META))assert.ok(ICON_NAMES.includes(s.icon));
});
test('statuses — WATCH never looks like CONTACT; a declaration is never a verification',()=>{
 assert.equal(statusForSection('contact'),'contact');
 assert.equal(statusForSection('verify'),'verify');
 assert.equal(statusForSection('engage'),'engage');
 assert.equal(statusForSection('watch'),'watch');
 const icons=new Set(Object.values(STATUS_META).map(m=>m.icon));
 assert.equal(icons.size,Object.keys(STATUS_META).length,'one icon per status');
 assert.equal(statusLabelV2('declared','fr'),'Déclaré par vous');
 assert.equal(statusLabelV2('verified','fr'),'Vérifié');
 for(const t of [light,dark]){
  assert.notEqual(t.colors['status-watch-fg'],t.colors['status-contact-fg']);
  assert.notEqual(t.colors['status-declared-fg'],t.colors['status-verified-fg']);
  assert.notEqual(t.colors['status-declared-bg'],t.colors['status-verified-bg']);
 }
 assert.match(read('../src/ui/v2/foundations.css'),/\.pos-badge--declared\{[^}]*border:1px dashed/);
 assert.equal(statusLabelV2('watch','en'),'Watching');
});

// ── Primitive contracts (source level: the test runner does not compile TSX) ─────────────────────────────
test('primitives — Button, Chip, ChipGroup, Icon accessibility contracts',()=>{
 const src=read('../src/ui/v2/primitives.tsx');
 assert.match(src,/type='button'/,'buttons never submit by accident');
 assert.match(src,/aria-busy=\{loading\|\|undefined\}/);
 assert.match(src,/disabled=\{disabled\|\|loading\}/);
 assert.match(src,/aria-pressed=\{pressed\}/);
 assert.match(src,/role="group" aria-label=\{label\}/);
 assert.match(src,/\{role:'img','aria-label':label\}:\{'aria-hidden':true\}/,'icons decorative unless labelled');
 for(const v of ['primary','secondary','quiet','danger'])assert.match(read('../src/ui/v2/foundations.css'),new RegExp(`\\.pos-btn--${v}\\{`));
});
test('primitives — Sheet is a modal dialog; ContextDrawer is non-modal; both close on Esc and return focus',()=>{
 const src=read('../src/ui/v2/panels.tsx');
 assert.match(src,/<dialog ref=\{ref\}/);
 assert.match(src,/d\.showModal\(\)/,'top layer + inert page + focus kept inside');
 assert.match(src,/onCancel=\{onCancel\}/);
 assert.match(src,/if\(e\.key!=='Tab'\)return;/,'Tab wraps inside the sheet');
 assert.match(src,/const onCancel=\(e:SyntheticEvent\)=>\{e\.preventDefault\(\);onClose\(\)\}/,'Esc goes through the owner');
 assert.match(src,/if\(el&&el\.isConnected\)el\.focus/,'focus returns to the opener');
 assert.match(src,/aria-labelledby=\{titleId\}/);
 assert.match(src,/role="dialog" aria-modal="false"/);
 assert.match(src,/e\.key==='Escape'/);
 assert.match(src,/heading\.current\?\.focus/,'focus moves into the drawer on open');
 assert.match(src,/reducedMotion\(\)/,'no closing animation under reduced motion');
 assert.match(src,/aria-label=\{CLOSE_LABEL\[locale\]\.(sheet|drawer)\}/);
});

// ── Flag-OFF parity ───────────────────────────────────────────────────────────────────────────────────────
test('flag OFF parity — the existing app does not load, import or reference the v2 layer',()=>{
 const layout=read('../app/layout.tsx');
 assert.doesNotMatch(layout,/ui\/v2|pos-ui|data-theme|pos-theme|foundations\.css/);
 assert.doesNotMatch(read('../app/globals.css'),/--pos-|\.pos-ui|pos-theme/);
 assert.doesNotMatch(read('../src/components/TodayPanel.tsx'),/ui\/v2|UI_V2/);
 // UI-2: the page only knows the pure navigation model statically; the shell (and its CSS) is a dynamic import made
 // after the server said UI_V2_ENABLED is on (tests/ui-v2-shell.test.ts). WEB-2: the build-time public-site flag (a boolean,
 // no UI, no CSS) is the only other static import; the homepage itself is a next/dynamic import (tests/web-v2-home.test.ts).
 const page=read('../app/page.tsx');
 assert.doesNotMatch(page,/^import[^;]*ui\/v2\/(?!shell\/nav\.ts|public\/flag\.ts)/m);
 assert.doesNotMatch(page,/\.css'/);
 assert.doesNotMatch(read('../app/sitemap.ts'),/ui-v2/);
});
test('flag OFF parity — /ui-v2 is decided per request and 404s unless UI_V2_ENABLED AND UI_V2_BENCH_ENABLED; never indexed',()=>{
 const src=read('../app/ui-v2/layout.tsx');
 assert.match(src,/await connection\(\);\s*if\(!uiV2BenchEnabled\(process\.env\)\)notFound\(\);/);
 assert.match(src,/return uiV2BenchEnabled\(process\.env\)\?\{title:'Fondations UI v2 \(Preview\)',robots:\{index:false,follow:false\}\}:\{\};/,
  'flag OFF: not even the title reveals the page');
 assert.doesNotMatch(src,/export const metadata/);
 assert.ok(src.indexOf('notFound()')<src.indexOf('tokensCss()'),'nothing is rendered before the flag check');
});
test('UI-5C — the benches are never served in Production: their own opt-in on top of the shell flag',async()=>{
 const {uiV2BenchEnabled}=await import('../src/ui/v2/flag.ts');
 assert.equal(uiV2BenchEnabled({UI_V2_ENABLED:'1'}),false,'the Production shell flag alone does not open the benches');
 assert.equal(uiV2BenchEnabled({UI_V2_BENCH_ENABLED:'1'}),false,'nor the bench flag without the shell');
 assert.equal(uiV2BenchEnabled({UI_V2_ENABLED:'1',UI_V2_BENCH_ENABLED:'yes'}),false);
 assert.equal(uiV2BenchEnabled({UI_V2_ENABLED:'1',UI_V2_BENCH_ENABLED:'1'}),true);
 assert.equal(uiV2BenchEnabled({UI_V2_ENABLED:'true',UI_V2_BENCH_ENABLED:' TRUE '}),true);
 assert.equal(uiV2BenchEnabled({UI_V2_ENABLED:'1',UI_V2_BENCH_ENABLED:'1',VERCEL_ENV:'production'}),false);
 // The shell itself is unchanged: the public flag still answers for UI_V2_ENABLED alone.
 assert.match(read('../app/api/public/ui-v2/route.ts'),/enabled:uiV2Enabled\(process\.env\)/);
});
