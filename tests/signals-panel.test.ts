// Signal Engine S6 — the INTENT block on the prospect card (src/components/SignalsPanel.tsx). Guards: it calls only the
// signal routes, never decides a status or a confidence itself, marks demo signals TEST, never reads LinkedIn, and
// every label it shows exists in both languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {SIGNAL_TYPES} from '../src/signals/types.ts';

const src=await readFile(new URL('../src/components/SignalsPanel.tsx',import.meta.url),'utf8');

test('labels: every signal type, status and strength is translated in FR and EN',()=>{
 const keys=[...SIGNAL_TYPES.map(t=>`signals.type.${t}`),...['PENDING_REVIEW','VERIFIED','REJECTED'].map(s=>`signals.status.${s}`),...['strong','medium','weak','archive'].map(s=>`signals.strength.${s}`)];
 for(const k of keys){assert.ok((fr as any)[k],`fr ${k}`);assert.ok((en as any)[k],`en ${k}`)}
 for(const k of src.matchAll(/tr\('([a-zA-Z.]+)'\)/g))assert.ok((fr as any)[k[1]]&&(en as any)[k[1]],k[1]);
});

test('live calls: only the signal routes; review decisions are verify / reject / reset; the body never carries a status or a confidence',()=>{
 const calls=[...src.matchAll(/api\(`([^`]+)`/g)].map(m=>m[1]);
 assert.deepEqual([...new Set(calls)].sort(),['prospects/${prospect.id}/monitor','prospects/${prospect.id}/signal-scan','prospects/${prospect.id}/signals','projects/${projectId}/intent-profile','signals/${row.id}/review'].sort());
 assert.match(src,/const body=\{signal_type:form\.signal_type,excerpt:[^}]*source_url:[^}]*\}/);
 assert.doesNotMatch(src.slice(src.indexOf('const body='),src.indexOf('if(mode===\'demo\'){',src.indexOf('const body='))),/status|confidence/);
});

test('demo: TEST signals from the fixture provider, confidence by the shared rule, stored in the browser only',()=>{
 assert.match(src,/new FixtureSignalProvider\(\)/);
 assert.match(src,/signalConfidence\('test_fixture'/);assert.match(src,/signalConfidence\('user_provided'/);
 assert.match(src,/isTest\(r\)\?'TEST · '/,'a test signal is labelled TEST');
 assert.doesNotMatch(src,/fetch\(|linkedin\.com/i);
});

test('INTENT shown as two numbers (verified, estimated) — FIT untouched; sources open in a new tab without referrer',()=>{
 assert.match(src,/INTENT \{verifiedScore\}\/100/);
 assert.match(src,/estimatedScore>verifiedScore/);
 assert.doesNotMatch(src,/scoreProspect|estimateFit/);
 assert.match(src,/rel="noopener noreferrer nofollow"/);
});

test('page: the panel sits on the prospect card after the evidence review, laid out with it',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(page,/onChanged=\{syncDiscoveryEvidence\}\/><SignalsPanel key=\{`signals:\$\{mode\}:\$\{current\.id\}`\}/);
 const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
 assert.match(css,/\.detail-layout \.signals-panel\{order:7\}/);
});

test('no source (no official website, no SIREN from the register): the search is disabled and explained up front; adding a signal stays available',()=>{
 assert.match(src,/const noSite=mode==='live'&&\(sources\?!sources\.official_site&&!sources\.bodacc:!prospect\.website\);/);
 assert.match(src,/disabled=\{busy\|\|disabled\|\|noSite\} onClick=\{scan\}/);
 assert.match(src,/\{noSite&&<p className="muted">\{tr\('signals\.noSite'\)\}<\/p>\}/);
 assert.match(src,/aria-expanded=\{adding\} onClick=\{\(\)=>setAdding/);
});

test('scan result: sources read, site skipped, collective proceedings warned — all translated',()=>{
 for(const k of ['signals.readSite','signals.readBodacc','signals.siteSkipped','signals.collectiveWarning','signals.sourcesLabel','signals.sourceSite','signals.sourceBodacc'])assert.match(src,new RegExp(k.replace('.','\\.')));
 assert.match(src,/if\(r\.warnings\?\.includes\('COLLECTIVE_PROCEDURE'\)\)parts\.push/);
});
