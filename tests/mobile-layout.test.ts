import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
// Static guards against horizontal overflow on the prospect sheet's commercial actions/message
// blocks (BLOC 3, iPhone priority). Not a substitute for a real viewport check, but it keeps the
// rules that make mobile safe from silently regressing.
test('form controls never exceed their container width',()=>assert.match(css,/input,textarea,select\{[^}]*max-width:100%/));
test('top-level actions wrap instead of forcing horizontal scroll',()=>assert.match(css,/\.actions\{[^}]*flex-wrap:wrap/));
test('the commercial decision row wraps on narrow viewports',()=>assert.match(css,/max-width:700px\)\{[^]*?\.decision\{flex-wrap:wrap\}/));
test('the pipeline view no longer hardcodes a fixed column count that could overflow as statuses are added',()=>{assert.match(css,/\.pipeline\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(/);assert.doesNotMatch(css,/\.pipeline\{grid-template-columns:repeat\(\d/)});
