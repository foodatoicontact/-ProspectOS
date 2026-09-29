// Secondary-source expansion. A directory, a ranking or an article is never a prospect (admissibility.ts keeps
// it out of the shortlist) — but its public snippet often NAMES real companies ("La SAS LES TROIS BECS BTP est une
// entreprise familiale…", "GFE (Goncalves Frères Étanchéité) est une entreprise…", "1. Alpha Construction").
// Those names become SECONDARY ENTITY CANDIDATES only: nothing is added to the pool because a page cites it.
// Each name must be found again through ONE extra provider request (within the run's existing request budget),
// on a page the normal pipeline resolves as the company's OWN site (official domain), and it then goes through
// the unchanged pipeline — admissibility, dedup, novelty, review priority, human validation.
//
// Bounded by construction: at most MAX_NAMES_PER_SOURCE names per source and MAX_SECONDARY_NAMES per run, one
// request at most, never on a result that itself came from an expansion (no recursion), deterministic patterns
// only (no LLM, no page fetch), generic / place / already-known names rejected before any request is spent.
import {getDomain} from 'tldts';
import type {Candidate} from './types.ts';
import {sameCanonicalOrganization} from './admissibility.ts';
import {isQueryEchoOrGeneric,type QueryContext} from './source-classification.ts';
import {isPlaceName} from './geo-fr.ts';

export const MAX_NAMES_PER_SOURCE = 3;
export const MAX_SECONDARY_NAMES = 5;
// Pages whose snippet may cite companies: listings, rankings, articles. Never a job board (an employer there is
// already resolved by admissibility), never a sale listing (anonymized businesses), never a company's own page.
const SOURCE_PAGE_TYPES = new Set(['DIRECTORY', 'NEWS_ARTICLE', 'BLOG_OR_CONTENT', 'GOVERNMENT_OR_PUBLIC_DIRECTORY']);
export type SecondaryName = {name: string; source_url: string; source_title: string};
export type SecondaryOrigin = SecondaryName & {cited_name: string; depth: 1};

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const alnum = (s: string): string => fold(s).replace(/[^a-z0-9]/g, '');
// Words that never name a company on their own ("Entreprise BTP", "Maçonnerie Générale", "Top 20").
const GENERIC = new Set(['entreprise', 'entreprises', 'societe', 'societes', 'btp', 'batiment', 'batiments', 'travaux', 'publics', 'public', 'maconnerie', 'construction', 'constructions',
 'renovation', 'rehabilitation', 'general', 'generale', 'generales', 'gros', 'oeuvre', 'second', 'vrd', 'tp', 'services', 'service', 'groupe', 'top', 'meilleurs', 'meilleures', 'meilleur',
 'artisan', 'artisans', 'entrepreneur', 'entrepreneurs', 'france', 'region', 'sas', 'sarl', 'sasu', 'eurl', 'sa', 'scop', 'snc', 'les', 'la', 'le', 'de', 'du', 'des', 'et', 'en', 'a',
 'annuaire', 'liste', 'classement', 'avis', 'devis', 'contact', 'accueil', 'terrassement', 'plomberie', 'electricite', 'menuiserie', 'charpente', 'couverture', 'isolation', 'peinture', 'cvc']);

const LEGAL_FORM = /(?:^|[\s(,;:·•])(?:la |l[a'’] ?)?(?:SAS|SARL|SASU|EURL|SA|SCOP|SNC|SOCI[ÉE]T[ÉE]|Soci[ée]t[ée])\s+([A-ZÀ-Ý0-9][\p{L}0-9&'’.\- ]{1,48}?)(?=\s+(?:est|a|au|qui|intervient|propose|r[ée]alise)\b|\s*[,.;:(–]|\s+-\s|$)/gu;
const EXPANDED_ACRONYM = /(?:^|[\s·•])([A-Z][A-Z0-9&]{1,9})\s+\(([A-ZÀ-Ý][\p{L}'’\- ]{3,50})\)\s+(?:est|a|,|:)/gu;
const RATED = /([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9&'’.\- ]{2,48}?)\s+\d(?:[.,]\d)?\s*\/\s*5\s*\(\d+\s*avis\)/gu;
const NUMBERED = /(?:^|[\s·•|])(?:\d{1,2}[.)]|#\d{1,2}|N°\s?\d{1,2})\s+([A-ZÀ-Ý][\p{L}0-9&'’.\-]*(?:\s+[A-ZÀ-Ý0-9&][\p{L}0-9&'’.\-]*){0,4})/gu;

const clean = (s: string): string => s.replace(/\s+/g, ' ').replace(/^[\s\-–.,:;]+|[\s\-–.,:;]+$/g, '').trim();
function isUsableName(name: string, context: QueryContext | undefined, sourceUrl: string): boolean {
 if (name.length < 3 || name.length > 50) return false;
 const words = fold(name).replace(/['’.]/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length >= 1);
 if (!words.length || words.every(w => GENERIC.has(w) || /^\d+$/.test(w))) return false;
 if (isQueryEchoOrGeneric(name, context) || isPlaceName(name)) return false;
 // The listing site's own name ("Obat", "Kompass") is the source, not a company it cites.
 let label = '';
 try { label = alnum((getDomain(new URL(sourceUrl).hostname) ?? '').split('.')[0] ?? ''); } catch { /* unreachable: source_url is validated */ }
 return !(label && alnum(name) === label);
}

// The names ONE non-candidate source cites in its title/snippet, at most MAX_NAMES_PER_SOURCE, in text order.
export function citedCompanyNames(c: Pick<Candidate, 'source_url' | 'source_title' | 'raw_metadata'>, context?: QueryContext): SecondaryName[] {
 const meta = c.raw_metadata as Record<string, unknown>;
 if (meta.source_class === 'COMPANY_CANDIDATE' || meta.secondary_origin || !SOURCE_PAGE_TYPES.has(String(meta.page_type))) return [];
 const text = `${String(meta.description ?? '')}`;
 const found: Array<{at: number; name: string}> = [];
 for (const m of text.matchAll(EXPANDED_ACRONYM)) found.push({at: m.index ?? 0, name: clean(m[2]!)});
 for (const m of text.matchAll(LEGAL_FORM)) found.push({at: m.index ?? 0, name: clean(m[1]!)});
 for (const m of text.matchAll(RATED)) found.push({at: m.index ?? 0, name: clean(m[1]!)});
 for (const m of text.matchAll(NUMBERED)) found.push({at: m.index ?? 0, name: clean(m[1]!)});
 const out: SecondaryName[] = [];
 for (const f of found.sort((a, b) => a.at - b.at)) {
  if (out.length >= MAX_NAMES_PER_SOURCE) break;
  if (!isUsableName(f.name, context, c.source_url)) continue;
  if (out.some(o => alnum(o.name) === alnum(f.name) || alnum(o.name).includes(alnum(f.name)) || alnum(f.name).includes(alnum(o.name)))) continue;
  out.push({name: f.name, source_url: c.source_url, source_title: c.source_title});
 }
 return out;
}

export type SecondaryPlan = {sources: number; extracted: number; names: SecondaryName[]; skippedKnown: number};
// Every name worth ONE resolution request: cited by a non-candidate source of this run, not already an
// exploitable candidate of this run, not already a prospect of the project, deduplicated, at most MAX_SECONDARY_NAMES.
export function planSecondaryExpansion(results: Candidate[], known: Array<{name: string}>, context?: QueryContext): SecondaryPlan {
 const runNames = results.filter(r => r.raw_metadata.source_class === 'COMPANY_CANDIDATE').map(r => r.name);
 let sources = 0, extracted = 0, skippedKnown = 0;
 const names: SecondaryName[] = [];
 for (const r of results) {
  const cited = citedCompanyNames(r, context);
  if (!cited.length) continue;
  sources++; extracted += cited.length;
  for (const n of cited) {
   const same = (other: string) => sameCanonicalOrganization(other, n.name) || alnum(other) === alnum(n.name);
   if (known.some(k => same(k.name)) || runNames.some(same)) { skippedKnown++; continue; }
   if (names.some(x => same(x.name))) continue;
   if (names.length < MAX_SECONDARY_NAMES) names.push(n);
  }
 }
 return {sources, extracted, names, skippedKnown};
}

// ONE provider query for every name: each name quoted, joined with OR. Never sent when there is no name.
export const secondaryQuery = (names: SecondaryName[]): string => names.map(n => `"${n.name.replace(/"/g, '')}"`).join(' OR ');

// Which results of the resolution request are one of the cited companies, found on its OWN site: an exploitable
// candidate whose official domain is resolved and whose name (or domain label) is the cited name. Anything else
// the request returned is dropped — the expansion never adds a page that is not one of the names it looked for.
export function resolveSecondaryCandidates(results: Candidate[], names: SecondaryName[]): {resolved: Candidate[]; unresolved: number} {
 const resolved: Candidate[] = [];
 const matched = new Set<string>();
 for (const r of results) {
  const m = r.raw_metadata;
  if (m.source_class !== 'COMPANY_CANDIDATE' || m.entity_confidence !== 'RESOLVED_HIGH' || !r.website) continue;
  let label = '';
  try { label = alnum((getDomain(new URL(r.website).hostname) ?? '').split('.')[0] ?? ''); } catch { continue; }
  const cited = names.find(n => !matched.has(n.name) && (sameCanonicalOrganization(r.name, n.name) || alnum(r.name) === alnum(n.name) || (label.length >= 4 && label === alnum(n.name))));
  if (!cited) continue;
  matched.add(cited.name);
  const origin: SecondaryOrigin = {...cited, cited_name: cited.name, depth: 1};
  resolved.push({...r, raw_metadata: {...m, secondary_origin: origin}});
 }
 return {resolved, unresolved: names.length - matched.size};
}
