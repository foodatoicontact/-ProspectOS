// Semantic ICP mapping benchmark — representative, anonymized fixtures of the real benchmark cases.
//
// These sites, sentences and ICP labels are REGRESSION DATA ONLY: they mirror what was observed during the
// blind benchmark (sport & well-being studios, a community box, padel clubs, and pages carrying negations
// or ambiguous wording). No production module may know them (see the anti-hardcoding test).
//
// Expectations were written BEFORE the P0-a implementation and are never adjusted to fit its output:
//  - expected:  criteria a human reviewer would accept a proposal for, from these pages;
//  - forbidden: criteria that must NOT receive a positive proposal (negation, ambiguity, cross-criterion);
//  - anything else is "debatable" and only reported.
// A positive proposal also has to quote a sentence that plausibly supports its criterion (excerptPattern);
// otherwise it is counted as a false positive (a right criterion on the wrong sentence is still wrong).
import {CompanyAnalysisService,type DiscoveryRepository} from '../../src/discovery/services.ts';
import {isExplicitlyMapped} from '../../src/components/evidence-presentation.ts';
import type {Criterion} from '../../src/domain/core.ts';
import type {Observation,StoredObservation} from '../../src/discovery/types.ts';

type Pages = Record<string, string>; // path -> body HTML
export type BenchmarkSite = {id: string; origin: string; icp: 'sport' | 'padel' | 'mixed'; pages: Pages; expected: string[]; forbidden: string[]};

const page = (title: string, nav: Array<[string, string]>, body: string) =>
 `<html><head><title>${title}</title></head><body><nav><ul>${nav.map(([href, text]) => `<li><a href="${href}">${text}</a></li>`).join('')}</ul></nav><main>${body}</main></body></html>`;

export const ICPS: Record<BenchmarkSite['icp'], Criterion[]> = {
 // Labels written as a user would; keys are opaque (user-created criteria get random keys).
 sport: [
  {key: 's_activity', label: 'Cours ou séances proposés', weight: 25},
  {key: 's_schedule', label: 'Planning / activité régulière', weight: 15},
  {key: 's_booking', label: 'Réservation ou inscription en ligne', weight: 15},
  {key: 's_contact', label: 'Contact professionnel joignable', weight: 15},
  {key: 's_discipline', label: 'Discipline pratiquée : Pilates ou Yoga', weight: 15},
  {key: 's_events', label: 'Événements / communauté active', weight: 15},
 ],
 padel: [
  {key: 'p_capacity', label: 'Capacité multi-terrains', weight: 20},
  {key: 'p_events', label: 'Tournois / événementiel', weight: 20},
  {key: 'p_booking', label: 'Réservation active (application ou en ligne)', weight: 20},
  {key: 'p_activity', label: 'Parties ou sessions de jeu actives', weight: 15},
  {key: 'p_contact', label: 'Coordonnées de contact', weight: 10},
  {key: 'p_offer', label: 'Offres commerciales / fidélisation', weight: 15},
 ],
 mixed: [
  {key: 's_activity', label: 'Cours ou séances proposés', weight: 35},
  {key: 's_booking', label: 'Réservation ou inscription en ligne', weight: 35},
  {key: 'p_events', label: 'Tournois / événementiel', weight: 30},
 ],
};

// What a sentence supporting each criterion must look like (right criterion, right sentence).
export const EXCERPT_PATTERNS: Record<string, RegExp> = {
 s_activity: /cours|s[ée]ance/i, s_schedule: /planning|hebdomadaire|tous les jours|lundi|semaine/i, s_booking: /r[ée]serv|inscri/i,
 s_contact: /\d{2}[ .]\d{2}|@|contact/i, s_discipline: /pilates|yoga/i, s_events: /communaut|comp[ée]tition|tournoi|[ée]v[ée]nement/i,
 p_capacity: /terrain/i, p_events: /tournoi|[ée]v[ée]nement/i, p_booking: /r[ée]serv/i, p_activity: /partie|session|jeu/i,
 p_contact: /\d{2}[ .]\d{2}|@|contact/i, p_offer: /offert|offre|abonnement|tarif|€/i,
};

export const SITES: BenchmarkSite[] = [
 {id: 'studio-a', origin: 'https://studio-a.example', icp: 'sport', pages: {
  '/': page('Studio A — Pilates', [['/', 'Accueil'], ['/a-propos', 'Le studio'], ['/tarifs-planning', 'Tarifs & planning'], ['/contact', 'Contact'], ['/mentions-legales', 'Mentions légales']],
   '<h1>Studio A — Pilates</h1><p>Prenez votre premier cours</p><p>Studio de Pilates au cœur de la ville.</p>'),
  '/a-propos': page('Le studio', [], '<p>Fondé en 2015 par deux passionnés.</p>'),
  '/tarifs-planning': page('Tarifs & planning', [], '<h2>Tarifs &amp; planning</h2><p>Planning des cours collectifs : lundi 18h30, mercredi 12h15, samedi 10h.</p><p>Carte 10 séances : 150 €</p>'),
  '/contact': page('Contact', [], '<p>Contactez-nous au 04 90 00 00 01 ou par e-mail : bonjour@studio-a.example</p>'),
  '/mentions-legales': page('Mentions légales', [], '<p>Éditeur du site.</p>'),
 }, expected: ['s_activity', 's_schedule', 's_contact', 's_discipline'], forbidden: ['s_booking', 's_events']},
 {id: 'studio-b', origin: 'https://studio-b.example', icp: 'sport', pages: {
  '/': page('Studio B', [['/', 'Accueil'], ['/qui-sommes-nous', 'Qui sommes-nous'], ['/activites', 'Activités'], ['/conseil-premier-cours', 'Conseil premier cours'], ['/contact', 'Contactez nous']],
   '<p>Yoga et Pilates pour tous les niveaux.</p><p>Téléphone : 04 90 00 00 02</p>'),
  '/qui-sommes-nous': page('Qui sommes-nous', [], '<p>Une équipe de professeurs diplômés.</p>'),
  '/activites': page('Activités', [], '<p>Cours de yoga vinyasa et de Pilates au sol, en petits groupes.</p><p>Séances hebdomadaires du lundi au samedi.</p>'),
  '/conseil-premier-cours': page('Conseil premier cours', [], '<p>Conseil premier cours : arrivez 10 minutes en avance.</p>'),
  '/contact': page('Contact', [], '<p>Contactez nous via le formulaire.</p>'),
 }, expected: ['s_activity', 's_schedule', 's_contact', 's_discipline'], forbidden: ['s_booking', 's_events']},
 {id: 'box-c', origin: 'https://box-c.example', icp: 'sport', pages: {
  '/': page('Box C', [['/', 'Accueil'], ['/planning', 'Planning'], ['/contact', 'Contact']],
   '<p>Rejoignez une communauté de plus de 300 membres.</p><p>Séances coachées tous les jours de 6h à 21h.</p><p>Compétition interne le 15 novembre : inscriptions ouvertes.</p>'),
  '/planning': page('Planning', [], '<p>Planning de la semaine : entraînements à 7h, 12h15 et 19h.</p>'),
  '/contact': page('Contact', [], '<p>contact@box-c.example</p>'),
 }, expected: ['s_activity', 's_schedule', 's_events', 's_contact'], forbidden: ['s_booking', 's_discipline']},
 {id: 'club-1', origin: 'https://club-1.example', icp: 'padel', pages: {
  '/': page('Club 1', [['/', 'Accueil'], ['/contact', 'Contact']],
   '<p>Chez Club 1 : 3 terrains de padel intérieur.</p><p>Tournois tous les mois, tous niveaux.</p><p>10 parties achetées = 1 offerte</p><p>Tél. 04 90 00 00 03</p>'),
  '/contact': page('Contact', [], '<p>Écrivez-nous.</p>'),
 }, expected: ['p_capacity', 'p_events', 'p_contact', 'p_offer'], forbidden: ['p_activity', 'p_booking']},
 {id: 'club-2', origin: 'https://club-2.example', icp: 'padel', pages: {
  '/': page('Club 2', [['/', 'Accueil'], ['/contact', 'Contact']], '<p>6 terrains doubles + 2 terrains simples</p><p>Activité padel ouverte à tous.</p>'),
  '/contact': page('Contact', [], '<p>Contactez-nous : 04 90 00 00 04</p>'),
 }, expected: ['p_capacity', 'p_contact'], forbidden: ['p_booking', 'p_events', 'p_offer']},
 {id: 'club-3', origin: 'https://club-3.example', icp: 'padel', pages: {
  '/': page('Club 3', [['/', 'Accueil']],
   '<p>4 terrains indoor</p><p>Tournois et événements d’entreprise toute l’année.</p><p>Réservez votre terrain via notre application.</p><p>Contact : 04 90 00 00 05</p>'),
 }, expected: ['p_capacity', 'p_events', 'p_booking', 'p_contact'], forbidden: ['p_offer']},
 {id: 'negatives', origin: 'https://negatives.example', icp: 'mixed', pages: {
  '/': page('Négations', [['/', 'Accueil']],
   '<p>Pas de réservation en ligne : venez directement sur place.</p><p>Cours bientôt disponibles.</p><p>Retour sur notre tournoi 2022.</p><p>Aucun cours cet été.</p>'),
 }, expected: [], forbidden: ['s_activity', 's_booking', 'p_events']},
];

// One analysis, exactly as production runs it (CompanyAnalysisService: first page + at most 2 internal
// pages, same origin), against in-memory pages. Returns the saved observations and the fetched URLs.
export async function analyzeSite(site: BenchmarkSite): Promise<{observations: Observation[]; fetched: string[]}> {
 const fetched: string[] = [];
 let saved: Observation[] = [];
 const repo: DiscoveryRepository = {
  start: async () => { throw Error('unused'); }, existing: async () => [], saveResults: async () => [], finish: async () => {},
  prospect: async id => ({id, website: site.origin + '/', organization_id: 'o', project_id: 'p'}),
  projectCriteria: async () => ICPS[site.icp], consumeAnalysis: async () => {},
  saveObservations: async (_id, observations) => { saved = observations; return observations; },
 };
 const fetchPage = async (url: string) => {
  const u = new URL(url); const body = site.pages[u.pathname];
  if (u.origin !== site.origin || body === undefined) throw Error('NOT_FOUND');
  fetched.push(u.pathname); return {url: u.href, html: body};
 };
 await new CompanyAnalysisService(repo, fetchPage).analyze_company('prospect-1');
 return {observations: saved, fetched};
}

// A positive, reviewable proposal for a criterion — the same test the review UI applies.
export function positiveProposals(observations: Observation[], criteria: Criterion[]): Map<string, Observation> {
 const out = new Map<string, Observation>();
 for (const o of observations) {
  const criterion = criteria.find(c => c.key === o.criterion) ?? null;
  const row = {...o, id: 'x', prospect_id: 'p', organization_id: 'o', evidence_id: 'e', review_status: 'NOT_VERIFIED'} as StoredObservation;
  if (criterion && o.value === true && o.status !== 'UNKNOWN' && isExplicitlyMapped(row, criterion) && !out.has(criterion.key)) out.set(criterion.key, o);
 }
 return out;
}

export type SiteScore = {site: string; fetched: string[]; correct: string[]; missed: string[]; falsePositives: Array<{criterion: string; excerpt: string}>; debatable: string[]};
export async function scoreSite(site: BenchmarkSite): Promise<SiteScore> {
 const {observations, fetched} = await analyzeSite(site);
 const proposals = positiveProposals(observations, ICPS[site.icp]);
 const correct: string[] = [], missed: string[] = [], falsePositives: SiteScore['falsePositives'] = [], debatable: string[] = [];
 for (const [key, o] of proposals) {
  const plausible = EXCERPT_PATTERNS[key]?.test(o.source_excerpt) ?? false;
  if (site.forbidden.includes(key) || (site.expected.includes(key) && !plausible)) falsePositives.push({criterion: key, excerpt: o.source_excerpt});
  else if (site.expected.includes(key)) correct.push(key);
  else debatable.push(key);
 }
 for (const key of site.expected) if (!correct.includes(key)) missed.push(key);
 return {site: site.id, fetched, correct, missed, falsePositives, debatable};
}

export async function runBenchmark() {
 const sites = [];
 for (const site of SITES) sites.push(await scoreSite(site));
 const total = (f: (s: SiteScore) => number) => sites.reduce((n, s) => n + f(s), 0);
 return {
  expected: SITES.reduce((n, s) => n + s.expected.length, 0),
  correct: total(s => s.correct.length), falsePositives: total(s => s.falsePositives.length), missed: total(s => s.missed.length),
  sites,
 };
}
