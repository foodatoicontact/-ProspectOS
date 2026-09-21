import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEMO_PROSPECTS,DEMO_ONBOARDING_STEPS,DEMO_REAL_LABEL,DEMO_LIVE_LIMITATIONS} from '../src/domain/demo.ts';
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

// ------------------------------------------------------------
// F — reset: exists, is demo-scoped only, never touches session/auth/account state, and actually
// restores the pristine onboarding + prospects.
// ------------------------------------------------------------
test('F — a resetDemo action exists, guarded to demo mode, and is only rendered as a demo-mode button',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/function resetDemo\(\)\{if\(mode!=='demo'\)return;/);
 assert.match(source,/mode==='demo'&&<button className="text-button" disabled=\{busy\} onClick=\{resetDemo\}>/);
});
test('F — resetDemo touches only the two demo-scoped localStorage keys, then replays demo() — never an api() call, never token/session/account state',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const fn=source.match(/function resetDemo\(\)\{[^}]*\}/)?.[0]??'';
 assert.ok(fn,'resetDemo body not found');
 assert.match(fn,/localStorage\.removeItem\('prospectos-demo-v1'\)/);
 assert.match(fn,/localStorage\.removeItem\('prospectos-demo-help-dismissed'\)/);
 assert.match(fn,/demo\(\)/);
 assert.doesNotMatch(fn,/api\(/);
 assert.doesNotMatch(fn,/setToken|setUserEmail|setOrgName|setRole|setBetaActive|setEntitlementPlan|signOut/);
});
test('F — resetDemo never removes any localStorage key other than the two demo-scoped ones (no wildcard clear)',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const fn=source.match(/function resetDemo\(\)\{[^}]*\}/)?.[0]??'';
 const removals=[...fn.matchAll(/localStorage\.removeItem\('([^']+)'\)/g)].map(m=>m[1]);
 assert.deepEqual(new Set(removals),new Set(['prospectos-demo-v1','prospectos-demo-help-dismissed']));
 assert.doesNotMatch(fn,/localStorage\.clear\(\)/);
});

// ------------------------------------------------------------
// G — Discovery discloses, in demo mode, that results are synthetic TEST data and that no real web
// search ever runs — placed where the confusion is actually created, not just in the onboarding panel.
// ------------------------------------------------------------
test('G — DiscoveryPanel explicitly discloses TEST/synthetic data and "no real search" in demo mode',async()=>{
 const source=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.match(source,/mode==='demo'&&<div className="note">Mode démonstration/);
 assert.match(source,/entreprises TEST synthétiques/);
 assert.match(source,/aucune recherche web réelle/);
});
test('H — Brave is still unconditionally disabled in demo mode (no real Discovery activated)',async()=>{
 const source=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 assert.match(source,/disabled=\{mode==='demo'\|\|!available\}/);
 assert.match(source,/if\(mode==='demo'\)\{const p=new FixtureProvider\(\)/);
});

// ------------------------------------------------------------
// I — the real-establishment badge separates "this company exists" from "this data is verified".
// ------------------------------------------------------------
test('I — DEMO_REAL_LABEL never implies the data is already verified',()=>{
 assert.match(DEMO_REAL_LABEL,/réel/i);
 assert.match(DEMO_REAL_LABEL,/à vérifier/i);
 assert.doesNotMatch(DEMO_REAL_LABEL,/vérifié(e)?[^s]/i);
});

// ------------------------------------------------------------
// J — verification attribution: a demo-mode self-declared verification never reads the same as a bare
// "Vérifiée" that could be mistaken for an automatic/system check.
// ------------------------------------------------------------
test('J — evidence verified by the demo self-declaration flow is labeled as a human declaration, not a bare "Vérifiée"',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/e\.verified_by==='demo-human'\?'Vérifiée · déclaration humaine \(démo\)':'Vérifiée'/);
});

// ------------------------------------------------------------
// K — the live-capability limitation is stated explicitly and never overclaims (never "discovered
// live", never claims Brave or a live analysis ran in this public demo).
// ------------------------------------------------------------
test('K — DEMO_LIVE_LIMITATIONS states the real limitation without overclaiming a live capability',()=>{
 assert.equal(DEMO_LIVE_LIMITATIONS.length,4);
 const joined=DEMO_LIVE_LIMITATIONS.join(' ');
 assert.doesNotMatch(joined,/découvert(e|es)? en direct/i);
 assert.doesNotMatch(joined,/analyse live réelle/i);
 assert.match(joined,/aucune recherche web réelle/i);
 assert.match(joined,/n.est pas exécutée dans cette démo publique/i);
});
test('K — app/page.tsx renders DEMO_LIVE_LIMITATIONS inside the onboarding panel',async()=>{
 const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 assert.match(source,/DEMO_LIVE_LIMITATIONS\.map/);
});

// ------------------------------------------------------------
// L — no new external API surface was added by this follow-up patch (text/state only).
// ------------------------------------------------------------
test('L — no new fetch/api call was introduced by the follow-up patch (reset and disclosures are local-only)',async()=>{
 const page=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
 const panel=await readFile(new URL('../src/components/DiscoveryPanel.tsx',import.meta.url),'utf8');
 for(const source of [page,panel])assert.doesNotMatch(source,/fetch\(['"`]https?:/);
});
