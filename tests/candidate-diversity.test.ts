import test from 'node:test';
import assert from 'node:assert/strict';
import {isNearDuplicateCandidate,selectDiverseCandidates} from '../src/discovery/candidate-diversity.ts';

const c = (title: string, url: string) => ({title, url});

// ============================================================
// A — two near-identical results from the same domain + three distinct businesses available:
// only one near-duplicate occupies the final top max_results.
// ============================================================
test('A — a near-duplicate pair from the same domain: only one of the pair survives into the top max_results, replaced by a genuinely distinct candidate', () => {
 const pool = [
  c('Commande en ligne restaurant Toulouse : solution click & collect | Resto Drive', 'https://www.restodrive.fr/toulouse/commande-en-ligne-solution'),
  c('Terra Tolosa - Restaurant Traditionnel - Toulouse', 'https://terratolosa.fr/'),
  c('Commande en ligne restaurant Toulouse', 'https://www.restodrive.fr/toulouse'),
  c('Chez Mario - Restaurant italien - Toulouse', 'https://chezmario-toulouse.fr/'),
  c('Le Petit Comptoir - Bistrot - Toulouse', 'https://lepetitcomptoir-toulouse.fr/'),
 ];
 const top3 = selectDiverseCandidates(pool, 3);
 assert.equal(top3.length, 3);
 const restoDriveCount = top3.filter(r => new URL(r.url).hostname.includes('restodrive.fr')).length;
 assert.equal(restoDriveCount, 1, 'only one Resto Drive result occupies a slot');
 assert.ok(top3.some(r => r.url === 'https://terratolosa.fr/'));
 assert.ok(top3.some(r => r.url.includes('chezmario') || r.url.includes('lepetitcomptoir')), 'a genuinely distinct candidate fills the freed slot instead of under-returning');
});

// ============================================================
// B — same establishment, two different URLs, near-identical titles: diversity favored regardless of
// hostname (the strong title-similarity signal alone is sufficient).
// ============================================================
test('B — near-identical titles across two DIFFERENT hostnames are still recognized as a near-duplicate pair', () => {
 assert.ok(isNearDuplicateCandidate(
  c('Chez Mario - Restaurant italien à Toulouse', 'https://chezmario.fr/'),
  c('Chez Mario - Restaurant italien à Toulouse', 'https://www.pagesjaunes.fr/pros/chez-mario-toulouse')
 ));
 const pool = [
  c('Chez Mario - Restaurant italien à Toulouse', 'https://www.pagesjaunes.fr/pros/chez-mario-toulouse'),
  c('Chez Mario - Restaurant italien à Toulouse', 'https://chezmario.fr/'),
  c('Terra Tolosa - Restaurant Traditionnel - Toulouse', 'https://terratolosa.fr/'),
 ];
 const top2 = selectDiverseCandidates(pool, 2);
 assert.equal(top2.length, 2);
 assert.equal(top2.filter(r => r.title.startsWith('Chez Mario')).length, 1, 'only one of the two near-identical-title results is kept');
 assert.ok(top2.some(r => r.url === 'https://terratolosa.fr/'), 'the distinct establishment fills the freed slot');
});

// ============================================================
// C — two clearly distinct pages of the same multi-entity domain: never treated as duplicates
// automatically. Same domain alone is deliberately never sufficient.
// ============================================================
test('C — two clearly distinct establishments on the same corporate/multi-brand domain are never conflated', () => {
 assert.equal(isNearDuplicateCandidate(
  c('Restaurant Le Jardin - Groupe Saveurs - Toulouse', 'https://www.groupe-saveurs.fr/le-jardin'),
  c('Boulangerie Dupont - Groupe Saveurs - Toulouse', 'https://www.groupe-saveurs.fr/boulangerie-dupont')
 ), false);
 const pool = [
  c('Restaurant Le Jardin - Groupe Saveurs - Toulouse', 'https://www.groupe-saveurs.fr/le-jardin'),
  c('Boulangerie Dupont - Groupe Saveurs - Toulouse', 'https://www.groupe-saveurs.fr/boulangerie-dupont'),
 ];
 const top2 = selectDiverseCandidates(pool, 2);
 assert.equal(top2.length, 2, 'both distinct establishments are kept even though they share a domain');
});

// ============================================================
// D — three businesses on three different domains: quality order preserved, diversity is a no-op.
// ============================================================
test('D — three genuinely distinct candidates on three different domains: order and count are untouched', () => {
 const pool = [c('A', 'https://a.example/'), c('B', 'https://b.example/'), c('C', 'https://c.example/')];
 assert.deepEqual(selectDiverseCandidates(pool, 3), pool);
});

// ============================================================
// E — fewer distinct domains/entities in the pool than max_results: never under-return.
// ============================================================
test('E — when the pool has fewer genuinely distinct candidates than max_results, remaining slots are filled rather than returning fewer results', () => {
 const pool = [
  c('Commande en ligne restaurant Toulouse', 'https://www.restodrive.fr/toulouse'),
  c('Commande en ligne restaurant Toulouse : solution click & collect | Resto Drive', 'https://www.restodrive.fr/toulouse/commande'),
  c('Terra Tolosa - Restaurant Traditionnel - Toulouse', 'https://terratolosa.fr/'),
 ];
 const top3 = selectDiverseCandidates(pool, 3);
 assert.equal(top3.length, 3, 'still returns 3 — the pool only has 2 genuinely distinct entities, so one near-duplicate necessarily fills the last slot rather than under-returning');
 assert.ok(top3.some(r => r.url === 'https://terratolosa.fr/'));
});

// ============================================================
// F — regression fixture reproducing the exact real smoke-test pool from the 4A.1 report.
// ============================================================
test('F — regression: the real observed pool (2 Resto Drive + Terra Tolosa + distinct establishments lower in the pool) surfaces Terra Tolosa plus two distinct candidates', () => {
 const pool = [
  c('Commande en ligne restaurant Toulouse', 'https://www.restodrive.fr/toulouse'),
  c('Terra Tolosa - Restaurant Traditionnel - Toulouse', 'https://terratolosa.fr/'),
  c('Commande en ligne restaurant Toulouse : solution click & collect | Resto Drive', 'https://www.restodrive.fr/toulouse/click-and-collect'),
  c('Chez Mario - Restaurant italien - Toulouse', 'https://chezmario-toulouse.fr/'),
  c('Le Petit Comptoir - Bistrot - Toulouse', 'https://lepetitcomptoir-toulouse.fr/'),
 ];
 const top3 = selectDiverseCandidates(pool, 3);
 assert.equal(top3.length, 3);
 assert.ok(top3.some(r => r.url === 'https://terratolosa.fr/'), 'Terra Tolosa is present');
 assert.equal(top3.filter(r => r.url.includes('restodrive.fr')).length, 1, 'exactly one Resto Drive slot, not two');
 assert.equal(new Set(top3.map(r => new URL(r.url).hostname)).size, 3, 'three distinct hostnames occupy the three slots');
});

// ============================================================
// Never a hard exclusion — selectDiverseCandidates only ever reorders/substitutes, count is always
// min(maxResults, pool.length).
// ============================================================
test('never returns more candidates than the pool actually has', () => {
 const pool = [c('A', 'https://a.example/')];
 assert.equal(selectDiverseCandidates(pool, 3).length, 1);
});
test('an empty pool returns an empty selection, never throws', () => {
 assert.deepEqual(selectDiverseCandidates([], 3), []);
});
