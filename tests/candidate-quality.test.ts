import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCandidateQuality} from '../src/discovery/candidate-quality.ts';

const TOULOUSE = 'Toulouse, occitanie';

// ============================================================
// A — an individual establishment's own official site: kept, favored (boosted above baseline).
// ============================================================
test('A — an individual business homepage is favored: likely_business_site, boosted confidence, location observed', () => {
 const r = assessCandidateQuality({title: 'Chez Mario - Restaurant italien à Toulouse', url: 'https://chezmario-toulouse.fr/', description: 'Notre restaurant familial vous accueille au centre de Toulouse. Commande en ligne disponible.'}, TOULOUSE);
 assert.equal(r.signal, 'likely_business_site');
 assert.ok(r.reasons.includes('likely_business_site'));
 assert.ok(r.reasons.includes('location_match'));
 assert.ok(r.confidence > 0.45, 'boosted strictly above the neutral baseline');
});

// ============================================================
// B — "10 meilleurs X à Toulouse"-style listicle: heavily penalized, never dropped.
// ============================================================
test('B — a numbered "best-of" listicle is heavily penalized (listicle_pattern + editorial_pattern), never dropped', () => {
 const r = assessCandidateQuality({title: '10 meilleurs restaurants à Toulouse en 2026', url: 'https://guide-sortir.fr/toulouse/restaurants-top10', description: 'Découvrez notre classement des meilleures adresses.'}, TOULOUSE);
 assert.equal(r.signal, 'listicle_pattern');
 assert.ok(r.reasons.includes('listicle_pattern'));
 assert.ok(r.reasons.includes('editorial_pattern'));
 assert.ok(r.confidence < 0.45, 'penalized strictly below the neutral baseline');
 assert.ok(r.confidence >= 0.05, 'never driven to zero — conservative, never a hard exclusion');
});

// ============================================================
// C — a marketplace/platform listing many businesses: heavily penalized, never dropped.
// ============================================================
test('C — a known cross-sector marketplace/aggregator domain is heavily penalized (aggregator_pattern + multi_entity_page)', () => {
 const r = assessCandidateQuality({title: 'Restaurants à Toulouse : commandez en ligne', url: 'https://www.ubereats.com/fr/toulouse/restaurants'}, TOULOUSE);
 assert.equal(r.signal, 'aggregator_pattern');
 assert.ok(r.reasons.includes('aggregator_pattern'));
 assert.ok(r.reasons.includes('multi_entity_page'));
 assert.ok(r.confidence < 0.45);
});

// ============================================================
// D — an ambiguous page (no listicle/aggregator wording, but not shaped like a homepage either):
// stays at/below the neutral baseline, signal 'ambiguous' — never fabricated into either extreme. This
// reproduces the real, unresolved 2026-09-18 smoke-test result (an editorial-voice local blog post with
// no listicle numbering and no marketplace wording) — an honest residual gap, not silently promoted.
// ============================================================
test('D — an ambiguous page (no clear signal either way) is never promoted to likely_business_site, whatever its confidence ends up at', () => {
 const r = assessCandidateQuality({title: 'À emporter ou en livraison, vos chefs toulousains vous régalent à domicile - toulouscope.fr', url: 'https://toulouscope.fr/a-la-une/emporter-livraison-toulouse'}, TOULOUSE);
 assert.equal(r.signal, 'ambiguous');
 assert.ok(!r.reasons.includes('likely_business_site'), 'absence of a negative signal must never be treated as a positive one');
 assert.ok(!r.reasons.some(x => ['listicle_pattern', 'editorial_pattern', 'aggregator_pattern', 'multi_entity_page'].includes(x)), 'no negative pattern actually matched — this genuinely is the undetected/ambiguous case, not a missed penalty');
 // The URL path happens to spell out "toulouse" (a faithful detail from the real observed result), so
 // the independent, honest location_match observation still applies (+0.05 over baseline) — that is not
 // a promotion to likely_business_site, just an orthogonal, purely observational fact about the URL.
 assert.equal(r.confidence, 0.5);
 assert.ok(r.confidence < 0.6, 'still far below a confirmed likely_business_site (fixture A scores 0.65)');
});
test('D2 — the same ambiguous page with no location reference at all stays exactly at the neutral baseline', () => {
 const r = assessCandidateQuality({title: 'À emporter ou en livraison, vos chefs vous régalent à domicile - unguide.fr', url: 'https://unguide.fr/actualites/gastronomie-a-domicile'}, 'Bordeaux, nouvelle-aquitaine');
 assert.equal(r.signal, 'ambiguous');
 assert.equal(r.confidence, 0.45, 'no negative pattern, no positive marker, no location match — the exact neutral baseline, neither rewarded nor penalized');
});

// ============================================================
// E — genericity across other sectors: the exact same heuristics, zero sector-specific wording.
// ============================================================
test('E1 — an individual firm (cabinet comptable) is favored exactly like a restaurant would be', () => {
 const r = assessCandidateQuality({title: 'Dupont & Associés - Expert-comptable à Toulouse', url: 'https://dupont-associes-comptable.fr/'}, TOULOUSE);
 assert.equal(r.signal, 'likely_business_site');
});
test('E2 — a "top N" listicle for cabinets comptables is penalized exactly like a restaurant listicle', () => {
 const r = assessCandidateQuality({title: '10 meilleurs cabinets comptables à Toulouse', url: 'https://annuaire-pro.fr/comptables/toulouse'}, TOULOUSE);
 assert.equal(r.signal, 'listicle_pattern');
 assert.ok(r.confidence < 0.45);
});
test('E3 — a real-estate marketplace (seloger.com) is penalized by the exact same generic aggregator-host mechanism', () => {
 const r = assessCandidateQuality({title: 'Agences immobilières à Toulouse', url: 'https://www.seloger.com/agences/toulouse'}, TOULOUSE);
 assert.equal(r.signal, 'aggregator_pattern');
});
test('E4 — a software company (SaaS) homepage is favored, proving the mechanism is not restaurant/location-word-dependent', () => {
 const r = assessCandidateQuality({title: 'Nova CRM - Logiciel de gestion commerciale', url: 'https://novacrm.io/'}, 'Lyon, auvergne-rhone-alpes');
 assert.equal(r.signal, 'likely_business_site');
});

test('confidence is always clamped within (0, 1) — never a claimed certainty, never literally zero', () => {
 for (const fixture of [
  {title: '15 meilleures agences immobilières à Lyon : notre classement complet 2026', url: 'https://www.pagesjaunes.fr/annuaire/lyon/agences-immobilieres'},
  {title: 'X', url: 'https://x.example/'},
 ]) {
  const r = assessCandidateQuality(fixture, 'Lyon');
  assert.ok(r.confidence > 0 && r.confidence < 1);
 }
});

test('a malformed URL never throws — falls back to a neutral assessment instead of crashing candidate normalization', () => {
 assert.doesNotThrow(() => assessCandidateQuality({title: 'test', url: 'javascript:x'}, TOULOUSE));
});
