// V2 P0-a — semantic ICP mapping (deterministic) + internal page prioritization.
// Pure tests: no network, no database (re-analysis against the real RPCs: tests/semantic-icp-db.mjs).
// The regression sentences mirror the blind benchmark; no production module knows them (test 16).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {ObservationService,EvidenceProposalService} from '../src/discovery/observations.ts';
import {CompanyAnalysisService,selectInternalPages,MAX_EXTRA_PAGES,type DiscoveryRepository} from '../src/discovery/services.ts';
import {toStorageSafeObservation} from '../src/discovery/repository.ts';
import {evaluateCriterionIntents,intentsForLabel,INTENT_NOTE_TYPES} from '../src/discovery/strategies/icp-intents.ts';
import {ICP_SIGNAL_PREFIX} from '../src/discovery/strategies/icp-concepts.ts';
import {scoreProspect,type Criterion,type Evidence} from '../src/domain/core.ts';
import type {Observation} from '../src/discovery/types.ts';
import {runBenchmark} from './fixtures/semantic-icp-benchmark.ts';

const NOW=new Date('2026-09-26T10:00:00Z');
const URL_='https://site.fixture.example/';
const C=(key:string,label:string,weight=10):Criterion=>({key,label,weight});
const COURSES=C('c_courses','Cours ou séances proposés'),SCHEDULE=C('c_schedule','Planning / activité régulière'),BOOKING=C('c_booking','Réservation ou inscription en ligne');
const CONTACT=C('c_contact','Contact professionnel joignable'),EVENTS=C('c_events','Tournois / événementiel'),OFFERS=C('c_offers','Offres commerciales / fidélisation');
const PARTIES=C('c_parties','Parties ou sessions de jeu actives'),DISCIPLINE=C('c_discipline','Discipline pratiquée : Pilates ou Yoga');
const MULTI=C('c_multi','Capacité multi-terrains'),CAPACITY=C('c_capacity','Capacité d’accueil importante');
// A valid ICP (weights sum to 100) for the score tests.
const ICP:Criterion[]=[{...COURSES,weight:30},{...SCHEDULE,weight:20},{...CONTACT,weight:20},{...EVENTS,weight:15},{...BOOKING,weight:15}];

const html=(lines:string[])=>`<html><head><title>Fixture</title></head><body>${lines.map(l=>`<p>${l}</p>`).join('')}</body></html>`;
const extract=(lines:string[],criteria:Criterion[])=>new ObservationService().extract(html(lines),URL_,criteria,'official_website',NOW);
const positive=(obs:Observation[],c:Criterion)=>obs.find(o=>o.criterion===c.key&&o.value===true&&o.observation_type===ICP_SIGNAL_PREFIX+c.key);
const note=(obs:Observation[],c:Criterion)=>obs.find(o=>o.criterion===c.key&&Object.values(INTENT_NOTE_TYPES).includes(o.observation_type as never));
const evaluate=(line:string,c:Criterion)=>evaluateCriterionIntents({lines:[line],text:line,make:(()=>{throw Error('unused')}) as never},c,NOW);

test('1 — "Prenez votre premier cours" → proposal for a courses/sessions criterion, INFERRED, reason and exact excerpt kept',()=>{
 const obs=extract(['Prenez votre premier cours'],[COURSES]);
 const p=positive(obs,COURSES);
 assert.ok(p);assert.equal(p.status,'INFERRED');assert.equal(p.source_excerpt,'Prenez votre premier cours');assert.equal(p.source_url,URL_);
 assert.match(p.claim,/premier cours/);assert.match(p.claim,/« Cours ou séances proposés »/);assert.match(p.claim,/confirmer par un humain/);
 assert.ok(p.confidence>0&&p.confidence<=.6);
});
test('2 — "Tarifs & planning" → schedule proposal only when the label asks for a schedule/regular activity',()=>{
 assert.ok(positive(extract(['Tarifs & planning'],[SCHEDULE]),SCHEDULE),'label "Planning / activité régulière"');
 assert.equal(positive(extract(['Tarifs & planning'],[COURSES]),COURSES),undefined,'a courses criterion is not proven by a heading');
 assert.equal(positive(extract(['Tarifs & planning'],[CONTACT]),CONTACT),undefined);
 // A real schedule line is preferred to the heading when both are on the page.
 const p=positive(extract(['Tarifs & planning','Planning des cours collectifs : lundi 18h30, mercredi 12h15.'],[SCHEDULE]),SCHEDULE);
 assert.equal(p?.source_excerpt,'Planning des cours collectifs : lundi 18h30, mercredi 12h15.');
});
test('3 — "Contactez Nous" → only a contact criterion',()=>{
 const obs=extract(['Contactez Nous'],[CONTACT,COURSES,SCHEDULE,BOOKING,EVENTS]);
 assert.ok(positive(obs,CONTACT));
 for(const c of [COURSES,SCHEDULE,BOOKING,EVENTS])assert.equal(positive(obs,c),undefined,c.label);
 // A label that merely contains the word "contact" but is not about reaching the prospect gets nothing.
 for(const label of ['Liste de contact marketing documentée','Commandes par téléphone'])assert.equal(intentsForLabel(label).length,0,label);
});
test('4 — "4 terrains indoor", "3 terrains de padel intérieur", "6 terrains doubles + 2 terrains simples" → capacity',()=>{
 for(const line of ['4 terrains indoor','3 terrains de padel intérieur','6 terrains doubles + 2 terrains simples']){
  assert.ok(positive(extract([line],[MULTI]),MULTI),`${line} (rule engine, label names the unit)`);
  assert.ok(positive(extract([line],[CAPACITY]),CAPACITY),`${line} (intent, label names no unit)`);
 }
 assert.match(positive(extract(['6 terrains doubles + 2 terrains simples'],[CAPACITY]),CAPACITY)!.claim,/8 unités/);
 assert.equal(positive(extract(['1 terrain couvert'],[CAPACITY]),CAPACITY),undefined,'a single unit is not a capacity');
});
test('5 — "Tournois" → events, when the label asks for it and the sentence establishes an activity',()=>{
 assert.ok(positive(extract(['Tournois tous les mois, tous niveaux.'],[EVENTS]),EVENTS));
 assert.ok(positive(extract(['Tournois et événements d’entreprise toute l’année.'],[EVENTS]),EVENTS));
 assert.equal(positive(extract(['Tournois tous les mois, tous niveaux.'],[COURSES,CONTACT]),COURSES),undefined);
 assert.equal(evaluate('Tournois',EVENTS),null,'a bare menu word is not an established activity');
});
test('6 — a contact observation never supports an activity, schedule, booking or event criterion',()=>{
 const obs=extract(['Tél. 04 90 00 00 03','Contactez-nous au 04 90 00 00 01 du lundi au vendredi','bonjour@studio.example','Réservation par téléphone au 04 90 00 00 02'],[COURSES,SCHEDULE,BOOKING,EVENTS,CONTACT]);
 for(const c of [COURSES,SCHEDULE,BOOKING,EVENTS])assert.equal(positive(obs,c),undefined,c.label);
 assert.ok(positive(obs,CONTACT));
});
test('7 — a schedule observation never supports a contact criterion',()=>{
 const obs=extract(['Planning de la semaine : entraînements à 7h, 12h15 et 19h.','Séances hebdomadaires du lundi au samedi.'],[CONTACT,SCHEDULE]);
 assert.equal(positive(obs,CONTACT),undefined);
 assert.ok(positive(obs,SCHEDULE));
});
test('8 — negation → never a positive proposal; a NEGATIVE note explains why',()=>{
 const cases:Array<[string,Criterion]>=[['Pas de réservation en ligne : venez directement sur place.',BOOKING],['Aucun cours cet été.',COURSES],['Nous n’organisons plus de tournois.',EVENTS],['Il n’y a pas de planning cette saison.',SCHEDULE]];
 for(const [line,c] of cases){
  const obs=extract([line],[c]);
  assert.equal(positive(obs,c),undefined,line);
  const n=note(obs,c);assert.ok(n,line);assert.equal(n.value,null);assert.equal(n.status,'INFERRED');assert.match(n.claim,/0 point/);
 }
 assert.equal(evaluate('Pas de réservation en ligne : venez directement sur place.',BOOKING)?.polarity,'negative');
 assert.equal(evaluate('Aucun cours cet été.',COURSES)?.polarity,'negative');
 // Courtesy formulas are not negations of the facts they introduce.
 assert.ok(positive(extract(['N’hésitez pas à nous contacter au 04 90 00 00 09'],[CONTACT]),CONTACT));
 assert.ok(positive(extract(['Abonnement sans engagement : 10 séances offertes'],[OFFERS]),OFFERS));
});
test('9 — ambiguous (tentative, past, price-only, no channel) → INSUFFICIENT, no false positive',()=>{
 const cases:Array<[string,Criterion]>=[
  ['Cours bientôt disponibles.',COURSES],['Retour sur notre tournoi 2022.',EVENTS],['Tournoi annuel depuis 2010',EVENTS],
  ['10 parties achetées = 1 offerte',PARTIES],['Carte 10 séances : 150 €',COURSES],
 ];
 for(const [line,c] of cases){assert.equal(positive(extract([line],[c]),c),undefined,line);assert.equal(evaluate(line,c)?.polarity,'insufficient',line)}
 // "10 parties achetées = 1 offerte" IS an offer: proposed for an offers/loyalty criterion only.
 assert.ok(positive(extract(['10 parties achetées = 1 offerte'],[OFFERS]),OFFERS));
 // Registration without a stated channel does not prove an ONLINE booking.
 assert.equal(positive(extract(['Compétition interne le 15 novembre : inscriptions ouvertes.'],[BOOKING]),BOOKING),undefined);
 assert.ok(positive(extract(['Réservez votre terrain via notre application.'],[BOOKING]),BOOKING));
 // "cours" in its other senses is never an activity.
 for(const line of ['Au cours de l’année, le club a changé de nom.','Travaux en cours','Cours de bourse en temps réel'])assert.equal(positive(extract([line],[COURSES]),COURSES),undefined,line);
 // A discipline named by the label needs an activity context; a lone mention is not enough.
 assert.equal(positive(extract(['Yoga et Pilates pour tous les niveaux.'],[DISCIPLINE]),DISCIPLINE),undefined);
 assert.ok(positive(extract(['Cours de yoga vinyasa et de Pilates au sol.'],[DISCIPLINE]),DISCIPLINE));
 assert.equal(positive(extract(['Prenez votre premier cours'],[DISCIPLINE]),DISCIPLINE),undefined,'another activity is not the named one');
});
test('10 — an unverified proposal gives 0 point (INFERRED_UNCONFIRMED), notes never become evidence',()=>{
 const obs=extract(['Prenez votre premier cours','Tournois tous les mois, tous niveaux.','Contactez-nous au 04 90 00 00 01','Aucun cours cet été.','Planning des cours : lundi 18h'],ICP);
 const evidence=new EvidenceProposalService().propose(obs,ICP);
 assert.ok(evidence.length>=3);
 assert.ok(evidence.every(e=>e.verified_by===null&&e.status!=='VERIFIED'));
 assert.ok(evidence.filter(e=>obs.find(o=>o.criterion===e.criterion&&o.observation_type.startsWith(ICP_SIGNAL_PREFIX))).every(e=>e.status==='INFERRED_UNCONFIRMED'));
 assert.equal(scoreProspect(ICP,evidence,NOW).score,0);
 for(const n of obs.filter(o=>Object.values(INTENT_NOTE_TYPES).includes(o.observation_type as never))){
  assert.equal(n.value,null);assert.equal(toStorageSafeObservation(n).criterion,null,'stored as a contextual note, never as evidence');
 }
 assert.ok(obs.every(o=>(o.status as string)!=='VERIFIED'));
});
test('11 — human confirmation → the exact score of the existing engine (no second score)',()=>{
 const obs=extract(['Prenez votre premier cours','Tournois tous les mois, tous niveaux.','Contactez-nous au 04 90 00 00 01'],ICP);
 const evidence=new EvidenceProposalService().propose(obs,ICP);
 const confirm=(key:string)=>evidence.map(e=>e.criterion===key?{...e,status:'VERIFIED' as const,verified_by:'human-1'}:e);
 assert.equal(scoreProspect(ICP,confirm('c_courses'),NOW).score,30);
 const both=confirm('c_courses').map(e=>e.criterion==='c_events'?{...e,status:'VERIFIED' as const,verified_by:'human-1'}:e);
 assert.equal(scoreProspect(ICP,both,NOW).score,45);
 // A forged verified_by without the VERIFIED status is still worth nothing.
 assert.equal(scoreProspect(ICP,evidence.map(e=>({...e,verified_by:'someone'})),NOW).score,0);
});

// ---------------------------------------------------------------- pages
function site(pages:Record<string,string>,criteria:Criterion[]){
 const fetched:string[]=[];
 const repo:DiscoveryRepository={start:async()=>{throw Error('unused')},existing:async()=>[],saveResults:async()=>[],finish:async()=>{},
  prospect:async id=>({id,website:'https://club.example/',organization_id:'o',project_id:'p'}),projectCriteria:async()=>criteria,consumeAnalysis:async()=>{},saveObservations:async(_i,o)=>o};
 const fetchPage=async(url:string)=>{const u=new URL(url);fetched.push(u.origin===new URL('https://club.example').origin?u.pathname:u.href);if(pages[u.pathname]===undefined||u.origin!=='https://club.example')throw Error('NOT_FOUND');return {url:u.href,html:pages[u.pathname]}};
 return {run:()=>new CompanyAnalysisService(repo,fetchPage).analyze_company('p1'),fetched};
}
const nav=(links:Array<[string,string]>,body='')=>`<html><body><ul>${links.map(([h,t])=>`<li><a href="${h}">${t}</a></li>`).join('')}</ul>${body}</body></html>`;

test('13 — at most 3 pages are fetched (first page + 2), same origin only, whatever the number of relevant links',async()=>{
 assert.equal(MAX_EXTRA_PAGES,2);
 const links:Array<[string,string]>=[['/planning','Planning'],['/tarifs','Tarifs'],['/reservation','Réserver'],['/activites','Activités'],['/evenements','Événements'],['/contact','Contact'],['https://elsewhere.example/planning','Planning partenaire'],['/a-propos','À propos']];
 const pages=Object.fromEntries([['/',nav(links)],...links.filter(([h])=>h.startsWith('/')).map(([h])=>[h,'<p>x</p>'])]);
 const s=site(pages,ICP);const r=await s.run();
 assert.equal(s.fetched.length,3);assert.equal(r.pages_analyzed,3);
 assert.ok(s.fetched.every(p=>p.startsWith('/')),'never another origin');
});
test('14 — a planning / booking page is preferred to a generic "À propos" page when the ICP asks for it',async()=>{
 const links:Array<{url:string;text:string}>=[{url:'https://club.example/a-propos',text:'Le club'},{url:'https://club.example/qui-sommes-nous',text:'Qui sommes-nous'},{url:'https://club.example/tarifs-planning',text:'Tarifs & planning'},{url:'https://club.example/reserver',text:'Réserver'}];
 assert.deepEqual(selectInternalPages(links,[SCHEDULE,BOOKING],new Set()),['https://club.example/tarifs-planning','https://club.example/reserver']);
 // Without such criteria the generic pages keep their former order (behaviour unchanged).
 assert.deepEqual(selectInternalPages(links,[C('x','Signal commercial observable',100)],new Set()),['https://club.example/a-propos','https://club.example/qui-sommes-nous']);
 // A criterion the first page already supports no longer spends a page: contact already shown.
 const contactLinks=[{url:'https://club.example/contact',text:'Contact'},{url:'https://club.example/activites',text:'Activités'},{url:'https://club.example/a-propos',text:'À propos'}];
 assert.equal(selectInternalPages(contactLinks,[CONTACT,COURSES],new Set())[0],'https://club.example/contact');
 assert.deepEqual(selectInternalPages(contactLinks,[CONTACT,COURSES],new Set(['c_contact'])),['https://club.example/activites','https://club.example/contact']);
 // Legal / account / cart pages are never worth one of the pages.
 assert.deepEqual(selectInternalPages([{url:'https://club.example/mentions-legales',text:'Mentions légales'},{url:'https://club.example/panier',text:'Panier'},{url:'https://club.example/mon-compte',text:'Mon compte'}],ICP,new Set()),[]);
 // End to end: the schedule sentence of the planning page is found.
 const s=site({'/':nav([['/a-propos','Le club'],['/qui-sommes-nous','Qui sommes-nous'],['/tarifs-planning','Tarifs & planning']]),'/a-propos':'<p>Fondé en 2015.</p>','/qui-sommes-nous':'<p>Une équipe.</p>','/tarifs-planning':'<p>Planning des cours : lundi 18h30, jeudi 19h.</p>'},[SCHEDULE,{...COURSES,weight:90}]);
 const r=await s.run();
 assert.ok(s.fetched.includes('/tarifs-planning'));
 assert.ok(r.observations.some(o=>o.criterion==='c_schedule'&&o.value===true));
});
test('15 — robots / SSRF / same-origin unchanged: every page goes through the injected fetcher, refusals still surface',async()=>{
 const src=await readFile(new URL('../src/discovery/services.ts',import.meta.url),'utf8');
 const analyze=src.slice(src.indexOf('async analyze_company('));
 assert.equal((analyze.match(/await this\.fetchPage\(/g)??[]).length,2,'first page + selected pages, both through the policy fetcher');
 assert.doesNotMatch(analyze,/\bfetch\(|safeFetch|http\.get|https\.get/,'no other network path');
 assert.match(analyze,/url\.origin===new URL\(page\.url\)\.origin/,'same-origin filter kept');
 for(const f of ['../src/discovery/safe-fetch.ts','../src/discovery/website-analysis.ts','../src/discovery/analysis-authorization.ts'])
  assert.doesNotMatch(await readFile(new URL(f,import.meta.url),'utf8'),/icp-intents|selectInternalPages/,f);
 // A robots.txt refusal of the site is still reported as such.
 const repo:DiscoveryRepository={start:async()=>{throw Error('unused')},existing:async()=>[],saveResults:async()=>[],finish:async()=>{},prospect:async id=>({id,website:'https://club.example/',organization_id:'o',project_id:'p'}),projectCriteria:async()=>ICP,consumeAnalysis:async()=>{},saveObservations:async(_i,o)=>o};
 await assert.rejects(()=>new CompanyAnalysisService(repo,async()=>{throw Error('x',{cause:Error('Blocked by robots.txt')})}).analyze_company('p1'),/ROBOTS_DENIED/);
});
test('16 — anti-hardcoding: no sector, customer, club or place name in production discovery logic',async()=>{
 const FORBIDDEN=/kevin|avignon|padel|pilates|yoga|hyrox|pole ?dance|roxnation|chez pap[eé]|le hangar|paul (&|et) louis/i;
 const files=[
  ...(await readdir(new URL('../src/discovery/strategies/',import.meta.url))).map(f=>`../src/discovery/strategies/${f}`),
  // National reference data (geo-fr.ts lists every French prefecture) is not logic.
  ...(await readdir(new URL('../src/discovery/',import.meta.url))).filter(f=>f.endsWith('.ts')&&f!=='geo-fr.ts').map(f=>`../src/discovery/${f}`),
  '../src/components/evidence-presentation.ts','../src/components/ObservationsReview.tsx',
 ];
 for(const f of files)assert.doesNotMatch(await readFile(new URL(f,import.meta.url),'utf8'),FORBIDDEN,f);
});
test('Invariant — no LLM: the intent layer and the analysis path never reach an AI provider',async()=>{
 for(const f of ['../src/discovery/strategies/icp-intents.ts','../src/discovery/services.ts','../src/discovery/strategies/generic.ts'])
  assert.doesNotMatch(await readFile(new URL(f,import.meta.url),'utf8'),/server\/ai|anthropic|openai|analyzeOffer|AI_PROVIDER|AI_MODEL/i,f);
});
test('Invariant — every intent proposal is INFERRED, value true, confidence ≤ 0.6, on the reviewable ICP_SIGNAL type',()=>{
 const obs=extract(['Prenez votre premier cours','Tarifs & planning','Contactez Nous','4 terrains indoor','Tournois tous les mois','10 parties achetées = 1 offerte','Réservez via notre application'],[COURSES,SCHEDULE,CONTACT,CAPACITY,EVENTS,OFFERS,BOOKING]);
 const proposals=obs.filter(o=>o.observation_type.startsWith(ICP_SIGNAL_PREFIX));
 assert.equal(proposals.length,7);
 for(const p of proposals){assert.equal(p.status,'INFERRED');assert.equal(p.value,true);assert.ok(p.confidence<=.6);assert.equal(p.observation_type,ICP_SIGNAL_PREFIX+p.criterion)}
});
test('Held-out sentences (not used to write the rules): no false positive across sectors',()=>{
 const none:Array<[string,Criterion]>=[
  ['Inscrivez-vous à notre newsletter',BOOKING],['Planning de livraison sous 48h',SCHEDULE],['Événement annulé',EVENTS],['Consultez nos tarifs',OFFERS],
  ['Suivez-nous sur Instagram',CONTACT],['Connectez-vous à votre compte en ligne',BOOKING],['Plus de 10 ans d’expérience',CAPACITY],['Paiement en ligne sécurisé',BOOKING],
 ];
 for(const [line,c] of none)assert.equal(positive(extract([line],[c]),c),undefined,`${line} → ${c.label}`);
 for(const label of ['Besoin correspondant à l’offre','Signal commercial observable','Correspond à la cible définie','Budget marketing élevé','Forte audience sociale documentée'])
  assert.equal(intentsForLabel(label).length,0,`${label}: no intent, the existing behaviour is kept`);
});

// ---------------------------------------------------------------- before / after
test('Before / after P0-a on the representative fixtures (baseline measured on 52bc1f3, never edited)',async()=>{
 const before=JSON.parse(await readFile(new URL('./fixtures/semantic-icp-baseline.json',import.meta.url),'utf8'));
 const after=await runBenchmark();
 assert.equal(before.engine_commit,'52bc1f3');assert.equal(after.expected,before.expected);
 console.log(`# semantic ICP benchmark: expected ${after.expected} | correct ${before.correct} → ${after.correct} | false positives ${before.falsePositives} → ${after.falsePositives} | still unmapped ${before.missed} → ${after.missed}`);
 for(const s of after.sites)if(s.missed.length||s.falsePositives.length)console.log(`#  ${s.site}: missed ${s.missed.join(',')||'-'} | FP ${s.falsePositives.map(f=>f.criterion).join(',')||'-'}`);
 assert.ok(after.correct>before.correct,'more correct proposals');
 assert.ok(after.falsePositives<=before.falsePositives,'no new false positive');
 assert.equal(after.falsePositives,0);
});
test('Invariant — bounded work on hostile pages: an unpunctuated 200 000-character line is skipped quickly',()=>{
 const huge='a'.repeat(200000);const t=Date.now();
 const obs=extract([huge,'Prenez votre premier cours'],[COURSES,CONTACT]);
 assert.ok(Date.now()-t<2000);assert.ok(positive(obs,COURSES));
});

// ---------------------------------------------------------------- final hardening: elided French negation
test('Rule engine — elided negation ("n\'organisons plus", "n\'est plus", "n\'acceptons pas") never yields a positive proposal',async()=>{
 const {extractIcpConceptProposals,isNegated}=await import('../src/discovery/strategies/icp-concepts.ts');
 const GROUPS=C('groups','Offres groupes / entreprises / événements'),INFRA=C('infra','Infrastructure sportive physique réservable'),SLOT=C('slot','Réservation par créneau / à l’heure');
 const direct=(line:string,c:Criterion)=>extractIcpConceptProposals({lines:[line],text:line,make:(criterion,type,excerpt,value,status,claim,confidence)=>({criterion,observation_type:type,claim,value,status,source_url:URL_,source_title:'t',source_excerpt:excerpt,source_type:'official_website',confidence,collected_at:NOW.toISOString(),expires_at:NOW.toISOString(),content_hash:'h'})},[c]);
 const negated:Array<[string,Criterion]>=[
  ['Nous n’organisons plus de tournois d’entreprise.',GROUPS],['Nous n\'organisons plus de tournois',GROUPS],
  ['Nous n’acceptons pas les réservations en ligne de terrains.',INFRA],['Nous n\'acceptons pas les réservations de créneaux à l\'heure.',SLOT],
  ['Réservation de terrain : ce service n’est plus disponible.',INFRA],['La location de salles n\'est plus proposée.',INFRA],
  ['Nous n’avons pas de privatisation pour les anniversaires.',GROUPS],
 ];
 for(const [line,c] of negated){
  assert.equal(direct(line,c).length,0,`rule engine: ${line}`);
  // End to end (rule engine, then the intent fallback): still no positive proposal for the criterion.
  const obs=extract([line],[c]);
  assert.equal(obs.find(o=>o.criterion===c.key&&o.value===true),undefined,`pipeline: ${line}`);
 }
 for(const n of ["nous n'organisons plus de tournois","ce service n'est plus disponible","nous n'avons pas de terrain","nous n'acceptons pas"])assert.ok(isNegated(n),n);
 // Harmonized: one definition for both layers — the intent layer imports the rule engine's.
 const intentsSrc=await readFile(new URL('../src/discovery/strategies/icp-intents.ts',import.meta.url),'utf8');
 assert.doesNotMatch(intentsSrc,/const NEGATION\s*=|const NEG_EXEMPT\s*=/,'no second negation definition in the intent layer');
 assert.match(intentsSrc,/import \{[^}]*\bNEGATION\b[^}]*withoutNegationExemptions[^}]*\} from '\.\/icp-concepts\.ts'/);
});
test('Rule engine — affirmative sentences (and courtesy formulas) still produce their proposal',async()=>{
 const GROUPS=C('groups','Offres groupes / entreprises / événements'),INFRA=C('infra','Infrastructure sportive physique réservable'),SLOT=C('slot','Réservation par créneau / à l’heure');
 const positives:Array<[string,Criterion]>=[
  ['Nous organisons des tournois d’entreprise.',GROUPS],['Réservez votre terrain en ligne.',INFRA],['Créneaux de 1h30 à réserver en ligne.',SLOT],
  ['4 terrains indoor + 1 terrain de badminton',MULTI],['N’hésitez pas à réserver votre terrain en ligne.',INFRA],['Location de salles sans engagement.',INFRA],
 ];
 for(const [line,c] of positives){
  const p=extract([line],[c]).find(o=>o.criterion===c.key&&o.value===true);
  assert.ok(p,line);assert.equal(p.status,'INFERRED');assert.equal(p.observation_type,ICP_SIGNAL_PREFIX+c.key);
 }
});
