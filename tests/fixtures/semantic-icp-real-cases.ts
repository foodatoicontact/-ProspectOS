// Real benchmark cases observed on the Preview (Studio Pilates, sport & well-being) — REGRESSION DATA ONLY,
// kept apart from the initial fixtures (semantic-icp-benchmark.ts). The criteria are the user's real labels.
// Expectations were written BEFORE the fix, from what a human reviewer would accept:
//  - expected:  criteria that must receive a positive proposal on a plausible sentence (excerptPattern);
//  - forbidden: criteria that must receive NO positive proposal (lexical traps, no structured source).
import {CompanyAnalysisService,type DiscoveryRepository} from '../../src/discovery/services.ts';
import type {Criterion} from '../../src/domain/core.ts';
import {positiveProposals} from './semantic-icp-benchmark.ts';

export type RealCase = {id: string; criteria: Criterion[]; lines: string[]; expected: string[]; forbidden: string[]};

const LIEU: Criterion = {key: 'r_lieu', label: 'Lieu physique ou activité exploitable localement', weight: 25};
const COURS: Criterion = {key: 'r_cours', label: 'Cours / séances / réservation active', weight: 25};
const DISCIPLINE_CIBLE: Criterion = {key: 'r_discipline', label: 'Activité correspondant explicitement à une discipline cible', weight: 25};
const ONLINE_BOOKING: Criterion = {key: 'r_online', label: 'Réservation ou inscription en ligne', weight: 25};
// The user's own structured target rule (target_fit, user-authored categories) — the only structured source
// of target disciplines besides an explicit enumeration in a label.
const TARGET_RULE: Criterion = {key: 'target_fit', label: 'Correspond à la cible définie', weight: 25, rules: {type: 'target_fit', config: {categories: ['Pilates', 'Yoga'], match: 'any_defined'}}};
const ENUMERATED: Criterion = {key: 'r_enum', label: 'Discipline : Pilates ou Yoga', weight: 25};
// Lexical traps: a label word appears in the page, in another sense.
const CONTACT_CHANNEL: Criterion = {key: 'r_canal', label: 'Canal de contact professionnel', weight: 20};
const COMMERCIAL_OFFER: Criterion = {key: 'r_offre', label: 'Offre commerciale', weight: 20};
const EXPLOITABLE_PLACE: Criterion = {key: 'r_exploitable', label: 'Lieu exploitable', weight: 20};
const REGULAR_ACTIVITY: Criterion = {key: 'r_regulier', label: 'Activité régulière', weight: 20};

const STUDIO = [
 'Une pratique régulière du Pilates améliore de façon significative la forme physique et mentale',
 'Prenez votre premier cours',
 'Début des cours : mercredi 2 septembre 2026',
 'Des cours personnalisés adaptés à votre niveau',
];

export const EXCERPT_PATTERNS: Record<string, RegExp> = {
 r_lieu: /\b(rue|avenue|boulevard|chemin|place|route)\b|\d{5}/i, r_cours: /cours|s[ée]ance/i, r_discipline: /pilates|yoga/i,
 r_online: /en ligne|application|site/i, r_enum: /pilates|yoga/i,
};

export const REAL_CASES: RealCase[] = [
 {id: 'studio-with-address', criteria: [LIEU, COURS, DISCIPLINE_CIBLE],
  lines: [...STUDIO, 'Studio : 12 rue de la Paix, 84000'], expected: ['r_lieu', 'r_cours'], forbidden: ['r_discipline']},
 {id: 'studio-without-address', criteria: [LIEU, COURS, DISCIPLINE_CIBLE],
  lines: STUDIO, expected: ['r_cours'], forbidden: ['r_lieu', 'r_discipline']},
 {id: 'studio-dates-only', criteria: [COURS],
  lines: ['Début des cours : mercredi 2 septembre 2026'], expected: ['r_cours'], forbidden: []},
 {id: 'discipline-from-target-rule', criteria: [DISCIPLINE_CIBLE, TARGET_RULE],
  lines: ['Cours de Pilates au sol, en petits groupes.'], expected: ['r_discipline'], forbidden: []},
 {id: 'discipline-from-enumeration', criteria: [ENUMERATED],
  lines: ['Studio de Pilates au cœur de la ville.'], expected: ['r_enum'], forbidden: []},
 {id: 'discipline-physique-trap', criteria: [DISCIPLINE_CIBLE, ENUMERATED],
  lines: ['Travailler sa condition physique en douceur grâce à nos cours.'], expected: [], forbidden: ['r_discipline', 'r_enum']},
 {id: 'online-channel-required', criteria: [ONLINE_BOOKING],
  lines: ['Réservez votre séance', 'Réservez votre cours dès aujourd’hui'], expected: [], forbidden: ['r_online']},
 {id: 'online-channel-present', criteria: [ONLINE_BOOKING],
  lines: ['Inscription en ligne sur notre site'], expected: ['r_online'], forbidden: []},
 {id: 'lexical-traps', criteria: [CONTACT_CHANNEL, COMMERCIAL_OFFER, EXPLOITABLE_PLACE, REGULAR_ACTIVITY],
  lines: ['Le contact humain est au cœur de notre démarche.', 'Une offre adaptée à chacun.', 'Un espace exploitable pour vos projets.', 'Une activité pour tous les âges.'],
  expected: [], forbidden: ['r_canal', 'r_offre', 'r_exploitable', 'r_regulier']},
];

export type RealScore = {id: string; correct: string[]; missed: string[]; falsePositives: Array<{criterion: string; excerpt: string}>};
export async function scoreRealCase(c: RealCase): Promise<RealScore> {
 const html = `<html><head><title>Fixture</title></head><body>${c.lines.map(l => `<p>${l}</p>`).join('')}</body></html>`;
 let saved: Parameters<DiscoveryRepository['saveObservations']>[1] = [];
 const repo: DiscoveryRepository = {
  start: async () => { throw Error('unused'); }, existing: async () => [], saveResults: async () => [], finish: async () => {},
  prospect: async id => ({id, website: 'https://real-case.example/', organization_id: 'o', project_id: 'p'}),
  projectCriteria: async () => c.criteria, consumeAnalysis: async () => {},
  saveObservations: async (_id, observations) => { saved = observations; return observations; },
 };
 await new CompanyAnalysisService(repo, async url => ({url, html})).analyze_company('prospect-1');
 const proposals = positiveProposals(saved, c.criteria);
 const correct: string[] = [], missed: string[] = [], falsePositives: RealScore['falsePositives'] = [];
 for (const [key, o] of proposals) {
  const plausible = EXCERPT_PATTERNS[key]?.test(o.source_excerpt) ?? false;
  if (c.forbidden.includes(key) || (c.expected.includes(key) && !plausible)) falsePositives.push({criterion: key, excerpt: o.source_excerpt});
  else if (c.expected.includes(key)) correct.push(key);
 }
 for (const key of c.expected) if (!correct.includes(key)) missed.push(key);
 return {id: c.id, correct, missed, falsePositives};
}
export async function runRealCases() {
 const cases = [];
 for (const c of REAL_CASES) cases.push(await scoreRealCase(c));
 const total = (f: (s: RealScore) => number) => cases.reduce((n, s) => n + f(s), 0);
 return {expected: REAL_CASES.reduce((n, c) => n + c.expected.length, 0), correct: total(s => s.correct.length), falsePositives: total(s => s.falsePositives.length), missed: total(s => s.missed.length), cases};
}
