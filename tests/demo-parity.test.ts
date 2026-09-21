import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEMO_PROSPECTS,DEMO_ONBOARDING_STEPS,DEMO_REAL_LABEL} from '../src/domain/demo.ts';
import {scoreProspect,FOODATOI_CRITERIA,NO_UNAUTHORIZED_LINKEDIN_AUTOMATION} from '../src/domain/core.ts';
import {FIXTURE_LABEL} from '../src/discovery/providers/fixture.ts';

// ------------------------------------------------------------
// A — onboarding content: exists, is the factual 7-step mechanism (no marketing language), and is
// actually rendered by the page (not just defined and unused).
// ------------------------------------------------------------
test('A — DEMO_ONBOARDING_STEPS has exactly the 7 factual steps of the evidence-first mechanism',()=>{
 assert.equal(DEMO_ONBOARDING_STEPS.length,7);
 for(const step of DEMO_ONBOARDING_STEPS){assert.equal(typeof step,'string');assert.ok(step.trim().length>0)}
 assert.match(DEMO_ONBOARDING_STEPS[3],/humain/i);
 assert.match(DEMO_ONBOARDING_STEPS[4],/vérifi/i);
});
test('A — app/page.tsx imports and renders DEMO_ONBOARDING_STEPS, dismissibly, only in demo mode',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/DEMO_ONBOARDING_STEPS/);
 assert.match(source,/DEMO_ONBOARDING_STEPS\.map/);
 assert.match(source,/mode==='demo'&&showDemoHelp/);
 assert.match(source,/dismissDemoHelp/);
});

// ------------------------------------------------------------
// B — the coverage===0 state gets an actionable hint instead of (or in addition to) the generic
// "low score" text — this is the fix for the reported "looks broken" first impression.
// ------------------------------------------------------------
test('B — the prospect detail view gives an actionable hint (not just a generic caption) when coverage is 0',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/scored\.coverage===0/);
 assert.match(source,/J.ai vérifié la source : valider/);
});

// ------------------------------------------------------------
// C — real vs. fixture labeling: two textually distinct labels, both surfaced in the UI, neither
// invented (DEMO_REAL_LABEL for the 5 real establishments, FIXTURE_LABEL — ProspectOS's own existing
// constant — for Discovery-found TEST companies). No new "is this fixture" logic duplicated: the page
// must reuse the existing isFixtureUrl rather than re-deriving it from a URL pattern itself.
// ------------------------------------------------------------
test('C — DEMO_REAL_LABEL and FIXTURE_LABEL are distinct, non-empty, and both rendered in app/page.tsx',async()=>{
 assert.notEqual(DEMO_REAL_LABEL,FIXTURE_LABEL);
 assert.ok(DEMO_REAL_LABEL.trim().length>0);
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/DEMO_REAL_LABEL/);
 assert.match(source,/FIXTURE_LABEL/);
 assert.match(source,/isFixtureUrl/);
});
test('C — app/page.tsx imports isFixtureUrl from the fixture module rather than redefining fixture-detection logic',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/import\s*\{FIXTURE_LABEL,isFixtureUrl\}\s*from\s*'\.\.\/src\/discovery\/providers\/fixture'/);
});

// ------------------------------------------------------------
// D — the real-site AI analysis form is disabled up front in demo mode (not just erroring on submit),
// and still never bypasses entitlement/quota in live mode.
// ------------------------------------------------------------
test('D — the offer-analysis form is disabled and explained up front in demo mode, not just erroring on submit',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/mode==='demo'&&<p className="muted">L.analyse IA devient disponible après activation bêta/);
 assert.match(source,/disabled=\{busy\|\|mode==='demo'\}>Analyser l.offre/);
});
test('D — analyze-company is still only ever called through the api() helper (server-side, entitlement-gated), never a direct provider call from the client',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/api\('analyze-company','POST'/);
 assert.doesNotMatch(source,/anthropic\.com/i);
});

// ------------------------------------------------------------
// E — REGRESSION GUARDS: nothing about the evidence-first invariant, the demo's default (unverified)
// state, Copy!=Contacted, or LinkedIn automation was weakened by this UI-only change.
// ------------------------------------------------------------
test('E — every DEMO_PROSPECTS evidence item is still NOT_VERIFIED with no verifier by default (no auto-verify introduced)',()=>{
 for(const p of DEMO_PROSPECTS)for(const e of p.evidence){assert.equal(e.status,'NOT_VERIFIED');assert.equal(e.verified_by,null)}
});
test('E — scoring an untouched demo prospect still yields score 0 and coverage 0 (the initial state was not artificially boosted)',()=>{
 const first=DEMO_PROSPECTS[0];
 const scored=scoreProspect(FOODATOI_CRITERIA,first.evidence);
 assert.equal(scored.score,0);
 assert.equal(scored.coverage,0);
 for(const b of scored.breakdown)assert.equal(b.state,'UNKNOWN');
});
test('E — Copy vs Marquer contacté remain two distinct, human-driven actions',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/Ce clic ne prouve pas un envoi/);
 assert.match(source,/Marquer contacté/);
});
test('E — no LinkedIn automation was introduced; the product invariant flag is unchanged',()=>{
 assert.equal(NO_UNAUTHORIZED_LINKEDIN_AUTOMATION,true);
});
test('E — no LinkedIn automation keywords appear anywhere in app/page.tsx',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/linkedin.*(automat|scrape|bot|bulk)/i);
});
test('E — analyze-company remains entitlement-gated server-side (route.ts unchanged in this area)',async()=>{
 const source=await readFile(new URL('../app/api/v1/[...path]/route.ts',import.meta.url),'utf8');
 assert.match(source,/resource==='analyze-company'&&request\.method==='POST'/);
 assert.match(source,/await requireActiveEntitlement\(db,user\.id\)/);
});
