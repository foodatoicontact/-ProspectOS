// Deterministic search-query planning for one Discovery — no LLM, no network, sector/country agnostic.
// A long natural-language brief sent as a single search ("Distributeurs et importateurs B2B en <pays>
// vendant des fournitures, équipements… site officiel") matches every generic term at once, which is
// exactly what directory and marketplace category pages are written to do: they then fill the whole
// result page. A few short, complementary queries — [kind of organization] + [one product/service
// concept] + [zone] — each reach the organizations' own sites instead.
//
//   subjects: the organization kinds the brief opens with ("Distributeurs et importateurs B2B" ->
//             "distributeurs", "importateurs b2b"), read up to the first preposition/relative/punctuation;
//   topics:   the user's own categories first, then the brief's remaining phrases — a topic that only
//             repeats a subject ("Restaurant" for "restaurants") is skipped;
//   zone:     the location exactly as typed (never inferred), appended to every query.
// Exclusion clauses ("Exclure …") are removed before anything is read: they are instructions for the
// admissibility gate, never search terms. Queries that normalize to (almost) the same words are sent once.
import {stripExclusionClauses} from './source-classification.ts';

export const MAX_SEARCH_QUERIES = 3;
const MAX_SUBJECT_WORDS = 3;
const MAX_TOPIC_WORDS = 4;
const MAX_ZONE_WORDS = 5;
const NEAR_DUPLICATE = 0.75;

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Singular/plural-insensitive comparison key: "équipements" = "equipement", "fournisseurs" = "fournisseur".
const stem = (w: string): string => { const f = fold(w).replace(/[^a-z0-9]/g, ''); return f.length > 3 ? f.replace(/(x|s)$/, '') : f; };

// Grammatical words (French + English) — never a search concept.
const FUNCTION_WORDS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'au', 'aux', 'a', 'en', 'dans', 'sur', 'pour', 'par', 'avec', 'chez',
 'sans', 'vers', 'autour', 'pres', 'entre', 'qui', 'que', 'qu', 'dont', 'ou', 'et', 'ni', 'mais', 'leur', 'leurs', 'son', 'sa', 'ses', 'ce', 'ces', 'cet', 'cette',
 'notre', 'nos', 'votre', 'vos', 'tout', 'tous', 'toute', 'toutes', 'afin', 'via', 'ainsi', 'plus', 'tres', 'etc', 'y', 'se', 's', 'ne', 'pas', 'peut', 'pouvant',
 'the', 'an', 'of', 'in', 'on', 'at', 'for', 'to', 'with', 'and', 'or', 'by', 'from', 'that', 'who', 'which', 'near', 'around']);
// Instruction words of a brief ("Trouver…", "Prioriser…", "Signaux : …") — what to do, never what to find.
const INSTRUCTION_WORDS = new Set(['trouver', 'chercher', 'rechercher', 'identifier', 'lister', 'cibler', 'prioriser', 'privilegier', 'viser', 'signaux', 'signal',
 'find', 'search', 'list', 'identify', 'target', 'prioritize', 'prioritise', 'site', 'officiel', 'officiels']);
// Words that end the leading noun phrase ("Distributeurs … | en <pays>", "Structures employeuses | autour de").
const HEAD_END = new Set(['au', 'aux', 'a', 'en', 'dans', 'sur', 'pour', 'par', 'avec', 'chez', 'vers', 'autour', 'pres', 'entre', 'qui', 'que', 'qu', 'dont', 'sans', 'via', 'afin',
 'in', 'on', 'at', 'for', 'with', 'near', 'around', 'that', 'who', 'which']);
// Words that start a new phrase in the rest of the brief.
const PHRASE_BREAK = new Set(['pour', 'qui', 'que', 'qu', 'dont', 'avec', 'dans', 'chez', 'vers', 'autour', 'pres', 'sans', 'via', 'afin', 'for', 'with', 'that', 'who', 'which', 'near', 'around']);
const COORDINATION = new Set(['et', 'ou', 'and', 'or']);

type Token = {word: string; key: string} | {punct: string};
// Words (letters/digits, inner hyphens/dots: "médico-social", "B2B") and structural punctuation. An
// apostrophe ends a word, so an elided article is its own (function) word: "d'expertise" -> "d", "expertise".
function tokenize(text: string): Token[] {
 const out: Token[] = [];
 for (const m of text.matchAll(/([\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*)|([.,;:!?()\n/&|])/gu)) out.push(m[2] ? {punct: m[2]} : {word: m[1]!, key: fold(m[1]!)});
 return out;
}
const isWord = (t: Token): t is {word: string; key: string} => 'word' in t;
const isContent = (key: string, zone: Set<string>): boolean => key.length > 0 && !FUNCTION_WORDS.has(key) && !INSTRUCTION_WORDS.has(key) && !zone.has(stem(key));

export type QueryPlan = {queries: string[]; subjects: string[]; topics: string[]; zone: string};

export function planSearchQueries(input: {query: string; location: string; categories: string[]}): QueryPlan {
 const zone = input.location.replace(/[(),;/|]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, MAX_ZONE_WORDS).join(' ');
 const zoneStems = new Set(zone.split(' ').map(stem).filter(Boolean));
 const tokens = tokenize(stripExclusionClauses(input.query));

 // 1. Leading noun phrase -> coordinated subjects. Leading instruction verbs and articles are skipped.
 let i = 0;
 while (i < tokens.length && isWord(tokens[i]!) && (INSTRUCTION_WORDS.has((tokens[i] as {key: string}).key) || FUNCTION_WORDS.has((tokens[i] as {key: string}).key) && !HEAD_END.has((tokens[i] as {key: string}).key))) i++;
 const subjects: string[][] = [[]];
 for (; i < tokens.length; i++) {
  const t = tokens[i]!;
  if (!isWord(t)) { if (t.punct === ',' || t.punct === '/' || t.punct === '&') { subjects.push([]); continue; } break; }
  if (HEAD_END.has(t.key) || zoneStems.has(stem(t.key))) break;
  if (COORDINATION.has(t.key)) { subjects.push([]); continue; }
  if (isContent(t.key, zoneStems)) subjects[subjects.length - 1]!.push(t.word);
 }
 const subjectPhrases = subjects.filter(s => s.length).map(s => s.slice(0, MAX_SUBJECT_WORDS));

 // 2. The rest of the brief, cut into phrases at punctuation and at phrase-opening words.
 const rest: string[][] = [[]];
 for (; i < tokens.length; i++) {
  const t = tokens[i]!;
  if (!isWord(t) || PHRASE_BREAK.has(t.key)) { rest.push([]); continue; }
  if (isContent(t.key, zoneStems)) rest[rest.length - 1]!.push(t.word);
 }
 const subjectStems = new Set(subjectPhrases.flat().map(stem));
 const redundant = (words: string[]): boolean => words.every(w => subjectStems.has(stem(w)) || zoneStems.has(stem(w)));
 const categoryTopics = input.categories.map(c => tokenize(c).filter(isWord).filter(t => isContent(t.key, zoneStems)).map(t => t.word)).filter(w => w.length && !redundant(w));
 const briefTopics = rest.filter(w => w.length && !redundant(w));
 const topicPhrases = [...categoryTopics, ...briefTopics].map(w => w.slice(0, MAX_TOPIC_WORDS));

 // 3. Subject x topic pairs, one query per distinct pair, at most MAX_SEARCH_QUERIES.
 const S = subjectPhrases.length, T = topicPhrases.length;
 const pairs: string[][] = [];
 if (S || T) for (let k = 0; k < Math.min(MAX_SEARCH_QUERIES + 2, Math.max(S, T)); k++) pairs.push([...(S ? subjectPhrases[k % S]! : []), ...(T ? topicPhrases[k % T]! : [])]);
 else pairs.push(tokens.filter(isWord).filter(t => isContent(t.key, zoneStems)).slice(0, MAX_TOPIC_WORDS + MAX_SUBJECT_WORDS).map(t => t.word));

 const queries: string[] = [];
 const kept: Set<string>[] = [];
 for (const words of pairs) {
  // Never the same concept twice in one query ("distributeurs … distributeur").
  const seen = new Set<string>();
  const unique = words.filter(w => { const k = stem(w); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  if (!unique.length && !zone) continue;
  const text = [...unique, zone].filter(Boolean).join(' ').toLowerCase();
  const key = new Set([...seen, ...zoneStems]);
  if (kept.some(k => similarity(k, key) >= NEAR_DUPLICATE)) continue;
  kept.push(key); queries.push(text);
  if (queries.length === MAX_SEARCH_QUERIES) break;
 }
 return {queries: queries.length ? queries : [zone.toLowerCase()], subjects: subjectPhrases.map(s => s.join(' ')), topics: topicPhrases.map(s => s.join(' ')), zone};
}

// Jaccard similarity of two stem sets.
function similarity(a: Set<string>, b: Set<string>): number {
 let common = 0;
 for (const x of a) if (b.has(x)) common++;
 const union = a.size + b.size - common;
 return union ? common / union : 1;
}
