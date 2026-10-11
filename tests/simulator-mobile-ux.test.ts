// Public simulator V1 — final mobile pass (presentation only). On a phone, prospect #1 is open and #2 / #3 are compact
// ("Voir l'analyse" / "Réduire l'analyse", a local UI state: the full analysis stays in the page, hidden, nothing is
// removed or recomputed). A short results intro, the detail behind "Comment fonctionne cette simulation ?". Plain
// wording with correct singular / plural, the SAME values. The angle CTA is a real primary button, same destination.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitToConfirmLabel,reasonCountsLabel,proofsSummaryLabel,whyStateLabel} from '../src/simulator/wording.ts';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';

const sim=readFileSync(new URL('../src/components/Simulator.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('wording — singular / plural, same values',()=>{
 assert.equal(fitToConfirmLabel(1,18),'1 source à confirmer · jusqu’à +18 points');
 assert.equal(fitToConfirmLabel(2,22),'2 sources à confirmer · jusqu’à +22 points');
 assert.equal(fitToConfirmLabel(1,1),'1 source à confirmer · jusqu’à +1 point');
 assert.equal(reasonCountsLabel(1,0),'1 signal vérifié');
 assert.equal(reasonCountsLabel(2,1),'2 signaux vérifiés · 1 à confirmer');
 assert.equal(reasonCountsLabel(0,2),'Aucun signal vérifié · 2 à confirmer');
 assert.equal(proofsSummaryLabel(1,1),'1 preuve vérifiée · 1 à confirmer');
 assert.equal(proofsSummaryLabel(3,0),'3 preuves vérifiées');
 assert.equal(proofsSummaryLabel(0,2),'Aucune preuve vérifiée · 2 à confirmer');
 assert.equal(whyStateLabel('verified'),'Signal vérifié');
 assert.equal(whyStateLabel('to_confirm'),'Signal à confirmer');
 assert.equal(whyStateLabel('none'),'Aucun signal vérifié');
 assert.equal(whyStateLabel('loading'),'Aucun signal vérifié');
});
test('reason card — the existing INTENT value on /100, plain label, no jargon in front',()=>{
 assert.match(sim,/<b>\{p\.reason\.score===null\?'—':`\$\{p\.reason\.score\}\/100`\}<\/b>/);
 assert.match(sim,/reasonCountsLabel\(p\.reason\.verified,p\.reason\.to_confirm\)/);
 assert.doesNotMatch(sim,/tr\('ux\.reason\.verifiedIntent'\)|tr\('ux\.reason\.counts'\)/,'"INTENT vérifié" is no longer shown');
 assert.match(sim,/fitToConfirmLabel\(p\.fit\.toVerify,p\.fit\.toVerifyPoints\)/);
 assert.doesNotMatch(sim,/tr\('score\.toVerify'\)/);
});
test('phone: #1 open, #2 and #3 compact; desktop keeps everything open; a local toggle',()=>{
 assert.match(sim,/const phone=\(\(\)=>\{try\{return window\.matchMedia\('\(max-width:719px\)'\)\.matches\}catch\{return false\}\}\)\(\);/);
 assert.match(sim,/setOpen\(new Set\(phone\?\[0\]:view\.prospects\.map\(\(_,i\)=>i\)\)\);/);
 assert.match(sim,/<button type="button" className="sim-toggle" aria-expanded=\{isOpen\} aria-controls=\{`sim-analysis-\$\{p\.id\}`\} onClick=\{\(\)=>toggle\(i\)\}>\{isOpen\?tr\('sim\.analysis\.hide'\):tr\('sim\.analysis\.show'\)\}<\/button>/);
 assert.equal(fr['sim.analysis.show'],'Voir l’analyse');assert.equal(fr['sim.analysis.hide'],'Réduire l’analyse');
});
test('nothing removed: the full analysis is always in the page, only hidden when compact',()=>{
 assert.match(sim,/<div className="sim-analysis" id=\{`sim-analysis-\$\{p\.id\}`\} hidden=\{!isOpen\}>/);
 const start=sim.indexOf('<div className="sim-analysis"'),end=sim.indexOf('</div>{/* end analysis */}');
 assert.ok(start>0&&end>start);
 const inside=sim.slice(start,end);
 for(const m of ['<Why p={p}/>','className="sim-fit','className="sim-angle"','className="sim-proofs"'])assert.ok(inside.includes(m),m);
 // the compact summary: FIT and the state of "why now", from the same view values
 assert.match(sim,/\{!isOpen&&<p className="sim-compact">/);
 assert.match(sim,/whyStateLabel\(p\.hero\.state\)/);
 assert.match(css,/\.sim-analysis\[hidden\]\{display:none\}/);
});
test('results intro: one short line, the explanations behind "Comment fonctionne cette simulation ?"',()=>{
 assert.equal(fr['sim.how.title'],'Comment fonctionne cette simulation ?');
 assert.equal(fr['sim.summary.match'],'Exemple basé sur votre ciblage : {s} · {r}');
 assert.match(sim,/<p className="sim-summary">/);
 const how=sim.indexOf('<details className="sim-how">'),howEnd=sim.indexOf('</details>',how);
 assert.ok(how>0);
 const inside=sim.slice(how,howEnd);
 for(const k of ['sim.how.title','sim.match.fallback','sim.match.found','sim.region.note','sim.results.note'])assert.ok(inside.includes(`'${k}'`),k);
 assert.ok(sim.indexOf('<p className="sim-banner" role="note">')>0,'the sticky demo notice stays');
});
test('angle CTA: a real primary button, same wording, same destination; analytics unchanged in kind',()=>{
 assert.match(sim,/<a href="\/" className="button primary sim-prepare" onClick=\{signup\(result\.view\.scenario_id,i\+1\)\}>\{tr\('sim\.cta\.prepare'\)\}<\/a>/);
 assert.equal(fr['sim.cta.prepare'],'Créer mon compte pour préparer ce message');
 assert.match(css,/\.sim-prepare\{[^}]*width:100%;[^}]*min-height:48px/);
 for(const k of Object.keys(fr).filter(k=>k.startsWith('sim.')))assert.ok((en as Record<string,string>)[k],`en ${k}`);
});
