// "Tous les statuts (hors ignorés)": an ignored prospect leaves the working list, never the project (memory, history,
// Discovery novelty). Choosing the "Ignoré" status shows it again. Display only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workingList,IGNORED_STATUS} from '../src/ui/v2/prospects/model.ts';
import {STATUSES} from '../src/domain/core.ts';

const list=[{id:'a',status:'À analyser'},{id:'b',status:'Ignoré'},{id:'c',status:'Qualifié'},{id:'d',status:'Ignoré'}];

test('the default list hides ignored prospects and says how many', () => {
 const w=workingList(list,'Tous');
 assert.deepEqual(w.shown.map(p=>p.id),['a','c']);
 assert.equal(w.hiddenIgnored,2);
});
test('a chosen status is left as the page filtered it ("Ignoré" included): nothing more is hidden', () => {
 const ignoredOnly=list.filter(p=>p.status===IGNORED_STATUS);
 assert.deepEqual(workingList(ignoredOnly,IGNORED_STATUS).shown.map(p=>p.id),['b','d']);
 assert.equal(workingList(ignoredOnly,IGNORED_STATUS).hiddenIgnored,0);
});
test('the status is the one the domain defines, and nothing is removed from the input', () => {
 assert.ok((STATUSES as readonly string[]).includes(IGNORED_STATUS));
 workingList(list,'Tous');assert.equal(list.length,4);
});
test('wiring: the list reads workingList, offers to show the ignored ones, and is never "no match" because of them', () => {
 const v2=readFileSync(new URL('../src/ui/v2/prospects/ProspectsV2.tsx',import.meta.url),'utf8');
 assert.match(v2,/const working=workingList\(p\.visible,p\.filter\);/);
 assert.match(v2,/const rows=prospectRows\(working\.shown,/);
 assert.match(v2,/onClick=\{\(\)=>p\.onFilter\(IGNORED_STATUS\)\}/);
 assert.match(v2,/const filtered=p\.total>0&&!rows\.length&&!working\.hiddenIgnored;/);
});
