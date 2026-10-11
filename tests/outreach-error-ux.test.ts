// Outreach errors are shown where the user acts: inside « Une approche personnalisée », right above Save / Approve /
// Copy, with role="alert" — so a refusal (e.g. migration 029: a cited source is no longer verified) stays visible on a
// phone without scrolling back to the general banner at the top of the page. A successful (re)generation or outreach
// action clears it; errors that are not about the message (an expired session) keep the general banner. The module is
// imported lazily so each case fails on its own (RED) while it does not exist yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async(path:string)=>{try{return await import(path)}catch{return null}};
const src=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const REFUSAL='Une source utilisée par ce message n’est plus vérifiée. Régénérez le message avant de l’approuver ou de le copier.';
const line=(page:string,name:string)=>{const i=page.indexOf(`async function ${name}(`);assert.ok(i>0,`${name} exists`);return page.slice(i,page.indexOf('\n',i))};

test('A — runOutreachAction: an error goes to the message block (not thrown), a success clears it, a general error is rethrown untouched',async()=>{
 const m=await load('../src/components/outreach-action.ts');assert.ok(m?.runOutreachAction,'runOutreachAction is exported');
 const shown:string[]=[];const set=(s:string)=>{shown.push(s)};const general=(e:unknown)=>e instanceof Error&&e.message==='SESSION';
 await m.runOutreachAction(async()=>{throw Error(REFUSAL)},set,general,'Erreur');
 assert.deepEqual(shown,[REFUSAL],'the refusal is shown in the block, nothing is thrown to the general banner');
 await m.runOutreachAction(async()=>{},set,general,'Erreur');
 assert.equal(shown.at(-1),'','a successful action clears the message');
 await m.runOutreachAction(async()=>{throw 'not an Error'},set,general,'Erreur générique');
 assert.equal(shown.at(-1),'Erreur générique','an unknown failure still says something');
 const n=shown.length;
 await assert.rejects(m.runOutreachAction(async()=>{throw Error('SESSION')},set,general,'Erreur'),/SESSION/);
 assert.equal(shown.length,n,'a general error (expired session) is left to the general banner');
});

test('B — page: Save, Approve and Copy run through the outreach wrapper; the general banner path (work) is unchanged',async()=>{
 const page=await src('../app/page.tsx');
 for(const name of ['saveDraft','approveDraft','copyApproved'])assert.match(line(page,name),/await outreachWork\(async\(\)=>\{/,name);
 assert.match(page,/const outreachWork=\(action:\(\)=>Promise<void>\)=>work\(\(\)=>runOutreachAction\(action,setDraftError,/);
 assert.match(page,/e\.message===tr\('error\.sessionExpired'\)/,'an expired session still reaches the general banner');
 assert.match(page,/async function work\(action:\(\)=>Promise<void>\)\{setBusy\(true\);setNotice\(''\);try\{await action\(\)\}catch\(e\)\{setNotice\(e instanceof Error\?e\.message:tr\('error\.generic'\)\)\}finally\{setBusy\(false\)\}\}/,
  'every other action keeps the general banner exactly as before');
 assert.match(line(page,'generate'),/await work\(async\(\)=>\{/,'generation errors keep the general banner');
});

test('C — the error is rendered inside « Une approche personnalisée », immediately above the actions, with role="alert"',async()=>{
 const page=await src('../app/page.tsx');
 const start=page.indexOf('className="message-box"');assert.ok(start>0);
 const box=page.slice(start,page.indexOf('<StyleProfilePanel',start));
 assert.ok(box.includes("tr('outreach.title')"),'this is the « Une approche personnalisée » block');
 const alert=box.indexOf('{draftError&&<p className="note outreach-error" role="alert">{draftError}</p>}');
 assert.ok(alert>0,'rendered inside the block');
 const actions=box.indexOf('<div className="actions">');
 assert.ok(actions>alert&&actions-alert<=110,'directly above the action buttons');
 for(const onClick of ['onClick={saveDraft}','onClick={approveDraft}','onClick={copyApproved}'])assert.ok(box.indexOf(onClick)>actions,onClick);
});

test('D — cleared by a successful (re)generation and when the draft is cleared (another prospect); one piece of state',async()=>{
 const page=await src('../app/page.tsx');
 assert.match(page,/const \[draftError,setDraftError\]=useState\(''\);/);
 const gen=line(page,'generate');
 assert.ok(gen.indexOf("setDraftError('')")>gen.indexOf('if(r!==revision.current)return;'),'cleared once the new message is actually shown');
 assert.match(page,/function clearDraft\(\)\{[^}]*setDraftError\(''\)\}/);
});

test('E — the in-block alert has its own visible style',async()=>{
 assert.match(await src('../app/globals.css'),/\.outreach-error\{[^}]+\}/);
});
