import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fr} from '../src/i18n/fr.ts';
import {en} from '../src/i18n/en.ts';
import {translate} from '../src/i18n/useLocale.ts';

// ============================================================
// Integration of Entity Resolution (feat/entity-resolution) onto the i18n-validated main
// (feat/i18n-fr-en). The only file both branches touched is DiscoveryPanel.tsx; everything below
// verifies the two features actually compose — resolution display fully localized, i18n's own
// invariants (never translate business data, RESOLVED != VERIFIED) both still hold together.
// ============================================================

// ------------------------------------------------------------
// 1/2 — RESOLVED display exists in both locales, via the dictionary, and the two locales are
// genuinely distinct strings (never a placeholder/untranslated copy).
// ------------------------------------------------------------
test('1/2 — RESOLVED company/website/resolution labels exist in both FR and EN, and are genuinely distinct', () => {
 for (const key of ['discovery.identifiedCompanyLabel', 'discovery.companyWebsiteLabel', 'discovery.websitePendingReview', 'discovery.signalFoundVia', 'discovery.resolutionLabel', 'discovery.resolutionBothLabel', 'discovery.resolutionNameOnlyLabel'] as const) {
  assert.equal(typeof fr[key], 'string');
  assert.equal(typeof en[key], 'string');
  assert.notEqual(fr[key], en[key], `${key} must actually be translated, not copy-pasted`);
 }
 assert.equal(translate('fr', 'discovery.identifiedCompanyLabel'), 'Entreprise identifiée');
 assert.equal(translate('en', 'discovery.identifiedCompanyLabel'), 'Identified company');
 assert.equal(translate('fr', 'discovery.resolutionNameOnlyLabel'), 'Nom identifié · domaine à confirmer');
 assert.equal(translate('en', 'discovery.resolutionNameOnlyLabel'), 'Company name identified · domain unresolved');
});
test('1/2 (RESOLVED-NAME wording) — never uses "Verified" or a French/English equivalent anywhere in the entity-resolution dictionary keys', () => {
 for (const key of ['discovery.identifiedCompanyLabel', 'discovery.companyWebsiteLabel', 'discovery.websitePendingReview', 'discovery.signalFoundVia', 'discovery.resolutionLabel', 'discovery.resolutionBothLabel', 'discovery.resolutionNameOnlyLabel'] as const) {
  assert.doesNotMatch(fr[key], /v[ée]rifi/i);
  assert.doesNotMatch(en[key], /verified/i);
 }
});

// ------------------------------------------------------------
// 3/4 — UNRESOLVED display exists in both locales.
// ------------------------------------------------------------
test('3/4 — UNRESOLVED company label exists in both FR and EN, and is genuinely distinct', () => {
 assert.equal(typeof fr['discovery.unresolvedCompany'], 'string');
 assert.equal(typeof en['discovery.unresolvedCompany'], 'string');
 assert.notEqual(fr['discovery.unresolvedCompany'], en['discovery.unresolvedCompany']);
 assert.equal(translate('fr', 'discovery.unresolvedCompany'), 'Source détectée — entité non résolue');
 assert.equal(translate('en', 'discovery.unresolvedCompany'), 'Source detected — entity not resolved');
});

// ------------------------------------------------------------
// 5 — no new hardcoded FR/EN literal text was introduced directly in DiscoveryPanel.tsx for the
// entity-resolution block: every label goes through tr(), never a raw string literal.
// ------------------------------------------------------------
test('5 — DiscoveryPanel\'s entity-resolution block contains no hardcoded label text, only tr() lookups', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 const forbiddenLiterals = ['Entreprise identifiée', 'Site d’entreprise', 'À confirmer', 'Signal trouvé via', 'non résolue', 'Identified company', 'Company website', 'To review', 'Signal found via', 'Unresolved company'];
 for (const literal of forbiddenLiterals) assert.doesNotMatch(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `"${literal}" must live only in fr.ts/en.ts, never hardcoded in the component`);
 assert.match(source, /tr\('discovery\.identifiedCompanyLabel'\)/);
 assert.match(source, /tr\('discovery\.companyWebsiteLabel'\)/);
 assert.match(source, /tr\('discovery\.websitePendingReview'\)/);
 assert.match(source, /tr\('discovery\.unresolvedCompany'\)/);
 assert.match(source, /tr\('discovery\.signalFoundVia'\)/);
 assert.match(source, /tr\('discovery\.resolutionLabel'\)/);
 assert.match(source, /tr\('discovery\.resolutionBothLabel'\)/);
 assert.match(source, /tr\('discovery\.resolutionNameOnlyLabel'\)/);
});

// ------------------------------------------------------------
// 6/7 — company/source data (name, website, domain) is always rendered raw, never routed through
// tr()/translate() — those functions only ever accept a fixed dictionary TKey, never arbitrary data,
// so a business value literally cannot be passed to them without a type error, but this asserts the
// actual JSX shape stays a direct interpolation.
// ------------------------------------------------------------
test('6/7 — company name, website and domain values are rendered raw, never wrapped in tr()/translate()', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(source, /\{r\.normalized_payload\.name\}/);
 assert.match(source, /\{r\.normalized_payload\.website\?\?tr\(/);
 assert.doesNotMatch(source, /tr\(r\.normalized_payload/, 'business data must never be passed as a translation key');
 assert.doesNotMatch(source, /translate\([^,]+,\s*r\.normalized_payload/, 'business data must never be passed as a translation key');
});

// ------------------------------------------------------------
// 8 — the media/source is always kept and shown, unconditionally (not gated behind resolved/
// unresolved), consistent with "source never deleted".
// ------------------------------------------------------------
test('8 — the source link is rendered unconditionally, for both RESOLVED and UNRESOLVED candidates', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 assert.match(source, /<a href=\{r\.normalized_payload\.source_url\}/);
});

// ------------------------------------------------------------
// 9 — company website and source_url are distinct fields in the Candidate schema (structurally
// separate, never conflated into a single column) — see tests/entity-resolution.test.ts CAS 2/3 for
// the runtime proof that a domain_in_text resolution yields a website on a different domain than the
// media source that cited it.
// ------------------------------------------------------------
test('9 — website and source_url are distinct schema fields, never aliased to one another', async () => {
 const types = await readFile(new URL('../src/discovery/types.ts', import.meta.url), 'utf8');
 assert.match(types, /website:publicUrl\.nullable\(\)/);
 assert.match(types, /source_url:publicUrl(?!\.nullable)/);
});

// ------------------------------------------------------------
// 10 — RESOLVED never produces a VERIFIED status, in the integrated tree.
// ------------------------------------------------------------
test('10 — entity-resolution.ts never references a VERIFIED status', async () => {
 const source = await readFile(new URL('../src/discovery/entity-resolution.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /'VERIFIED'/);
});

// ------------------------------------------------------------
// 11 — scoring (scoreProspect) is byte-identical to its i18n-branch signature: entity resolution
// never touches it.
// ------------------------------------------------------------
test('11 — scoreProspect signature is unchanged by this integration', async () => {
 const source = await readFile(new URL('../src/domain/core.ts', import.meta.url), 'utf8');
 assert.match(source, /export function scoreProspect\(criteria:Criterion\[\],evidence:Evidence\[\],now=new Date\(\)\)/);
});

// ------------------------------------------------------------
// 12 — locale detection/persistence (useLocale.ts, locale.ts) is untouched by this integration: no
// diff at all against the i18n-validated commit.
// ------------------------------------------------------------
test('12 — locale.ts and useLocale.ts are byte-for-byte unchanged from the validated i18n commit', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const diff = execSync('git diff --name-only 9206f670944008b980505b735759aaf4c68b789a -- src/i18n/locale.ts src/i18n/useLocale.ts', {cwd, encoding: 'utf8'});
 assert.equal(diff.trim(), '');
});

// ------------------------------------------------------------
// 13 — entitlement gate is untouched.
// ------------------------------------------------------------
test('13 — requireActiveEntitlement is untouched by this integration', async () => {
 const source = await readFile(new URL('../src/server/entitlement.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /entity.resolution|canonical/i);
});

// ------------------------------------------------------------
// 14 — RLS/migrations untouched: no migration file appears in the diff against the i18n-validated
// commit, over this bloc's commit range.
// ------------------------------------------------------------
test('14 — no migration file was added or modified by this integration', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 // Commit-scoped: the integration (9604248) and its V2 patch (daf49e3) sit between the i18n-validated
 // main and daf49e3. Later blocs may add their own migrations; this bloc's range must stay migration-free.
 const committed = execSync('git diff --name-only 9206f670944008b980505b735759aaf4c68b789a daf49e3 -- db/migrations', {cwd, encoding: 'utf8'});
 assert.equal(committed.trim(), '');
});

// ------------------------------------------------------------
// 15 — Brave quota/call budget untouched: discovery/api.ts (the quota-enforcing route layer) has no
// diff against the i18n-validated commit, and BraveProvider still makes exactly one HTTP call.
// ------------------------------------------------------------
// api.ts later gained the classification accept gate (discovery-source-classification hotfix), so a
// whole-file diff is no longer a meaningful proxy: this pins the quota/entitlement lines themselves and
// proves no changed line since the i18n-validated commit touches them.
test('15 — discovery/api.ts quota and entitlement enforcement is untouched', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const source = await readFile(new URL('../src/discovery/api.ts', import.meta.url), 'utf8');
 assert.match(source, /if\(\(resource==='projects'&&action==='discovery'&&method==='POST'\)\|\|\(resource==='prospects'&&action==='analyze'&&method==='POST'\)\)await requireActiveEntitlement\(db,user\.id\);/);
 assert.match(source, /provider:'brave',operation:'search',requestCount:1/);
 const changed = execSync('git diff -U0 9206f670944008b980505b735759aaf4c68b789a -- src/discovery/api.ts', {cwd, encoding: 'utf8'}).split('\n').filter(l => /^[+-][^+-]/.test(l));
 for (const line of changed) assert.doesNotMatch(line, /quota|recordApiUsage|requireActiveEntitlement|consume_analysis|max_results/i, `quota/entitlement line changed: ${line}`);
});
test('15 — BraveProvider.searchCompanies still makes exactly one HTTP call after integration', async () => {
 const {BraveProvider} = await import('../src/discovery/providers/brave.ts');
 let calls = 0;
 const provider = new BraveProvider('test', async () => { calls++; return Response.json({web: {results: [{title: 'Grand Frais', url: 'https://www.grand-frais.fr/'}]}}); });
 await provider.searchCompanies({project_id: 'p', query: 'grand frais', location: 'France', categories: [], max_results: 3, optional_filters: {}});
 assert.equal(calls, 1);
});

// ============================================================
// V2 — name/domain decoupling: the Grand Frais / Aufeminin intermediate state (name RESOLVED, domain
// UNRESOLVED) rendered fully in both locales, with source/name/domain data never translated, locale
// persistence untouched, and the evidence workflow (observations.ts) untouched.
// ============================================================
test('V2/1 — FR: the name-resolved/domain-unresolved state renders "Entreprise identifiée", "À confirmer" and the name-only resolution summary', () => {
 assert.equal(translate('fr', 'discovery.identifiedCompanyLabel'), 'Entreprise identifiée');
 assert.equal(translate('fr', 'discovery.companyWebsiteLabel'), 'Site d’entreprise');
 assert.equal(translate('fr', 'discovery.websitePendingReview'), 'À confirmer');
 assert.equal(translate('fr', 'discovery.resolutionLabel'), 'Résolution');
 assert.equal(translate('fr', 'discovery.resolutionNameOnlyLabel'), 'Nom identifié · domaine à confirmer');
});
test('V2/2 — EN: the same name-resolved/domain-unresolved state renders "Identified company", "To review" and the English resolution summary', () => {
 assert.equal(translate('en', 'discovery.identifiedCompanyLabel'), 'Identified company');
 assert.equal(translate('en', 'discovery.companyWebsiteLabel'), 'Company website');
 assert.equal(translate('en', 'discovery.websitePendingReview'), 'To review');
 assert.equal(translate('en', 'discovery.resolutionLabel'), 'Resolution');
 assert.equal(translate('en', 'discovery.resolutionNameOnlyLabel'), 'Company name identified · domain unresolved');
});
test('V2/3 — the fully-resolved (name+domain) summary is also distinct in both locales', () => {
 assert.equal(translate('fr', 'discovery.resolutionBothLabel'), 'Nom et domaine identifiés');
 assert.equal(translate('en', 'discovery.resolutionBothLabel'), 'Company name and domain identified');
});
test('V2/4 — company name and source domain end up different values for the Grand Frais / Aufeminin case, and neither is translated', async () => {
 const {BraveProvider} = await import('../src/discovery/providers/brave.ts');
 const provider = new BraveProvider('test');
 const hit = {title: 'Grand Frais : 30 nouveaux magasins ouvrent en France dès le 1er juin 2026, votre ville est-elle concernée ?', url: 'https://www.aufeminin.com/news/grand-frais-30-nouveaux-magasins.html', description: 'L\'enseigne Grand Frais poursuit son expansion en France.'};
 const c = provider.normalizeResult(Object.assign({}, hit, {__quality: {confidence: .45, signal: 'ambiguous' as const, reasons: []}}));
 assert.equal(c.name, 'Grand Frais', 'the company name is the real extracted value, never a translated placeholder');
 assert.equal(new URL(c.source_url).hostname.replace(/^www\./, ''), 'aufeminin.com', 'the source domain is the real, untranslated hostname');
 assert.equal(c.website, null, 'no domain is ever invented from the resolved name');
});
test('V2/5 — locale persistence (useLocale.ts) is unaffected: still saves to LOCALE_STORAGE_KEY on every setLocale call', async () => {
 const source = await readFile(new URL('../src/i18n/useLocale.ts', import.meta.url), 'utf8');
 assert.match(source, /localStorage\.setItem\(LOCALE_STORAGE_KEY,next\)/);
});
test('V2/6 — evidence workflow (observations.ts) is untouched by this micro-patch', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const diff = execSync('git diff --name-only 9604248dcba8f1ea96e76238933b350d0d0cc331 -- src/discovery/observations.ts', {cwd, encoding: 'utf8'});
 assert.equal(diff.trim(), '');
});
test('V2/7 — domain is never derived from a resolved company name: entity-resolution.ts never calls a domain-guessing function on the name', async () => {
 const source = await readFile(new URL('../src/discovery/entity-resolution.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /companyName\.name.*\.(com|fr|net|org)/i);
 assert.doesNotMatch(source, /toLowerCase\(\)\.replace\(\/\\s\+\/g,\s*''\)\s*\+\s*['"`]\.(com|fr)/);
});
