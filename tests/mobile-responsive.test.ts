import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

// ============================================================
// MOBILE RESPONSIVE HOTFIX — structural guards. This repository has no browser/visual test harness
// (no Playwright/jsdom dependency), so the real-rendering checks (390px iPhone viewport + a 320→1500px
// sweep: no horizontal overflow, criterion names fully visible) were run manually against `next dev`;
// these tests pin the markup/CSS those checks depend on so the layout cannot silently regress.
// ============================================================
const page = () => readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const css = () => readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const block = (source: string, opener: string) => { const start = source.lastIndexOf(opener); assert.ok(start >= 0, `missing block: ${opener}`); let depth = 0; for (let i = source.indexOf('{', start); i < source.length; i++) { if (source[i] === '{') depth++; if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1); } throw Error('unbalanced block'); };

test('root cause guard: the criterion name is no longer an input caught by `.weight input{width:67px}`', async () => {
 const source = await page();
 assert.match(source, /<textarea className="weight-name" rows=\{1\}/, 'the name is its own field, never sized by the weight-input rule');
 assert.doesNotMatch(source, /<div className="weight[^"]*"><input aria-label=\{`\$\{tr\('common\.name'\)\}/, 'the old 67px name input is gone');
 const styles = await css();
 assert.match(styles, /\.weight-name\{flex:1 1 auto;min-width:0;width:auto;/, 'the name takes the remaining width and may shrink inside flex');
});
test('the name stays a single-line value: Enter is blocked and pasted newlines become spaces (ICP model unchanged)', async () => {
 const source = await page();
 assert.match(source, /onKeyDown=\{e=>\{if\(e\.key==='Enter'\)e\.preventDefault\(\)\}\}/);
 assert.match(source, /updateCriterion\(i,\{label:e\.target\.value\.replace\(\/\[\\r\\n\]\+\/g,' '\)\}\)/);
 assert.match(source, /maxLength=\{120\}/, 'same 120-character limit as before');
 assert.match(source, /function autoGrow\(el:HTMLTextAreaElement\|null\)/, 'the field grows to show the whole name');
});
test('the weight keeps its behavior and gains a localized "Poids"/"Weight" caption', async () => {
 const source = await page();
 assert.match(source, /<label className="weight-value"><span className="weight-caption">\{tr\('icp\.weightLabel'\)\}<\/span><input aria-label=\{`\$\{tr\('icp\.weightLabel'\)\} \$\{c\.label\}`\} type="number" inputMode="numeric" min="1" max="100"/);
 assert.equal(fr['icp.weightLabel'], 'Poids');
 assert.equal(en['icp.weightLabel'], 'Weight');
});
test('"Supprimer" stays a secondary text button, never the primary CTA', async () => {
 const source = await page();
 assert.match(source, /<button type="button" className="text-button" disabled=\{weights\.length<=1\|\|busy\} onClick=\{\(\)=>removeCriterion\(i\)\}>\{tr\('icp\.remove'\)\}<\/button>/);
});
test('narrow ICP card (container query) and phones (≤640px fallback) both stack the row: full-width name, 44px remove target', async () => {
 const styles = await css();
 assert.match(styles, /\.icp-grid>section\{container-type:inline-size\}/);
 for (const opener of ['@container (max-width:400px)', '@media(max-width:640px)']) {
  const rules = block(styles, opener);
  assert.match(rules, /\.weight-editor\{flex-wrap:wrap;/, opener);
  assert.match(rules, /\.weight-name\{flex:1 1 100%\}/, opener);
  assert.match(rules, /\.weight-caption\{display:inline;/, opener);
  assert.match(rules, /\.weight-editor>\.text-button\{margin-left:auto;min-height:44px;/, opener);
  assert.match(rules, /\.rule-editor label,\.rule-editor p\{overflow-wrap:anywhere\}/, opener);
 }
});
test('iOS Safari: fields are 16px on phones (no focus zoom), text is never inflated, modals fit the dynamic viewport', async () => {
 const styles = await css();
 assert.match(block(styles, '@media(max-width:640px)'), /input,textarea,select\{font-size:16px!important\}/);
 assert.match(styles, /html\{-webkit-text-size-adjust:100%;text-size-adjust:100%\}/);
 assert.match(styles, /\.modal\{max-height:90dvh\}/);
});
test('Discovery cards on phones: primary CTA full width, secondary action below, 44px targets', async () => {
 const rules = block(await css(), '@media(max-width:640px)');
 assert.match(rules, /\.discovery-result \.actions\{flex-direction:column;align-items:stretch\}/);
 assert.match(rules, /\.discovery-result \.actions button\{width:100%;min-height:44px;/);
});
test('hotfix scope: no palette change, no new dependency, no scoring/ICP-model/DB change', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const diff = execSync('git diff 062f0b9a87629c96ccb48abb193efd04e62d9b17 -- app/globals.css', {cwd, encoding: 'utf8'});
 assert.doesNotMatch(diff.split('\n').filter(l => l.startsWith('+')).join('\n'), /--(ink|green|muted|line|paper|lime)\s*:|#[0-9a-f]{3,8}\b/i, 'no color is introduced or changed');
 const untouched = execSync('git diff --name-only 062f0b9a87629c96ccb48abb193efd04e62d9b17 -- package.json package-lock.json src/domain db/migrations src/discovery', {cwd, encoding: 'utf8'});
 assert.equal(untouched.trim(), '');
});
