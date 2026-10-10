// Migration 029 — O1/O2 provenance at the moment of use (API + UI). The database refuses to approve or copy a message
// whose cited public content or signal is no longer VERIFIED (tests/outreach-provenance-db.mjs). Here: the API turns
// that refusal into an explicit 409, the UI shows it in the user's language, the text never reaches the clipboard
// before the server accepted the copy, and nothing is regenerated or re-verified behind the user's back. Modules are
// imported lazily so each case fails on its own (RED) while they do not exist yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const load=async(path:string)=>{try{return await import(path)}catch{return null}};
const src=(p:string)=>readFile(new URL(p,import.meta.url),'utf8');
const ROUTE='../app/api/v1/[...path]/route.ts';
const MESSAGE='Une source utilisée par ce message n’est plus vérifiée. Régénérez le message avant de l’approuver ou de le copier.';

test('A — one stable refusal: code OUTREACH_SOURCE_NOT_VERIFIED and the explicit sentence, recognised only from the database token',async()=>{
 const wf=await load('../src/outreach/workflow.ts');
 assert.ok(wf?.SOURCE_NOT_VERIFIED,'SOURCE_NOT_VERIFIED is exported');
 assert.equal(wf.SOURCE_NOT_VERIFIED.code,'OUTREACH_SOURCE_NOT_VERIFIED');assert.equal(wf.SOURCE_NOT_VERIFIED.error,MESSAGE);
 assert.equal(wf.isSourceNotVerified({code:'P0001',message:'outreach_source_not_verified'}),true);
 assert.equal(wf.isSourceNotVerified(Error('outreach_source_not_verified')),true);
 for(const other of [{code:'42501',message:'An approved outreach message is locked'},{code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned'},
  {message:'not_outreach_source_not_verified_x'},null,undefined,'outreach'])
  assert.equal(wf.isSourceNotVerified(other),false,JSON.stringify(other));
});

test('B — PATCH: the refusal becomes a 409 with that sentence and code; other database errors keep the generic path; nothing is regenerated',async()=>{
 const route=await src(ROUTE);
 const patch=route.slice(route.indexOf("resource==='outreach'&&request.method==='PATCH'"),route.indexOf("resource==='events'"));
 assert.ok(patch.length>100,'the PATCH handler is found');
 assert.match(patch,/isSourceNotVerified\(/);
 assert.match(patch,/json\(\{error:SOURCE_NOT_VERIFIED\.error,code:SOURCE_NOT_VERIFIED\.code\},409\)/);
 assert.match(patch,/throw Error\('DATABASE_REQUEST_FAILED'\)/,'any other failure stays the generic error');
 assert.doesNotMatch(patch,/generateOutreachWithAi|composeRuleBased|from\('outreach'\)\.insert|review_public_content|review_signal|generated_content/,
  'a refusal never regenerates the message, re-verifies a source or touches the original');
});

test('C — the refusal is shown in the user’s language (FR: the exact sentence; EN: a translation)',async()=>{
 const errs=await load('../src/i18n/errors.ts');assert.ok(errs?.localizeApiErrorMessage);
 assert.equal(errs.localizeApiErrorMessage(MESSAGE,'OUTREACH_SOURCE_NOT_VERIFIED','fr'),MESSAGE);
 const en=errs.localizeApiErrorMessage(MESSAGE,'OUTREACH_SOURCE_NOT_VERIFIED','en');
 assert.notEqual(en,MESSAGE);assert.match(en,/no longer verified/i);assert.match(en,/regenerate/i);
});

test('D — UI: Copy puts the text in the clipboard only once the server accepted USED; Approve shows APPROVED only once accepted',async()=>{
 const page=await src('../app/page.tsx');
 const start=page.indexOf('async function copyApproved');assert.ok(start>0,'copyApproved exists');
 const copy=page.slice(start,page.indexOf('\n',start));
 assert.match(copy,/copyAfter\(/,'the clipboard write waits for the server');
 assert.match(copy,/api\(`outreach\/\$\{draftId\}`,'PATCH',\{status:'USED'\}\)/);
 assert.doesNotMatch(copy,/navigator\.clipboard\.writeText\(draft\)/,'no direct clipboard write before the server answered');
 assert.match(copy,/outreach\.copyManual/,'when the server accepted but the browser refused the clipboard, the user is told to copy by hand');
 const approve=page.slice(page.indexOf('async function approveDraft'),start);
 assert.ok(approve.indexOf('await api(')>0&&approve.indexOf('await api(')<approve.indexOf("setDraftStatus('APPROVED')"),'APPROVED is shown only after the server accepted');
 for(const f of ['../src/i18n/fr.ts','../src/i18n/en.ts'])assert.match(await src(f),/'outreach\.copyManual':'/,f);
});

test('E — copyAfter: refused → nothing copied and the server error surfaces; accepted → copied (ClipboardItem, else writeText); clipboard refused → false',async()=>{
 const m=await load('../src/components/clipboard.ts');assert.ok(m?.copyAfter,'copyAfter is exported');
 class Item{data:Record<string,Promise<Blob>>;constructor(data:Record<string,Promise<Blob>>){this.data=data}}
 // A clipboard that, like browsers, resolves the item's data before writing anything.
 const fake=()=>{const state={written:[] as string[],writeText:[] as string[]};
  return {state,clipboard:{async write(items:Item[]){for(const it of items){const b=await it.data['text/plain'];state.written.push(await b.text())}},async writeText(t:string){state.writeText.push(t)}}}};
 const refusal=Object.assign(Error(MESSAGE),{code:'OUTREACH_SOURCE_NOT_VERIFIED'});
 {const f=fake();await assert.rejects(m.copyAfter(Promise.reject(refusal),'texte',{clipboard:f.clipboard,ClipboardItem:Item}),(e:unknown)=>e===refusal);
  assert.deepEqual(f.state,{written:[],writeText:[]},'refused: the clipboard is untouched');}
 {const f=fake();assert.equal(await m.copyAfter(Promise.resolve({}),'texte approuvé',{clipboard:f.clipboard,ClipboardItem:Item}),true);
  assert.deepEqual(f.state,{written:['texte approuvé'],writeText:[]},'accepted: the approved text is copied once');}
 {const f=fake();assert.equal(await m.copyAfter(Promise.resolve({}),'t',{clipboard:f.clipboard,ClipboardItem:undefined}),true);assert.deepEqual(f.state.writeText,['t'],'no ClipboardItem: writeText after the server');}
 {const f=fake();await assert.rejects(m.copyAfter(Promise.reject(refusal),'t',{clipboard:f.clipboard,ClipboardItem:undefined}),(e:unknown)=>e===refusal);assert.deepEqual(f.state.writeText,[],'no ClipboardItem, refused: nothing copied');}
 {const state:string[]=[];const clipboard={async write(){throw Error('promise data not supported')},async writeText(t:string){state.push(t)}};
  assert.equal(await m.copyAfter(Promise.resolve({}),'t',{clipboard,ClipboardItem:Item}),true);assert.deepEqual(state,['t'],'a failed ClipboardItem write falls back to writeText');}
 {const clipboard={async write(){throw Error('NotAllowedError')},async writeText(){throw Error('NotAllowedError')}};
  assert.equal(await m.copyAfter(Promise.resolve({}),'t',{clipboard,ClipboardItem:Item}),false,'accepted but not copied: reported, never thrown');}
 assert.equal(await m.copyAfter(Promise.resolve({}),'t',{clipboard:undefined,ClipboardItem:undefined}),false,'no clipboard at all: reported');
});
