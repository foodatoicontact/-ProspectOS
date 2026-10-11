// UX A/B — the runtime flag arrives AFTER the first render (fetch /api/public/ux-config). Sequence of the page's two effects:
// first render → A/default; flag resolves → the resolution effect runs again (uxEnabled is one of its dependencies) and
// applies the tab override. Also the temporary Preview diagnostic "UX: B | enabled:true | assignment:forced", shown only
// when the experiment runs (never in Production), with no business content.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ux from '../src/ux/variant.ts';

function tab(initial:Record<string,string>={}){const m=new Map(Object.entries(initial));return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)}}}
// Replays the page: render 1 (flag unknown → false), then the flag arrives (true) and the effect runs again.
function replay(search:string,store:ReturnType<typeof tab>,flag:boolean,userId:string|null){
 const first=ux.resolveUxVariant({enabled:false,userId,forced:ux.readForced(search,store)});
 const after=ux.resolveUxVariant({enabled:flag,userId,forced:ux.readForced(search,store)});
 return {first,after};
}
test('async flag — ?ux=B: A while the flag is pending, B once it arrives',()=>{
 const r=replay('?ux=B',tab(),true,'u1');
 assert.deepEqual(r.first,{variant:'A',assignment:'default'});
 assert.deepEqual(r.after,{variant:'B',assignment:'forced'});
});
test('async flag — ?ux=A resolves A (forced), even for a user hashed to B',()=>{
 let id='';for(let i=0;!id;i++){const c=`user-${i}`;if(ux.hashedVariant(c)==='B')id=c}
 assert.deepEqual(replay('?ux=A',tab(),true,id).after,{variant:'A',assignment:'forced'});
});
test('async flag — a stale tab override never beats the URL; the URL replaces it',()=>{
 const store=tab({[ux.UX_FORCED_SESSION_KEY]:'A'});
 assert.deepEqual(replay('?ux=B',store,true,'u1').after,{variant:'B',assignment:'forced'});
 assert.deepEqual(replay('',store,true,'u1').after,{variant:'B',assignment:'forced'},'kept for the tab after an in-app navigation');
});
test('async flag — flag never arrives (Production / fetch failure): A, ?ux=B ignored',()=>{
 assert.deepEqual(replay('?ux=B',tab(),false,'u1').after,{variant:'A',assignment:'default'});
});
test('page — the resolution effect depends on the flag, so its late arrival re-resolves the variant',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/useEffect\(\(\)=>\{setUxAssignment\(resolveUxVariant\(\{enabled:uxEnabled,[^}]*\}\)\)\},\[mode,token,uxEnabled\]\);/);
});

test('diagnostic label — exact text, only when the experiment runs',()=>{
 assert.equal(ux.uxDiagnosticLabel(true,{variant:'B',assignment:'forced'}),'UX: B | enabled:true | assignment:forced');
 assert.equal(ux.uxDiagnosticLabel(true,{variant:'A',assignment:'hashed'}),'UX: A | enabled:true | assignment:hashed');
 assert.equal(ux.uxDiagnosticLabel(false,{variant:'A',assignment:'default'}),null,'never shown when disabled (Production)');
});
test('diagnostic badge — rendered by the page only when enabled, with the resolved variant on the detail layout',()=>{
 const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/\{uxEnabled&&<p className="ux-debug" role="status" data-testid="ux-debug">\{uxDiagnosticLabel\(uxEnabled,uxAssignment\)\}<\/p>\}/);
 assert.match(page,/data-ux-variant=\{uxAssignment\.variant\}/);
 assert.match(readFileSync(new URL('../app/globals.css',import.meta.url),'utf8'),/\.ux-debug\{position:fixed;/);
});
