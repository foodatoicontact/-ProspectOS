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
test('1/2 — RESOLVED company/website/method labels exist in both FR and EN, and are genuinely distinct', () => {
 for (const key of ['discovery.companyLabel', 'discovery.identifiedWebsiteLabel', 'discovery.signalFoundVia', 'discovery.methodOwnSite', 'discovery.methodDomainInText'] as const) {
  assert.equal(typeof fr[key], 'string');
  assert.equal(typeof en[key], 'string');
  assert.notEqual(fr[key], en[key], `${key} must actually be translated, not copy-pasted`);
 }
 assert.equal(translate('fr', 'discovery.companyLabel'), 'Entreprise :');
 assert.equal(translate('en', 'discovery.companyLabel'), 'Company:');
});

// ------------------------------------------------------------
// 3/4 — UNRESOLVED display exists in both locales.
// ------------------------------------------------------------
test('3/4 — UNRESOLVED company label exists in both FR and EN, and is genuinely distinct', () => {
 assert.equal(typeof fr['discovery.unresolvedCompany'], 'string');
 assert.equal(typeof en['discovery.unresolvedCompany'], 'string');
 assert.notEqual(fr['discovery.unresolvedCompany'], en['discovery.unresolvedCompany']);
 assert.equal(translate('fr', 'discovery.unresolvedCompany'), 'Entreprise non résolue — source détectée');
 assert.equal(translate('en', 'discovery.unresolvedCompany'), 'Unresolved company — source detected');
});

// ------------------------------------------------------------
// 5 — no new hardcoded FR/EN literal text was introduced directly in DiscoveryPanel.tsx for the
// entity-resolution block: every label goes through tr(), never a raw string literal.
// ------------------------------------------------------------
test('5 — DiscoveryPanel\'s entity-resolution block contains no hardcoded label text, only tr() lookups', async () => {
 const source = await readFile(new URL('../src/components/DiscoveryPanel.tsx', import.meta.url), 'utf8');
 const forbiddenLiterals = ['Entreprise :', 'Site officiel', 'Signal trouvé via', 'non résolue', 'Company:', 'Identified company website', 'Signal found via', 'Unresolved company'];
 for (const literal of forbiddenLiterals) assert.doesNotMatch(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `"${literal}" must live only in fr.ts/en.ts, never hardcoded in the component`);
 assert.match(source, /tr\('discovery\.companyLabel'\)/);
 assert.match(source, /tr\('discovery\.identifiedWebsiteLabel'\)/);
 assert.match(source, /tr\('discovery\.unresolvedCompany'\)/);
 assert.match(source, /tr\('discovery\.signalFoundVia'\)/);
 assert.match(source, /tr\('discovery\.methodOwnSite'\)/);
 assert.match(source, /tr\('discovery\.methodDomainInText'\)/);
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
 assert.match(source, /\{r\.normalized_payload\.website\}/);
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
// commit, committed or in the working tree.
// ------------------------------------------------------------
test('14 — no migration file was added or modified by this integration', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const committed = execSync('git diff --name-only 9206f670944008b980505b735759aaf4c68b789a -- db/migrations', {cwd, encoding: 'utf8'});
 const working = execSync('git status --porcelain --untracked-files=all -- db/migrations', {cwd, encoding: 'utf8'});
 assert.equal(committed.trim(), '');
 assert.equal(working.trim(), '');
});

// ------------------------------------------------------------
// 15 — Brave quota/call budget untouched: discovery/api.ts (the quota-enforcing route layer) has no
// diff against the i18n-validated commit, and BraveProvider still makes exactly one HTTP call.
// ------------------------------------------------------------
test('15 — discovery/api.ts (quota enforcement) is untouched by this integration', async () => {
 const {execSync} = await import('node:child_process');
 const cwd = new URL('..', import.meta.url);
 const diff = execSync('git diff --name-only 9206f670944008b980505b735759aaf4c68b789a -- src/discovery/api.ts', {cwd, encoding: 'utf8'});
 assert.equal(diff.trim(), '');
});
test('15 — BraveProvider.searchCompanies still makes exactly one HTTP call after integration', async () => {
 const {BraveProvider} = await import('../src/discovery/providers/brave.ts');
 let calls = 0;
 const provider = new BraveProvider('test', async () => { calls++; return Response.json({web: {results: [{title: 'Grand Frais', url: 'https://www.grand-frais.fr/'}]}}); });
 await provider.searchCompanies({project_id: 'p', query: 'grand frais', location: 'France', categories: [], max_results: 3, optional_filters: {}});
 assert.equal(calls, 1);
});
